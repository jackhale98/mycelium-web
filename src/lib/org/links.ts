/// Org link targets: search options (`file:x.org::*Heading`), internal links
/// (`[[*Heading]]`, `[[#custom-id]]`, `[[target]]`), dedicated targets
/// (`<<target>>`) and radio targets (`<<<radio>>>`), resolved as `ol.el`'s
/// `org-link-search` does, and file paths relative to the linking file.

import { scanHeadline } from './headline';
import { splitLines } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

export type SearchOption =
	| { kind: 'heading'; title: string }
	| { kind: 'custom-id'; id: string }
	| { kind: 'regexp'; source: string }
	| { kind: 'line'; line: number }
	/** `(ref)`: a code reference in a source or example block. */
	| { kind: 'coderef'; ref: string }
	| { kind: 'fuzzy'; text: string };

/** Parse the part after `::` (or an internal link's path). */
export function parseSearchOption(s: string): SearchOption {
	const v = s.trim();
	if (v.startsWith('*')) return { kind: 'heading', title: v.slice(1) };
	if (v.startsWith('#')) return { kind: 'custom-id', id: v.slice(1) };
	if (/^\/.*\/$/.test(v) && v.length > 2) return { kind: 'regexp', source: v.slice(1, -1) };
	if (/^\d+$/.test(v)) return { kind: 'line', line: Number(v) };
	const coderef = /^\((.*)\)$/.exec(v);
	if (coderef) return { kind: 'coderef', ref: coderef[1]! };
	return { kind: 'fuzzy', text: v };
}

/** `x.org::*Heading` → the file part and the search option, if any. */
export function splitSearch(path: string): { file: string; search: SearchOption | null } {
	const at = path.indexOf('::');
	if (at === -1) return { file: path, search: null };
	return { file: path.slice(0, at), search: parseSearchOption(path.slice(at + 2)) };
}

/**
 * A link's file path as a vault path, relative to the linking file's folder
 * (`./`, `../` and plain names). `null` for paths outside the vault
 * (absolute, `~/…`), which a browser can't open.
 */
export function resolvePath(fromFile: string, target: string): string | null {
	const t = target.replace(/^file:/, '');
	if (!t || t.startsWith('/') || t.startsWith('~') || /^[a-z]:[\\/]/i.test(t)) return null;
	const parts = fromFile.split('/').slice(0, -1);
	for (const part of t.split('/')) {
		if (part === '' || part === '.') continue;
		if (part === '..') {
			if (!parts.length) return null;
			parts.pop();
		} else parts.push(part);
	}
	return parts.join('/');
}

/** Collapse runs of whitespace, as `org-link-search` compares headings and targets. */
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** `org-link-normalize-string`: also drop statistics cookies (`[1/3]`, `[50%]`). */
const normHeading = (s: string, pipes = false) =>
	norm((pipes ? s.replace(/\|/g, '') : s).replace(/\[\d*(?:%|\/\d*)\]/g, ' '));

/** `<<target>>`: no `<`, `>` or newline inside, no whitespace at either end. */
const TARGET_RE = /<<(?!<)([^<>\n\s](?:[^<>\n]*[^<>\n\s])?)>>(?!>)/g;
const RADIO_RE = /<<<([^<>\n\s](?:[^<>\n]*[^<>\n\s])?)>>>/g;

export type TextPiece =
	| { kind: 'text'; text: string }
	| { kind: 'target'; name: string }
	| { kind: 'radio'; name: string };

/** Split plain text around dedicated and radio targets (uniorg leaves them as text). */
export function splitTargets(text: string): TextPiece[] {
	if (!text.includes('<<')) return [{ kind: 'text', text }];
	const out: TextPiece[] = [];
	const re = new RegExp(`${RADIO_RE.source}|${TARGET_RE.source}`, 'g');
	let last = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
		if (m[1] !== undefined) out.push({ kind: 'radio', name: m[1] });
		else out.push({ kind: 'target', name: m[2]! });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
	return out;
}

/** Radio targets defined in a file: their text, for turning matching words into links. */
export function radioTargets(source: string): string[] {
	const out = new Set<string>();
	for (const m of source.matchAll(RADIO_RE)) out.add(m[1]!);
	return [...out];
}

/**
 * Where a search option points in a file: an offset (the heading's line, the
 * target, the named element), or `null` if nothing matches. As in
 * `org-link-search`: a fuzzy link looks for a `<<target>>`, then a
 * `#+NAME:` (both ignoring case and spacing), then a heading with exactly
 * those words; `*Heading` only looks at headings.
 */
export function findSearchTarget(
	source: string,
	search: SearchOption,
	keywords: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): number | null {
	const lines = splitLines(source);
	// org-link--search-headlines: the title without keyword, priority, tags,
	// COMMENT and statistics cookies must equal the words exactly (case
	// matters), then again ignoring `|`.
	const headingIs = (title: string) => {
		for (const pipes of [false, true]) {
			const want = normHeading(title, pipes);
			for (const line of lines) {
				if (!line.text.startsWith('*')) continue;
				const h = scanHeadline(line, keywords);
				if (h && normHeading(h.title.value, pipes) === want) return line.from;
			}
		}
		return null;
	};
	switch (search.kind) {
		case 'heading':
			return headingIs(search.title);
		case 'custom-id': {
			const re = new RegExp(
				`^[ \\t]*:CUSTOM_ID:[ \\t]+${search.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`,
				'i',
			);
			let heading: number | null = null;
			for (const line of lines) {
				if (/^\*+[ \t]/.test(line.text)) heading = line.from;
				if (re.test(line.text)) return heading ?? line.from;
			}
			return null;
		}
		case 'coderef': {
			const re = new RegExp(`\\(ref:${search.ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`);
			for (const line of lines) if (re.test(line.text)) return line.from;
			return null;
		}
		case 'line':
			return lines[search.line - 1]?.from ?? null;
		case 'regexp': {
			try {
				const m = new RegExp(search.source, 'm').exec(source);
				return m ? m.index : null;
			} catch {
				return null;
			}
		}
		case 'fuzzy': {
			const want = norm(search.text).toLowerCase();
			for (const m of source.matchAll(TARGET_RE))
				if (norm(m[1]!).toLowerCase() === want) return m.index;
			const name = new RegExp(`^[ \\t]*#\\+NAME:[ \\t]*(.*?)[ \\t]*$`, 'i');
			for (const line of lines) {
				const m = name.exec(line.text);
				if (m && norm(m[1]!).toLowerCase() === want) return line.from;
			}
			return headingIs(search.text);
		}
	}
}
