/// The day planner's arithmetic: which of a day's items have a time (and
/// where it comes from), how long each lasts, how overlapping blocks share
/// the width, snapping to a quarter hour, and planned versus free time in
/// working hours. Pure, so it's tested on its own.

import { addDays, appointmentsIn, sessionsOf, timestampDates, type OrgTimestamp } from '$lib/org';
import type { AgendaItem, Vault } from '$lib/vault/vault';
import { agendaDays } from './agenda';

export const SNAP = 15;
/** A time with no end and no Effort lasts this long. */
export const DEFAULT_MINUTES = 30;

export const toMinutes = (hhmm: string): number => {
	const [h = 0, m = 0] = hhmm.split(':').map(Number);
	return h * 60 + m;
};
export const fromMinutes = (n: number): string => {
	const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(n)));
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const snap = (n: number, step = SNAP): number => Math.round(n / step) * step;

/**
 * Where a block's time is written: a planning stamp or a work session (both
 * movable), or a timestamp in someone's sentence (an appointment: left alone).
 */
export type BlockSource = 'SCHEDULED' | 'DEADLINE' | 'session' | 'appointment';

export interface PlanBlock {
	/** Unique per block (a task can have several sessions in a day). */
	key: string;
	item: AgendaItem;
	source: BlockSource;
	/** A session's place in the source, to move or remove it. */
	session?: { from: number; to: number };
	/** Minutes from midnight. */
	start: number;
	end: number;
	/** The end is written (a range), not taken from Effort or the default. */
	ranged: boolean;
	/** Its column among the blocks it overlaps, and how many columns they need. */
	col: number;
	cols: number;
}

/** A task's Effort, and how much of it is planned (its timed SCHEDULED plus every session). */
export interface Progress {
	effort: number | null;
	planned: number;
}

export interface DayPlan {
	blocks: PlanBlock[];
	/** Open tasks to plan: on the day without a time, or with Effort left to plan. */
	unplanned: AgendaItem[];
	/** Things on the day without a time that aren't tasks (all-day appointments). */
	allDay: AgendaItem[];
	/** Effort and planned time, by task (`file` + NUL + `pos`). */
	progress: Map<string, Progress>;
}

export interface PlanOptions {
	/** A task's Effort in minutes (with the vault's units); its indexed value otherwise. */
	effortOf?: (item: AgendaItem) => number | null;
}

export const taskKey = (i: AgendaItem) => `${i.file}\u0000${i.pos}`;

const spanOf = (ts: { time: string | null; endTime: string | null }) =>
	ts.time && ts.endTime ? Math.max(0, toMinutes(ts.endTime) - toMinutes(ts.time)) : 0;

/**
 * Planned minutes for a task: its timed SCHEDULED plus all its sessions, any
 * day. A time with no end counts for what the planner draws: its Effort (for
 * SCHEDULED), else the default length.
 */
function plannedOf(vault: Vault, item: AgendaItem, effort: number | null): number {
	const file = vault.file(item.file);
	const own = file ? sessionsOf(file.source, item.pos, file.index.keywords) : [];
	const length = (ts: { time: string | null; endTime: string | null }, lone: number) =>
		ts.time ? (ts.endTime ? spanOf(ts) : lone) : 0;
	const sessions = own.reduce((sum, s) => sum + length(s.timestamp, DEFAULT_MINUTES), 0);
	const scheduled = item.scheduled
		? length(item.scheduled, effort && effort > 0 ? effort : DEFAULT_MINUTES)
		: 0;
	return sessions + scheduled;
}

