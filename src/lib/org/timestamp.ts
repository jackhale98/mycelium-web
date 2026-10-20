/// Org timestamps: `<2024-01-15 Mon 09:00 ++1w -2d>`.

import { dayNameFor, formatTime, isValidDate, parseTime } from './date';
import type { OrgTimestamp } from './types';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const REPEATER_RE = /^(\+\+|\.\+|\+)(\d+)([hdwmy])(?:\/\d+[hdwmy])?$/;
const WARNING_RE = /^(--|-)(\d+)([hdwmy])$/;
const TIME_RANGE_RE = /^(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?$/;

export interface TimestampRead {
	timestamp: OrgTimestamp;
	/** Offset of the opening delimiter. */
	from: number;
	/** Offset just past the closing delimiter. */
	to: number;
}

/**
 * Read a timestamp starting exactly at `from`. Returns `null` when the text
 * there is not an org timestamp (wrong delimiter, unterminated, or no date).
 */
export function readTimestamp(text: string, from = 0): TimestampRead | null {
	const open = text[from];
	if (open !== '<' && open !== '[') return null;
	const active = open === '<';
	const closeIndex = text.indexOf(active ? '>' : ']', from + 1);
	if (closeIndex === -1) return null;
	const inner = text.slice(from + 1, closeIndex);
	if (inner.includes('\n')) return null;
	const parts = inner.split(/[ \t]+/).filter((p) => p.length > 0);
	const date = parts[0];
	if (!date || !DATE_RE.test(date)) return null;

	let dayName: string | null = null;
	let time: string | null = null;
	let endTime: string | null = null;
	let repeater: string | null = null;
	let warning: string | null = null;
	for (const part of parts.slice(1)) {
		const timeMatch = TIME_RANGE_RE.exec(part);
		if (timeMatch && time === null) {
			time = timeMatch[1]!;
			endTime = timeMatch[2] ?? null;
		} else if (REPEATER_RE.test(part) && repeater === null) {
			repeater = part;
		} else if (WARNING_RE.test(part) && warning === null) {
			warning = part;
		} else if (dayName === null && !/\d/.test(part)) {
			dayName = part;
		}
	}
	return {
		timestamp: {
			raw: text.slice(from, closeIndex + 1),
			active,
			date,
			dayName,
			time,
			endTime,
			repeater,
			warning,
		},
		from,
		to: closeIndex + 1,
	};
}

/** Parse a standalone timestamp, ignoring leading whitespace. */
export function parseTimestamp(text: string): OrgTimestamp | null {
	const start = text.length - text.trimStart().length;
	return readTimestamp(text, start)?.timestamp ?? null;
}

/** Render a timestamp from its parts in org's canonical form. */
export function formatTimestamp(ts: Omit<OrgTimestamp, 'raw'>): string {
	const parts: string[] = [ts.date];
	if (ts.dayName) parts.push(ts.dayName);
	if (ts.time) parts.push(ts.endTime ? `${ts.time}-${ts.endTime}` : ts.time);
	if (ts.repeater) parts.push(ts.repeater);
	if (ts.warning) parts.push(ts.warning);
	const body = parts.join(' ');
	return ts.active ? `<${body}>` : `[${body}]`;
}

export interface MakeTimestampOptions {
	date: string;
	time?: string | null;
	endTime?: string | null;
	/** Omit to derive the English day name from `date`; pass `null` to leave it out. */
	dayName?: string | null;
	repeater?: string | null;
	warning?: string | null;
	/** `true` (default) writes `<…>`, `false` writes `[…]`. */
	active?: boolean;
}

/** Build a timestamp from scratch, defaulting the day name from the date. */
export function makeTimestamp(options: MakeTimestampOptions): OrgTimestamp {
	const time = normaliseTime(options.time);
	const ts = {
		active: options.active ?? true,
		date: options.date,
		dayName: options.dayName === undefined ? dayNameFor(options.date) || null : options.dayName,
		time,
		endTime: time ? normaliseTime(options.endTime) : null,
		repeater: options.repeater ?? null,
		warning: options.warning ?? null,
	};
	return { ...ts, raw: formatTimestamp(ts) };
}

function normaliseTime(time: string | null | undefined): string | null {
	if (!time) return null;
	const minutes = parseTime(time);
	return minutes === null ? null : formatTime(minutes);
}

export type TimestampPatch = Partial<Omit<OrgTimestamp, 'raw'>>;

/**
 * Return `ts` with fields replaced. When only the date (and so the day name)
 * changes, the raw text is edited token-by-token so any unusual spacing or
 * extra tokens inside the brackets survive; otherwise it is re-rendered.
 */
export function withTimestamp(ts: OrgTimestamp, patch: TimestampPatch): OrgTimestamp {
	const date = patch.date ?? ts.date;
	let dayName = patch.dayName === undefined ? ts.dayName : patch.dayName;
	if (patch.dayName === undefined && dayName !== null && date !== ts.date) {
		dayName = dayNameFor(date) || dayName;
	}
	const time = patch.time === undefined ? ts.time : normaliseTime(patch.time);
	const next = {
		active: patch.active ?? ts.active,
		date,
		dayName,
		time,
		endTime: time
			? patch.endTime === undefined
				? ts.endTime
				: normaliseTime(patch.endTime)
			: null,
		repeater: patch.repeater === undefined ? ts.repeater : patch.repeater,
		warning: patch.warning === undefined ? ts.warning : patch.warning,
	};

	const onlyDate =
		next.active === ts.active &&
		next.time === ts.time &&
		next.endTime === ts.endTime &&
		next.repeater === ts.repeater &&
		next.warning === ts.warning &&
		(next.dayName === null) === (ts.dayName === null);
	if (onlyDate && ts.raw) {
		let raw = ts.raw.replace(ts.date, next.date);
		if (ts.dayName && next.dayName && ts.dayName !== next.dayName) {
			raw = raw.replace(new RegExp(`(?<=\\s)${ts.dayName}(?=[\\s>\\]])`), next.dayName);
		}
		return { ...next, raw };
	}
	return { ...next, raw: formatTimestamp(next) };
}

/**
 * Parse user input into a timestamp: a full timestamp (`<2026-03-20 Fri +1w>`)
 * or a date / date-time (`2026-03-20`, `2026-03-20T14:00`). Repeater and warning
 * cookies of `base` are inherited unless the input supplies its own, so picking
 * a new date never silently drops `+1w -2d`.
 */
export function parseTimestampInput(
	input: string,
	base?: OrgTimestamp | null,
	options?: { active?: boolean },
): OrgTimestamp | null {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const read = readTimestamp(trimmed, 0);
	if (read) {
		const ts = read.timestamp;
		return withTimestamp(ts, {
			active: options?.active ?? ts.active,
			repeater: ts.repeater ?? base?.repeater ?? null,
			warning: ts.warning ?? base?.warning ?? null,
			dayName: ts.dayName ?? (dayNameFor(ts.date) || null),
		});
	}
	const [datePart = '', ...rest] = trimmed.split(/[T\s]+/);
	if (!isValidDate(datePart)) return null;
	const timeText = rest.join(' ').trim();
	const timeMatch = TIME_RANGE_RE.exec(timeText) ?? TIME_RANGE_RE.exec(timeText.slice(0, 5));
	return makeTimestamp({
		date: datePart,
		time: timeMatch?.[1] ?? null,
		endTime: timeMatch?.[2] ?? null,
		repeater: base?.repeater ?? null,
		warning: base?.warning ?? null,
		active: options?.active ?? base?.active ?? true,
	});
}

/** A timestamp for "now", as org writes CLOSED stamps and log entries. */
export function nowTimestamp(
	now: { date: string; time?: string | null },
	active = false,
): OrgTimestamp {
	return makeTimestamp({ date: now.date, time: now.time ?? null, active });
}
