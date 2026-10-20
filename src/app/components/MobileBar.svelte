<script lang="ts">
	import { href, router } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import Icon from './Icon.svelte';

	const route = $derived(router.route);
	const today = localNow().date;
</script>

<nav class="bar" aria-label="Quick navigation">
	<a href={href.home()} aria-current={route.name === 'home' ? 'page' : undefined}
		><Icon name="home" size={20} /><span>Home</span></a
	>
	<a href={href.daily(today)} aria-current={route.name === 'daily' ? 'page' : undefined}
		><Icon name="calendar" size={20} /><span>Today</span></a
	>
	<button type="button" class="search" onclick={() => (app.paletteOpen = true)} aria-label="Search"
		><Icon name="search" size={22} /></button
	>
	<a href={href.agenda()} aria-current={route.name === 'agenda' ? 'page' : undefined}
		><Icon name="agenda" size={20} /><span>Agenda</span></a
	>
	<button
		type="button"
		onclick={() => (app.navOpen = true)}
		aria-expanded={app.navOpen}
		aria-controls="app-sidebar"><Icon name="menu" size={20} /><span>Menu</span></button
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
		display: grid;
		place-items: center;
		width: 3rem;
		min-width: 3rem;
		height: 3rem;
		border-radius: 50%;
		background: var(--accent);
		color: var(--on-accent);
		box-shadow: var(--shadow-md);
	}
	@media (max-width: 960px) {
		.bar {
			display: flex;
		}
	}
</style>
