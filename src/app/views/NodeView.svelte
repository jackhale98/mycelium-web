<script lang="ts">
	import type { OrgNode, Section } from 'uniorg';
	import { startOf, type RoamNode } from '$lib/org';
	import Backlinks from '../components/Backlinks.svelte';
	import OrgEditor from '../editor/OrgEditor.svelte';
	import DateChip from '../org/DateChip.svelte';
	import Icon from '../components/Icon.svelte';
	import Blocks from '../org/OrgBlocks.svelte';
	import TodoChip from '../org/TodoChip.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import { scrollToSearch } from '../org/scroll-to';
	import { tick } from 'svelte';

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

	let article: HTMLElement | undefined = $state();
	// Scroll to the link's target once the page has rendered.
	$effect(() => {
		const search = at;
		const el = article;
		const file = node ? app.vault.file(node.file) : undefined;
		if (!search || !el || !file || app.editing) return;
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
	const done = $derived(!!node?.todo && keywords.doneKeywords.includes(node.todo));

	$effect(() => {
		document.title = node ? `${node.title} · Mycelium` : 'Not found · Mycelium';
	});

	// The editor reads editAt once on open; clear it for next time.
	$effect(() => {
		if (!app.editing) app.editAt = null;
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
					// Small moves in the other direction reset the count: a deliberate
					// upward scroll of ~40px shows it, any downward scroll hides it.
					travel = dy < 0 ? Math.min(0, travel) + dy : 0;
					if (dy > 0) floating = false;
					else if (travel < -40) floating = true;
				}
				last = y;
			}
		};
		document.addEventListener('scroll', onScroll, { capture: true, passive: true });
		return () => document.removeEventListener('scroll', onScroll, { capture: true });
	});

	function onkeydown(e: KeyboardEvent) {
		// The editor lives in a shadow root, so look at the real target.
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

{#snippet tools(n: RoamNode)}
	<a
		class="btn small icon-only"
		href={href.graph(n.id)}
		title="Graph around this note"
		aria-label="Graph around this note"><Icon name="graph" size={15} /></a
	>
	{#if n.level > 0 && !app.editing}
		<button
			type="button"
			class="btn small"
			aria-haspopup="dialog"
			onclick={() => (app.headingSheet = { path: n.file, pos: n.pos })}
			><Icon name="settings" size={14} />Properties</button
		>
	{/if}
	<button
		type="button"
		class="btn small"
		class:primary={app.editing}
		aria-pressed={app.editing}
		title={app.editing ? 'Back to reading (Esc)' : 'Edit the org source (E)'}
		onclick={() => (app.editing = !app.editing)}
		><Icon name={app.editing ? 'eye' : 'edit'} size={14} />{app.editing ? 'Read' : 'Edit'}</button
	>
{/snippet}

<svelte:window {onkeydown} />

{#if node}
	<div class="node-layout" class:with-panel={app.panelOpen}>
		<article class="node" aria-labelledby="node-title" bind:this={article}>
			<div class="float-wrap" bind:this={floatWrap}>
				<div class="toolbar floating" class:shown={floating} inert={!floating}>
					{@render tools(node)}
				</div>
			</div>
			<header class="node-header" bind:this={header}>
				<div class="toolbar">{@render tools(node)}</div>
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
				<h1 id="node-title" class:done class:sr-only={app.editing && node.level === 0}>
					{#if node.todo}
						<TodoChip
							keyword={node.todo}
							config={keywords}
							onchange={(next) => app.setTodo(node.file, node.pos, next)}
						/>
					{/if}
					{displayTitle ?? node.title}
				</h1>
				{#if node.aliases.length && !app.editing}
					<p class="aliases">
						Also known as {#each node.aliases as alias, i (alias)}<em>{alias}</em>{i <
							node.aliases.length - 1
								? ', '
								: ''}{/each}
					</p>
				{/if}
				<div class="meta" hidden={app.editing}>
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

			{#if app.editing}
				{#key node.file}
					<OrgEditor
						path={node.file}
						focusAt={app.editAt ?? (node.level > 0 ? node.pos : null)}
						label={`Org source of ${node.title}`}
					/>
				{/key}
			{:else}
				<div class="prose node-body">
					<Blocks
						nodes={body}
						ctx={{ path: node.file, levelOffset: node.level, interactive: true }}
					/>
				</div>
			{/if}

			<div class="inline-links">
				<Backlinks {id} />
			</div>
		</article>

		{#if app.panelOpen}
			<aside class="side-panel" aria-label="Connections">
				<Backlinks {id} />
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
	.node-header {
		position: relative;
		margin-bottom: 2rem;
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
	@media (min-width: 1240px) {
		.node-layout.with-panel {
			grid-template-columns: minmax(0, 1fr) var(--panel-w);
		}
		.with-panel .inline-links {
			display: none;
		}
		.side-panel {
			display: block;
			position: sticky;
			top: var(--clock-h, 0px);
			height: calc(100dvh - var(--clock-h, 0px));
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
