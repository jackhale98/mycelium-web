<script lang="ts">
	import {
		archiveLocation,
		formatDuration,
		normaliseTag,
		type KeywordConfig,
		type OrgTimestamp,
		type PlanningKind,
	} from '$lib/org';
	import Icon from '../components/Icon.svelte';
	import { href, router } from '../router.svelte';
	import { app, localNow } from '../state.svelte';

	let {
		path,
		offset,
		todo,
		priority,
		tags,
		scheduled,
		deadline,
		id,
		keywords,
		nodeAction = true,
		variant = 'inline',
		onclose,
	}: {
		path: string;
		offset: number;
		todo: string | null;
		priority: string | null;
		/** The heading's own tags (not inherited ones). */
		tags: string[];
		scheduled: OrgTimestamp | null;
		deadline: OrgTimestamp | null;
		id: string | null;
		keywords: KeywordConfig;
		/** Offer "make it a node" / "open as note". */
		nodeAction?: boolean;
		/** `inline`: a card under the heading; `sheet`: bare, inside the heading sheet. */
		variant?: 'inline' | 'sheet';
		onclose: () => void;
	} = $props();

	const PRIORITIES = ['A', 'B', 'C'];
	const uid = $props.id();
	let tagInput = $state('');

	const allTags = $derived.by(() => {
		void app.rev;
		return [...app.vault.tags.keys()].filter((t) => !tags.includes(t)).sort();
	});
	const states = $derived([...keywords.todoKeywords, ...keywords.doneKeywords]);
	const running = $derived(
		app.runningClocks.find((c) => c.path === path && c.heading === offset) ?? null,
	);
	/** A clock running on another heading, which clocking in here will stop. */
	const elsewhere = $derived(
		app.runningClocks.find((c) => !(c.path === path && c.heading === offset)) ?? null,
	);
	const summary = $derived(app.clockSummary(path, offset));
	const today = localNow().date;

	/** Where Archive sends the tree (org-archive-location). */
	const archiveTo = $derived.by(() => {
		void app.rev;
		const file = app.vault.file(path);
		if (!file) return '';
		const loc = archiveLocation(file.source, offset, path, keywords);
		return `${loc.file ?? path}${loc.heading ? ` › ${loc.heading.replace(/^\*+\s*/, '')}` : ''}`;
	});
	let archiveNote = $state<string | null>(null);

	async function archive() {
		const r = await app.archive(path, offset);
		if ('error' in r) archiveNote = r.error;
		else {
			archiveNote = null;
			onclose();
			app.headingSheet = null;
		}
	}

	function addTags(e?: Event) {
		e?.preventDefault();
		const added = tagInput
			.split(/[\s,:]+/)
			.map((t) => normaliseTag(t))
			.filter((t): t is string => !!t && !tags.includes(t));
		tagInput = '';
		if (added.length) app.setTags(path, offset, [...tags, ...added]);
	}

	const inputValue = (ts: OrgTimestamp | null) =>
		ts ? (ts.time ? `${ts.date}T${ts.time}` : ts.date) : '';

	function setDate(kind: PlanningKind, value: string) {
		app.setPlanningDate(path, offset, kind, value || null);
	}

	/** org-roam-extract-subtree: a note of its own, linked from where it was. */
	function extract() {
		const nodeId = app.extractNode(path, offset);
		if (!nodeId) {
			archiveNote = 'Couldn’t extract it (a note with that file name may already exist).';
			return;
		}
		app.headingSheet = null;
		onclose();
		router.go(href.node(nodeId));
	}

	function makeNode() {
		const nodeId = app.makeNode(path, offset);
		if (nodeId) router.go(href.node(nodeId));
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.stopPropagation();
			onclose();
		}
	}
</script>

<div
	class="actions"
	class:sheet={variant === 'sheet'}
	role="group"
	aria-label="Heading properties"
	tabindex="-1"
	{onkeydown}
