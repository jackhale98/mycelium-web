<script lang="ts">
	import type { Headline, OrgNode, Planning, PropertyDrawer, Section } from 'uniorg';
	import { parseTimestamp, startOf } from '$lib/org';
	import { tsLabel } from '../util';
	import Icon from '../components/Icon.svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Blocks from './OrgBlocks.svelte';
	import Inline from './OrgInline.svelte';
	import TodoChip from './TodoChip.svelte';
	import type { RenderContext } from './context';

	let { section, ctx }: { section: Section; ctx: RenderContext } = $props();

	const headline = $derived(
		section.children.find((c) => c.type === 'headline') as Headline | undefined,
	);
	const planning = $derived(
		section.children.find((c) => c.type === 'planning') as Planning | undefined,
	);
	const drawer = $derived(
		section.children.find((c) => c.type === 'property-drawer') as PropertyDrawer | undefined,
	);
	const id = $derived(drawer?.children.find((p) => p.key.toUpperCase() === 'ID')?.value.trim());
	const body = $derived(section.children.filter((c) => c !== headline) as OrgNode[]);
	const level = $derived(Math.min(6, Math.max(2, (headline?.level ?? 1) - ctx.levelOffset + 1)));
	const keywords = $derived.by(() => {
		void app.rev;
		return app.vault.file(ctx.path)?.index.keywords ?? app.vault.keywords;
	});
	const done = $derived(
		!!headline?.todoKeyword && keywords.doneKeywords.includes(headline.todoKeyword),
	);

	let open = $state(true);

	const when = (raw: string) => {
		const ts = parseTimestamp(raw);
		return ts ? `${tsLabel(ts)}${ts.repeater ? ` · repeats ${ts.repeater}` : ''}` : raw;
	};
</script>

{#if headline && !headline.commented}
	<section class="org-section" data-level={headline.level}>
		<div class="heading-row">
			<button
				type="button"
				class="fold"
				aria-expanded={open}
				aria-label={open ? 'Collapse section' : 'Expand section'}
				onclick={() => (open = !open)}
			>
				<span class="fold-icon" class:closed={!open}><Icon name="chevronDown" size={16} /></span>
			</button>
			<svelte:element this={`h${level}`} class="heading" class:done>
				{#if headline.todoKeyword}
					<TodoChip
						keyword={headline.todoKeyword}
						config={keywords}
						onchange={ctx.interactive
							? (next) => app.setTodo(ctx.path, startOf(headline), next)
							: undefined}
					/>
				{/if}
				{#if headline.priority}<span class="prio" title={`Priority ${headline.priority}`}
						>{headline.priority}</span
					>{/if}
				<span class="heading-text"><Inline nodes={headline.children} {ctx} /></span>
				{#if id}
					<a
						class="node-link"
						href={href.node(id)}
						title="Open as its own note"
						aria-label="Open this heading as a note"><Icon name="arrowRight" size={15} /></a
					>
				{/if}
			</svelte:element>
			{#if headline.tags.length}
				<span class="htags"
					>{#each headline.tags as tag (tag)}<a class="tag" href={href.tags(tag)}>#{tag}</a
						>{/each}</span
				>
			{/if}
		</div>
		{#if open}
			{#if planning}
				<div class="planning">
					{#if planning.deadline}<span class="plan deadline"
							><Icon name="alert" size={13} />Due
							<time>{when(planning.deadline.rawValue)}</time></span
						>{/if}
					{#if planning.scheduled}<span class="plan scheduled"
							><Icon name="calendar" size={13} />Scheduled
							<time>{when(planning.scheduled.rawValue)}</time></span
						>{/if}
					{#if planning.closed}<span class="plan closed"
							><Icon name="check" size={13} />Closed
							<time>{when(planning.closed.rawValue)}</time></span
						>{/if}
				</div>
			{/if}
			<div class="section-body"><Blocks nodes={body} {ctx} /></div>
		{/if}
	</section>
{/if}
