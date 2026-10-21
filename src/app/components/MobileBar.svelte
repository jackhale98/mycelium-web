<script lang="ts">
	import { href, router } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import Icon from './Icon.svelte';

	const route = $derived(router.route);
	const today = localNow().date;

	// While the on-screen keyboard is up for typing, the bar steps aside: the
	// keyboard covers where it lives, and iOS would otherwise lift it above
	// the keyboard. Only while the keyboard is really there (a focused field
	// with the keyboard dismissed, as Android's back button leaves it, keeps
	// the bar).
	let editing = $state(false);
	let keyboard = $state(false);
	const typing = $derived(editing && keyboard);
	$effect(() => {
		const vv = window.visualViewport;
		if (!vv || !matchMedia('(pointer: coarse)').matches) return;
		const editable = (e: Event) => {
			// The editor lives in a shadow root: look at the real target.
			const t = e.composedPath()[0];
			return (
				t instanceof HTMLElement &&
				(t.isContentEditable ||
					t instanceof HTMLTextAreaElement ||
					(t instanceof HTMLInputElement &&
						!['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(t.type)))
			);
		};
		const on = (e: FocusEvent) => {
			if (editable(e)) editing = true;
		};
		const off = (e: FocusEvent) => {
			if (editable(e)) editing = false;
		};
		const measure = () => (keyboard = window.innerHeight - vv.height > 120);
		document.addEventListener('focusin', on);
		document.addEventListener('focusout', off);
		vv.addEventListener('resize', measure);
		measure();
		return () => {
			document.removeEventListener('focusin', on);
			document.removeEventListener('focusout', off);
			vv.removeEventListener('resize', measure);
		};
	});

	// The search button: tap to search, swipe up (or long-press) to capture.
	const SWIPE = 28;
	let startY: number | null = null;
	let lift = $state(0);
	let opened = false;
	let hold: ReturnType<typeof setTimeout> | null = null;

	function capture() {
		opened = true;
		lift = 0;
		startY = null;
		if (hold) clearTimeout(hold);
		navigator.vibrate?.(10);
		app.captureSheet = {};
	}
	function down(e: PointerEvent) {
		opened = false;
		startY = e.clientY;
		hold = setTimeout(capture, 550);
	}
	function move(e: PointerEvent) {
		if (startY === null) return;
		const dy = startY - e.clientY;
		if (Math.abs(dy) > 6 && hold) {
			clearTimeout(hold);
			hold = null;
		}
		lift = Math.max(0, Math.min(dy, 40));
		if (dy > SWIPE) capture();
	}
	function up() {
		startY = null;
		lift = 0;
		if (hold) clearTimeout(hold);
	}
	function click() {
		if (opened) {
			opened = false;
			return;
		}
		app.paletteOpen = true;
	}
</script>

<nav class="bar" class:typing aria-label="Quick navigation">
	<a href={href.home()} aria-current={route.name === 'home' ? 'page' : undefined}
		><Icon name="home" size={20} /><span>Home</span></a
	>
	<a href={href.daily(today)} aria-current={route.name === 'daily' ? 'page' : undefined}
		><Icon name="calendar" size={20} /><span>Today</span></a
	>
	<button
		type="button"
		class="search"
		aria-label="Search"
		aria-describedby="search-capture-hint"
		style:transform={lift ? `translateY(${-lift}px)` : undefined}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointercancel={up}
		onpointerleave={up}
		oncontextmenu={(e) => e.preventDefault()}
		onclick={click}
		><span class="lift" aria-hidden="true"><Icon name="chevronUp" size={12} /></span><Icon
			name="search"
			size={22}
		/></button
	>
	<span id="search-capture-hint" class="sr-only">Swipe up or hold to capture</span>
	<a href={href.agenda()} aria-current={route.name === 'agenda' ? 'page' : undefined}
		><Icon name="agenda" size={20} /><span>Agenda</span></a
	>
	<button
		type="button"
		onclick={() => (app.navOpen = true)}
		aria-expanded={app.navOpen}
		aria-controls="app-sidebar"
		><span class="menu-icon"
			><Icon name="menu" size={20} />{#if app.unsynced > 0}<span
					class="badge"
					aria-label={`${app.unsynced} unsynced`}
				></span>{/if}</span
		><span>Menu</span></button
	>
</nav>

<style>
	.bar {
		position: fixed;
		inset: auto 0 0 0;
		z-index: 30;
		display: none;
		align-items: center;
		justify-content: space-around;
		padding: 0.35rem 0.5rem calc(0.35rem + env(safe-area-inset-bottom));
		border-top: 1px solid var(--border);
		background: color-mix(in oklab, var(--bg-raised) 90%, transparent);
		backdrop-filter: blur(16px) saturate(1.4);
	}
	a,
	button {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.15rem;
		min-width: 3.5rem;
		padding: 0.3rem 0.25rem;
		border: 0;
		border-radius: 10px;
		background: none;
		color: var(--text-muted);
		font-size: 0.66rem;
		font-weight: 550;
		text-decoration: none;
	}
	a[aria-current='page'] {
		color: var(--accent);
	}
	.search {
		position: relative;
		display: grid;
		place-items: center;
		touch-action: none;
		user-select: none;
		-webkit-user-select: none;
		-webkit-touch-callout: none;
		transition: transform 0.15s var(--ease);
		width: 3rem;
		min-width: 3rem;
		height: 3rem;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		box-shadow: var(--shadow-md);
	}
	/* A hint that the button also swipes up. */
	.lift {
		position: absolute;
		top: 0.15rem;
		left: 50%;
		display: grid;
		opacity: 0.75;
		transform: translateX(-50%);
	}
	.search > :global(svg:last-child) {
		margin-top: 0.3rem;
	}
	.menu-icon {
		position: relative;
		display: grid;
	}
	.badge {
		position: absolute;
		top: -2px;
		right: -4px;
		width: 9px;
		height: 9px;
		border: 2px solid var(--bg-raised);
		border-radius: 50%;
		background: var(--todo);
	}
	@media (max-width: 960px) {
		.bar {
			display: flex;
		}
		.bar.typing {
			display: none;
		}
	}
</style>
