/// Keep your place when switching between reading and editing: note which
/// part of the note is at the top of the screen (a source offset, and how
/// far down the screen it sits), then put the same part at the same height
/// in the other view.

import type { EditorView } from '@codemirror/view';

export interface Anchor {
	/** Source offset of the block at the top of the screen. */
	pos: number;
	/** Its distance from the top of the viewport, in CSS pixels. */
	y: number;
}

/** Where content starts below the sticky bars at the top (clock, daily nav). */
function topEdge(within: HTMLElement): number {
	const v = parseFloat(getComputedStyle(within).getPropertyValue('--sticky-top')) || 0;
	const clock =
		parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--clock-h')) || 0;
	return Math.max(v, clock);
}

/**
 * The part of a block to line up: for a heading's section, its heading row
 * (the section's box starts with the spacing above the heading).
 */
const landmark = (el: Element) => el.querySelector(':scope > .heading-row') ?? el;

/** The page's scroller: the main column on wide screens, the page itself on phones. */
function scroller(): { by: (dy: number) => void } {
	const main = document.getElementById('main-content');
	if (main && getComputedStyle(main).overflowY === 'auto' && main.scrollHeight > main.clientHeight)
		return { by: (dy) => main.scrollBy({ top: dy, behavior: 'instant' }) };
	return { by: (dy) => window.scrollBy({ top: dy, behavior: 'instant' }) };
}

/**
 * In reading view: the block at the top of the screen. The innermost block
 * crossing the top edge (the paragraph, not its section), or else the first
 * one below it.
 */
export function readingAnchor(container: HTMLElement): Anchor | null {
	const edge = topEdge(container);
	let straddling: Anchor | null = null;
	let below: Anchor | null = null;
	for (const el of container.querySelectorAll('[data-pos]')) {
		const r = landmark(el).getBoundingClientRect();
		const pos = Number(el.getAttribute('data-pos'));
		if (r.height === 0 || !Number.isFinite(pos) || r.bottom <= edge) continue;
		if (r.top <= edge) {
			if (!straddling || pos >= straddling.pos) straddling = { pos, y: r.top };
		} else if (!below || r.top < below.y) below = { pos, y: r.top };
	}
	// A block starting just below the edge is a better landmark than a long
	// section that began far above it.
	if (below && (!straddling || below.y - edge < 120)) return below;
	return straddling ?? below;
}

/** Scroll reading view so the block at (or just before) `a.pos` sits at `a.y`. */
export function restoreReading(container: HTMLElement, a: Anchor) {
	let el: Element | null = null;
	let pos = -1;
	for (const e of container.querySelectorAll('[data-pos]')) {
		const p = Number(e.getAttribute('data-pos'));
		if (p <= a.pos && p >= pos && e.getBoundingClientRect().height > 0) {
			el = e;
			pos = p;
		}
	}
	if (!el) return;
	scroller().by(landmark(el).getBoundingClientRect().top - a.y);
}

/** In the editor: the line at the top of the screen. */
export function editorAnchor(view: EditorView, container: HTMLElement): Anchor | null {
	const top = topEdge(container);
	const into = Math.max(0, top - view.documentTop);
	if (into > view.contentHeight) return null;
	// The first line fully on screen that has text: a blank line, or one cut
	// off at the top, has no matching block in reading view.
	let block = view.lineBlockAtHeight(into);
	for (let i = 0; i < 12 && block.to < view.state.doc.length; i += 1) {
		const partly = block.top + view.documentTop < top - 1;
		const blank = !view.state.sliceDoc(block.from, block.to).trim();
		if (!partly && !blank) break;
		block = view.lineBlockAt(block.to + 1);
	}
	return { pos: block.from, y: block.top + view.documentTop };
}

/** Scroll the editor so the line holding `a.pos` sits at `a.y`. */
export function restoreEditor(view: EditorView, a: Anchor) {
	const pos = Math.min(a.pos, view.state.doc.length);
	const line = view.lineBlockAt(pos);
	scroller().by(line.top + view.documentTop - a.y);
}
