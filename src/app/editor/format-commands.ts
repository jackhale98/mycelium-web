/// Formatting for the editor's toolbar (handy on phones, where there are no
/// org key bindings): org emphasis markers, heading levels and list items.
/// Written as state commands so they're testable without a DOM.

import {
	EditorSelection,
	type ChangeSpec,
	type Transaction,
	type EditorState,
	type StateCommand,
} from '@codemirror/state';
import { toggleItemCheckbox } from './list-commands';

/** Org's emphasis markers: `*bold*`, `/italic/`, `_underline_`, `+strike+`, `~code~`, `=verbatim=`. */
export type Marker = '*' | '/' | '_' | '+' | '~' | '=';

const HEADLINE_RE = /^(\*+)[ \t]+/;
const ITEM_RE = /^([ \t]*)([-+]|\d+[.)])[ \t]+(\[[ Xx-]\][ \t]+)?/;

/**
 * Wrap the selection in `marker` (or remove it when the selection is already
 * wrapped). With no selection, insert a pair and put the cursor between.
 * Org emphasis can't start or end with whitespace, so that's left outside.
 */
export function toggleMark(marker: Marker): StateCommand {
	return ({ state, dispatch }) => {
		const tr = state.changeByRange((range) => {
			const doc = state.doc;
			if (range.empty) {
				// Inside an empty pair just typed: step out of it.
				if (
					doc.sliceString(range.from - 1, range.from) === marker &&
					doc.sliceString(range.from, range.from + 1) === marker
				)
					return {
						changes: { from: range.from - 1, to: range.from + 1 },
						range: EditorSelection.cursor(range.from - 1),
					};
				// Just before a closing marker (typing inside a pair): step past it.
				if (doc.sliceString(range.from, range.from + 1) === marker)
					return { range: EditorSelection.cursor(range.from + 1) };
				return {
					changes: { from: range.from, insert: marker + marker },
					range: EditorSelection.cursor(range.from + 1),
				};
			}
			// Start after a bullet, checkbox or heading stars the selection takes in.
			const line = doc.lineAt(range.from);
			const prefix = (HEADLINE_RE.exec(line.text) ?? ITEM_RE.exec(line.text))?.[0].length ?? 0;
			const start = Math.max(range.from, line.from + prefix);
			const text = doc.sliceString(start, range.to);
			const from = start + (text.length - text.trimStart().length);
			const to = range.to - (text.length - text.trimEnd().length);
			if (from >= to) return { range };
			const inner = doc.sliceString(from, to);
			// Already wrapped (markers just outside, or included in the selection).
			if (doc.sliceString(from - 1, from) === marker && doc.sliceString(to, to + 1) === marker)
				return {
					changes: [
						{ from: from - 1, to: from },
						{ from: to, to: to + 1 },
					],
					range: EditorSelection.range(from - 1, to - 1),
				};
			if (inner.length > 2 && inner.startsWith(marker) && inner.endsWith(marker))
				return {
					changes: [
						{ from, to: from + 1 },
						{ from: to - 1, to },
					],
					range: EditorSelection.range(from, to - 2),
				};
			return {
				changes: [
					{ from, insert: marker },
					{ from: to, insert: marker },
				],
				range: EditorSelection.range(from + 1, to + 1),
			};
		});
		dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input' }));
		return true;
	};
}

/** The lines the selection touches, each once. */
function selectedLines(state: EditorState) {
	const seen = new Set<number>();
	const out = [];
	for (const r of state.selection.ranges)
		for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++)
			if (!seen.has(n)) {
				seen.add(n);
				out.push(state.doc.line(n));
			}
	return out;
}

/** The heading level of the cursor's line (0 for none). */
export function headingLevelAt(state: EditorState): number {
	return HEADLINE_RE.exec(state.doc.lineAt(state.selection.main.head).text)?.[1]!.length ?? 0;
}

/**
 * Make the current line(s) headings of `level` (0 turns a heading back into
 * text). A list item loses its bullet and checkbox on the way.
 */
