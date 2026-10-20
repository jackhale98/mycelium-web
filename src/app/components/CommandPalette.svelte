<script lang="ts">
	import { href, router } from '../router.svelte';
	import { app, localNow } from '../state.svelte';
	import Icon, { type IconName } from './Icon.svelte';

	interface Item {
		key: string;
		label: string;
		sub?: string;
		icon: IconName;
		run: () => void;
	}

	let dialog: HTMLDialogElement | undefined = $state();
	let input: HTMLInputElement | undefined = $state();
	let query = $state('');
	let active = $state(0);

	const commands: Item[] = [
		{
			key: 'cmd:today',
			label: "Open today's note",
			icon: 'calendar',
			run: () => router.go(href.daily(localNow().date)),
		},
		{
			key: 'cmd:agenda',
			label: 'Open agenda',
			icon: 'agenda',
			run: () => router.go(href.agenda()),
		},
		{ key: 'cmd:home', label: 'Go home', icon: 'home', run: () => router.go(href.home()) },
		{ key: 'cmd:tags', label: 'Browse tags', icon: 'tag', run: () => router.go(href.tags()) },
		{ key: 'cmd:new', label: 'New note', icon: 'plus', run: () => (app.newNote = { title: '' }) },
		{ key: 'cmd:graph', label: 'Open graph', icon: 'graph', run: () => router.go(href.graph()) },
		{
			key: 'cmd:changes',
			label: 'Review changes and commit',
			icon: 'commit',
			run: () => router.go(href.changes()),
		},
		{
			key: 'cmd:theme',
			label: 'Toggle dark mode',
			icon: 'moon',
			run: () => {
				const dark =
					document.documentElement.dataset.theme === 'dark' ||
					(!document.documentElement.dataset.theme &&
						matchMedia('(prefers-color-scheme: dark)').matches);
				app.setTheme(dark ? 'light' : 'dark');
			},
		},
	];

	const items = $derived.by((): Item[] => {
		void app.rev;
		const q = query.trim();
		if (!q) {
			const recent = [...app.vault.nodes.values()]
				.filter((n) => n.level === 0)
				.sort((a, b) => b.file.localeCompare(a.file))
				.slice(0, 5);
			return [
				...recent.map((n) => ({
					key: n.id,
					label: n.title,
					sub: n.tags.map((t) => `#${t}`).join(' '),
					icon: 'file' as const,
					run: () => router.go(href.node(n.id)),
				})),
				...commands,
			];
		}
		const hits = app.search.search(q, 12).map((hit) => {
			const node = app.vault.node(hit.id)!;
			const alias = node.aliases.find((a) => a.toLowerCase().includes(q.toLowerCase()));
			return {
				key: hit.id,
				label: node.title,
				sub: alias
					? `alias: ${alias}`
					: node.olp.length
						? node.olp.join(' › ')
						: node.tags.map((t) => `#${t}`).join(' '),
				icon: 'file' as const,
				run: () => router.go(href.node(hit.id)),
			};
		});
		const cmds = commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase()));
		const exists = app.vault.titles.has(q.toLowerCase());
		const extra: Item[] = [
			{
				key: 'cmd:fulltext',
				label: `Search text for “${q}”`,
				icon: 'search',
				run: () => router.go(href.search(q)),
			},
			...(exists
				? []
				: [
						{
							key: 'cmd:create',
							label: `Create note “${q}”`,
							icon: 'plus' as const,
							run: () => (app.newNote = { title: q }),
						},
					]),
		];
		return [...hits, ...cmds, ...extra];
	});

	$effect(() => {
		void items;
		active = 0;
	});

	$effect(() => {
		if (!dialog) return;
		if (app.paletteOpen && !dialog.open) {
			query = '';
			dialog.showModal();
			input?.focus();
		} else if (!app.paletteOpen && dialog.open) {
			dialog.close();
		}
	});

	function choose(item: Item | undefined) {
		if (!item) return;
		app.paletteOpen = false;
		item.run();
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % Math.max(items.length, 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = (active - 1 + items.length) % Math.max(items.length, 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			choose(items[active]);
		}
	}

	$effect(() => {
		document.getElementById(`cp-${active}`)?.scrollIntoView({ block: 'nearest' });
	});
</script>

<dialog
	bind:this={dialog}
	class="palette"
	aria-label="Search notes and commands"
	onclose={() => (app.paletteOpen = false)}
	onclick={(e) => {
		if (e.target === dialog) app.paletteOpen = false;
	}}
>
	<div class="box">
		<div class="field">
			<Icon name="search" size={18} />
			<input
				bind:this={input}
				bind:value={query}
				{onkeydown}
				role="combobox"
				aria-expanded="true"
				aria-controls="cp-list"
				aria-activedescendant={items.length ? `cp-${active}` : undefined}
				aria-autocomplete="list"
				placeholder="Search notes, aliases, tags…"
				autocomplete="off"
				spellcheck="false"
			/>
			<kbd>esc</kbd>
		</div>
		<ul id="cp-list" role="listbox" aria-label="Results">
			{#if !query.trim()}<li class="heading" role="presentation">Recent</li>{/if}
			{#each items as item, i (item.key)}
				{#if !query.trim() && i === items.length - commands.length}<li
						class="heading"
						role="presentation"
					>
						Commands
					</li>{/if}
				<li
					id={`cp-${i}`}
					role="option"
					aria-selected={i === active}
					class:active={i === active}
					onclick={() => choose(item)}
					onkeydown={() => {}}
					onmousemove={() => (active = i)}
				>
					<span class="ico"><Icon name={item.icon} size={16} /></span>
					<span class="label">{item.label}</span>
					{#if item.sub}<span class="sub">{item.sub}</span>{/if}
				</li>
			{:else}
				<li class="none" role="presentation">No matches for “{query}”.</li>
			{/each}
		</ul>
		<footer>
			<span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
			<span><kbd>↵</kbd> open</span>
		</footer>
	</div>
</dialog>

<style>
	.palette {
		width: min(40rem, calc(100vw - 2rem));
		max-height: min(32rem, calc(100dvh - 6rem));
		margin: 12vh auto auto;
		padding: 0;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--surface);
		color: var(--text);
		box-shadow: var(--shadow-lg);
		overflow: hidden;
	}
	.palette[open] {
		animation: pop 0.16s var(--ease);
	}
	.palette::backdrop {
		background: rgb(20 18 12 / 0.32);
		backdrop-filter: blur(3px);
	}
	@keyframes pop {
		from {
			opacity: 0;
			transform: translateY(-6px) scale(0.985);
		}
	}
	.box {
		display: flex;
		flex-direction: column;
		max-height: inherit;
	}
	.field {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0 1rem;
		border-bottom: 1px solid var(--border);
		color: var(--text-faint);
	}
	.field input {
		flex: 1;
		height: 3.4rem;
		border: 0;
		outline: 0;
		background: none;
		color: var(--text);
		font-size: 1.05rem;
	}
	ul {
		flex: 1;
		margin: 0;
		padding: 0.4rem;
		overflow-y: auto;
		list-style: none;
	}
	.heading {
		padding: 0.6rem 0.75rem 0.3rem;
		color: var(--text-faint);
		font-size: 0.7rem;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	li[role='option'] {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		padding: 0.6rem 0.75rem;
		border-radius: 10px;
		cursor: pointer;
	}
	li.active {
		background: var(--accent-soft);
	}
	.ico {
		display: grid;
		color: var(--text-faint);
	}
	li.active .ico {
		color: var(--accent);
	}
	.label {
		font-weight: 550;
		white-space: nowrap;
	}
	.sub {
		overflow: hidden;
		color: var(--text-faint);
		font-size: 0.8rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.none {
		padding: 1.5rem;
		color: var(--text-faint);
		text-align: center;
	}
	footer {
		display: flex;
		gap: 1rem;
		padding: 0.55rem 1rem;
		border-top: 1px solid var(--border);
		background: var(--surface-2);
		color: var(--text-faint);
		font-size: 0.75rem;
	}
	footer span {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
	}
	@media (max-width: 720px) {
		.palette {
			margin-top: 1rem;
		}
		footer {
			display: none;
		}
	}
</style>
