import { describe, expect, it } from 'vitest';
import { findMentions, mentionMatcher, type MentionTarget } from './mentions';
import { unlinkedReferences } from './unlinked';

const note = (id: string, title: string, aliases: string[] = [], file = `${id}.org`) =>
	({ id, file, title, aliases, level: 0 }) satisfies MentionTarget;

const targets = [
	note('forest', 'Forest'),
	note('ecology', 'Forest ecology'),
	note('net', 'Mycelial network', ['wood wide web']),
	note('simard', 'Suzanne Simard'),
	note('ai', 'AI'),
	note('self', 'Field notes', [], 'here.org'),
];
const matcher = mentionMatcher(targets);
const find = (source: string, extra: Partial<Parameters<typeof findMentions>[2]> = {}) =>
	findMentions(source, matcher, { path: 'here.org', ...extra }).map((m) => [m.text, m.id]);

describe('link suggestions', () => {
	it('finds whole-word titles and aliases, longest first, any case', () => {
		expect(
			find('Notes on forest ecology and the Wood Wide Web, after Suzanne Simard.\nA forester.'),
		).toEqual([
			['forest ecology', 'ecology'],
			['Wood Wide Web', 'net'],
			['Suzanne Simard', 'simard'],
		]);
	});

	it('matches a trailing s, and titles split over spaces or tabs', () => {
		expect(find('Mycelial networks link trees. Suzanne\tSimard says so.')).toEqual([
			['Mycelial networks', 'net'],
			['Suzanne\tSimard', 'simard'],
		]);
	});

	it('skips short titles, its own notes, linked and ignored notes', () => {
		expect(find('AI and field notes, in a forest.')).toEqual([['forest', 'forest']]);
		expect(find('A forest.', { linked: new Set(['forest']) })).toEqual([]);
		expect(find('A forest.', { ignore: new Set(['forest']) })).toEqual([]);
	});

	it('suggests the first mention of each note, or every one', () => {
		expect(find('forest, forest')).toEqual([['forest', 'forest']]);
		expect(find('forest, forest', { every: true })).toHaveLength(2);
	});

	it("leaves alone what isn't prose", () => {
		const source = [
			'#+title: Forest walk',
			'* Forest',
			':PROPERTIES:',
			':ID: x',
			':ROAM_ALIASES: Forest',
			':END:',
			'SCHEDULED: <2026-11-02 Mon Forest>',
			'# a comment about the forest',
			': forest, fixed-width',
			'#+begin_src elisp',
			'(forest)',
			'#+end_src',
			'- [X] [[id:forest][the forest]] =forest= ~forest~ https://forest.example/forest',
			'#+begin_quote',
			'In the forest.',
			'#+end_quote',
			'',
		].join('\n');
		const found = findMentions(source, matcher, { path: 'here.org', every: true });
		expect(found.map((m) => source.slice(m.from - 7, m.to))).toEqual(['In the forest']);
	});

	it('looks only in a range (a heading note)', () => {
		const source = 'A forest.\n* Part\nSuzanne Simard.\n';
		const at = source.indexOf('* Part');
		expect(find(source, { range: [at, source.length] })).toEqual([['Suzanne Simard', 'simard']]);
	});

	it("is a subset of org-roam's unlinked references", () => {
		const source =
			'The forest ecology of [[id:x][old forests]] and mycelial networks.\nSee Suzanne Simard, the forest and the Forest.\n';
		const mine = findMentions(source, matcher, { path: 'here.org', every: true });
		// org-roam doesn't match plurals; every other mention is one it finds too.
		const exact = mine.filter((m) => m.text.toLowerCase() !== 'mycelial networks');
		expect(exact.length).toBe(mine.length - 1);
		for (const m of exact) {
			const t = targets.find((x) => x.id === m.id)!;
			const refs = unlinkedReferences(t, [{ path: 'here.org', source }]);
			expect(refs.some((r) => r.offset === m.from)).toBe(true);
		}
	});
});
