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

// ---------------------------------------------------------------------------
// Editable keyword sequences (org-todo-keywords / #+TODO: lines)

/** One state in a sequence: `WAIT(w@/!)` is name WAIT, key w, note on enter, time on leave. */
export interface KeywordState {
	name: string;
	/** Fast-access key, e.g. `t` in `TODO(t)`. */
	key: string | null;
	/** Logging when entering the state: `!` timestamp, `@` note. */
	enter: '!' | '@' | null;
	/** Logging when leaving the state (`/!`, `/@`). */
	leave: '!' | '@' | null;
}

export interface KeywordSequence {
	todo: KeywordState[];
	done: KeywordState[];
}

/** A valid keyword name: no whitespace, parentheses or `|`. */
export function isValidKeyword(name: string): boolean {
	return /^[^\s()|]+$/u.test(name);
}

function parseState(word: string): KeywordState {
	const m = /^(.*?)\(([^)]*)\)$/.exec(word);
	if (!m) return { name: word, key: null, enter: null, leave: null };
	const spec = /^([^!@/])?([!@])?(?:\/([!@]))?$/.exec(m[2]!);
	return {
		name: m[1]!,
		key: spec?.[1] ?? null,
		enter: (spec?.[2] as '!' | '@' | undefined) ?? null,
		leave: (spec?.[3] as '!' | '@' | undefined) ?? null,
	};
}

/** Parse the value of a `#+TODO:` line (or one `org-todo-keywords` sequence). */
export function parseTodoLine(value: string): KeywordSequence {
	const words = value.split(/\s+/).filter(Boolean);
	const bar = words.indexOf('|');
	const states = (ws: string[]) => ws.map(parseState);
	if (bar === -1) {
		const all = states(words);
		return { todo: all.slice(0, -1), done: all.slice(-1) };
	}
	return { todo: states(words.slice(0, bar)), done: states(words.slice(bar + 1)) };
}

function formatState(s: KeywordState): string {
	const log = `${s.enter ?? ''}${s.leave ? `/${s.leave}` : ''}`;
	const spec = `${s.key ?? ''}${log}`;
	return spec ? `${s.name}(${spec})` : s.name;
}

/** The `#+TODO:` value for a sequence: `TODO(t) NEXT | DONE(d!)`. */
export function formatTodoLine(seq: KeywordSequence): string {
	return [...seq.todo.map(formatState), '|', ...seq.done.map(formatState)].join(' ');
}

/** Flatten sequences into the config the rest of the app reads. */
export function sequencesToConfig(sequences: readonly KeywordSequence[]): KeywordConfig {
	const todo: string[] = [];
	const done: string[] = [];
	const log: NonNullable<KeywordConfig['log']> = {};
	for (const seq of sequences) {
		for (const s of seq.todo) if (!todo.includes(s.name)) todo.push(s.name);
		for (const s of seq.done) if (!done.includes(s.name)) done.push(s.name);
		for (const s of [...seq.todo, ...seq.done])
			if (s.enter || s.leave) log[s.name] = { enter: !!s.enter, leave: !!s.leave };
	}
	const config: KeywordConfig = {
		todoKeywords: todo,
		doneKeywords: done,
		sequences: [...sequences],
	};
	if (Object.keys(log).length) config.log = log;
	return config;
}

/** The editable sequences behind a config (a single sequence when none were stored). */
export function configToSequences(config: KeywordConfig): KeywordSequence[] {
	if (config.sequences?.length)
		return config.sequences.map((s) => ({ todo: [...s.todo], done: [...s.done] }));
	const state = (name: string): KeywordState => {
		const log = config.log?.[name];
		return { name, key: null, enter: log?.enter ? '!' : null, leave: log?.leave ? '!' : null };
	};
	return [{ todo: config.todoKeywords.map(state), done: config.doneKeywords.map(state) }];
}
