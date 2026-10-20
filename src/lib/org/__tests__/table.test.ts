import { describe, expect, it } from 'vitest';
import { analyseTable, tableAffiliated, type TableRow } from '../table';

const parse = (text: string): TableRow[] =>
	text
		.trim()
		.split('\n')
		.map((l) =>
			/^\s*\|-/.test(l)
				? { rule: true as const }
				: {
						cells: l
							.trim()
							.replace(/^\||\|$/g, '')
							.split('|')
							.map((c) => c.trim()),
					},
		);

describe('analyseTable', () => {
	it('splits header and row groups at rules', () => {
		const t = analyseTable(
			parse(`
| Name | Qty |
|------+-----|
| a    |   1 |
| b    |   2 |
|------+-----|
| c    |   3 |`),
		);
		expect(t.head).toEqual([0]);
		expect(t.groups).toEqual([[2, 3], [5]]);
	});

	it('has no header without a rule, or when the rule opens the table', () => {
		expect(analyseTable(parse('| a | b |\n| c | d |')).head).toEqual([]);
		expect(analyseTable(parse('|---|\n| a |\n| b |')).head).toEqual([]);
		expect(analyseTable(parse('| a |\n|---|')).head).toEqual([]);
	});

	it('right-aligns mostly numeric columns (org-table-number-fraction 0.5)', () => {
		const t = analyseTable(
			parse(`
| Item | Price | Note |
|------+-------+------|
| x    | 1.50  | 3    |
| y    | 12    | ok   |
| z    | n/a   | fine |`),
		);
		expect(t.align).toEqual(['left', 'right', 'left']);
	});

	it('honours <l> <c> <r> and width cookies, hiding the cookie row', () => {
		const t = analyseTable(
			parse(`
| Title | Pages | Notes |
|-------+-------+-------|
| <c>   | <l>   | <r12> |
| Dune  | 412   | great |`),
		);
		expect(t.align).toEqual(['center', 'left', 'right']);
		expect(t.width).toEqual([null, null, 12]);
		expect(t.groups).toEqual([[3]]);
	});

	it('drops the special marker column and metadata rows', () => {
		const t = analyseTable(
			parse(`
| ! | x | y  |
| # | 1 | 2  |
| $ | a=1 |  |
|   | 3 | 4  |`),
		);
		expect(t.columns).toEqual([1, 2]);
		expect(t.groups).toEqual([[1, 3]]);
	});

	it('reads column groups from a / row', () => {
		const t = analyseTable(
			parse(`
| / | <   |   | > |
| # | a   | b | c |`),
		);
		expect(t.columns).toEqual([1, 2, 3]);
		expect(t.colGroups).toEqual(['start', null, 'end']);
	});
});

describe('tableAffiliated', () => {
	it('reads caption and name above a table', () => {
		expect(tableAffiliated('Intro\n#+CAPTION: Books I read\n#+NAME: books\n')).toEqual({
			caption: 'Books I read',
			name: 'books',
		});
		expect(tableAffiliated('Just text\n')).toEqual({ caption: null, name: null });
	});
});
