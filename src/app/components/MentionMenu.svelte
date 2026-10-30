<script lang="ts">
	// The menu for a link suggestion tapped in the reading view: link the
	// words to the note they name, open that note, or stop suggesting it.
	import { tick } from 'svelte';
	import { href } from '../router.svelte';
	import { app } from '../state.svelte';
	import Icon from './Icon.svelte';

	const open = $derived(app.mentionMenu);
	let menu = $state<HTMLElement>();
	let place = $state({ left: 0, top: 0, above: false });

	$effect(() => {
		const m = open;
		if (!m) return;
		const anchor = m.anchor;
		anchor.setAttribute('aria-expanded', 'true');
		const r = anchor.getBoundingClientRect();
		const width = Math.min(18 * 16, window.innerWidth - 16);
		const below = window.innerHeight - r.bottom;
		place = {
			left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
			top: below > 180 ? r.bottom + 6 : r.top - 6,
			above: below <= 180,
		};
		void tick().then(() => menu?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
		const away = (e: Event) => {
			if (!menu?.contains(e.target as Node) && e.target !== anchor) close(false);
		};
		const key = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				close(true);
			}
		};
		const scroll = () => close(false);
		window.addEventListener('pointerdown', away, true);
		window.addEventListener('keydown', key);
		window.addEventListener('scroll', scroll, true);
		return () => {
			anchor.removeAttribute('aria-expanded');
			window.removeEventListener('pointerdown', away, true);
			window.removeEventListener('keydown', key);
			window.removeEventListener('scroll', scroll, true);
		};
	});

	function close(refocus: boolean) {
		const anchor = app.mentionMenu?.anchor;
		app.mentionMenu = null;
		if (refocus && anchor?.isConnected) anchor.focus();
	}

	function link() {
		const m = open;
		if (!m) return;
		app.linkMention(m.path, m.mention.from, m.mention.text, m.mention.id);
		close(false);
	}
	function ignore() {
		const m = open;
		if (!m) return;
		void app.ignoreMention(m.mention.id);
		close(false);
	}

	/** Arrow keys move between the items, as in any menu. */
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
		e.preventDefault();
		const items = [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
		const at = items.indexOf(document.activeElement as HTMLElement);
		const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
		items[next]?.focus();
	}
</script>

{#if open}
	<div
		class="mention-menu"
		class:above={place.above}
		role="menu"
		tabindex="-1"
		aria-label={`“${open.mention.text}”: a mention of ${open.mention.title}`}
		style:left="{place.left}px"
		style:top="{place.top}px"
		bind:this={menu}
		onkeydown={onKey}
	>
		<button type="button" role="menuitem" class="item primary" onclick={link}>
			<Icon name="link" size={15} />
			<span>Link to <strong>{open.mention.title}</strong></span>
		</button>
		<a role="menuitem" class="item" href={href.node(open.mention.id)} onclick={() => close(false)}>
			<Icon name="arrowRight" size={15} />
			<span>Open {open.mention.title}</span>
		</a>
		<button type="button" role="menuitem" class="item" onclick={ignore}>
			<Icon name="close" size={15} />
			<span>Don’t suggest {open.mention.title}</span>
		</button>
	</div>
{/if}

<style>
	.mention-menu {
		position: fixed;
		z-index: 60;
		display: flex;
		flex-direction: column;
		width: min(18rem, calc(100vw - 1rem));
		padding: 0.3rem;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--surface);
		box-shadow: var(--shadow-lg);
	}
	.mention-menu.above {
		transform: translateY(-100%);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 2.5rem;
		padding: 0.4rem 0.6rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: 0.88rem;
		text-align: left;
		text-decoration: none;
		cursor: pointer;
	}
	.item:hover,
	.item:focus-visible {
		outline: none;
		background: var(--surface-2);
	}
	.item.primary {
		color: var(--link);
	}
	.item span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
