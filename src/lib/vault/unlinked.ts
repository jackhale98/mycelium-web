/// Unlinked references, as org-roam's `org-roam-unlinked-references-section`
/// finds them: mentions of a node's title or aliases in other files,
/// case-insensitive, as whole words (`\b…\b`), never inside square brackets
/// (rg's pattern consumes any balanced `[…]` first, so links, timestamps and
/// checkboxes don't count), and never in the node's own file.

import type { RoamNode } from '$lib/org';

export interface UnlinkedRef {
	file: string;
	/** Offset of the mention in the file. */
	offset: number;
	/** The mention as written. */
	text: string;
	/** 1-based line and column, as org-roam shows them. */
	line: number;
	column: number;
	/** The whole source line. */
	context: string;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Ranges of balanced `[…]` groups (rg's `\[([^[]]++|(?R))*\]`). */
function bracketRanges(source: string): [number, number][] {
	const out: [number, number][] = [];
	const stack: number[] = [];
	for (let i = 0; i < source.length; i += 1) {
		const c = source[i];
		if (c === '[') stack.push(i);
		else if (c === ']' && stack.length) {
			const start = stack.pop()!;
			if (!stack.length) out.push([start, i + 1]);
		} else if (c === '\n' && stack.length) stack.length = 0;
	}
	return out;
}

export function unlinkedReferences(
	node: Pick<RoamNode, 'file' | 'title' | 'aliases'>,
	files: Iterable<{ path: string; source: string }>,
	limit = 200,
): UnlinkedRef[] {
	const terms = [node.title, ...node.aliases].map((t) => t.trim()).filter(Boolean);
	if (!terms.length) return [];
	const lower = new Set(terms.map((t) => t.toLowerCase()));
	const re = new RegExp(
		`(?<![\\p{L}\\p{N}_])(?:${terms
			.sort((a, b) => b.length - a.length)
			.map(escape)
			.join('|')})(?![\\p{L}\\p{N}_])`,
		'giu',
	);
	const out: UnlinkedRef[] = [];
	for (const file of files) {
		if (file.path === node.file) continue;
		const quick = file.source.toLowerCase();
		if (![...lower].some((t) => quick.includes(t))) continue;
		const brackets = bracketRanges(file.source);
		let b = 0;
		for (const m of file.source.matchAll(re)) {
			const at = m.index;
			while (b < brackets.length && brackets[b]![1] <= at) b += 1;
			if (b < brackets.length && brackets[b]![0] <= at) continue;
			if (!lower.has(m[0].toLowerCase())) continue;
			const lineStart = file.source.lastIndexOf('\n', at - 1) + 1;
			const lineEnd = file.source.indexOf('\n', at);
			out.push({
				file: file.path,
				offset: at,
				text: m[0],
				line: file.source.slice(0, at).split('\n').length,
				column: at - lineStart + 1,
				context: file.source.slice(lineStart, lineEnd === -1 ? undefined : lineEnd),
			});
			if (out.length >= limit) return out;
		}
	}
	return out;
}
