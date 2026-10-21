/// Editing org tables: find the table at a point, read it into rows of
/// cells, and write it back aligned exactly as `org-table-align` does, so a
/// table edited here and then in Emacs produces no diff. Row and column
/// operations work on the parsed rows, for the editor's keys and the
/// table sheet alike.
///
/// `org-table-align`: each column is as wide as its widest cell (at least
/// 1), measured as displayed (a link shows only its description, wide
/// characters count double); a column is right-aligned when at least half
/// of its non-empty cells are numbers (`org-table-number-fraction`), unless
/// a `<l>`/`<r>`/`<c>` cookie says otherwise; fields are padded with one
/// space each side; rules become `|---+---|`; short rows get empty cells;
/// the first line's indentation is used for every line.

import type { TableRow } from './table';
import { splitLines, type Change } from './text';

export interface TableBlock {
	/** Offset of the table's first line, and of the end of its last line (before the newline). */
	from: number;
	to: number;
	/** The first line's indentation. */
	indent: string;
	rows: TableRow[];
}

/** org-table-number-regexp's default. */
const NUMBER_RE =
	/^(?:[<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|[<>]?[-+]?0[xX][0-9a-fA-F.]+|[<>]?[-+]?[0-9]+#[0-9a-zA-Z.]+|nan|[-+u]?inf)$/;
const NUMBER_FRACTION = 0.5;
const COOKIE_RE = /^<([lrc])[0-9]*>$/;
/** A table line: optional indentation, then `|`. (Lines starting `+-` are table.el tables.) */
const TABLE_LINE_RE = /^[ \t]*\|/;

export const isTableLine = (text: string) => TABLE_LINE_RE.test(text);

/** One table line's fields (`org-table-to-lisp`), or a rule. */
export function parseTableLine(text: string): TableRow {
	const at = text.indexOf('|');
	const rest = text.slice(at + 1);
	if (rest.startsWith('-')) return { rule: true };
	const cells: string[] = [];
	let i = 0;
	for (;;) {
		while (i < rest.length && (rest[i] === ' ' || rest[i] === '\t')) i += 1;
		if (i >= rest.length) break;
		const bar = rest.indexOf('|', i);
		const end = bar === -1 ? rest.length : bar;
		cells.push(rest.slice(i, end).replace(/[ \t]+$/, ''));
		i = bar === -1 ? rest.length : bar + 1;
	}
	return { cells };
}

/** The table around `offset`, or `null` when that line isn't part of one. */
export function tableAt(source: string, offset: number): TableBlock | null {
	const lines = splitLines(source);
	let i = lines.findIndex((l) => l.end > offset || (l.to >= offset && l.end === l.to));
	if (i === -1) i = lines.length - 1;
	if (i < 0 || !isTableLine(lines[i]!.text)) return null;
	let first = i;
	while (first > 0 && isTableLine(lines[first - 1]!.text)) first -= 1;
	let last = i;
	while (last + 1 < lines.length && isTableLine(lines[last + 1]!.text)) last += 1;
	const block = lines.slice(first, last + 1);
	return {
		from: block[0]!.from,
		to: block.at(-1)!.to,
		indent: /^[ \t]*/.exec(block[0]!.text)![0],
		rows: block.map((l) => parseTableLine(l.text)),
	};
}

// East Asian Wide and Fullwidth characters, including emoji with emoji
// presentation (Unicode EastAsianWidth "W"), as Emacs's char-width-table.
const WIDE_RE =
	/[\u1100-\u115F\u231A\u231B\u2329\u232A\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|[\u{1F004}\u{1F0CF}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F200}-\u{1F251}\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F7E0}-\u{1F7EB}\u{1F90C}-\u{1F9FF}\u{1FA70}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u;
const ZERO_RE = /[̀-ͯ​-‏︀-️]/u;

/**
 * A cell's width as Emacs shows it (`org-string-width`): bracket links
 * display only their description (or target), wide characters take two
 * columns, combining marks none.
 */
export function displayWidth(text: string): number {
	const shown = text.replace(/\[\[((?:[^\]\\]|\\.)+)\](?:\[([^\]]*)\])?\]/g, (_, target, desc) =>
		desc !== undefined ? desc : target,
	);
	let w = 0;
	for (const ch of shown) w += ZERO_RE.test(ch) ? 0 : WIDE_RE.test(ch) ? 2 : 1;
	return w;
}

/** Column widths and alignments, as `org-table-align` computes them. */
export function tableColumns(rows: readonly TableRow[]): {
	widths: number[];
	align: ('l' | 'r' | 'c')[];
} {
	const data = rows.flatMap((r) => (r.rule ? [] : [r.cells]));
	const columns = Math.max(1, ...data.map((c) => c.length));
	const widths: number[] = [];
	const align: ('l' | 'r' | 'c')[] = [];
	for (let i = 0; i < columns; i += 1) {
		let width = 1;
		let fixed: 'l' | 'r' | 'c' | null = null;
		let numbers = 0;
		let nonEmpty = 0;
		for (const cells of data) {
			const cell = cells[i] ?? '';
			width = Math.max(width, displayWidth(cell));
			if (fixed || cell === '') continue;
			const cookie = COOKIE_RE.exec(cell);
			if (cookie) fixed = cookie[1] as 'l' | 'r' | 'c';
			else {
				nonEmpty += 1;
				if (NUMBER_RE.test(cell)) numbers += 1;
			}
		}
		widths.push(width);
		align.push(fixed ?? (numbers >= NUMBER_FRACTION * nonEmpty ? 'r' : 'l'));
	}
	return { widths, align };
}

