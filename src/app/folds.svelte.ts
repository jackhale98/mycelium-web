/// What's folded in the reading view, per file, cycled as org's TAB and S-TAB
/// cycle it. Each heading shows one of:
///   folded:   the heading alone;
///   children: its text and its direct children (folded);
///   contents: its child headings, not its text (S-TAB's CONTENTS);
///   all:      everything under it (the default).

import { SvelteMap } from 'svelte/reactivity';
import { outline, startupVisibility } from '$lib/org';

export type Visibility = 'folded' | 'children' | 'contents' | 'all';
export type Global = 'overview' | 'contents' | 'all';

const NEXT_GLOBAL: Record<Global, Global> = {
	all: 'overview',
	overview: 'contents',
	contents: 'all',
};

class Folds {
	#files = new SvelteMap<string, SvelteMap<number, Visibility>>();
	#global = new SvelteMap<string, Global>();

	#of(path: string) {
		let m = this.#files.get(path);
		if (!m) this.#files.set(path, (m = new SvelteMap()));
		return m;
	}

	/** How the heading at `pos` shows. */
	at(path: string, pos: number): Visibility {
		return this.#files.get(path)?.get(pos) ?? 'all';
	}

	/** The whole file's state (S-TAB), as last set. */
	global(path: string): Global {
		return this.#global.get(path) ?? 'all';
	}

	/** First look at a file: its #+STARTUP visibility, as org opens it. */
	start(path: string, source: string, range?: [number, number]) {
		if (this.#global.has(path)) return;
		const v = startupVisibility(source);
		if (v && v !== 'all') this.setGlobal(path, source, v, range);
		else this.#global.set(path, 'all');
	}

	/** TAB on a heading: folded → its children → its whole subtree → folded. */
	cycle(path: string, source: string, pos: number) {
		const o = outline(source);
		const i = o.findIndex((h) => h.pos === pos);
		const h = o[i];
		if (!h) return;
		const m = this.#of(path);
		const now = this.at(path, pos);
		const under = (j: number): number[] => o[j]!.children.flatMap((c) => [o[c]!.pos, ...under(c)]);
		if (now === 'folded') {
			if (h.children.length) {
				m.set(pos, 'children');
				for (const c of h.children) m.set(o[c]!.pos, 'folded');
			} else m.set(pos, 'all');
		} else if (now === 'children' || now === 'contents') {
			m.set(pos, 'all');
			for (const p of under(i)) m.set(p, 'all');
		} else m.set(pos, 'folded');
	}

	/** S-TAB: overview (top headings) → contents (all headings) → show all. */
	cycleGlobal(path: string, source: string, range?: [number, number]): Global {
		const next = NEXT_GLOBAL[this.global(path)];
		this.setGlobal(path, source, next, range);
		return next;
	}

	setGlobal(path: string, source: string, to: Global, range?: [number, number]) {
		const [lo, hi] = range ?? [0, source.length];
		const o = outline(source).filter((h) => h.pos >= lo && h.pos < hi);
		const m = this.#of(path);
		m.clear();
		const top = Math.min(...o.map((h) => h.level));
		if (to === 'overview') for (const h of o) m.set(h.pos, h.level === top ? 'folded' : 'all');
		else if (to === 'contents') for (const h of o) m.set(h.pos, 'contents');
		this.#global.set(path, to);
	}
}

export const folds = new Folds();

/** What the button that cycles the whole note says it will do next. */
export const GLOBAL_LABEL: Record<Global, string> = {
	all: 'Overview',
	overview: 'Contents',
	contents: 'Show all',
};
