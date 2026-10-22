/// Tabs and split view (wide screens). The main pane follows the address
/// bar; a second pane, side by side, keeps its own route. Each pane has
/// tabs, and each tab its own page, reading or editing, and scroll. Phones
/// show the main pane's current tab only. The layout is remembered per vault.

import { getContext, setContext } from 'svelte';
import { parseHash, router, type Route } from './router.svelte';

export interface Tab {
	/** The tab's page, as a hash (`#/node/…`). */
	hash: string;
	/** Showing the org source instead of the reading view. */
	editing: boolean;
	/** Where it was scrolled to, restored when you come back to it. */
	scroll: number;
}

const newTab = (hash: string, editing = false): Tab => ({ hash, editing, scroll: 0 });

export class Pane {
	tabs = $state<Tab[]>([]);
	active = $state(0);
	/** The pane's scrolling element (null where the page itself scrolls). */
	scroller: HTMLElement | null = null;

	constructor(
		readonly primary: boolean,
		tabs: Tab[],
		active = 0,
	) {
		this.tabs = tabs.length ? tabs : [newTab('#/')];
		this.active = Math.min(Math.max(active, 0), this.tabs.length - 1);
	}

	get tab(): Tab {
		return this.tabs[this.active]!;
	}

	/** The main pane shows the address bar's page; the other its tab's. */
	route: Route = $derived.by(() => (this.primary ? router.url : parseHash(this.tab.hash)));

	get editing() {
		return this.tab.editing;
	}
	set editing(on: boolean) {
		this.tab.editing = on;
	}

	/** Show `hash` in this pane's current tab. */
	go(hash: string) {
		if (this.primary) router.navigate(hash);
		else this.tab.hash = hash;
	}

	/** Update the current page's address in place (a page's filters, say), without navigating. */
	replace(hash: string) {
		if (this.primary && location.hash !== hash) history.replaceState(null, '', hash);
		this.tab.hash = hash;
	}

	select(i: number) {
		if (i < 0 || i >= this.tabs.length) return;
		if (i !== this.active) {
			this.tab.scroll = this.scroller?.scrollTop ?? 0;
			this.active = i;
		}
		if (this.primary) router.navigate(this.tab.hash);
	}

	/** Open `hash` in a new tab just after the current one. */
	open(hash: string, editing = false) {
		this.tabs.splice(this.active + 1, 0, newTab(hash, editing));
		this.select(this.active + 1);
	}

	/** Close a tab; false when it was the pane's last one. */
	close(i: number): boolean {
		if (this.tabs.length === 1) return false;
		const wasActive = i === this.active;
		this.tabs.splice(i, 1);
		if (i < this.active || this.active >= this.tabs.length) this.active -= 1;
		if (wasActive && this.primary) router.navigate(this.tab.hash);
		return true;
	}
}

interface Saved {
	tabs: { hash: string; editing: boolean }[];
	active: number;
}
interface SavedLayout {
	left: Saved;
	right: Saved | null;
	focus: 'left' | 'right';
}

const KEY = (vault: string) => `mycelium:panes:${vault}`;
const WIDE = '(min-width: 961px)';

class Panes {
	readonly left = new Pane(true, [newTab(currentHash())]);
	right = $state<Pane | null>(null);
	#focusRight = $state(false);
	/** Tabs and split view are for wide screens; phones show one page. */
	wide = $state(typeof matchMedia !== 'undefined' && matchMedia(WIDE).matches);

	/** The pane you're working in: where the sidebar, palette and shortcuts go. */
	get focused(): Pane {
		return this.wide && this.right && this.#focusRight ? this.right : this.left;
	}

	focus(pane: Pane) {
		this.#focusRight = pane === this.right;
	}

	other(pane: Pane): Pane | null {
		return pane === this.left ? this.right : this.left;
	}

