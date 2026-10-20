<script lang="ts">
	import type { OrgNode } from '$lib/org';
	import { app } from '../state.svelte';
	import { href } from '../router.svelte';
	import Self from './OrgInline.svelte';
	import { SAFE_SCHEMES, type RenderContext } from './context';

	let { nodes, ctx }: { nodes: OrgNode[]; ctx: RenderContext } = $props();

	function target(linkType: string, path: string) {
		void app.rev;
		if (linkType === 'id') {
			const node = app.vault.node(path);
			return node
				? { kind: 'node' as const, id: node.id, href: href.node(node.id), title: node.title }
				: { kind: 'broken' as const };
		}
		if (linkType === 'roam') {
			const id = app.vault.resolve({ type: 'roam', dest: path });
			return id
				? {
						kind: 'node' as const,
						id,
						href: href.node(id),
						title: app.vault.node(id)?.title ?? path,
					}
				: { kind: 'broken' as const };
		}
		if (linkType === 'file' && /\.org$/i.test(path)) {
			const clean = path.replace(/^\.\//, '');
			const node = app.vault.fileNode(clean);
			return node
				? { kind: 'node' as const, id: node.id, href: href.node(node.id), title: node.title }
				: { kind: 'broken' as const };
		}
		if (SAFE_SCHEMES.has(linkType))
			return { kind: 'external' as const, href: `${linkType}:${path}` };
		return { kind: 'other' as const };
	}
</script>

{#each nodes as node, i (i)}
	{#if node.type === 'text'}{node.value}{:else if node.type === 'bold'}<strong
			><Self nodes={node.children} {ctx} /></strong
		>
	{:else if node.type === 'italic'}<em><Self nodes={node.children} {ctx} /></em>
	{:else if node.type === 'underline'}<span class="u"><Self nodes={node.children} {ctx} /></span>
	{:else if node.type === 'strike-through'}<s><Self nodes={node.children} {ctx} /></s>
	{:else if node.type === 'code' || node.type === 'verbatim'}<code>{node.value}</code>
	{:else if node.type === 'link'}
		{@const t = target(node.linkType, node.path)}
		{#if t.kind === 'node'}
			<a class="ilink" class:self={t.id === ctx.highlight} href={t.href} title={t.title}
				>{#if node.children.length}<Self nodes={node.children} {ctx} />{:else}{t.title}{/if}</a
			>
		{:else if t.kind === 'external'}
			<a class="xlink" href={t.href} target="_blank" rel="noopener noreferrer"
				>{#if node.children.length}<Self nodes={node.children} {ctx} />{:else}{node.path}{/if}<span
					class="sr-only"
				>
					(opens in a new tab)</span
				></a
			>
		{:else if t.kind === 'broken'}
			<span class="blink" title="This note isn't in the vault"
				>{#if node.children.length}<Self
						nodes={node.children}
						{ctx}
					/>{:else}{node.rawLink}{/if}</span
			>
		{:else}
			<span class="olink" title={node.rawLink}
				>{#if node.children.length}<Self
						nodes={node.children}
						{ctx}
					/>{:else}{node.rawLink}{/if}</span
			>
		{/if}
	{:else if node.type === 'timestamp'}<time
			class="ts"
			class:inactive={node.timestampType.startsWith('inactive')}
			>{node.rawValue.replace(/^[<[]|[>\]]$/g, '')}</time
		>
	{:else if node.type === 'entity'}{node.utf8}
	{:else if node.type === 'line-break'}<br />
	{:else if node.type === 'superscript'}<sup><Self nodes={node.children} {ctx} /></sup>
	{:else if node.type === 'subscript'}<sub><Self nodes={node.children} {ctx} /></sub>
	{:else if node.type === 'statistics-cookie'}<span class="cookie" title="Progress"
			>{node.value.replace(/^\[|\]$/g, '')}</span
		>
	{:else if node.type === 'footnote-reference'}<sup class="fn"
			><a href={`#fn-${node.label}`} id={`fnref-${node.label}`}>{node.label}</a></sup
		>
	{:else if node.type === 'latex-fragment'}<code class="latex">{node.value}</code>
	{:else if node.type === 'citation'}<span class="cite">[<Self nodes={node.children} {ctx} />]</span
		>
	{:else if node.type === 'citation-reference'}<Self nodes={node.children} {ctx} />
	{:else if node.type === 'citation-key'}@{node.key}
	{:else if 'children' in node && Array.isArray(node.children)}<Self
			nodes={node.children as OrgNode[]}
			{ctx}
		/>
	{/if}
{/each}
