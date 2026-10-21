/// Org table editing in the source editor, with org's keys: Tab and
/// Shift-Tab realign the table and move between fields (Tab past the last
/// field opens a new row), Enter moves down a row (opening one at the end
/// or before a rule), `|-` then Tab draws a rule, and M-arrows move rows and
/// columns, M-S-arrows insert and delete them. State commands, so they're
/// testable without a DOM.

import type { EditorState, StateCommand, Transaction } from '@codemirror/state';
import {
	deleteColumn,
	deleteRow,
	fieldAt,
	fieldStart,
	formatTable,
	insertColumn,
	insertRow,
	isTableLine,
	moveColumn,
	moveRow,
	newTable,
	tableAt,
	type TableBlock,
	type TableRow,
} from '$lib/org';

interface Here {
	table: TableBlock;
	/** Row index in the table, and field index in the row. */
	row: number;
	field: number;
}

/** The table, row and field under the cursor, or null outside a table. */
export function tableHere(state: EditorState): Here | null {
	const sel = state.selection.main;
	const line = state.doc.lineAt(sel.head);
	if (!isTableLine(line.text)) return null;
	const table = tableAt(state.doc.toString(), line.from);
	if (!table) return null;
	const row = state.doc.lineAt(table.from).number;
	const r = table.rows[line.number - row];
	const cells = r && !r.rule ? r.cells.length : 1;
	const f = fieldAt(line.text, sel.head - line.from);
	return { table, row: line.number - row, field: Math.max(0, Math.min(f, Math.max(0, cells - 1))) };
}

/** Write `rows` back (aligned) over the table and put the cursor at a field. */
function replace(
	state: EditorState,
	dispatch: ((tr: Transaction) => void) | undefined,
	table: TableBlock,
	rows: TableRow[],
	row: number,
	field: number,
) {
	const text = formatTable(rows, table.indent);
	const lines = text.split('\n');
	let at = table.from;
	for (let i = 0; i < Math.min(row, lines.length); i += 1) at += lines[i]!.length + 1;
	const target = lines[Math.min(row, lines.length - 1)] ?? '';
	const col = fieldStart(target, field) ?? target.length;
	dispatch?.(
		state.update({
			changes: { from: table.from, to: table.to, insert: text },
			selection: { anchor: at + col },
			scrollIntoView: true,
			userEvent: 'input',
		}),
	);
	return true;
}

const width = (rows: readonly TableRow[]) =>
	Math.max(1, ...rows.flatMap((r) => (r.rule ? [] : [r.cells.length])));

/** Tab: realign, and go to the next field (a new row after the last one). */
export const nextField: StateCommand = ({ state, dispatch }) => {
	const here = tableHere(state);
	if (!here) return false;
	const { table } = here;
	let rows = table.rows;
	const n = width(rows);
	let row = here.row;
	let field = rows[row]!.rule ? n : here.field + 1;
	if (field >= n) {
		field = 0;
		row += 1;
		while (row < rows.length && rows[row]!.rule) row += 1;
		if (row >= rows.length) {
			rows = insertRow(rows, rows.length);
			row = rows.length - 1;
		}
	}
	return replace(state, dispatch, table, rows, row, field);
};

/** Shift-Tab: realign, and go to the previous field. */
export const previousField: StateCommand = ({ state, dispatch }) => {
	const here = tableHere(state);
	if (!here) return false;
	const { table } = here;
	const rows = table.rows;
	let row = here.row;
	let field = here.field - 1;
	if (field < 0 || rows[row]!.rule) {
		row -= 1;
		while (row >= 0 && rows[row]!.rule) row -= 1;
		if (row < 0) return replace(state, dispatch, table, rows, here.row, 0);
		field = width(rows) - 1;
	}
	return replace(state, dispatch, table, rows, row, field);
};

/** Enter: realign, and go down a row in the same column (opening a row when needed). */
export const nextRow: StateCommand = ({ state, dispatch }) => {
	const here = tableHere(state);
	if (!here) return false;
	const { table } = here;
	let rows = table.rows;
	const below = here.row + 1;
	if (below >= rows.length || rows[below]!.rule) rows = insertRow(rows, below);
	return replace(state, dispatch, table, rows, below, here.field);
};

const op =
	(fn: (h: Here) => { rows: TableRow[]; row: number; field: number } | null): StateCommand =>
	({ state, dispatch }) => {
		const here = tableHere(state);
		if (!here) return false;
		const next = fn(here);
		if (!next) return true;
		return replace(state, dispatch, here.table, next.rows, next.row, next.field);
	};

/** M-up / M-down: move the row. */
export const moveRowUp = op((h) =>
	h.row > 0 ? { rows: moveRow(h.table.rows, h.row, -1), row: h.row - 1, field: h.field } : null,
);
export const moveRowDown = op((h) =>
	h.row < h.table.rows.length - 1
		? { rows: moveRow(h.table.rows, h.row, 1), row: h.row + 1, field: h.field }
		: null,
);
/** M-left / M-right: move the column. */
export const moveColumnLeft = op((h) =>
	h.field > 0
		? { rows: moveColumn(h.table.rows, h.field, -1), row: h.row, field: h.field - 1 }
		: null,
);
export const moveColumnRight = op((h) =>
	h.field < width(h.table.rows) - 1
		? { rows: moveColumn(h.table.rows, h.field, 1), row: h.row, field: h.field + 1 }
		: null,
);
/** M-S-down: a new row above this one (org-table-insert-row); M-S-up: delete this row. */
export const insertRowAbove = op((h) => ({
	rows: insertRow(h.table.rows, h.row),
	row: h.row,
	field: h.field,
}));
export const deleteThisRow = op((h) => {
	if (h.table.rows.length <= 1) return null;
	const rows = deleteRow(h.table.rows, h.row);
	return { rows, row: Math.min(h.row, rows.length - 1), field: h.field };
});
/** M-S-right: a new column left of this one (org-table-insert-column); M-S-left: delete it. */
export const insertColumnHere = op((h) => ({
	rows: insertColumn(h.table.rows, h.field),
	row: h.row,
	field: h.field,
}));
export const deleteThisColumn = op((h) => {
	if (width(h.table.rows) <= 1) return null;
	return {
		rows: deleteColumn(h.table.rows, h.field),
		row: h.row,
		field: Math.min(h.field, width(h.table.rows) - 2),
	};
});

/**
 * Insert a new table (a header row, a rule and two rows) on the cursor's
 * line if it's empty, else after it, with the cursor in the first field.
 */
export const insertTable: StateCommand = ({ state, dispatch }) => {
	const line = state.doc.lineAt(state.selection.main.head);
	const indent = /^[ \t]*/.exec(line.text)![0];
	const text = formatTable(newTable(3, 2), line.text.trim() ? '' : indent);
	const empty = !line.text.trim();
	const from = empty ? line.from : line.to;
	const insert = empty ? text : `\n${text}`;
	const start = empty ? line.from : line.to + 1;
	dispatch?.(
		state.update({
			changes: { from, to: empty ? line.to : from, insert },
			selection: { anchor: start + (fieldStart(text.split('\n')[0]!, 0) ?? 0) },
			scrollIntoView: true,
			userEvent: 'input',
		}),
	);
	return true;
};
