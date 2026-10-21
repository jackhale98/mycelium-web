import { describe, expect, it } from 'vitest';
import { applyChanges } from '../text';
import { percentCookie, updateTodoCookies } from '../statistics';

const update = (src: string, at = 0) => applyChanges(src, updateTodoCookies(src, at));

describe('TODO statistics cookies', () => {
	it('formats percentages as org-format-percent-cookie does', () => {
		expect(percentCookie(1, 3)).toBe('[33%]');
		expect(percentCookie(1, 200)).toBe('[1%]');
		expect(percentCookie(0, 0)).toBe('[0%]');
	});

	it('counts direct children with a keyword (test-org-archive/update-status-cookie)', () => {
		expect(update('* Top [%]\n** DONE One\n** TODO Two')).toBe(
			'* Top [50%]\n** DONE One\n** TODO Two',
		);
		expect(update('* Top [%]\n** TODO Two')).toBe('* Top [0%]\n** TODO Two');
		expect(update('* Top [%]\n')).toBe('* Top [100%]\n');
		expect(update('* Top [/]\n')).toBe('* Top [0/0]\n');
		expect(update('* Top [/] :tag:\n** DONE a\n** b\n*** DONE deep\n** TODO c\n')).toBe(
			'* Top [1/2] :tag:\n** DONE a\n** b\n*** DONE deep\n** TODO c\n',
		);
	});

	it('counts the whole subtree with COOKIE_DATA: recursive, and leaves checkbox cookies alone', () => {
		const rec =
			'* Top [/]\n:PROPERTIES:\n:COOKIE_DATA: todo recursive\n:END:\n** TODO a\n*** DONE b\n';
		expect(update(rec)).toContain('* Top [1/2]');
		expect(update('* Top [/]\n- [X] one\n- [ ] two\n** DONE a\n')).toBe(
			'* Top [/]\n- [X] one\n- [ ] two\n** DONE a\n',
		);
		expect(
			updateTodoCookies('* Top [/]\n:PROPERTIES:\n:COOKIE_DATA: checkbox\n:END:\n** DONE a\n', 0),
		).toEqual([]);
	});
});
