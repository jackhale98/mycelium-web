import { describe, expect, it } from 'vitest';
import { buildSearch } from './search';
import { Vault } from './vault';

const vault = Vault.fromSources({
	'a.org':
		':PROPERTIES:\n:ID: a\n:ROAM_ALIASES: Alpha\n:END:\n#+title: A note\nLinks to [[id:b][B]] and [[roam:Gamma]].\n',
	'b.org':
		':PROPERTIES:\n:ID: b\n:END:\n#+title: B note\n#+filetags: :x:\n* TODO Task\nDEADLINE: <2026-01-01 Thu>\n* Child\n:PROPERTIES:\n:ID: b1\n:END:\nBack to [[id:a][A]].\n',
	'c.org': ':PROPERTIES:\n:ID: c\n:END:\n#+title: Gamma\n',
});

describe('Vault', () => {
	it('builds backlinks grouped by source', () => {
		expect(vault.backlinksOf('b').map((g) => g.from.id)).toEqual(['a']);
		expect(vault.backlinksOf('a').map((g) => g.from.id)).toEqual(['b1']);
		// org-roam counts only id: links as backlinks; roam: links still navigate.
		expect(vault.backlinksOf('c')).toEqual([]);
		expect(vault.resolve({ type: 'roam', dest: 'Gamma' })).toBe('c');
	});

	it('finds reference backlinks to ROAM_REFS, like org-roam', () => {
		const v = Vault.fromSources({
			'paper.org':
				':PROPERTIES:\n:ID: p\n:ROAM_REFS: @smith2020 https://example.com/post\n:END:\n#+title: Paper\n',
			'notes.org':
				':PROPERTIES:\n:ID: n\n:END:\n#+title: Notes\nSee [cite:@smith2020] and [[https://example.com/post][the post]].\n',
			'self.org': ':PROPERTIES:\n:ID: s\n:END:\n#+title: Self\n[[id:s][me]]\n',
		});
		const groups = v.reflinksOf('p');
		expect(groups.map((g) => g.from.id)).toEqual(['n']);
		expect(groups[0]!.links.map((l) => l.type).sort()).toEqual(['cite', 'https']);
		expect(v.backlinksOf('s').map((g) => g.from.id)).toEqual(['s']);
	});

	it('resolves forward links and tags', () => {
		expect(vault.forwardLinks('a').map((l) => l.node.id)).toEqual(['b', 'c']);
		expect([...(vault.tags.get('x') ?? [])]).toEqual(['b', 'b1']);
	});

	it('collects agenda items with their owning node', () => {
		const [item] = vault.agenda();
		expect(item).toMatchObject({ title: 'Task', todo: 'TODO', file: 'b.org' });
		expect(item!.node?.id).toBe('b');
	});

	it('searches titles, aliases and prefixes', () => {
		const search = buildSearch(vault);
		expect(search.search('alph')[0]?.id).toBe('a');
		expect(search.search('gamm')[0]?.id).toBe('c');
	});
});
