<script lang="ts">
	import type { AgendaItem } from '$lib/vault/vault';
	import AgendaFilters from '../components/AgendaFilters.svelte';
	import AgendaList from '../components/AgendaList.svelte';
	import SavedViews from '../components/SavedViews.svelte';
	import {
		activeFilters,
		compileFilter,
		decodeFilter,
		emptyFilter,
		encodeFilter,
		groupAgenda,
		type AgendaFilter,
	} from '../agenda';
	import { href } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import { longDate } from '../util';
	import { untrack } from 'svelte';

	let { query = '' }: { query?: string } = $props();

	const today = localNow().date;
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
		if (location.hash !== hash) history.replaceState(null, '', hash);
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
</script>

<div class="agenda-page">
	<header>
		<p class="eyebrow">{longDate(today)}</p>
		<h1>Agenda</h1>
	</header>
	<SavedViews query={encoded} onpick={(v) => (filter = decodeFilter(v.query, app.vault))} />
	<AgendaFilters
		bind:filter
		tags={tagOptions}
		states={stateOptions}
		categories={categoryOptions}
		{categoryLabels}
		error={compiled.error}
	/>
	{#each sections as section (section.id)}
		<section class="group" aria-labelledby={`ag-${section.id}`}>
			<h2
				id={`ag-${section.id}`}
				class:alert={section.id === 'overdue' && section.items.length > 0}
			>
				{section.title}<span class="count">{section.items.length}</span>
			</h2>
			<AgendaList items={section.items} {today} empty={section.empty} {onTop} />
		</section>
	{/each}
</div>

<style>
	.agenda-page {
		max-width: 52rem;
		margin: 0 auto;
		padding: 3.25rem 3rem 6rem;
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
	@media (max-width: 720px) {
		.agenda-page {
			padding: 1.75rem 1rem 6rem;
		}
	}
</style>
