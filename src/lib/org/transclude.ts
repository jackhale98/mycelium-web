/// org-transclusion: `#+transclude: [[link]] :level 2 :only-contents …`
/// shows another note (or part of one, or of any text file) in place,
/// read-only. What's shown, as org-transclusion does by default:
///
/// - an `id:` on a heading, or a `::*heading` / `::#custom-id` search: that
///   heading's subtree; a file-level `id:` or a bare `file:` link: the whole
///   file; a `#+NAME` search: that element; a `<<target>>`: its paragraph;
/// - property drawers are always dropped (`org-transclusion-exclude-elements`
///   is `(property-drawer)`); `:exclude-elements "drawer keyword"` adds more;
/// - `:only-contents` drops heading lines, `:no-first-heading` the first one;
/// - `:level N` moves the top heading to level N (others keep their offset);
///   `:level` alone (or `auto`) uses the transcluding heading's level + 1;
/// - `:lines A-B` (inclusive), `:end "text"`, `:src lang` for any text file.

import { findSearchTarget, parseSearchOption } from './links';
import { owningHeadline, subtreeEnd } from './headline';
import { shiftLevels } from './refile';
import { splitLines } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

export interface TranscludeOptions {
	/** The link's raw text inside `[[…]]` (before any description). */
	link: string;
	level: number | 'auto' | null;
	onlyContents: boolean;
	noFirstHeading: boolean;
	exclude: string[];
	lines: { from: number | null; to: number | null } | null;
	src: string | null;
	end: string | null;
}

/** Parse a `#+transclude:` keyword's value. `null` without a `[[link]]`. */
export function parseTransclude(value: string): TranscludeOptions | null {
	const m = /\[\[(.+?)\](?:\[.*?\])?\]/.exec(value);
	if (!m) return null;
	const rest = value.slice(m.index + m[0].length);
	const level = /:level(?:[ \t]+([1-9]|auto))?(?=\s|$)/.exec(rest);
	const lines = /:lines[ \t]+"?(\d*)-(\d*)"?/.exec(rest);
	const exclude = /:exclude-elements[ \t]+"([^"]*)"/.exec(rest);
	return {
		link: m[1]!,
		level: level ? (level[1] && level[1] !== 'auto' ? Number(level[1]) : 'auto') : null,
		onlyContents: /:only-contents?(?=\s|$)/.test(rest),
		noFirstHeading: /:no-first-heading(?=\s|$)/.test(rest),
		exclude: ['property-drawer', ...(exclude?.[1]?.split(/\s+/).filter(Boolean) ?? [])],
		lines: lines
			? { from: lines[1] ? Number(lines[1]) : null, to: lines[2] ? Number(lines[2]) : null }
			: null,
		src: /:src[ \t]+"?([\w-]+)"?/.exec(rest)?.[1] ?? null,
		end: /:end[ \t]+"([^"]*)"/.exec(rest)?.[1] ?? null,
	};
}

/** Which part of a source to show. */
export type TranscludePart =
	{ kind: 'file' } | { kind: 'subtree'; offset: number } | { kind: 'search'; search: string };

const DRAWER_START = /^[ \t]*:([\w-]+):[ \t]*$/;
const DRAWER_END = /^[ \t]*:END:[ \t]*$/i;

