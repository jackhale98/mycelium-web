/// Exact full-text search over every file's source: all words must appear in
/// a file; matching lines come back as snippets, each tied to the node that
/// contains it. Scanning the raw text on demand keeps memory flat and finds
/// what is actually written (drawers, blocks and all).

import type { Vault, VaultFile } from './vault';

export interface TextSnippet {
	line: number;
	/** Offset of the line in the file. */
	pos: number;
	text: string;
	/** Ranges in `text` to highlight. */
	marks: [number, number][];
	/** Innermost node containing the line. */
	nodeId: string | null;
}

export interface FileHit {
	path: string;
	title: string;
	nodeId: string | null;
	score: number;
	snippets: TextSnippet[];
	/** Matching lines beyond those returned. */
	more: number;
}

const lowered = new WeakMap<VaultFile, string>();
const lower = (file: VaultFile) => {
	let text = lowered.get(file);
	if (text === undefined) lowered.set(file, (text = file.source.toLowerCase()));
	return text;
};

export function searchTerms(query: string): string[] {
	const terms: string[] = [];
	for (const m of query.toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) {
		const term = (m[1] ?? m[2] ?? '').trim();
		if (term && !terms.includes(term)) terms.push(term);
	}
	return terms;
}

const SNIPPET = 160;

function snippet(line: string, terms: string[]): { text: string; marks: [number, number][] } {
	const low = line.toLowerCase();
	const first = Math.min(...terms.map((t) => low.indexOf(t)).filter((i) => i >= 0));
	let start = 0;
	if (line.length > SNIPPET && first > SNIPPET / 3) start = first - Math.floor(SNIPPET / 3);
	const end = Math.min(line.length, start + SNIPPET);
	const prefix = start > 0 ? '…' : '';
	const text = prefix + line.slice(start, end).trim() + (end < line.length ? '…' : '');
	const lead = line.slice(start, end).length - line.slice(start, end).trimStart().length;
	const shift = prefix.length - start - lead;
	const marks: [number, number][] = [];
	for (const t of terms) {
		let i = low.indexOf(t, start);
		while (i >= 0 && i + t.length <= end) {
			marks.push([i + shift, i + t.length + shift]);
			i = low.indexOf(t, i + t.length);
		}
	}
	marks.sort((a, b) => a[0] - b[0]);
	return { text, marks };
}

/** Owning node for an offset: the innermost headline node above it, else the file node. */
function ownerAt(vault: Vault, file: VaultFile, pos: number): string | null {
	let owner: string | null = null;
	for (const h of file.index.headlines) {
		if (h.pos > pos) break;
		owner = h.ownerId;
	}
	return owner ?? vault.fileNode(file.path)?.id ?? null;
}

export function fullTextSearch(
	vault: Vault,
	query: string,
	options: { limit?: number; snippets?: number } = {},
): FileHit[] {
	const terms = searchTerms(query);
	if (!terms.length) return [];
	const limit = options.limit ?? 50;
	const perFile = options.snippets ?? 3;
	const hits: FileHit[] = [];
	for (const file of vault.files.values()) {
		const text = lower(file);
		if (!terms.every((t) => text.includes(t))) continue;
		const snippets: TextSnippet[] = [];
		let matches = 0;
		let count = 0;
		let pos = 0;
		const lines = file.source.split('\n');
		for (let n = 0; n < lines.length; n++) {
			const line = lines[n]!;
			const low = text.slice(pos, pos + line.length);
			const found = terms.filter((t) => low.includes(t));
			if (found.length) {
				matches += 1;
				count += found.length;
				if (snippets.length < perFile)
					snippets.push({
						line: n + 1,
						pos,
						...snippet(line.replace(/\r$/, ''), found),
						nodeId: ownerAt(vault, file, pos),
					});
			}
			pos += line.length + 1;
		}
		const title = file.index.title || file.path;
		const titleBonus = terms.filter((t) => title.toLowerCase().includes(t)).length * 5;
		hits.push({
			path: file.path,
			title,
			nodeId: vault.fileNode(file.path)?.id ?? null,
			score: count + titleBonus + Math.min(matches, 10) * 0.1,
			snippets,
			more: matches - snippets.length,
		});
	}
	return hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
