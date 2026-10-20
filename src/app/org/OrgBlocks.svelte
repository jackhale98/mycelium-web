<script lang="ts">
	import type { OrgNode } from '$lib/org';
	import { startOf } from '$lib/org';
	import { app } from '../state.svelte';
	import Inline from './OrgInline.svelte';
	import Self from './OrgBlocks.svelte';
	import Section from './OrgSection.svelte';
	import OrgTable from './OrgTable.svelte';
	import type { RenderContext } from './context';

	let { nodes, ctx }: { nodes: OrgNode[]; ctx: RenderContext } = $props();

	const HIDDEN = new Set([
		'property-drawer',
		'keyword',
		'planning',
		'comment',
		'comment-block',
		'diary-sexp',
		'clock',
	]);
</script>

{#each nodes as node, i (i)}
	{#if HIDDEN.has(node.type)}
		<!-- metadata is shown elsewhere -->
	{:else if node.type === 'section'}
		<Section section={node} {ctx} />
	{:else if node.type === 'paragraph'}
		<p><Inline nodes={node.children} {ctx} /></p>
	{:else if node.type === 'plain-list'}
		{#if node.listType === 'descriptive'}
			<dl>
				{#each node.children as item, j (j)}
					{@const [tag, ...rest] = item.children as OrgNode[]}
					<dt>
						{#if tag && tag.type === 'list-item-tag'}<Inline nodes={tag.children} {ctx} />{/if}
					</dt>
					<dd>
						<Self
							nodes={tag && tag.type === 'list-item-tag' ? rest : (item.children as OrgNode[])}
							{ctx}
						/>
					</dd>
				{/each}
			</dl>
		{:else}
			<svelte:element
				this={node.listType === 'ordered' ? 'ol' : 'ul'}
				class:checklist={node.children.some((c) => c.checkbox)}
			>
				{#each node.children as item, j (j)}
					<li class:checked={item.checkbox === 'on'} class:has-box={item.checkbox !== null}>
						{#if item.checkbox}
							<input
								type="checkbox"
								class="box"
								checked={item.checkbox === 'on'}
								indeterminate={item.checkbox === 'trans'}
								disabled={!ctx.interactive}
								aria-label="Toggle item"
								onchange={() => app.toggleCheckbox(ctx.path, startOf(item))}
							/>
						{/if}
						<div class="li-body"><Self nodes={item.children as OrgNode[]} {ctx} /></div>
					</li>
				{/each}
			</svelte:element>
		{/if}
	{:else if node.type === 'table'}
		{#if node.tableType === 'org'}
			<OrgTable node={node as never} {ctx} />
		{:else}
			<pre class="block">{node.value}</pre>
		{/if}
	{:else if node.type === 'src-block'}
		<figure class="code">
			{#if node.language}<figcaption>{node.language}</figcaption>{/if}
			<pre><code>{node.value.replace(/\n$/, '')}</code></pre>
		</figure>
	{:else if node.type === 'example-block' || node.type === 'fixed-width'}
		<pre class="block">{node.value.replace(/\n$/, '')}</pre>
	{:else if node.type === 'export-block'}
		<figure class="code">
			<figcaption>export · {node.backend}</figcaption>
			<pre><code>{node.value.replace(/\n$/, '')}</code></pre>
		</figure>
	{:else if node.type === 'latex-environment'}
		<pre class="block latex">{node.value}</pre>
	{:else if node.type === 'quote-block'}
		<blockquote><Self nodes={node.children} {ctx} /></blockquote>
	{:else if node.type === 'verse-block'}
		<div class="verse"><Self nodes={node.children} {ctx} /></div>
	{:else if node.type === 'center-block'}
		<div class="center"><Self nodes={node.children} {ctx} /></div>
	{:else if node.type === 'special-block'}
		<aside class="special" data-kind={node.blockType}>
			<span class="special-label">{node.blockType}</span>
			<Self nodes={node.children} {ctx} />
		</aside>
	{:else if node.type === 'drawer'}
		<details class="drawer">
			<summary>{node.name}</summary>
			<Self nodes={node.children} {ctx} />
		</details>
	{:else if node.type === 'horizontal-rule'}
		<hr />
	{:else if node.type === 'footnote-definition'}
		<div class="footnote" id={`fn-${node.label}`}>
			<a class="fn-label" href={`#fnref-${node.label}`}>{node.label}</a>
			<div><Self nodes={node.children} {ctx} /></div>
		</div>
	{:else if 'children' in node && Array.isArray(node.children)}
		<Self nodes={node.children as OrgNode[]} {ctx} />
	{/if}
{/each}
