import { describe, expect, it } from 'vitest';
import { buildGraph } from './graph';
import { Vault } from './vault';

const node = (id: string, title: string, body = '') =>
	`:PROPERTIES:\n:ID: ${id}\n:END:\n#+title: ${title}\n${body}`;

const vault = Vault.fromSources({
	'a.org': node(
		'a',
		'A',
		'See [[id:b][B]] and [[id:b][again]].\n* Part\n:PROPERTIES:\n:ID: a1\n:END:\nTo [[id:c][C]].\n',
	),
	'b.org': node('b', 'B', 'Back to [[id:a][A]].\n'),
	'c.org': node('c', 'C', 'To [[id:d][D]].\n'),
	'd.org': node('d', 'D'),
	'e.org': node('e', 'E'),
	'daily/2026-10-20.org': node('t', '2026-10-20', '[[id:a][A]]\n'),
});
const isDaily = (p: string) => p.startsWith('daily/');

describe('buildGraph', () => {
	it('collapses headings into their note and weights repeated links', () => {
		const g = buildGraph(vault, { isDaily });
		expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e', 't']);
		const ab = g.links.find((l) => l.source === 'a' && l.target === 'b');
		expect(ab?.weight).toBe(3);
		expect(g.links.some((l) => l.source === 'a' && l.target === 'c')).toBe(true);
		expect(g.nodes.find((n) => n.id === 'a')?.degree).toBe(3);
	});

	it('keeps headings separate on request', () => {
		const g = buildGraph(vault, { collapseHeadings: false });
		expect(g.links.some((l) => l.source === 'a1' && l.target === 'c')).toBe(true);
	});

	it('filters dailies and orphans', () => {
		const g = buildGraph(vault, { isDaily, includeDailies: false, includeOrphans: false });
		expect(g.nodes.map((n) => n.id).sort()).toEqual(['a', 'b', 'c', 'd']);
	});

	it('limits to a neighbourhood with distances', () => {
		const g = buildGraph(vault, { isDaily, focus: 'b', depth: 2 });
		const dist = Object.fromEntries(g.nodes.map((n) => [n.id, n.distance]));
		expect(dist).toEqual({ a: 1, b: 0, c: 2, t: 2 });
		expect(g.focus).toBe('b');
	});

	it('maps a heading focus to its note', () => {
		expect(buildGraph(vault, { focus: 'a1', depth: 1 }).focus).toBe('a');
	});
});
