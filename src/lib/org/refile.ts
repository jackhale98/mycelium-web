/// Moving subtrees: refile (`org-refile`) and archive (`org-archive-subtree`).
///
/// - A subtree is its heading through the end of its subtree, trailing blank
///   lines included (`org-end-of-subtree t t`).
/// - Pasting shifts every heading by the same amount so the top lands at the
///   new level (`org-paste-subtree`), and the text always ends with a newline.
/// - Refile makes it the last child of the target heading (target level + 1;
///   `org-reverse-note-order` is nil), or a top-level tree at the end of a file.
/// - Archive finds the location (`ARCHIVE` property, inherited; `#+ARCHIVE:`;
///   default `%s_archive::`), appends the tree there (under the location's
///   heading, created if missing, after a blank line), adds the
///   `ARCHIVE_TIME/FILE/OLPATH/CATEGORY/TODO/ITAGS` properties (empty ones
///   left out), keeps the TODO state (`org-archive-mark-done` is nil), cuts
///   the original, and recounts the parent's statistics cookie.

import { clockStamp, type ClockTime } from './clock';
import { headlineLevel, owningHeadline, setHeadlineTags, subtreeEnd } from './headline';
import { getFileKeyword } from './keywords';
import { getProperties, setProperty } from './properties';
import { parentHeading, updateTodoCookies } from './statistics';
import { applyChanges, splitLines, type Change } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

export interface Subtree {
	from: number;
	to: number;
	text: string;
	level: number;
}

