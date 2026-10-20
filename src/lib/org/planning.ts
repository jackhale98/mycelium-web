/// Planning lines: `SCHEDULED: <…>`, `DEADLINE: <…>`, `CLOSED: […]`.
///
/// Org recognises exactly one planning line, directly after the headline and
/// before any property drawer. Everything here is bounded to that line, so
/// body text that merely mentions "DEADLINE:" is never rewritten.

import { headlineAt, type HeadlineScan } from './headline';
import { readTimestamp } from './timestamp';
import { splitLines, type Change, type Line } from './text';
import { DEFAULT_KEYWORD_CONFIG, PLANNING_ORDER, type KeywordConfig, type OrgTimestamp, type PlanningKind } from './types';

const PLANNING_KEYWORD_RE = /^(SCHEDULED|DEADLINE|CLOSED):[ \t]*/;

export interface PlanningEntry {
	kind: PlanningKind;
	timestamp: OrgTimestamp;
	/** Span of `KIND: <timestamp>`. */
	from: number;
	to: number;
	/** Span of the timestamp alone. */
	tsFrom: number;
	tsTo: number;
}

export interface PlanningLine {
	line: Line;
	entries: PlanningEntry[];
}

/** Parse a line as a planning line. Lines with anything but planning entries are not planning. */
export function parsePlanningLine(line: Line): PlanningLine | null {
	const text = line.text;
	let pos = /^[ \t]*/.exec(text)![0].length;
	if (pos === text.length) return null;
	const entries: PlanningEntry[] = [];
	while (pos < text.length) {
		const kw = PLANNING_KEYWORD_RE.exec(text.slice(pos));
		if (!kw) return null;
		const kind = kw[1] as PlanningKind;
		if (entries.some((e) => e.kind === kind)) return null;
		const tsStart = pos + kw[0].length;
		const read = readTimestamp(text, tsStart);
		if (!read) return null;
		entries.push({
			kind,
			timestamp: read.timestamp,
			from: line.from + pos,
			to: line.from + read.to,
			tsFrom: line.from + read.from,
			tsTo: line.from + read.to,
		});
		pos = read.to;
		while (pos < text.length && (text[pos] === ' ' || text[pos] === '\t')) pos += 1;
	}
	return { line, entries };
}

/** The planning line belonging to a headline, if it has one. */
export function findPlanning(lines: readonly Line[], headline: HeadlineScan): PlanningLine | null {
	const next = lines[headline.line.index + 1];
	return next ? parsePlanningLine(next) : null;
}

export type Planning = Record<PlanningKind, OrgTimestamp | null>;

export function getPlanning(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Planning {
	const result: Planning = { SCHEDULED: null, DEADLINE: null, CLOSED: null };
	const lines = splitLines(source);
	const h = headlineAt(source, offset, config, lines);
	if (!h) return result;
	for (const entry of findPlanning(lines, h)?.entries ?? []) result[entry.kind] = entry.timestamp;
	return result;
}

/**
 * Indentation for a new planning line: the file's existing convention if any
 * planning line is indented (`org-adapt-indentation`), otherwise none, which
 * is org's default since 9.5.
 */
function planningIndent(lines: readonly Line[], level: number): string {
	for (let i = 1; i < lines.length; i += 1) {
		if (!/^\*+[ \t]/.test(lines[i - 1]!.text)) continue;
		const planning = parsePlanningLine(lines[i]!);
		if (planning) {
			const indent = /^[ \t]*/.exec(lines[i]!.text)![0];
			return indent.length > 0 ? ' '.repeat(level + 1) : '';
		}
	}
	return '';
}

/**
 * Set or (with `null`) remove one planning entry, leaving others untouched.
 * A missing planning line is created directly after the headline.
 */
export function setPlanning(
	source: string,
	offset: number,
	kind: PlanningKind,
	timestamp: OrgTimestamp | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const lines = splitLines(source);
	const h = headlineAt(source, offset, config, lines);
	if (!h) return [];
	const planning = findPlanning(lines, h);

	if (!planning) {
		if (!timestamp) return [];
		const indent = planningIndent(lines, h.level);
		const eol = h.line.eol || (source.includes('\r\n') ? '\r\n' : '\n');
		const text = `${indent}${kind}: ${timestamp.raw}`;
		// A headline on the last line without a terminator gets one first.
		return h.line.eol
			? [{ from: h.line.end, to: h.line.end, insert: `${text}${eol}` }]
			: [{ from: h.line.end, to: h.line.end, insert: `${eol}${text}` }];
	}

	const existing = planning.entries.find((e) => e.kind === kind);
	if (existing) {
		if (timestamp) {
			if (timestamp.raw === existing.timestamp.raw) return [];
			return [{ from: existing.tsFrom, to: existing.tsTo, insert: timestamp.raw }];
		}
		if (planning.entries.length === 1) {
			// Removing the only entry removes the whole line.
			return [{ from: planning.line.from, to: planning.line.end, insert: '' }];
		}
		const index = planning.entries.indexOf(existing);
		const following = planning.entries[index + 1];
		if (following) return [{ from: existing.from, to: following.from, insert: '' }];
		const previous = planning.entries[index - 1]!;
		return [{ from: previous.to, to: existing.to, insert: '' }];
	}

	if (!timestamp) return [];
	// Insert in org's canonical order relative to the entries already present.
	const rank = PLANNING_ORDER.indexOf(kind);
	const after = planning.entries.find((e) => PLANNING_ORDER.indexOf(e.kind) > rank);
	if (after) return [{ from: after.from, to: after.from, insert: `${kind}: ${timestamp.raw} ` }];
	const last = planning.entries[planning.entries.length - 1]!;
	return [{ from: last.to, to: last.to, insert: ` ${kind}: ${timestamp.raw}` }];
}
