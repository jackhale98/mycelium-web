import { describe, expect, it } from 'vitest';
import { appendToFile, captureEntry, captureItem, newNodeSource, roamFileName } from '../capture';
import { applyChanges } from '../text';
import { apply } from './helpers';

describe('capture', () => {
	it('creates org-roam style files', () => {
		expect(newNodeSource('Hello', 'abc', { filetags: ['x'] })).toBe(
			':PROPERTIES:\n:ID:       abc\n:END:\n#+title: Hello\n#+filetags: :x:\n',
		);
	});

	it('appends with the file line endings', () => {
		expect(apply('a', appendToFile('a', '* b'))).toBe('a\n* b\n');
		expect(apply('a\r\n', appendToFile('a\r\n', '* b\nmore'))).toBe('a\r\n* b\r\nmore\r\n');
		expect(apply('', appendToFile('', '* b'))).toBe('* b\n');
	});

	it('builds entries and file names', () => {
		expect(captureEntry('  idea \nsecond line')).toBe('* idea\nsecond line');
		expect(roamFileName('my_note', new Date(2026, 9, 20, 9, 5, 7))).toBe(
			'20261020090507-my_note.org',
		);
	});
});

describe('captureItem', () => {
	const now = { date: '2026-10-20', time: '09:12' };
	const add = (source: string, text: string) =>
		applyChanges(source, captureItem(source, text, now));

	it('starts a Captured heading at the end of the file', () => {
		expect(add('#+title: 2026-10-20\n', 'Call the arborist')).toBe(
			'#+title: 2026-10-20\n* Captured\n- [2026-10-20 Tue 09:12] Call the arborist\n',
		);
		expect(add('', 'x')).toBe('* Captured\n- [2026-10-20 Tue 09:12] x\n');
	});

	it('adds to an existing Captured section, before the next heading', () => {
		const source = '* Captured\n- [2026-10-20 Tue 08:00] first\n\n* Later\nbody\n';
		expect(add(source, 'second')).toBe(
			'* Captured\n- [2026-10-20 Tue 08:00] first\n- [2026-10-20 Tue 09:12] second\n\n* Later\nbody\n',
		);
	});

	it('handles a last line without a newline, CRLF files and tagged headings', () => {
		expect(add('* Captured :inbox:\n- a', 'b')).toBe(
			'* Captured :inbox:\n- a\n- [2026-10-20 Tue 09:12] b',
		);
		expect(add('* Captured\r\n- a\r\n', 'b')).toBe(
			'* Captured\r\n- a\r\n- [2026-10-20 Tue 09:12] b\r\n',
		);
	});

	it('ignores sub-headings and other headings named Captured', () => {
		expect(add('** Captured\n', 'x')).toBe('** Captured\n* Captured\n- [2026-10-20 Tue 09:12] x\n');
	});

	it('indents later lines of a multi-line capture under the item', () => {
		expect(add('* Captured\n', 'idea\nmore detail')).toBe(
			'* Captured\n- [2026-10-20 Tue 09:12] idea\n  more detail\n',
		);
	});
});
