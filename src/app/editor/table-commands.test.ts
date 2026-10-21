import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
	deleteThisColumn,
	insertTable,
	insertRowAbove,
	moveColumnRight,
	moveRowDown,
	nextField,
	nextRow,
	previousField,
} from './table-commands';

/** Run a command on `text`; `¦` marks the cursor (tables use `|` themselves). */
function exec(cmd: StateCommand, text: string): string | false {
	const at = text.indexOf('¦');
	let state = EditorState.create({
		doc: text.replace('¦', ''),
		selection: EditorSelection.cursor(at),
	});
	if (!cmd({ state, dispatch: (tr) => (state = tr.state) })) return false;
	const doc = state.doc.toString();
	const head = state.selection.main.head;
	return doc.slice(0, head) + '¦' + doc.slice(head);
}

describe('table keys', () => {
	it('Tab aligns and moves to the next field, then the next row', () => {
		expect(exec(nextField, '|Name¦|Phone|\n')).toBe('| Name | ¦Phone |\n');
		expect(exec(nextField, '| a | b¦ |\n| c | d |\n')).toBe('| a | b |\n| ¦c | d |\n');
	});
	it('Tab after the last field opens a new row', () => {
		expect(exec(nextField, '| a | b¦ |\nText')).toBe('| a | b |\n| ¦  |   |\nText');
	});
	it('`|-` then Tab draws a rule and moves on', () => {
		expect(exec(nextField, '| Name | Phone |\n|-¦\n')).toBe(
			'| Name | Phone |\n|------+-------|\n| ¦     |       |\n',
		);
	});
	it('Tab skips rules, and lands on the text of right-aligned numbers', () => {
		expect(exec(nextField, '| x¦ |\n|---|\n| 123 |\n| 4 |\n')).toBe(
			'|   x |\n|-----|\n| ¦123 |\n|   4 |\n',
		);
	});
	it('Shift-Tab goes back, across rows', () => {
		expect(exec(previousField, '| a | b |\n| ¦c | d |\n')).toBe('| a | ¦b |\n| c | d |\n');
		expect(exec(previousField, '| ¦a | b |\n')).toBe('| ¦a | b |\n');
	});
	it('Enter goes down a column, opening a row at the end or before a rule', () => {
		expect(exec(nextRow, '| a | b¦ |\n| c | d |\n')).toBe('| a | b |\n| c | ¦d |\n');
		expect(exec(nextRow, '| a | b¦ |\n|---+---|\n')).toBe('| a | b |\n|   | ¦  |\n|---+---|\n');
	});
	it('M-arrows move rows and columns; M-S-arrows insert and delete', () => {
		expect(exec(moveRowDown, '| ¦a |\n| b |\n')).toBe('| b |\n| ¦a |\n');
		expect(exec(moveColumnRight, '| ¦a | b |\n')).toBe('| b | ¦a |\n');
		expect(exec(insertRowAbove, '| a |\n| ¦b |\n')).toBe('| a |\n| ¦  |\n| b |\n');
		expect(exec(deleteThisColumn, '| a | ¦b |\n')).toBe('| ¦a |\n');
	});
	it('inserts a new table on an empty line, or after the current one', () => {
		expect(exec(insertTable, 'Intro\n¦')).toBe(
			'Intro\n| ¦  |   |   |\n|---+---+---|\n|   |   |   |\n|   |   |   |',
		);
		expect(exec(insertTable, 'Intro¦')).toBe(
			'Intro\n| ¦  |   |   |\n|---+---+---|\n|   |   |   |\n|   |   |   |',
		);
	});
	it('does nothing outside a table', () => {
		expect(exec(nextField, 'plain ¦text')).toBe(false);
	});
});
