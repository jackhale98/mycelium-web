<script lang="ts">
	import type { Headline, OrgNode, Planning, PropertyDrawer, Section } from 'uniorg';
	import { parseTimestamp, startOf } from '$lib/org';
	import { tsLabel } from '../util';
	import Icon from '../components/Icon.svelte';
	import SwipeRow from '../components/SwipeRow.svelte';
	import { swipeFor } from '../swipe';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Blocks from './OrgBlocks.svelte';
	import DateChip from './DateChip.svelte';
	import HeadingActions from './HeadingActions.svelte';
	import Inline from './OrgInline.svelte';
	import TodoChip from './TodoChip.svelte';
	import type { RenderContext } from './context';
	import { folds } from '../folds.svelte';

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
	/** The heading's own text, and its child headings: they fold separately. */
	const text = $derived(body.filter((c) => c.type !== 'section'));
	const kids = $derived(body.filter((c) => c.type === 'section'));
	const level = $derived(Math.min(6, Math.max(2, (headline?.level ?? 1) - ctx.levelOffset + 1)));
	const keywords = $derived.by(() => {
		void app.rev;
		return app.vault.file(ctx.path)?.index.keywords ?? app.vault.keywords;
	});
	const done = $derived(
		!!headline?.todoKeyword && keywords.doneKeywords.includes(headline.todoKeyword),
	);

	/** An open task somewhere under this heading (Hide done keeps the heading then). */
	const openInside = $derived.by(() => {
		const look = (nodes: readonly OrgNode[]): boolean =>
			nodes.some((n) => {
				if (n.type !== 'section') return false;
				const h = n.children.find((c) => c.type === 'headline') as Headline | undefined;
				const kw = h?.todoKeyword;
				if (kw && !keywords.doneKeywords.includes(kw)) return true;
				return look(n.children as OrgNode[]);
			});
		return look(section.children as OrgNode[]);
	});
	/** Hidden by Hide done: done, with nothing still open under it. */
	const hidden = $derived(done && ctx.interactive && app.hideDone && !openInside);

	// Folding, as org's TAB cycles it (folded, children, subtree).
	const vis = $derived(folds.at(ctx.path, headline ? startOf(headline) : 0));
	const showText = $derived(vis === 'all' || vis === 'children');
	const open = $derived(vis !== 'folded');
	function cycle() {
		const source = app.vault.file(ctx.path)?.source;
		if (source && headline) folds.cycle(ctx.path, source, startOf(headline));
	}
	let editing = $state(false);

	const offset = $derived(headline ? startOf(headline) : 0);
	const dates = $derived({
		SCHEDULED: planning?.scheduled ? parseTimestamp(planning.scheduled.rawValue) : null,
		DEADLINE: planning?.deadline ? parseTimestamp(planning.deadline.rawValue) : null,
		CLOSED: planning?.closed ? parseTimestamp(planning.closed.rawValue) : null,
	});

	// A task heading answers swipes on touch screens, as agenda rows do.
	const swipe = $derived.by(() => {
		void app.rev;
		return ctx.interactive && headline?.todoKeyword
			? swipeFor(ctx.path, offset, headline.todoKeyword)
			: null;
	});

	const when = (raw: string) => {
		const ts = parseTimestamp(raw);
		return ts ? `${tsLabel(ts)}${ts.repeater ? ` · repeats ${ts.repeater}` : ''}` : raw;
	};
</script>

{#if headline && !headline.commented && !hidden}
	<section class="org-section" data-level={headline.level} data-pos={offset}>
		{#if swipe}
			<!-- The heading and its dates swipe together, as one task. -->
			<SwipeRow main={swipe.main} actions={swipe.actions}
				>{@render headingRow(headline)}{#if showText}{@render planningRow()}{/if}</SwipeRow
			>
		{:else}
			{@render headingRow(headline)}
		{/if}
		{#if editing}
			<HeadingActions
				path={ctx.path}
				{offset}
				todo={headline.todoKeyword ?? null}
				priority={headline.priority ?? null}
				tags={headline.tags}
				scheduled={dates.SCHEDULED}
				deadline={dates.DEADLINE}
				id={id ?? null}
				{keywords}
				onclose={() => (editing = false)}
			/>
		{/if}
		{#if showText}
			{#if !swipe}{@render planningRow()}{/if}
			<div class="section-body"><Blocks nodes={text} {ctx} /></div>
		{/if}
		{#if open && kids.length}
			<div class="section-body"><Blocks nodes={kids} {ctx} /></div>
		{/if}
	</section>
{/if}

{#snippet headingRow(h: Headline)}
	<div class="heading-row">
		<button
			type="button"
			class="fold"
			aria-expanded={open}
			aria-label={vis === 'folded'
				? 'Expand section'
				: vis === 'all'
					? 'Collapse section'
					: 'Show all of this section'}
			title="Fold (folded, children, everything)"
			onclick={cycle}
		>
			<span class="fold-icon" class:closed={!open} class:partly={open && vis !== 'all'}
				><Icon name="chevronDown" size={16} /></span
			>
		</button>
		<svelte:element this={`h${level}`} class="heading" class:done class:task={!!h.todoKeyword}>
			{#if h.todoKeyword}
				<TodoChip
					keyword={h.todoKeyword}
					config={keywords}
					onchange={ctx.interactive ? (next) => app.setTodo(ctx.path, startOf(h), next) : undefined}
				/>
			{/if}
			{#if h.priority}<span class="prio" title={`Priority ${h.priority}`}>{h.priority}</span>{/if}
			<span class="heading-text"><Inline nodes={h.children} {ctx} /></span>
			{#if id}
				<a
					class="node-link"
					href={href.node(id)}
					title="Open as its own note"
					aria-label="Open this heading as a note"><Icon name="arrowRight" size={15} /></a
				>
			{/if}
		</svelte:element>
		{#if ctx.interactive}
			<button
				type="button"
				class="more"
				class:swiped={!!swipe}
				class:on={editing}
				aria-expanded={editing}
				aria-label="Edit heading: state, priority, tags and dates"
				title="State, priority, tags, dates"
				onclick={() => {
					// Phones get the bottom sheet; wider screens the inline tray.
					if (matchMedia('(max-width: 720px)').matches)
						app.headingSheet = { path: ctx.path, pos: offset };
					else editing = !editing;
				}}><Icon name="settings" size={15} /></button
			>
		{/if}
		{#if h.tags.length}
			<span class="htags"
				>{#each h.tags as tag (tag)}<a class="tag" href={href.tags(tag)}>#{tag}</a>{/each}</span
			>
		{/if}
	</div>
{/snippet}

{#snippet planningRow()}
	{#if planning}
		<div class="planning">
			{#each ['DEADLINE', 'SCHEDULED', 'CLOSED'] as const as kind (kind)}
				{@const ts = dates[kind]}
				{#if ts}
					<DateChip path={ctx.path} {offset} {kind} {ts} editable={ctx.interactive} />
				{:else if kind === 'DEADLINE' && planning.deadline}
					<span class="plan">{when(planning.deadline.rawValue)}</span>
				{/if}
			{/each}
		</div>
	{/if}
{/snippet}
