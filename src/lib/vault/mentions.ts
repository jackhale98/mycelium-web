/// Link suggestions: titles and aliases of other notes written as plain text
/// in a note, ready to become `[[id:ID][text]]` links. The reverse of
/// org-roam's unlinked references (mentions of one note everywhere): here,
/// mentions of every note in one place. Matching follows the same rules —
/// whole words, any case, never inside `[…]` — and also leaves alone what
/// isn't prose: headlines, keyword and comment lines, drawers, planning
/// lines, source/example/export/comment blocks, timestamps, `=verbatim=`,
/// `~code~` and plain URLs. Where titles overlap the longest wins ("Forest
/// ecology" over "Forest"); a trailing "s" still matches ("networks" for
/// "network").

import type { Change, RoamNode } from '$lib/org';

export interface Mention {
	/** Where the words are in the source. */
	from: number;
	to: number;
	/** The words as written (they become the link's description). */
	text: string;
	/** The note they name. */
	id: string;
	title: string;
}

export type MentionTarget = Pick<RoamNode, 'id' | 'file' | 'title' | 'aliases' | 'level'>;

/** A step in the title tree: the words after this one, and titles that end here. */
interface Step {
	next: Map<string, Step>;
	/** Titles ending at this word, by what follows the word in the title ("" mostly; "++" for "C++"). */
	ends: Map<string, MentionTarget>;
}

export interface Matcher {
	root: Step;
	/** How many titles and aliases can be suggested. */
	size: number;
}

/** The edits that turn mentions into links, keeping their words: `[[id:ID][words]]`. */
export function linkMentionChanges(
	mentions: readonly Pick<Mention, 'from' | 'to' | 'text' | 'id'>[],
): Change[] {
	return mentions.map((m) => ({ from: m.from, to: m.to, insert: `[[id:${m.id}][${m.text}]]` }));
}

/** Titles shorter than this (or without a letter) are too common to suggest. */
export const MIN_TERM = 3;

const WORD = /[\p{L}\p{N}_]+/gu;
const WORD_CHAR = /[\p{L}\p{N}_]/u;
/** What's between two words, as the tree keys it: any run of spaces or tabs is one space. */
const gap = (s: string) => (/^[ \t]+$/.test(s) ? ' ' : s);
const step = (): Step => ({ next: new Map(), ends: new Map() });

/**
 * Every title and alias in the vault as a tree of words (build once, reuse):
 * finding mentions then reads each word of a note once, however many notes
 * there are.
 */
export function mentionMatcher(targets: Iterable<MentionTarget>): Matcher {
	const root = step();
	let size = 0;
	for (const t of targets) {
		for (const name of [t.title, ...t.aliases]) {
			const term = name.toLowerCase().trim();
			if (term.length < MIN_TERM || !/\p{L}/u.test(term)) continue;
			const words = [...term.matchAll(WORD)];
			// Titles starting with punctuation can't be told from the text around them.
			if (!words.length || words[0]!.index !== 0) continue;
			let at = root;
			words.forEach((w, n) => {
				const key =
					n === 0
						? w[0]
						: `${gap(term.slice(words[n - 1]!.index + words[n - 1]![0].length, w.index))}\u0000${w[0]}`;
				let child = at.next.get(key);
				if (!child) at.next.set(key, (child = step()));
				at = child;
			});
			const last = words[words.length - 1]!;
			const tail = term.slice(last.index + last[0].length);
			const had = at.ends.get(tail);
			// The same words for two notes: a file's own note first, then the first found.
			if (!had || (had.level > 0 && t.level === 0)) {
				if (!had) size += 1;
				at.ends.set(tail, t);
			}
		}
	}
	return { root, size };
}