export function setHeadingLevel(level: number): StateCommand {
	return ({ state, dispatch }) => {
		const changes: ChangeSpec[] = [];
		for (const line of selectedLines(state)) {
			const prefix = HEADLINE_RE.exec(line.text) ?? ITEM_RE.exec(line.text);
			const lead = prefix?.[0] ?? /^[ \t]*/.exec(line.text)![0];
			const insert = level > 0 ? `${'*'.repeat(level)} ` : '';
			if (lead !== insert) changes.push({ from: line.from, to: line.from + lead.length, insert });
		}
		return applyLineChanges(state, dispatch, changes);
	};
}

/**
 * Apply line-prefix changes. A cursor moves past an inserted prefix (so typing
 * goes after a new `- `); a selection grows to cover it.
 */
function applyLineChanges(
	state: EditorState,
	dispatch: (tr: Transaction) => void,
	spec: ChangeSpec[],
): boolean {
	if (!spec.length) return false;
	const changes = state.changes(spec);
	const selection = EditorSelection.create(
		state.selection.ranges.map((r) =>
			r.empty
				? EditorSelection.cursor(changes.mapPos(r.head, 1))
				: EditorSelection.range(changes.mapPos(r.anchor, -1), changes.mapPos(r.head, 1)),
		),
		state.selection.mainIndex,
	);
	dispatch(state.update({ changes, selection, scrollIntoView: true, userEvent: 'input' }));
	return true;
}

/** Cycle the line's heading level: text → `*` → `**` → `***` → `****` → text. */
export const cycleHeading: StateCommand = (target) => {
	const level = headingLevelAt(target.state);
	return setHeadingLevel(level >= 4 ? 0 : level + 1)(target);
};

export type ListKind = 'bullet' | 'number' | 'checkbox';

/**
 * Turn the selected lines into list items of `kind`, or back into text when
 * they already are. The checkbox button ticks or unticks an existing
 * checklist item, as `C-c C-c` does.
 */
export function toggleList(kind: ListKind): StateCommand {
	return (target) => {
		const { state, dispatch } = target;
		const lines = selectedLines(state).filter((l) => l.text.trim() || lines1(state));
		const items = lines.map((l) => ITEM_RE.exec(l.text));
		const same = (m: RegExpExecArray | null) =>
			!!m && (kind === 'checkbox' ? !!m[3] : !m[3] && (kind === 'number') === /\d/.test(m[2]!));
		if (kind === 'checkbox' && lines.length === 1 && same(items[0]!))
			return toggleItemCheckbox(target);
		const remove = items.every(same);
		const changes: ChangeSpec[] = [];
		let n = 1;
		lines.forEach((line, i) => {
			const m = items[i] ?? null;
			const heading = HEADLINE_RE.exec(line.text);
			const indent = m?.[1] ?? /^[ \t]*/.exec(line.text)![0];
			const lead = m?.[0] ?? heading?.[0] ?? indent;
			const bullet = kind === 'number' ? `${n++}.` : '-';
			const insert = remove ? indent : `${indent}${bullet} ${kind === 'checkbox' ? '[ ] ' : ''}`;
			if (lead !== insert) changes.push({ from: line.from, to: line.from + lead.length, insert });
		});
		return applyLineChanges(state, dispatch, changes);
	};
}

/** A single (possibly blank) line is always formatted, so an empty line can start a list. */
const lines1 = (state: EditorState) =>
	state.doc.lineAt(state.selection.main.from).number ===
	state.doc.lineAt(state.selection.main.to).number;

/** Insert `[[` so the link completion opens (closing brackets come from closeBrackets). */
export const insertLink: StateCommand = ({ state, dispatch }) => {
	const sel = state.selection.main;
	const text = state.sliceDoc(sel.from, sel.to);
	const insert = sel.empty ? '[[]]' : `[[${text}]]`;
	dispatch(
		state.update({
			changes: { from: sel.from, to: sel.to, insert },
			selection: { anchor: sel.empty ? sel.from + 2 : sel.from + insert.length },
			scrollIntoView: true,
			userEvent: 'input.type',
		}),
	);
	return true;
};
