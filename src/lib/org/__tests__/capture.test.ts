import { describe, expect, it } from 'vitest';
import { appendToFile, captureEntry, newNodeSource, roamFileName } from '../capture';
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
