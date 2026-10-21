import { describe, expect, it } from 'vitest';
import {
	alignTableAt,
	applyChanges,
	deleteColumn,
	displayWidth,
	fieldAt,
	fieldStart,
	formatTable,
	insertColumn,
	insertRow,
	moveColumn,
	moveRow,
	newTable,
	parseTableLine,
	tableAt,
} from '..';

const align = (src: string, at = 0) => {
	const c = alignTableAt(src, at);
	return c ? applyChanges(src, [c]) : src;
};

describe('reading a table (org-table-to-lisp)', () => {
	it('splits fields, trims them, and spots rules', () => {
		expect(parseTableLine('|  a | b  |c|')).toEqual({ cells: ['a', 'b', 'c'] });
		expect(parseTableLine('| a |  |')).toEqual({ cells: ['a', ''] });
		expect(parseTableLine('| a | b')).toEqual({ cells: ['a', 'b'] });
		expect(parseTableLine('|')).toEqual({ cells: [] });
		expect(parseTableLine('  |---+---|')).toEqual({ rule: true });
		expect(parseTableLine('|-')).toEqual({ rule: true });
	});
	it('finds the whole table around a point', () => {
		const src = 'Intro\n| a |\n|---|\n| b |\nAfter\n';
		const t = tableAt(src, src.indexOf('b'))!;
		expect(src.slice(t.from, t.to)).toBe('| a |\n|---|\n| b |');
		expect(tableAt(src, 2)).toBeNull();
	});
});

describe('aligning (org-table-align)', () => {
	it('pads columns to the widest cell and draws rules', () => {
		expect(align('|Name|Phone|\n|-\n|Ada|123|\n')).toBe(
			'| Name | Phone |\n|------+-------|\n| Ada  |   123 |\n',
		);
	});
	it('right-aligns columns that are at least half numbers', () => {
		expect(align('| x | 1 |\n| y | 22 |\n| z | n/a |\n')).toBe(
			'| x |   1 |\n| y |  22 |\n| z | n/a |\n',
		);
		expect(align('| a | 1 |\n| b | x |\n| c | y |\n')).toBe('| a | 1 |\n| b | x |\n| c | y |\n');
	});
	it('follows <l> <r> <c> cookies', () => {
		expect(align('| <r> | <c> |\n| a | b |\n| long | longer |\n')).toBe(
			'|  <r> |  <c>   |\n|    a |   b    |\n| long | longer |\n',
		);
	});
	it('fills short rows, keeps the indentation, and handles empty columns', () => {
		expect(align('  | a | b |\n  | c |\n')).toBe('  | a | b |\n  | c |   |\n');
		expect(align('|  |\n|  |\n')).toBe('|   |\n|   |\n');
	});
	it('measures links by their description, and wide characters as two', () => {
		expect(displayWidth('[[id:abc][Ada]]')).toBe(3);
		expect(displayWidth('[[https://x.org]]')).toBe(13);
		expect(displayWidth('日本')).toBe(4);
		expect(displayWidth('❌ 🚀')).toBe(5);
		expect(align('| [[id:a][Ada]] |\n| Grace |\n')).toBe('| [[id:a][Ada]]   |\n| Grace |\n');
	});
	it('leaves an aligned table alone', () => {
		expect(alignTableAt('| a | b |\n|---+---|\n| c | d |\n', 0)).toBeNull();
	});
});

describe('rows and columns', () => {
	const rows = [{ cells: ['a', 'b'] }, { rule: true as const }, { cells: ['c', 'd'] }];
	it('inserts, moves and deletes columns and rows', () => {
		expect(formatTable(insertColumn(rows, 1))).toBe('| a |   | b |\n|---+---+---|\n| c |   | d |');
		expect(formatTable(deleteColumn(rows, 0))).toBe('| b |\n|---|\n| d |');
		expect(formatTable(moveColumn(rows, 0, 1))).toBe('| b | a |\n|---+---|\n| d | c |');
		expect(formatTable(insertRow(rows, 3))).toBe('| a | b |\n|---+---|\n| c | d |\n|   |   |');
		expect(formatTable(moveRow(rows, 2, -1))).toBe('| a | b |\n| c | d |\n|---+---|');
	});
	it('makes a new table with a header', () => {
		expect(formatTable(newTable(2, 1))).toBe('|   |   |\n|---+---|\n|   |   |');
	});
});

describe('cells in a line', () => {
	it('finds the field at a column, and where its text starts', () => {
		const line = '| Ada  |   123 |';
		expect(fieldAt(line, 3)).toBe(0);
		expect(fieldAt(line, 9)).toBe(1);
		expect(fieldStart(line, 0)).toBe(2);
		expect(fieldStart(line, 1)).toBe(11);
		expect(fieldStart('|   |', 0)).toBe(2);
		expect(fieldStart(line, 2)).toBeNull();
	});
});
