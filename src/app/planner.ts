/// The day planner's arithmetic: which of a day's items have a time (and
/// where it comes from), how long each lasts, how overlapping blocks share
/// the width, snapping to a quarter hour, and planned versus free time in
/// working hours. Pure, so it's tested on its own.

import { appointmentsIn, timestampDates } from '$lib/org';
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

/** Where a block's time is written: a planning stamp (movable) or text in the entry (not). */
export type BlockSource = 'SCHEDULED' | 'DEADLINE' | 'appointment';

export interface PlanBlock {
	key: string;
	item: AgendaItem;
	source: BlockSource;
	/** Minutes from midnight. */
	start: number;
	end: number;
	/** The end is written (a range), not taken from Effort or the default. */
	ranged: boolean;
	/** Its column among the blocks it overlaps, and how many columns they need. */
	col: number;
	cols: number;
}

export interface DayPlan {
	blocks: PlanBlock[];
	/** Open tasks on the day with no time: what's left to plan. */
	unplanned: AgendaItem[];
	/** Things on the day without a time that aren't tasks (all-day appointments). */
	allDay: AgendaItem[];
}

const keyOf = (i: AgendaItem) => `${i.file}\u0000${i.pos}`;

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

/** The day's plan: timed blocks laid out, untimed tasks to plan, all-day things. */
export function dayPlan(
	vault: Vault,
	date: string,
	today: string,
	keep: (item: AgendaItem) => boolean = () => true,
): DayPlan {
	const items = agendaDays(vault, date, date, today, keep)[0]?.items ?? [];
	const raw: Omit<PlanBlock, 'col' | 'cols'>[] = [];
	const unplanned: AgendaItem[] = [];
	const allDay: AgendaItem[] = [];
	for (const item of items) {
		let found: { source: BlockSource; time: string; endTime: string | null } | null = null;
		for (const source of ['SCHEDULED', 'DEADLINE'] as const) {
			const ts = source === 'SCHEDULED' ? item.scheduled : item.deadline;
			if (ts?.active && ts.time && timestampDates(ts, date, date).length) {
				found = { source, time: ts.time, endTime: ts.endTime };
				break;
			}
		}
		if (!found) {
			const file = vault.file(item.file);
			const own = file ? (appointmentsIn(file.source).get(item.pos) ?? []) : [];
			const hit = own.find(
				(a) => a.timestamp.time && timestampDates(a.timestamp, date, date).length,
			);
			if (hit)
				found = {
					source: 'appointment',
					time: hit.timestamp.time!,
					endTime: hit.timestamp.endTime,
				};
		}
		if (!found) {
			if (item.todo) unplanned.push(item);
			else allDay.push(item);
			continue;
		}
		const start = toMinutes(found.time);
		const end = found.endTime
			? toMinutes(found.endTime)
			: start + (item.effort && item.effort > 0 ? item.effort : DEFAULT_MINUTES);
		raw.push({
			key: keyOf(item),
			item,
			source: found.source,
			start,
			end: Math.max(end, start + SNAP),
			ranged: !!found.endTime,
		});
	}
	return { blocks: layoutBlocks(raw), unplanned, allDay };
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
