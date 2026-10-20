<script lang="ts">
	import { normaliseTag } from '$lib/org';
	import { nodePath } from '$lib/vault/layout';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import { slugify } from '../util';
	import Icon from './Icon.svelte';

	let dialog: HTMLDialogElement | undefined = $state();
	let title = $state('');
	let tags = $state('');

	const clean = $derived(title.replace(/\s+/g, ' ').trim());
	const existing = $derived(clean ? app.vault.titles.get(clean.toLowerCase()) : undefined);
	const file = $derived(nodePath(app.layout, `YYYYMMDDHHMMSS-${slugify(clean) || 'note'}.org`));

	$effect(() => {
		if (!dialog) return;
		if (app.newNote && !dialog.open) {
			title = app.newNote.title;
			tags = '';
			dialog.showModal();
		} else if (!app.newNote && dialog.open) dialog.close();
	});

	function create(e: Event) {
		e.preventDefault();
		if (!clean) return;
		const id =
			existing ??
			app.createNode(
				clean,
				tags
					.split(/[\s,:]+/)
					.map((t) => normaliseTag(t))
					.filter((t): t is string => !!t),
			);
		app.newNote = null;
		if (id) {
			app.editing = !existing;
			router.go(href.node(id));
		}
	}
</script>

<dialog
	bind:this={dialog}
	class="new-note"
	aria-labelledby="nn-title"
	onclose={() => (app.newNote = null)}
>
	<form onsubmit={create}>
		<h2 id="nn-title">New note</h2>
		<div class="field">
			<label for="nn-name">Title</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input id="nn-name" class="input" bind:value={title} autocomplete="off" autofocus required />
			{#if existing}
				<span class="hint exists"
					><Icon name="info" size={13} /> A note with this title exists — you'll open it.</span
				>
			{:else}
				<span class="hint mono">{file}</span>
			{/if}
		</div>
		<div class="field">
			<label for="nn-tags">Tags <span class="opt">optional</span></label>
			<input
				id="nn-tags"
				class="input"
				bind:value={tags}
				placeholder="idea, reading"
				autocomplete="off"
			/>
		</div>
		<div class="actions">
			<button type="button" class="btn" onclick={() => (app.newNote = null)}>Cancel</button>
			<button class="btn primary" disabled={!clean}>{existing ? 'Open' : 'Create and edit'}</button>
		</div>
	</form>
</dialog>

<style>
	.new-note {
		width: min(30rem, calc(100vw - 2rem));
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.new-note::backdrop {
		background: rgb(20 18 12 / 0.4);
		backdrop-filter: blur(3px);
	}
	form {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		padding: 1.4rem 1.5rem;
	}
	h2 {
		margin: 0;
		font-family: var(--font-read);
		font-size: 1.45rem;
		font-weight: 600;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 0.72rem !important;
	}
	.exists {
		display: flex;
		align-items: center;
		gap: 0.35rem;
	}
	.opt {
		color: var(--text-muted);
		font-weight: 450;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
</style>
