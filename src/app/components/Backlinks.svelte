<script lang="ts">
	import { parseOrg } from '$lib/org';
	import Blocks from '../org/OrgBlocks.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	let { id }: { id: string } = $props();

	const groups = $derived.by(() => {
		void app.rev;
		return app.vault.backlinksOf(id);
	});
	const forward = $derived.by(() => {
		void app.rev;
		return app.vault.forwardLinks(id);
	});
	const count = $derived(groups.reduce((n, g) => n + g.links.length, 0));
	/** Links and citations to this note's ROAM_REFS (org-roam's "Reflinks"). */
	const refGroups = $derived.by(() => {
		void app.rev;
		return app.vault.reflinksOf(id);
	});
	const refCount = $derived(refGroups.reduce((n, g) => n + g.links.length, 0));
</script>

<section class="panel-section" aria-labelledby="bl-heading">
	<h2 id="bl-heading" class="panel-title">
		<Icon name="backlink" size={15} />
		Backlinks
		<span class="count">{count}</span>
	</h2>
	{#if groups.length === 0}
		<p class="empty">No notes link here yet.</p>
	{:else}
		<ul class="groups">
			{#each groups as group (group.from.id)}
				<li class="group">
					<a class="group-title" href={href.node(group.from.id)}>
						{group.from.title}
						{#if group.from.olp.length}<span class="olp">{group.from.olp.join(' › ')}</span>{/if}
					</a>
					{#each group.links as link (link.pos)}
						<div class="context prose compact">
							<Blocks
								nodes={parseOrg(link.context).children}
								ctx={{ path: group.from.file, levelOffset: 0, interactive: false, highlight: id }}
							/>
						</div>
					{/each}
				</li>
			{/each}
		</ul>
	{/if}
</section>

{#if refGroups.length}
	<section class="panel-section" aria-labelledby="rl-heading">
		<h2 id="rl-heading" class="panel-title">
			<Icon name="external" size={15} />
			Reference backlinks
			<span class="count">{refCount}</span>
		</h2>
		<ul class="groups">
			{#each refGroups as group (group.from.id)}
				<li class="group">
					<a class="group-title" href={href.node(group.from.id)}>
						{group.from.title}
						{#if group.from.olp.length}<span class="olp">{group.from.olp.join(' › ')}</span>{/if}
					</a>
					{#each group.links as link (link.pos)}
						<div class="context prose compact">
							<Blocks
								nodes={parseOrg(link.context).children}
								ctx={{ path: group.from.file, levelOffset: 0, interactive: false }}
							/>
						</div>
					{/each}
				</li>
			{/each}
		</ul>
	</section>
{/if}

{#if forward.length}
	<section class="panel-section" aria-labelledby="fl-heading">
		<h2 id="fl-heading" class="panel-title">
			<Icon name="link" size={15} />
			Links from this note
			<span class="count">{forward.length}</span>
		</h2>
		<ul class="forward">
			{#each forward as { node } (node.id)}
				<li>
					<a href={href.node(node.id)}><span class="dot" aria-hidden="true"></span>{node.title}</a>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<style>
	.panel-section + .panel-section {
		margin-top: 1.75rem;
	}
	.panel-title {
		display: flex;
		align-items: center;
		gap: 0.45rem;
		margin: 0 0 0.75rem;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.count {
		margin-left: auto;
		min-width: 1.5rem;
		padding: 0.05rem 0.4rem;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-muted);
		font-size: 0.7rem;
		text-align: center;
		letter-spacing: 0;
	}
	.empty {
		margin: 0;
		color: var(--text-faint);
		font-size: 0.85rem;
	}
	.groups,
	.forward {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.group {
		padding: 0.8rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
	}
	.group + .group {
		margin-top: 0.6rem;
	}
	.group-title {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		color: var(--text);
		font-weight: 600;
		font-size: 0.9rem;
		text-decoration: none;
	}
	.group-title:hover {
		color: var(--accent);
	}
	.olp {
		color: var(--text-faint);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.context {
		margin-top: 0.45rem;
		padding-left: 0.65rem;
		border-left: 2px solid var(--border);
	}
	.forward li a {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		padding: 0.4rem 0.5rem;
		margin: 0 -0.5rem;
		border-radius: var(--radius-sm);
		color: var(--text-2);
		font-size: 0.88rem;
		text-decoration: none;
	}
	.forward li a:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--accent);
		opacity: 0.7;
	}
</style>
