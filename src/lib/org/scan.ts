/// Fast, single-pass extraction of everything the index needs from one file.
///
/// `parseOrg` (uniorg) builds a complete syntax tree and is used to render a
/// note, but it costs a few milliseconds per file — too slow to index
/// thousands of files on first open. This scanner walks lines once and pulls
/// out exactly what org-roam's database records. `roam.ts` keeps the
/// tree-based extractor as the reference implementation, and a differential
/// test asserts the two agree on every fixture.

import { parseTagList } from './keywords';
import { effectiveKeywords } from './parse';
import { splitPropertyValues } from './properties';
import {
	parseRefs,
	type FileIndex,
	type HeadlineEntry,
	type RoamLink,
	type RoamNode,
} from './roam';
import { escapeRegExp, splitLines } from './text';
import { readTimestamp } from './timestamp';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig, type OrgTimestamp } from './types';

const HEADLINE_RE = /^(\*+)[ \t]+(.*)$/;
const KEYWORD_RE = /^[ \t]*#\+([A-Za-z][\w-]*):[ \t]*(.*?)[ \t]*$/;
const BLOCK_START_RE = /^[ \t]*#\+begin_(\S+)/i;
const DRAWER_START_RE = /^[ \t]*:PROPERTIES:[ \t]*$/i;
const DRAWER_END_RE = /^[ \t]*:END:[ \t]*$/i;
const ANY_DRAWER_RE = /^[ \t]*:([\w-]+):[ \t]*$/;
/** `:KEY: value`; keys may themselves contain colons (`:header-args:emacs-lisp:`). */
const PROPERTY_RE = /^[ \t]*:(\S+?):(?:[ \t]+(.*?))?[ \t]*$/;
const PLANNING_RE = /^[ \t]*(?:(?:SCHEDULED|DEADLINE|CLOSED):[ \t]*[<[][^>\]\n]*[>\]][ \t]*)+$/;
const PLANNING_ENTRY_RE = /(SCHEDULED|DEADLINE|CLOSED):[ \t]*/g;
const TAGS_RE = /(?:^|[ \t]+)(:(?:[\p{L}\p{N}_@#%]+:)+)[ \t]*$/u;
const LINK_SOURCE = /\[\[((?:[^\]\\]|\\.)+)\](?:\[((?:[^\]]|\](?!\]))*)\])?\]/.source;
/** For the link-collecting loop. Separate from `inlinePlain`'s copy: sharing a
 * global regex would reset `lastIndex` mid-loop. */
const LINK_RE = new RegExp(LINK_SOURCE, 'g');
const LINK_REPLACE_RE = new RegExp(LINK_SOURCE, 'g');
const LIST_ITEM_RE = /^[ \t]*(?:[-+]|[ \t]+\*|\d+[.)])(?:[ \t]|$)/;
const COOKIE_RE = /[ \t]*\[(?:\d*\/\d*|\d*%)\]/g;
const MAX_CONTEXT = 400;

const truthy = (v: string | undefined) =>
	v !== undefined && v.trim() !== '' && v.trim().toLowerCase() !== 'nil';

function basename(path: string): string {
	return (path.split('/').pop() ?? path).replace(/\.org$/i, '');
}

/**
 * A heading's title the way org-roam records it: `org-get-heading` (keyword,
 * priority, COMMENT and tags removed) passed through `org-link-display-format`
 * — bracket links become their description (or the link itself), and
 * everything else, markup and cookies included, stays as written.
 */
export function roamTitle(raw: string): string {
	return raw.replace(LINK_REPLACE_RE, (_m, target: string, desc?: string) => desc ?? target).trim();
}