/** The table's lines, aligned (`org-table-align`), without a final newline. */
export function formatTable(rows: readonly TableRow[], indent = ''): string {
	if (!rows.length) return '';
	const { widths, align } = tableColumns(rows);
	const rule = widths.map((w) => '-'.repeat(w + 2)).join('+');
	return rows
		.map((row) => {
			if (row.rule) return `${indent}|${rule}|`;
			const fields = widths.map((w, i) => {
				const cell = row.cells[i] ?? '';
				const spaces = w - displayWidth(cell);
				const a = align[i];
				const pre = a === 'r' ? spaces : a === 'c' ? Math.floor(spaces / 2) : 0;
				return ` ${' '.repeat(pre)}${cell}${' '.repeat(spaces - pre)} `;
			});
			return `${indent}|${fields.join('|')}|`;
		})
		.join('\n');
}

/** Realign the table at `offset`; `null` when there's no table or nothing changes. */
export function alignTableAt(source: string, offset: number): Change | null {
	const t = tableAt(source, offset);
	if (!t) return null;
	const text = formatTable(t.rows, t.indent);
	return text === source.slice(t.from, t.to) ? null : { from: t.from, to: t.to, insert: text };
}

/** A cell's text can't hold `|`: org writes it as `\vert{}`. Newlines become spaces. */
export function cleanCell(text: string): string {
	return text.replace(/\r?\n/g, ' ').replace(/\|/g, '\\vert{}').trim();
}

// ------------------------------------------------------------------ rows and columns

const columnCount = (rows: readonly TableRow[]) =>
	Math.max(1, ...rows.flatMap((r) => (r.rule ? [] : [r.cells.length])));

const emptyRow = (rows: readonly TableRow[]): TableRow => ({
	cells: Array.from({ length: columnCount(rows) }, () => ''),
});

export function insertRow(rows: readonly TableRow[], at: number): TableRow[] {
	const out = [...rows];
	out.splice(Math.max(0, Math.min(at, out.length)), 0, emptyRow(rows));
	return out;
}

export function insertRule(rows: readonly TableRow[], at: number): TableRow[] {
	const out = [...rows];
	out.splice(Math.max(0, Math.min(at, out.length)), 0, { rule: true });
	return out;
}

export function deleteRow(rows: readonly TableRow[], at: number): TableRow[] {
	return rows.filter((_, i) => i !== at);
}

export function moveRow(rows: readonly TableRow[], at: number, by: -1 | 1): TableRow[] {
	const to = at + by;
	if (to < 0 || to >= rows.length) return [...rows];
	const out = [...rows];
	[out[at], out[to]] = [out[to]!, out[at]!];
	return out;
}

const mapCells = (rows: readonly TableRow[], fn: (cells: string[]) => string[]): TableRow[] =>
	rows.map((r) => {
		if (r.rule) return r;
		const n = columnCount(rows);
		const cells = [...r.cells, ...Array.from({ length: n - r.cells.length }, () => '')];
		return { cells: fn(cells) };
	});

export function insertColumn(rows: readonly TableRow[], at: number): TableRow[] {
	return mapCells(rows, (c) => [...c.slice(0, at), '', ...c.slice(at)]);
}

export function deleteColumn(rows: readonly TableRow[], at: number): TableRow[] {
	if (columnCount(rows) <= 1) return [...rows];
	return mapCells(rows, (c) => c.filter((_, i) => i !== at));
}

export function moveColumn(rows: readonly TableRow[], at: number, by: -1 | 1): TableRow[] {
	const to = at + by;
	if (to < 0 || to >= columnCount(rows)) return [...rows];
	return mapCells(rows, (c) => {
		const out = [...c];
		[out[at], out[to]] = [out[to]!, out[at]!];
		return out;
	});
}

/** A new table: a header row, a rule, and `bodyRows` empty rows. */
export function newTable(columns = 3, bodyRows = 2): TableRow[] {
	const row = (): TableRow => ({ cells: Array.from({ length: columns }, () => '') });
	return [row(), { rule: true }, ...Array.from({ length: bodyRows }, row)];
}

// ------------------------------------------------------------------ cells in text

/** Which field of a table line `column` is in (0-based), or -1 before the first bar. */
export function fieldAt(lineText: string, column: number): number {
	const first = lineText.indexOf('|');
	if (first === -1 || column <= first) return -1;
	let n = -1;
	for (let i = first; i < column && i < lineText.length; i += 1) if (lineText[i] === '|') n += 1;
	return n;
}

/**
 * Where a field's text starts in an aligned table line: after the bar and
 * its space, and after any alignment padding (where `org-table-next-field`
 * leaves the cursor). Null if the line has fewer fields.
 */
export function fieldStart(lineText: string, field: number): number | null {
	let bar = lineText.indexOf('|');
	for (let n = 0; n < field && bar !== -1; n += 1) bar = lineText.indexOf('|', bar + 1);
	if (bar === -1) return null;
	const next = lineText.indexOf('|', bar + 1);
	if (next === -1) return null;
	const inner = lineText.slice(bar + 1, next);
	const lead = inner.length - inner.trimStart().length;
	return inner.trim() ? bar + 1 + lead : bar + 2;
}