>
	<div class="row">
		<span class="label" id={`${uid}-state`}>State</span>
		<div class="seg" role="radiogroup" aria-labelledby={`${uid}-state`}>
			<button
				type="button"
				role="radio"
				aria-checked={!todo}
				onclick={() => app.setTodo(path, offset, null)}>None</button
			>
			{#each states as kw (kw)}
				<button
					type="button"
					role="radio"
					class:done={keywords.doneKeywords.includes(kw)}
					aria-checked={todo === kw}
					onclick={() => app.setTodo(path, offset, kw)}>{kw}</button
				>
			{/each}
		</div>
	</div>

	<div class="row">
		<span class="label" id={`${uid}-prio`}>Priority</span>
		<div class="seg" role="radiogroup" aria-labelledby={`${uid}-prio`}>
			<button
				type="button"
				role="radio"
				aria-checked={!priority}
				onclick={() => app.setPriority(path, offset, null)}>None</button
			>
			{#each PRIORITIES as p (p)}
				<button
					type="button"
					role="radio"
					aria-checked={priority === p}
					onclick={() => app.setPriority(path, offset, p)}>{p}</button
				>
			{/each}
		</div>
	</div>

	<div class="row">
		<label class="label" for={`${uid}-tag`}>Tags</label>
		<div class="tags">
			{#each tags as tag (tag)}
				<span class="tag"
					>#{tag}<button
						type="button"
						aria-label={`Remove tag ${tag}`}
						onclick={() =>
							app.setTags(
								path,
								offset,
								tags.filter((t) => t !== tag),
							)}><Icon name="close" size={11} /></button
					></span
				>
			{/each}
			<form onsubmit={addTags}>
				<input
					id={`${uid}-tag`}
					class="tag-input"
					placeholder="add tag"
					list={`${uid}-tags`}
					autocomplete="off"
					bind:value={tagInput}
					onchange={(e) => {
						// Picking from the suggestion list adds the tag at once.
						if (allTags.includes(e.currentTarget.value)) addTags();
					}}
				/>
				<datalist id={`${uid}-tags`}>
					{#each allTags as t (t)}<option value={t}></option>{/each}
				</datalist>
			</form>
		</div>
	</div>

	<div class="row">
		<label class="label" for={`${uid}-sched`}>Scheduled</label>
		<div class="when">
			<input
				id={`${uid}-sched`}
				class="input date"
				type={scheduled?.time ? 'datetime-local' : 'date'}
				value={inputValue(scheduled)}
				onchange={(e) => setDate('SCHEDULED', e.currentTarget.value)}
			/>
			{#if scheduled}
				<span class="raw">{scheduled.raw}</span>
				<button
					type="button"
					class="x"
					aria-label="Remove scheduled date"
					onclick={() => setDate('SCHEDULED', '')}><Icon name="close" size={12} /></button
				>
			{/if}
		</div>
	</div>

	<div class="row">
		<label class="label" for={`${uid}-dead`}>Deadline</label>
		<div class="when">
			<input
				id={`${uid}-dead`}
				class="input date"
				type={deadline?.time ? 'datetime-local' : 'date'}
				value={inputValue(deadline)}
				onchange={(e) => setDate('DEADLINE', e.currentTarget.value)}
			/>
			{#if deadline}
				<span class="raw">{deadline.raw}</span>
				<button
					type="button"
					class="x"
					aria-label="Remove deadline"
					onclick={() => setDate('DEADLINE', '')}><Icon name="close" size={12} /></button
				>
			{/if}
		</div>
	</div>

	<div class="row">
		<span class="label">Clock</span>
		<div class="when clock">
			{#if running}
				<span class="running"
					><Icon name="clock" size={14} />Since {running.start.time}{running.start.date !== today
						? ` (${running.start.date})`
						: ''}</span
				>
				<button type="button" class="btn small primary" onclick={() => app.clockOut(path, offset)}
					>Clock out</button
				>
				<button type="button" class="btn small" onclick={() => app.clockCancel(path, offset)}
					>Cancel</button
				>
			{:else}
				<button type="button" class="btn small" onclick={() => app.clockIn(path, offset)}
					><Icon name="clock" size={14} />Clock in</button
				>
				{#if elsewhere}<span class="raw">Stops and records “{elsewhere.title}”</span>{/if}
			{/if}
			{#if summary.minutes || summary.effort}
				<span class="raw"
					>{summary.minutes ? `${formatDuration(summary.minutes)} clocked` : ''}{summary.minutes &&
					summary.effort
						? ' · '
						: ''}{summary.effort ? `effort ${formatDuration(summary.effort)}` : ''}</span
				>
			{/if}
		</div>
	</div>

	<div class="row move">
		<button
			type="button"
			class="btn small"
			onclick={() => {
				app.refileSheet = { path, pos: offset };
				if (variant === 'inline') onclose();
			}}><Icon name="arrowRight" size={14} />Refile…</button
		>
		<button type="button" class="btn small" onclick={archive} title={`Move to ${archiveTo}`}
			><Icon name="inbox" size={14} />Archive</button
		>
		<button
			type="button"
			class="btn small"
			title="Move it and everything under it into a note of its own, linked from here"
			onclick={extract}><Icon name="file" size={14} />Extract to note</button
		>
		{#if archiveNote}<span class="raw" role="status">{archiveNote}</span>{/if}
	</div>

	{#if variant === 'inline' || !id}
		<div class="row foot">
			{#if id && nodeAction}
				<a class="btn small" href={href.node(id)}
					><Icon name="arrowRight" size={14} />Open as note</a
				>
			{:else if !id}
				<button type="button" class="btn small" onclick={makeNode}
					><Icon name="plus" size={14} />Make it a node</button
				>
			{/if}
			{#if variant === 'inline'}
				<button type="button" class="btn small" onclick={onclose}>Done</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.clock {
		flex-wrap: wrap;
		gap: 0.4rem;
		align-items: center;
	}
	.running {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		color: var(--todo);
		font-size: 0.85rem;
		font-weight: 600;
	}
	.actions {
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
		margin: 0.4rem 0 0.9rem;
		padding: 0.85rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		font-family: var(--font-ui);
		font-size: 0.82rem;
		animation: open 0.16s var(--ease);
	}
	.actions.sheet {
		margin: 0;
		padding: 0;
		border: 0;
		box-shadow: none;
		font-size: 0.88rem;
		animation: none;
	}
	@keyframes open {
		from {
			opacity: 0;
			transform: translateY(-4px);
		}
	}
	.row {
		display: grid;
		grid-template-columns: 5.5rem minmax(0, 1fr);
		align-items: center;
		gap: 0.75rem;
	}
	.label {
		color: var(--text-muted);
		font-size: 0.74rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-transform: uppercase;
	}
	.seg {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.seg button {
		height: 1.75rem;
		padding: 0 0.65rem;
		border: 1px solid var(--border);
		border-radius: 7px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.74rem;
		font-weight: 650;
		letter-spacing: 0.03em;
	}
	.seg button:hover {
		border-color: var(--accent);
	}
	.seg button[aria-checked='true'] {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.seg button.done[aria-checked='true'] {
		border-color: var(--done);
		background: var(--done);
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.3rem;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 0.15rem;
		height: 1.6rem;
		padding: 0 0.2rem 0 0.55rem;
		border-radius: 999px;
		background: var(--accent-softer);
		color: var(--accent-strong);
		font-weight: 600;
	}
	.tag button {
		display: grid;
		place-items: center;
		width: 1.2rem;
		height: 1.2rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: inherit;
	}
	.tag button:hover {
		background: color-mix(in oklab, currentColor 15%, transparent);
	}
	.tag-input {
		width: 8rem;
		height: 1.6rem;
		padding: 0 0.55rem;
		border: 1px dashed var(--border-strong);
		border-radius: 999px;
		background: none;
		color: var(--text);
		font: inherit;
	}
	.tag-input:focus {
		border-style: solid;
		border-color: var(--accent);
		outline: none;
	}
	.when {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.date {
		width: auto;
		height: 2rem;
		font-size: 0.82rem;
	}
	.raw {
		color: var(--text-muted);
		font-family: var(--font-mono);
		font-size: 0.74rem;
	}
	.x {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-muted);
	}
	.x:hover {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 0.4rem;
		padding-top: 0.2rem;
	}
	@media (max-width: 520px) {
		.row {
			grid-template-columns: minmax(0, 1fr);
			gap: 0.3rem;
		}
	}
</style>
