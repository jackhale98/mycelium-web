import { describe, expect, it } from 'vitest';
import { applyChanges, lineAt, minimalChange, runEdits, splitLines } from '../text';

describe('splitLines', () => {
	it('keeps exact offsets and terminators', () => {
		const lines = splitLines('a\r\nbb\nccc');
		expect(lines.map((l) => [l.text, l.eol, l.from, l.to, l.end])).toEqual([
			['a', '\r\n', 0, 1, 3],
			['bb', '\n', 3, 5, 6],
			['ccc', '', 6, 9, 9],
		]);
	});

	it('handles a trailing newline without inventing an empty line', () => {
		expect(splitLines('a\n').length).toBe(1);
		expect(splitLines('').length).toBe(0);
	});

	it('finds the line for any offset', () => {
		const lines = splitLines('one\ntwo\nthree');
		expect(lineAt(lines, 0)?.text).toBe('one');
		expect(lineAt(lines, 3)?.text).toBe('one');
		expect(lineAt(lines, 4)?.text).toBe('two');
		expect(lineAt(lines, 13)?.text).toBe('three');
	});
});

describe('applyChanges', () => {
	it('applies unordered, non-overlapping changes', () => {
		expect(
			applyChanges('hello world', [
				{ from: 6, to: 11, insert: 'there' },
				{ from: 0, to: 5, insert: 'hi' },
			]),
		).toBe('hi there');
	});

	it('keeps same-offset inserts in the order given', () => {
		expect(
			applyChanges('ab', [
				{ from: 1, to: 1, insert: '1' },
				{ from: 1, to: 1, insert: '2' },
			]),
		).toBe('a12b');
	});

	it('rejects overlapping changes', () => {
		expect(() =>
			applyChanges('abcdef', [
				{ from: 0, to: 3, insert: '' },
				{ from: 2, to: 4, insert: '' },
			]),
		).toThrow(RangeError);
	});
});

describe('runEdits', () => {
	it('runs edits against each intermediate text', () => {
		const result = runEdits('abc', [() => [{ from: 0, to: 1, insert: 'xx' }], (s) => [{ from: s.length, to: s.length, insert: '!' }]]);
		expect(result.text).toBe('xxbc!');
		expect(result.steps.length).toBe(2);
	});
});

describe('minimalChange', () => {
	it('trims the common prefix and suffix', () => {
		expect(minimalChange('* TODO Task', '* DONE Task')).toEqual({ from: 2, to: 6, insert: 'DONE' });
		expect(minimalChange('same', 'same')).toBeNull();
	});
});