/** Lay overlapping blocks side by side: a column each, sharing the width of their group. */
export function layoutBlocks<T extends { start: number; end: number }>(
	list: T[],
): (T & { col: number; cols: number })[] {
	const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end);
	const out: (T & { col: number; cols: number })[] = [];
	let group: (T & { col: number; cols: number })[] = [];
	let groupEnd = -1;
	let columns: number[] = [];
	const close = () => {
		const cols = Math.max(1, columns.length);
		for (const b of group) b.cols = cols;
		out.push(...group);
		group = [];
		columns = [];
	};
	for (const b of sorted) {
		if (b.start >= groupEnd && group.length) close();
		let col = columns.findIndex((end) => end <= b.start);
		if (col === -1) {
			col = columns.length;
			columns.push(b.end);
		} else columns[col] = b.end;
		group.push({ ...b, col, cols: 1 });
		groupEnd = Math.max(groupEnd, b.end);
	}
	if (group.length) close();
	return out;
}

/** The day's plan: timed blocks laid out, tasks to plan, all-day things, progress. */
export function dayPlan(
	vault: Vault,
	date: string,
	today: string,
	keep: (item: AgendaItem) => boolean = () => true,
	options: PlanOptions = {},
): DayPlan {
	const effortOf = options.effortOf ?? ((i: AgendaItem) => i.effort);
	const items = agendaDays(vault, date, date, today, keep)[0]?.items ?? [];
	const raw: Omit<PlanBlock, 'col' | 'cols'>[] = [];
	const unplanned: AgendaItem[] = [];
	const allDay: AgendaItem[] = [];
	const progress = new Map<string, Progress>();
	const track = (item: AgendaItem) => {
		const key = taskKey(item);
		if (!progress.has(key)) {
			const effort = effortOf(item);
			progress.set(key, { effort, planned: plannedOf(vault, item, effort) });
		}
		return progress.get(key)!;
	};
	const on = (ts: OrgTimestamp | null) =>
		!!ts?.active && !!ts.time && timestampDates(ts, date, date).length > 0;

	for (const item of items) {
		const key = taskKey(item);
		const file = vault.file(item.file);
		const found: Omit<PlanBlock, 'col' | 'cols' | 'item' | 'key'>[] = [];
		const lone = (time: string) => {
			const effort = effortOf(item);
			// A lone time lasts its Effort (no more than the rest of the day), else the default.
			const start = toMinutes(time);
			return Math.min(24 * 60 - 1, start + (effort && effort > 0 ? effort : DEFAULT_MINUTES));
		};
		for (const source of ['SCHEDULED', 'DEADLINE'] as const) {
			const ts = source === 'SCHEDULED' ? item.scheduled : item.deadline;
			if (!ts || !on(ts)) continue;
			found.push({
				source,
				start: toMinutes(ts.time!),
				end: ts.endTime ? toMinutes(ts.endTime) : lone(ts.time!),
				ranged: !!ts.endTime,
			});
			break;
		}
		const sessions = file ? sessionsOf(file.source, item.pos, file.index.keywords) : [];
		for (const s of sessions) {
			if (!on(s.timestamp)) continue;
			found.push({
				source: 'session',
				session: { from: s.from, to: s.to },
				start: toMinutes(s.timestamp.time!),
				end: s.timestamp.endTime ? toMinutes(s.timestamp.endTime) : lone(s.timestamp.time!),
				ranged: !!s.timestamp.endTime,
			});
		}
		const written = new Set(sessions.map((s) => s.timestamp.raw));
		const others = file ? (appointmentsIn(file.source).get(item.pos) ?? []) : [];
		for (const a of others) {
			if (written.has(a.timestamp.raw) || !on(a.timestamp)) continue;
			found.push({
				source: 'appointment',
				start: toMinutes(a.timestamp.time!),
				end: a.timestamp.endTime ? toMinutes(a.timestamp.endTime) : lone(a.timestamp.time!),
				ranged: !!a.timestamp.endTime,
			});
		}
		if (!found.length) {
			if (item.todo) {
				unplanned.push(item);
				track(item);
			} else allDay.push(item);
			continue;
		}
		if (item.todo) {
			const p = track(item);
			// Effort left to plan: it stays in the tray too.
			if (p.effort && p.planned < p.effort) unplanned.push(item);
		}
		found.forEach((f, n) =>
			raw.push({
				...f,
				item,
				key: `${key}\u0000${f.source}\u0000${f.session?.from ?? n}`,
				end: Math.max(f.end, f.start + SNAP),
			}),
		);
	}

	// Work under way on other days, with Effort left to plan: in the tray here too.
	if (date >= today) {
		const seen = new Set([...unplanned, ...raw.map((b) => b.item)].map(taskKey));
		for (const item of vault.agenda()) {
			const key = taskKey(item);
			if (seen.has(key) || !item.todo || vault.isDone(item.todo, item.file) || !keep(item))
				continue;
			if (item.scheduled && item.scheduled.date > date) continue;
			const effort = effortOf(item);
			if (!effort) continue;
			const file = vault.file(item.file);
			const started =
				!!item.scheduled?.time ||
				(file ? sessionsOf(file.source, item.pos, file.index.keywords).length > 0 : false);
			if (!started) continue;
			const p = track(item);
			if (p.planned < effort) unplanned.push(item);
		}
	}
	return { blocks: layoutBlocks(raw), unplanned, allDay, progress };
}

