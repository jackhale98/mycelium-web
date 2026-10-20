<script lang="ts">
	import AgendaList from '../components/AgendaList.svelte';
	import { groupAgenda } from '../agenda';
	import { app, localNow } from '../state.svelte';
	import { longDate } from '../util';

	const today = localNow().date;
	const groups = $derived.by(() => {
		void app.rev;
		return groupAgenda(app.vault, today);
	});

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
		].filter((s) => s.items.length > 0 || s.empty),
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
	{#each sections as section (section.id)}
		<section class="group" aria-labelledby={`ag-${section.id}`}>
			<h2
				id={`ag-${section.id}`}
				class:alert={section.id === 'overdue' && section.items.length > 0}
			>
				{section.title}<span class="count">{section.items.length}</span>
			</h2>
			<AgendaList items={section.items} {today} empty={section.empty} />
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
