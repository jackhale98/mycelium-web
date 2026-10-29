/// When to remind about agenda items: SCHEDULED and DEADLINE times (and,
/// optionally, untimed ones at a set hour on the day), a chosen number of
/// minutes ahead, repeating timestamps included (`+1w`, `++1d`, `.+1m` all
/// recur on their interval, as org's agenda shows them). Pure: the app turns
/// these into notifications on the device, or into pushes sent later.

import { shiftDate } from './date';
import type { OrgTimestamp, TimeUnit } from './types';

export interface ReminderSource {
	title: string;
	todo: string | null;
	scheduled: OrgTimestamp | null;
	deadline: OrgTimestamp | null;
	/** Done items never remind. */
	done: boolean;
	/** What the notification opens (an app address). */
	url: string;
	/** Something stable for this item across edits elsewhere in the file. */
	key: string;
	/** Work sessions planned for it (timestamps in its entry), which remind like a scheduled time. */
	sessions?: OrgTimestamp[];
}

export interface ReminderOptions {
	/** Epoch ms: reminders before this aren't returned. */
	from: number;
	/** Epoch ms: nor after this. */
	to: number;
	/** Minutes ahead of the time. */
	lead: number;
	scheduled: boolean;
	deadline: boolean;
	/** `HH:MM` to remind about untimed items on their day, or null for timed ones only. */
	untimedAt: string | null;
}

export interface Reminder {
	/** Stable for one occurrence: the notification's tag, so it shows once. */
	id: string;
	/** Epoch ms to show it. */
	at: number;
	/** Epoch ms of the item's time (or the untimed hour). */
	due: number;
	kind: 'scheduled' | 'deadline';
	title: string;
	body: string;
	url: string;
}

const REPEATER = /^(?:\.\+|\+\+|\+)(\d+)([hdwmy])$/;

/** Local time on `date` at `time` (`HH:MM`), as epoch ms. */
export function localTime(date: string, time: string): number {
	const [y, m, d] = date.split('-').map(Number) as [number, number, number];
	const [hh, mm] = time.split(':').map(Number) as [number, number];
	return new Date(y, m - 1, d, hh, mm).getTime();
}

/** The dates a timestamp falls on (repeats included) whose `time` lands in [from, to]. */
function occurrences(ts: OrgTimestamp, time: string, from: number, to: number): string[] {
	const out: string[] = [];
	const rep = ts.repeater ? REPEATER.exec(ts.repeater) : null;
	const step = rep ? Number(rep[1]) : 0;
	const unit = rep?.[2] as TimeUnit | undefined;
	if (!rep || step <= 0 || unit === 'h') {
		const at = localTime(ts.date, time);
		return at >= from && at <= to ? [ts.date] : [];
	}
	// Step forward from the written date; a long-ago base takes more steps, so cap them.
	let date = ts.date;
	for (let k = 0; k < 5000; k += 1) {
		const at = localTime(date, time);
		if (at > to) break;
		if (at >= from) out.push(date);
		date = shiftDate(ts.date, step * (k + 1), unit!);
	}
	return out;
}

/**
 * The days (`YYYY-MM-DD`, from `start` to `end` inclusive) a timestamp falls
 * on, its repeats included: what org's agenda shows a repeating entry on.
 */
export function timestampDates(ts: OrgTimestamp, start: string, end: string): string[] {
	const rep = ts.repeater ? REPEATER.exec(ts.repeater) : null;
	const step = rep ? Number(rep[1]) : 0;
	const unit = rep?.[2] as TimeUnit | undefined;
	if (!rep || step <= 0 || unit === 'h') return ts.date >= start && ts.date <= end ? [ts.date] : [];
	const out: string[] = [];
	let date = ts.date;
	for (let k = 0; k < 5000 && date <= end; k += 1) {
		if (date >= start) out.push(date);
		date = shiftDate(ts.date, step * (k + 1), unit!);
	}
	return out;
}

function hash(text: string): string {
	// FNV-1a: short, stable tags (not security-sensitive).
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i += 1) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

/** Reminders due in the window, earliest first. */
export function upcomingReminders(items: Iterable<ReminderSource>, o: ReminderOptions): Reminder[] {
	const out: Reminder[] = [];
	const lead = o.lead * 60_000;
	for (const item of items) {
		if (item.done) continue;
		for (const kind of ['scheduled', 'deadline'] as const) {
			const ts = item[kind];
			if (!ts || !o[kind] || !ts.active) continue;
			const time = ts.time ?? o.untimedAt;
			if (!time) continue;
			// Untimed items remind at the set hour itself, not ahead of it.
			const ahead = ts.time ? lead : 0;
			for (const date of occurrences(ts, time, o.from + ahead, o.to + ahead)) {
				const due = localTime(date, time);
				const when = ts.time ? ` at ${ts.time}` : '';
				out.push({
					id: `r${hash(`${item.key}|${kind}|${date}|${time}|${ahead}`)}`,
					at: due - ahead,
					due,
					kind,
					title: item.todo ? `${item.todo} ${item.title}` : item.title,
					body: kind === 'deadline' ? `Due${when}` : `Scheduled${when}`,
					url: item.url,
				});
			}
		}
		if (!o.scheduled) continue;
		for (const ts of item.sessions ?? []) {
			if (!ts.active || !ts.time) continue;
			for (const date of occurrences(ts, ts.time, o.from + lead, o.to + lead)) {
				const due = localTime(date, ts.time);
				out.push({
					id: `r${hash(`${item.key}|session|${date}|${ts.time}|${lead}`)}`,
					at: due - lead,
					due,
					kind: 'scheduled',
					title: item.todo ? `${item.todo} ${item.title}` : item.title,
					body: `Session at ${ts.time}${ts.endTime ? `–${ts.endTime}` : ''}`,
					url: item.url,
				});
			}
		}
	}
	return out.sort((a, b) => a.at - b.at);
}
