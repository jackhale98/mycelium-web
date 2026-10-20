import { describe, expect, it } from 'vitest';
import {
	highlightLine,
	initialHighlightState,
	inlineSpans,
	type HighlightSpan,
} from '../highlight';
import { DEFAULT_KEYWORD_CONFIG } from '../types';

const kw = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };
const pick = (text: string, spans: HighlightSpan[]) =>
	spans.map((s) => [s.kind, text.slice(s.from, s.to)]);

describe('highlightLine', () => {
	it('splits a headline into stars, keyword, priority, title and tags', () => {
		const text = '** TODO [#A] Read [[id:x][the paper]] :reading:work:';
		const line = highlightLine(text, initialHighlightState(), kw);
		expect(line.kind).toBe('headline');
		expect(line.level).toBe(2);
		expect(pick(text, line.spans)).toEqual([
			['stars', '**'],
			['todo', 'TODO'],
			['priority', '[#A]'],
			['link-markup', '[[id:x]['],
			['link', 'the paper'],
			['link-markup', ']]'],
			['tags', ':reading:work:'],
		]);
		expect(line.spans.find((s) => s.kind === 'link')?.data).toBe('id:x');
	});

	it('treats unknown words as title text', () => {
		const text = '* WAITING on it';
		expect(
			pick(text, highlightLine(text, initialHighlightState(), DEFAULT_KEYWORD_CONFIG).spans),
		).toEqual([['stars', '*']]);
	});

	it('tracks blocks and drawers across lines', () => {
		const state = initialHighlightState();
		const lines = [
			':PROPERTIES:',
			':ID:       abc',
			':END:',
			'#+begin_src org',
			'* not a heading',
			'#+end_src',
			'after',
		];
		const kinds = lines.map((l) => highlightLine(l, state, kw).kind);
		expect(kinds).toEqual([
			'drawer',
			'drawer',
			'drawer',
			'block-delim',
			'block',
			'block-delim',
			null,
		]);
	});

	it('marks list bullets and checkboxes', () => {
		const text = '  - [X] done [1/2]';
		expect(pick(text, highlightLine(text, initialHighlightState(), kw).spans)).toEqual([
			['bullet', '-'],
			['checkbox', '[X]'],
			['cookie', '[1/2]'],
		]);
	});

	it('marks planning keywords and timestamps', () => {
		const text = 'DEADLINE: <2026-10-20 Tue +1w> SCHEDULED: <2026-10-18 Sun>';
		expect(pick(text, highlightLine(text, initialHighlightState(), kw).spans)).toEqual([
			['planning', 'DEADLINE:'],
			['timestamp', '<2026-10-20 Tue +1w>'],
			['planning', 'SCHEDULED:'],
			['timestamp', '<2026-10-18 Sun>'],
		]);
	});
});

describe('inlineSpans', () => {
	it('finds emphasis but not inside links', () => {
		const text = 'a *bold* and [[https://x.org/a_b_c]] =code=';
		expect(pick(text, inlineSpans(text)).filter(([k]) => k !== 'markup')).toEqual([
			['bold', 'bold'],
			['link-markup', '[['],
			['link', 'https://x.org/a_b_c'],
			['link-markup', ']]'],
			['code', 'code'],
		]);
	});
});