/** Strip org inline markup to readable text (links shown by description). */
export function inlinePlain(text: string): string {
	return text
		.replace(
			LINK_REPLACE_RE,
			(_m, target: string, desc?: string) => desc ?? target.replace(/^[a-z]+:/, ''),
		)
		.replace(COOKIE_RE, '')
		.replace(
			/(^|[\s({'"\-])([*/_+=~])([^\s*/_+=~](?:[^\n]*?[^\s])?)\2(?=[\s\-.,:;!?'")}\[]|$)/g,
			'$1$3',
		);
}

/** Blank out spans whose links org ignores: inline verbatim and code. */
function maskVerbatim(text: string): string {
	return text.replace(
		/(^|[\s({'"\-])([=~])([^\s](?:[^\n]*?[^\s])?)\2(?=[\s\-.,:;!?'")}\[]|$)/g,
		(m, pre: string) => pre + ' '.repeat(m.length - pre.length),
	);
}

/** Index one org file. Produces the same `FileIndex` as `indexFileTree`. */
export function scanFile(
	path: string,
	source: string,
	globalKeywords: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): FileIndex {
	const keywords = effectiveKeywords(source, globalKeywords);
	const lines = splitLines(source);
	const kwAlternation = [...keywords.todoKeywords, ...keywords.doneKeywords]
		.filter((k) => k)
		.sort((a, b) => b.length - a.length)
		.map(escapeRegExp)
		.join('|');
	const kwRe = kwAlternation ? new RegExp(`^(${kwAlternation})(?=[ \\t]|$)[ \\t]*`) : null;

	// Pass 1: file keywords outside blocks (org collects them from anywhere).
	const fileKeywords = new Map<string, string>();
	{
		let blockEnd: RegExp | null = null;
		for (const line of lines) {
			if (blockEnd) {
				if (blockEnd.test(line.text)) blockEnd = null;
				continue;
			}
			const block = BLOCK_START_RE.exec(line.text);
			if (block) {
				blockEnd = new RegExp(`^[ \\t]*#\\+end_${escapeRegExp(block[1]!)}\\b`, 'i');
				continue;
			}
			const kw = KEYWORD_RE.exec(line.text);
			if (kw && !fileKeywords.has(kw[1]!.toUpperCase()))
				fileKeywords.set(kw[1]!.toUpperCase(), kw[2]!);
		}
	}

	// File-level property drawer: first non-blank, non-comment content.
	let i = 0;
	while (
		i < lines.length &&
		(lines[i]!.text.trim() === '' || /^[ \t]*#(?:[ \t]|$)/.test(lines[i]!.text))
	)
		i += 1;
	const readDrawer = (start: number): { props: Record<string, string>; end: number } | null => {
		if (!lines[start] || !DRAWER_START_RE.test(lines[start]!.text)) return null;
		const props: Record<string, string> = {};
		for (let j = start + 1; j < lines.length; j += 1) {
			const text = lines[j]!.text;
			if (DRAWER_END_RE.test(text)) return { props, end: j + 1 };
			if (HEADLINE_RE.test(text)) return null;
			const m = PROPERTY_RE.exec(text);
			if (!m) continue;
			const key = m[1]!.toUpperCase();
			const value = m[2] ?? '';
			if (key.endsWith('+')) {
				const base = key.slice(0, -1);
				props[base] = props[base] ? `${props[base]} ${value}` : value;
			} else if (!(key in props)) props[key] = value;
		}
		return null;
	};
	const fileDrawer = readDrawer(i);
	const fileProps = fileDrawer?.props ?? {};

	const filetags = parseTagList(fileKeywords.get('FILETAGS'));
	const title = fileKeywords.get('TITLE')?.trim() || basename(path);
	const excluded = truthy(fileProps['ROAM_EXCLUDE']) || truthy(fileKeywords.get('ROAM_EXCLUDE'));
	const fileId = !excluded && fileProps['ID'] ? fileProps['ID'].trim() : null;

	const nodes: RoamNode[] = [];
	const links: RoamLink[] = [];
	const headlines: HeadlineEntry[] = [];
	const text: string[] = [title];

	if (fileId) {
		nodes.push({
			id: fileId,
			file: path,
			level: 0,
			pos: 0,
			title,
			olp: [],
			tags: filetags,
			aliases: splitPropertyValues(fileProps['ROAM_ALIASES']),
			refs: parseRefs(fileProps['ROAM_REFS']),
			todo: null,
			priority: null,
			scheduled: null,
			deadline: null,
			properties: fileProps,
		});
	}

	// Outline stack: one frame per open headline.
	const stack: { level: number; title: string; tags: string[]; ownerId: string | null }[] = [];
	const owner = () => stack.at(-1)?.ownerId ?? fileId;
	const inheritedTags = () => stack.at(-1)?.tags ?? filetags;
	const olp = () => stack.map((f) => f.title);

	let blockEnd: RegExp | null = null;
	// Lines before and inside the file drawer carry nothing else to index.
	const start = fileDrawer ? fileDrawer.end : 0;

	const contextFor = (index: number): string => {
		const line = lines[index]!;
		if (HEADLINE_RE.test(line.text)) return line.text.trim();
		// Walk back to the start of the paragraph or list item.
		let from = index;
		while (from > 0) {
			const cur = lines[from]!.text;
			if (LIST_ITEM_RE.test(cur)) break;
			const prev = lines[from - 1]!.text;
			if (
				prev.trim() === '' ||
				HEADLINE_RE.test(prev) ||
				ANY_DRAWER_RE.test(prev) ||
				KEYWORD_RE.test(prev) ||
				BLOCK_START_RE.test(prev)
			)
				break;
			if (
				LIST_ITEM_RE.test(prev) &&
				!LIST_ITEM_RE.test(cur) &&
				line.text.search(/\S/) > prev.search(/\S/)
			) {
				from -= 1;
				break;
			}
			from -= 1;
		}
		let to = index;
		while (to + 1 < lines.length) {
			const next = lines[to + 1]!.text;
			if (
				next.trim() === '' ||
				HEADLINE_RE.test(next) ||
				LIST_ITEM_RE.test(next) ||
				/^[ \t]*#\+/.test(next) ||
				/^[ \t]*\|/.test(next) ||
				ANY_DRAWER_RE.test(next)
			)
				break;
			to += 1;
		}
		let raw = source.slice(lines[from]!.from, lines[to]!.to).trim();
		if (/^[ \t]*\|/.test(line.text)) raw = line.text.trim();
		return raw.length > MAX_CONTEXT ? `${raw.slice(0, MAX_CONTEXT)}…` : raw;
	};

	for (let n = start; n < lines.length; n += 1) {
		const line = lines[n]!;
		const t = line.text;

		if (blockEnd) {
			if (blockEnd.test(t)) blockEnd = null;
			else text.push(t);
			continue;
		}

		const h = HEADLINE_RE.exec(t);
		if (h) {
			const level = h[1]!.length;
			let rest = h[2]!;
			let todo: string | null = null;
			let priority: string | null = null;
			const kw = kwRe?.exec(rest);
			if (kw) {
				todo = kw[1]!;
				rest = rest.slice(kw[0].length);
			}
			const pr = /^\[#([A-Z0-9]+)\][ \t]*/.exec(rest);
			if (pr) {
				priority = pr[1]!;
				rest = rest.slice(pr[0].length);
			}
			rest = rest.replace(/^COMMENT(?=[ \t]|$)[ \t]*/, '');
			let ownTags: string[] = [];
			const tm = TAGS_RE.exec(rest);
			if (tm) {
				ownTags = tm[1]!.split(':').filter((x) => x);
				rest = rest.slice(0, tm.index);
			}
			const htitle = roamTitle(rest);

			// Planning on the next line, then a property drawer.
			let k = n + 1;
			let planning: Record<'SCHEDULED' | 'DEADLINE' | 'CLOSED', OrgTimestamp | null> = {
				SCHEDULED: null,
				DEADLINE: null,
				CLOSED: null,
			};
			if (lines[k] && PLANNING_RE.test(lines[k]!.text)) {
				const pt = lines[k]!.text;
				PLANNING_ENTRY_RE.lastIndex = 0;
				for (let m = PLANNING_ENTRY_RE.exec(pt); m; m = PLANNING_ENTRY_RE.exec(pt)) {
					const read = readTimestamp(pt, m.index + m[0].length);
					if (read) planning[m[1] as 'SCHEDULED'] = read.timestamp;
				}
				k += 1;
			} else planning = { SCHEDULED: null, DEADLINE: null, CLOSED: null };
			const drawer = readDrawer(k);
			const props = drawer?.props ?? {};

			while (stack.length && stack.at(-1)!.level >= level) stack.pop();
			const tags = [...new Set([...inheritedTags(), ...ownTags])];
			const id =
				!excluded && props['ID'] && !truthy(props['ROAM_EXCLUDE']) ? props['ID'].trim() : null;
			const parentOlp = olp();
			const parentOwner = owner();

			if (id) {
				nodes.push({
					id,
					file: path,
					level,
					pos: line.from,
					title: htitle,
					olp: parentOlp,
					tags,
					aliases: splitPropertyValues(props['ROAM_ALIASES']),
					refs: parseRefs(props['ROAM_REFS']),
					todo,
					priority,
					scheduled: planning.SCHEDULED,
					deadline: planning.DEADLINE,
					properties: props,
				});
			}
			headlines.push({
				pos: line.from,
				level,
				title: htitle,
				todo,
				priority,
				tags,
				scheduled: planning.SCHEDULED,
				deadline: planning.DEADLINE,
				closed: planning.CLOSED,
				id,
				ownerId: id ?? parentOwner,
				olp: parentOlp,
			});
			stack.push({ level, title: htitle, tags, ownerId: id ?? parentOwner });
			text.push(htitle);
			collectLinks(n);
			n = drawer ? drawer.end - 1 : k - 1;
			continue;
		}

		const block = BLOCK_START_RE.exec(t);
		if (block) {
			blockEnd = new RegExp(`^[ \\t]*#\\+end_${escapeRegExp(block[1]!)}\\b`, 'i');
			// Quote, verse, center and special blocks contain ordinary markup.
			if (!/^(src|example|export|comment)$/i.test(block[1]!)) blockEnd = null;
			continue;
		}
		if (/^[ \t]*#\+end_/i.test(t)) continue;
		if (KEYWORD_RE.test(t) || /^[ \t]*#(?:[ \t]|$)/.test(t) || /^[ \t]*:(?:[ \t]|$)/.test(t))
			continue;
		// Drawer markers carry nothing; links inside drawers (LOGBOOK notes) still count.
		if (ANY_DRAWER_RE.test(t)) continue;
		if (t.trim() === '') {
			continue;
		}
		text.push(
			inlinePlain(
				t.replace(/^[ \t]*(?:[-+]|\d+[.)])[ \t]+(?:\[[ xX-]\][ \t]+)?/, '').replace(/^\||\|$/g, ''),
			).trim(),
		);
		collectLinks(n);
	}

	/**
	 * Record every bracket link starting on a line (outside inline verbatim
	 * and code). A description may wrap onto following lines of the same
	 * paragraph — what `fill-paragraph` produces — so the search window
	 * extends over them, and only matches starting on this line count.
	 */
	function collectLinks(index: number) {
		const line = lines[index]!;
		let last = index;
		if (!HEADLINE_RE.test(line.text) && /\[\[(?:(?!\]\]).)*$/.test(line.text)) {
			while (last < index + 3 && last + 1 < lines.length) {
				const next = lines[last + 1]!.text;
				if (
					next.trim() === '' ||
					HEADLINE_RE.test(next) ||
					/^[ \t]*#\+/.test(next) ||
					ANY_DRAWER_RE.test(next)
				)
					break;
				last += 1;
				if (next.includes(']]')) break;
			}
		}
		const window = last === index ? line.text : source.slice(line.from, lines[last]!.to);
		const masked = window.split('\n').map(maskVerbatim).join('\n');
		const base = line.from;
		LINK_RE.lastIndex = 0;
		const ownerId = owner();
		if (!ownerId) return;
		for (let m = LINK_RE.exec(masked); m; m = LINK_RE.exec(masked)) {
			if (m.index >= line.text.length) break;
			const target = m[1]!.replace(/\\(.)/g, '$1');
			const colon = /^([a-zA-Z][\w+.-]*):(.*)$/s.exec(target);
			const type = colon ? colon[1]!.toLowerCase() : 'fuzzy';
			const dest = colon ? colon[2]! : target;
			links.push({
				source: ownerId,
				dest: type === 'file' ? dest.replace(/::.*$/, '') : dest,
				type,
				pos: base + m.index,
				end: base + m.index + m[0].length,
				description: m[2] !== undefined ? inlinePlain(m[2]) : null,
				context: contextFor(index),
			});
		}
	}

	return {
		path,
		title,
		excluded,
		filetags,
		keywords,
		nodes,
		links,
		headlines,
		text: text.filter((s) => s).join('\n'),
	};
}
