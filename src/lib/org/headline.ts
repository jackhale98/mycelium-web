/// Headlines: `** TODO [#A] Title :tag1:tag2:`.
///
/// `scanHeadline` locates each component as an absolute source span, and every
/// edit replaces only the component it targets. Changing a keyword never
/// touches the title's spacing, and retagging keeps right-aligned tags aligned.

import { escapeRegExp, lineAt, splitLines, type Change, type Line } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig, type Span } from './types';

const TAG_RE = /^[\p{L}\p{N}_@#%]+$/u;
const TAG_BLOCK_RE = /(^|[ \t]+)(:(?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u;
const PRIORITY_RE = /^\[#([A-Z0-9]+)\]/;
/** Tag blocks ending at or beyond this column with padding before them are treated as aligned. */
const ALIGNED_TAGS_MIN_COLUMN = 50;

export interface HeadlineScan {
	line: Line;
	level: number;
	/** Offset where content begins, after the stars and their whitespace. */
	contentFrom: number;
	keyword: (Span & { value: string }) | null;
	/** Where a priority cookie goes: after the keyword and its whitespace. */
	afterKeyword: number;
	priority: (Span & { value: string }) | null;
	commented: boolean;
	/** The title text, trimmed. Zero-width when the title is empty. */
	title: Span & { value: string };
	/** The `:a:b:` block. */
	tags: (Span & { values: string[] }) | null;
}

/** A headline is column-0 stars followed by a space or tab. */
export function isHeadlineText(text: string): boolean {
	return /^\*+[ \t]/.test(text);
}

export function headlineLevel(text: string): number {
	return isHeadlineText(text) ? /^\*+/.exec(text)![0].length : 0;
}

export function isValidTag(tag: string): boolean {
	return TAG_RE.test(tag);
}

/** Normalise user input into a legal tag, or `null` if nothing usable remains. */
export function normaliseTag(tag: string): string | null {
	const cleaned = tag
		.trim()
		.replace(/[^\p{L}\p{N}_@#%]+/gu, '_')
		.replace(/^_+|_+$/g, '');
	return cleaned.length > 0 ? cleaned : null;
}

function keywordRegex(config: KeywordConfig): RegExp | null {
	const all = [...config.todoKeywords, ...config.doneKeywords]
		.filter((k) => k.length > 0)
		.sort((a, b) => b.length - a.length)
		.map(escapeRegExp);
	return all.length > 0 ? new RegExp(`^(${all.join('|')})(?=[ \\t]|$)`) : null;
}

/** Scan a headline line. Returns `null` for anything that is not a headline. */
export function scanHeadline(line: Line, config: KeywordConfig = DEFAULT_KEYWORD_CONFIG): HeadlineScan | null {
	const m = /^(\*+)[ \t]+/.exec(line.text);
	if (!m) return null;
	const base = line.from;
	const level = m[1]!.length;
	let pos = m[0].length;
	const text = line.text;
	const skipWs = () => {
		while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos += 1;
	};

	let keyword: HeadlineScan['keyword'] = null;
	const kw = keywordRegex(config)?.exec(text.slice(pos));
	if (kw) {
		keyword = { from: base + pos, to: base + pos + kw[1]!.length, value: kw[1]! };
		pos += kw[1]!.length;
		skipWs();
	}
	const afterKeyword = base + pos;

	let priority: HeadlineScan['priority'] = null;
	const pr = PRIORITY_RE.exec(text.slice(pos));
	if (pr) {
		priority = { from: base + pos, to: base + pos + pr[0].length, value: pr[1]! };
		pos += pr[0].length;
		skipWs();
	}

	let commented = false;
	if (/^COMMENT(?=[ \t]|$)/.test(text.slice(pos))) {
		commented = true;
		pos += 'COMMENT'.length;
		skipWs();
	}

	let titleEnd = text.length;
	let tags: HeadlineScan['tags'] = null;
	const rest = text.slice(pos);
	const tm = TAG_BLOCK_RE.exec(rest);
	if (tm) {
		const blockFrom = pos + tm.index + tm[1]!.length;
		tags = {
			from: base + blockFrom,
			to: base + blockFrom + tm[2]!.length,
			values: tm[2]!.split(':').filter((t) => t.length > 0),
		};
		titleEnd = pos + tm.index;
	}
	while (titleEnd > pos && (text[titleEnd - 1] === ' ' || text[titleEnd - 1] === '\t')) titleEnd -= 1;

	return {
		line,
		level,
		contentFrom: base + m[0].length,
		keyword,
		afterKeyword,
		priority,
		commented,
		title: { from: base + pos, to: base + Math.max(pos, titleEnd), value: text.slice(pos, Math.max(pos, titleEnd)) },
		tags,
	};
}

/** Scan the headline whose line contains `offset`. */
export function headlineAt(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	lines: readonly Line[] = splitLines(source),
): HeadlineScan | null {
	const line = lineAt(lines, offset);
	return line ? scanHeadline(line, config) : null;
}

/** The nearest headline at or above `offset` — the entry that owns that position. */
export function owningHeadline(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	lines: readonly Line[] = splitLines(source),
): HeadlineScan | null {
	const start = lineAt(lines, offset);
	if (!start) return null;
	for (let i = start.index; i >= 0; i -= 1) {
		const h = scanHeadline(lines[i]!, config);
		if (h) return h;
	}
	return null;
}

/** Offset of the first line after the headline's subtree. */
export function subtreeEnd(lines: readonly Line[], headline: HeadlineScan): number {
	for (let i = headline.line.index + 1; i < lines.length; i += 1) {
		const level = headlineLevel(lines[i]!.text);
		if (level > 0 && level <= headline.level) return lines[i]!.from;
	}
	return lines.length > 0 ? lines[lines.length - 1]!.end : 0;
}

// ---------------------------------------------------------------------------
// Token-level editing helpers

/** Insert a whitespace-separated token at `at` on `line`, adding spaces only where needed. */
function insertToken(line: Line, at: number, token: string): Change {
	const rel = at - line.from;
	const before = line.text[rel - 1];
	const after = line.text[rel];
	const needBefore = before !== undefined && before !== ' ' && before !== '\t';
	const needAfter = after !== undefined && after !== ' ' && after !== '\t';
	return { from: at, to: at, insert: `${needBefore ? ' ' : ''}${token}${needAfter ? ' ' : ''}` };
}

/**
 * Remove a token and exactly one adjoining run of whitespace: the run after it
 * when more content follows, otherwise the run before it — but never the
 * whitespace that separates the stars from the content.
 */
function removeToken(line: Line, span: Span, floor: number): Change {
	const text = line.text;
	let to = span.to - line.from;
	let from = span.from - line.from;
	let end = to;
	while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end += 1;
	if (end < text.length) {
		to = end;
	} else {
		let start = from;
		while (start > floor - line.from && (text[start - 1] === ' ' || text[start - 1] === '\t')) start -= 1;
		from = start;
		to = text.length;
	}
	return { from: line.from + from, to: line.from + to, insert: '' };
}

/** Set or (with `null`) clear the TODO keyword. */
export function setTodoKeyword(
	source: string,
	offset: number,
	keyword: string | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const h = headlineAt(source, offset, config);
	if (!h) return [];
	const value = keyword?.trim() || null;
	if (h.keyword) {
		if (value === h.keyword.value) return [];
		if (value) return [{ from: h.keyword.from, to: h.keyword.to, insert: value }];
		return [removeToken(h.line, h.keyword, h.contentFrom)];
	}
	if (!value) return [];
	return [insertToken(h.line, h.contentFrom, value)];
}

/** Set or (with `null`) clear the priority cookie. */
export function setPriority(
	source: string,
	offset: number,
	priority: string | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const h = headlineAt(source, offset, config);
	if (!h) return [];
	const value = priority?.trim() || null;
	if (value !== null && !/^[A-Z0-9]+$/.test(value)) return [];
	if (h.priority) {
		if (value === h.priority.value) return [];
		if (value) return [{ from: h.priority.from, to: h.priority.to, insert: `[#${value}]` }];
		return [removeToken(h.line, h.priority, h.keyword ? h.keyword.to + 1 : h.contentFrom)];
	}
	if (!value) return [];
	return [insertToken(h.line, h.afterKeyword, `[#${value}]`)];
}

/** Replace the title text, leaving keyword, priority and tags as written. */
export function setHeadlineTitle(
	source: string,
	offset: number,
	title: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const h = headlineAt(source, offset, config);
	if (!h) return [];
	const value = title.replace(/[\r\n]+/g, ' ').trim();
	if (h.title.to > h.title.from) return [{ from: h.title.from, to: h.title.to, insert: value }];
	if (!value) return [];
	// Empty title: insert where it belongs, before any tag block.
	const at = h.tags ? h.tags.from : h.line.to;
	const rel = at - h.line.from;
	const before = h.line.text[rel - 1];
	const lead = before === ' ' || before === '\t' || rel === 0 ? '' : ' ';
	return [{ from: at, to: at, insert: `${lead}${value}${h.tags ? ' ' : ''}` }];
}

/**
 * Replace the headline's tags. An empty list removes the block. When the
 * existing block is right-aligned (org's `org-tags-column`), the padding is
 * adjusted so the block keeps ending in the same column.
 */
export function setHeadlineTags(
	source: string,
	offset: number,
	tags: readonly string[],
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const h = headlineAt(source, offset, config);
	if (!h) return [];
	const clean: string[] = [];
	for (const tag of tags) if (isValidTag(tag) && !clean.includes(tag)) clean.push(tag);
	const block = clean.length > 0 ? `:${clean.join(':')}:` : '';

	if (!h.tags) {
		if (!block) return [];
		const at = Math.max(h.title.to, h.priority?.to ?? 0, h.keyword?.to ?? 0, h.contentFrom);
		// Any trailing whitespace is absorbed into the single separating space.
		return [{ from: at, to: h.line.to, insert: `${at > h.contentFrom ? ' ' : ''}${block}` }];
	}
	if (h.tags.values.join(':') === clean.join(':')) return [];
	if (!block) return [removeToken(h.line, h.tags, h.title.to)];

	// Preserve right alignment (org-tags-column, -77 by default): when the block
	// clearly sits at a far column, padding shrinks or grows to keep its end fixed.
	const gapFrom = Math.max(h.title.to, h.priority?.to ?? 0, h.keyword?.to ?? 0, h.contentFrom);
	const gap = h.tags.from - gapFrom;
	const endColumn = [...h.line.text.slice(0, h.tags.to - h.line.from)].length;
	const gapText = h.line.text.slice(gapFrom - h.line.from, h.tags.from - h.line.from);
	if (gap > 1 && endColumn >= ALIGNED_TAGS_MIN_COLUMN && !gapText.includes('\t')) {
		const oldLen = h.tags.to - h.tags.from;
		const newGap = Math.max(1, gap + oldLen - block.length);
		return [{ from: gapFrom, to: h.tags.to, insert: `${' '.repeat(newGap)}${block}` }];
	}
	return [{ from: h.tags.from, to: h.tags.to, insert: block }];
}

/** Add `tag` if absent, remove it if present. */
export function toggleHeadlineTag(
	source: string,
	offset: number,
	tag: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const h = headlineAt(source, offset, config);
	const t = normaliseTag(tag);
	if (!h || !t) return [];
	const current = h.tags?.values ?? [];
	const next = current.includes(t) ? current.filter((x) => x !== t) : [...current, t];
	return setHeadlineTags(source, offset, next, config);
}

/** Next keyword in the cycle `todo… → done… → none → todo…`. */
export function nextTodoKeyword(
	current: string | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	direction: 1 | -1 = 1,
): string | null {
	const cycle: (string | null)[] = [...config.todoKeywords, ...config.doneKeywords, null];
	if (cycle.length === 1) return null;
	const index = cycle.indexOf(current);
	if (index === -1) return direction === 1 ? (cycle[0] ?? null) : (cycle[cycle.length - 2] ?? null);
	return cycle[(index + direction + cycle.length) % cycle.length] ?? null;
}

/** Next priority, wrapping through "no priority". */
export function nextPriority(current: string | null, priorities: readonly string[], direction: 1 | -1 = 1): string | null {
	const cycle: (string | null)[] = [...priorities, null];
	if (cycle.length === 1) return null;
	const index = cycle.indexOf(current);
	if (index === -1) return direction === 1 ? (cycle[0] ?? null) : (cycle[cycle.length - 2] ?? null);
	return cycle[(index + direction + cycle.length) % cycle.length] ?? null;
}

/** Build a new headline line (without terminator). */
export function formatHeadline(parts: {
	level: number;
	title: string;
	keyword?: string | null;
	priority?: string | null;
	tags?: readonly string[];
}): string {
	const tokens = ['*'.repeat(Math.max(1, parts.level))];
	if (parts.keyword) tokens.push(parts.keyword);
	if (parts.priority) tokens.push(`[#${parts.priority}]`);
	if (parts.title) tokens.push(parts.title.replace(/[\r\n]+/g, ' ').trim());
	const tags = (parts.tags ?? []).filter(isValidTag);
	if (tags.length > 0) tokens.push(`:${tags.join(':')}:`);
	return tokens.length === 1 ? `${tokens[0]} ` : tokens.join(' ');
}
