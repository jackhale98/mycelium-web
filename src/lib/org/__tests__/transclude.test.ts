import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseTransclude, transcludedText } from '../transclude';

const fixture = (name: string) =>
	readFileSync(
		new URL(`../../../../tests/fixtures/org-upstream/transclusion/${name}`, import.meta.url),
		'utf8',
	);
const paragraph = fixture('paragraph.org');
const opts = (value: string) => parseTransclude(value)!;

describe('#+transclude: options', () => {
	it('reads the link and properties as org-transclusion does', () => {
		expect(parseTransclude('[[id:2022-10-10T173507::*H2]]  :lines 1-5')).toMatchObject({
			link: 'id:2022-10-10T173507::*H2',
			lines: { from: 1, to: 5 },
			level: null,
		});
		expect(opts('[[file:paragraph.org::Sub heading][This is a description]]').link).toBe(
			'file:paragraph.org::Sub heading',
		);
		expect(opts('[[file:a.org]] :level 2 :only-contents').level).toBe(2);
		expect(opts('[[file:a.org]] :level').level).toBe('auto');
		expect(opts('[[file:a.org]] :exclude-elements "drawer keyword"').exclude).toEqual([
			'property-drawer',
			'drawer',
			'keyword',
		]);
		expect(opts('[[x.py]] :src python :lines 3-').lines).toEqual({ from: 3, to: null });
		expect(parseTransclude('no link here')).toBeNull();
	});
});

describe('transcluded content (paragraph.org from org-transclusion)', () => {
	it('a whole file drops property drawers but keeps the first section', () => {
		const out = transcludedText(paragraph, { kind: 'file' }, opts('[[file:paragraph.org]]'))!;
		expect(out.startsWith('#+title: Org file with multiple headlines and paragraphs\n')).toBe(true);
		expect(out).not.toContain(':PROPERTIES:');
		expect(out).toContain('* Other headline\nSuspendisse');
	});

	it('a heading search gives its subtree; a missing one gives nothing', () => {
		const sub = transcludedText(
			paragraph,
			{ kind: 'search', search: 'Sub heading' },
			opts('[[x]]'),
		)!;
		expect(sub).toBe(
			'** Sub heading\nSed rutrum commodo magna. Nulla vulputate tortor euismod lacus volutpat, ac..\n\n',
		);
		expect(
			transcludedText(paragraph, { kind: 'search', search: 'non-exisitent' }, opts('[[x]]')),
		).toBeNull();
		const other = transcludedText(
			paragraph,
			{ kind: 'search', search: '* Other headline' },
			opts('[[x]] :lines 1-5'),
		)!;
		expect(other.split('\n')[0]).toBe('* Other headline');
	});

	it('a dedicated target gives its paragraph; #+NAME gives the element', () => {
		const p = transcludedText(paragraph, { kind: 'search', search: 'para1' }, opts('[[x]]'))!;
		expect(p.startsWith('This also should work.')).toBe(true);
		expect(p.trimEnd().endsWith('This is being added also this is fine.')).toBe(true);
		const t = transcludedText(paragraph, { kind: 'search', search: 'table' }, opts('[[x]]'))!;
		expect(t.startsWith('#+name: table\n|')).toBe(true);
	});

	it(':only-contents, :no-first-heading and :level', () => {
		const sub = { kind: 'search' as const, search: '*Other headline' };
		expect(transcludedText(paragraph, sub, opts('[[x]] :only-contents'))!).not.toMatch(/^\*/m);
		const nf = transcludedText(paragraph, sub, opts('[[x]] :no-first-heading'))!;
		expect(nf.startsWith('Suspendisse')).toBe(true);
		expect(nf).toContain('** Sub heading');
		const lv = transcludedText(paragraph, sub, opts('[[x]] :level 3'))!;
		expect(lv).toMatch(/^\*\*\* Other headline/);
		expect(lv).toContain('\n**** Sub heading');
		const auto = transcludedText(paragraph, sub, opts('[[x]] :level'), {
			org: true,
			hostLevel: 2,
		})!;
		expect(auto).toMatch(/^\*\*\* Other headline/);
	});

	it('other text files: :lines is inclusive, :src wraps a block', () => {
		const py = 'a = 1\nb = 2\nc = 3\nd = 4\n';
		expect(transcludedText(py, { kind: 'file' }, opts('[[x.py]] :lines 2-3'), { org: false })).toBe(
			'b = 2\nc = 3\n',
		);
		expect(
			transcludedText(py, { kind: 'file' }, opts('[[x.py]] :src python :lines -1'), { org: false }),
		).toBe('#+begin_src python\na = 1\n#+end_src\n');
	});
});
