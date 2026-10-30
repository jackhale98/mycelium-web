import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { unlinkedReferences } from './unlinked';

const roam = (name: string) =>
	readFileSync(
		new URL(`../../../tests/fixtures/org-upstream/roam/${name}`, import.meta.url),
		'utf8',
	);

describe('unlinked references', () => {
	const node = { file: 'notes/fungi.org', title: 'Mycelial network', aliases: ['wood wide web'] };

	it('finds whole-word, case-insensitive mentions of the title and aliases elsewhere', () => {
		const refs = unlinkedReferences(node, [
			{
				path: 'a.org',
				source: '* Notes\nThe mycelial network links trees.\nAlso the Wood Wide Web!\n',
			},
			{ path: 'b.org', source: 'mycelial networks are plural, not a match\n' },
			{ path: 'notes/fungi.org', source: 'Mycelial network in its own file\n' },
		]);
		expect(refs.map((r) => [r.file, r.text, r.line, r.column])).toEqual([
			['a.org', 'mycelial network', 2, 5],
			['a.org', 'Wood Wide Web', 3, 10],
		]);
		expect(refs[0]!.context).toBe('The mycelial network links trees.');
	});

	it('never counts text inside square brackets: links, timestamps, checkboxes', () => {
		const src =
			'[[id:x][Mycelial network]] and [[file:f.org][see the Mycelial network]] [Mycelial network]\n- [ ] Mycelial network\n';
		const refs = unlinkedReferences(node, [{ path: 'a.org', source: src }]);
		expect(refs).toHaveLength(1);
		expect(refs[0]!.line).toBe(2);
	});

	it("matches org-roam's fixture: bar.org links Foo, so it is not unlinked", () => {
		const foo = roam('foo.org');
		const bar = roam('bar.org');
		const refs = unlinkedReferences({ file: 'foo.org', title: 'Foo', aliases: [] }, [
			{ path: 'foo.org', source: foo },
			{ path: 'bar.org', source: bar },
		]);
		expect(refs).toEqual([]);
	});

	it("a daily note isn't mentioned by the day's SCHEDULED and DEADLINE stamps", () => {
		const day = { file: 'daily/2026-10-30.org', title: '2026-10-30', aliases: [] };
		const src = [
			'* TODO Pay rent',
			'DEADLINE: <2026-10-30 Fri>',
			'* TODO Call Sam',
			'SCHEDULED: <2026-10-30 Fri 15:00>',
			'Met on <2026-10-30 Fri> as agreed.',
			'* Plans for 2026-10-30',
			'Due 2026-10-30, in words.',
			'',
		].join('\n');
		const refs = unlinkedReferences(day, [{ path: 'tasks.org', source: src }]);
		// The heading and the plain words count; stamps never do.
		expect(refs.map((r) => r.line)).toEqual([6, 7]);
	});
});
