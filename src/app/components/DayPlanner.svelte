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
		if ((e.target as Element).closest('.block')) return;
		if (pickedTray) place(pickedTray, minutesAt(e.clientY));
		else picked = null;
	}

	// ---- dragging with a mouse ----
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
		moved: boolean;
		overTray: boolean;
		overLine: boolean;
	};
	let drag = $state<Drag | null>(null);

	function beginDrag(e: PointerEvent, mode: Drag['mode'], key: string, start: number, end: number) {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		const at = line ? minutesAt(e.clientY) : start;
		drag = {
			mode,
			key,
			grip: mode === 'move' ? at - start : 0,
			length: end - start,
			start,
			end,
			x: e.clientX,
			y: e.clientY,
			moved: false,
			overTray: false,
			overLine: false,
		};
	}
	function onPointerMove(e: PointerEvent) {
		const d = drag;
		if (!d || !line) return;
		if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
		d.moved = true;
		const lr = line.getBoundingClientRect();
		d.overLine = e.clientX >= lr.left && e.clientX <= lr.right;
		const tr = tray?.getBoundingClientRect();
		d.overTray =
			!!tr &&
			e.clientX >= tr.left &&
			e.clientX <= tr.right &&
			e.clientY >= tr.top &&
			e.clientY <= tr.bottom;
		const at = minutesAt(e.clientY);
		if (d.mode === 'resize') d.end = Math.max(d.start + SNAP, Math.min(24 * 60 - 1, snap(at)));
		else {
			d.start = Math.max(FIRST_HOUR * 60, Math.min(24 * 60 - 1 - d.length, snap(at - d.grip)));
			d.end = d.start + d.length;
		}
		drag = { ...d };
	}
	function onPointerUp() {
		const d = drag;
		drag = null;
		if (!d) return;
		if (!d.moved) return;
		if (d.mode === 'place') {
			const item = plan.unplanned.find((i) => keyOf(i) === d.key);
			if (item && d.overLine) place(item, d.start);
			return;
		}
		const b = plan.blocks.find((x) => x.key === d.key);
		if (!b) return;
		if (d.mode === 'move' && d.overTray) return unplan(b);
		move(b, d.start, d.end);
	}

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

<div class="planner" class:dragging={drag?.moved}>
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
								onpointerdown={(e) => beginDrag(e, 'place', keyOf(i), 0, lengthOf(i))}
								onclick={() =>
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
				<p class="hint">Pick a task, then a time on the day. With a mouse, drag it there.</p>
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
							onclick={() => (picked = { kind: 'block', key: b.key })}
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
