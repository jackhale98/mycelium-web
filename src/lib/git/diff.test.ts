import { describe, expect, it } from 'vitest';
import { diffLines, hunkBlocks, revertHunk } from './diff';

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

describe('reverting one hunk', () => {
	const before = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
	const after = before
		.replace('line 3\n', 'line three\n')
		.replace('line 20\n', '')
		.replace('line 27\n', 'line 27\nline 27b\n');

	it('undoes just that hunk, the others kept', () => {
		expect(diffLines(before, after)).toHaveLength(3);
		const first = revertHunk(before, after, 0);
		expect(first).toContain('line 3\n');
		expect(first).not.toContain('line 20\n');
		expect(first).toContain('line 27b');
		const middle = revertHunk(before, after, 1);
		expect(middle).toContain('line three');
		expect(middle).toContain('line 20\n');
		expect(revertHunk(before, after, 2)).not.toContain('line 27b');
	});

	it('all hunks undone, one at a time, give the old file back', () => {
		let now = after;
		while (diffLines(before, now).length) now = revertHunk(before, now, 0);
		expect(now).toBe(before);
	});

	it('keeps CRLF line endings', () => {
		const b = 'a\r\nb\r\nc\r\n';
		const a = 'a\r\nB\r\nc\r\n';
		expect(revertHunk(b, a, 0)).toBe(b);
	});

	it('undoes one change inside a hunk, the nearby ones kept', () => {
		const b = '* Validation\n+ costs $15k-$25k\n+ six\n+ eleven\n+ common for sterilization\n';
		const a =
			'* Validation\n+ costs $15k-$25\n+ six\n+ eleven\n+ common for [[id:x][sterilization]]\n';
		const [hunk] = diffLines(b, a);
		expect(hunkBlocks(hunk!)).toEqual([null, 0, 0, null, null, 1, 1]);
		const first = revertHunk(b, a, 0, 3, 0);
		expect(first).toContain('$15k-$25k');
		expect(first).toContain('[[id:x][sterilization]]');
		expect(revertHunk(b, a, 0, 3, 1)).toBe(
			'* Validation\n+ costs $15k-$25\n+ six\n+ eleven\n+ common for sterilization\n',
		);
	});
});
