/// Line-by-line syntax spans for the source editor. It works on the raw text
/// (never a re-serialised tree), so what you see is exactly what is saved.
/// State carried between lines covers blocks and drawers.

import { escapeRegExp } from './text';
import type { KeywordConfig } from './types';

export type SpanKind =
	| 'stars'
	| 'todo'
	| 'done'
	| 'priority'
	| 'tags'
	| 'keyword'
	| 'title'
	| 'planning'
	| 'timestamp'
	| 'drawer'
	| 'property'
	| 'block-delim'
	| 'comment'
	| 'link'
	| 'link-markup'
	| 'bold'
	| 'italic'
	| 'code'
	| 'strike'
	| 'underline'
	| 'markup'
	| 'bullet'
	| 'checkbox'
	| 'cookie'
	| 'table';

export interface HighlightSpan {
	from: number;
	to: number;
	kind: SpanKind;
	/** Link target (for `link` spans) or checkbox state. */
	data?: string;
}

export type LineKind =
	| 'headline'
	| 'meta'
	| 'block'
	| 'block-delim'
	| 'drawer'
	| 'comment'
	| 'table'
	| 'planning'
	| null;

export interface LineInfo {
	kind: LineKind;
	level: number;
	spans: HighlightSpan[];
}

export interface HighlightState {
	/** Name of the open `#+begin_` block, if any. */
	block: string | null;
	drawer: boolean;
}

export const initialHighlightState = (): HighlightState => ({ block: null, drawer: false });

const HEADLINE_RE = /^(\*+)([ \t]+|$)/;
const BLOCK_BEGIN_RE = /^[ \t]*#\+begin_(\S+)/i;
const META_RE = /^([ \t]*#\+)([\w-]+)(:)(.*)$/;
const DRAWER_RE = /^[ \t]*:([\w-]+):[ \t]*$/;
const PROPERTY_RE = /^([ \t]*:)(\S+?)(:)(?=[ \t]|$)/;
const PLANNING_RE = /\b(SCHEDULED|DEADLINE|CLOSED):/g;
const TIMESTAMP_RE =
	/<\d{4}-\d{2}-\d{2}[^>\n]*>(?:--<\d{4}-\d{2}-\d{2}[^>\n]*>)?|\[\d{4}-\d{2}-\d{2}[^\]\n]*\](?:--\[\d{4}-\d{2}-\d{2}[^\]\n]*\])?/g;
