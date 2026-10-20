import { describe, expect, it } from 'vitest';
import {
	formatHeadline,
	nextTodoKeyword,
	scanHeadline,
	setHeadlineTags,
	setHeadlineTitle,
	setPriority,
	setTodoKeyword,
	toggleHeadlineTag,
} from '../headline';
import { splitLines } from '../text';
import { apply } from './helpers';

const kw = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };
const scan = (text: string) => scanHeadline(splitLines(text)[0]!, kw);

describe('scanHeadline', () => {
	it('locates every component', () => {
		const src = '** TODO [#A] Write the parser  :work:urgent:';
		const h = scan(src)!;
		expect(h.level).toBe(2);
		expect(h.keyword?.value).toBe('TODO');
		expect(h.priority?.value).toBe('A');
		expect(h.title.value).toBe('Write the parser');
		expect(h.tags?.values).toEqual(['work', 'urgent']);
		expect(src.slice(h.tags!.from, h.tags!.to)).toBe(':work:urgent:');
	});

	it('does not treat a keyword prefix as a keyword', () => {
		expect(scan('* TODOS are fun')!.keyword).toBeNull();
		expect(scan('* NEXT')!.keyword?.value).toBe('NEXT');
	});

	it('rejects non-headlines', () => {
		expect(scan('  * indented bullet')).toBeNull();
		expect(scan('**bold**')).toBeNull();
	});

	it('treats a tags-only headline as having an empty title', () => {
		const h = scan('* :inbox:')!;
		expect(h.title.value).toBe('');
		expect(h.tags?.values).toEqual(['inbox']);
	});

	it('recognises COMMENT headlines', () => {
		expect(scan('* TODO COMMENT Draft')!.commented).toBe(true);
	});
});

describe('setTodoKeyword', () => {
	it('replaces only the keyword', () => {
		const src = '* TODO   spaced    title   :tag:\nbody\n';
		expect(apply(src, setTodoKeyword(src, 0, 'DONE', kw))).toBe('* DONE   spaced    title   :tag:\nbody\n');
	});

	it('inserts a keyword', () => {
		const src = '** Task :x:\n';
		expect(apply(src, setTodoKeyword(src, 0, 'TODO', kw))).toBe('** TODO Task :x:\n');
	});

	it('removes a keyword and its separator', () => {
		const src = '* TODO [#B] Task\n';
		expect(apply(src, setTodoKeyword(src, 0, null, kw))).toBe('* [#B] Task\n');
	});

	it('handles empty headlines', () => {
		expect(apply('* \n', setTodoKeyword('* \n', 0, 'TODO', kw))).toBe('* TODO\n');
		expect(apply('* TODO\n', setTodoKeyword('* TODO\n', 0, null, kw))).toBe('* \n');
	});

	it('preserves CRLF', () => {
		const src = '* TODO Task\r\nbody\r\n';
		expect(apply(src, setTodoKeyword(src, 0, 'DONE', kw))).toBe('* DONE Task\r\nbody\r\n');
	});

	it('round-trips insert then remove', () => {
		const src = '*** Some title :a:';
		const added = apply(src, setTodoKeyword(src, 0, 'NEXT', kw));
		expect(apply(added, setTodoKeyword(added, 0, null, kw))).toBe(src);
	});

	it('leaves non-headlines alone', () => {
		expect(setTodoKeyword('plain text', 0, 'TODO', kw)).toEqual([]);
	});
});

describe('setPriority', () => {
	it('inserts after the keyword', () => {
		const src = '* TODO Task';
		expect(apply(src, setPriority(src, 0, 'A', kw))).toBe('* TODO [#A] Task');
	});

	it('inserts without a keyword', () => {
		expect(apply('* Task', setPriority('* Task', 0, 'C', kw))).toBe('* [#C] Task');
	});

	it('replaces and removes', () => {
		const src = '* TODO [#A] Task';
		expect(apply(src, setPriority(src, 0, 'B', kw))).toBe('* TODO [#B] Task');
		expect(apply(src, setPriority(src, 0, null, kw))).toBe('* TODO Task');
	});

	it('round-trips', () => {
		const src = '* NEXT  Task with  odd   spacing';
		const added = apply(src, setPriority(src, 0, 'A', kw));
		expect(apply(added, setPriority(added, 0, null, kw))).toBe(src);
	});
});

describe('setHeadlineTags', () => {
	it('adds a tag block', () => {
		expect(apply('* Task', setHeadlineTags('* Task', 0, ['a', 'b'], kw))).toBe('* Task :a:b:');
	});

	it('keeps right-aligned tags ending in the same column', () => {
		const src = '* Task                                                          :work:';
		const out = apply(src, setHeadlineTags(src, 0, ['work', 'home'], kw));
		expect(out.length).toBe(src.length);
		expect(out.endsWith(' :work:home:')).toBe(true);
	});

	it('removes the block', () => {
		expect(apply('* Task :a:', setHeadlineTags('* Task :a:', 0, [], kw))).toBe('* Task');
	});

	it('toggles a single tag', () => {
		const src = '* Task :a:b:';
		expect(apply(src, toggleHeadlineTag(src, 0, 'a', kw))).toBe('* Task :b:');
		expect(apply(src, toggleHeadlineTag(src, 0, 'c', kw))).toBe('* Task :a:b:c:');
	});
});

describe('setHeadlineTitle', () => {
	it('replaces only the title', () => {
		const src = '* TODO [#A] Old title    :t:';
		expect(apply(src, setHeadlineTitle(src, 0, 'New', kw))).toBe('* TODO [#A] New    :t:');
	});
});

describe('helpers', () => {
	it('cycles keywords through none', () => {
		expect(nextTodoKeyword(null, kw)).toBe('TODO');
		expect(nextTodoKeyword('TODO', kw)).toBe('NEXT');
		expect(nextTodoKeyword('DONE', kw)).toBeNull();
		expect(nextTodoKeyword(null, kw, -1)).toBe('DONE');
	});

	it('formats new headlines', () => {
		expect(formatHeadline({ level: 2, title: 'Hi', keyword: 'TODO', priority: 'A', tags: ['x'] })).toBe('** TODO [#A] Hi :x:');
	});
});