/** The longest session "Plan the rest" makes. */
export const SESSION_MAX = 120;

/**
 * Sessions for `remaining` minutes of work in free working time, from
 * `startDate` at `startMinute` on, at most `max` minutes each and over at most
 * `horizon` days: what "Plan the rest" writes.
 */
export function fillSessions(
	remaining: number,
	startDate: string,
	startMinute: number,
	busyOn: (date: string) => { start: number; end: number }[],
	work: { start: string; end: string },
	options: { horizon?: number; max?: number } = {},
): { date: string; start: number; end: number }[] {
	const { horizon = 14, max = SESSION_MAX } = options;
	const out: { date: string; start: number; end: number }[] = [];
	let left = remaining;
	for (let d = 0; d < horizon && left >= SNAP; d += 1) {
		const date = addDays(startDate, d);
		const open = toMinutes(work.start);
		const close = toMinutes(work.end);
		let cursor = d === 0 ? Math.max(open, Math.ceil(startMinute / SNAP) * SNAP) : open;
		const busy = busyOn(date)
			.filter((b) => b.end > cursor && b.start < close)
			.sort((a, b) => a.start - b.start);
		const gaps: [number, number][] = [];
		for (const b of busy) {
			if (b.start > cursor) gaps.push([cursor, b.start]);
			cursor = Math.max(cursor, b.end);
		}
		if (close > cursor) gaps.push([cursor, close]);
		for (const [from, to] of gaps) {
			let at = from;
			while (left >= SNAP && to - at >= SNAP) {
				const length = Math.min(left, max, to - at);
				out.push({ date, start: at, end: at + length });
				left -= length;
				at += length;
			}
			if (left < SNAP) break;
		}
	}
	return out;
}

/** Minutes planned inside working hours (overlaps counted once), and what's free. */
export function planTotals(
	blocks: { start: number; end: number }[],
	work: { start: string; end: string },
): { planned: number; free: number } {
	const from = toMinutes(work.start);
	const to = toMinutes(work.end);
	if (to <= from) return { planned: 0, free: 0 };
	const spans = blocks
		.map((b) => [Math.max(from, b.start), Math.min(to, b.end)] as const)
		.filter(([a, b]) => b > a)
		.sort((x, y) => x[0] - y[0]);
	let planned = 0;
	let cursor = from;
	for (const [a, b] of spans) {
		const s = Math.max(a, cursor);
		if (b > s) {
			planned += b - s;
			cursor = b;
		}
	}
	return { planned, free: to - from - planned };
}

/** `4 h 30`, `45 min`, `2 h`. */
export function hours(minutes: number): string {
	const h = Math.floor(minutes / 60);
	const m = minutes % 60;
	if (!h) return `${m} min`;
	return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
