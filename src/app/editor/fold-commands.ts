/// Folding in the source editor, with org's keys: TAB on a heading cycles
/// its subtree (folded → children → subtree), S-TAB the whole file
/// (overview → contents → show all). Folds hide text; nothing is edited.

import { codeFolding, foldEffect, foldedRanges, unfoldEffect } from '@codemirror/language';
import type { EditorState, StateEffect } from '@codemirror/state';
import type { Command, EditorView } from '@codemirror/view';
import { foldSpan, outline, startupVisibility } from '$lib/org';

export type Global = 'overview' | 'contents' | 'all';
const NEXT: Record<Global, Global> = { all: 'overview', overview: 'contents', contents: 'all' };
/** Each editor's last S-TAB state. */
const globals = new WeakMap<EditorView, Global>();

/** Folded text shows as a quiet “…” after its heading; tap it to open. */
export const folding = codeFolding({
	placeholderDOM(_view, onclick) {
		const el = document.createElement('button');
		el.type = 'button';
		el.className = 'cm-org-fold';
		el.textContent = '…';
		el.setAttribute('aria-label', 'Folded text: show it');
		el.onclick = onclick;
		return el;
	},
});

function foldsIn(state: EditorState, from: number, to: number) {
	const out: { from: number; to: number }[] = [];
	foldedRanges(state).between(from, to, (a, b) => {
		out.push({ from: a, to: b });
	});
	return out;
}

const isFolded = (state: EditorState, span: { from: number; to: number }) =>
	foldsIn(state, span.from, span.from).some((f) => f.from === span.from);

/** TAB on a heading line (with no selection): cycle its subtree, as org does. */
export const cycleHeading: Command = (view) => {
	const { state } = view;
	const sel = state.selection.main;
	if (!sel.empty) return false;
	const line = state.doc.lineAt(sel.head);
	if (!/^\*+[ \t]/.test(line.text)) return false;
	const source = state.doc.toString();
	const o = outline(source);
	const h = o.find((x) => x.pos === line.from);
	if (!h) return false;
	const whole = foldSpan(source, h.lineEnd, h.end);
	if (!whole) return true; // nothing under it: org says so, and does nothing
	const effects: StateEffect<unknown>[] = foldsIn(state, whole.from, whole.to).map((f) =>
		unfoldEffect.of(f),
	);
	const childSpans = h.children
		.map((c) => foldSpan(source, o[c]!.lineEnd, o[c]!.end))
		.filter((s): s is { from: number; to: number } => !!s);
	if (isFolded(state, whole)) {
		// FOLDED → CHILDREN: its text, and its children folded.
		if (h.children.length) for (const s of childSpans) effects.push(foldEffect.of(s));
	} else if (
		h.children.length &&
		childSpans.length &&
		childSpans.every((s) => isFolded(state, s))
	) {
		// CHILDREN → SUBTREE: everything (the unfolds above).
	} else {
		// SUBTREE → FOLDED.
		effects.push(foldEffect.of(whole));
	}
	view.dispatch({ effects });
	return true;
};

/** Fold the whole file to `to` (org's S-TAB states). */
export function setOutline(view: EditorView, to: Global) {
	const { state } = view;
	const source = state.doc.toString();
	const o = outline(source);
	const effects: StateEffect<unknown>[] = foldsIn(state, 0, state.doc.length).map((f) =>
		unfoldEffect.of(f),
	);
	if (to !== 'all' && o.length) {
		const top = Math.min(...o.map((h) => h.level));
		for (const h of o) {
			const span =
				to === 'overview'
					? h.level === top
						? foldSpan(source, h.lineEnd, h.end)
						: null
					: foldSpan(source, h.lineEnd, h.bodyEnd);
			if (span) effects.push(foldEffect.of(span));
		}
	}
	globals.set(view, to);
	if (effects.length) view.dispatch({ effects });
}

/** S-TAB: overview → contents → show all. Returns the new state. */
export function cycleOutline(view: EditorView): Global {
	const next = NEXT[globals.get(view) ?? 'all'];
	setOutline(view, next);
	return next;
}

/** On opening a file: its #+STARTUP visibility, as org opens it. */
export function startupFolds(view: EditorView) {
	const v = startupVisibility(view.state.doc.toString());
	if (v && v !== 'all') setOutline(view, v);
}

/** The S-TAB command, for the keymap. */
export const cycleOutlineCommand: Command = (view) => {
	cycleOutline(view);
	return true;
};
