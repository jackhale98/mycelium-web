<script lang="ts">
	import type { OrgNode, Section } from 'uniorg';
	import { startOf } from '$lib/org';
	import Backlinks from '../components/Backlinks.svelte';
	import Icon from '../components/Icon.svelte';
	import Blocks from '../org/OrgBlocks.svelte';
	import TodoChip from '../org/TodoChip.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import { tsLabel } from '../util';

	let { id, eyebrow, displayTitle }: { id: string; eyebrow?: string; displayTitle?: string } =
		$props();

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
</script>

{#if node}
	<div class="node-layout" class:with-panel={app.panelOpen}>
		<article class="node" aria-labelledby="node-title">
			<header class="node-header">
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
				<h1 id="node-title" class:done>
					{#if node.todo}
						<TodoChip
							keyword={node.todo}
							config={keywords}
							onchange={(next) => app.setTodo(node.file, node.pos, next)}
						/>
					{/if}
					{displayTitle ?? node.title}
				</h1>
				{#if node.aliases.length}
					<p class="aliases">
						Also known as {#each node.aliases as alias, i (alias)}<em>{alias}</em>{i <
							node.aliases.length - 1
								? ', '
								: ''}{/each}
					</p>
				{/if}
				<div class="meta">
					{#each node.tags as tag (tag)}<a class="chip tag" href={href.tags(tag)}>#{tag}</a>{/each}
					{#if node.deadline}<span class="chip deadline"
							><Icon name="alert" size={13} />Due {tsLabel(node.deadline)}</span
						>{/if}
					{#if node.scheduled}<span class="chip scheduled"
							><Icon name="calendar" size={13} />{tsLabel(node.scheduled)}</span
						>{/if}
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

			<div class="prose node-body">
				<Blocks
					nodes={body}
					ctx={{ path: node.file, levelOffset: node.level, interactive: true }}
				/>
			</div>

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
		margin-bottom: 2rem;
	}
	.crumbs {
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
			top: 0;
			height: 100dvh;
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
