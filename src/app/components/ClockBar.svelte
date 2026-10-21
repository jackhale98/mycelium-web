<script lang="ts">
	// The running clock (org-clock's mode-line indicator): what's being timed,
	// for how long, and a way to stop it (recording the time) or cancel it
	// (discarding it, as org-clock-cancel does) from any page.
	import { clockMillis, formatDuration } from '$lib/org';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const clock = $derived(app.runningClocks[0] ?? null);
	let now = $state(Date.now());

	// The bar appears after the page (once the vault has loaded) and pushes it
	// down: a tap aimed at what was there before mustn't land on Stop. Its
	// buttons wait a moment after it first shows.
	const showing = $derived(!!clock);
	let armed = $state(false);
	$effect(() => {
		if (!showing) return;
		armed = false;
		const t = setTimeout(() => (armed = true), 1000);
		return () => clearTimeout(t);
	});

	// Stop and Cancel can be undone for a few seconds.
	const undo = $derived(app.clockUndo);
	$effect(() => {
		if (!undo) return;
		const t = setTimeout(() => {
			if (app.clockUndo === undo) app.clockUndo = null;
		}, 8000);
		return () => clearTimeout(t);
	});

	$effect(() => {
		if (!clock) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(timer);
	});

	// Other sticky headers (the daily note's date bar) sit below the clock
	// bar instead of sliding over it: they read its height from --clock-h.
	let bar: HTMLDivElement | undefined = $state();
	$effect(() => {
		const el = bar;
		if (!el) return;
		const root = document.documentElement.style;
		const ro = new ResizeObserver(() => root.setProperty('--clock-h', `${el.offsetHeight}px`));
		ro.observe(el);
		return () => {
			ro.disconnect();
			root.removeProperty('--clock-h');
		};
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

{#if undo}
	<div class="clockbar done" role="status" aria-live="polite" bind:this={bar}>
		<Icon name="clock" size={15} />
		<span class="title">{undo.text}</span>
		<button type="button" class="btn small" onclick={() => app.undoClock()}>Undo</button>
		<button type="button" class="x" aria-label="Dismiss" onclick={() => (app.clockUndo = null)}
			><Icon name="close" size={14} /></button
		>
	</div>
{:else if clock}
	<div class="clockbar" role="status" aria-live="polite" bind:this={bar}>
		<Icon name="clock" size={15} />
		<a class="title" href={link}>{clock.title}</a>
		<span class="time" title={`Since ${clock.start.date} ${clock.start.time}`}
			>{formatDuration(elapsed)}</span
		>
		<button
			type="button"
			class="btn small primary"
			title="Stop the clock and record the time"
			aria-disabled={!armed}
			onclick={() => armed && app.clockOut(clock.path, clock.heading)}>Stop</button
		>
		<button
			type="button"
			class="btn small"
			title="Discard this clock without recording any time"
			aria-disabled={!armed}
			onclick={() => armed && app.clockCancel(clock.path, clock.heading)}>Cancel</button
		>
	</div>
{/if}

<style>
	.clockbar {
		position: sticky;
		top: 0;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.4rem 1rem;
		border-bottom: 1px solid var(--border);
		background: color-mix(in oklab, var(--todo-soft) 70%, var(--surface));
		color: var(--todo);
		font-size: 0.86rem;
	}
	.done {
		color: var(--text-muted);
	}
	.x {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 2rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text-muted);
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
