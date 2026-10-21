<script lang="ts">
	// The running clock (org-clock's mode-line indicator): what's being timed,
	// for how long, and a way to stop it from any page.
	import { clockMillis, formatDuration } from '$lib/org';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const clock = $derived(app.runningClocks[0] ?? null);
	let now = $state(Date.now());

	$effect(() => {
		if (!clock) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	const elapsed = $derived(
		clock ? Math.max(0, Math.floor((now - clockMillis(clock.start)) / 60_000)) : 0,
	);
	const link = $derived.by(() => {
		if (!clock) return null;
		void app.rev;
		const file = app.vault.file(clock.path);
		const node = file?.index.nodes.find((n) => n.pos === clock.heading && n.level > 0);
		if (node) return href.node(node.id);
		return app.linkTarget(clock.path, `*${clock.title}`)?.href ?? null;
	});
</script>

{#if clock}
	<div class="clockbar" role="status" aria-live="polite">
		<Icon name="clock" size={15} />
		<a class="title" href={link}>{clock.title}</a>
		<span class="time" title={`Since ${clock.start.date} ${clock.start.time}`}
			>{formatDuration(elapsed)}</span
		>
		<button type="button" class="btn small" onclick={() => app.clockOut(clock.path, clock.heading)}
			>Clock out</button
		>
	</div>
{/if}

<style>
	.clockbar {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 1rem;
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklab, var(--todo-soft) 70%, var(--surface));
		color: var(--todo);
		font-size: 0.86rem;
	}
	.title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--text);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.time {
		font-variant-numeric: tabular-nums;
		font-weight: 650;
	}
</style>
