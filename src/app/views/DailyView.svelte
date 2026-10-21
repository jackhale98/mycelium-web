<script lang="ts">
	import { addDays } from '$lib/org';
	import Icon from '../components/Icon.svelte';
	import { href, router } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import { longDate, shortDate } from '../util';
	import NodeView from './NodeView.svelte';

	let { date }: { date: string | null } = $props();

	const today = localNow().date;
	const day = $derived(date ?? today);
	const node = $derived.by(() => {
		void app.rev;
		return app.vault.fileNode(app.dailyPath(day));
	});
	const days = $derived(app.dailies);
	const prev = $derived(days.find((d) => d < day));
	const next = $derived([...days].reverse().find((d) => d > day));

	function create() {
		const id = app.ensureDaily(day);
		if (id) router.go(href.daily(day));
	}
</script>

<div class="daily">
	<nav class="day-nav" aria-label="Daily notes">
		<a class="nav-btn" href={href.daily(prev ?? addDays(day, -1))} aria-label="Previous daily note"
			><Icon name="chevronLeft" size={16} /></a
		>
		<div class="day-label">
			<span class="eyebrow">{day === today ? 'Today' : 'Daily note'}</span>
			<span>{shortDate(day)}</span>
		</div>
		<a class="nav-btn" href={href.daily(next ?? addDays(day, 1))} aria-label="Next daily note"
			><Icon name="chevronRight" size={16} /></a
		>
		{#if day !== today}<a class="today" href={href.daily(today)}>Jump to today</a>{/if}
	</nav>

	{#if node}
		{#key node.id}
			<NodeView id={node.id} eyebrow={app.dailyPath(day)} displayTitle={longDate(day)} />
		{/key}
	{:else}
		<div class="blank">
			<Icon name="calendar" size={28} />
			<h1>No note for {longDate(day)}</h1>
			<p>This day's note would be <code>{app.dailyPath(day)}</code>.</p>
			<button type="button" class="primary" onclick={create}
				><Icon name="plus" size={16} />Create daily note</button
			>
		</div>
	{/if}
</div>

<style>
	.day-nav {
		position: sticky;
		top: var(--clock-h, 0px);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.7rem 1.5rem;
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg) 88%, transparent);
		backdrop-filter: blur(12px);
	}
	.nav-btn {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text-2);
	}
	.nav-btn:hover {
		border-color: var(--border-strong);
		color: var(--text);
	}
	.day-label {
		display: flex;
		flex-direction: column;
		padding: 0 0.5rem;
		font-size: 0.88rem;
		font-weight: 600;
		line-height: 1.25;
	}
	.eyebrow {
		color: var(--accent);
		font-size: 0.68rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.today {
		margin-left: auto;
		color: var(--accent);
		font-size: 0.82rem;
		font-weight: 600;
		text-decoration: none;
	}
	.blank {
		display: flex;
		flex-direction: column;
		align-items: center;
		max-width: 28rem;
		margin: 6rem auto;
		padding: 0 1rem;
		color: var(--text-muted);
		text-align: center;
	}
	.blank h1 {
		margin: 1rem 0 0.25rem;
		color: var(--text);
		font-family: var(--font-read);
		font-size: 1.6rem;
		font-weight: 600;
	}
	.primary {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		margin-top: 1rem;
		padding: 0.6rem 1rem;
		border: 0;
		border-radius: 10px;
		background: var(--accent);
		color: var(--on-accent);
		font-weight: 600;
	}
</style>
