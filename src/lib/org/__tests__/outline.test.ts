import { describe, expect, it } from 'vitest';
import { foldSpan, outline, startupVisibility } from '..';

const SRC = [
	'#+title: Plan', // 0
	'* One', // 14
	'Text of one.', // 20
	'** Child A', // 33
	'a', // 44
	'*** Grandchild', // 46
	'** Child B', // 61
	'#+begin_src org', // 72
	'* not a heading', // 88
	'#+end_src', // 104
	'* Two', // 114
	'',
].join('\n');

describe('outline', () => {
	it('finds headings, their subtrees, text and children (not in blocks)', () => {
		const o = outline(SRC);
		expect(o.map((h) => [SRC.slice(h.pos, h.lineEnd), h.level])).toEqual([
			['* One', 1],
			['** Child A', 2],
			['*** Grandchild', 3],
			['** Child B', 2],
			['* Two', 1],
		]);
		const [one, a, grand, b, two] = o;
		expect(SRC.slice(one!.lineEnd, one!.bodyEnd)).toBe('\nText of one.\n');
		expect(one!.end).toBe(two!.pos);
		expect(one!.children).toEqual([1, 3]);
		expect(a!.children).toEqual([2]);
		expect([grand!.parent, b!.parent, two!.parent]).toEqual([1, 0, null]);
		expect(SRC.slice(b!.lineEnd, b!.end)).toContain('* not a heading');
		expect(two!.end).toBe(SRC.length);
	});
	it('folds what follows the heading line, not the newline before the next', () => {
		const [one, , , , two] = outline(SRC);
		const span = foldSpan(SRC, one!.lineEnd, one!.end)!;
		expect(SRC.slice(span.to, span.to + 6)).toBe('\n* Two');
		expect(foldSpan(SRC, two!.lineEnd, two!.end)).toBeNull();
	});
	it('reads #+STARTUP visibility', () => {
		expect(startupVisibility('#+STARTUP: overview indent\n')).toBe('overview');
		expect(startupVisibility('#+startup: content\n')).toBe('contents');
		expect(startupVisibility('#+STARTUP: showall\n')).toBe('all');
		expect(startupVisibility('#+title: x\n')).toBeNull();
	});
});
