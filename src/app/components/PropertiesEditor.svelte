<script lang="ts">
	// A heading's or file's property drawer: edit values, remove properties,
	// add new ones. The ID is shown but not editable (links depend on it).
	import { findPropertyDrawer } from '$lib/org';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let {
		path,
		owner,
	}: {
		path: string;
		/** A heading's offset, or null for the file's own drawer. */
		owner: number | null;
	} = $props();

	// Well-known keys, offered when adding.
	const SUGGESTED = [
		'Effort',
		'CATEGORY',
		'STYLE',
		'ROAM_EXCLUDE',
		'CUSTOM_ID',
		'ORDERED',
		'LOGGING',
		'COLUMNS',
		'ARCHIVE',
		'CREATED',
	];

	const entries = $derived.by(() => {
		void app.rev;
		const file = app.vault.file(path);
		if (!file) return [];
		return (findPropertyDrawer(file.source, owner, file.index.keywords)?.properties ?? []).map(
			(p) => ({ key: p.key, value: p.value }),
		);
	});
	const hidden = new Set(['ROAM_ALIASES', 'ROAM_REFS']);

	let newKey = $state('');
	let newValue = $state('');
	let error = $state<string | null>(null);

	function save(key: string, value: string) {
		app.setPropertyValue(path, owner, key, value);
	}

	function add(e: SubmitEvent) {
		e.preventDefault();
		const key = newKey.trim();
		error = null;
		if (!/^[^\s:]+$/.test(key)) {
			error = 'A property name has no spaces or colons.';
			return;
		}
		if (entries.some((p) => p.key.toUpperCase() === key.toUpperCase())) {
			error = `${key} is already set: change it above.`;
			return;
		}
		app.setPropertyValue(path, owner, key, newValue.trim());
		newKey = '';
		newValue = '';
	}
</script>

<div class="props">
	{#if entries.length}
		<ul>
			{#each entries as p (p.key)}
				{#if !hidden.has(p.key.toUpperCase())}
					<li>
						<span class="key" id={`pk-${p.key}`}>{p.key}</span>
						{#if p.key.toUpperCase() === 'ID'}
							<code class="value fixed" aria-labelledby={`pk-${p.key}`}>{p.value}</code>
						{:else}
							<input
								class="input value"
								aria-labelledby={`pk-${p.key}`}
								value={p.value}
								autocomplete="off"
								onchange={(e) => save(p.key, e.currentTarget.value)}
							/>
							<button
								type="button"
								class="remove"
								aria-label={`Remove ${p.key}`}
								title={`Remove ${p.key}`}
								onclick={() => app.setPropertyValue(path, owner, p.key, null)}
								><Icon name="trash" size={14} /></button
							>
						{/if}
					</li>
				{/if}
			{/each}
		</ul>
	{:else}
		<p class="hint">No properties yet.</p>
	{/if}
	<form class="add" onsubmit={add}>
		<input
			class="input"
			aria-label="New property name"
			placeholder="Name"
			list="prop-names"
			bind:value={newKey}
			autocomplete="off"
		/>
		<input
			class="input"
			aria-label="New property value"
			placeholder="Value"
			bind:value={newValue}
			autocomplete="off"
		/>
		<button class="btn small" disabled={!newKey.trim()}>Add</button>
		<datalist id="prop-names">
			{#each SUGGESTED.filter((k) => !entries.some((p) => p.key.toUpperCase() === k.toUpperCase())) as k (k)}
				<option value={k}></option>
			{/each}
		</datalist>
	</form>
	{#if error}<p class="notice warn" role="alert">{error}</p>{/if}
</div>

<style>
	.props {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
	ul {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	li {
		display: grid;
		grid-template-columns: minmax(5rem, 8.5rem) minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.5rem;
	}
	.key {
		overflow: hidden;
		color: var(--text-2);
		font-family: var(--font-mono);
		font-size: 0.8rem;
		text-overflow: ellipsis;
	}
	.fixed {
		grid-column: 2 / span 2;
		overflow-wrap: anywhere;
		color: var(--text-muted);
		font-size: 0.78rem;
	}
	.remove {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text-muted);
	}
	.remove:hover {
		background: var(--surface-2);
		color: var(--danger);
	}
	.add {
		display: grid;
		grid-template-columns: minmax(5rem, 8.5rem) minmax(0, 1fr) auto;
		gap: 0.5rem;
	}
	.hint {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.82rem;
	}
	@media (max-width: 420px) {
		li,
		.add {
			grid-template-columns: minmax(0, 1fr) auto;
		}
		.key {
			grid-column: 1 / -1;
		}
		.add .input:first-child {
			grid-column: 1 / -1;
		}
	}
</style>
