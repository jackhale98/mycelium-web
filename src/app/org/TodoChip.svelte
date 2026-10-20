<script lang="ts">
	import { nextTodoKeyword, type KeywordConfig } from '$lib/org';
	import { app } from '../state.svelte';
	import { keywordTone } from '../util';

	let {
		keyword,
		config,
		onchange,
	}: {
		keyword: string;
		config: KeywordConfig;
		onchange?: ((next: string | null) => void) | undefined;
	} = $props();

	const tone = $derived(keywordTone(keyword, config, app.keywordTones));
</script>

{#if onchange}
	<button
		type="button"
		class="kw {tone}"
		title="Change state (Shift-click goes back)"
		aria-label={`${keyword}. Change task state`}
		onclick={(e) => onchange(nextTodoKeyword(keyword, config, e.shiftKey ? -1 : 1))}
		>{keyword}</button
	>
{:else}
	<span class="kw {tone}">{keyword}</span>
{/if}

<style>
	.kw {
		display: inline-flex;
		align-items: center;
		height: 1.55em;
		padding: 0 0.5em;
		border: 0;
		border-radius: 5px;
		font: 650 0.62em/1 var(--font-ui);
		letter-spacing: 0.06em;
		vertical-align: 0.28em;
		white-space: nowrap;
	}
	button.kw {
		cursor: pointer;
		transition: filter 0.15s var(--ease);
	}
	button.kw:hover {
		filter: brightness(0.95) saturate(1.2);
	}
	.todo {
		background: var(--todo-soft);
		color: var(--todo);
	}
	.next {
		background: var(--next-soft);
		color: var(--next);
	}
	.wait {
		background: var(--wait-soft);
		color: var(--wait);
	}
	.neutral {
		background: var(--surface-2);
		color: var(--text-2);
	}
	.done {
		background: var(--done-soft);
		color: var(--done);
	}
</style>
