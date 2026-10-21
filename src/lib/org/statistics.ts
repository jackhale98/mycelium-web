/// TODO statistics cookies on headlines (`[2/5]`, `[40%]`), as
/// `org-update-statistics-cookies` recounts them: from the children's TODO
/// keywords (direct children, or all descendants with `COOKIE_DATA:
/// recursive`), only headings with a keyword counting. An entry with its own
/// checkbox list counts checkboxes instead (see checkbox.ts), and
/// `COOKIE_DATA: checkbox` opts out. No children: `[100%]` / `[0/0]`.

import { headlineLevel, owningHeadline, scanHeadline, type HeadlineScan } from './headline';
import { entryEnd } from './log';
import { getProperties } from './properties';
import { splitLines, type Change, type Line } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

const COOKIE_RE = /\[(\d*)%\]|\[(\d*)\/(\d*)\]/g;

/** `org-format-percent-cookie`: rounded down, but never 0% once something is done. */
export function percentCookie(done: number, total: number): string {
	const p = Math.floor((100 * done) / Math.max(1, total));
	return `[${p === 0 && done > 0 ? 1 : p}%]`;
}

/** `COOKIE_DATA`, inherited from the heading or its ancestors. */
function cookieData(
	source: string,
	lines: readonly Line[],
	h: HeadlineScan,
	config: KeywordConfig,
) {
	let level = h.level;
	for (let i = h.line.index; i >= 0; i -= 1) {
		const l = headlineLevel(lines[i]!.text);
		if (l === 0 || (i !== h.line.index && l >= level)) continue;
		const v = getProperties(source, lines[i]!.from, config)['COOKIE_DATA'];
		if (v) return v.toLowerCase();
		level = l;
	}
	return getProperties(source, null, config)['COOKIE_DATA']?.toLowerCase() ?? '';
}

/** Recount the cookies on the headline at `offset`; no change when there's nothing to do. */
export function updateTodoCookies(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const lines = splitLines(source);
	const h = owningHeadline(source, offset, config, lines);
	if (!h) return [];
	const title = h.line.text.slice(0, (h.tags?.from ?? h.line.to) - h.line.from);
	if (!/\[\d*(?:%|\/\d*)\]/.test(title)) return [];
	const data = cookieData(source, lines, h, config);
	if (/\bcheckbox\b/.test(data)) return [];
	const end = lines.findIndex((l) => l.from >= entryEnd(lines, h));
	const stop = end === -1 ? lines.length : end;
	// The entry's own checkbox list owns the cookie (org-update-checkbox-count).
	if (!/\btodo\b/.test(data))
		for (let i = h.line.index + 1; i < stop; i += 1)
			if (/^[ \t]*(?:[-+*]|\d+[.)])[ \t]+\[[- X]\]/.test(lines[i]!.text)) return [];

	const recursive = /\brecursive\b/.test(data);
	let all = 0;
	let done = 0;
	let childLevel = 0;
	let any = false;
	for (let i = stop; i < lines.length; i += 1) {
		const level = headlineLevel(lines[i]!.text);
		if (level === 0) continue;
		if (level <= h.level) break;
		any = true;
		childLevel ||= level;
		if (!recursive && level !== childLevel) continue;
		const c = scanHeadline(lines[i]!, config);
		const kw = c?.keyword?.value;
		if (!kw) continue;
		all += 1;
		if (config.doneKeywords.includes(kw)) done += 1;
	}
	const changes: Change[] = [];
	for (const m of title.matchAll(COOKIE_RE)) {
		const next =
			m[1] !== undefined
				? any
					? percentCookie(done, all)
					: '[100%]'
				: any
					? `[${done}/${all}]`
					: '[0/0]';
		if (next !== m[0])
			changes.push({
				from: h.line.from + m.index,
				to: h.line.from + m.index + m[0].length,
				insert: next,
			});
	}
	return changes;
}

/** The parent heading of the heading at `offset`, if any. */
export function parentHeading(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): number | null {
	const lines = splitLines(source);
	const h = owningHeadline(source, offset, config, lines);
	if (!h) return null;
	for (let i = h.line.index - 1; i >= 0; i -= 1) {
		const l = headlineLevel(lines[i]!.text);
		if (l > 0 && l < h.level) return lines[i]!.from;
	}
	return null;
}
