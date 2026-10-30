<script lang="ts">
	// What a quick add understood, as chips: "Tomorrow", "15:00", "#work",
	// "Priority A", "Repeats every week", "30 min". A chip's × keeps those
	// words in the title instead.
	import { describeQuickPart, type QuickAdd } from '$lib/org';
	import Icon from './Icon.svelte';

	let { q, today, onkeep }: { q: QuickAdd; today: string; onkeep: (text: string) => void } =
		$props();

	const ICONS = {
		date: 'calendar',
		time: 'clock',
		deadline: 'alert',
		repeat: 'sync',
		tag: 'tag',
		priority: 'flag',
		state: 'check',
		effort: 'clock',
	} as const;
</script>

{#if q.parts.length}
	<ul class="chips" aria-label="Understood">
		{#each q.parts as part (part.from)}
			<li class={part.kind} class:once={part.kind === 'repeat' && q.once}>
				<Icon name={ICONS[part.kind]} size={13} /><span>{describeQuickPart(part, q, today)}</span>
				<button
					type="button"
					aria-label={`Keep “${part.text}” as words`}
					title="Keep as words"
					onclick={() => onkeep(part.text)}><Icon name="close" size={12} /></button
				>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
		font-family: var(--font-ui);
	}
	li {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.15rem 0.2rem 0.15rem 0.55rem;
		border-radius: 999px;
		background: var(--surface-2);
		color: var(--text-2);
		font-size: 0.8rem;
		font-weight: 600;
	}
	li.date,
	li.time,
	li.repeat {
		background: var(--next-soft);
		color: var(--next);
	}
	li.repeat.once {
		background: var(--warn-soft);
		color: var(--warn);
		white-space: normal;
	}
	li.deadline {
		background: var(--danger-soft);
		color: var(--danger);
	}
	li.priority,
	li.state {
		background: var(--todo-soft);
		color: var(--todo);
	}
	button {
		display: grid;
		place-items: center;
		width: 1.4rem;
		height: 1.4rem;
		padding: 0;
		border: 0;
		border-radius: 999px;
		background: none;
		color: inherit;
		opacity: 0.7;
	}
	button:hover,
	button:focus-visible {
		background: color-mix(in oklab, currentColor 14%, transparent);
		opacity: 1;
	}
	@media (pointer: coarse) {
		button {
			width: 1.9rem;
			height: 1.9rem;
		}
	}
</style>
