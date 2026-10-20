/// Fuzzy, prefix-aware search over nodes: titles, aliases, tags and body text.

import MiniSearch, { type SearchResult } from 'minisearch';
import type { Vault } from './vault';

export interface NodeHit {
	id: string;
	title: string;
	score: number;
	match: SearchResult['match'];
}

export function buildSearch(vault: Vault) {
	const index = new MiniSearch<{
		id: string;
		title: string;
		aliases: string;
		tags: string;
		body: string;
	}>({
		fields: ['title', 'aliases', 'tags', 'body'],
		storeFields: ['title'],
		searchOptions: {
			boost: { title: 4, aliases: 3, tags: 2 },
			prefix: true,
			fuzzy: 0.2,
			combineWith: 'AND',
		},
	});
	index.addAll(
		[...vault.nodes.values()].map((n) => ({
			id: n.id,
			title: n.title,
			aliases: n.aliases.join(' '),
			tags: n.tags.join(' '),
			body: n.level === 0 ? (vault.file(n.file)?.index.text ?? '') : n.olp.join(' '),
		})),
	);
	return {
		search(query: string, limit = 20): NodeHit[] {
			if (!query.trim()) return [];
			return index
				.search(query)
				.slice(0, limit)
				.map((r) => ({
					id: r.id as string,
					title: r['title'] as string,
					score: r.score,
					match: r.match,
				}));
		},
	};
}
