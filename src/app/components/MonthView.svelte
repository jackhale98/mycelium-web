<script lang="ts">
	// A month of the agenda: scheduled and due items, repeats and appointments
	// on their days. Pick a day to list it below (where dates can be changed
	// by keyboard or touch); on wider screens, drag an item to another day to
	// reschedule it (its SCHEDULED or DEADLINE moves; time and repeater stay).
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

	function shift(by: number) {
		const [y, m] = month.split('-').map(Number) as [number, number];
		const d = new Date(y, m - 1 + by, 1);
		month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
	}
	function goToday() {
		month = today.slice(0, 7);
		selected = today;
	}

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

<div class="month-view">
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
								{#if day.items.length > 3}<li class="more">+{day.items.length - 3} more</li>{/if}
							</ul>
						</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>

	<section class="group" aria-labelledby="month-day">
		<h2 id="month-day">
			{longDay(selected)}{#if selected === today}<span class="now">Today</span>{/if}<span
				class="count">{selectedDay?.items.length ?? 0}</span
			>
		</h2>
		<AgendaList
			items={selectedDay?.items ?? []}
			{today}
			empty="Nothing on this day."
			{onTop}
			grid={selected === today}
		/>
	</section>
	<p class="hint">Drag an item to another day to reschedule it, or change its date in the list.</p>
</div>

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
	/* Narrow: numbers and counts only; the day's list does the rest. */
	@media (max-width: 720px) {
		td {
			height: 3.25rem;
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
			min-height: 3.2rem;
			padding: 0.2rem 0;
			text-align: center;
		}
	}
</style>
