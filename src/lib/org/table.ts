/// How org exports a table: header rows, row groups, column alignment and
/// width cookies, column groups, and the "special" marker column. Works on
/// plain cell text so the renderer stays a thin layer.

export type TableRow = { rule: true } | { rule?: false; cells: string[] };

export type Align = 'left' | 'right' | 'center';

export interface TableLayout {
	/** Indices (into the input rows) of header rows. */
	head: number[];
	/** Body row indices, split into groups at horizontal rules. */
	groups: number[][];
	/** Columns to render (the special marker column is dropped). */
	columns: number[];
	align: Align[];
	/** Width cookie per column (`<10>`), in characters. */
	width: (number | null)[];
	/** Vertical rules from a `/` row: before (`<`), after (`>`) or both. */
	colGroups: ('start' | 'end' | 'both' | null)[];
}

/** org-table-number-regexp's default. */
const NUMBER_RE =
	/^(?:[<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|[<>]?[-+]?0[xX][0-9a-fA-F.]+|[<>]?[-+]?[0-9]+#[0-9a-zA-Z.]+|nan|[-+u]?inf)$/;
/** org-table-number-fraction's default. */
const NUMBER_FRACTION = 0.5;
const COOKIE_RE = /^<([lrc])?(\d+)?>$/;
const MARKERS = new Set(['', '#', '!', '$', '*', '^', '_', '/']);
/** Rows with these markers carry spreadsheet metadata and aren't exported. */
const HIDDEN_MARKERS = new Set(['!', '$', '^', '_', '/']);

const isCookieRow = (cells: string[]) =>
	cells.some((c) => c.trim()) && cells.every((c) => !c.trim() || COOKIE_RE.test(c.trim()));

export function analyseTable(rows: readonly TableRow[]): TableLayout {
	const data = rows.flatMap((r, i) => (r.rule ? [] : [{ i, cells: r.cells }]));
	const width = Math.max(0, ...data.map((r) => r.cells.length));

	// org-export-table-has-special-column-p: every first field is a marker
	// (or empty), and at least one is a marker.
	const special =
		data.length > 0 &&
		data.every((r) => MARKERS.has((r.cells[0] ?? '').trim())) &&
		data.some((r) => (r.cells[0] ?? '').trim() !== '');
	const columns = Array.from({ length: width }, (_, c) => c).filter((c) => !(special && c === 0));

	const hidden = new Set<number>();
	let groupRow: string[] | null = null;
	let cookies: string[] | null = null;
	for (const r of data) {
		const marker = (r.cells[0] ?? '').trim();
		if (marker === '/') {
			groupRow ??= r.cells;
			hidden.add(r.i);
		} else if (special && HIDDEN_MARKERS.has(marker)) hidden.add(r.i);
		else if (isCookieRow(special ? r.cells.slice(1) : r.cells)) {
			cookies ??= r.cells;
			hidden.add(r.i);
		}
	}

	// Header: rows before the first rule, when a rule separates them from more rows.
	const visible = rows.map((r, i) => ({ r, i })).filter(({ r, i }) => r.rule || !hidden.has(i));
	const firstRule = visible.findIndex(({ r }) => r.rule);
	const beforeRule = firstRule > 0 ? visible.slice(0, firstRule).filter(({ r }) => !r.rule) : [];
	const afterRule = firstRule >= 0 ? visible.slice(firstRule).some(({ r }) => !r.rule) : false;
	const head = beforeRule.length && afterRule ? beforeRule.map(({ i }) => i) : [];
	const groups: number[][] = [];
	let current: number[] = [];
	for (const { r, i } of visible) {
		if (head.includes(i)) continue;
		if (r.rule) {
			if (current.length) groups.push(current);
			current = [];
		} else current.push(i);
	}
	if (current.length) groups.push(current);

	const cell = (i: number, c: number) => {
		const row = rows[i]!;
		return row.rule ? '' : (row.cells[c] ?? '').trim();
	};
	const shown = [...head, ...groups.flat()];
	const align = columns.map((c): Align => {
		const cookie = COOKIE_RE.exec((cookies?.[c] ?? '').trim());
		if (cookie?.[1]) return cookie[1] === 'r' ? 'right' : cookie[1] === 'c' ? 'center' : 'left';
		const values = shown.map((i) => cell(i, c)).filter(Boolean);
		const numbers = values.filter((v) => NUMBER_RE.test(v)).length;
		return values.length && numbers / values.length >= NUMBER_FRACTION ? 'right' : 'left';
	});
	const widths = columns.map((c) => {
		const n = COOKIE_RE.exec((cookies?.[c] ?? '').trim())?.[2];
		return n ? Number(n) : null;
	});
	const colGroups = columns.map((c) => {
		const g = (groupRow?.[c] ?? '').trim();
		return g === '<' ? 'start' : g === '>' ? 'end' : g === '<>' ? 'both' : null;
	});
	return { head, groups, columns, align, width: widths, colGroups };
}

/** `#+CAPTION:` and `#+NAME:` keywords written directly above a table. */
export function tableAffiliated(textBefore: string): {
	caption: string | null;
	name: string | null;
} {
	let caption: string | null = null;
	let name: string | null = null;
	const lines = textBefore.split('\n');
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i]!;
		if (i === lines.length - 1 && !line.trim()) continue;
		const m =
			/^[ \t]*#\+(CAPTION|NAME|ATTR_\w+|PLOT|RESULTS)(?:\[[^\]]*\])?:[ \t]*(.*?)[ \t]*$/i.exec(
				line,
			);
		if (!m) break;
		const key = m[1]!.toUpperCase();
		if (key === 'CAPTION') caption = caption ? `${m[2]} ${caption}` : m[2]!;
		else if (key === 'NAME') name ??= m[2]!;
	}
	return { caption, name };
}
