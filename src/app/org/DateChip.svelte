<script lang="ts">
	import type { OrgTimestamp, PlanningKind } from '$lib/org';
	import Icon from '../components/Icon.svelte';
	import { app } from '../state.svelte';
	import { tsLabel } from '../util';

	let {
		path,
		offset,
		kind,
		ts,
		editable = true,
		compact = false,
	}: {
		path: string;
		offset: number;
		kind: PlanningKind;
		ts: OrgTimestamp;
		editable?: boolean;
		compact?: boolean;
	} = $props();

	let input: HTMLInputElement | undefined = $state();

	const LABEL = { DEADLINE: 'Due', SCHEDULED: 'Scheduled', CLOSED: 'Closed' } as const;
	const ICON = { DEADLINE: 'alert', SCHEDULED: 'calendar', CLOSED: 'check' } as const;
	const value = $derived(ts.time ? `${ts.date}T${ts.time}` : ts.date);
	const text = $derived(
		`${compact ? '' : `${LABEL[kind]} `}${tsLabel(ts)}${ts.repeater ? ` · ↻ ${ts.repeater}` : ''}`,
	);

	/** Open the platform's own date picker. */
	function pick() {
		if (!input) return;
		try {
			input.showPicker();
		} catch {
			input.focus();
			input.click();
		}
	}
</script>

{#if editable}
	<span class="date {kind.toLowerCase()}">
		<button
			type="button"
			class="face"
			onclick={pick}
			title={`${ts.raw} — click to change`}
			aria-label={`${LABEL[kind]} ${tsLabel(ts)}. Change date`}
			><Icon name={ICON[kind]} size={13} />{text}</button
		>
		<input
			bind:this={input}
			class="picker"
			type={ts.time ? 'datetime-local' : 'date'}
			{value}
			tabindex="-1"
			aria-hidden="true"
			onchange={(e) =>
				e.currentTarget.value && app.setPlanningDate(path, offset, kind, e.currentTarget.value)}
		/>
		{#if kind !== 'CLOSED'}
			<button
				type="button"
				class="clear"
				aria-label={`Remove ${LABEL[kind].toLowerCase()} date`}
				title="Remove"
				onclick={() => app.setPlanningDate(path, offset, kind, null)}
				><Icon name="close" size={11} /></button
			>
		{/if}
	</span>
{:else}
	<span class="date {kind.toLowerCase()}"
		><span class="face"><Icon name={ICON[kind]} size={13} />{text}</span></span
	>
{/if}

<style>
	.date {
		position: relative;
		display: inline-flex;
		align-items: center;
		height: 1.65rem;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 550;
		white-space: nowrap;
	}
	.face {
		display: inline-flex;
		align-items: center;
		gap: 0.35rem;
		height: 100%;
		padding: 0 0.6rem;
		border: 0;
		border-radius: inherit;
		background: none;
		color: inherit;
		font: inherit;
	}
	button.face {
		cursor: pointer;
	}
	button.face:hover {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.picker {
		position: absolute;
		bottom: 0;
		left: 0.5rem;
		width: 1px;
		height: 1px;
		padding: 0;
		border: 0;
		opacity: 0;
		pointer-events: none;
	}
	.clear {
		display: grid;
		place-items: center;
		width: 1.2rem;
		height: 1.2rem;
		margin-right: 0.25rem;
		margin-left: -0.3rem;
		border: 0;
		border-radius: 50%;
		background: none;
		color: inherit;
		opacity: 0;
		transition: opacity 0.15s var(--ease);
	}
	.date:hover .clear,
	.clear:focus-visible {
		opacity: 0.75;
	}
	.clear:hover {
		background: color-mix(in oklab, currentColor 15%, transparent);
		opacity: 1;
	}
	.deadline {
		background: var(--danger-soft);
		color: var(--danger);
	}
	.scheduled {
		background: var(--next-soft);
		color: var(--next);
	}
	.closed {
		background: var(--done-soft);
		color: var(--done);
	}
	@media (hover: none) {
		.clear {
			opacity: 0.6;
		}
	}
</style>
