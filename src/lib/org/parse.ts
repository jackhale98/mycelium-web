/// Parsing with uniorg. The tree is read-only: it feeds rendering and the
/// index, and every node carries exact source offsets. Writes never go through
/// it — see `text.ts`.

import type { OrgData, OrgNode } from 'uniorg';
import { unified } from 'unified';
import uniorgParse from 'uniorg-parse';
import { fileTodoKeywords } from './keywords';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

export type { OrgData, OrgNode } from 'uniorg';

/** Keywords in effect for a file: its own `#+TODO:` lines, else the global set. */
export function effectiveKeywords(source: string, fallback: KeywordConfig = DEFAULT_KEYWORD_CONFIG): KeywordConfig {
	return fileTodoKeywords(source) ?? fallback;
}

/**
 * Parse a document. uniorg only understands `\n` terminators, so CRLF input is
 * parsed with LF endings and every offset is mapped back onto the original
 * text; positions always index the source exactly as stored.
 */
export function parseOrg(source: string, keywords: KeywordConfig = DEFAULT_KEYWORD_CONFIG): OrgData {
	const processor = unified().use(uniorgParse, {
		trackPosition: true,
		todoKeywords: [...keywords.todoKeywords, ...keywords.doneKeywords],
	});
	if (!source.includes('\r\n')) return processor.parse(source) as OrgData;

	// Offsets (in the LF text) of every `\n` that was a `\r\n`.
	const crlf: number[] = [];
	let removed = 0;
	for (let i = source.indexOf('\r\n'); i !== -1; i = source.indexOf('\r\n', i + 2)) {
		crlf.push(i - removed);
		removed += 1;
	}
	const toOriginal = (offset: number) => {
		let lo = 0;
		let hi = crlf.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (crlf[mid]! < offset) lo = mid + 1;
			else hi = mid;
		}
		return offset + lo;
	};
	const tree = processor.parse(source.replace(/\r\n/g, '\n')) as OrgData;
	const remap = (node: OrgNode) => {
		if (node.position) {
			node.position.start.offset = toOriginal(node.position.start.offset ?? 0);
			node.position.end.offset = toOriginal(node.position.end.offset ?? 0);
		}
		const n = node as { contentsBegin?: number; contentsEnd?: number };
		if (typeof n.contentsBegin === 'number') n.contentsBegin = toOriginal(n.contentsBegin);
		if (typeof n.contentsEnd === 'number') n.contentsEnd = toOriginal(n.contentsEnd);
		for (const key of ['scheduled', 'deadline', 'closed', 'value'] as const) {
			const child = (node as unknown as Record<string, unknown>)[key];
			if (child && typeof child === 'object' && 'type' in child) remap(child as OrgNode);
		}
		if ('children' in node && Array.isArray(node.children)) for (const c of node.children as OrgNode[]) remap(c);
	};
	remap(tree);
	return tree;
}

export function startOf(node: OrgNode): number {
	return node.position?.start.offset ?? 0;
}

export function endOf(node: OrgNode): number {
	return node.position?.end.offset ?? 0;
}

/** Readable text of an inline tree: markup stripped, links shown by description. */
export function plainText(node: OrgNode | readonly OrgNode[]): string {
	if (Array.isArray(node)) return (node as OrgNode[]).map(plainText).join('');
	const n = node as OrgNode;
	switch (n.type) {
		case 'text':
			return n.value;
		case 'code':
		case 'verbatim':
			return n.value;
		case 'entity':
			return n.utf8;
		case 'line-break':
			return '\n';
		case 'link':
			return n.children.length > 0 ? plainText(n.children) : n.path;
		case 'timestamp':
			return n.rawValue;
		case 'latex-fragment':
			return n.value;
		case 'statistics-cookie':
		case 'footnote-reference':
			return '';
		default:
			return 'children' in n && Array.isArray(n.children) ? plainText(n.children as OrgNode[]) : '';
	}
}
