/// Text primitives shared by every org edit.
///
/// The whole org layer obeys one rule: a file is never re-serialised from a
/// parse tree. Every edit is a list of `Change`s against the exact source that
/// was loaded, so bytes outside the targeted ranges are preserved by
/// construction — line endings, indentation, alignment and syntax we do not
/// understand included.

/** Replace `source.slice(from, to)` with `insert`. Offsets index the original source. */
export interface Change {
	from: number;
	to: number;
	insert: string;
}

/** One line of a source string. `to` excludes the line terminator, `end` includes it. */
export interface Line {
	/** Zero-based line number. */
	index: number;
	from: number;
	to: number;
	end: number;
	text: string;
	/** `'\n'`, `'\r\n'` or `''` for a final line without a terminator. */
	eol: string;
}

/** Split `source` into lines, keeping exact offsets and terminators. */
export function splitLines(source: string): Line[] {
	const lines: Line[] = [];
	let from = 0;
	let index = 0;
	while (from < source.length) {
		const nl = source.indexOf('\n', from);
		if (nl === -1) {
			lines.push({
				index,
				from,
				to: source.length,
				end: source.length,
				text: source.slice(from),
				eol: '',
			});
			break;
		}
		const cr = nl > from && source[nl - 1] === '\r';
		const to = cr ? nl - 1 : nl;
		lines.push({
			index,
			from,
			to,
			end: nl + 1,
			text: source.slice(from, to),
			eol: cr ? '\r\n' : '\n',
		});
		from = nl + 1;
		index += 1;
	}
	return lines;
}

/** The line containing `offset`. Offsets on a terminator belong to that line. */
export function lineAt(lines: readonly Line[], offset: number): Line | undefined {
	let lo = 0;
	let hi = lines.length - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const line = lines[mid]!;
		if (offset < line.from) hi = mid - 1;
		else if (offset >= line.end && mid < lines.length - 1) lo = mid + 1;
		else return line;
	}
	return undefined;
}

/** The line terminator a file predominantly uses, defaulting to `\n`. */
export function detectEol(source: string): '\n' | '\r\n' {
	const nl = source.indexOf('\n');
	return nl > 0 && source[nl - 1] === '\r' ? '\r\n' : '\n';
}

/**
 * Apply changes expressed against `source`. Changes may be given in any order
 * but must not overlap; zero-width inserts at the same offset are applied in
 * the order given.
 */
export function applyChanges(source: string, changes: readonly Change[]): string {
	if (changes.length === 0) return source;
	const ordered = changes
		.map((change, order) => ({ change, order }))
		.sort(
			(a, b) => a.change.from - b.change.from || a.change.to - b.change.to || a.order - b.order,
		);
	let out = '';
	let cursor = 0;
	for (const { change } of ordered) {
		if (change.from < cursor || change.to < change.from || change.to > source.length) {
			throw new RangeError(`Overlapping or out-of-range change ${change.from}-${change.to}`);
		}
		out += source.slice(cursor, change.from) + change.insert;
		cursor = change.to;
	}
	return out + source.slice(cursor);
}

/** Drop changes that would leave the text as it was. */
export function effective(source: string, changes: readonly Change[]): Change[] {
	return changes.filter((c) => source.slice(c.from, c.to) !== c.insert);
}

/** An edit is a pure function from a source string to the changes it makes. */
export type Edit = (source: string) => Change[];

/** Result of running several edits in sequence. */
export interface EditResult {
	text: string;
	/** One change set per edit, each expressed against the text before that edit. */
	steps: Change[][];
}

/**
 * Run edits one after another, each against the output of the previous. This
 * lets composite operations (complete a task: change keyword, stamp CLOSED,
 * shift a repeater) stay simple without coordinating offsets.
 */
export function runEdits(source: string, edits: readonly Edit[]): EditResult {
	let text = source;
	const steps: Change[][] = [];
	for (const edit of edits) {
		const changes = effective(text, edit(text));
		if (changes.length === 0) continue;
		text = applyChanges(text, changes);
		steps.push(changes);
	}
	return { text, steps };
}

/** The smallest single change turning `before` into `after`. */
export function minimalChange(before: string, after: string): Change | null {
	if (before === after) return null;
	let start = 0;
	const max = Math.min(before.length, after.length);
	while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
	let endBefore = before.length;
	let endAfter = after.length;
	while (
		endBefore > start &&
		endAfter > start &&
		before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
	) {
		endBefore -= 1;
		endAfter -= 1;
	}
	return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

/** Visual width of leading whitespace, with tabs at 8 columns as Emacs does. */
export function indentWidth(text: string): number {
	let width = 0;
	for (const ch of text) {
		if (ch === ' ') width += 1;
		else if (ch === '\t') width += 8 - (width % 8);
		else break;
	}
	return width;
}

export function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