const LINK_RE = /\[\[((?:[^\]\\]|\\.)+)\](?:\[((?:[^\]]|\](?!\]))*)\])?\]/g;
const LIST_RE = /^([ \t]*)([-+]|[ \t]\*|\d+[.)])([ \t]+)(\[[ Xx-]\][ \t]+)?/;
const COOKIE_RE = /\[(?:\d*\/\d*|\d*%)\]/g;
const TAGS_RE = /[ \t]+(:(?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u;
const MARKUP: Record<string, SpanKind> = {
	'*': 'bold',
	'/': 'italic',
	'=': 'code',
	'~': 'code',
	'+': 'strike',
	_: 'underline',
};
const EMPHASIS_RE =
	/(^|[\s({'"\-])([*/_+=~])([^\s*/_+=~](?:[^\n]*?[^\s])?)\2(?=[\s\-.,:;!?'")}\[]|$)/g;

/** Inline spans: links, timestamps, emphasis, cookies. `offset` shifts positions. */
export function inlineSpans(text: string, offset = 0): HighlightSpan[] {
	const spans: HighlightSpan[] = [];
	const taken: [number, number][] = [];
	const free = (a: number, b: number) => taken.every(([x, y]) => b <= x || a >= y);
	for (const m of text.matchAll(LINK_RE)) {
		const start = m.index;
		const target = m[1]!;
		const desc = m[2];
		const end = start + m[0].length;
		taken.push([start, end]);
		if (desc !== undefined) {
			const descStart = start + 2 + target.length + 2;
			spans.push({ from: offset + start, to: offset + descStart, kind: 'link-markup' });
			spans.push({
				from: offset + descStart,
				to: offset + descStart + desc.length,
				kind: 'link',
				data: target,
			});
			spans.push({ from: offset + end - 2, to: offset + end, kind: 'link-markup' });
		} else {
			spans.push({ from: offset + start, to: offset + start + 2, kind: 'link-markup' });
			spans.push({ from: offset + start + 2, to: offset + end - 2, kind: 'link', data: target });
			spans.push({ from: offset + end - 2, to: offset + end, kind: 'link-markup' });
		}
	}
	for (const m of text.matchAll(TIMESTAMP_RE)) {
		if (!free(m.index, m.index + m[0].length)) continue;
		taken.push([m.index, m.index + m[0].length]);
		spans.push({ from: offset + m.index, to: offset + m.index + m[0].length, kind: 'timestamp' });
	}
	for (const m of text.matchAll(COOKIE_RE)) {
		if (!free(m.index, m.index + m[0].length)) continue;
		spans.push({ from: offset + m.index, to: offset + m.index + m[0].length, kind: 'cookie' });
	}
	for (const m of text.matchAll(EMPHASIS_RE)) {
		const start = m.index + m[1]!.length;
		const end = start + m[3]!.length + 2;
		if (!free(start, end)) continue;
		taken.push([start, end]);
		spans.push({ from: offset + start, to: offset + start + 1, kind: 'markup' });
		spans.push({ from: offset + start + 1, to: offset + end - 1, kind: MARKUP[m[2]!]! });
		spans.push({ from: offset + end - 1, to: offset + end, kind: 'markup' });
	}
	return spans.sort((a, b) => a.from - b.from);
}

/** Highlight one line (without its newline). Updates `state` for the next line. */
export function highlightLine(
	text: string,
	state: HighlightState,
	keywords: KeywordConfig,
): LineInfo {
	const spans: HighlightSpan[] = [];
	const whole = (kind: SpanKind) => (text.length ? [{ from: 0, to: text.length, kind }] : []);

	if (state.block) {
		if (new RegExp(`^[ \\t]*#\\+end_${escapeRegExp(state.block)}\\b`, 'i').test(text)) {
			state.block = null;
			return { kind: 'block-delim', level: 0, spans: whole('block-delim') };
		}
		return { kind: 'block', level: 0, spans };
	}

	const headline = HEADLINE_RE.exec(text);
	if (headline) {
		state.drawer = false;
		const level = headline[1]!.length;
		spans.push({ from: 0, to: level, kind: 'stars' });
		let pos = headline[0].length;
		let rest = text.slice(pos);
		const kw = /^(\S+)(?=[ \t]|$)/.exec(rest)?.[1];
		if (kw && (keywords.todoKeywords.includes(kw) || keywords.doneKeywords.includes(kw))) {
			spans.push({
				from: pos,
				to: pos + kw.length,
				kind: keywords.doneKeywords.includes(kw) ? 'done' : 'todo',
			});
			const skip = /^\S+[ \t]*/.exec(rest)![0].length;
			pos += skip;
			rest = rest.slice(skip);
		}
		const prio = /^\[#[A-Z0-9]+\][ \t]*/.exec(rest);
		if (prio) {
			spans.push({ from: pos, to: pos + prio[0].trimEnd().length, kind: 'priority' });
			pos += prio[0].length;
			rest = rest.slice(prio[0].length);
		}
		const tags = TAGS_RE.exec(rest);
		const titleEnd = tags ? pos + tags.index : text.length;
		spans.push(...inlineSpans(text.slice(pos, titleEnd), pos));
		if (tags)
			spans.push({ from: text.length - tags[0].trimStart().length, to: text.length, kind: 'tags' });
		return { kind: 'headline', level, spans };
	}

	const begin = BLOCK_BEGIN_RE.exec(text);
	if (begin) {
		state.block = begin[1]!.toLowerCase();
		return { kind: 'block-delim', level: 0, spans: whole('block-delim') };
	}

	const meta = META_RE.exec(text);
	if (meta) {
		const keyEnd = meta[1]!.length + meta[2]!.length + 1;
		spans.push({ from: 0, to: keyEnd, kind: 'keyword' });
		if (meta[2]!.toLowerCase() === 'title')
			spans.push({ from: keyEnd, to: text.length, kind: 'title' });
		else spans.push(...inlineSpans(meta[4]!, keyEnd));
		return { kind: 'meta', level: 0, spans };
	}

	const drawer = DRAWER_RE.exec(text);
	if (drawer) {
		state.drawer = drawer[1]!.toUpperCase() !== 'END';
		return { kind: 'drawer', level: 0, spans: whole('drawer') };
	}
	if (state.drawer) {
		const prop = PROPERTY_RE.exec(text);
		if (prop) spans.push({ from: 0, to: prop[0].length, kind: 'property' });
		spans.push(...inlineSpans(text.slice(prop?.[0].length ?? 0), prop?.[0].length ?? 0));
		return { kind: 'drawer', level: 0, spans };
	}

	if (/^[ \t]*#(?:[ \t]|$)/.test(text))
		return { kind: 'comment', level: 0, spans: whole('comment') };

	if (/^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(text)) {
		for (const m of text.matchAll(PLANNING_RE))
			spans.push({ from: m.index, to: m.index + m[0].length, kind: 'planning' });
		spans.push(...inlineSpans(text));
		return { kind: 'planning', level: 0, spans: spans.sort((a, b) => a.from - b.from) };
	}

	if (/^[ \t]*\|/.test(text)) {
		for (const m of text.matchAll(/\|/g))
			spans.push({ from: m.index, to: m.index + 1, kind: 'table' });
		// A rule (`|---+---|`) holds no markup: its `+-…-+` isn't strike-through.
		if (!/^[ \t]*\|-/.test(text)) spans.push(...inlineSpans(text));
		return { kind: 'table', level: 0, spans: spans.sort((a, b) => a.from - b.from) };
	}

	const list = LIST_RE.exec(text);
	let start = 0;
	if (list) {
		const bulletStart = list[1]!.length;
		spans.push({ from: bulletStart, to: bulletStart + list[2]!.length, kind: 'bullet' });
		if (list[4]) {
			const boxStart = bulletStart + list[2]!.length + list[3]!.length;
			spans.push({ from: boxStart, to: boxStart + 3, kind: 'checkbox', data: list[4][1]! });
		}
		start = list[0].length;
	}
	spans.push(...inlineSpans(text.slice(start), start));
	return { kind: null, level: 0, spans };
}
