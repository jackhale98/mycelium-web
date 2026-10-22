/// Org list and outline editing in the source editor: Enter continues a
/// list or checklist, Tab / Shift-Tab (and org's M-right / M-left) indent and
/// outdent items or demote and promote headings, and C-c C-c toggles a
/// checkbox. Written as state commands so they're testable without a DOM.

import type {
	ChangeSpec,
	EditorState,
	StateCommand,
	Transaction,
	TransactionSpec,
} from '@codemirror/state';
import { toggleCheckbox } from '$lib/org';

const ITEM_RE = /^([ \t]*)([-+]|[ \t]\*|\d+[.)]|[A-Za-z][.)])([ \t]+)(\[[ Xx-]\][ \t]+)?/;
const HEADLINE_RE = /^(\*+)([ \t]|$)/;

/** The next bullet in sequence: `-` stays `-`, `3.` becomes `4.`, `b)` becomes `c)`. */
export function nextBullet(bullet: string): string {
	const num = /^(\d+)([.)])$/.exec(bullet);
	if (num) return `${Number(num[1]) + 1}${num[2]}`;
	const letter = /^([A-Za-z])([.)])$/.exec(bullet);
	if (letter) return `${String.fromCharCode(letter[1]!.charCodeAt(0) + 1)}${letter[2]}`;
	return bullet;
}

type Dispatch = (tr: Transaction) => void;
const run = (state: EditorState, dispatch: Dispatch | undefined, spec: TransactionSpec) => {
	dispatch?.(state.update({ scrollIntoView: true, userEvent: 'input', ...spec }));
	return true;
};

/**
 * Enter inside a list item: split it into a new item with the same bullet
 * (numbers count up, checkboxes start unticked). Enter on an empty item ends
 * the list. Anything else falls through to the default newline.
 */
export const continueList: StateCommand = ({ state, dispatch }) => {
	const sel = state.selection.main;
	if (!sel.empty) return false;
	const line = state.doc.lineAt(sel.head);
	const m = ITEM_RE.exec(line.text);
	if (!m) return false;
	const markerEnd = line.from + m[0].length;
	if (sel.head < markerEnd) return false;
	const rest = line.text.slice(m[0].length);
	if (!rest.trim()) {
		// An empty item ends the list: drop its bullet (keep the indentation).
		return run(state, dispatch, {
			changes: { from: line.from, to: line.to, insert: m[1]! },
			selection: { anchor: line.from + m[1]!.length },
		});
	}
	const insert = `\n${m[1]}${nextBullet(m[2]!)}${m[3]}${m[4] ? '[ ] ' : ''}`;
	return run(state, dispatch, {
		changes: { from: sel.head, to: sel.head, insert },
		selection: { anchor: sel.head + insert.length },
	});
};

/** The item's subtree: this line and following lines indented deeper (or blank within it). */
function itemBlock(
	state: EditorState,
	lineNo: number,
	indent: number,
): { first: number; last: number } {
	let last = lineNo;
	for (let n = lineNo + 1; n <= state.doc.lines; n++) {
		const text = state.doc.line(n).text;
		if (!text.trim()) {
			// A blank line belongs to the item only if more of it follows.
			const next = n < state.doc.lines ? state.doc.line(n + 1).text : '';
			if (next.trim() && /^[ \t]*/.exec(next)![0].length > indent) continue;
			break;
		}
		if (/^[ \t]*/.exec(text)![0].length <= indent) break;
		last = n;
	}
	return { first: lineNo, last };
}

function shiftItems(state: EditorState, dispatch: Dispatch | undefined, dir: 1 | -1): boolean {
	const changes: ChangeSpec[] = [];
	const done = new Set<number>();
	for (const range of state.selection.ranges) {
		const fromLine = state.doc.lineAt(range.from).number;
		const toLine = state.doc.lineAt(range.to).number;
		for (let n = fromLine; n <= toLine; n++) {
			if (done.has(n)) continue;
			const line = state.doc.line(n);
			const m = ITEM_RE.exec(line.text);
			if (!m) {
				if (n === fromLine) return false;
				continue;
			}
			const indent = m[1]!.replace(/\t/g, '        ').length;
			// Children sit under the parent's text: indent by the bullet's width.
			const step = m[2]!.trim().length + 1;
			if (dir === -1 && indent === 0) continue;
			const { last } = itemBlock(state, n, indent);
			for (let k = n; k <= last; k++) {
				done.add(k);
				const l = state.doc.line(k);
				if (!l.text.trim()) continue;
				if (dir === 1) changes.push({ from: l.from, insert: ' '.repeat(step) });
				else {
					const lead = /^[ \t]*/.exec(l.text)![0];
					const remove = Math.min(step, lead.length);
					changes.push({ from: l.from, to: l.from + remove });
				}
			}
		}
	}
	if (!changes.length)
		return dir === -1 && ITEM_RE.test(state.doc.lineAt(state.selection.main.head).text);
	return run(state, dispatch, { changes });
}

function shiftHeadings(state: EditorState, dispatch: Dispatch | undefined, dir: 1 | -1): boolean {
	const changes: ChangeSpec[] = [];
	const seen = new Set<number>();
	for (const range of state.selection.ranges) {
		for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) {
			if (seen.has(n)) continue;
			seen.add(n);
			const line = state.doc.line(n);
			const m = HEADLINE_RE.exec(line.text);
			if (!m) {
				if (n === state.doc.lineAt(range.from).number) return false;
				continue;
			}
			if (dir === 1) changes.push({ from: line.from, insert: '*' });
			else if (m[1]!.length > 1) changes.push({ from: line.from, to: line.from + 1 });
		}
	}
	if (!changes.length) return HEADLINE_RE.test(state.doc.lineAt(state.selection.main.head).text);
	return run(state, dispatch, { changes });
}

/** Tab / M-right: indent a list item (with its children) or demote a heading. */
export const indentItem: StateCommand = ({ state, dispatch }) =>
	shiftItems(state, dispatch, 1) || shiftHeadings(state, dispatch, 1);

/** Shift-Tab / M-left: outdent a list item or promote a heading. */
export const outdentItem: StateCommand = ({ state, dispatch }) =>
	shiftItems(state, dispatch, -1) || shiftHeadings(state, dispatch, -1);

/**
 * The change that ticks or unticks the checklist item on the line at `pos`
 * (updating [n/m] cookies), or null if that line has no checkbox.
 */
export function checkboxToggle(state: EditorState, pos: number): ChangeSpec | null {
	const line = state.doc.lineAt(pos);
	if (!/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[[ Xx-]\]/.test(line.text)) return null;
	const source = state.doc.toString();
	const result = toggleCheckbox(source, line.from);
	if (!result.steps.length) return null;
	const next = result.text;
	// Replace only the changed span so the cursor stays put.
	let a = 0;
	while (a < source.length && source[a] === next[a]) a++;
	let b = 0;
	while (b < source.length - a && source[source.length - 1 - b] === next[next.length - 1 - b]) b++;
	return { from: a, to: source.length - b, insert: next.slice(a, next.length - b) };
}

/** C-c C-c on a checklist item: tick or untick it (updating [n/m] cookies). */
export const toggleItemCheckbox: StateCommand = ({ state, dispatch }) => {
	const changes = checkboxToggle(state, state.selection.main.head);
	return changes ? run(state, dispatch, { changes }) : false;
};