/** The subtree at `offset` (its heading through its end, trailing blank lines included). */
export function subtreeAt(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Subtree | null {
	const lines = splitLines(source);
	const h = owningHeadline(source, offset, config, lines);
	if (!h) return null;
	const to = subtreeEnd(lines, h);
	return { from: h.line.from, to, text: source.slice(h.line.from, to), level: h.level };
}

/** Shift every heading in a subtree's text by `delta` levels (never above level 1). */
export function shiftLevels(text: string, delta: number): string {
	if (delta === 0) return text;
	let inBlock = false;
	return text
		.split(/(?<=\n)/)
		.map((line) => {
			if (inBlock) {
				if (/^[ \t]*#\+end_/i.test(line)) inBlock = false;
				return line;
			}
			if (/^[ \t]*#\+begin_/i.test(line)) {
				inBlock = true;
				return line;
			}
			const level = headlineLevel(line);
			if (!level) return line;
			return '*'.repeat(Math.max(1, level + delta)) + line.slice(level);
		})
		.join('');
}

const eolOf = (source: string) => (source.includes('\r\n') ? '\r\n' : '\n');

/** Text ready to insert at `at` in `source`: shifted to `level`, starting on its own line, ending with a newline. */
function pasteText(source: string, at: number, tree: Subtree, level: number): string {
	const eol = eolOf(source);
	let text = shiftLevels(tree.text, level - tree.level).replace(/[ \t\r\n]*$/, '') + eol;
	if (at > 0 && source[at - 1] !== '\n') text = eol + text;
	return text;
}

/**
 * Where a refiled tree goes in the target file: the end of the target
 * heading's subtree, or the end of the file (`targetHeading` null).
 */
function refilePoint(
	target: string,
	targetHeading: number | null,
	config: KeywordConfig,
): { at: number; level: number } | null {
	if (targetHeading === null) return { at: target.length, level: 1 };
	const lines = splitLines(target);
	const h = owningHeadline(target, targetHeading, config, lines);
	if (!h) return null;
	return { at: subtreeEnd(lines, h), level: h.level + 1 };
}

/** Refile within one file. `null` when the target is inside the tree itself. */
export function refileWithin(
	source: string,
	offset: number,
	targetHeading: number | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] | null {
	const tree = subtreeAt(source, offset, config);
	const point = tree && refilePoint(source, targetHeading, config);
	if (!tree || !point) return null;
	if (targetHeading !== null && targetHeading >= tree.from && targetHeading < tree.to) return null;
	if (point.at > tree.from && point.at < tree.to) return null;
	return [
		{ from: point.at, to: point.at, insert: pasteText(source, point.at, tree, point.level) },
		{ from: tree.from, to: tree.to, insert: '' },
	];
}

/** Refile into another file: the changes for each side. */
export function refileAcross(
	source: string,
	offset: number,
	target: string,
	targetHeading: number | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	targetConfig: KeywordConfig = config,
): { source: Change[]; target: Change[] } | null {
	const tree = subtreeAt(source, offset, config);
	const point = tree && refilePoint(target, targetHeading, targetConfig);
	if (!tree || !point) return null;
	return {
		source: [{ from: tree.from, to: tree.to, insert: '' }],
		target: [
			{ from: point.at, to: point.at, insert: pasteText(target, point.at, tree, point.level) },
		],
	};
}

// ------------------------------------------------------------------ archive

/** `org-archive-location`'s default. */
export const ARCHIVE_LOCATION = '%s_archive::';

/**
 * Where the entry at `offset` archives to: a vault path (`null`: this file)
 * and a heading (`null`: top level at the end of the file). The `ARCHIVE`
 * property (inherited, file-level drawer included) beats `#+ARCHIVE:`.
 */
export function archiveLocation(
	source: string,
	offset: number,
	filePath: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): { file: string | null; heading: string | null } {
	const lines = splitLines(source);
	let location: string | null = null;
	let h = owningHeadline(source, offset, config, lines);
	while (h && location === null) {
		location = getProperties(source, h.line.from, config)['ARCHIVE'] ?? null;
		const up = parentHeading(source, h.line.from, config);
		h = up === null ? null : owningHeadline(source, up, config, lines);
	}
	location ??= getProperties(source, null, config)['ARCHIVE'] ?? null;
	location ??= getFileKeyword(source, 'ARCHIVE');
	location ??= ARCHIVE_LOCATION;
	const at = location.indexOf('::');
	const name = filePath.split('/').pop()!;
	const fileFmt = (at === -1 ? location : location.slice(0, at)).trim();
	const headingFmt = (at === -1 ? '' : location.slice(at + 2)).trim();
	let file: string | null = null;
	if (fileFmt) {
		const f = fileFmt.replaceAll('%s', name);
		const dir = filePath.split('/').slice(0, -1);
		const parts = f.startsWith('/') || f.startsWith('~') ? f.split('/').slice(-1) : f.split('/');
		for (const part of parts) {
			if (part === '..') dir.pop();
			else if (part && part !== '.') dir.push(part);
		}
		file = dir.join('/');
		if (file === filePath) file = null;
	}
	return { file, heading: headingFmt ? headingFmt.replaceAll('%s', name) : null };
}

export interface ArchiveContext {
	/** When archiving (`ARCHIVE_TIME`). */
	now: ClockTime;
	/** The source file as recorded in `ARCHIVE_FILE`. */
	file: string;
	/** `ARCHIVE_CATEGORY` (org-get-category). */
	category: string;
	/** Tags inherited from ancestors and `#+FILETAGS` (`ARCHIVE_ITAGS`). */
	inheritedTags: string[];
}

/** Add the context properties to the tree's top heading (`org-archive-save-context-info`). */
function withContext(
	text: string,
	tree: Subtree,
	olpath: string,
	todo: string | null,
	ctx: ArchiveContext,
	infile: boolean,
	config: KeywordConfig,
): string {
	let out = text;
	// Inherited tags join the heading when archiving within the same file ('infile).
	if (infile && ctx.inheritedTags.length) {
		const h = owningHeadline(out, 0, config);
		const own = h?.tags?.values ?? [];
		const all = [...ctx.inheritedTags.filter((t) => !own.includes(t)), ...own];
		out = applyChanges(out, setHeadlineTags(out, 0, all, config));
	}
	const stamp = clockStamp(ctx.now).slice(1, -1);
	const props: [string, string][] = [
		['ARCHIVE_TIME', stamp],
		['ARCHIVE_FILE', ctx.file],
		['ARCHIVE_OLPATH', olpath],
		['ARCHIVE_CATEGORY', ctx.category],
		['ARCHIVE_TODO', todo ?? ''],
		['ARCHIVE_ITAGS', ctx.inheritedTags.join(' ')],
	];
	for (const [key, value] of props)
		if (value.trim()) out = applyChanges(out, setProperty(out, 0, key, value, config));
	void tree;
	return out;
}

/** Where to paste in an archive file's text, after making sure the heading exists. */
function archivePoint(
	text: string,
	heading: string | null,
): { text: string; at: number; level: number; editFrom: number } {
	const eol = eolOf(text);
	if (!heading) {
		// org-archive-subtree: go to the end of the file and insert one newline.
		const body = text + eol;
		return { text: body, at: body.length, level: 0, editFrom: text.length };
	}
	const level = /^\*+/.exec(heading)?.[0].length ?? 0;
	const re = new RegExp(
		`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[ \\t]+:(?:[\\p{L}\\p{N}_@#%]+:)+)?[ \\t]*$`,
		'mu',
	);
	let body = text;
	let m = re.exec(body);
	if (!m) {
		body = body + (body.length && !body.endsWith('\n') ? eol : '') + eol + heading + eol;
		m = re.exec(body)!;
	}
	// The end of the heading's subtree, then exactly one blank line before the paste.
	const lines = splitLines(body);
	const start = lines.findIndex((l) => l.from === m!.index);
	let end = body.length;
	for (let i = start + 1; i < lines.length; i += 1) {
		const l = headlineLevel(lines[i]!.text);
		if (l > 0 && l <= level) {
			end = lines[i]!.from;
			break;
		}
	}
	let back = end;
	while (back > 0 && /[ \t\r\n]/.test(body[back - 1]!)) back -= 1;
	body = body.slice(0, back) + eol + eol + body.slice(end);
	// editFrom: where the edits start, in the original text's coordinates.
	return {
		text: body,
		at: back + eol.length * 2,
		level: level + 1,
		editFrom: Math.min(back, text.length),
	};
}

export interface ArchiveResult {
	/** Changes to the source file (the tree cut, the parent's cookie recounted). */
	source: Change[];
	/** The archive file (`null`: the same file, and `source` holds everything). */
	archivePath: string | null;
	/** The archive file's new text (for another file). */
	archiveText: string | null;
}

/**
 * Archive the subtree at `offset`. `archive` is the archive file's current
 * text (`null` if it doesn't exist yet); ignored for same-file locations.
 */
export function archiveSubtree(
	source: string,
	offset: number,
	filePath: string,
	ctx: ArchiveContext,
	archive: string | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): ArchiveResult | null {
	const tree = subtreeAt(source, offset, config);
	if (!tree) return null;
	const lines = splitLines(source);
	const h = owningHeadline(source, offset, config, lines)!;
	const olp: string[] = [];
	for (
		let up = parentHeading(source, h.line.from, config);
		up !== null;
		up = parentHeading(source, up, config)
	)
		olp.unshift(owningHeadline(source, up, config, lines)!.title.value);
	const location = archiveLocation(source, offset, filePath, config);
	const infile = location.file === null;
	const eol = eolOf(source);
	// The tree as it will be pasted: context added, then levels set by the location.
	const ownText = tree.text.replace(/[ \t\r\n]*$/, '') + eol;
	const text = withContext(
		ownText,
		tree,
		olp.join('/'),
		h.keyword?.value ?? null,
		ctx,
		infile,
		config,
	);

	if (infile) {
		// As org-archive-subtree: make room and paste first, then cut the original
		// (with its trailing blank lines), then recount the old parent's cookie.
		const point = archivePoint(source, location.heading);
		const level = point.level || tree.level;
		const pasted = shiftLevels(text, level - tree.level);
		const placed = point.text.slice(0, point.at) + pasted + point.text.slice(point.at);
		// Edits land after the archive heading's subtree: before the tree they shift it.
		const shift = point.editFrom <= tree.from ? placed.length - source.length : 0;
		const cut = subtreeAt(placed, tree.from + shift, config)!;
		const parent = parentHeading(placed, cut.from, config);
		let rest = placed.slice(0, cut.from) + placed.slice(cut.to);
		if (parent !== null) rest = applyChanges(rest, updateTodoCookies(rest, parent, config));
		return {
			source: [{ from: 0, to: source.length, insert: rest }],
			archivePath: null,
			archiveText: null,
		};
	}

	const header = archive === null ? `${eol}Archived entries from file ${ctx.file}${eol}${eol}` : '';
	const point = archivePoint((archive ?? '') + header, location.heading);
	const level = point.level || tree.level;
	const pasted = shiftLevels(text, level - tree.level);
	const archiveText = point.text.slice(0, point.at) + pasted + point.text.slice(point.at);
	const parent = parentHeading(source, tree.from, config);
	let rest = source.slice(0, tree.from) + source.slice(tree.to);
	if (parent !== null) rest = applyChanges(rest, updateTodoCookies(rest, parent, config));
	return {
		source: [{ from: 0, to: source.length, insert: rest }],
		archivePath: location.file,
		archiveText,
	};
}
