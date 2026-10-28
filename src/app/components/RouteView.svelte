<script lang="ts">
	// One pane's page: the view for its route. Pages below can ask which pane
	// they're in (usePane), for its reading/editing state and to navigate it.
	import { tick, untrack } from 'svelte';
	import { providePane, type Pane, type Tab } from '../panes.svelte';
	import { app } from '../state.svelte';
	import AgendaView from '../views/AgendaView.svelte';
	import DailyView from '../views/DailyView.svelte';
	import FileView from '../views/FileView.svelte';
	import HomeView from '../views/HomeView.svelte';
	import NodeView from '../views/NodeView.svelte';
	import TagsView from '../views/TagsView.svelte';
	import LoadError from './LoadError.svelte';
	import { reloadForUpdate } from '../util';

	let { pane }: { pane: Pane } = $props();
	// svelte-ignore state_referenced_locally
	providePane(pane);

	const route = $derived(pane.route);

	// Heavier pages load on first visit, keeping the startup bundle small.
	// A deploy while the app is open removes the old build's files, so a
	// failed load reloads once to pick up the new version.
	const lazy =
		<T,>(load: () => Promise<T>) =>
		() =>
			load().catch((e: unknown) => {
				reloadForUpdate();
				throw e;
			});
	const views = {
		changes: lazy(() => import('../views/ChangesView.svelte')),
		dailies: lazy(() => import('../views/DailiesView.svelte')),
		graph: lazy(() => import('../views/GraphView.svelte')),
		search: lazy(() => import('../views/SearchView.svelte')),
		settings: lazy(() => import('../views/SettingsView.svelte')),
		vaults: lazy(() => import('../views/VaultsView.svelte')),
	};

	// A new page starts at the top; coming back to a tab, where you left it.
	let lastTab: Tab | null = null;
	$effect(() => {
		const tab = pane.tab;
		void route;
		untrack(() => {
			const el = pane.scroller;
			if (tab !== lastTab && lastTab !== null) {
				const y = tab.scroll;
				void tick().then(() =>
					requestAnimationFrame(() => el?.scrollTo({ top: y, behavior: 'instant' })),
				);
			} else if (el) el.scrollTo({ top: 0 });
			else window.scrollTo({ top: 0 });
			lastTab = tab;
		});
	});
</script>

{#if route.name === 'home'}
	<HomeView />
{:else if route.name === 'node'}
	{#key route.id}<NodeView id={route.id} at={route.at} />{/key}
{:else if route.name === 'file'}
	{#key route.path}<FileView path={route.path} at={route.at} />{/key}
{:else if route.name === 'daily'}
	<DailyView date={route.date} />
{:else if route.name === 'agenda'}
	{#key route.name}<AgendaView query={route.query} />{/key}
{:else if route.name === 'tags'}
	<TagsView tag={route.tag} />
{:else if route.name === 'vaults'}
	{#await views.vaults() then { default: VaultsView }}<VaultsView />{:catch error}<LoadError
			{error}
		/>{/await}
{:else if route.name === 'graph'}
	{#await views.graph() then { default: GraphView }}{#key route.id}<GraphView
				focus={route.id}
			/>{/key}{:catch error}<LoadError {error} />{/await}
{:else if route.name === 'search'}
	{#await views.search() then { default: SearchView }}<SearchView
			q={route.q}
		/>{:catch error}<LoadError {error} />{/await}
{:else if route.name === 'dailies'}
	{#await views.dailies() then { default: DailiesView }}<DailiesView />{:catch error}<LoadError
			{error}
		/>{/await}
{:else if route.name === 'changes'}
	{#await views.changes() then { default: ChangesView }}<ChangesView />{:catch error}<LoadError
			{error}
		/>{/await}
{:else if route.name === 'settings'}
	<!-- Settings copies the vault's settings into its forms: build it once they've loaded. -->
	{#await views.settings() then { default: SettingsView }}{#key `${app.activeId}:${app.ready}`}<SettingsView
				tab={route.tab}
			/>{/key}{:catch error}<LoadError {error} />{/await}
{:else}
	<div class="nf">
		<h1>Page not found</h1>
		<a href="#/">Go home</a>
	</div>
{/if}

<style>
	.nf {
		padding: 6rem 1rem;
		text-align: center;
	}
</style>
