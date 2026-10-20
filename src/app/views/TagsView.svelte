<script lang="ts">
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';

	let { tag }: { tag: string | null } = $props();

	const tags = $derived.by(() => {
		void app.rev;
		return [...app.vault.tags.entries()]
			.map(([t, ids]) => ({ tag: t, count: ids.size }))
			.sort((a, b) => a.tag.localeCompare(b.tag));
	});
	const nodes = $derived.by(() => {
		void app.rev;
		if (!tag) return [];
		return [...(app.vault.tags.get(tag) ?? [])]
			.map((id) => app.vault.node(id)!)
			.sort((a, b) => a.title.localeCompare(b.title));
	});

	$effect(() => {
		document.title = `${tag ? `#${tag}` : 'Tags'} · Mycelium`;
	});
</script>

<div class="tags-page">
	<h1>{tag ? `#${tag}` : 'Tags'}</h1>
	<nav class="tag-list" aria-label="All tags">
		{#each tags as t (t.tag)}
			<a href={href.tags(t.tag)} aria-current={t.tag === tag ? 'page' : undefined}
				>#{t.tag}<span>{t.count}</span></a
			>
		{/each}
	</nav>
	{#if tag}
		<ul class="results">
			{#each nodes as node (node.id)}
				<li>
					<a href={href.node(node.id)}>
						<span class="title">{node.title}</span>
						<span class="sub">{node.olp.length ? node.olp.join(' › ') : node.file}</span>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.tags-page {
		max-width: 52rem;
		margin: 0 auto;
		padding: 3.25rem 3rem 6rem;
	}
	h1 {
		margin: 0 0 1.5rem;
		font-family: var(--font-read);
		font-size: 2.6rem;
		font-weight: 600;
		letter-spacing: -0.022em;
	}
	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 0.45rem;
	}
	.tag-list a {
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		height: 2rem;
		padding: 0 0.4rem 0 0.8rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.82rem;
		font-weight: 550;
		text-decoration: none;
	}
	.tag-list a[aria-current='page'] {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.tag-list span {
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: color-mix(in oklab, currentColor 12%, transparent);
		font-size: 0.7rem;
	}
	.results {
		margin: 2rem 0 0;
		padding: 0;
		list-style: none;
		border-top: 1px solid var(--border);
	}
	.results a {
		display: flex;
		flex-direction: column;
		padding: 0.85rem 0.25rem;
		border-bottom: 1px solid var(--border);
		color: inherit;
		text-decoration: none;
	}
	.results a:hover .title {
		color: var(--accent);
	}
	.title {
		font-family: var(--font-read);
		font-size: 1.15rem;
		font-weight: 600;
	}
	.sub {
		color: var(--text-faint);
		font-size: 0.78rem;
	}
	@media (max-width: 720px) {
		.tags-page {
			padding: 1.75rem 1rem 6rem;
		}
	}
</style>
