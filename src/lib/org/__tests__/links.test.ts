import { describe, expect, it } from 'vitest';
import {
	findSearchTarget,
	parseSearchOption,
	radioTargets,
	resolvePath,
	splitSearch,
	splitTargets,
} from '../links';

const doc = `#+title: Links

* TODO [#A] Project plan [1/3] :work:
:PROPERTIES:
:CUSTOM_ID: plan
:END:
Some text with <<a target>> in it.
* COMMENT Hidden heading
* Pipes | in title
#+NAME: results table
| a |
#+begin_src python
x = 1  (ref:assign)
#+end_src
* Lower case
`;
const at = (needle: string) => doc.indexOf(needle);
const lineOf = (needle: string) => doc.lastIndexOf('\n', doc.indexOf(needle)) + 1;

describe('search options', () => {
	it('parses each form', () => {
		expect(parseSearchOption('*A heading')).toEqual({ kind: 'heading', title: 'A heading' });
		expect(parseSearchOption('#cid')).toEqual({ kind: 'custom-id', id: 'cid' });
		expect(parseSearchOption('/re+gex/')).toEqual({ kind: 'regexp', source: 're+gex' });
		expect(parseSearchOption('42')).toEqual({ kind: 'line', line: 42 });
		expect(parseSearchOption('(assign)')).toEqual({ kind: 'coderef', ref: 'assign' });
		expect(parseSearchOption('my target')).toEqual({ kind: 'fuzzy', text: 'my target' });
		expect(splitSearch('notes/x.org::*H')).toEqual({
			file: 'notes/x.org',
			search: { kind: 'heading', title: 'H' },
		});
		expect(splitSearch('x.org')).toEqual({ file: 'x.org', search: null });
	});

	it('finds headings by their words, ignoring keyword, priority, cookies, tags and COMMENT', () => {
		expect(findSearchTarget(doc, parseSearchOption('*Project plan'))).toBe(lineOf('* TODO'));
		expect(findSearchTarget(doc, parseSearchOption('*Project   plan'))).toBe(lineOf('* TODO'));
		expect(findSearchTarget(doc, parseSearchOption('*Hidden heading'))).toBe(lineOf('* COMMENT'));
		expect(findSearchTarget(doc, parseSearchOption('*Pipes in title'))).toBe(lineOf('* Pipes'));
		// Heading matches are case-sensitive in Org (the final comparison is `equal`).
		expect(findSearchTarget(doc, parseSearchOption('*lower case'))).toBeNull();
		expect(findSearchTarget(doc, parseSearchOption('*Nope'))).toBeNull();
	});

	it('finds custom IDs, targets, names, coderefs and lines', () => {
		expect(findSearchTarget(doc, parseSearchOption('#plan'))).toBe(lineOf('* TODO'));
		expect(findSearchTarget(doc, parseSearchOption('A  Target'))).toBe(at('<<a target>>'));
		expect(findSearchTarget(doc, parseSearchOption('Results Table'))).toBe(lineOf('#+NAME'));
		expect(findSearchTarget(doc, parseSearchOption('Lower case'))).toBe(lineOf('* Lower'));
		expect(findSearchTarget(doc, parseSearchOption('(assign)'))).toBe(lineOf('x = 1'));
		expect(findSearchTarget(doc, parseSearchOption('3'))).toBe(lineOf('* TODO'));
		// A starred search never matches a target.
		expect(findSearchTarget(doc, parseSearchOption('*a target'))).toBeNull();
	});
});

describe('paths and targets', () => {
	it('resolves file links relative to the linking file', () => {
		expect(resolvePath('daily/2026-10-21.org', 'other.org')).toBe('daily/other.org');
		expect(resolvePath('daily/2026-10-21.org', '../notes/x.org')).toBe('notes/x.org');
		expect(resolvePath('a.org', './img/p.png')).toBe('img/p.png');
		expect(resolvePath('a.org', '../outside.org')).toBeNull();
		expect(resolvePath('a.org', '/home/me/x.org')).toBeNull();
		expect(resolvePath('a.org', '~/org/x.org')).toBeNull();
	});

	it('splits dedicated and radio targets out of text', () => {
		expect(splitTargets('see <<here>> and <<<Radio>>> now')).toEqual([
			{ kind: 'text', text: 'see ' },
			{ kind: 'target', name: 'here' },
			{ kind: 'text', text: ' and ' },
			{ kind: 'radio', name: 'Radio' },
			{ kind: 'text', text: ' now' },
		]);
		expect(splitTargets('a << b >> c')).toEqual([{ kind: 'text', text: 'a << b >> c' }]);
		expect(radioTargets('x <<<One>>> y <<<Two words>>>')).toEqual(['One', 'Two words']);
	});
});
