/// Appointments, as org's agenda finds them: active timestamps (`<…>`) in an
/// entry's heading or text, besides its SCHEDULED/DEADLINE line. Skipped:
/// the planning line, drawers (properties, LOGBOOK…), and source/example
/// blocks. A range (`<a>--<b>`) covers every day from a to b. Of org's diary
/// sexps (`<%%(…)>`), `diary-float` is read: the Nth (or last) weekday of
/// every month, or of one, with an optional time.

import { addDays } from './date';
import { readTimestamp } from './timestamp';
import type { OrgTimestamp } from './types';

/** `(diary-float MONTH DAYNAME N)`: the Nth DAYNAME (0 = Sunday) of the month; N < 0 counts from the end. */
export interface DiaryFloat {
	/** 1–12, or null for every month (`t`). */
	month: number | null;
	dayname: number;
	n: number;
}

export interface Appointment {
	timestamp: OrgTimestamp;
	/** Last day of a `<a>--<b>` range (`YYYY-MM-DD`), or null. */
	until: string | null;
	/** A `diary-float` sexp: its days come from `floatDates` (the timestamp has no date, only a time). */
	float?: DiaryFloat;
}

const FLOAT =
	/<%%\(diary-float\s+(t|\d{1,2})\s+([0-6])\s+(-?[1-5])\)(?:\s+(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)?>/g;

/**
 * A time at the start of a heading's title (`19:00 Book club`, `9:00-10:30
 * Standup`): where org's agenda finds a diary entry's time.
 */
export function headingTime(title: string): { time: string; endTime: string | null } | null {
	const m = /^(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?\b/.exec(title.trim());
	return m ? { time: m[1]!.padStart(5, '0'), endTime: m[2]?.padStart(5, '0') ?? null } : null;
}

/** The days from `start` to `end` (`YYYY-MM-DD`) a `diary-float` falls on. */
export function floatDates(f: DiaryFloat, start: string, end: string): string[] {
	const out: string[] = [];
	let y = Number(start.slice(0, 4));
	let m = Number(start.slice(5, 7));
	for (;;) {
		const first = `${y}-${String(m).padStart(2, '0')}-01`;
		if (first > end) break;
		if (f.month === null || f.month === m) {
			const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
			const dow1 = new Date(`${first}T12:00:00Z`).getUTCDay();
			const firstHit = 1 + ((f.dayname - dow1 + 7) % 7);
			const hits: number[] = [];
			for (let d = firstHit; d <= days; d += 7) hits.push(d);
			const day = f.n > 0 ? hits[f.n - 1] : hits[hits.length + f.n];
			if (day) {
				const iso = addDays(first, day - 1);
				if (iso >= start && iso <= end) out.push(iso);
			}
		}
		m += 1;
		if (m > 12) {
			m = 1;
			y += 1;
		}
	}
	return out;
}

function floatsIn(text: string): Appointment[] {
	const out: Appointment[] = [];
	for (const m of text.matchAll(FLOAT)) {
		const time = m[4] ? m[4].padStart(5, '0') : null;
		out.push({
			timestamp: {
				active: true,
				date: '',
				dayName: null,
				time,
				endTime: time && m[5] ? m[5].padStart(5, '0') : null,
				repeater: null,
				warning: null,
				raw: m[0],
			},
			until: null,
			float: { month: m[1] === 't' ? null : Number(m[1]), dayname: Number(m[2]), n: Number(m[3]) },
		});
	}
	return out;
}

const HEADLINE = /^\*+[ \t]/;
const PLANNING = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const DRAWER_START = /^[ \t]*:[\w-]+:[ \t]*$/;
const DRAWER_END = /^[ \t]*:END:[ \t]*$/i;
const BLOCK_START = /^[ \t]*#\+begin_(src|example|export|comment)\b/i;

function stampsIn(text: string): Appointment[] {
	const out: Appointment[] = [];
	for (let i = text.indexOf('<'); i !== -1; i = text.indexOf('<', i + 1)) {
		const read = readTimestamp(text, i);
		if (!read || !read.timestamp.active) continue;
		let until: string | null = null;
		if (text.startsWith('--<', read.to)) {
			const end = readTimestamp(text, read.to + 2);
			if (end?.timestamp.active && end.timestamp.date > read.timestamp.date) {
				until = end.timestamp.date;
				i = end.to - 1;
			}
		}
		out.push({ timestamp: read.timestamp, until });
		if (!until) i = read.to - 1;
	}
	return out;
}

/** Each heading's appointments, by the heading's offset. */
export function appointmentsIn(source: string): Map<number, Appointment[]> {
	const out = new Map<number, Appointment[]>();
	if (!source.includes('<')) return out;
	let heading = -1;
	let drawer = false;
	let block: RegExp | null = null;
	let offset = 0;
	for (const raw of source.split('\n')) {
		const line = raw.replace(/\r$/, '');
		const at = offset;
		offset += raw.length + 1;
		if (block) {
			if (block.test(line)) block = null;
			continue;
		}
		if (HEADLINE.test(line)) {
			heading = at;
			drawer = false;
		} else if (heading === -1) continue;
		else if (drawer) {
			if (DRAWER_END.test(line)) drawer = false;
			continue;
		} else if (DRAWER_START.test(line)) {
			drawer = true;
			continue;
		} else if (PLANNING.test(line)) continue;
		else {
			const b = BLOCK_START.exec(line);
			if (b) {
				block = new RegExp(`^[ \\t]*#\\+end_${b[1]}\\b`, 'i');
				continue;
			}
		}
		if (!line.includes('<')) continue;
		const found = [...stampsIn(line), ...(line.includes('<%%') ? floatsIn(line) : [])];
		if (found.length) out.set(heading, [...(out.get(heading) ?? []), ...found]);
	}
	return out;
}
