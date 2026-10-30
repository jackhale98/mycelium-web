<script lang="ts">
	// An org file without an `:ID:`: not an org-roam node, so no backlinks or
	// aliases, but still readable and editable (an inbox, a capture target).
	import type { OrgNode } from 'uniorg';
	import Icon from '../components/Icon.svelte';
	import OrgEditor from '../editor/OrgEditor.svelte';
	import Blocks from '../org/OrgBlocks.svelte';
	import { href, router } from '../router.svelte';
	import { app } from '../state.svelte';
	import { panes, usePane } from '../panes.svelte';
	import { scrollToSearch } from '../org/scroll-to';
	import { tick } from 'svelte';
	import { readingAnchor, restoreReading, type Anchor } from '../anchor';
	import { folds, GLOBAL_LABEL, type Global } from '../folds.svelte';

	let { path, at = null }: { path: string; at?: string | null } = $props();

	const pane = usePane();

	let article: HTMLElement | undefined = $state();
	$effect(() => {
		const search = at;
		const el = article;
		const f = app.vault.file(path);
		if (!search || !el || !f || pane.editing) return;
		void tick().then(() => scrollToSearch(el, f.source, search, f.index.keywords));
	});

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

	/** Headings marked done, and ones that aren't (Hide done can leave the page empty). */
	const tally = $derived.by(() => {
		void app.rev;
		const f = app.vault.file(path);
		if (!f) return { done: 0, open: 0 };
		const done = new Set(f.index.keywords.doneKeywords);
		const n = f.index.headlines.filter((h) => h.todo && done.has(h.todo)).length;
		return { done: n, open: f.index.headlines.length - n };
	});

	$effect(() => {
		if (node) router.go(href.node(node.id));
	});
	$effect(() => {
		document.title = file ? `${title} · Mycelium` : 'Not found · Mycelium';
	});
	$effect(() => {
		if (!pane.editing) app.editAt = null;
	});

	// Switching between reading and editing keeps the same part of the file at
	// the same place on screen, as on a note's page. (Without a place to put the
	// cursor, a phone's browser puts it at the end and scrolls down there.)
	let editor: ReturnType<typeof OrgEditor> | undefined = $state();
	let openAt = $state<Anchor | null>(null);
	/** The editor is up (until then the reading view stays on screen). */
	let editorUp = $state(false);
	$effect(() => {
		if (!pane.editing) editorUp = false;
	});
	function setEditing(on: boolean) {
		if (on === pane.editing) return;
		const el = article;
		if (on) {
			openAt = el ? readingAnchor(el) : null;
			pane.editing = true;
			return;
		}
		const at = el && editor ? editor.topAnchor(el) : null;
		openAt = null;
		pane.editing = false;
		if (at && el) void tick().then(() => restoreReading(el, at));
	}

	// Folding the whole file, as org's S-TAB: overview, contents, show all.
	const hasHeadings = $derived.by(() => {
		void app.rev;
		return (app.vault.file(path)?.index.headlines.length ?? 0) > 0;
	});
	/** The editor's S-TAB state (it folds its own text). */
	let editorOutline = $state<Global>('all');
	const outlineNow = $derived(pane.editing ? editorOutline : folds.global(path));
	$effect(() => {
		const f = app.vault.file(path);
		if (f) folds.start(path, f.source);
	});
	$effect(() => {
		if (!pane.editing) editorOutline = 'all';
	});
	function cycleOutline() {
		if (pane.editing) {
			editorOutline = editor?.cycleOutline() ?? editorOutline;
			return;
		}
		const f = app.vault.file(path);
		if (f) folds.cycleGlobal(path, f.source);
	}

	function makeNote() {
		const id = app.makeFileNode(path);
		if (id) router.go(href.node(id));
	}

	function onkeydown(e: KeyboardEvent) {
		// With split view, keys go to the pane you're working in.
		if (pane !== panes.focused) return;
		const target = e.composedPath()[0];
		if (
			target instanceof HTMLElement &&
			target.closest('input, textarea, select, [contenteditable="true"], dialog')
		) {
			if (e.key === 'Escape' && pane.editing && target.closest('.cm-editor')) setEditing(false);
			return;
		}
		if (e.key === 'e' && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			setEditing(true);
		}
		// S-TAB folds the whole note, as in org, when nothing on the page has
		// focus (from a button or link, it moves focus back as usual).
		if (
			e.key === 'Tab' &&
			e.shiftKey &&
			!e.metaKey &&
			!e.ctrlKey &&
			!e.altKey &&
			hasHeadings &&
			(target === document.body ||
				!(target instanceof HTMLElement) ||
				!target.closest('a, button, [tabindex]'))
		) {
			e.preventDefault();
			cycleOutline();
		}
	}
