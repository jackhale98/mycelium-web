<script lang="ts">
	import type { OrgNode, Section } from 'uniorg';
	import { headlineAt, splitLines, startOf, subtreeEnd, type RoamNode } from '$lib/org';
	import Backlinks from '../components/Backlinks.svelte';
	import Mentions from '../components/Mentions.svelte';
	import OrgEditor from '../editor/OrgEditor.svelte';
	import DateChip from '../org/DateChip.svelte';
	import Icon from '../components/Icon.svelte';
	import Blocks from '../org/OrgBlocks.svelte';
	import TodoChip from '../org/TodoChip.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import { panes, usePane } from '../panes.svelte';
	import { scrollToSearch } from '../org/scroll-to';
	import { readingAnchor, restoreReading, type Anchor } from '../anchor';
	import { preloadEditor } from '../editor/load';
	import { tick } from 'svelte';
	import Toc, { type TocEntry } from '../components/Toc.svelte';

	let {
		id,
		eyebrow,
		displayTitle,
		at = null,
	}: {
		id: string;
		eyebrow?: string;
		displayTitle?: string;
		/** An org search option to scroll to (from a link like `[[file:x.org::*Heading]]`). */
		at?: string | null;
	} = $props();

	const pane = usePane();

	let article: HTMLElement | undefined = $state();
	// Scroll to the link's target once the page has rendered.
	$effect(() => {
		const search = at;
		const el = article;
		const file = node ? app.vault.file(node.file) : undefined;
		if (!search || !el || !file || pane.editing) return;
		void tick().then(() => scrollToSearch(el, file.source, search, file.index.keywords));
	});

	const node = $derived.by(() => {
		void app.rev;
		return app.vault.node(id);
	});
	const fileNode = $derived(node && node.level > 0 ? app.vault.fileNode(node.file) : undefined);
	const keywords = $derived.by(() => {
		void app.rev;
		return (node && app.vault.file(node.file)?.index.keywords) || app.vault.keywords;
	});

	/** The part of the file this node covers: its subtree (all of it for a file node). */
	const range = $derived.by((): [number, number] | undefined => {
		void app.rev;
		const file = node && app.vault.file(node.file);
		if (!node || !file || node.level === 0) return undefined;
		const lines = splitLines(file.source);
		const h = headlineAt(file.source, node.pos, file.index.keywords, lines);
		return h ? [node.pos, subtreeEnd(lines, h)] : undefined;
	});

	/** The blocks that make up this node's body. */
	const body = $derived.by((): OrgNode[] => {
		void app.rev;
		if (!node) return [];
		const tree = app.tree(node.file);
		if (!tree) return [];
		if (node.level === 0) return tree.children as OrgNode[];
		const find = (nodes: readonly OrgNode[]): Section | null => {
			for (const n of nodes) {
				if (n.type !== 'section') continue;
				const h = n.children.find((c) => c.type === 'headline');
				if (h && startOf(h) === node.pos) return n;
				const inner = find(n.children as OrgNode[]);
				if (inner) return inner;
			}
			return null;
		};
		const section = find(tree.children as OrgNode[]);
		return section ? (section.children.filter((c) => c.type !== 'headline') as OrgNode[]) : [];
	});

	const refs = $derived(node?.refs ?? []);

	/** The note's headings, for its table of contents (three or more). */
	const contents = $derived.by((): TocEntry[] => {
		void app.rev;
		if (!node) return [];
		const all = app.vault.file(node.file)?.index.headlines ?? [];
		const end =
			node.level > 0
				? (all.find((h) => h.pos > node.pos && h.level <= node.level)?.pos ?? Infinity)
				: Infinity;
		const list = all
			.filter((h) => h.pos > (node.level > 0 ? node.pos : -1) && h.pos < end)
			.map((h) => ({ pos: h.pos, level: h.level, title: h.title, todo: h.todo }));
		return list.length >= 3 ? list : [];
	});

	/** Headings marked done in what this page shows (for the Hide done button). */
	const doneCount = $derived.by(() => {
		void app.rev;
		if (!node) return 0;
		const file = app.vault.file(node.file);
		if (!file) return 0;
		const done = new Set(file.index.keywords.doneKeywords);
		const all = file.index.headlines;
		const end =
			node.level > 0
				? (all.find((h) => h.pos > node.pos && h.level <= node.level)?.pos ?? Infinity)
				: Infinity;
		return all.filter(
			(h) => h.pos > (node.level > 0 ? node.pos : -1) && h.pos < end && h.todo && done.has(h.todo),
		).length;
	});
	const done = $derived(!!node?.todo && keywords.doneKeywords.includes(node.todo));

	$effect(() => {
		if (pane !== panes.focused) return;
		document.title = node ? `${node.title} · Mycelium` : 'Not found · Mycelium';
	});

	// Switching between reading and editing keeps the same part of the note
	// at the same place on screen.
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

	// The editor's code loads in the background while you read.
	$effect(() => preloadEditor());

	// The editor reads editAt once on open; clear it for next time.
	$effect(() => {
		if (!pane.editing) app.editAt = null;
	});

	// On a long note the toolbar comes back, floating at the top, when you
	// scroll up a little (and goes again when you scroll down), so switching
	// between reading and editing never means scrolling back to the top.
	let header: HTMLElement | undefined = $state();
	let floatWrap: HTMLElement | undefined = $state();
	let floating = $state(false);
	$effect(() => {
		const head = header;
		const wrap = floatWrap;
		if (!head || !wrap) return;
		let last: number | null = null;
		let travel = 0;
		let down = 0;
		const onScroll = (e: Event) => {
			const t = e.target;
			const y =
				t instanceof Element ? t.scrollTop : (document.scrollingElement?.scrollTop ?? scrollY);
			if (!(t instanceof Element) || t.contains(head)) {
				const top = parseFloat(getComputedStyle(wrap).top) || 0;
				if (head.getBoundingClientRect().bottom > top) {
					floating = false;
					travel = 0;
				} else if (last !== null) {
					const dy = y - last;
					// A deliberate upward scroll (~40px) shows it and a deliberate
					// downward one (~16px) hides it; the editor's own small scroll
					// adjustments as it measures lines do neither.
					travel = dy < 0 ? Math.min(0, travel) + dy : 0;
					down = dy > 0 ? down + dy : 0;
					if (down > 16) floating = false;
					else if (travel < -40) floating = true;
				}
				last = y;
			}
		};
		document.addEventListener('scroll', onScroll, { capture: true, passive: true });
		return () => document.removeEventListener('scroll', onScroll, { capture: true });
	});

	function onkeydown(e: KeyboardEvent) {
		// With split view, keys go to the pane you're working in.
		if (pane !== panes.focused) return;
		// The editor lives in a shadow root, so look at the real target.
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
	}
