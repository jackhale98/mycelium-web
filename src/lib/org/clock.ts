/// Clocking, as `org-clock.el` writes and reads it.
///
/// - Clock in (`org-clock-in`): a `CLOCK: [2026-10-21 Wed 09:00]` line in the
///   entry's clock drawer. With `org-clock-into-drawer` at its default `t`
///   that's the log drawer (`LOGBOOK`), created after the planning line and
///   property drawer; loose CLOCK lines are gathered into it. New lines go at
///   the top (`org-log-states-order-reversed`). A `CLOCK_INTO_DRAWER`
///   property (inherited) overrides the drawer: `t`, a name, or `nil`.
/// - Clock out (`org-clock-out`): `--[stamp] => ` and `%2d:%02d` hours and
///   minutes (`=>  1:30`; hours never roll into days).
/// - Cancel (`org-clock-cancel`): the running line goes, and the drawer too if
///   that leaves it empty.
/// - Sums (`org-clock-sum`): each closed clock counts the minutes between its
///   timestamps (local time, clipped to a range, rounded down); a bare
///   `CLOCK: => 1:30` counts as written; running clocks don't count.

import { dayNameFor } from './date';
import {
	headlineLevel,
	owningHeadline,
	scanHeadline,
	subtreeEnd,
	type HeadlineScan,
} from './headline';
import { entryEnd } from './log';
import { findPlanning } from './planning';
import { findPropertyDrawer, getProperties } from './properties';
import { splitLines, type Change, type Line } from './text';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

export interface ClockTime {
	/** `YYYY-MM-DD` */
	date: string;
	/** `HH:MM` */
	time: string;
}

export interface ClockLine {
	line: Line;
	indent: string;
	start: ClockTime;
	/** `null` while the clock is running. */
	end: ClockTime | null;
	/** A bare `CLOCK: => H:MM` line (no timestamps). */
	naked: number | null;
}

const STAMP = String.raw`\[(\d{4}-\d{2}-\d{2})(?:[ \t]+[^\]\s\d]+)?[ \t]+(\d{1,2}:\d{2})\]`;
const CLOCK_RE = new RegExp(
	String.raw`^([ \t]*)CLOCK:[ \t]*(?:${STAMP}(?:-+${STAMP}(?:[ \t]*=>[ \t]*-?\d+:\d{2})?)?|=>[ \t]*(\d+):(\d{2}))[ \t]*$`,
);

/** `[2026-10-21 Wed 09:00]`, as `org-insert-timestamp` writes an inactive time. */
export function clockStamp(t: ClockTime): string {
	return `[${t.date} ${dayNameFor(t.date)} ${t.time.padStart(5, '0')}]`;
}

