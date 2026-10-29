/// Work sessions (time blocks): stretches of a task's work planned on the
/// calendar, written as active timestamps on lines of their own in the entry,
/// after its planning line and drawers:
///
///   * TODO Write the report
///   SCHEDULED: <2026-11-02 Mon>
///   :PROPERTIES:
///   :Effort:   12:00
///   :END:
///   <2026-11-02 Mon 09:00-12:00>
///   <2026-11-03 Tue 13:00-17:00>
///
/// Org reads each as an appointment, so its agenda shows every session on its
/// day; SCHEDULED stays the day the work starts and Effort the whole
/// estimate. Timestamps inside sentences are left alone: they're
/// appointments someone wrote, not sessions.

import { headlineLevel, owningHeadline } from './headline';
import { splitLines, type Change, type Line } from './text';
import { readTimestamp } from './timestamp';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig, type OrgTimestamp } from './types';

export interface Session {
	/** Where the timestamp is in the source (to move or remove it). */
	from: number;
	to: number;
	timestamp: OrgTimestamp;
}

const PLANNING = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const DRAWER_START = /^[ \t]*:[\w-]+:[ \t]*$/;
const DRAWER_END = /^[ \t]*:END:[ \t]*$/i;
const BLOCK_START = /^[ \t]*#\+begin_(\w+)/i;

/** The entry's own lines (up to its first child heading), after its headline. */
function entryLines(source: string, offset: number, config: KeywordConfig) {
	const lines = splitLines(source);
	const h = owningHeadline(source, offset, config, lines);
	if (!h) return null;
	const own: Line[] = [];
	for (let i = h.line.index + 1; i < lines.length; i += 1) {
		if (headlineLevel(lines[i]!.text)) break;
		own.push(lines[i]!);
	}
	return { headline: h, own };
}

/** A line that's nothing but one active timestamp. */
function sessionOn(line: Line): Session | null {
	const lead = line.text.length - line.text.trimStart().length;
	const read = readTimestamp(line.text, lead);
	if (!read?.timestamp.active || line.text.slice(read.to).trim()) return null;
	return { from: line.from + lead, to: line.from + read.to, timestamp: read.timestamp };
}

/** The entry's sessions, in the order they're written. */
export function sessionsOf(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Session[] {
	const entry = entryLines(source, offset, config);
	if (!entry) return [];
	const out: Session[] = [];
	let drawer = false;
	let block: string | null = null;
	for (const line of entry.own) {
		const text = line.text;
		if (block) {
			if (new RegExp(`^[ \\t]*#\\+end_${block}\\b`, 'i').test(text)) block = null;
			continue;
		}
		if (drawer) {
			if (DRAWER_END.test(text)) drawer = false;
			continue;
		}
		if (DRAWER_START.test(text)) {
			drawer = true;
			continue;
		}
		const b = BLOCK_START.exec(text);
		if (b) {
			block = b[1]!;
			continue;
		}
		if (PLANNING.test(text)) continue;
		const s = sessionOn(line);
		if (s) out.push(s);
	}
	return out;
}

/**
 * Add a session: after the entry's last session, or else after its planning
 * line and the drawers that follow it.
 */
export function addSession(
	source: string,
	offset: number,
	timestamp: OrgTimestamp,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const entry = entryLines(source, offset, config);
	if (!entry) return [];
	const eol = entry.headline.line.eol || '\n';
	const existing = sessionsOf(source, offset, config);
	let at: Line = entry.headline.line;
	if (existing.length) {
		const last = existing[existing.length - 1]!;
		at = entry.own.find((l) => l.from <= last.from && last.from < l.end) ?? at;
	} else {
		let drawer = false;
		for (const line of entry.own) {
			if (drawer) {
				at = line;
				if (DRAWER_END.test(line.text)) drawer = false;
				continue;
			}
			if (PLANNING.test(line.text)) at = line;
			else if (DRAWER_START.test(line.text)) {
				at = line;
				drawer = true;
			} else break;
		}
	}
	// A file whose last line has no newline gets one first.
	const lead = at.eol ? '' : eol;
	return [{ from: at.end, to: at.end, insert: `${lead}${timestamp.raw}${at.eol ? eol : ''}` }];
}

/** Rewrite a session's timestamp (its day, time or length). */
export function setSession(
	session: Pick<Session, 'from' | 'to'>,
	timestamp: OrgTimestamp,
): Change[] {
	return [{ from: session.from, to: session.to, insert: timestamp.raw }];
}

/** Remove a session, and its line. */
export function removeSession(source: string, session: Pick<Session, 'from' | 'to'>): Change[] {
	const start = source.lastIndexOf('\n', session.from - 1) + 1;
	const nl = source.indexOf('\n', session.to);
	return [{ from: start, to: nl === -1 ? source.length : nl + 1, insert: '' }];
}
