<script lang="ts">
	// The day planner (time blocking): a day's timed tasks as blocks on a
	// timeline, and its untimed ones in a tray to plan. Everything writes the
	// task's SCHEDULED (or DEADLINE) time as an org range, repeater and all,
	// with Undo in the bar; appointments written in an entry's text show but
	// stay put.
	// - Any screen: pick a task in the tray, then tap a time on the day (or
	//   type a time and Plan); tap a block for a toolbar (earlier, later,
	//   shorter, longer, no time, edit).
	// - With a mouse: drag a task onto the day, drag a block to move it, drag
	//   its bottom edge to change its end, drag it onto the tray to take its
	//   time off.
	// - Keyboard, on a block: ↑/↓ move 15 minutes, Shift+↑/↓ change the end,
	//   Enter edits, Delete takes the time off.
	import { untrack } from 'svelte';
	import { addDays } from '$lib/org';
	import type { AgendaItem } from '$lib/vault/vault';
	import {
		dayPlan,
		DEFAULT_MINUTES,
		fromMinutes,
		hours,
		planTotals,
		snap,
		SNAP,
		toMinutes,
		type PlanBlock,
	} from '../planner';
	import { app, localNow } from '../state.svelte';
	import Icon from './Icon.svelte';

	let { today, keep }: { today: string; keep: (item: AgendaItem) => boolean } = $props();

	const FIRST_HOUR = 6;
	const LAST_HOUR = 24;
	const HOUR_PX = 64;
	const px = (minutes: number) => ((minutes - FIRST_HOUR * 60) / 60) * HOUR_PX;

	// svelte-ignore state_referenced_locally
	let date = $state(today);
	const plan = $derived.by(() => {
		void app.rev;
		return dayPlan(app.vault, date, today, keep);
	});
	const totals = $derived(planTotals(plan.blocks, app.workHours));
	const keyOf = (i: AgendaItem) => `${i.file}\u0000${i.pos}`;
	const lengthOf = (i: AgendaItem) => (i.effort && i.effort > 0 ? i.effort : DEFAULT_MINUTES);

	/** What's picked: a task in the tray (to place), or a block (for its toolbar). */
	let picked = $state<{ kind: 'tray' | 'block'; key: string } | null>(null);
	const pickedTray = $derived(
		picked?.kind === 'tray' ? (plan.unplanned.find((i) => keyOf(i) === picked!.key) ?? null) : null,
	);
	const pickedBlock = $derived(
		picked?.kind === 'block' ? (plan.blocks.find((b) => b.key === picked!.key) ?? null) : null,
	);
	let placeAt = $state('09:00');

	const label = $derived(
		new Date(`${date}T12:00`).toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
		}),
	);

	// ---- writing ----
	const kindOf = (b: PlanBlock) => (b.source === 'DEADLINE' ? 'DEADLINE' : 'SCHEDULED');
	function place(item: AgendaItem, start: number) {
		const s = Math.max(FIRST_HOUR * 60, snap(start));
		app.planTask(
			item.file,
			item.pos,
			'SCHEDULED',
			date,
			s,
			Math.min(s + lengthOf(item), 24 * 60 - 1),
		);
		picked = { kind: 'block', key: keyOf(item) };
	}
	function move(b: PlanBlock, start: number, end: number) {
		if (b.source === 'appointment') return;
		if (start === b.start && end === b.end) return;
		app.planTask(b.item.file, b.item.pos, kindOf(b), date, start, end);
	}
	function unplan(b: PlanBlock) {
		if (b.source === 'appointment') return;
		app.planTask(b.item.file, b.item.pos, kindOf(b), date, null);
		picked = null;
	}
	const nudge = (b: PlanBlock, by: number) =>
		move(b, Math.max(0, b.start + by), Math.min(24 * 60 - 1, b.end + by));
	const stretch = (b: PlanBlock, by: number) =>
		move(b, b.start, Math.max(b.start + SNAP, Math.min(24 * 60 - 1, b.end + by)));

	// ---- the timeline ----
	let line = $state<HTMLElement>();
	let scroller = $state<HTMLElement>();
	let tray = $state<HTMLElement>();
	const minutesAt = (clientY: number) => {
		const r = line!.getBoundingClientRect();
		return FIRST_HOUR * 60 + ((clientY - r.top) / HOUR_PX) * 60;
	};

	/** A tap on the day (not on a block) places the picked task there. */
	function onTimelineClick(e: MouseEvent) {
		if (justDragged || (e.target as Element).closest('.block')) return;
		if (pickedTray) place(pickedTray, minutesAt(e.clientY));
		else picked = null;
	}

	// ---- dragging: a mouse right away, a finger after a long press ----
	type Drag = {
		mode: 'move' | 'resize' | 'place';
		key: string;
		/** Where the pointer was within the block when it started (minutes). */
		grip: number;
		length: number;
		start: number;
		end: number;
		x: number;
		y: number;
		/** Where the pointer is now (screen), for the floating card and edge scrolling. */
		cx: number;
		cy: number;
		moved: boolean;
		overTray: boolean;
		overLine: boolean;
		touch: boolean;
	};
	let drag = $state<Drag | null>(null);
	/** A drag just ended: the click that follows it isn't a tap. */
	let justDragged = false;

	function startDrag(
		mode: Drag['mode'],
		key: string,
		start: number,
		end: number,
		x: number,
		y: number,
		touch: boolean,
	) {
		const at = line ? minutesAt(y) : start;
		drag = {
			mode,
			key,
			grip: mode === 'move' ? at - start : 0,
			length: end - start,
			start,
			end,
			x,
			y,
			cx: x,
			cy: y,
			// A finger has already held still to pick it up: it's lifted at once.
			moved: touch,
			overTray: false,
			overLine: false,
			touch,
		};
	}
	function beginDrag(e: PointerEvent, mode: Drag['mode'], key: string, start: number, end: number) {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		startDrag(mode, key, start, end, e.clientX, e.clientY, false);
	}
	function dragTo(x: number, y: number) {
		const d = drag;
		if (!d || !line) return;
		if (!d.moved && Math.hypot(x - d.x, y - d.y) < 4) return;
		d.moved = true;
		d.cx = x;
		d.cy = y;
		const sr = scroller!.getBoundingClientRect();
		d.overLine = x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom;
		const tr = tray?.getBoundingClientRect();
		d.overTray = !!tr && x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom;
		const at = minutesAt(y);
		if (d.mode === 'resize') d.end = Math.max(d.start + SNAP, Math.min(24 * 60 - 1, snap(at)));
		else {
			d.start = Math.max(FIRST_HOUR * 60, Math.min(24 * 60 - 1 - d.length, snap(at - d.grip)));
			d.end = d.start + d.length;
		}
		drag = { ...d };
	}
	function endDrag() {
		const d = drag;
		drag = null;
		if (!d?.moved) return;
		justDragged = true;
		setTimeout(() => (justDragged = false), 0);
		if (d.mode === 'place') {
			const item = plan.unplanned.find((i) => keyOf(i) === d.key);
			if (item && d.overLine) place(item, d.start);
			return;
		}
		const b = plan.blocks.find((x) => x.key === d.key);
		if (!b) return;
		if (d.mode === 'move' && d.overTray) return unplan(b);
		if (d.overLine || d.mode === 'resize') move(b, d.start, d.end);
	}
	const onPointerMove = (e: PointerEvent) => {
		if (drag && !drag.touch) dragTo(e.clientX, e.clientY);
	};
	const onPointerUp = () => {
		if (drag && !drag.touch) endDrag();
	};

	// Resting near the timeline's top or bottom edge (inside it), a drag
	// scrolls it; passing through on the way in (from the tray) doesn't.
	/** A drag is under way (changes only when one starts or ends, not as it moves). */
	const lifted = $derived(!!drag?.moved);
	$effect(() => {
		if (!lifted) return;
		let since = 0;
		let last = 0;
		/** Fractions of a pixel left over, so slow scrolling still moves. */
		let carry = 0;
		const tick = () => {
			const t = performance.now();
			const dt = last ? Math.min(250, t - last) : 0;
			last = t;
			const d = drag;
			const el = scroller;
			if (d && el) {
				const r = el.getBoundingClientRect();
				const edge = 44;
				const inside = d.cx >= r.left && d.cx <= r.right && d.cy >= r.top && d.cy <= r.bottom;
				// Pixels a second: faster the closer to the edge (up to about 9 hours a minute).
				const depth = !inside
					? 0
					: d.cy < r.top + edge
						? -(r.top + edge - d.cy)
						: d.cy > r.bottom - edge
							? d.cy - (r.bottom - edge)
							: 0;
				const speed = (depth / edge) * 600;
				if (!speed) since = 0;
				else if (!since) since = t;
				else if (t - since > 350) {
					carry += (speed * dt) / 1000;
					const step = Math.trunc(carry);
					carry -= step;
					el.scrollTop += step;
					dragTo(d.cx, d.cy);
				}
			}
		};
		// A timer, not animation frames, so the pace is the same however busy the page is.
		const timer = setInterval(tick, 16);
		return () => clearInterval(timer);
	});

	// Fingers: hold a block or a task for a moment to lift it, then drag; a
	// quick swipe still scrolls. The bottom of a block resizes it.
	let root = $state<HTMLElement>();
	$effect(() => {
		const el = root;
		if (!el) return;
		let hold: ReturnType<typeof setTimeout> | null = null;
		let from: { x: number; y: number } | null = null;
		const cancelHold = () => {
			if (hold) clearTimeout(hold);
			hold = null;
		};
		const touchstart = (e: TouchEvent) => {
			cancelHold();
			const t = e.touches[0];
			const target = (e.target as Element).closest<HTMLElement>('[data-drag]');
			if (e.touches.length !== 1 || !t || !target) return;
			from = { x: t.clientX, y: t.clientY };
			const key = target.dataset.key!;
			hold = setTimeout(() => {
				hold = null;
				if (!from) return;
				if (target.dataset.drag === 'place') {
					const item = plan.unplanned.find((i) => keyOf(i) === key);
					if (!item) return;
					startDrag('place', key, 0, lengthOf(item), from.x, from.y, true);
				} else {
					const b = plan.blocks.find((x) => x.key === key);
					if (!b || b.source === 'appointment') return;
					const r = target.getBoundingClientRect();
					const mode = from.y > r.bottom - 16 ? 'resize' : 'move';
					startDrag(mode, key, b.start, b.end, from.x, from.y, true);
				}
				picked = null;
				navigator.vibrate?.(12);
			}, 280);
		};
		const touchmove = (e: TouchEvent) => {
			const t = e.touches[0];
			if (!t) return;
			if (drag?.touch) {
				// Lifted: the finger drags it, not the page.
				e.preventDefault();
				dragTo(t.clientX, t.clientY);
				return;
			}
			if (from && Math.hypot(t.clientX - from.x, t.clientY - from.y) > 10) cancelHold();
		};
		const touchend = () => {
			cancelHold();
			from = null;
			if (drag?.touch) endDrag();
		};
		el.addEventListener('touchstart', touchstart, { passive: true });
		el.addEventListener('touchmove', touchmove, { passive: false });
		el.addEventListener('touchend', touchend);
		el.addEventListener('touchcancel', touchend);
		return () => {
			cancelHold();
			el.removeEventListener('touchstart', touchstart);
			el.removeEventListener('touchmove', touchmove);
			el.removeEventListener('touchend', touchend);
			el.removeEventListener('touchcancel', touchend);
		};
	});

	/** A block where it's drawn: being dragged, or as written. */
	const shown = (b: PlanBlock) =>
		drag && drag.moved && drag.key === b.key && drag.mode !== 'place'
			? { start: drag.start, end: drag.end }
			: b;

	function onBlockKey(e: KeyboardEvent, b: PlanBlock) {
		const step = e.shiftKey ? 'stretch' : 'nudge';
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const by = e.key === 'ArrowUp' ? -SNAP : SNAP;
			if (step === 'stretch') stretch(b, by);
			else nudge(b, by);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			app.headingSheet = { path: b.item.file, pos: b.item.pos };
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			unplan(b);
		} else if (e.key === 'Escape') picked = null;
	}

	// ---- now, and where the day opens ----
	let now = $state(toMinutes(localNow().time));
	$effect(() => {
		const t = setInterval(() => (now = toMinutes(localNow().time)), 60_000);
		return () => clearInterval(t);
	});
	$effect(() => {
		void date;
		const el = scroller;
		if (!el) return;
		const focus = date === today ? now - 60 : toMinutes(app.workHours.start) - 30;
		// Open on a whole hour, so its label shows.
		el.scrollTop = Math.max(0, px(Math.floor(focus / 60) * 60));
	});
	// A newly picked task offers the next quarter hour (or the start of the
	// working day); only then, so a time being typed isn't overwritten.
	let offeredFor: string | null = null;
	$effect(() => {
		const key = picked?.kind === 'tray' ? picked.key : null;
		if (key === offeredFor) return;
		offeredFor = key;
		if (!key) return;
		const start = toMinutes(app.workHours.start);
		placeAt = fromMinutes(
			snap(
				date === today
					? Math.max(
							untrack(() => now),
							start,
						)
					: start,
			),
		);
	});

	const hoursList = Array.from({ length: LAST_HOUR - FIRST_HOUR }, (_, i) => FIRST_HOUR + i);
	const work = $derived({
		top: px(toMinutes(app.workHours.start)),
		bottom: px(toMinutes(app.workHours.end)),
	});
	const timeOf = (b: { start: number; end: number }) =>
		`${fromMinutes(b.start)}–${fromMinutes(b.end)}`;
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} />

