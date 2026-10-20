<script lang="ts">
	import '../styles/prose.css';
	import '../styles/ui.css';
	import BrandLoader from './components/BrandLoader.svelte';
	import CommandPalette from './components/CommandPalette.svelte';
	import Icon from './components/Icon.svelte';
	import MobileBar from './components/MobileBar.svelte';
	import Sidebar from './components/Sidebar.svelte';
	import SyncDialog from './components/SyncDialog.svelte';
	import { href, router } from './router.svelte';
	import { app } from './state.svelte';
	import AgendaView from './views/AgendaView.svelte';
	import DailyView from './views/DailyView.svelte';
	import HomeView from './views/HomeView.svelte';
	import NodeView from './views/NodeView.svelte';
	import SettingsView from './views/SettingsView.svelte';
	import TagsView from './views/TagsView.svelte';
	import VaultsView from './views/VaultsView.svelte';

	let main: HTMLElement | undefined = $state();

	$effect(() => router.start());
	$effect(() => {
		const started = performance.now();
		void app.init().then(() => {
			// A quick start skips the rest of the intro; a slow one lets the cap finish.
			const loader = (
				window as unknown as { MyceliumLoader?: { done(o?: { immediate?: boolean }): void } }
			).MyceliumLoader;
			loader?.done({ immediate: performance.now() - started < 1200 });
		});
	});

	// Persist pending commits when the tab is hidden or closed.
	$effect(() => {
		const flush = () => {
			if (document.visibilityState === 'hidden')
				void app.flush().then(() => app.workspace?.repo.flush());
		};
		document.addEventListener('visibilitychange', flush);
		addEventListener('pagehide', flush);
		return () => {
			document.removeEventListener('visibilitychange', flush);
			removeEventListener('pagehide', flush);
		};
	});

	// Sync results are announced briefly; errors stay until dismissed.
	$effect(() => {
		if (app.sync.kind !== 'done') return;
		const t = setTimeout(() => app.dismissSync(), 3500);
		return () => clearTimeout(t);
	});

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
		{#if app.demo && router.route.name !== 'vaults'}
			<div class="demo-banner" role="note">
				<Icon name="zap" size={14} />
				<span
					>You're exploring the demo vault — edits stay in this tab. <a href={href.vaults()}
						>Open your own repository</a
					></span
				>
			</div>
		{/if}
		{#if app.loading}
			<div class="loading" role="status" aria-live="polite">
				<div class="loading-card">
					<BrandLoader label={app.loading.phase} />
					<p class="loading-phase">{app.loading.phase}</p>
					<div class="bar" class:indeterminate={app.loading.ratio === null}>
						<span
							class="bar-fill"
							style:width={app.loading.ratio === null
								? undefined
								: `${Math.round(app.loading.ratio * 100)}%`}
						></span>
					</div>
				</div>
			</div>
		{:else if router.route.name === 'home'}
			<HomeView />
		{:else if router.route.name === 'node'}
			{#key router.route.id}<NodeView id={router.route.id} />{/key}
		{:else if router.route.name === 'daily'}
			<DailyView date={router.route.date} />
		{:else if router.route.name === 'agenda'}
			<AgendaView />
		{:else if router.route.name === 'tags'}
			<TagsView tag={router.route.tag} />
		{:else if router.route.name === 'vaults'}
			<VaultsView />
		{:else if router.route.name === 'settings'}
			{#key app.activeId}<SettingsView />{/key}
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
<SyncDialog />

{#if app.sync.kind === 'done' || app.sync.kind === 'error'}
	<div
		class="toast"
		class:error={app.sync.kind === 'error'}
		role={app.sync.kind === 'error' ? 'alert' : 'status'}
	>
		<Icon name={app.sync.kind === 'error' ? 'alert' : 'check'} size={16} />
		<span>{app.sync.message}</span>
		<button type="button" aria-label="Dismiss" onclick={() => app.dismissSync()}
			><Icon name="close" size={14} /></button
		>
	</div>
{/if}

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
	.demo-banner a {
		color: inherit;
		font-weight: 650;
	}
	.loading {
		display: grid;
		place-items: center;
		min-height: 70dvh;
		padding: 1rem;
	}
	.loading-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.9rem;
		width: min(22rem, 100%);
		text-align: center;
	}
	.loading-phase {
		margin: 0;
		color: var(--text-2);
		font-weight: 550;
	}
	.spinner {
		width: 2rem;
		height: 2rem;
		border: 3px solid var(--accent-soft);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.9s linear infinite;
	}
	.bar {
		position: relative;
		width: 100%;
		height: 6px;
		overflow: hidden;
		border-radius: 999px;
		background: var(--surface-2);
	}
	.bar-fill {
		position: absolute;
		inset: 0 auto 0 0;
		border-radius: inherit;
		background: var(--accent);
		transition: width 0.2s var(--ease);
	}
	.bar.indeterminate .bar-fill {
		width: 35%;
		animation: slide 1.2s var(--ease) infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes slide {
		from {
			left: -35%;
		}
		to {
			left: 100%;
		}
	}
	.toast {
		position: fixed;
		right: 1.25rem;
		bottom: 1.25rem;
		z-index: 60;
		display: flex;
		align-items: center;
		gap: 0.6rem;
		max-width: min(28rem, calc(100vw - 2rem));
		padding: 0.7rem 0.6rem 0.7rem 0.9rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		font-size: 0.86rem;
		animation: rise 0.2s var(--ease);
	}
	.toast :global(svg) {
		flex: none;
		color: var(--accent);
	}
	.toast.error :global(svg:first-child) {
		color: var(--danger);
	}
	.toast button {
		display: grid;
		place-items: center;
		margin-left: auto;
		padding: 0.3rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-muted);
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
	}
	@media (max-width: 960px) {
		.toast {
			right: 1rem;
			bottom: calc(5rem + env(safe-area-inset-bottom));
		}
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
