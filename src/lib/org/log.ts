/// State-change logging: the `- State "DONE" from "TODO" [time]` notes org
/// writes, where it writes them, and which logging options a vault uses.

import { headlineLevel, type HeadlineScan } from './headline';
import { getFileKeyword } from './keywords';
import { findPlanning } from './planning';
import { findPropertyDrawer } from './properties';
import { headlineAt } from './headline';
import { splitLines, type Change, type Line } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig, type LogSettings } from './types';

/** Offset of the next heading of any level after `headline` (org's entry end). */
export function entryEnd(lines: readonly Line[], headline: HeadlineScan): number {
	for (let i = headline.line.index + 1; i < lines.length; i += 1) {
		if (headlineLevel(lines[i]!.text) > 0) return lines[i]!.from;
	}
	return lines.length > 0 ? lines[lines.length - 1]!.end : 0;
}

/**
 * A state note as `org-log-note-headings` formats it by default:
 * `State %-12s from %-12S %t`, with both states quoted.
 */
export function stateNote(state: string | null, previous: string | null, stamp: string): string {
	const q = (s: string | null) => (s ? `"${s}"` : '');
	return `State ${q(state).padEnd(12)} from ${q(previous).padEnd(12)} ${stamp}`;
}

/**
 * Insert a log note for the entry at `offset`, newest first, where org's
 * `org-log-beginning` puts it: after the planning line and property drawer,
 * or at the top of the log drawer (created if missing) when logging into one.
 */
export function addLogNote(
	source: string,
	offset: number,
	note: string,
	drawer: string | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const lines = splitLines(source);
	const h = headlineAt(source, offset, config, lines);
	if (!h) return [];
	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	const planning = findPlanning(lines, h);
	const props = findPropertyDrawer(source, h.line.from, config, lines);
	const meta = props ? props.end : (planning?.line ?? h.line);
	const indent = planning ? /^[ \t]*/.exec(planning.line.text)![0] : '';
	const item = `${indent}- ${note}`;
	const end = entryEnd(lines, h);

	if (drawer) {
		const re = new RegExp(`^[ \\t]*:${drawer.replace(/[^\w-]/g, '')}:[ \\t]*$`, 'i');
		for (let i = meta.index + 1; i < lines.length && lines[i]!.from < end; i += 1) {
			if (re.test(lines[i]!.text)) {
				const at = lines[i]!.end;
				return [{ from: at, to: at, insert: `${item}${lines[i]!.eol || eol}` }];
			}
		}
		const block = [`${indent}:${drawer}:`, item, `${indent}:END:`].join(eol);
		return meta.eol
			? [{ from: meta.end, to: meta.end, insert: `${block}${eol}` }]
			: [{ from: meta.end, to: meta.end, insert: `${eol}${block}` }];
	}
	return meta.eol
		? [{ from: meta.end, to: meta.end, insert: `${item}${eol}` }]
		: [{ from: meta.end, to: meta.end, insert: `${eol}${item}` }];
}

/** Logging options a file sets with `#+STARTUP:` (logdone, nologrepeat, logdrawer, …). */
export function startupLogSettings(source: string): Partial<LogSettings> {
	const startup = getFileKeyword(source, 'STARTUP');
	if (!startup) return {};
	const words = new Set(startup.toLowerCase().split(/\s+/));
	const out: Partial<LogSettings> = {};
	if (words.has('logdone') || words.has('lognotedone')) out.logDone = true;
	if (words.has('nologdone')) out.logDone = false;
	if (words.has('logrepeat') || words.has('lognoterepeat')) out.logRepeat = true;
	if (words.has('nologrepeat')) out.logRepeat = false;
	if (words.has('logdrawer')) out.logIntoDrawer = 'LOGBOOK';
	if (words.has('nologdrawer')) out.logIntoDrawer = null;
	return out;
}

/**
 * Infer the user's Emacs logging configuration from what their files contain,
 * since we cannot read their init file: `CLOSED:` stamps mean `org-log-done`
 * is on, state notes inside `:LOGBOOK:` mean `org-log-into-drawer` is on.
 * Repeat logging stays on (Emacs' default) unless repeating tasks exist and
 * none of them carry `LAST_REPEAT`.
 */
export function detectLogSettings(sources: Iterable<string>): LogSettings {
	let closed = false;
	let logbookNotes = false;
	let inlineNotes = false;
	let repeaters = false;
	let lastRepeat = false;
	for (const s of sources) {
		if (!closed && /^[ \t]*(?:\S.*[ \t])?CLOSED:[ \t]*\[/m.test(s)) closed = true;
		if (!logbookNotes && /^[ \t]*:LOGBOOK:[ \t]*\r?\n[ \t]*- State /im.test(s)) logbookNotes = true;
		if (
			!inlineNotes &&
			/^(?![ \t]*:LOGBOOK:).*\r?\n[ \t]*- State "/m.test(s.replace(/:LOGBOOK:[\s\S]*?:END:/gi, ''))
		)
			inlineNotes = true;
		if (!repeaters && /<\d{4}-\d{2}-\d{2}[^>\n]*\s\.?\+\+?\d+[hdwmy]/.test(s)) repeaters = true;
		if (!lastRepeat && /^[ \t]*:LAST_REPEAT:/m.test(s)) lastRepeat = true;
	}
	return {
		logDone: closed,
		logRepeat: !repeaters || lastRepeat || logbookNotes || inlineNotes,
		logIntoDrawer: logbookNotes && !inlineNotes ? 'LOGBOOK' : null,
		repeatToState: null,
	};
}