{#if drag?.moved && drag.mode === 'place' && !drag.overLine}
	{@const item = plan.unplanned.find((i) => keyOf(i) === drag!.key)}
	{#if item}
		<div class="float" style:left="{drag.cx}px" style:top="{drag.cy}px" aria-hidden="true">
			{item.title}
		</div>
	{/if}
{/if}

<div class="planner" class:dragging={drag?.moved} bind:this={root}>
	<nav class="day-nav" aria-label="Day">
		<button
			type="button"
			class="btn small icon-only"
			aria-label="Previous day"
			onclick={() => (date = addDays(date, -1))}><Icon name="chevronLeft" size={16} /></button
		>
		<span class="day-label" aria-live="polite">{label}</span>
		<button
			type="button"
			class="btn small icon-only"
			aria-label="Next day"
			onclick={() => (date = addDays(date, 1))}><Icon name="chevronRight" size={16} /></button
		>
		{#if date !== today}<button type="button" class="btn small" onclick={() => (date = today)}
				>Today</button
			>{/if}
	</nav>
	<p class="totals" role="status">
		Planned <strong>{hours(totals.planned)}</strong> · free <strong>{hours(totals.free)}</strong>
		between
		{app.workHours.start} and {app.workHours.end}
	</p>

	{#if plan.allDay.length}
		<ul class="all-day" aria-label="All day">
			<li class="lbl" aria-hidden="true">All day</li>
			{#each plan.allDay as i (keyOf(i))}<li>{i.title}</li>{/each}
		</ul>
	{/if}

	<div class="body">
		<section
			class="tray"
			class:drop={drag?.overTray && drag.mode === 'move'}
			bind:this={tray}
			aria-labelledby="tray-h"
		>
			<h2 id="tray-h">To plan <span class="count">{plan.unplanned.length}</span></h2>
			{#if plan.unplanned.length}
				<ul>
					{#each plan.unplanned as i (keyOf(i))}
						<li>
							<button
								type="button"
								class="task"
								aria-pressed={picked?.kind === 'tray' && picked.key === keyOf(i)}
								data-drag="place"
								data-key={keyOf(i)}
								class:lifted={drag?.moved && drag.key === keyOf(i)}
								onpointerdown={(e) => beginDrag(e, 'place', keyOf(i), 0, lengthOf(i))}
								onclick={() =>
									!justDragged &&
									(picked =
										picked?.kind === 'tray' && picked.key === keyOf(i)
											? null
											: { kind: 'tray', key: keyOf(i) })}
							>
								<span class="t">{i.title}</span>
								<span class="len">{hours(lengthOf(i))}</span>
							</button>
						</li>
					{/each}
				</ul>
				<p class="hint">Hold a task and drag it onto the day, or pick it and tap a time.</p>
			{:else}
				<p class="hint">Nothing left to plan on this day.</p>
			{/if}
		</section>

		<div class="day">
			{#if pickedTray}
				<form
					class="toolbar"
					onsubmit={(e) => {
						e.preventDefault();
						place(pickedTray, toMinutes(placeAt));
					}}
				>
					<span class="what">Plan “{pickedTray.title}” at</span>
					<label class="sr-only" for="dp-at">Start time</label>
					<input id="dp-at" type="time" step="900" class="input" bind:value={placeAt} />
					<button type="submit" class="btn small primary">Plan</button>
					<button type="button" class="btn small" onclick={() => (picked = null)}>Cancel</button>
				</form>
			{:else if pickedBlock}
				{@const b = pickedBlock}
				<div class="toolbar" role="toolbar" aria-label={`“${b.item.title}”, ${timeOf(b)}`}>
					<span class="what">{b.item.title} · {timeOf(b)}</span>
					{#if b.source !== 'appointment'}
						<button type="button" class="btn small" onclick={() => nudge(b, -SNAP)}>Earlier</button>
						<button type="button" class="btn small" onclick={() => nudge(b, SNAP)}>Later</button>
						<button type="button" class="btn small" onclick={() => stretch(b, -SNAP)}
							>Shorter</button
						>
						<button type="button" class="btn small" onclick={() => stretch(b, SNAP)}>Longer</button>
						<button type="button" class="btn small" onclick={() => unplan(b)}>No time</button>
					{/if}
					<button
						type="button"
						class="btn small"
						onclick={() => (app.headingSheet = { path: b.item.file, pos: b.item.pos })}>Edit</button
					>
					<button
						type="button"
						class="btn small icon-only"
						aria-label="Close"
						onclick={() => (picked = null)}><Icon name="close" size={14} /></button
					>
				</div>
			{/if}

			<div class="scroller" bind:this={scroller}>
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div
					class="line"
					class:placing={!!pickedTray}
					bind:this={line}
					style:height="{(LAST_HOUR - FIRST_HOUR) * HOUR_PX}px"
					onclick={onTimelineClick}
				>
					<div
						class="work"
						style:top="{work.top}px"
						style:height="{Math.max(0, work.bottom - work.top)}px"
					></div>
					{#each hoursList as h (h)}
						<div class="hour" style:top="{(h - FIRST_HOUR) * HOUR_PX}px">
							<span>{String(h).padStart(2, '0')}:00</span>
						</div>
					{/each}
					{#if date === today && now >= FIRST_HOUR * 60}
						<div class="now" style:top="{px(now)}px" aria-hidden="true"></div>
					{/if}
					{#if drag?.moved && drag.mode === 'place' && drag.overLine}
						<div
							class="block ghost"
							style:top="{px(drag.start)}px"
							style:height="{(drag.length / 60) * HOUR_PX}px"
						>
							{fromMinutes(drag.start)}
						</div>
					{/if}
					{#each plan.blocks as b (b.key)}
						{@const s = shown(b)}
						<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
						<div
							class="block"
							class:fixed={b.source === 'appointment'}
							class:short={s.end - s.start < 45}
							class:deadline={b.source === 'DEADLINE'}
							class:active={picked?.kind === 'block' && picked.key === b.key}
							role="button"
							tabindex="0"
							aria-label={`${b.item.title}, ${timeOf(s)}${b.source === 'appointment' ? ', appointment' : ''}`}
							style:top="{px(s.start)}px"
							style:height="{Math.max(20, ((s.end - s.start) / 60) * HOUR_PX - 2)}px"
							style:left="calc(3.5rem + (100% - 3.75rem) * {b.col / b.cols})"
							style:width="calc((100% - 3.75rem) / {b.cols} - 2px)"
							onpointerdown={(e) =>
								b.source !== 'appointment' && beginDrag(e, 'move', b.key, b.start, b.end)}
							data-drag="move"
							data-key={b.key}
							class:lifted={drag?.moved && drag.key === b.key}
							onclick={() => !justDragged && (picked = { kind: 'block', key: b.key })}
							onkeydown={(e) => onBlockKey(e, b)}
						>
							<span class="bt">{b.item.title}</span>
							<span class="bm">{timeOf(s)}</span>
							{#if b.source !== 'appointment'}
								<span
									class="handle"
									aria-hidden="true"
									onpointerdown={(e) => {
										e.stopPropagation();
										beginDrag(e, 'resize', b.key, b.start, b.end);
									}}
								></span>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.planner {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.planner.dragging {
		user-select: none;
		cursor: grabbing;
	}
	.day-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.day-label {
		min-width: 12rem;
		font-weight: 650;
		text-align: center;
	}
	.totals {
		margin: 0;
		color: var(--text-2);
		font-size: 0.88rem;
	}
	.all-day {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.all-day .lbl {
		padding-left: 0;
		background: none;
		color: var(--text-muted);
		font-weight: 650;
	}
	.all-day li {
		padding: 0.2rem 0.6rem;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 0.82rem;
	}
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 16rem;
		gap: 1rem;
		align-items: start;
	}
	.tray {
		order: 2;
		position: sticky;
		top: 0.5rem;
		padding: 0.75rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
	}
	.tray.drop {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.tray h2 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.count {
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.7rem;
	}
	.tray ul {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.task {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.5rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.86rem;
		font-weight: 600;
		text-align: left;
		cursor: grab;
	}
	.task,
	.block {
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
	}
	.task.lifted {
		opacity: 0.45;
	}
	.block.lifted {
		z-index: 4;
		box-shadow: var(--shadow-md);
		transform: scale(1.02);
	}
	.float {
		position: fixed;
		z-index: 50;
		max-width: 14rem;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--accent);
		border-radius: 10px;
		background: var(--surface);
		box-shadow: var(--shadow-lg);
		font-size: 0.85rem;
		font-weight: 650;
		pointer-events: none;
		transform: translate(-50%, -120%);
	}
	.task[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.len {
		flex: none;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.hint {
		margin: 0.5rem 0 0;
		color: var(--text-faint);
		font-size: 0.78rem;
	}
	.day {
		order: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--accent);
		border-radius: 12px;
		background: var(--accent-softer, var(--accent-soft));
	}
	.toolbar .what {
		flex: 1 1 100%;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.toolbar .input {
		width: auto;
	}
	.scroller {
		height: min(70vh, 40rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.line {
		position: relative;
	}
	.line.placing {
		cursor: copy;
	}
	.work {
		position: absolute;
		left: 3.5rem;
		right: 0;
		background: color-mix(in oklab, var(--accent-soft) 35%, transparent);
	}
	.hour {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--border);
	}
	.hour span {
		position: absolute;
		top: 0.15rem;
		left: 0.5rem;
		color: var(--text-faint);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.now {
		position: absolute;
		left: 3rem;
		right: 0;
		z-index: 3;
		border-top: 2px solid var(--danger);
	}
	.block {
		position: absolute;
		z-index: 2;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0.25rem 0.5rem;
		border-left: 3px solid var(--accent);
		border-radius: 8px;
		background: var(--accent-soft);
		color: var(--text);
		cursor: grab;
		touch-action: manipulation;
	}
	.block.deadline {
		border-left-color: var(--danger);
		background: var(--danger-soft);
	}
	.block.fixed {
		border-left-color: var(--text-muted);
		background: var(--surface-2);
		cursor: default;
	}
	.block.active,
	.block:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.block.ghost {
		left: 3.5rem;
		right: 0.25rem;
		border-left-style: dashed;
		opacity: 0.7;
		pointer-events: none;
		font-size: 0.78rem;
	}
	/* Under 45 minutes: title and time on one line. */
	.block.short {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0;
		padding-bottom: 0;
	}
	.block.short .bm {
		flex: none;
	}
	.bt {
		overflow: hidden;
		font-size: 0.82rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bm {
		color: var(--text-muted);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.handle {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 8px;
		cursor: ns-resize;
	}
	/* Touch: the bottom edge shows where a long press resizes. */
	@media (pointer: coarse) {
		.handle {
			left: 40%;
			right: 40%;
			bottom: 3px;
			height: 4px;
			border-radius: 999px;
			background: color-mix(in oklab, currentColor 25%, transparent);
		}
	}
	@media (max-width: 720px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
		.tray {
			order: 0;
			position: static;
		}
		.tray ul {
			flex-direction: row;
			flex-wrap: wrap;
		}
		.task {
			width: auto;
		}
		.scroller {
			height: 60vh;
		}
	}
</style>