</script>

<svelte:window {onkeydown} />

{#if file}
	<article class="file" aria-labelledby="file-title" bind:this={article}>
		<header>
			<div class="toolbar">
				{#if !pane.editing && (tally.done > 0 || app.hideDone)}
					<button
						type="button"
						class="btn small"
						aria-pressed={app.hideDone}
						title={app.hideDone ? 'Show items marked done' : 'Hide items marked done'}
						onclick={() => app.setHideDone(!app.hideDone)}
						><Icon name={app.hideDone ? 'eyeOff' : 'check'} size={14} />{app.hideDone
							? `${tally.done} done hidden`
							: 'Hide done'}</button
					>
				{/if}
				{#if hasHeadings}
					<button
						type="button"
						class="btn small"
						title={`Fold the headings: ${GLOBAL_LABEL[outlineNow].toLowerCase()} (Shift-Tab)`}
						aria-label={`Outline: ${GLOBAL_LABEL[outlineNow]}`}
						onclick={cycleOutline}
						><Icon name="list" size={14} /><span class="label">{GLOBAL_LABEL[outlineNow]}</span
						></button
					>
				{/if}
				<button
					type="button"
					class="btn small"
					title="Give the file an :ID: so org-roam treats it as a note"
					onclick={makeNote}><Icon name="plus" size={14} />Make this a note</button
				>
				<button
					type="button"
					class="btn small"
					class:primary={pane.editing}
					aria-pressed={pane.editing}
					title={pane.editing ? 'Back to reading (Esc)' : 'Edit the org source (E)'}
					onclick={() => setEditing(!pane.editing)}
					><Icon name={pane.editing ? 'eye' : 'edit'} size={14} />{pane.editing
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
		<div class="swap">
			{#if pane.editing}
				<div class:pending={!editorUp}>
					{#key path}<OrgEditor
							bind:this={editor}
							{path}
							anchor={app.editAt === null ? openAt : null}
							focusAt={app.editAt}
							label={`Org source of ${title}`}
							onready={() => (editorUp = true)}
						/>{/key}
				</div>
			{/if}
			{#if !pane.editing || !editorUp}
				{#if app.hideDone && tally.done > 0 && tally.open === 0}
					<p class="all-hidden" role="note">
						Everything here is marked done, and done items are hidden.
						<button type="button" class="btn small" onclick={() => app.setHideDone(false)}
							>Show {tally.done} done {tally.done === 1 ? 'item' : 'items'}</button
						>
					</p>
				{/if}
				<div class="prose">
					<Blocks nodes={body} ctx={{ path, levelOffset: 0, interactive: true }} />
				</div>
			{/if}
		</div>
	</article>
{:else}
	<div class="missing">
		<h1>File not found</h1>
		<p>There's no file <code>{path}</code> in this vault.</p>
		<a href={href.home()}>Back to home</a>
	</div>
{/if}

<style>
	/* While the editor loads, the reading view stays; the editor gets ready unseen behind it. */
	.swap {
		position: relative;
	}
	.swap > .pending {
		position: absolute;
		inset: 0 0 auto;
		visibility: hidden;
		pointer-events: none;
	}
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
	.all-hidden {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 0.75rem;
		margin: 0 0 1rem;
		padding: 0.75rem 1rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius);
		color: var(--text-muted);
		font-size: 0.9rem;
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
