<script lang="ts">
	// A month of the agenda: scheduled and due items, repeats and appointments
	// on their days. Pick a day to list it below (where dates can be changed
	// by keyboard or touch); on wider screens, drag an item to another day to
	// reschedule it (its SCHEDULED or DEADLINE moves; time and repeater stay).
	// On phones the grid stays put, filling the screen, and the picked day is
	// a drawer docked above the bottom bar: tap or drag it up to see its list.
	// Swipe the grid sideways to change month.
	import { onMount } from 'svelte';
	import { cubicOut } from 'svelte/easing';
	import { fly } from 'svelte/transition';
	import { timestampDates } from '$lib/org';
	import type { AgendaItem } from '$lib/vault/vault';
	import { agendaDays, monthGrid } from '../agenda';
	import { app } from '../state.svelte';
	import AgendaList from './AgendaList.svelte';
	import Icon from './Icon.svelte';

	let {
		today,
		keep,
		onTop,
	}: {
		today: string;
		keep: (item: AgendaItem) => boolean;
		onTop: (item: AgendaItem) => void;
	} = $props();

	// svelte-ignore state_referenced_locally
	let month = $state(today.slice(0, 7));
	// svelte-ignore state_referenced_locally
	let selected = $state(today);

	const grid = $derived(monthGrid(month));
	const days = $derived.by(() => {
		void app.rev;
		return agendaDays(app.vault, grid.start, grid.end, today, keep);
	});
	const weeks = $derived(
		Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7)),
	);
	const selectedDay = $derived(days.find((d) => d.date === selected));

	const label = $derived(
		new Date(`${month}-01T12:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
	);
	// Monday to Sunday, in the reader's language (26 October 2026 was a Monday).
	const WEEKDAYS = Array.from({ length: 7 }, (_, i) =>
		new Date(2026, 9, 26 + i, 12).toLocaleDateString(undefined, { weekday: 'short' }),
	);
	const dayNumber = (date: string) => Number(date.slice(8));
	const longDay = (date: string) =>
		new Date(`${date}T12:00`).toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
		});

	/** Which way the last month change went: 1 later, -1 earlier (the slide's direction). */
	let dir = $state<1 | -1>(1);
	function go(target: string) {
		if (target === month) return;
		// 'YYYY-MM' strings order like months.
		dir = target > month ? 1 : -1;
		month = target;
	}
	function shift(by: number) {
		const [y, m] = month.split('-').map(Number) as [number, number];
		const d = new Date(y, m - 1 + by, 1);
		const target = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		go(target);
		// The day shown follows the month: today in its own month, else the 1st.
		selected = target === today.slice(0, 7) ? today : `${target}-01`;
	}
	function goToday() {
		go(today.slice(0, 7));
		selected = today;
	}

	// The month slides in from the side it comes from; the one leaving goes
	// out the other way and can't be clicked meanwhile.
	const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	const slide = (node: Element, side: 1 | -1) =>
		fly(node, {
			x: `${side * dir * 100}%`,
			opacity: 1,
			duration: reduced() ? 0 : 260,
			easing: cubicOut,
		});
	const retire = (e: Event) => ((e.currentTarget as HTMLElement).inert = true);

	// ---- phones: a stationary grid and the day drawer ----
	const PHONE = '(max-width: 720px)';
	let phone = $state(false);
	let expanded = $state(false);
	let view = $state<HTMLElement>();
	let drawer = $state<HTMLElement>();
	let handle = $state<HTMLElement>();
	let listEl = $state<HTMLElement>();
	/** The grid's top in the page, and the bottom bar's height (measured). */
	let top = $state(0);
	let barH = $state(64);
	function measure() {
		const grid = view?.querySelector('.grid-wrap');
		if (grid) top = Math.round(grid.getBoundingClientRect().top + window.scrollY);
		const bar = document.querySelector<HTMLElement>('nav[aria-label="Quick navigation"]');
		barH = bar && bar.offsetHeight ? bar.offsetHeight : 0;
	}
	onMount(() => {
		const mq = matchMedia(PHONE);
		phone = mq.matches;
		const change = () => {
			phone = mq.matches;
			if (!phone) expanded = false;
			measure();
		};
		mq.addEventListener('change', change);
		measure();
		// What's above the grid (filters opening, a notice) moves it.
		const ro = new ResizeObserver(measure);
		const page = view?.closest('.agenda-page') ?? view?.parentElement;
		if (page) ro.observe(page);
		window.addEventListener('resize', measure);
		void document.fonts?.ready.then(measure);
		return () => {
			mq.removeEventListener('change', change);
			ro.disconnect();
			window.removeEventListener('resize', measure);
		};
	});
	// A new day starts at the top of its list.
	$effect(() => {
		void selected;
		if (listEl) listEl.scrollTop = 0;
	});
	// While the drawer is open the page behind it stays still.
	$effect(() => {
		if (!phone || !expanded) return;
		const root = document.documentElement;
		const { overflow, overscrollBehavior } = root.style;
		const bodyOverflow = document.body.style.overflow;
		root.style.overflow = 'hidden';
		root.style.overscrollBehavior = 'none';
		document.body.style.overflow = 'hidden';
		return () => {
			root.style.overflow = overflow;
			root.style.overscrollBehavior = overscrollBehavior;
			document.body.style.overflow = bodyOverflow;
		};
	});
	// Pulling the open list down from its top drags the drawer closed; any
	// other touch scrolls the list. Touch events, as only they can stop the
	// scroll once the pull has begun.
	$effect(() => {
		const el = listEl;
		if (!el) return;
		let start: { y: number; t: number } | null = null;
		let pulling = false;
		const touchstart = (e: TouchEvent) => {
			pulling = false;
			start =
				expanded && e.touches.length === 1 && el.scrollTop <= 0
					? { y: e.touches[0]!.clientY, t: e.timeStamp }
					: null;
		};
		const touchmove = (e: TouchEvent) => {
			if (!start) return;
			const y = e.touches[0]!.clientY;
			if (!pulling) {
				const dy = y - start.y;
				if (dy < -6 || el.scrollTop > 0) start = null; // scrolling the list
				if (dy < 6 || !start) return;
				pulling = true;
				beginDrag(start.y, start.t);
			}
			e.preventDefault();
			moveDrag(y);
		};
		const touchend = (e: TouchEvent) => {
			if (pulling) {
				if (e.type === 'touchcancel') dragCancel();
				else endDrag(e.changedTouches[0]!.clientY, e.timeStamp);
			}
			start = null;
			pulling = false;
		};
		el.addEventListener('touchstart', touchstart, { passive: true });
		el.addEventListener('touchmove', touchmove, { passive: false });
		el.addEventListener('touchend', touchend);
		el.addEventListener('touchcancel', touchend);
		return () => {
			el.removeEventListener('touchstart', touchstart);
			el.removeEventListener('touchmove', touchmove);
			el.removeEventListener('touchend', touchend);
			el.removeEventListener('touchcancel', touchend);
		};
	});

	// Swiping the grid sideways changes month; the click that ends a swipe is swallowed.
	let swipe: { x: number; y: number; done: boolean } | null = null;
	let swallow = false;
	function swipeDown(e: PointerEvent) {
		swallow = false;
		swipe = phone && e.isPrimary ? { x: e.clientX, y: e.clientY, done: false } : null;
	}
	function swipeMove(e: PointerEvent) {
		if (!swipe || swipe.done) return;
		const dx = e.clientX - swipe.x;
		const dy = e.clientY - swipe.y;
		if (Math.abs(dx) > 48 && Math.abs(dx) > 1.5 * Math.abs(dy)) {
			swipe.done = true;
			swallow = true;
			shift(dx < 0 ? 1 : -1);
		}
	}
	function swipeClick(e: MouseEvent) {
		if (!swallow) return;
		swallow = false;
		e.stopPropagation();
		e.preventDefault();
	}

	// The drawer follows a drag of its header; far or fast enough toggles it,
	// and a tap toggles it too.
	let dragY = $state<number | null>(null);
	let drag: { y: number; t: number; base: number; max: number; moved: boolean } | null = null;
	const collapsedH = () =>
		parseFloat(getComputedStyle(drawer!).getPropertyValue('--col-h')) *
			parseFloat(getComputedStyle(document.documentElement).fontSize) || 104;
	function beginDrag(y: number, t: number) {
		if (!drawer) return;
		const max = drawer.offsetHeight - collapsedH();
		drag = { y, t, base: expanded ? 0 : max, max, moved: false };
	}
	function moveDrag(y: number) {
		if (!drag) return;
		const dy = y - drag.y;
		if (!drag.moved && Math.abs(dy) < 6) return;
		drag.moved = true;
		dragY = Math.min(drag.max, Math.max(0, drag.base + dy));
	}
	/** Ends a drag, toggling if it went far or fast enough; false when it never moved (a tap). */
	function endDrag(y: number, t: number): boolean {
		if (!drag) return false;
		const dy = y - drag.y;
		const fast = Math.abs(dy) / Math.max(1, t - drag.t) > 0.5;
		const moved = drag.moved;
		drag = null;
		dragY = null;
		if (moved && (expanded ? dy > (fast ? 12 : 60) : dy < -(fast ? 12 : 60))) expanded = !expanded;
		return moved;
	}
	function dragStart(e: PointerEvent) {
		if (!e.isPrimary) return;
		beginDrag(e.clientY, e.timeStamp);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	}
	const dragMove = (e: PointerEvent) => moveDrag(e.clientY);
	function dragEnd(e: PointerEvent) {
		// A tap anywhere on the header toggles.
		if (drag && !endDrag(e.clientY, e.timeStamp)) expanded = !expanded;
	}
	function dragCancel() {
		drag = null;
		dragY = null;
	}
	function onHandleClick(e: MouseEvent) {
		// Enter, Space or assistive tech (detail 0); pointer taps end in dragEnd.
		if (e.detail === 0) expanded = !expanded;
	}
	function onwindowkey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !expanded || !phone) return;
		if (document.querySelector('dialog[open]')) return;
		e.preventDefault();
		expanded = false;
		if (drawer?.contains(document.activeElement)) handle?.focus();
	}
	/** The collapsed drawer's one line about the day. */
	const preview = $derived.by(() => {
		const items = selectedDay?.items ?? [];
		const first = items[0];
		if (!first) return 'Nothing on this day';
		const t = time(first, selected);
		return `${t ? `${t} ` : ''}${plain(first.title)}${items.length > 1 ? `, +${items.length - 1} more` : ''}`;
	});

	/** Which planning stamp puts an item on `date` (for moving it), if any. */
	function stampOn(item: AgendaItem, date: string): 'SCHEDULED' | 'DEADLINE' | null {
		if (item.scheduled?.active && timestampDates(item.scheduled, date, date).length)
			return 'SCHEDULED';
		if (item.deadline?.active && timestampDates(item.deadline, date, date).length)
			return 'DEADLINE';
		return null;
	}

	let dragging = $state<{ item: AgendaItem; kind: 'SCHEDULED' | 'DEADLINE' } | null>(null);
	let over = $state<string | null>(null);

	function drop(date: string) {
		const d = dragging;
		dragging = null;
		over = null;
		if (!d) return;
		const ts = d.kind === 'SCHEDULED' ? d.item.scheduled : d.item.deadline;
		if (!ts || ts.date === date) return;
		app.setPlanningDate(d.item.file, d.item.pos, d.kind, ts.time ? `${date}T${ts.time}` : date);
		selected = date;
	}

	const time = (item: AgendaItem, date: string) => {
		const k = stampOn(item, date);
		return (k === 'SCHEDULED' ? item.scheduled : k === 'DEADLINE' ? item.deadline : null)?.time;
	};
	const plain = (title: string) => title.replace(/<[^>]*>/g, '').trim() || title;
</script>

<svelte:window onkeydown={onwindowkey} />

<div class="month-view" class:phone bind:this={view} style:--top="{top}px" style:--bar-h="{barH}px">
	<nav class="month-nav" aria-label="Month">
		<button
			type="button"
			class="btn small icon-only"
			aria-label="Previous month"
			onclick={() => shift(-1)}><Icon name="chevronLeft" size={16} /></button
		>
		<span class="month-label" aria-live="polite">{label}</span>
		<button
			type="button"
			class="btn small icon-only"
			aria-label="Next month"
			onclick={() => shift(1)}><Icon name="chevronRight" size={16} /></button
		>
		{#if month !== today.slice(0, 7) || selected !== today}
			<button type="button" class="btn small" onclick={goToday}>Today</button>
		{/if}
	</nav>

	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="grid-wrap"
		inert={phone && expanded}
		onpointerdown={swipeDown}
		onpointermove={swipeMove}
		onpointerup={() => (swipe = null)}
		onpointercancel={() => (swipe = null)}
		onclickcapture={swipeClick}
	>
		{#key month}
			<div class="month-panel" in:slide={1} out:slide={-1} onoutrostart={retire}>
				<table class="grid">
					<caption class="sr-only">{label}: pick a day to see its items below</caption>
					<thead>
						<tr
							>{#each WEEKDAYS as w (w)}<th scope="col">{w}</th>{/each}</tr
						>
					</thead>
					<tbody>
						{#each weeks as week (week[0]!.date)}
							<tr>
								{#each week as day (day.date)}
									<td
										class:other={!day.date.startsWith(month)}
										class:today={day.date === today}
										class:selected={day.date === selected}
										class:over={over === day.date}
										ondragover={(e) => {
											if (!dragging) return;
											e.preventDefault();
											over = day.date;
										}}
										ondragleave={() => over === day.date && (over = null)}
										ondrop={(e) => {
											e.preventDefault();
											drop(day.date);
										}}
									>
										<button
											type="button"
											class="day"
											aria-pressed={day.date === selected}
											aria-label={`${longDay(day.date)}${day.date === today ? ', today' : ''}: ${day.items.length} item${day.items.length === 1 ? '' : 's'}`}
											onclick={() => (selected = day.date)}
											><span class="num">{dayNumber(day.date)}</span>{#if day.items.length}<span
													class="count">{day.items.length}</span
												>{/if}</button
										>
										<ul class="chips" aria-hidden="true">
											{#each day.items.slice(0, 3) as item (`${item.file}:${item.pos}`)}
												{@const kind = stampOn(item, day.date)}
												<li
													class:deadline={kind === 'DEADLINE'}
													draggable={kind !== null}
													data-file={item.file}
													data-pos={item.pos}
													data-kind={kind ?? ''}
													ondragstart={(e) => {
														// Which item, from the element itself.
														const el = e.currentTarget as HTMLElement;
														const found = day.items.find(
															(i) => i.file === el.dataset.file && String(i.pos) === el.dataset.pos,
														);
														const k = el.dataset.kind as 'SCHEDULED' | 'DEADLINE' | '';
														if (!found || !k) return;
														dragging = { item: found, kind: k };
														e.dataTransfer?.setData('text/plain', found.title);
													}}
													ondragend={() => {
														dragging = null;
														over = null;
													}}
												>
													{#if time(item, day.date)}<span class="t">{time(item, day.date)}</span
														>{/if}{plain(item.title)}
												</li>
											{/each}
											{#if day.items.length > 3}<li class="more">
													+{day.items.length - 3} more
												</li>{/if}
										</ul>
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/key}
	</div>

	{#if phone}
		{#if expanded}
			<!-- A tap outside closes it; the handle, Escape and a pull down do too. -->
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div class="scrim" onclick={() => (expanded = false)}></div>
		{/if}
		<section
			class="drawer"
			class:open={expanded}
			class:dragging={dragY !== null}
			style:transform={dragY !== null ? `translateY(${dragY}px)` : undefined}
			style:--bar-h="{barH}px"
			bind:this={drawer}
			aria-label="Selected day"
		>
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="dhead"
				onpointerdown={dragStart}
				onpointermove={dragMove}
				onpointerup={dragEnd}
				onpointercancel={dragCancel}
			>
				<button
					type="button"
					class="grab"
					bind:this={handle}
					aria-expanded={expanded}
					aria-controls="month-day-list"
					aria-label="Day details"
					onclick={onHandleClick}><span class="handle"></span></button
				>
				{@render heading()}
				{#if !expanded}<p class="preview">{preview}</p>{/if}
			</div>
			<div
				id="month-day-list"
				class="dlist"
				role="region"
				aria-labelledby="month-day"
				inert={!expanded}
				bind:this={listEl}
			>
				{@render list()}
			</div>
		</section>
	{:else}
		<section class="group" aria-labelledby="month-day">
			{@render heading()}
			{@render list()}
		</section>
		<p class="hint">
			Drag an item to another day to reschedule it, or change its date in the list.
		</p>
	{/if}
</div>

{#snippet heading()}
	<h2 id="month-day">
		{longDay(selected)}{#if selected === today}<span class="now">Today</span>{/if}<span
			class="count">{selectedDay?.items.length ?? 0}</span
		>
	</h2>
{/snippet}

{#snippet list()}
	<AgendaList
		items={selectedDay?.items ?? []}
		{today}
		empty="Nothing on this day."
		{onTop}
		grid={selected === today}
	/>
{/snippet}

<style>
	.month-view {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}
	.month-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.5rem;
	}
	.month-label {
		min-width: 9.5rem;
		font-weight: 650;
		text-align: center;
	}
	.grid-wrap {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		overflow: hidden;
	}
	.month-panel {
		grid-area: 1 / 1;
		min-width: 0;
		min-height: 0;
	}
	.grid {
		width: 100%;
		border-collapse: collapse;
		table-layout: fixed;
	}
	th {
		padding: 0.3rem 0;
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	td {
		height: 6.5rem;
		padding: 0;
		border: 1px solid var(--border);
		vertical-align: top;
	}
	td.other {
		background: color-mix(in oklab, var(--surface-2) 45%, transparent);
	}
	td.other .num {
		color: var(--text-faint);
	}
	td.selected {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	td.over {
		background: var(--accent-soft);
	}
	.day {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.25rem 0.4rem;
		border: 0;
		background: none;
		color: var(--text);
		font-size: 0.82rem;
		text-align: left;
	}
	td.today .num {
		display: inline-grid;
		place-items: center;
		min-width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 700;
	}
	h2 .count {
		margin-left: 0.5rem;
	}
	.count {
		color: var(--text-faint);
		font-size: 0.72rem;
		font-weight: 650;
	}
	.chips {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0 0.25rem 0.25rem;
		list-style: none;
	}
	.chips li {
		overflow: hidden;
		padding: 1px 0.35rem;
		border-radius: 5px;
		background: var(--surface-2);
		font-size: 0.72rem;
		line-height: 1.4;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chips li[draggable='true'] {
		cursor: grab;
	}
	.chips li.deadline {
		background: var(--danger-soft);
	}
	.chips .t {
		margin-right: 0.3rem;
		color: var(--text-muted);
		font-variant-numeric: tabular-nums;
	}
	.chips .more {
		background: none;
		color: var(--text-muted);
	}
	.now {
		margin-left: 0.5rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 0.72rem;
	}
	.hint {
		margin: 0;
		color: var(--text-faint);
		font-size: 0.8rem;
	}
	.drawer {
		display: none;
	}
	/* Narrow: numbers and counts only; the day's list does the rest. */
	@media (max-width: 720px) {
		td {
			height: auto;
		}
		.chips,
		.hint {
			display: none;
		}
		.day {
			flex-direction: column;
			justify-content: center;
			gap: 0.1rem;
			height: 100%;
			min-height: 2.75rem;
			padding: 0.2rem 0;
			text-align: center;
		}
		/* A stationary page: the grid fills what lies between its top and the
		   docked drawer, so nothing scrolls. --top and --bar-h are measured. */
		.month-view.phone {
			--col-h: 6.5rem;
			--gap: 0.5rem;
			/* Room for the drawer and the bottom bar, less the 4.5rem the app
			   already leaves under every page for that bar. */
			padding-bottom: calc(var(--col-h) + var(--bar-h) + var(--gap) - 4.5rem);
		}
		.phone .grid-wrap {
			height: max(17rem, calc(100dvh - var(--top) - var(--col-h) - var(--bar-h) - var(--gap)));
			/* Swipes sideways are the grid's (month to month). */
			touch-action: pan-y;
		}
		.phone .month-panel,
		.phone .grid {
			height: 100%;
		}
		.scrim {
			position: fixed;
			inset: 0;
			z-index: 19;
			background: rgb(0 0 0 / 0.25);
			animation: fade 0.2s ease;
		}
		@keyframes fade {
			from {
				opacity: 0;
			}
		}
		.drawer {
			--col-h: 6.5rem;
			position: fixed;
			z-index: 20;
			left: 0;
			right: 0;
			bottom: var(--bar-h);
			display: flex;
			flex-direction: column;
			height: calc(100dvh - var(--bar-h) - 4rem);
			border-top: 1px solid var(--border);
			border-radius: 18px 18px 0 0;
			background: var(--bg-raised);
			box-shadow: 0 -6px 24px rgb(0 0 0 / 0.12);
			transform: translateY(calc(100% - var(--col-h)));
			transition: transform 200ms ease;
			will-change: transform;
		}
		.drawer.open {
			transform: none;
		}
		.drawer.dragging {
			transition: none;
		}
		.dhead {
			flex: none;
			box-sizing: border-box;
			height: var(--col-h);
			padding: 0 1rem;
			touch-action: none;
			cursor: grab;
			user-select: none;
		}
		.drawer.open .dhead {
			height: auto;
			padding-bottom: 0.25rem;
		}
		.dhead h2 {
			margin: 0;
			padding: 0;
			border: 0;
			overflow: hidden;
			font-size: 1.05rem;
			white-space: nowrap;
		}
		.grab {
			display: grid;
			place-items: center;
			width: 100%;
			height: 2rem;
			padding: 0;
			border: 0;
			background: none;
			cursor: inherit;
		}
		.grab:focus-visible {
			outline: 2px solid var(--accent);
			outline-offset: -2px;
			border-radius: 10px;
		}
		.handle {
			width: 2.5rem;
			height: 5px;
			border-radius: 3px;
			background: var(--text-faint);
			opacity: 0.6;
		}
		.preview {
			margin: 0.35rem 0 0;
			overflow: hidden;
			color: var(--text-2);
			font-size: 0.9rem;
			text-overflow: ellipsis;
			white-space: nowrap;
		}
		.dlist {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			overscroll-behavior: contain;
			/* clear of the bottom bar's raised search button */
			padding: 0 1rem 2.5rem;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.drawer {
			transition: none;
		}
	}
</style>
