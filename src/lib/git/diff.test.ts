import { describe, expect, it } from 'vitest';
import { diffLines } from './diff';

describe('diffLines', () => {
	it('produces hunks with context and line numbers', () => {
		const before = 'a\nb\nc\nd\ne\nf\ng\nh\n';
		const after = 'a\nb\nc\nD\ne\nf\ng\nh\ni\n';
		const hunks = diffLines(before, after, 1);
		expect(hunks).toHaveLength(2);
		expect(hunks[0]!.lines.map((l) => `${l.kind[0]}${l.text}`)).toEqual(['cc', 'rd', 'aD', 'ce']);
		expect(hunks[0]!.lines[1]).toMatchObject({ oldNo: 4, newNo: null });
		expect(hunks[1]!.lines.map((l) => `${l.kind[0]}${l.text}`)).toEqual(['ch', 'ai']);
	});

	it('handles new and deleted files', () => {
		expect(diffLines('', 'x\n')[0]!.lines).toEqual([
			{ kind: 'add', text: 'x', oldNo: null, newNo: 1 },
		]);
		expect(diffLines('x\n', '')[0]!.lines[0]!.kind).toBe('remove');
		expect(diffLines('same\n', 'same\n')).toEqual([]);
	});
});
