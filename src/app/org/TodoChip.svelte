<script lang="ts">
	// A heading's TODO keyword. Tapped, it opens a menu of every state (and
	// none) to pick from; the menu is in the page's top layer, so rows that
	// slide or clip their content don't cut it off.
	import { tick } from 'svelte';
	import type { KeywordConfig } from '$lib/org';
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
	const uid = $props.id();
	let button: HTMLButtonElement | undefined = $state();
	let menu: HTMLSpanElement | undefined = $state();
	let open = $state(false);
	let place = $state({ left: 0, top: 0 });

	const options = $derived([
		...config.todoKeywords.map((k) => ({ value: k as string | null, label: k })),
		...config.doneKeywords.map((k) => ({ value: k as string | null, label: k })),
		{ value: null, label: 'No state' },
	]);

	async function show() {
		if (!button || !menu) return;
		const r = button.getBoundingClientRect();
		const width = 11 * 16;
		const height = options.length * 40 + 12;
		const below = window.innerHeight - r.bottom > height + 8;
		place = {
			left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
			top: below ? r.bottom + 4 : Math.max(8, r.top - height - 4),
		};
		menu.showPopover();
		await tick();
		const current = menu.querySelector<HTMLElement>('[aria-checked="true"]');
		(current ?? menu.querySelector<HTMLElement>('[role="menuitemradio"]'))?.focus();
	}

	function pick(value: string | null) {
		menu?.hidePopover();
		button?.focus();
		if (value !== keyword) onchange?.(value);
	}

	function onkey(e: KeyboardEvent) {
		const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
		const at = items.indexOf(document.activeElement as HTMLElement);
		let next = -1;
		if (e.key === 'ArrowDown') next = (at + 1) % items.length;
		else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = items.length - 1;
		else if (e.key === 'Tab') menu?.hidePopover();
		if (next >= 0) {
			e.preventDefault();
			items[next]?.focus();
		}
	}
</script>

{#if onchange}
	<button
		bind:this={button}
		type="button"
		class="kw {tone}"
		title="Change state"
		aria-label={`${keyword}. Change task state`}
		aria-haspopup="menu"
		aria-expanded={open}
		aria-controls={`${uid}-menu`}
		onclick={(e) => {
			e.stopPropagation();
			if (open) menu?.hidePopover();
			else void show();
		}}>{keyword}</button
	>
	<span
		bind:this={menu}
		id={`${uid}-menu`}
		class="kw-menu"
		popover="auto"
		role="menu"
		tabindex="-1"
		aria-label="Task state"
		style:left="{place.left}px"
		style:top="{place.top}px"
		ontoggle={(e) => (open = e.newState === 'open')}
		onkeydown={onkey}
		onclick={(e) => e.stopPropagation()}
	>
		{#each options as o (o.label)}
			{@const t = o.value ? keywordTone(o.value, config, app.keywordTones) : 'none'}
			<button
				type="button"
				role="menuitemradio"
				aria-checked={o.value === keyword}
				class="opt"
				onclick={() => pick(o.value)}
				><span class="dot {t}"></span><span class:plain={!o.value}>{o.label}</span></button
			>
		{/each}
	</span>
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
	.kw-menu {
		position: fixed;
		inset: auto;
		width: 11rem;
		margin: 0;
		padding: 0.3rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		font-family: var(--font-ui);
	}
	.kw-menu:popover-open {
		display: flex;
		flex-direction: column;
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		width: 100%;
		min-height: 2.5rem;
		padding: 0 0.6rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font-size: 0.82rem;
		font-weight: 650;
		letter-spacing: 0.04em;
		text-align: left;
		cursor: pointer;
	}
	.opt:hover,
	.opt:focus-visible {
		outline: none;
		background: var(--surface-2);
	}
	.opt[aria-checked='true'] {
		background: var(--accent-soft);
	}
	.plain {
		color: var(--text-muted);
		font-weight: 500;
		letter-spacing: 0;
	}
	.dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		background: var(--surface-2);
	}
	.dot.todo {
		background: var(--todo);
	}
	.dot.next {
		background: var(--next);
	}
	.dot.wait {
		background: var(--wait);
	}
	.dot.done {
		background: var(--done);
	}
	.dot.neutral {
		background: var(--text-muted);
	}
	.dot.none {
		border: 1px dashed var(--border-strong);
		background: none;
	}
</style>
