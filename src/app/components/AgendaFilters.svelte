<script lang="ts">
	import type { Snippet } from 'svelte';
	import { activeFilters, emptyFilter, type AgendaFilter } from '../agenda';
	import Icon from './Icon.svelte';

	let {
		filter = $bindable(),
		tags,
		states,
		categories,
		categoryLabels = {},
		error,
		children,
	}: {
		filter: AgendaFilter;
		tags: string[];
		states: string[];
		categories: string[];
		categoryLabels?: Record<string, string>;
		/** Problem with the text regexp or match string, if any. */
		error: string | null;
		/** Shown after the active filters, on the same line (saved views). */
		children?: Snippet;
	} = $props();

	const PRIORITIES = ['A', 'B', 'C'];
	const EXAMPLES = ['+work-boss', 'PRIORITY="A"', '/!NEXT', 'DEADLINE<="<+7d>"', 'Effort<*0:30'];
	let open = $state(false);
	let tagGroup: HTMLDivElement | undefined = $state();
	let textInput: HTMLInputElement | undefined = $state();
	let matchInput: HTMLInputElement | undefined = $state();
	const count = $derived(activeFilters(filter));

	/** Tags cycle like org's filter: include (+) → exclude (−) → off. */
	function cycleTag(tag: string) {
		const next = { ...filter.tags };
		if (!(tag in next)) next[tag] = true;
		else if (next[tag]) next[tag] = false;
		else delete next[tag];
		filter = { ...filter, tags: next };
	}
	function toggle(key: 'states' | 'priorities' | 'categories', value: string) {
		const list = filter[key];
		filter = {
			...filter,
			[key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value],
		};
	}

	// org's agenda keys: \ tags, / match, = regexp, | clear.
	function onkeydown(e: KeyboardEvent) {
		const t = e.composedPath()[0];
		if (
			t instanceof HTMLElement &&
			t.closest('input, textarea, select, [contenteditable="true"], dialog')
		)
			return;
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const focus = (el: HTMLElement | null | undefined) => {
			e.preventDefault();
			open = true;
			queueMicrotask(() => el?.focus());
		};
		if (e.key === '\\') focus(tagGroup?.querySelector('button'));
		else if (e.key === '/') focus(matchInput);
		else if (e.key === '=') focus(textInput);
		else if (e.key === '|') {
			e.preventDefault();
			filter = emptyFilter();
		}
	}
</script>

<svelte:window {onkeydown} />

