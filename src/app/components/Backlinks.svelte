<script lang="ts">
	import { parseOrg } from '$lib/org';
	import Blocks from '../org/OrgBlocks.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';
	import { unlinkedReferences } from '$lib/vault/unlinked';

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

	/** org-roam's unlinked references: computed only when opened (it's a full-text search). */
	let showUnlinked = $state(false);
	const unlinked = $derived.by(() => {
		if (!showUnlinked) return [];
		void app.rev;
		const node = app.vault.node(id);
		if (!node) return [];
		return unlinkedReferences(
			node,
			[...app.vault.files.values()].map((f) => ({ path: f.path, source: f.source })),
		);
	});
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

<section class="panel-section" aria-labelledby="ul-heading">
	<h2 id="ul-heading" class="panel-title">
		<button
			type="button"
			class="unlinked-toggle"
			aria-expanded={showUnlinked}
			onclick={() => (showUnlinked = !showUnlinked)}
			><Icon name={showUnlinked ? 'chevronDown' : 'chevronRight'} size={14} />Unlinked references</button
		>
		{#if showUnlinked}<span class="count">{unlinked.length}</span>{/if}
	</h2>
	{#if showUnlinked}
		{#if unlinked.length === 0}
			<p class="empty">No other note mentions this one without linking it.</p>
		{:else}
			<ul class="unlinked">
				{#each unlinked as ref (`${ref.file}:${ref.offset}`)}
					{@const before = ref.context.slice(0, ref.column - 1)}
					{@const after = ref.context.slice(ref.column - 1 + ref.text.length)}
					<li>
						<a class="where" href={app.linkTarget(ref.file, null)?.href ?? null}
							>{app.vault.file(ref.file)?.index.title || ref.file}<span class="pos"
								>:{ref.line}</span
							></a
						>
						<p class="line">
							{before.length > 60 ? `…${before.slice(-60)}` : before}<mark>{ref.text}</mark
							>{after.length > 80 ? `${after.slice(0, 80)}…` : after}
						</p>
						<button
							type="button"
							class="btn small"
							title={`Turn “${ref.text}” into a link to this note`}
							onclick={() => app.linkMention(ref.file, ref.offset, ref.text, id)}>Link</button
						>
					</li>
				{/each}
			</ul>
		{/if}
	{/if}
</section>

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
	.unlinked-toggle {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		padding: 0;
		border: 0;
		background: none;
		color: inherit;
		font: inherit;
		letter-spacing: inherit;
		text-transform: inherit;
	}
	.unlinked {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.unlinked li {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.15rem 0.5rem;
		align-items: start;
	}
	.unlinked .where {
		color: var(--link);
		font-size: 0.82rem;
		font-weight: 600;
	}
	.unlinked .pos {
		color: var(--text-faint);
		font-weight: 400;
	}
	.unlinked .line {
		grid-column: 1;
		margin: 0;
		color: var(--text-muted);
		font-size: 0.84rem;
		overflow-wrap: anywhere;
	}
	.unlinked .btn {
		grid-column: 2;
		grid-row: 1 / span 2;
	}
	.unlinked mark {
		background: color-mix(in oklab, var(--accent) 18%, transparent);
		color: var(--text);
	}
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
