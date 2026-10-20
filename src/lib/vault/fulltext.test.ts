import { describe, expect, it } from 'vitest';
import { fullTextSearch, searchTerms } from './fulltext';
import { Vault } from './vault';

const vault = Vault.fromSources({
	'a.org':
		':PROPERTIES:\n:ID: a\n:END:\n#+title: Fungi\n\nHyphae branch and fuse.\n* Spores\n:PROPERTIES:\n:ID: a2\n:END:\nSpores travel on wind and water.\n',
	'b.org': '#+title: Weather\n\nWind moves water vapour.\n',
	'c.org': ':PROPERTIES:\n:ID: c\n:END:\n#+title: Wind\nNothing else.\n',
});

describe('fullTextSearch', () => {
	it('requires every term and returns line snippets with marks', () => {
		const hits = fullTextSearch(vault, 'wind water');
		expect(hits.map((h) => h.path).sort()).toEqual(['a.org', 'b.org']);
		const a = hits.find((h) => h.path === 'a.org')!;
		expect(a.snippets).toHaveLength(1);
		const s = a.snippets[0]!;
		expect(s.text).toBe('Spores travel on wind and water.');
		expect(s.marks.map(([x, y]) => s.text.slice(x, y))).toEqual(['wind', 'water']);
		expect(s.nodeId).toBe('a2');
	});

	it('ties snippets before any heading to the file node', () => {
		const [hit] = fullTextSearch(vault, 'hyphae');
		expect(hit?.snippets[0]?.nodeId).toBe('a');
	});

	it('boosts title matches', () => {
		expect(fullTextSearch(vault, 'wind')[0]?.path).toBe('c.org');
	});

	it('supports quoted phrases', () => {
		expect(searchTerms('"wind and" water')).toEqual(['wind and', 'water']);
		expect(fullTextSearch(vault, '"wind and"').map((h) => h.path)).toEqual(['a.org']);
	});

	it('trims long lines around the first match', () => {
		const long = Vault.fromSources({
			'x.org': `${'lorem '.repeat(60)}needle ${'ipsum '.repeat(40)}\n`,
		});
		const s = fullTextSearch(long, 'needle')[0]!.snippets[0]!;
		expect(s.text.startsWith('…')).toBe(true);
		expect(s.text.endsWith('…')).toBe(true);
		expect(s.text.slice(...s.marks[0]!)).toBe('needle');
	});
});
