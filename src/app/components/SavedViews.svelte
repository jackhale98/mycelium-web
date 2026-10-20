<script lang="ts">
	import type { SavedAgendaView } from '$lib/store/db';
	import { app } from '../state.svelte';

	let {
		query,
		onpick,
	}: {
		/** The current filter, encoded. */
		query: string;
		onpick: (view: SavedAgendaView) => void;
	} = $props();

	const views = $derived(app.activeVault?.agendaViews ?? []);
	const current = $derived(views.find((v) => v.query === query) ?? null);

	/** `new`: naming the current filter; a view id: renaming that view. */
	let naming = $state<'new' | string | null>(null);
	let name = $state('');
	let input: HTMLInputElement | undefined = $state();

	function start(mode: 'new' | string) {
		naming = mode;
		name = mode === 'new' ? '' : (views.find((v) => v.id === mode)?.name ?? '');
		queueMicrotask(() => input?.focus());
	}

	async function commit(e: SubmitEvent) {
		e.preventDefault();
		const n = name.trim();
		if (!n || !naming) return;
		const next =
			naming === 'new'
				? [...views, { id: crypto.randomUUID(), name: n, query }]
				: views.map((v) => (v.id === naming ? { ...v, name: n } : v));
		naming = null;
		await app.saveAgendaViews(next);
	}

	async function remove(view: SavedAgendaView) {
		if (!confirm(`Delete the saved view “${view.name}”?`)) return;
		await app.saveAgendaViews(views.filter((v) => v.id !== view.id));
	}
</script>

{#if views.length || query || naming}
	<div class="views">
		{#if views.length}
			<ul class="list" aria-label="Saved views">
				{#each views as view (view.id)}
					<li class:on={view === current}>
						<button
							type="button"
							class="pick"
							aria-pressed={view === current}
							onclick={() => onpick(view)}>{view.name}</button
						>
						{#if view === current}
							<button
								type="button"
								class="icon"
								aria-label={`Rename ${view.name}`}
								title="Rename"
								onclick={() => start(view.id)}>✎</button
							>
							<button
								type="button"
								class="icon"
								aria-label={`Delete ${view.name}`}
								title="Delete"
								onclick={() => remove(view)}>×</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if naming}
			<form class="name" onsubmit={commit}>
				<label class="sr-only" for="view-name">View name</label>
				<input
					id="view-name"
					bind:this={input}
					bind:value={name}
					placeholder="Name this view…"
					maxlength="60"
					onkeydown={(e) => e.key === 'Escape' && (naming = null)}
				/>
				<button type="submit" class="btn small primary" disabled={!name.trim()}>Save</button>
				<button type="button" class="btn small" onclick={() => (naming = null)}>Cancel</button>
			</form>
		{:else if query && !current}
			<button type="button" class="btn small" onclick={() => start('new')}>Save view…</button>
		{/if}
	</div>
{/if}

<style>
	.views {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}
	.list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: flex;
		align-items: center;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
	}
	li.on {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	button.pick,
	button.icon {
		min-height: 2rem;
		border: 0;
		background: none;
		color: var(--text);
		font-size: 0.82rem;
		font-weight: 600;
	}
	button.pick {
		padding: 0.2rem 0.75rem;
	}
	li.on button {
		color: var(--accent-strong);
	}
	button.icon {
		min-width: 2rem;
		padding: 0 0.35rem;
	}
	li.on button.pick {
		padding-right: 0.2rem;
	}
	.name {
		display: flex;
		gap: 0.35rem;
	}
	.name input {
		min-width: 0;
		padding: 0.3rem 0.6rem;
		border: 1px solid var(--border-strong);
		border-radius: var(--radius);
		background: var(--surface);
		color: var(--text);
		font: inherit;
		font-size: 0.85rem;
	}
</style>