const HEADLINE = /^\*+\s/;
const LINE_SKIP = [
	/^\s*#\+/, // keyword (#+title, #+begin_…)
	/^\s*#(?:\s|$)/, // comment
	/^\s*:(?:\s|$)/, // fixed-width
	/^\s*(?:SCHEDULED|DEADLINE|CLOSED):/,
];
const DRAWER_START = /^\s*:[\w-]+:\s*$/;
const DRAWER_END = /^\s*:END:\s*$/i;
const BLOCK_START = /^\s*#\+begin_(\w+)/i;
/** Blocks whose contents aren't prose (quotes, verses and centred text are). */
const CODE_BLOCKS = new Set(['src', 'example', 'export', 'comment']);
const INLINE_SKIP = [
	/<\d{4}-\d\d-\d\d[^>\n]*>/g, // active timestamp
	/\[\d{4}-\d\d-\d\d[^\]\n]*\]/g, // inactive (also inside brackets, below)
	/(^|[\s({'"-])([=~])([^\s](?:[^\n]*?[^\s])?)\2(?=[\s\-.,:;!?'")}[]|$)/gm, // =verbatim= ~code~
	/\b[a-z][\w+.-]*:\/\/\S+/gi, // URL
];

/**
 * Ranges of the source that aren't prose, in order, merged. Headlines count
 * as not prose unless `headlines` is false (unlinked references keep them).
 */
export function skippedRanges(
	source: string,
	options: { headlines?: boolean } = {},
): [number, number][] {
	const skipHeadlines = options.headlines ?? true;
	const out: [number, number][] = [];
	// Whole lines.
	let offset = 0;
	let block: string | null = null;
	let drawer = false;
	for (const raw of source.split('\n')) {
		const start = offset;
		const end = offset + raw.length;
		offset = end + 1;
		const line = raw.replace(/\r$/, '');
		if (block) {
			out.push([start, end]);
			if (new RegExp(`^\\s*#\\+end_${block}\\b`, 'i').test(line)) block = null;
			continue;
		}
		if (drawer) {
			out.push([start, end]);
			if (DRAWER_END.test(line)) drawer = false;
			continue;
		}
		const b = BLOCK_START.exec(line);
		if (b && CODE_BLOCKS.has(b[1]!.toLowerCase())) {
			block = b[1]!;
			out.push([start, end]);
			continue;
		}
		if (DRAWER_START.test(line) && !DRAWER_END.test(line)) {
			drawer = true;
			out.push([start, end]);
			continue;
		}
		if (LINE_SKIP.some((re) => re.test(line)) || (skipHeadlines && HEADLINE.test(line)))
			out.push([start, end]);
	}
	// Balanced brackets: links, checkboxes, cookies, footnotes (org-roam's rule).
	const stack: number[] = [];
	for (let i = 0; i < source.length; i += 1) {
		const c = source[i];
		if (c === '[') stack.push(i);
		else if (c === ']' && stack.length) {
			const from = stack.pop()!;
			if (!stack.length) out.push([from, i + 1]);
		} else if (c === '\n' && stack.length) stack.length = 0;
	}
	for (const re of INLINE_SKIP)
		for (const m of source.matchAll(re)) out.push([m.index, m.index + m[0].length]);
	// Sorted and merged, so a range's one neighbour says whether a place is skipped.
	out.sort((a, b) => a[0] - b[0]);
	const merged: [number, number][] = [];
	for (const r of out) {
		const last = merged[merged.length - 1];
		if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
		else merged.push([r[0], r[1]]);
	}
	return merged;
}

export interface MentionOptions {
	/** The file being read: its own notes are never suggested. */
	path: string;
	/** Only this part of the file (a heading note's subtree). */
	range?: [number, number];
	/** Notes the file already links to: not suggested again. */
	linked?: ReadonlySet<string>;
	/** Notes not to suggest at all. */
	ignore?: ReadonlySet<string>;
	/** Every mention of a note, not just its first (wiki style). */
	every?: boolean;
}

/** Mentions of other notes in `source`, in order. */
export function findMentions(source: string, matcher: Matcher, options: MentionOptions): Mention[] {
	const { root } = matcher;
	if (!root.next.size) return [];
	const [lo, hi] = options.range ?? [0, source.length];
	const lower = source.toLowerCase();
	const words: { word: string; from: number; to: number }[] = [];
	WORD.lastIndex = lo;
	for (let m = WORD.exec(lower); m && m.index < hi; m = WORD.exec(lower))
		words.push({ word: m[0], from: m.index, to: m.index + m[0].length });
	const skipped = skippedRanges(source);
	const isSkipped = (from: number, to: number) => {
		// The last range starting before `to` is the only one that can overlap.
		let a = 0;
		let b = skipped.length;
		while (a < b) {
			const mid = (a + b) >> 1;
			if (skipped[mid]![0] < to) a = mid + 1;
			else b = mid;
		}
		return a > 0 && skipped[a - 1]![1] > from;
	};
	/** A title's words end at word `j`: does what follows match (and end the word)? */
	const endAt = (at: Step, j: number, plural: boolean) => {
		let best: { to: number; target: MentionTarget } | null = null;
		const after = words[j]!.to;
		for (const [tail, target] of at.ends) {
			if (plural && tail) continue;
			const to = after + tail.length;
			if (tail && lower.slice(after, to) !== tail) continue;
			if (to < source.length && WORD_CHAR.test(source[to]!)) continue;
			if (!best || to > best.to) best = { to, target };
		}
		return best;
	};
	const seen = new Set<string>();
	const out: Mention[] = [];
	for (let i = 0; i < words.length;) {
		const from = words[i]!.from;
		// Follow the tree as far as the words go; the longest title that ends wins.
		let found: { to: number; next: number; target: MentionTarget } | null = null;
		let at: Step | undefined = root.next.get(words[i]!.word);
		let plural = words[i]!.word.endsWith('s')
			? root.next.get(words[i]!.word.slice(0, -1))
			: undefined;
		for (let j = i; ; j += 1) {
			if (plural) {
				const end = endAt(plural, j, true);
				if (end && end.to > (found?.to ?? -1)) found = { ...end, next: j + 1 };
			}
			if (!at) break;
			const end = endAt(at, j, false);
			if (end && end.to > (found?.to ?? -1)) found = { ...end, next: j + 1 };
			const nextWord = words[j + 1];
			if (!nextWord || nextWord.to > hi) break;
			const between = gap(lower.slice(words[j]!.to, nextWord.from));
			if (between.includes('\n')) break;
			const key = `${between}\u0000${nextWord.word}`;
			plural = nextWord.word.endsWith('s')
				? at.next.get(`${between}\u0000${nextWord.word.slice(0, -1)}`)
				: undefined;
			at = at.next.get(key);
		}
		if (!found || found.to > hi) {
			i += 1;
			continue;
		}
		i = found.next;
		const { target, to } = found;
		if (isSkipped(from, to)) continue;
		if (target.file === options.path) continue;
		if (options.linked?.has(target.id) || options.ignore?.has(target.id)) continue;
		if (!options.every) {
			if (seen.has(target.id)) continue;
			seen.add(target.id);
		}
		out.push({ from, to, text: source.slice(from, to), id: target.id, title: target.title });
	}
	return out;
}