<div class="filters">
	<div class="bar">
		<button
			type="button"
			class="btn small toggle"
			aria-expanded={open}
			aria-controls="agenda-filter-panel"
			onclick={() => (open = !open)}
			><Icon name="tag" size={14} />Filters{count ? ` (${count})` : ''}</button
		>
		<label class="search">
			<Icon name="search" size={14} />
			<span class="sr-only">Filter by text (regexp)</span>
			<input
				bind:this={textInput}
				type="search"
				placeholder="Filter text…"
				bind:value={filter.text}
				spellcheck="false"
			/>
		</label>
		{#if count}
			<button type="button" class="btn small" onclick={() => (filter = emptyFilter())}>Clear</button
			>
		{/if}
	</div>

	<div class="filter-line">
		{#if count}
			<ul class="pills" aria-label="Active filters">
				{#each Object.entries(filter.tags) as [tag, on] (tag)}
					<li>
						<button type="button" class:neg={!on} onclick={() => cycleTag(tag)}
							>{on ? '+' : '−'}#{tag}<span class="sr-only"> (change)</span></button
						>
					</li>
				{/each}
				{#each filter.states as s (s)}<li>
						<button type="button" onclick={() => toggle('states', s)}>{s} ×</button>
					</li>{/each}
				{#each filter.priorities as p (p)}<li>
						<button type="button" onclick={() => toggle('priorities', p)}>[#{p}] ×</button>
					</li>{/each}
				{#each filter.categories as c (c)}<li>
						<button type="button" onclick={() => toggle('categories', c)}
							>{categoryLabels[c] ?? c} ×</button
						>
					</li>{/each}
				{#if filter.top}<li>
						<button type="button" onclick={() => (filter = { ...filter, top: null })}
							>Under “{filter.top.title}” ×</button
						>
					</li>{/if}
				{#if filter.match.trim()}<li>
						<button type="button" onclick={() => (filter = { ...filter, match: '' })}
							><code>{filter.match}</code> ×</button
						>
					</li>{/if}
			</ul>
		{/if}
		{@render children?.()}
	</div>

	<div class="panel-body" id="agenda-filter-panel" hidden={!open}>
		{#if tags.length}
			<div class="group">
				<span class="label" id="af-tags">Tags</span>
				<div class="chips" role="group" aria-labelledby="af-tags" bind:this={tagGroup}>
					{#each tags as tag (tag)}
						{@const state = filter.tags[tag]}
						<button
							type="button"
							class="chip"
							class:on={state === true}
							class:neg={state === false}
							aria-pressed={state === true ? 'true' : state === false ? 'mixed' : 'false'}
							title="Click: include, again: exclude, again: off"
							onclick={() => cycleTag(tag)}>{state === false ? '−' : state ? '+' : ''}#{tag}</button
						>
					{/each}
				</div>
			</div>
		{/if}
		<div class="group">
			<span class="label" id="af-states">State</span>
			<div class="chips" role="group" aria-labelledby="af-states">
				{#each states as s (s)}
					<button
						type="button"
						class="chip"
						class:on={filter.states.includes(s)}
						aria-pressed={filter.states.includes(s)}
						onclick={() => toggle('states', s)}>{s}</button
					>
				{/each}
			</div>
		</div>
		<div class="group">
			<span class="label" id="af-prio">Priority</span>
			<div class="chips" role="group" aria-labelledby="af-prio">
				{#each PRIORITIES as p (p)}
					<button
						type="button"
						class="chip"
						class:on={filter.priorities.includes(p)}
						aria-pressed={filter.priorities.includes(p)}
						onclick={() => toggle('priorities', p)}>{p}</button
					>
				{/each}
			</div>
		</div>
		{#if categories.length > 1}
			<div class="group">
				<span class="label" id="af-cat">Category</span>
				<div class="chips" role="group" aria-labelledby="af-cat">
					{#each categories as c (c)}
						<button
							type="button"
							class="chip"
							class:on={filter.categories.includes(c)}
							aria-pressed={filter.categories.includes(c)}
							onclick={() => toggle('categories', c)}
							title={c}>{categoryLabels[c] ?? c}</button
						>
					{/each}
				</div>
			</div>
		{/if}
		<div class="group">
			<label class="label" for="af-match">Match</label>
			<input
				id="af-match"
				bind:this={matchInput}
				class="input mono"
				placeholder="+work-boss/!NEXT"
				bind:value={filter.match}
				spellcheck="false"
				autocapitalize="off"
				aria-describedby="af-match-help"
			/>
			<p class="help" id="af-match-help">
				Org tag/property match syntax. Try
				{#each EXAMPLES as ex, i (ex)}<button
						type="button"
						class="ex"
						onclick={() => (filter = { ...filter, match: ex })}><code>{ex}</code></button
					>{i < EXAMPLES.length - 1 ? ' ' : ''}{/each}
				· Keys: <kbd>\</kbd> tags, <kbd>/</kbd> match, <kbd>=</kbd> text, <kbd>|</kbd> clear.
			</p>
		</div>
	</div>
	{#if error}<p class="err" role="alert"><Icon name="alert" size={14} />{error}</p>{/if}
</div>

<style>
	.filters {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		margin-bottom: 1.5rem;
	}
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem;
	}
	.search {
		display: flex;
		flex: 1;
		min-width: 10rem;
		align-items: center;
		gap: 0.4rem;
		height: 2rem;
		padding: 0 0.65rem;
		border: 1px solid var(--border-strong);
		border-radius: 9px;
		background: var(--surface);
		color: var(--text-muted);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: 0;
		background: none;
		color: var(--text);
		font-size: 0.86rem;
		outline: none;
	}
	/* The active filters, then saved views and Save view…: one line while they fit. */
	.filter-line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.4rem 0.6rem;
	}
	.filter-line:not(:has(*)) {
		display: none;
	}
	.pills {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.pills button {
		padding: 0.15rem 0.6rem;
		border: 0;
		border-radius: 999px;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 0.78rem;
		font-weight: 600;
	}
	.pills button.neg {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.panel-body {
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		padding: 0.9rem 1rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.panel-body[hidden] {
		display: none;
	}
	.group {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	.label {
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
	}
	.chip {
		padding: 0.2rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		background: var(--surface);
		color: var(--text-2);
		font-size: 0.8rem;
		font-weight: 550;
	}
	.chip.on {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.chip.neg {
		border-color: var(--danger);
		background: var(--danger-soft);
		color: var(--danger);
		text-decoration: line-through;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: 0.85rem;
	}
	.help {
		margin: 0;
		color: var(--text-muted);
		font-size: 0.78rem;
		line-height: 1.7;
	}
	.ex {
		padding: 0;
		border: 0;
		background: none;
		color: var(--link);
		cursor: pointer;
	}
	kbd {
		padding: 0 0.3rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}
	.err {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0;
		color: var(--danger);
		font-size: 0.84rem;
	}
</style>
