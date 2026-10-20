/// Checkbox list items and the statistics cookies (`[2/5]`, `[40%]`) above them.
///
/// Toggling rewrites the single mark character, then brings the toggled item's
/// ancestors up to date the way org does: parent boxes become `[X]`/`[-]`/`[ ]`
/// from their children, and the cookies on those parents and on the owning
/// headline are recounted. Unrelated cookies elsewhere are left alone.

import { headlineLevel } from './headline';
import {
	indentWidth,
	lineAt,
	runEdits,
	splitLines,
	type Change,
	type EditResult,
	type Line,
} from './text';

const ITEM_RE =
	/^([ \t]*)(?:[-+]|\*(?=[ \t])|\d+[.)]|[A-Za-z][.)])[ \t]+(?:\[@\w+\][ \t]+)?(?:\[([ xX-])\])?/;
const COOKIE_RE = /\[(\d*)\/(\d*)\]|\[(\d{0,3})%\]/g;

export type CheckboxState = 'unchecked' | 'checked' | 'partial';

export interface ListItemScan {
	line: Line;
	indent: number;
	/** Offset of the mark character inside `[ ]`, when the item has a box. */
	mark: number | null;
	state: CheckboxState | null;
}

const stateOf = (mark: string): CheckboxState =>
	mark === 'x' || mark === 'X' ? 'checked' : mark === '-' ? 'partial' : 'unchecked';
const markOf = (state: CheckboxState) =>
	state === 'checked' ? 'X' : state === 'partial' ? '-' : ' ';

/** Scan a line as a list item. `*` bullets only count when indented, as in org. */
export function scanListItem(line: Line): ListItemScan | null {
	if (headlineLevel(line.text) > 0) return null;
	const m = ITEM_RE.exec(line.text);
	if (!m) return null;
	const indent = indentWidth(m[1]!);
	if (m[2] === undefined) return { line, indent, mark: null, state: null };
	return { line, indent, mark: line.from + m[0].length - 2, state: stateOf(m[2]) };
}

/** The list items directly beneath the item (or headline) on `parent`. */
function children(lines: readonly Line[], parent: Line): ListItemScan[] {
	const isHeadline = headlineLevel(parent.text) > 0;
	const parentItem = isHeadline ? null : scanListItem(parent);
	if (!isHeadline && !parentItem) return [];
	const parentIndent = parentItem ? parentItem.indent : -1;
	const out: ListItemScan[] = [];
	let childIndent: number | null = null;
	let blank = 0;
	for (let i = parent.index + 1; i < lines.length; i += 1) {
		const line = lines[i]!;
		if (headlineLevel(line.text) > 0) break;
		if (line.text.trim() === '') {
			// Two blank lines end a list in org.
			blank += 1;
			if (blank >= 2) break;
			continue;
		}
		blank = 0;
		const width = indentWidth(line.text);
		if (!isHeadline && width <= parentIndent) break;
		const item = scanListItem(line);
		if (!item) continue;
		if (childIndent === null) childIndent = item.indent;
		if (item.indent < childIndent) break;
		if (item.indent === childIndent) out.push(item);
	}
	return out;
}

/** Ancestor lines of `line`: enclosing list items, then the owning headline. */
function ancestors(lines: readonly Line[], line: Line): Line[] {
	const out: Line[] = [];
	let indent = indentWidth(line.text);
	for (let i = line.index - 1; i >= 0; i -= 1) {
		const candidate = lines[i]!;
		if (headlineLevel(candidate.text) > 0) {
			out.push(candidate);
			break;
		}
		const item = scanListItem(candidate);
		if (item && item.indent < indent) {
			out.push(candidate);
			indent = item.indent;
		}
	}
	return out;
}

function summarise(items: readonly ListItemScan[]): { done: number; total: number } {
	const boxes = items.filter((i) => i.state !== null);
	return { done: boxes.filter((i) => i.state === 'checked').length, total: boxes.length };
}

/** Recount the cookies on one line from its checkbox children. */
function cookieChanges(lines: readonly Line[], line: Line): Change[] {
	const kids = children(lines, line);
	const { done, total } = summarise(kids);
	if (total === 0) return [];
	const changes: Change[] = [];
	COOKIE_RE.lastIndex = 0;
	for (let m = COOKIE_RE.exec(line.text); m; m = COOKIE_RE.exec(line.text)) {
		const insert =
			m[3] !== undefined ? `[${Math.floor((done / total) * 100)}%]` : `[${done}/${total}]`;
		if (insert !== m[0])
			changes.push({ from: line.from + m.index, to: line.from + m.index + m[0].length, insert });
	}
	return changes;
}

function updateAncestors(source: string, offset: number): Change[] {
	const lines = splitLines(source);
	const line = lineAt(lines, offset);
	if (!line) return [];
	const changes: Change[] = [];
	for (const parent of ancestors(lines, line)) {
		changes.push(...cookieChanges(lines, parent));
	}
	return changes;
}

/** Parent boxes follow their children: all checked → X, some → -, none → space. */
function fixParentBoxes(source: string, offset: number): Change[] {
	const lines = splitLines(source);
	const line = lineAt(lines, offset);
	if (!line) return [];
	const changes: Change[] = [];
	// Walk upwards, recomputing each ancestor box from the (already fixed) level below.
	const states = new Map<number, CheckboxState>();
	for (const parent of ancestors(lines, line)) {
		const item = scanListItem(parent);
		if (!item || item.mark === null) continue;
		const kids = children(lines, parent).map((k) => ({
			...k,
			state: states.get(k.line.index) ?? k.state,
		}));
		const { done, total } = summarise(kids);
		if (total === 0) continue;
		const partial = kids.some((k) => k.state === 'partial');
		const state: CheckboxState =
			done === total ? 'checked' : done > 0 || partial ? 'partial' : 'unchecked';
		states.set(parent.index, state);
		if (state !== item.state)
			changes.push({ from: item.mark, to: item.mark + 1, insert: markOf(state) });
	}
	return changes;
}

/** Set the checkbox on the line containing `offset`, then update parents and cookies. */
export function setCheckbox(source: string, offset: number, state: CheckboxState): EditResult {
	const lines = splitLines(source);
	const line = lineAt(lines, offset);
	const item = line ? scanListItem(line) : null;
	if (!item || item.mark === null) return { text: source, steps: [] };
	const at = item.line.from;
	return runEdits(source, [
		() => [{ from: item.mark!, to: item.mark! + 1, insert: markOf(state) }],
		(s) => fixParentBoxes(s, at),
		(s) => updateAncestors(s, at),
	]);
}

/** Toggle between checked and unchecked; a partial box becomes checked. */
export function toggleCheckbox(source: string, offset: number): EditResult {
	const lines = splitLines(source);
	const line = lineAt(lines, offset);
	const item = line ? scanListItem(line) : null;
	if (!item || item.state === null) return { text: source, steps: [] };
	return setCheckbox(source, offset, item.state === 'checked' ? 'unchecked' : 'checked');
}
