<script lang="ts">
	import '../styles/prose.css';
	import '../styles/ui.css';
	import BrandLoader from './components/BrandLoader.svelte';
	import CaptureSheet from './components/CaptureSheet.svelte';
	import CommandPalette from './components/CommandPalette.svelte';
	import Icon from './components/Icon.svelte';
	import MobileBar from './components/MobileBar.svelte';
	import NewNoteDialog from './components/NewNoteDialog.svelte';
	import HabitSheet from './org/HabitSheet.svelte';
	import HeadingSheet from './org/HeadingSheet.svelte';
	import QuickSheet from './org/QuickSheet.svelte';
	import NoteSheet from './components/NoteSheet.svelte';
	import Sidebar from './components/Sidebar.svelte';
	import SyncDialog from './components/SyncDialog.svelte';
	import { href, router } from './router.svelte';
	import { app } from './state.svelte';
	import ClockBar from './components/ClockBar.svelte';
	import RefileDialog from './components/RefileDialog.svelte';
	import TableSheet from './components/TableSheet.svelte';
	import MathSheet from './components/MathSheet.svelte';
	import ImageSheet from './components/ImageSheet.svelte';
	import { reloadForUpdate } from './util';
	import PaneView from './components/PaneView.svelte';
	import RouteView from './components/RouteView.svelte';
	import { panes } from './panes.svelte';
	import { reminders } from './reminders.svelte';
	import { takeShared } from './share';
	import { untrack } from 'svelte';

	$effect(() => router.start());
	// Offline: a service worker keeps the app's files, so it opens without a
	// connection (production builds only; dev serves files that change).
	$effect(() => {
		if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
		const register = () =>
			navigator.serviceWorker
				.register(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}sw.js`)
				.catch(() => {
					// Not available (a private window, say): the app works online as before.
				});
		if (document.readyState === 'complete') register();
		else addEventListener('load', register, { once: true });
	});
	$effect(() => panes.start());
	// Shared to Mycelium from another app: capture it, once the vault is open.
	$effect(() => {
		if (!app.ready) return;
		const text = untrack(() => takeShared());
		if (text) app.captureSheet = { text };
	});
	// Reminders while the app is open, and the task count on the app icon.
	$effect(() => reminders.start());
	$effect(() => reminders.badge());
	// Notes changed: refresh the reminders the sync worker sends while the app is closed.
	$effect(() => {
		void app.rev;
		void app.activeId;
		untrack(() => {
			reminders.queuePush();
			reminders.check();
		});
	});
	// Each vault remembers its tabs and split.
	$effect(() => {
		const vault = app.activeId;
		untrack(() => panes.load(vault));
	});
	$effect(() => panes.save(app.activeId));
	// The capture notice goes away on its own.
	$effect(() => {
		if (!app.captureNotice) return;
		const t = setTimeout(() => (app.captureNotice = null), 5000);
		return () => clearTimeout(t);
	});
	// Vite reports a failed preload of a lazy page's dependencies the same way.
	$effect(() => {
		const onPreloadError = () => reloadForUpdate();
		window.addEventListener('vite:preloadError', onPreloadError);
		return () => window.removeEventListener('vite:preloadError', onPreloadError);
	});
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
			else void app.refreshFolder();
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

	// New page: close the mobile menu.
	$effect(() => {
		void router.route;
		app.navOpen = false;
	});

	/**
	 * Links on wide screens: a plain click opens the page in the pane it's in
	 * (from the sidebar, the focused pane); ⌘/Ctrl-click or a middle click in
	 * a new tab; Alt-click in the other pane, splitting the view if need be.
	 */
	function onLink(e: MouseEvent) {
		if (!panes.wide || e.defaultPrevented || (e.type === 'auxclick' && e.button !== 1)) return;
		if (e.type === 'click' && e.button !== 0) return;
		const a = e.composedPath().find((t): t is HTMLAnchorElement => t instanceof HTMLAnchorElement);
		const to = a?.getAttribute('href');
		if (!a || !to?.startsWith('#/') || a.target || a.hasAttribute('download')) return;
		const inPane = a.closest<HTMLElement>('[data-pane]')?.dataset.pane;
		const pane =
			inPane === 'side' && panes.right
				? panes.right
				: inPane === 'main'
					? panes.left
					: panes.focused;
		if (e.altKey) {
			e.preventDefault();
			panes.openBeside(pane, to);
		} else if (e.metaKey || e.ctrlKey || e.type === 'auxclick') {
			e.preventDefault();
			pane.open(to);
			panes.focus(pane);
		} else if (!e.shiftKey) {
			e.preventDefault();
			panes.focus(pane);
			pane.go(to);
		}
	}

	function onkeydown(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			app.paletteOpen = !app.paletteOpen;
		} else if (
			(e.metaKey || e.ctrlKey) &&
			e.altKey &&
			['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract'].includes(e.code)
		) {
			// By physical key: Option changes e.key on macOS.
			e.preventDefault();
			app.stepTextSize(e.code === 'Digit0' ? 0 : /Minus|Subtract/.test(e.code) ? -1 : 1);
		} else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
			e.preventDefault();
			router.go(href.search());
		} else if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'KeyC') {
			// Quick capture (org's C-c c). By physical key: Option changes e.key on macOS.
			e.preventDefault();
			app.captureSheet = {};
		} else if ((e.metaKey || e.ctrlKey) && e.altKey && e.key.toLowerCase() === 'n') {
			e.preventDefault();
			app.newNote = { title: '' };
		} else if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
			e.preventDefault();
			app.panelOpen = !app.panelOpen;
		} else if (e.key === 'Escape' && app.navOpen) {
			app.navOpen = false;
		}
	}
</script>

<svelte:window {onkeydown} onclick={onLink} onauxclick={onLink} />

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

	<main id="main-content" class:panes-on={panes.wide} tabindex="-1">
		<ClockBar />
		{#if (app.loadError || app.folderAccess) && router.route.name !== 'vaults'}
			<div class="vault-notice" role="alert">
				{#if app.folderAccess}
					<span>Mycelium needs permission again to read “{app.folderAccess.name}”.</span>
					<button type="button" class="btn small primary" onclick={() => app.grantFolder()}
						>Allow access</button
					>
				{:else}
					<span>Couldn't open {app.activeVault?.name ?? 'this vault'}: {app.loadError}</span>
					<button type="button" class="btn small" onclick={() => app.openVault(app.activeId)}
						>Try again</button
					>
				{/if}
				<a href={href.vaults()}>Manage vaults</a>
			</div>
		{/if}
		{#if app.demo && router.route.name !== 'vaults'}
			<div class="demo-banner" role="note">
				<Icon name="zap" size={14} />
				<span
					>You're exploring the demo vault — a local git repo in this browser. <a
						href={href.vaults()}>Open your own repository</a
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
		{:else if panes.wide}
			<div class="panes" class:split={panes.right}>
				<PaneView pane={panes.left} />
				{#if panes.right}{#key panes.right}<PaneView pane={panes.right} />{/key}{/if}
			</div>
		{:else}
			<RouteView pane={panes.left} />
		{/if}
	</main>
</div>

<MobileBar />
<CommandPalette />
<SyncDialog />
<NewNoteDialog />
<RefileDialog />
<TableSheet />
<MathSheet />
<ImageSheet />
<HeadingSheet />
<HabitSheet />
<QuickSheet />
<NoteSheet />
<CaptureSheet />

{#if app.captureNotice}
	<div class="toast" role="status">
		<Icon name="check" size={16} />
		<span
			>Saved to {app.captureNotice.label}.
			<a
				href={app.captureNotice.id
					? href.node(app.captureNotice.id)
					: href.file(app.captureNotice.path)}
				onclick={() => (app.captureNotice = null)}>Open</a
			></span
		>
		<button type="button" aria-label="Dismiss" onclick={() => (app.captureNotice = null)}
			><Icon name="close" size={14} /></button
		>
	</div>
{:else if app.sync.kind === 'done' || app.sync.kind === 'error'}
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
	.vault-notice {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem 1rem;
		margin: 1rem;
		padding: 0.8rem 1rem;
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		background: var(--danger-soft);
		color: var(--text);
		font-size: 0.88rem;
	}
	.vault-notice span {
		flex: 1 1 16rem;
	}
	.vault-notice a {
		color: var(--link);
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
	.access {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.6rem;
		margin: 1rem auto 0;
		padding: 0.7rem 1rem;
		max-width: 46rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		box-shadow: var(--shadow-sm);
		font-size: 0.88rem;
	}
	.access span {
		flex: 1;
		min-width: 12rem;
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
	.toast a {
		color: inherit;
		font-weight: 650;
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
	/* Wide screens: the panes scroll, each on its own, below the clock and banners. */
	main.panes-on {
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.panes {
		display: grid;
		flex: 1;
		grid-template-columns: minmax(0, 1fr);
		min-height: 0;
	}
	.panes.split {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
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
		/* Phones and tablets scroll the page itself, not a nested scroller: iOS
		   Safari can leave a 100dvh scroller too short (after the keyboard
		   closes) and paints nested scrollers lazily, cutting pages off. */
		.shell {
			height: auto;
			min-height: 100dvh;
		}
		main {
			height: auto;
			overflow: visible;
			padding-bottom: 4.5rem;
		}
	}
	@media (max-width: 960px) {
		:global(html) {
			scroll-padding-top: 4rem;
			/* The page itself scrolls here: never let something a little too
			   wide make iOS pan the whole page sideways. */
			overflow-x: hidden;
		}
	}
</style>