	/** Open `hash` beside `from`: in the other pane, splitting the view if need be. */
	openBeside(from: Pane, hash: string) {
		const other = this.other(from);
		if (other) {
			other.open(hash);
			this.focus(other);
		} else {
			this.right = new Pane(false, [newTab(hash)]);
			this.#focusRight = true;
		}
	}

	/** Split the view, the new pane starting on the same page. */
	split() {
		if (this.right) return;
		this.right = new Pane(false, [newTab(this.focused.tab.hash)]);
		this.#focusRight = true;
	}

	unsplit() {
		this.right = null;
		this.#focusRight = false;
	}

	/** Close a tab; closing the side pane's last one closes the split. */
	close(pane: Pane, i: number) {
		if (pane.close(i)) return;
		if (pane === this.right) this.unsplit();
		else if (this.right) {
			// The main pane's last tab: the side pane's tabs take its place.
			const r = this.right;
			this.unsplit();
			this.left.tabs = r.tabs;
			this.left.active = r.active;
			router.navigate(this.left.tab.hash);
		}
	}

	/** Restore the vault's saved layout; the address bar's page wins. */
	load(vault: string) {
		let saved: SavedLayout | null = null;
		try {
			saved = JSON.parse(localStorage.getItem(KEY(vault)) ?? 'null') as SavedLayout | null;
		} catch {
			saved = null;
		}
		const tabs = (s: Saved | null | undefined) =>
			(s?.tabs ?? [])
				.filter((t) => typeof t?.hash === 'string' && t.hash.startsWith('#'))
				.map((t) => newTab(t.hash, !!t.editing));
		const here = currentHash();
		// The main pane stays the same object (pages hold on to it); its tabs change.
		const restored = new Pane(true, tabs(saved?.left), saved?.left?.active ?? 0);
		const found = restored.tabs.findIndex((t) => t.hash === here);
		if (found >= 0) restored.active = found;
		else restored.tab.hash = here;
		this.left.tabs = restored.tabs;
		this.left.active = restored.active;
		const right = tabs(saved?.right);
		this.right = right.length ? new Pane(false, right, saved?.right?.active ?? 0) : null;
		this.#focusRight = !!this.right && saved?.focus === 'right';
	}

	save(vault: string) {
		const out = (p: Pane): Saved => ({
			tabs: p.tabs.map((t) => ({ hash: t.hash, editing: t.editing })),
			active: p.active,
		});
		const layout: SavedLayout = {
			left: out(this.left),
			right: this.right ? out(this.right) : null,
			focus: this.#focusRight ? 'right' : 'left',
		};
		try {
			localStorage.setItem(KEY(vault), JSON.stringify(layout));
		} catch {
			// Private mode or full storage: the layout just isn't remembered.
		}
	}

	/** Keep `wide` current, and the main pane's tab in step with the address bar. */
	start() {
		const mq = matchMedia(WIDE);
		const onChange = () => (this.wide = mq.matches);
		mq.addEventListener('change', onChange);
		const onHash = () => (this.left.tab.hash = currentHash());
		addEventListener('hashchange', onHash);
		router.focus = this;
		return () => {
			mq.removeEventListener('change', onChange);
			removeEventListener('hashchange', onHash);
			router.focus = null;
		};
	}

	/** Route and navigation of the focused pane, for the router. */
	get route(): Route {
		return this.focused.route;
	}
	go(hash: string) {
		this.focused.go(hash);
	}
}

function currentHash(): string {
	if (typeof location === 'undefined') return '#/';
	return location.hash && location.hash !== '#' ? location.hash : '#/';
}

export const panes = new Panes();

const CONTEXT = Symbol('pane');

/** Make `pane` the pane of everything rendered below. */
export function providePane(pane: Pane) {
	setContext(CONTEXT, pane);
}

/** The pane this component is in (the main pane outside any). */
export function usePane(): Pane {
	return getContext<Pane | undefined>(CONTEXT) ?? panes.left;
}
