<script lang="ts">
	import { nextTodoKeyword, type KeywordConfig } from '$lib/org';

	let {
		keyword,
		config,
		onchange,
	}: {
		keyword: string;
		config: KeywordConfig;
		onchange?: ((next: string | null) => void) | undefined;
	} = $props();

	const done = $derived(config.doneKeywords.includes(keyword));
	const tone = $derived(
		done ? 'done' : keyword === 'NEXT' ? 'next' : /WAIT|HOLD/.test(keyword) ? 'wait' : 'todo',
	);
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
	.done {
		background: var(--done-soft);
		color: var(--done);
	}
</style>
