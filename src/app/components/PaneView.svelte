<script lang="ts">
	// A pane on wide screens: its tabs, and the current tab's page scrolling
	// on its own. Clicking in a pane makes it the one the sidebar, palette
	// and shortcuts act on.
	import { panes, type Pane } from '../panes.svelte';
	import { parseHash, type Route } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';
	import RouteView from './RouteView.svelte';

	let { pane }: { pane: Pane } = $props();

	let scroller: HTMLElement | undefined = $state();
	$effect(() => {
		const el = scroller;
		if (!el) return;
		pane.scroller = el;
		// Pages that fill the pane (the graph, a side panel) size to it.
		const ro = new ResizeObserver(() => el.style.setProperty('--pane-h', `${el.clientHeight}px`));
		ro.observe(el);
		return () => {
			ro.disconnect();
			if (pane.scroller === el) pane.scroller = null;
		};
	});

	function title(route: Route): string {
		void app.rev;
		switch (route.name) {
			case 'home':
				return 'Home';
			case 'node':
				return app.vault.node(route.id)?.title ?? 'Note';
			case 'file':
				return (
					route.path
						.split('/')
						.pop()
						?.replace(/\.org$/, '') ?? 'File'
				);
			case 'daily':
				return route.date ?? 'Today';
			case 'agenda':
				return 'Agenda';
			case 'tags':
				return route.tag ? `#${route.tag}` : 'Tags';
			case 'search':
				return route.q ? `Search: ${route.q}` : 'Search';
			case 'graph':
				return 'Graph';
			case 'dailies':
				return 'Dailies';
			case 'changes':
				return 'Changes';
			case 'settings':
				return 'Settings';
			case 'vaults':
				return 'Vaults';
			default:
				return 'Not found';
		}
	}

	const focused = $derived(panes.right !== null && panes.focused === pane);
	const label = $derived(pane.primary ? 'Main pane' : 'Side pane');

	function onkeydown(e: KeyboardEvent, i: number) {
		const n = pane.tabs.length;
		const to =
			e.key === 'ArrowRight'
				? (i + 1) % n
				: e.key === 'ArrowLeft'
					? (i - 1 + n) % n
					: e.key === 'Home'
						? 0
						: e.key === 'End'
							? n - 1
							: null;
		if (to !== null) {
			e.preventDefault();
			pane.select(to);
			(e.currentTarget as HTMLElement).parentElement?.parentElement
				?.querySelectorAll<HTMLElement>('.tab-name')
				[to]?.focus();
		} else if (e.key === 'Delete') {
			e.preventDefault();
			panes.close(pane, i);
		}
	}
</script>

<section
	class="pane"
	class:focused
	data-pane={pane.primary ? 'main' : 'side'}
	aria-label={label}
	onpointerdowncapture={() => panes.focus(pane)}
	onfocusincapture={() => panes.focus(pane)}
>
	<div class="tabbar">
		<ul class="tabs" aria-label={`${label} tabs`}>
			{#each pane.tabs as tab, i (tab)}
				{@const name = title(parseHash(tab.hash))}
				<li class="tab" class:active={i === pane.active}>
					<button
						type="button"
						class="tab-name"
						aria-current={i === pane.active ? 'page' : undefined}
						title={name}
						onclick={() => pane.select(i)}
						onauxclick={(e) => e.button === 1 && panes.close(pane, i)}
						onkeydown={(e) => onkeydown(e, i)}
						>{#if tab.editing}<Icon name="edit" size={11} />{/if}<span>{name}</span></button
					>
					{#if pane.tabs.length > 1 || !pane.primary}
						<button
							type="button"
							class="tab-close"
							tabindex="-1"
							aria-label={`Close ${name}`}
							title="Close tab"
							onclick={() => panes.close(pane, i)}><Icon name="close" size={12} /></button
						>
					{/if}
				</li>
			{/each}
		</ul>
		<button
			type="button"
			class="bar-btn"
			aria-label="New tab"
			title="New tab (⌘/Ctrl-click a link to open it in one)"
			onclick={() => pane.open('#/')}><Icon name="plus" size={14} /></button
		>
		{#if pane.primary && !panes.right}
			<button
				type="button"
				class="bar-btn"
				aria-label="Split view"
				title="Split view (Alt-click a link to open it beside)"
				onclick={() => panes.split()}><Icon name="columns" size={14} /></button
			>
		{:else if !pane.primary}
			<button
				type="button"
				class="bar-btn"
				aria-label="Close split view"
				title="Close split view"
				onclick={() => panes.unsplit()}><Icon name="close" size={14} /></button
			>
		{/if}
	</div>
	<div class="pane-scroll" bind:this={scroller}>
		<RouteView {pane} />
	</div>
</section>

<style>
	.pane {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
	}
	.pane + :global(.pane) {
		border-left: 1px solid var(--border);
	}
	.tabbar {
		display: flex;
		flex: none;
		align-items: center;
		gap: 0.15rem;
		height: 2.25rem;
		padding: 0 0.4rem;
		border-bottom: 1px solid var(--border);
		background: var(--bg-raised);
	}
	.tabs {
		display: flex;
		margin: 0;
		padding: 0;
		list-style: none;
		flex: 0 1 auto;
		align-items: stretch;
		align-self: stretch;
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tab {
		position: relative;
		display: flex;
		flex: 0 1 12rem;
		align-items: center;
		min-width: 5.5rem;
		border-right: 1px solid var(--border);
		color: var(--text-muted);
	}
	.tab:first-child {
		border-left: 1px solid var(--border);
	}
	.tab.active {
		background: var(--bg);
		color: var(--text);
	}
	/* The focused pane's current tab is underlined in the accent colour. */
	.focused .tab.active::after {
		position: absolute;
		inset: auto 0 -1px;
		height: 2px;
		background: var(--accent);
		content: '';
	}
	.tab-name {
		display: flex;
		flex: 1;
		align-items: center;
		gap: 0.3rem;
		min-width: 0;
		height: 100%;
		padding: 0 0.3rem 0 0.65rem;
		border: 0;
		background: none;
		color: inherit;
		font-size: 0.78rem;
		font-weight: 550;
		text-align: left;
	}
	.tab-name span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tab-close,
	.bar-btn {
		display: grid;
		flex: none;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-muted);
	}
	.tab-close {
		margin-right: 0.25rem;
		opacity: 0;
	}
	.tab:hover .tab-close,
	.tab.active .tab-close,
	.tab-close:focus-visible {
		opacity: 1;
	}
	.tab-close:hover,
	.bar-btn:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.pane-scroll {
		position: relative;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		outline: none;
		scroll-padding-top: 4rem;
		container: pane / inline-size;
		/* The clock bar sits above the panes here, not over their content. */
		--clock-h: 0px;
	}
</style>
