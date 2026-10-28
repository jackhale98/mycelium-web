<script lang="ts">
	import { serviceLabel } from '$lib/sync/services';
	import { href, router } from '../router.svelte';
	import { app, localNow, TEXT_SIZES, type ThemeChoice } from '../state.svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import Logo from './Logo.svelte';
	import GitControl from './GitControl.svelte';

	const today = localNow().date;
	const route = $derived(router.route);

	const nav: {
		label: string;
		icon: IconName;
		href: string;
		match: (r: typeof route) => boolean;
	}[] = [
		{ label: 'Home', icon: 'home', href: href.home(), match: (r) => r.name === 'home' },
		{ label: 'Today', icon: 'calendar', href: href.daily(today), match: (r) => r.name === 'daily' },
		{ label: 'Dailies', icon: 'inbox', href: href.dailies(), match: (r) => r.name === 'dailies' },
		{ label: 'Agenda', icon: 'agenda', href: href.agenda(), match: (r) => r.name === 'agenda' },
		{ label: 'Search', icon: 'search', href: href.search(), match: (r) => r.name === 'search' },
		{ label: 'Graph', icon: 'graph', href: href.graph(), match: (r) => r.name === 'graph' },
		{ label: 'Tags', icon: 'tag', href: href.tags(), match: (r) => r.name === 'tags' },
		{ label: 'Changes', icon: 'commit', href: href.changes(), match: (r) => r.name === 'changes' },
	];

	const notes = $derived.by(() => {
		void app.rev;
		return [...app.vault.nodes.values()]
			.filter((n) => n.level === 0 && !app.isDaily(n.file))
			.sort((a, b) => a.title.localeCompare(b.title));
	});

	const themes: { value: ThemeChoice; icon: IconName; label: string }[] = [
		{ value: 'light', icon: 'sun', label: 'Light' },
		{ value: 'system', icon: 'monitor', label: 'System' },
		{ value: 'dark', icon: 'moon', label: 'Dark' },
	];

	const current = $derived(route.name === 'node' ? route.id : null);
</script>