/** Remove excluded elements line by line (drawers, keywords, planning lines). */
function filterElements(text: string, exclude: readonly string[]): string {
	const out: string[] = [];
	let drawer: string | null = null;
	let block = false;
	for (const line of text.split(/(?<=\n)/)) {
		const bare = line.replace(/\r?\n$/, '');
		if (block) {
			if (/^[ \t]*#\+end_/i.test(bare)) block = false;
			out.push(line);
			continue;
		}
		if (/^[ \t]*#\+begin_/i.test(bare)) {
			block = true;
			out.push(line);
			continue;
		}
		if (drawer) {
			if (DRAWER_END.test(bare)) drawer = null;
			continue;
		}
		const d = DRAWER_START.exec(bare);
		if (d && !DRAWER_END.test(bare)) {
			const kind = d[1]!.toUpperCase() === 'PROPERTIES' ? 'property-drawer' : 'drawer';
			if (exclude.includes(kind)) {
				drawer = kind;
				continue;
			}
		}
		if (exclude.includes('keyword') && /^[ \t]*#\+\w+:/.test(bare)) continue;
		if (exclude.includes('planning') && /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(bare))
			continue;
		if (exclude.includes('comment') && /^[ \t]*#(?:[ \t]|$)/.test(bare)) continue;
		out.push(line);
	}
	return out.join('');
}

/** The paragraph (or element) around `offset`: lines up to the blank lines on either side. */
function elementAround(source: string, offset: number): string {
	const lines = splitLines(source);
	let i = lines.findIndex((l) => l.end > offset);
	if (i === -1) return '';
	let start = i;
	while (start > 0 && lines[start - 1]!.text.trim() && !/^\*+[ \t]/.test(lines[start]!.text))
		start -= 1;
	let end = i;
	while (
		end + 1 < lines.length &&
		lines[end + 1]!.text.trim() &&
		!/^\*+[ \t]/.test(lines[end + 1]!.text)
	)
		end += 1;
	return source.slice(lines[start]!.from, lines[end]!.end);
}

/**
 * The text to show for a transclusion of `source`. `org` is false for other
 * text files (shown whole or by `:lines`, optionally as a source block).
 * `hostLevel` is the level of the heading holding the keyword (for `:level`).
 */
export function transcludedText(
	source: string,
	part: TranscludePart,
	opts: TranscludeOptions,
	options: { org: boolean; hostLevel?: number; keywords?: KeywordConfig } = { org: true },
): string | null {
	const keywords = options.keywords ?? DEFAULT_KEYWORD_CONFIG;
	let text: string;
	if (!options.org) text = source;
	else if (part.kind === 'file') text = source;
	else {
		const offset =
			part.kind === 'subtree'
				? part.offset
				: findSearchTarget(source, parseSearchOption(part.search), keywords);
		if (offset === null) return null;
		const lines = splitLines(source);
		const h = owningHeadline(source, offset, keywords, lines);
		const onHeading = h && h.line.from === offset;
		// A heading: its subtree. A `#+NAME:` line or a target: the element around it.
		text = onHeading
			? source.slice(h.line.from, subtreeEnd(lines, h))
			: elementAround(source, offset);
	}

	if (opts.lines) {
		const all = text.split(/(?<=\n)/);
		const from = Math.max(1, opts.lines.from ?? 1);
		const to = Math.min(all.length, opts.lines.to ?? all.length);
		text = all.slice(from - 1, to).join('');
	}
	if (opts.end) {
		const at = text.indexOf(opts.end);
		if (at !== -1) text = text.slice(0, text.lastIndexOf('\n', at) + 1);
	}
	if (opts.src) return `#+begin_src ${opts.src}\n${text.replace(/\n?$/, '\n')}#+end_src\n`;
	if (!options.org) return text;

	text = filterElements(text, opts.exclude);
	if (opts.noFirstHeading) text = text.replace(/^\*+[ \t][^\n]*\n?/m, '');
	if (opts.onlyContents) {
		let block = false;
		text = text
			.split(/(?<=\n)/)
			.filter((line) => {
				if (block) {
					if (/^[ \t]*#\+end_/i.test(line)) block = false;
					return true;
				}
				if (/^[ \t]*#\+begin_/i.test(line)) block = true;
				return !/^\*+[ \t]/.test(line);
			})
			.join('');
	}
	if (opts.level !== null) {
		const top = /^(\*+)[ \t]/m.exec(text)?.[1]!.length;
		const want = opts.level === 'auto' ? (options.hostLevel ?? 0) + 1 : opts.level;
		if (top) text = shiftLevels(text, want - top);
	}
	return text;
}
