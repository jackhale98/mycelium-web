import { describe, expect, it } from 'vitest';
import { mergeText } from './merge';

describe('mergeText', () => {
	it('merges edits to different lines', () => {
		const base = '* TODO a\n* TODO b\n* TODO c\n';
		const ours = '* DONE a\n* TODO b\n* TODO c\n';
		const theirs = '* TODO a\n* TODO b\n* NEXT c\n';
		expect(mergeText(base, ours, theirs)).toMatchObject({
			clean: true,
			text: '* DONE a\n* TODO b\n* NEXT c\n',
		});
	});

	it('keeps CRLF and a missing final newline intact', () => {
		const base = 'a\r\nb\r\nc';
		expect(mergeText(base, 'A\r\nb\r\nc', 'a\r\nb\r\nC').text).toBe('A\r\nb\r\nC');
	});

	it('reports conflicts on the same line', () => {
		const r = mergeText('x\n', 'ours\n', 'theirs\n');
		expect(r.clean).toBe(false);
		expect(r.hunks).toEqual([{ conflict: { ours: 'ours\n', base: 'x\n', theirs: 'theirs\n' } }]);
	});

	it('treats identical changes as clean', () => {
		expect(mergeText('a\n', 'b\n', 'b\n')).toMatchObject({ clean: true, text: 'b\n' });
	});
});

describe('adjacent edits', () => {
	it('merges different adjacent lines that git would flag', () => {
		const base = '* TODO a\n* TODO b\n';
		expect(mergeText(base, '* DONE a\n* TODO b\n', '* TODO a\n* DONE b\n')).toMatchObject({
			clean: true,
			text: '* DONE a\n* DONE b\n',
		});
	});

	it('still conflicts when insertions meet', () => {
		expect(mergeText('a\nb\n', 'a\nours\nb\n', 'a\ntheirs\nb\n').clean).toBe(false);
	});
});