<div class="sidebar">
	<div class="brand">
		<Logo size={28} />
		<span class="name">Mycelium</span>
		<button
			type="button"
			class="close"
			aria-label="Close menu"
			onclick={() => (app.navOpen = false)}><Icon name="close" size={18} /></button
		>
	</div>

	<a class="vault" href={href.vaults()} title="Switch vault">
		<span class="vault-icon"
			><Icon
				name={app.demo ? 'zap' : app.cloud ? 'cloud' : app.folder ? 'folder' : 'git'}
				size={15}
			/></span
		>
		<span class="vault-text">
			<span class="vault-name" title={app.activeVault?.name}
				>{app.activeVault?.name.split('/').pop() ?? 'Demo vault'}</span
			>
			<span class="vault-sub">
				{#if app.activeVault}{app.activeVault.cloud
						? serviceLabel(app.activeVault.cloud)
						: app.activeVault.kind === 'folder'
							? 'Folder'
							: (app.activeVault.branch ?? 'default branch')} · {app.vault.files.size} files{:else}{app
						.vault.files.size} files · in this tab only{/if}
			</span>
		</span>
		<span class="vault-go"
			><Icon name="chevronRight" size={15} /><span class="sr-only">Switch vault</span></span
		>
	</a>

	<button type="button" class="search" onclick={() => (app.paletteOpen = true)}>
		<Icon name="search" size={16} />
		<span>Search</span>
		<kbd>⌘K</kbd>
	</button>

	<nav aria-label="Main">
		<ul class="nav">
			{#each nav as item (item.label)}
				<li>
					<a href={item.href} aria-current={item.match(route) ? 'page' : undefined}>
						<Icon name={item.icon} size={17} />{item.label}
						{#if item.label === 'Changes' && app.git.changes.length}<span class="count"
								>{app.git.changes.length}</span
							>{/if}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="notes">
		<div class="notes-head">
			<h2>Notes <span>{notes.length}</span></h2>
			<button
				type="button"
				class="new"
				aria-label="New note"
				title="New note"
				onclick={() => (app.newNote = { title: '' })}><Icon name="plus" size={15} /></button
			>
		</div>
		<ul>
			{#each notes as node (node.id)}
				<li>
					<a href={href.node(node.id)} aria-current={current === node.id ? 'page' : undefined}
						>{node.title}</a
					>
				</li>
			{/each}
		</ul>
	</div>

	<footer class="foot">
		<GitControl />
		<div class="foot-row">
			<a
				class="settings"
				href={href.settings()}
				aria-current={route.name === 'settings' ? 'page' : undefined}
				><Icon name="settings" size={15} />Settings</a
			>
			<button
				type="button"
				class="aa"
				popovertarget="text-size-pop"
				aria-label="Aa: text size"
				title="Text size">Aa</button
			>
			<div id="text-size-pop" class="text-pop" popover>
				<p class="pop-title" id="tsp-label">Text size</p>
				<div class="sizes" role="radiogroup" aria-labelledby="tsp-label">
					{#each TEXT_SIZES as s (s.value)}
						<button
							type="button"
							role="radio"
							aria-checked={app.textSize === s.value}
							onclick={() => app.setTextSize(s.value)}
							><span style:font-size={`${0.7 + (s.value - 90) / 100}rem`}>A</span>
							<span class="sr-only">{s.label}</span></button
						>
					{/each}
				</div>
			</div>
			<div class="theme" role="radiogroup" aria-label="Theme">
				{#each themes as t (t.value)}
					<button
						type="button"
						role="radio"
						aria-checked={app.theme === t.value}
						aria-label={t.label}
						title={t.label}
						onclick={() => app.setTheme(t.value)}
					>
						<Icon name={t.icon} size={15} />
					</button>
				{/each}
			</div>
		</div>
	</footer>
</div>

<style>
	.aa {
		display: grid;
		place-items: center;
		width: 2rem;
		height: 1.9rem;
		margin-left: auto;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--text-muted);
		font-family: var(--font-read);
		font-size: 0.95rem;
		font-weight: 600;
	}
	.aa:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.text-pop {
		position: fixed;
		inset: auto auto 4.5rem 1rem;
		margin: 0;
		padding: 0.75rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
	}
	.pop-title {
		margin: 0 0 0.5rem;
		color: var(--text-muted);
		font-size: 0.72rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.sizes {
		display: flex;
		align-items: flex-end;
		gap: 0.25rem;
	}
	.sizes button {
		display: grid;
		place-items: end center;
		width: 2.4rem;
		height: 2.6rem;
		padding-bottom: 0.3rem;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: var(--surface);
		color: var(--text);
		font-family: var(--font-read);
		line-height: 1;
	}
	.sizes button[aria-checked='true'] {
		border-color: var(--accent);
		background: var(--accent);
		color: var(--on-accent);
	}
	.notes-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding-right: 0.5rem;
	}
	.notes-head h2 {
		flex: 1;
		margin-bottom: 0;
	}
	.notes-head {
		margin-bottom: 0.3rem;
	}
	.new {
		display: grid;
		place-items: center;
		width: 1.6rem;
		height: 1.6rem;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--text-muted);
	}
	.new:hover {
		background: var(--surface-2);
		color: var(--accent);
	}
	.count {
		margin-left: auto;
		padding: 0 0.45rem;
		border-radius: 999px;
		background: var(--todo-soft);
		color: var(--todo);
		font-size: 0.7rem;
		font-weight: 700;
		line-height: 1.3rem;
	}
	.sidebar {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 1rem 0.75rem 0.75rem;
		gap: 0.5rem;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.25rem 0.5rem 0.5rem;
	}
	.name {
		font-family: var(--font-read);
		font-size: 1.3rem;
		font-weight: 600;
		letter-spacing: -0.015em;
	}
	.close {
		display: none;
		margin-left: auto;
		padding: 0.35rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text-muted);
	}
	.vault {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.55rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--surface);
		text-align: left;
	}
	.vault-icon {
		display: grid;
		place-items: center;
		width: 1.9rem;
		height: 1.9rem;
		border-radius: 8px;
		background: var(--accent-soft);
		color: var(--accent);
	}
	.vault-text {
		display: flex;
		flex-direction: column;
		line-height: 1.25;
	}
	.vault-name {
		font-size: 0.85rem;
		font-weight: 600;
	}
	.vault-sub {
		color: var(--text-faint);
		font-size: 0.72rem;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		height: 2.3rem;
		padding: 0 0.5rem 0 0.7rem;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background: var(--bg);
		color: var(--text-faint);
		font-size: 0.85rem;
	}
	.search:hover {
		border-color: var(--border-strong);
		color: var(--text-muted);
	}
	.search kbd {
		margin-left: auto;
	}
	.nav,
	.notes ul {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.nav {
		margin-top: 0.4rem;
	}
	.nav a,
	.notes a {
		display: flex;
		align-items: center;
		gap: 0.65rem;
		padding: 0.42rem 0.6rem;
		border-radius: 8px;
		color: var(--text-2);
		font-size: 0.875rem;
		font-weight: 500;
		text-decoration: none;
	}
	.nav a:hover,
	.notes a:hover {
		background: var(--surface-2);
		color: var(--text);
	}
	.nav a[aria-current='page'],
	.notes a[aria-current='page'] {
		background: var(--accent-soft);
		color: var(--accent-strong);
		font-weight: 600;
	}
	.notes {
		flex: 1;
		min-height: 0;
		margin-top: 0.75rem;
		overflow-y: auto;
	}
	.notes h2 {
		display: flex;
		justify-content: space-between;
		margin: 0 0 0.3rem;
		padding: 0 0.6rem;
		color: var(--text-faint);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.07em;
		text-transform: uppercase;
	}
	.notes a {
		display: block;
		overflow: hidden;
		padding-block: 0.32rem;
		font-size: 0.84rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.foot {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		padding: 0.75rem 0.4rem 0;
		border-top: 1px solid var(--border);
	}
	.foot-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.settings {
		display: inline-flex;
		align-items: center;
		gap: 0.4rem;
		padding: 0.3rem 0.4rem;
		margin-left: -0.4rem;
		border-radius: 7px;
		color: var(--text-muted);
		font-size: 0.8rem;
		font-weight: 550;
		text-decoration: none;
	}
	.settings:hover,
	.settings[aria-current='page'] {
		background: var(--surface-2);
		color: var(--text);
	}
	.vault-go {
		display: grid;
		margin-left: auto;
		color: var(--text-faint);
	}
	.vault {
		color: inherit;
		text-decoration: none;
	}
	.vault:hover {
		border-color: var(--border-strong);
	}
	.theme {
		display: flex;
		padding: 2px;
		border-radius: 9px;
		background: var(--surface-2);
	}
	.theme button {
		display: grid;
		place-items: center;
		width: 1.75rem;
		height: 1.6rem;
		border: 0;
		border-radius: 7px;
		background: none;
		color: var(--text-faint);
	}
	.theme button[aria-checked='true'] {
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	@media (max-width: 960px) {
		.close {
			display: grid;
		}
		/* Phones and tablets: finger-sized targets, clear of the home indicator. */
		.foot {
			padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
		}
		.foot-row {
			flex-wrap: wrap;
			gap: 0.5rem;
		}
		.settings {
			flex: 1 0 100%;
			min-height: 2.75rem;
			padding: 0 0.75rem;
			margin-left: 0;
			font-size: 0.92rem;
		}
		.aa {
			width: 2.75rem;
			height: 2.75rem;
			font-size: 1.05rem;
		}
		.theme button {
			width: 2.75rem;
			height: 2.75rem;
		}
	}
	@media (pointer: coarse) {
		.sizes button {
			min-width: 2.75rem;
			min-height: 2.75rem;
		}
	}
</style>
