<script lang="ts">
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const busy = $derived(app.sync.kind === 'busy');
	const changes = $derived(app.git.changes.length);
</script>

<div class="git">
	<a class="branch" href={href.changes()} title="Review changes and commit">
		<Icon name="branch" size={14} />
		<span class="name">{app.git.branch}</span>
		{#if changes}<span class="pill dirty" aria-label={`${changes} uncommitted`}>{changes}</span
			>{/if}
	</a>
	{#if app.git.hasRemote}
		<span class="counts" role="status" aria-live="polite">
			{#if busy}{app.sync.kind === 'busy' ? app.sync.phase : ''}…{:else}
				<span title="Commits to pull">↓{app.git.behind}</span>
				<span title="Commits to push">↑{app.git.ahead}</span>
			{/if}
		</span>
		<button
			type="button"
			class="icon-btn"
			aria-label="Pull from origin"
			title="Pull (fetch and merge)"
			disabled={busy}
			onclick={() => app.pull()}><Icon name="download" size={15} /></button
		>
		<button
			type="button"
			class="icon-btn"
			class:ready={app.git.ahead > 0}
			aria-label="Push to origin"
			title="Push commits"
			disabled={busy}
			onclick={() => app.push()}><Icon name="upload" size={15} /></button
		>
	{:else}
		<span class="counts">local only</span>
	{/if}
</div>

<style>
	.git {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
	}
	.branch {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		min-width: 0;
		padding: 0.3rem 0.45rem;
		border-radius: 7px;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.74rem;
		text-decoration: none;
	}
	.branch:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.pill {
		padding: 0 0.4rem;
		border-radius: 999px;
		font-family: var(--font-ui);
		font-size: 0.68rem;
		font-weight: 700;
		line-height: 1.35rem;
	}
	.dirty {
		background: var(--todo-soft);
		color: var(--todo);
	}
	.counts {
		display: flex;
		gap: 0.35rem;
		margin-left: auto;
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.72rem;
		white-space: nowrap;
	}
	.icon-btn {
		display: grid;
		place-items: center;
		width: 1.85rem;
		height: 1.85rem;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface);
		color: var(--text-2);
	}
	.icon-btn:hover:not(:disabled) {
		border-color: var(--accent);
		color: var(--accent);
	}
	.icon-btn.ready {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent, #fff);
	}
	.icon-btn:disabled {
		opacity: 0.5;
	}
</style>
