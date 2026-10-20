/// File keywords: `#+title:`, `#+filetags:`, `#+TODO:` and friends.

import { splitLines, type Change, type Line } from './text';
import type { KeywordConfig, Span } from './types';

const KEYWORD_RE = /^([ \t]*)#\+([A-Za-z][\w-]*):(?:([ \t]*)(.*?))?[ \t]*$/;
const BLOCK_START_RE = /^[ \t]*#\+begin_(\S+)/i;

export interface FileKeyword {
	/** Upper-cased key. */
	key: string;
	/** Key as written, so new lines can follow the file's casing. */
	written: string;
	value: string;
	line: Line;
	valueSpan: Span;
}

/** Every `#+KEY: value` line outside blocks, in source order. */
export function scanFileKeywords(
	source: string,
	lines: readonly Line[] = splitLines(source),
): FileKeyword[] {
	const out: FileKeyword[] = [];
	let blockEnd: RegExp | null = null;
	for (const line of lines) {
		if (blockEnd) {
			if (blockEnd.test(line.text)) blockEnd = null;
			continue;
		}
		const block = BLOCK_START_RE.exec(line.text);
		if (block) {
			blockEnd = new RegExp(`^[ \\t]*#\\+end_${block[1]!.replace(/[^\w-]/g, '')}\\b`, 'i');
			continue;
		}
		const m = KEYWORD_RE.exec(line.text);
		if (!m) continue;
		const value = m[4] ?? '';
		const from =
			m[3] !== undefined ? line.from + m[1]!.length + 2 + m[2]!.length + 1 + m[3].length : line.to;
		out.push({
			key: m[2]!.toUpperCase(),
			written: m[2]!,
			value,
			line,
			valueSpan: { from, to: from + value.length },
		});
	}
	return out;
}

export function getFileKeyword(source: string, key: string): string | null {
	const upper = key.toUpperCase();
	return scanFileKeywords(source).find((k) => k.key === upper)?.value ?? null;
}

/** Index of the line a new metadata keyword is inserted before. */
function metadataInsertLine(lines: readonly Line[]): number {
	let i = 0;
	while (
		i < lines.length &&
		(lines[i]!.text.trim() === '' || /^[ \t]*#(?:[ \t]|$)/.test(lines[i]!.text))
	)
		i += 1;
	if (lines[i] && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[i]!.text)) {
		while (i < lines.length && !/^[ \t]*:END:[ \t]*$/i.test(lines[i]!.text)) i += 1;
		i += 1;
	}
	while (
		i < lines.length &&
		KEYWORD_RE.test(lines[i]!.text) &&
		!BLOCK_START_RE.test(lines[i]!.text)
	)
		i += 1;
	return i;
}

/**
 * Set (or with `null` remove) a file keyword. Updates the first occurrence in
 * place; a new keyword joins the file's leading metadata block, written in the
 * same letter case the file already uses (`#+title` vs `#+TITLE`).
 */
export function setFileKeyword(source: string, key: string, value: string | null): Change[] {
	const lines = splitLines(source);
	const keywords = scanFileKeywords(source, lines);
	const upper = key.toUpperCase();
	const existing = keywords.find((k) => k.key === upper);
	const clean = value === null ? null : value.replace(/[\r\n]+/g, ' ').trim();

	if (existing) {
		if (clean === null) return [{ from: existing.line.from, to: existing.line.end, insert: '' }];
		if (clean === existing.value) return [];
		if (existing.valueSpan.from === existing.line.to) {
			return [{ from: existing.line.to, to: existing.line.to, insert: ` ${clean}` }];
		}
		return [{ from: existing.valueSpan.from, to: existing.valueSpan.to, insert: clean }];
	}
	if (clean === null) return [];

	const lower = keywords.length > 0 && keywords.every((k) => k.written === k.written.toLowerCase());
	const text = `#+${lower ? key.toLowerCase() : upper}: ${clean}`;
	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	const index = metadataInsertLine(lines);
	const at = lines[index]?.from ?? source.length;
	const needsLead = at === source.length && source.length > 0 && !source.endsWith('\n');
	return [{ from: at, to: at, insert: `${needsLead ? eol : ''}${text}${eol}` }];
}

// ---------------------------------------------------------------------------
// #+FILETAGS

/** Split a `#+filetags:` value in either `:a:b:` or `a b` form. */
export function parseTagList(value: string | null | undefined): string[] {
	return (value ?? '').split(/[:\s]+/).filter((t) => t.length > 0);
}

export function getFiletags(source: string): string[] {
	return parseTagList(getFileKeyword(source, 'FILETAGS'));
}

/** Write file tags in org's `:a:b:` form; an empty list removes the line. */
export function setFiletags(source: string, tags: readonly string[]): Change[] {
	const unique = [...new Set(tags.filter((t) => /^[\p{L}\p{N}_@#%]+$/u.test(t)))];
	return setFileKeyword(source, 'FILETAGS', unique.length > 0 ? `:${unique.join(':')}:` : null);
}

// ---------------------------------------------------------------------------
// Per-file TODO keyword sequences

/**
 * Keywords declared by `#+TODO:`, `#+SEQ_TODO:` or `#+TYP_TODO:` lines, or
 * `null` when the file declares none. Fast-access keys and logging markers
 * (`TODO(t)`, `DONE(d!)`) are stripped. A line without `|` treats its last
 * keyword as the done state, as org does.
 */
export function fileTodoKeywords(source: string): KeywordConfig | null {
	const todo: string[] = [];
	const done: string[] = [];
	const log: NonNullable<KeywordConfig['log']> = {};
	let found = false;
	for (const k of scanFileKeywords(source)) {
		if (k.key !== 'TODO' && k.key !== 'SEQ_TODO' && k.key !== 'TYP_TODO') continue;
		found = true;
		const words = k.value.split(/\s+/).filter((w) => w.length > 0);
		const bar = words.indexOf('|');
		const strip = (w: string) => {
			const m = /^(.*?)\(([^)]*)\)$/.exec(w);
			if (!m) return w;
			// `(t)`, `(d!)`, `(w@/!)`: fast key, then enter and leave logging markers.
			const marks = /^[^!@/]?([!@])?(?:\/([!@]))?$/.exec(m[2]!);
			if (marks && (marks[1] || marks[2])) log[m[1]!] = { enter: !!marks[1], leave: !!marks[2] };
			return m[1]!;
		};
		if (bar === -1) {
			const names = words.map(strip);
			if (names.length > 0) {
				todo.push(...names.slice(0, -1));
				done.push(names[names.length - 1]!);
			}
		} else {
			todo.push(...words.slice(0, bar).map(strip));
			done.push(...words.slice(bar + 1).map(strip));
		}
	}
	if (!found) return null;
	return Object.keys(log).length > 0
		? { todoKeywords: todo, doneKeywords: done, log }
		: { todoKeywords: todo, doneKeywords: done };
}