/** `org-clock-out`'s duration: `%2d:%02d`. */
export function clockDuration(minutes: number): string {
	const m = Math.max(0, Math.floor(minutes));
	return `${String(Math.floor(m / 60)).padStart(2, ' ')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes for display, as `org-duration-from-minutes` formats by default: `1d 2:30`, `0:45`. */
export function formatDuration(minutes: number): string {
	const m = Math.max(0, Math.round(minutes));
	const days = Math.floor(m / 1440);
	const rest = m % 1440;
	const hm = `${Math.floor(rest / 60)}:${String(rest % 60).padStart(2, '0')}`;
	return days ? `${days}d ${hm}` : hm;
}

/** Local epoch milliseconds of a clock time (so daylight-saving changes count, as in Emacs). */
export function clockMillis(t: ClockTime): number {
	const [y, mo, d] = t.date.split('-').map(Number) as [number, number, number];
	const [h, mi] = t.time.split(':').map(Number) as [number, number];
	return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Minutes between two clock times, rounded down (`org-clock-out`). */
export function minutesBetween(a: ClockTime, b: ClockTime): number {
	return Math.floor((clockMillis(b) - clockMillis(a)) / 60_000);
}

function parseClock(line: Line): ClockLine | null {
	const m = CLOCK_RE.exec(line.text);
	if (!m) return null;
	if (m[6] !== undefined)
		return {
			line,
			indent: m[1]!,
			start: { date: '', time: '' },
			end: null,
			naked: Number(m[6]) * 60 + Number(m[7]),
		};
	return {
		line,
		indent: m[1]!,
		start: { date: m[2]!, time: m[3]!.padStart(5, '0') },
		end: m[4] ? { date: m[4], time: m[5]!.padStart(5, '0') } : null,
		naked: null,
	};
}

const BLOCK_START = /^[ \t]*#\+begin_/i;
const BLOCK_END = /^[ \t]*#\+end_/i;

/** CLOCK lines between two line indexes, skipping source and example blocks. */
function clocksIn(lines: readonly Line[], from: number, to: number): ClockLine[] {
	const out: ClockLine[] = [];
	let inBlock = false;
	for (let i = from; i < to; i += 1) {
		const text = lines[i]!.text;
		if (inBlock) {
			if (BLOCK_END.test(text)) inBlock = false;
			continue;
		}
		if (BLOCK_START.test(text)) {
			inBlock = true;
			continue;
		}
		const c = parseClock(lines[i]!);
		if (c) out.push(c);
	}
	return out;
}

const indexAt = (lines: readonly Line[], offset: number) => {
	let i = lines.findIndex((l) => l.end > offset);
	if (i === -1) i = lines.length;
	return i;
};

/** The entry's own CLOCK lines (heading to next heading of any level). */
export function entryClocks(
	source: string,
	headingOffset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	lines: readonly Line[] = splitLines(source),
): ClockLine[] {
	const h = owningHeadline(source, headingOffset, config, lines);
	if (!h) return [];
	return clocksIn(lines, h.line.index + 1, indexAt(lines, entryEnd(lines, h)));
}

/** Running clocks in a file, with the heading each belongs to. */
export function runningClocks(
	source: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): { heading: number; title: string; start: ClockTime; line: number }[] {
	if (!source.includes('CLOCK:')) return [];
	const lines = splitLines(source);
	const out: { heading: number; title: string; start: ClockTime; line: number }[] = [];
	let heading: HeadlineScan | null = null;
	for (const c of clocksIn(lines, 0, lines.length)) {
		if (c.end || c.naked !== null) continue;
		heading = owningHeadline(source, c.line.from, config, lines);
		if (heading)
			out.push({
				heading: heading.line.from,
				title: heading.title.value,
				start: c.start,
				line: c.line.from,
			});
	}
	return out;
}

/**
 * The clock drawer for the entry: `CLOCK_INTO_DRAWER` (inherited) if set,
 * else the log drawer (`logDrawer`) or `LOGBOOK`; `null` for no drawer.
 */
export function clockDrawerName(
	source: string,
	headingOffset: number,
	logDrawer: string | null,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	lines: readonly Line[] = splitLines(source),
): string | null {
	// Walk up the outline for CLOCK_INTO_DRAWER, then the file-level drawer.
	let h = owningHeadline(source, headingOffset, config, lines);
	const owners: (number | null)[] = [];
	while (h) {
		owners.push(h.line.from);
		const level = h.level;
		let parent: HeadlineScan | null = null;
		for (let i = h.line.index - 1; i >= 0; i -= 1) {
			const l = headlineLevel(lines[i]!.text);
			if (l > 0 && l < level) {
				parent = scanHeadline(lines[i]!, config);
				break;
			}
		}
		h = parent;
	}
	owners.push(null);
	for (const owner of owners) {
		const v = getProperties(source, owner, config)['CLOCK_INTO_DRAWER']?.trim();
		if (v === undefined) continue;
		if (v === 'nil') return null;
		if (v === 't') return logDrawer ?? 'LOGBOOK';
		if (/^\d+$/.test(v)) return logDrawer ?? 'LOGBOOK';
		return v;
	}
	return logDrawer ?? 'LOGBOOK';
}

/**
 * Start a clock on the entry at `headingOffset`. Any clock already running
 * in it is left alone (Org resumes it instead; see `entryClocks`).
 */
export function clockIn(
	source: string,
	headingOffset: number,
	now: ClockTime,
	options: { logDrawer?: string | null; config?: KeywordConfig } = {},
): Change[] {
	const config = options.config ?? DEFAULT_KEYWORD_CONFIG;
	const lines = splitLines(source);
	const h = owningHeadline(source, headingOffset, config, lines);
	if (!h) return [];
	const eol = source.includes('\r\n') ? '\r\n' : '\n';
	const drawer = clockDrawerName(source, h.line.from, options.logDrawer ?? null, config, lines);
	const end = indexAt(lines, entryEnd(lines, h));
	const stamp = clockStamp(now);

	// An existing drawer of that name: new clock at its top.
	if (drawer) {
		const re = new RegExp(`^([ \\t]*):${drawer.replace(/[^\w-]/g, '')}:[ \\t]*$`, 'i');
		let inBlock = false;
		for (let i = h.line.index + 1; i < end; i += 1) {
			const text = lines[i]!.text;
			if (inBlock) {
				if (BLOCK_END.test(text)) inBlock = false;
				continue;
			}
			if (BLOCK_START.test(text)) {
				inBlock = true;
				continue;
			}
			const m = re.exec(text);
			if (m) {
				const at = lines[i]!.end;
				return [{ from: at, to: at, insert: `${m[1]}CLOCK: ${stamp}${lines[i]!.eol || eol}` }];
			}
		}
	}

	// After the planning line and property drawer (org-end-of-meta-data).
	const planning = findPlanning(lines, h);
	const props = findPropertyDrawer(source, h.line.from, config, lines);
	const meta = props ? props.end : (planning?.line ?? h.line);
	const loose = clocksIn(lines, h.line.index + 1, end);
	const out: Change[] = [];
	let block: string[];
	if (drawer) {
		// Gather loose CLOCK lines into the new drawer, newest (ours) first.
		for (const c of loose) out.push({ from: c.line.from, to: c.line.end, insert: '' });
		// Org collects their positions back to front, so they land reversed.
		block = [
			`:${drawer}:`,
			`CLOCK: ${stamp}`,
			...[...loose].reverse().map((c) => c.line.text.trim()),
			':END:',
		];
	} else if (loose.length) {
		// No drawer: next to the existing clocks, newest first.
		const first = loose[0]!;
		return [
			{
				from: first.line.from,
				to: first.line.from,
				insert: `${first.indent}CLOCK: ${stamp}${first.line.eol || eol}`,
			},
		];
	} else block = [`CLOCK: ${stamp}`];
	const text = block.join(eol);
	out.push(
		meta.eol
			? { from: meta.end, to: meta.end, insert: `${text}${eol}` }
			: { from: meta.end, to: meta.end, insert: `${eol}${text}` },
	);
	return out;
}

/** Close the running clock in the entry. No clock running: no change. */
export function clockOut(
	source: string,
	headingOffset: number,
	now: ClockTime,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const lines = splitLines(source);
	const running = entryClocks(source, headingOffset, config, lines).find(
		(c) => !c.end && c.naked === null,
	);
	if (!running) return [];
	const stampEnd = running.line.text.indexOf(']') + 1;
	const from = running.line.from + stampEnd;
	return [
		{
			from,
			to: running.line.to,
			insert: `--${clockStamp(now)} => ${clockDuration(minutesBetween(running.start, now))}`,
		},
	];
}

/** Remove the running clock in the entry, and its drawer if nothing else is in it. */
export function clockCancel(
	source: string,
	headingOffset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Change[] {
	const lines = splitLines(source);
	const running = entryClocks(source, headingOffset, config, lines).find(
		(c) => !c.end && c.naked === null,
	);
	if (!running) return [];
	const i = running.line.index;
	const prev = lines[i - 1];
	const next = lines[i + 1];
	if (
		prev &&
		next &&
		/^[ \t]*:[\w-]+:[ \t]*$/.test(prev.text) &&
		/^[ \t]*:END:[ \t]*$/i.test(next.text) &&
		!/^[ \t]*:(PROPERTIES|END):/i.test(prev.text)
	)
		return [{ from: prev.from, to: next.end, insert: '' }];
	return [{ from: running.line.from, to: running.line.end, insert: '' }];
}

/** Minutes clocked on closed clocks between `from` and `to` lines, clipped to a range. */
function sumClocks(clocks: readonly ClockLine[], range?: { start: number; end: number }): number {
	let total = 0;
	for (const c of clocks) {
		if (c.naked !== null) {
			if (!range) total += c.naked;
			continue;
		}
		if (!c.end) continue;
		const ts = clockMillis(c.start);
		const te = clockMillis(c.end);
		const dt = Math.min(te, range?.end ?? te) - Math.max(ts, range?.start ?? ts);
		if (dt > 0) total += Math.floor(dt / 60_000);
	}
	return total;
}

/** Total minutes clocked in the subtree at `headingOffset` (optionally within a time range). */
export function subtreeClockSum(
	source: string,
	headingOffset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	range?: { start: number; end: number },
): number {
	const lines = splitLines(source);
	const h = owningHeadline(source, headingOffset, config, lines);
	if (!h) return 0;
	return sumClocks(clocksIn(lines, h.line.index + 1, indexAt(lines, subtreeEnd(lines, h))), range);
}

export interface ClockEntry {
	/** Offset of the entry's headline. */
	heading: number;
	level: number;
	title: string;
	/** Titles of the headings above it. */
	olp: string[];
	/** This entry's own minutes (not its children's). */
	minutes: number;
}

/** Per-entry clocked minutes in a file, within an optional time range (for clock reports). */
export function clockEntries(
	source: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
	range?: { start: number; end: number },
): ClockEntry[] {
	if (!source.includes('CLOCK:')) return [];
	const lines = splitLines(source);
	const out: ClockEntry[] = [];
	const stack: string[] = [];
	for (let i = 0; i < lines.length; i += 1) {
		const h = lines[i]!.text.startsWith('*') ? scanHeadline(lines[i]!, config) : null;
		if (!h) continue;
		stack.length = h.level - 1;
		const end = indexAt(lines, entryEnd(lines, h));
		const minutes = sumClocks(clocksIn(lines, i + 1, end), range);
		if (minutes > 0)
			out.push({
				heading: h.line.from,
				level: h.level,
				title: h.title.value,
				olp: stack.filter(Boolean),
				minutes,
			});
		stack[h.level - 1] = h.title.value;
	}
	return out;
}
