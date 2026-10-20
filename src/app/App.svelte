<script lang="ts">
	import '../styles/prose.css';
	import CommandPalette from './components/CommandPalette.svelte';
	import Icon from './components/Icon.svelte';
	import MobileBar from './components/MobileBar.svelte';
	import Sidebar from './components/Sidebar.svelte';
	import { router } from './router.svelte';
	import { app } from './state.svelte';
	import AgendaView from './views/AgendaView.svelte';
	import DailyView from './views/DailyView.svelte';
	import HomeView from './views/HomeView.svelte';
	import NodeView from './views/NodeView.svelte';
	import TagsView from './views/TagsView.svelte';

	let main: HTMLElement | undefined = $state();

	$effect(() => router.start());

	// New page: close the mobile menu, reset scroll and move focus to the content.
	$effect(() => {
		void router.route;
		app.navOpen = false;
		main?.scrollTo({ top: 0 });
	});

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			app.paletteOpen = !app.paletteOpen;
		} else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
			e.preventDefault();
			app.panelOpen = !app.panelOpen;
		} else if (e.key === 'Escape' && app.navOpen) {
			app.navOpen = false;
		}
	}
</script>

<svelte:window {onkeydown} />

<a class="skip-link" href="#main-content">Skip to content</a>

<div class="shell" class:nav-open={app.navOpen}>
	<aside id="app-sidebar" class="side" aria-label="Sidebar">
		<Sidebar />
	</aside>
	<button
		type="button"
		class="scrim"
		aria-label="Close menu"
		tabindex="-1"
		onclick={() => (app.navOpen = false)}
	></button>

	<main id="main-content" bind:this={main} tabindex="-1">
		{#if app.demo}
			<div class="demo-banner" role="note">
				<Icon name="zap" size={14} />
				<span
					>You're exploring a demo vault. Edits stay in this tab — connecting a git repository is
					coming soon.</span
				>
			</div>
		{/if}
		{#if router.route.name === 'home'}
			<HomeView />
		{:else if router.route.name === 'node'}
			{#key router.route.id}<NodeView id={router.route.id} />{/key}
		{:else if router.route.name === 'daily'}
			<DailyView date={router.route.date} />
		{:else if router.route.name === 'agenda'}
			<AgendaView />
		{:else if router.route.name === 'tags'}
			<TagsView tag={router.route.tag} />
		{:else}
			<div class="nf">
				<h1>Page not found</h1>
				<a href="#/">Go home</a>
			</div>
		{/if}
	</main>
</div>

<MobileBar />
<CommandPalette />

<style>
	.shell {
		display: grid;
		grid-template-columns: var(--sidebar-w) minmax(0, 1fr);
		height: 100dvh;
	}
	.side {
		height: 100dvh;
		border-right: 1px solid var(--border);
		background: var(--bg-raised);
		overflow: hidden;
	}
	main {
		height: 100dvh;
		overflow-y: auto;
		outline: none;
		scroll-padding-top: 4rem;
	}
	.scrim {
		display: none;
	}
	.demo-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.45rem 1rem;
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-size: 0.78rem;
		font-weight: 550;
		text-align: center;
	}
	.nf {
		padding: 6rem 1rem;
		text-align: center;
	}
	@media (max-width: 960px) {
		.shell {
			grid-template-columns: minmax(0, 1fr);
		}
		.side {
			position: fixed;
			inset: 0 auto 0 0;
			z-index: 50;
			width: min(19rem, 86vw);
			visibility: hidden;
			transform: translateX(-102%);
			transition:
				transform 0.25s var(--ease),
				visibility 0s linear 0.25s;
		}
		.nav-open .side {
			visibility: visible;
			transform: none;
			box-shadow: var(--shadow-lg);
			transition: transform 0.25s var(--ease);
		}
		.scrim {
			position: fixed;
			inset: 0;
			z-index: 40;
			display: block;
			border: 0;
			background: rgb(20 18 12 / 0.35);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.25s var(--ease);
		}
		.nav-open .scrim {
			opacity: 1;
			pointer-events: auto;
		}
		main {
			padding-bottom: 4.5rem;
		}
	}
</style>
