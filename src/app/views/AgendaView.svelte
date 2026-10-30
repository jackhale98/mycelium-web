<script lang="ts">
	import DayPlanner from '../components/DayPlanner.svelte';
	import QuickAddBar from '../components/QuickAddBar.svelte';
	import { SWIPE_LABELS } from '../swipe';
	import type { AgendaItem } from '$lib/vault/vault';
	import AgendaFilters from '../components/AgendaFilters.svelte';
	import AgendaList from '../components/AgendaList.svelte';
	import ClockReport from '../components/ClockReport.svelte';
	import SavedViews from '../components/SavedViews.svelte';
	import {
		activeFilters,
		weekAgenda,
		weekStart,
		stuckProjects,
		stuckSettingsOf,
		compileFilter,
		decodeFilter,
		emptyFilter,
		encodeFilter,
		groupAgenda,
		type AgendaFilter,
	} from '../agenda';
	import { href } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import { usePane } from '../panes.svelte';
	import { longDate } from '../util';
	import { addDays } from '$lib/org';
	import Icon from '../components/Icon.svelte';
	import StuckEditor from '../components/StuckEditor.svelte';
	import MonthView from '../components/MonthView.svelte';
	import BoardView from '../components/BoardView.svelte';
	import { untrack } from 'svelte';

	let { query = '' }: { query?: string } = $props();
	const pane = usePane();

	const today = localNow().date;
	/** Touch screens, where tasks swipe. */
	const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
	const storeKey = `mycelium:agenda-filter:${app.activeId}`;

	function initial(): AgendaFilter {
		if (query) return decodeFilter(query, app.vault);
		try {
			const saved = localStorage.getItem(storeKey);
			if (saved) return decodeFilter(saved, app.vault);
		} catch {
			/* storage unavailable */
		}
		return emptyFilter();
	}
	let filter = $state<AgendaFilter>(initial());
	const encoded = $derived(encodeFilter(filter));

	// Following a link to the agenda while it's open (a saved view from the palette).
	let lastQuery = query;
	$effect(() => {
		if (query === lastQuery) return;
		lastQuery = query;
		if (query !== untrack(() => encoded)) filter = decodeFilter(query, app.vault);
	});

	// Keep the address bar and this browser's memory in step with the filters.
	$effect(() => {
		const q = encoded;
		const hash = href.agenda(q);
		pane.replace(hash);
		try {
			if (q) localStorage.setItem(storeKey, q);
			else localStorage.removeItem(storeKey);
		} catch {
			/* per session only */
		}
	});

	const compiled = $derived.by(() => {
		void app.rev;
		try {
			return { keep: compileFilter(filter, app.vault, localNow()), error: null };
		} catch (e) {
			return { keep: () => true, error: e instanceof Error ? e.message : String(e) };
		}
	});

	const all = $derived.by(() => {
		void app.rev;
		return app.vault.agenda();
	});
	const tagOptions = $derived([...new Set(all.flatMap((i) => i.tags))].sort());
	/** org's default category is the file name; show such categories by note title. */
	const categoryLabels = $derived.by(() => {
		const labels: Record<string, string> = {};
		for (const i of all) {
			const base = (i.file.split('/').pop() ?? i.file).replace(/\.org$/i, '');
			labels[i.category] ??=
				i.category === base ? (app.vault.fileNode(i.file)?.title ?? i.category) : i.category;
		}
		return labels;
	});
	const categoryOptions = $derived(
		[...new Set(all.map((i) => i.category))].sort((a, b) =>
			(categoryLabels[a] ?? a).localeCompare(categoryLabels[b] ?? b),
		),
	);
	const stateOptions = $derived([
		...new Set([
			...app.vault.keywords.todoKeywords,
			...app.vault.keywords.doneKeywords,
			...all.map((i) => i.todo ?? '').filter(Boolean),
		]),
	]);

	const groups = $derived.by(() => {
		void app.rev;
		return groupAgenda(app.vault, today, 7, compiled.keep);
	});
	const filtered = $derived(activeFilters(filter) > 0);

	function onTop(item: AgendaItem) {
		const head = app.vault.file(item.file)?.index.headlines.find((h) => h.pos === item.topPos);
		filter = {
			...filter,
			top: { file: item.file, pos: item.topPos, title: head?.title ?? item.title },
		};
	}

	const sections = $derived(
		[
			{ id: 'overdue', title: 'Overdue', items: groups.overdue, empty: 'Nothing overdue.' },
			{ id: 'today', title: 'Today', items: groups.today, empty: 'Nothing scheduled today.' },
			{
				id: 'upcoming',
				title: 'Next 7 days',
				items: groups.upcoming,
				empty: 'A quiet week ahead.',
			},
			{ id: 'later', title: 'Later', items: groups.later, empty: '' },
			{
				id: 'unscheduled',
				title: 'Unscheduled',
				items: groups.unscheduled,
				empty: 'Every task has a date.',
			},
			{ id: 'done', title: 'Recently done', items: groups.done.slice(0, 8), empty: '' },
		]
			.map((s) => (filtered ? { ...s, empty: 'Nothing matches the filters.' } : s))
			.filter(
				(s) => s.items.length > 0 || (s.empty && !filtered) || (filtered && s.id === 'today'),
			),
	);

	$effect(() => {
		document.title = 'Agenda · Mycelium';
	});

	// List (overdue, today, next 7 days…) or org's week view; remembered here.
	const MODE_KEY = 'mycelium:agenda-mode';
	type Mode = 'list' | 'day' | 'week' | 'month' | 'board' | 'stuck';
	const MODES: Mode[] = ['list', 'day', 'week', 'month', 'board', 'stuck'];
	const MODE_LABELS: Record<Mode, string> = {
		list: 'List',
		day: 'Plan',
		week: 'Week',
		month: 'Month',
		board: 'Board',
		stuck: 'Stuck',
	};
	let mode = $state<Mode>(
		(() => {
			try {
				const m = localStorage.getItem(MODE_KEY);
				return MODES.includes(m as Mode) ? (m as Mode) : 'list';
			} catch {
				return 'list';
			}
		})(),
	);
	function setMode(m: Mode) {
		mode = m;
		try {
			localStorage.setItem(MODE_KEY, m);
		} catch {
			// Not remembered: fine.
		}
	}
	let start = $state(weekStart(localNow().date));

	// Stuck projects (org's C-c a #): this vault's definition, or org's default.
	const stuckSettings = $derived(stuckSettingsOf(app.activeVault?.stuckProjects));
	const stuck = $derived.by(() => {
		void app.rev;
		if (mode !== 'stuck') return { items: [], error: null };
		try {
			return {
				items: stuckProjects(app.vault, stuckSettings, localNow()).filter(compiled.keep),
				error: null,
			};
		} catch (e) {
			return { items: [], error: e instanceof Error ? e.message : String(e) };
		}
	});
	const days = $derived.by(() => {
		void app.rev;
		return mode === 'week' ? weekAgenda(app.vault, start, today, compiled.keep) : [];
	});
	const dayLabel = (date: string) =>
		new Date(`${date}T12:00`).toLocaleDateString(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'short',
		});
	const weekLabel = $derived(
		`${new Date(`${start}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ${new Date(`${addDays(start, 6)}T12:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`,
	);
</script>

<div class="agenda-page" class:fit={mode === 'month'}>
	<header>
		<p class="eyebrow">{longDate(today)}</p>
		<h1>Agenda</h1>
		<div class="segmented mode" role="radiogroup" aria-label="Agenda view">
			{#each MODES as m (m)}
				<button type="button" role="radio" aria-checked={mode === m} onclick={() => setMode(m)}
					>{MODE_LABELS[m]}</button
				>
			{/each}
		</div>
	</header>
	<AgendaFilters
		bind:filter
		tags={tagOptions}
		states={stateOptions}
		categories={categoryOptions}
		{categoryLabels}
		error={compiled.error}
	>
		<SavedViews query={encoded} onpick={(v) => (filter = decodeFilter(v.query, app.vault))} />
	</AgendaFilters>
	{#if touch && !app.swipeHintSeen && (mode === 'list' || mode === 'week')}
		<p class="swipe-tip" role="note">
			<span
				><strong>Tip:</strong> swipe a task right to mark it done, or left for {app.swipeTray
					.map((c) => SWIPE_LABELS[c])
					.join(', ')} and More.</span
			>
			<button
				type="button"
				class="x"
				aria-label="Dismiss tip"
				onclick={() => app.dismissSwipeHint()}><Icon name="close" size={14} /></button
			>
		</p>
	{/if}
	{#if mode !== 'stuck'}<QuickAddBar />{/if}
	{#if mode === 'stuck'}
		<section class="group" aria-labelledby="ag-stuck">
			<h2 id="ag-stuck">Stuck projects<span class="count">{stuck.items.length}</span></h2>
			<p class="stuck-hint">
				Projects: headings matching <code>{stuckSettings.match}</code>. Stuck when nothing under
				them is {stuckSettings.keywords.join(', ') || 'in any listed state'}{stuckSettings.tags
					.length
					? `, tagged ${stuckSettings.tags.map((t) => `:${t}:`).join(' ')}`
					: ''}{stuckSettings.regexp ? ', or matches the text pattern' : ''}.
				<a href={href.settings('tasks')}>Change in Settings</a>
			</p>
			{#if stuck.error}
				<p class="notice warn" role="alert">
					The stuck-project definition doesn’t work: {stuck.error}
				</p>
			{:else}
				<AgendaList
					items={stuck.items}
					{today}
					empty="No stuck projects: every one has a next action."
					{onTop}
				/>
			{/if}
			<details class="stuck-settings" id="stuck-settings">
				<summary>What counts as a stuck project</summary>
				<StuckEditor idPrefix="ag-stuck" />
			</details>
		</section>
	{:else if mode === 'day'}
		<DayPlanner {today} keep={compiled.keep} />
	{:else if mode === 'month'}
		<MonthView {today} keep={compiled.keep} {onTop} />
	{:else if mode === 'board'}
		<BoardView {today} keep={compiled.keep} {categoryLabels} />
	{:else if mode === 'week'}
		<nav class="week-nav" aria-label="Week">
			<button
				type="button"
				class="btn small icon-only"
				aria-label="Previous week"
				onclick={() => (start = addDays(start, -7))}><Icon name="chevronLeft" size={16} /></button
			>
			<span class="week-label" aria-live="polite">{weekLabel}</span>
			<button
				type="button"
				class="btn small icon-only"
				aria-label="Next week"
				onclick={() => (start = addDays(start, 7))}><Icon name="chevronRight" size={16} /></button
			>
			{#if start !== weekStart(today)}
				<button type="button" class="btn small" onclick={() => (start = weekStart(today))}
					>This week</button
				>
			{/if}
		</nav>
		{#each days as day (day.date)}
			<section
				class="group day"
				class:today={day.date === today}
				class:past={day.date < today}
				aria-labelledby={`wk-${day.date}`}
			>
				<h2 id={`wk-${day.date}`}>
					{dayLabel(day.date)}{#if day.date === today}<span class="now">Today</span>{/if}<span
						class="count">{day.items.length}</span
					>
				</h2>
				{#if day.items.length}
					<AgendaList items={day.items} {today} {onTop} grid={day.date === today} />
				{/if}
			</section>
		{/each}
	{:else}
		{#each sections as section (section.id)}
			<section class="group" aria-labelledby={`ag-${section.id}`}>
				<h2
					id={`ag-${section.id}`}
					class:alert={section.id === 'overdue' && section.items.length > 0}
				>
					{section.title}<span class="count">{section.items.length}</span>
				</h2>
				<AgendaList
					items={section.items}
					{today}
					empty={section.empty}
					{onTop}
					grid={section.id === 'today'}
				/>
			</section>
		{/each}
	{/if}
	<ClockReport {today} />
</div>

<style>
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: end;
		gap: 0.5rem 1rem;
		margin-bottom: 1rem;
	}
	header > :first-child {
		flex-basis: 100%;
		margin-bottom: 0;
	}
	.mode {
		margin-left: auto;
		max-width: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	/* Narrow phones: one row, the width shared out, so all six fit. */
	@media (max-width: 560px) {
		/* The switcher sits just under the title: more room for the agenda. */
		header h1 {
			margin-bottom: 0.25rem;
		}
		.mode {
			flex-wrap: nowrap;
			width: 100%;
			margin-left: 0;
		}
		.mode button {
			flex: 1 1 0;
			justify-content: center;
			min-width: 0;
			padding: 0 0.25rem;
			font-size: 0.8rem;
		}
	}
	/* Phones add tasks with the capture sheet (swipe up), not this bar. */
	@media (max-width: 720px) {
		.agenda-page :global(.quick-add) {
			display: none;
		}
	}
	.stuck-hint {
		margin: 0 0 0.5rem;
		color: var(--text-muted);
		font-size: 0.86rem;
	}
	.stuck-settings {
		margin-top: 1rem;
		font-size: 0.88rem;
	}
	.stuck-settings summary {
		min-height: 2.25rem;
		display: flex;
		align-items: center;
		color: var(--text-2);
		font-weight: 600;
		cursor: pointer;
	}
	.week-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0.5rem 0 0.25rem;
	}
	.week-label {
		min-width: 11rem;
		font-weight: 650;
		text-align: center;
	}
	.day h2 .now {
		margin-left: 0.5rem;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 0.72rem;
	}
	.day.past h2 {
		color: var(--text-muted);
	}
	/* Every view takes the full width, so switching views never resizes the page. */
	.agenda-page {
		margin: 0 auto;
		padding: 3.25rem 2.5rem 6rem;
	}
	.eyebrow {
		margin: 0 0 0.35rem;
		color: var(--accent);
		font-size: 0.78rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	h1 {
		margin: 0 0 1.5rem;
		font-family: var(--font-read);
		font-size: 2.6rem;
		font-weight: 600;
		letter-spacing: -0.022em;
	}
	.group {
		margin-top: 1.75rem;
	}
	h2 {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: 0 0 0.25rem;
		padding-bottom: 0.5rem;
		border-bottom: 1px solid var(--border-strong);
		font-size: 0.8rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	h2.alert {
		color: var(--danger);
	}
	.count {
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.7rem;
		letter-spacing: 0;
	}
	/* The month and the board use the whole width (and the month the height). */
	.agenda-page.fit {
		padding-bottom: 0;
	}
	@media (max-width: 720px) {
		.agenda-page {
			padding: 1.75rem 1rem 6rem;
		}
		/* The month fits the screen; its day drawer holds the rest. */
		.agenda-page.fit {
			padding-bottom: 0;
		}
	}
	.swipe-tip {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin: -0.5rem 0 1rem;
		padding: 0.6rem 0.5rem 0.6rem 0.85rem;
		border-radius: 12px;
		background: var(--accent-softer, var(--accent-soft));
		color: var(--text-2);
		font-size: 0.86rem;
	}
	.swipe-tip span {
		flex: 1;
	}
	.swipe-tip .x {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text-muted);
	}
</style>
