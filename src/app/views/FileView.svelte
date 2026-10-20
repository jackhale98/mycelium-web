<script lang="ts">
	// An org file without an `:ID:`: not an org-roam node, so no backlinks or
	// aliases, but still readable and editable (an inbox, a capture target).
	import type { OrgNode } from 'uniorg';
	import Icon from '../components/Icon.svelte';
	import OrgEditor from '../editor/OrgEditor.svelte';
	import Blocks from '../org/OrgBlocks.svelte';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';

	let { path }: { path: string } = $props();

	const file = $derived.by(() => {
		void app.rev;
		return app.vault.file(path);
	});
	/** If the file has become a note (it has an ID now), its note page is the place for it. */
	const node = $derived.by(() => {
		void app.rev;
		return app.vault.fileNode(path);
	});
	const title = $derived(
		file?.index.title ??
			path
				.split('/')
				.pop()!
				.replace(/\.org$/i, ''),
	);
	const body = $derived.by((): OrgNode[] => {
		void app.rev;
		return (app.tree(path)?.children as OrgNode[] | undefined) ?? [];
	});

	$effect(() => {
		if (node) router.go(href.node(node.id));
	});
	$effect(() => {
		document.title = file ? `${title} · Mycelium` : 'Not found · Mycelium';
	});
	$effect(() => {
		if (!app.editing) app.editAt = null;
	});

	function makeNote() {
		const id = app.makeFileNode(path);
		if (id) router.go(href.node(id));
	}

	function onkeydown(e: KeyboardEvent) {
		const target = e.composedPath()[0];
		if (
			target instanceof HTMLElement &&
			target.closest('input, textarea, select, [contenteditable="true"], dialog')
		) {
			if (e.key === 'Escape' && app.editing && target.closest('.cm-editor')) app.editing = false;
			return;
		}
		if (e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			app.editing = true;
		}
	}
</script>

<svelte:window {onkeydown} />

{#if file}
	<article class="file" aria-labelledby="file-title">
		<header>
			<div class="toolbar">
				<button
					type="button"
					class="btn small"
					title="Give the file an :ID: so org-roam treats it as a note"
					onclick={makeNote}><Icon name="plus" size={14} />Make this a note</button
				>
				<button
					type="button"
					class="btn small"
					class:primary={app.editing}
					aria-pressed={app.editing}
					title={app.editing ? 'Back to reading (Esc)' : 'Edit the org source (E)'}
					onclick={() => (app.editing = !app.editing)}
					><Icon name={app.editing ? 'eye' : 'edit'} size={14} />{app.editing
						? 'Read'
						: 'Edit'}</button
				>
			</div>
			<p class="path"><Icon name="file" size={13} />{path}</p>
			<h1 id="file-title">{title}</h1>
			<p class="hint">
				A file without an <code>:ID:</code>: org-roam doesn't treat it as a note, so it has no
				backlinks. Its tasks still show on the agenda.
			</p>
		</header>
		{#if app.editing}
			{#key path}<OrgEditor {path} focusAt={app.editAt} label={`Org source of ${title}`} />{/key}
		{:else}
			<div class="prose">
				<Blocks nodes={body} ctx={{ path, levelOffset: 0, interactive: true }} />
			</div>
		{/if}
	</article>
{:else}
	<div class="missing">
		<h1>File not found</h1>
		<p>There's no file <code>{path}</code> in this vault.</p>
		<a href={href.home()}>Back to home</a>
	</div>
{/if}

<style>
	.file {
		width: 100%;
		max-width: calc(var(--read-w) + 6rem);
		margin: 0 auto;
		padding: 3.25rem 3rem 6rem;
	}
	header {
		margin-bottom: 2rem;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 0.4rem;
		margin-bottom: 0.75rem;
	}
	.path {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		margin: 0 0 0.6rem;
		color: var(--text-muted);
		font-size: 0.8rem;
		overflow-wrap: anywhere;
	}
	h1 {
		margin: 0;
		font-family: var(--font-read);
		font-size: 2.4rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.15;
	}
	.hint {
		margin: 0.6rem 0 0;
		color: var(--text-muted);
		font-size: 0.85rem;
	}
	code {
		font-family: var(--font-mono);
		font-size: 0.85em;
	}
	.missing {
		padding: 6rem 1rem;
		text-align: center;
	}
	@media (max-width: 720px) {
		.file {
			padding: 1.75rem 1rem 6rem;
		}
		h1 {
			font-size: 1.9rem;
		}
	}
</style>