</script>

{#snippet tools(n: RoamNode)}
	<a
		class="btn small icon-only"
		href={href.graph(n.id)}
		title="Graph around this note"
		aria-label="Graph around this note"><Icon name="graph" size={15} /></a
	>
	{#if !pane.editing && (doneCount > 0 || app.hideDone)}
		<button
			type="button"
			class="btn small"
			aria-pressed={app.hideDone}
			title={app.hideDone ? 'Show items marked done' : 'Hide items marked done'}
			onclick={() => app.setHideDone(!app.hideDone)}
			><Icon name={app.hideDone ? 'eyeOff' : 'check'} size={14} /><span class="label"
				>{app.hideDone ? `${doneCount} done hidden` : 'Hide done'}</span
			></button
		>
	{/if}
	{#if !pane.editing}
		<button
			type="button"
			class="btn small"
			aria-haspopup="dialog"
			title="Rename, aliases, refs"
			onclick={() => (app.noteSheet = { id: n.id })}
			><Icon name="info" size={14} /><span class="label">Details</span></button
		>
	{/if}
	{#if n.level > 0 && !pane.editing}
		<button
			type="button"
			class="btn small"
			aria-haspopup="dialog"
			onclick={() => (app.headingSheet = { path: n.file, pos: n.pos })}
			><Icon name="settings" size={14} /><span class="label">Properties</span></button
		>
	{/if}
	<button
		type="button"
		class="btn small"
		class:primary={pane.editing}
		aria-pressed={pane.editing}
		title={pane.editing ? 'Back to reading (Esc)' : 'Edit the org source (E)'}
		onclick={() => setEditing(!pane.editing)}
		><Icon name={pane.editing ? 'eye' : 'edit'} size={14} />{pane.editing ? 'Read' : 'Edit'}</button
	>
{/snippet}

<svelte:window {onkeydown} />

{#if node}
	<div class="node-layout" class:with-panel={app.panelOpen}>
		<article class="node" aria-labelledby="node-title" bind:this={article}>
			<div class="float-wrap" bind:this={floatWrap}>
				<div
					class="toolbar floating"
					class:shown={floating}
					inert={!floating}
					aria-hidden={!floating}
				>
					{@render tools(node)}
				</div>
			</div>
			<header class="node-header" bind:this={header}>
				<!-- While its floating copy is showing, this one (off screen) steps out of the way. -->
				<div class="toolbar" inert={floating} aria-hidden={floating}>{@render tools(node)}</div>
				<nav class="crumbs" aria-label="Location">
					{#if eyebrow}
						<span class="path">{eyebrow}</span>
					{:else if fileNode}
						<a href={href.node(fileNode.id)}>{fileNode.title}</a>
						{#each node.olp as part, i (i)}<Icon name="chevronRight" size={13} /><span>{part}</span
							>{/each}
					{:else}
						<span class="path">{node.file}</span>
					{/if}
				</nav>
				<h1 id="node-title" class:done class:sr-only={pane.editing && node.level === 0}>
					{#if node.todo}
						<TodoChip
							keyword={node.todo}
							config={keywords}
							onchange={(next) => app.setTodo(node.file, node.pos, next)}
						/>
					{/if}
					{displayTitle ?? node.title}
				</h1>
				{#if node.aliases.length && !pane.editing}
					<p class="aliases">
						Also known as {#each node.aliases as alias, i (alias)}<em>{alias}</em>{i <
							node.aliases.length - 1
								? ', '
								: ''}{/each}
					</p>
				{/if}
				<div class="meta" hidden={pane.editing}>
					{#each node.tags as tag (tag)}<a class="chip tag" href={href.tags(tag)}>#{tag}</a>{/each}
					{#if node.deadline}<DateChip
							path={node.file}
							offset={node.pos}
							kind="DEADLINE"
							ts={node.deadline}
							editable={node.level > 0}
						/>{/if}
					{#if node.scheduled}<DateChip
							path={node.file}
							offset={node.pos}
							kind="SCHEDULED"
							ts={node.scheduled}
							editable={node.level > 0}
						/>{/if}
					{#each refs as ref (ref.ref)}
						{#if ref.type === 'http' || ref.type === 'https'}
							<a
								class="chip ref"
								href={`${ref.type}:${ref.ref}`}
								target="_blank"
								rel="noopener noreferrer"
								><Icon name="external" size={13} />{ref.ref
									.replace(/^\/\//, '')
									.replace(/\/$/, '')}</a
							>
						{:else}
							<span class="chip ref">@{ref.ref}</span>
						{/if}
					{/each}
				</div>
			</header>

			<div class="swap">
				{#if pane.editing}
					<div class:pending={!editorUp}>
						{#key node.file}
							<OrgEditor
								bind:this={editor}
								path={node.file}
								anchor={app.editAt === null ? openAt : null}
								focusAt={app.editAt ?? (node.level > 0 ? node.pos : null)}
								label={`Org source of ${node.title}`}
								onready={() => (editorUp = true)}
							/>
						{/key}
					</div>
				{/if}
				{#if !pane.editing || !editorUp}
					{#if contents.length}
						<div class="toc-inline">
							<Toc
								entries={contents}
								baseLevel={node.level}
								container={() => article}
								variant="inline"
							/>
						</div>
					{/if}
					<div class="prose node-body">
						<Blocks
							nodes={body}
							ctx={{
								path: node.file,
								levelOffset: node.level,
								interactive: true,
								mentions: range ? { range } : {},
							}}
						/>
					</div>
				{/if}
			</div>

			<div class="inline-links">
				<Backlinks {id} />
				<Mentions path={node.file} {range} />
			</div>
		</article>

		{#if app.panelOpen}
			<aside class="side-panel" aria-label="Connections">
				{#if contents.length && !pane.editing}
					<Toc
						entries={contents}
						baseLevel={node.level}
						container={() => article}
						variant="panel"
					/>
				{/if}
				<Backlinks {id} />
				<Mentions path={node.file} {range} />
			</aside>
		{/if}
	</div>
{:else}
	<div class="missing">
		<h1>Note not found</h1>
		<p>There's no node with the ID <code>{id}</code> in this vault.</p>
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
	.node-layout {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		min-height: 100%;
	}
	.node {
		width: 100%;
		max-width: calc(var(--read-w) + 6rem);
		margin: 0 auto;
		padding: 3.25rem 3rem 6rem;
	}
	/* The breadcrumb and the toolbar share the first row: the breadcrumb gets
	   whatever room the buttons leave (and wraps), so they never overlap. */
	.node-header {
		position: relative;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		column-gap: 0.75rem;
		margin-bottom: 2rem;
	}
	.node-header > :global(*) {
		grid-column: 1 / -1;
	}
	.node-header > .toolbar {
		position: static;
		grid-column: 2;
		grid-row: 1;
		align-self: start;
		margin-top: -0.35rem;
	}
	.node-header > .crumbs {
		grid-column: 1;
		grid-row: 1;
		padding-right: 0;
	}
	/* Narrow screens: secondary buttons show just their icon (the label stays for screen readers). */
	@media (max-width: 720px) {
		.toolbar .label {
			position: absolute;
			width: 1px;
			height: 1px;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
		}
	}
	.toolbar {
		position: absolute;
		top: -0.35rem;
		right: 0;
		display: flex;
		gap: 0.4rem;
	}
	/* The toolbar's floating copy: sticks to the top of the page (below the
	   clock bar and the daily note's date bar) and slides in on scroll up. */
	.float-wrap {
		position: sticky;
		top: var(--sticky-top, var(--clock-h, 0px));
		z-index: 4;
		height: 0;
	}
	.floating {
		top: 0.5rem;
		padding: 0.3rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: color-mix(in oklab, var(--bg-raised) 92%, transparent);
		box-shadow: var(--shadow-md);
		backdrop-filter: blur(12px);
		visibility: hidden;
		opacity: 0;
		transform: translateY(-0.75rem);
		transition:
			opacity 0.15s var(--ease),
			transform 0.15s var(--ease),
			visibility 0s linear 0.15s;
	}
	.floating.shown {
		visibility: visible;
		opacity: 1;
		transform: none;
		transition:
			opacity 0.15s var(--ease),
			transform 0.15s var(--ease);
	}
	@media (prefers-reduced-motion: reduce) {
		.floating,
		.floating.shown {
			transition: none;
		}
	}
	.crumbs {
		padding-right: 7.5rem;
		overflow-wrap: anywhere;
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.3rem;
		min-height: 1.25rem;
		margin-bottom: 0.9rem;
		color: var(--text-faint);
		font-size: 0.8rem;
		font-weight: 500;
	}
	.crumbs a {
		color: var(--text-muted);
		text-decoration: none;
	}
	.crumbs a:hover {
		color: var(--accent);
	}
	.crumbs .path {
		font-family: var(--font-mono);
		font-size: 0.74rem;
	}
	h1 {
		margin: 0;
		font-family: var(--font-read);
		font-size: clamp(2rem, 1.4rem + 2vw, 2.85rem);
		font-weight: 600;
		line-height: 1.12;
		letter-spacing: -0.022em;
		text-wrap: balance;
	}
	h1.done {
		color: var(--text-muted);
	}
	h1 :global(.kw) {
		vertical-align: 0.5em;
		margin-right: 0.15em;
		font-size: 0.32em;
	}
	.aliases {
		margin: 0.6rem 0 0;
		color: var(--text-muted);
		font-family: var(--font-read);
		font-size: 1.05rem;
	}
	.meta[hidden] {
		display: none;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
		margin-top: 1.1rem;
	}
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		height: 1.65rem;
		padding: 0 0.6rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.78rem;
		font-weight: 550;
		text-decoration: none;
		white-space: nowrap;
	}
	a.chip:hover {
		border-color: var(--accent);
		color: var(--accent);
	}
	.chip.tag {
		color: var(--accent-strong);
		background: var(--accent-softer);
		border-color: transparent;
	}
	.chip.deadline {
		color: var(--danger);
		background: var(--danger-soft);
		border-color: transparent;
	}
	.chip.scheduled {
		color: var(--next);
		background: var(--next-soft);
		border-color: transparent;
	}
	.chip.ref {
		max-width: 18rem;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.node-body :global(> .org-section:first-child) {
		margin-top: 0.5rem;
	}
	.inline-links {
		margin-top: 3.5rem;
		padding-top: 2rem;
		border-top: 1px solid var(--border);
	}
	.side-panel {
		display: none;
	}
	/* Wide enough (the pane, on wide screens, or the window) for backlinks beside the note. */
	@container pane (min-width: 976px) {
		.node-layout.with-panel {
			grid-template-columns: minmax(0, 1fr) var(--panel-w);
		}
		.with-panel .inline-links,
		.with-panel .toc-inline {
			display: none;
		}
		.side-panel {
			display: block;
			position: sticky;
			top: 0;
			height: var(--pane-h, 100dvh);
			overflow-y: auto;
			padding: 3.25rem 1.5rem 2rem;
			border-left: 1px solid var(--border);
			background: var(--bg-raised);
		}
	}
	@media (max-width: 720px) {
		.node {
			padding: 1.5rem 1rem 6rem;
		}
	}
	.missing {
		max-width: 32rem;
		margin: 6rem auto;
		padding: 0 1rem;
		text-align: center;
	}
	.missing a {
		color: var(--accent);
	}
</style>
