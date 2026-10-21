import { describe, expect, it } from 'vitest';
import { attachmentCandidates, attachmentDirs, idFolders, isImageFile } from '../attach';

describe('attachments', () => {
	it('lays out ID folders in org-attach-id-to-path-function-list order', () => {
		expect(idFolders('8d0b2cd9-6c3f-4d5e-9f3a-123456789abc')).toEqual([
			'8d/0b2cd9-6c3f-4d5e-9f3a-123456789abc',
			'8d0b2c/d9-6c3f-4d5e-9f3a-123456789abc',
			'__/8/8d0b2cd9-6c3f-4d5e-9f3a-123456789abc',
		]);
		expect(idFolders('20261021T093000.123')[1]).toBe('202610/21T093000.123');
		expect(idFolders('ab')).toEqual(['__/a/ab']);
	});

	it('uses the entry ID under data/, relative to the file', () => {
		const src = '* Trip\n:PROPERTIES:\n:ID: abc123\n:END:\nSee [[attachment:map.png]].\n';
		const at = src.indexOf('[[attachment');
		expect(attachmentDirs(src, at, 'notes/trip.org')[0]).toBe('notes/data/ab/c123');
		expect(attachmentCandidates(src, at, 'notes/trip.org', 'map.png')[0]).toBe(
			'notes/data/ab/c123/map.png',
		);
	});

	it('prefers :DIR:, relative to the file', () => {
		const src =
			'* Trip\n:PROPERTIES:\n:ID: abc123\n:DIR: ./trip-files/\n:END:\n[[attachment:a.jpg]]\n';
		expect(attachmentDirs(src, src.length - 3, 'notes/trip.org')).toEqual(['notes/trip-files']);
	});

	it('uses the file-level drawer before the first heading, and no inheritance below', () => {
		const src =
			':PROPERTIES:\n:ID: filelevel\n:END:\n#+title: X\n[[attachment:top.png]]\n* Child\n[[attachment:c.png]]\n';
		expect(attachmentDirs(src, src.indexOf('top.png'), 'x.org')[0]).toBe('data/fi/lelevel');
		// org-use-property-inheritance is nil by default: a heading without ID or DIR has none.
		expect(attachmentDirs(src, src.indexOf('c.png'), 'x.org')).toEqual([]);
	});

	it('recognises the image types Emacs previews', () => {
		for (const f of ['a.png', 'b.JPG', 'c.jpeg', 'd.svg', 'e.webp', 'f.gif', 'g.tif'])
			expect(isImageFile(f), f).toBe(true);
		expect(isImageFile('notes.pdf')).toBe(false);
		expect(isImageFile('a.png::3')).toBe(true);
	});
});
