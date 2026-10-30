/// Habits (`org-habit.el`): a TODO with `:STYLE: habit` and a repeating
/// SCHEDULED date (`.+2d`, optionally with a deadline period: `.+2d/3d`).
/// Its past completions come from the log (`- State "DONE" … [stamp]`, or
/// `- CLOSING NOTE [stamp]`), and the consistency graph colours each day as
/// `org-habit-build-graph` does: blue before it's due, green while it may
/// be done, yellow on the last day, red once late; `*` marks a completion
/// and `!` today. Days are absolute day numbers (`time-to-days`).

import { toDayNumber, fromDayNumber } from './date';
import { headlineLevel, owningHeadline } from './headline';
import { getPlanning, setPlanning } from './planning';
import { getProperty, setProperty } from './properties';
import { applyChanges, splitLines } from './text';
import { makeTimestamp, parseTimestamp, withTimestamp } from './timestamp';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

export const HABIT_PRECEDING_DAYS = 21;
export const HABIT_FOLLOWING_DAYS = 7;

export interface Habit {
	/** Scheduled day (day number). */
	scheduled: number;
	/** The schedule's repeat, in days. */
	repeat: number;
	/** The deadline day, when the repeater has a `/N` period. */
	deadline: number | null;
	deadlineRepeat: number | null;
	/** Days it was done, oldest first. */
	done: number[];
	type: '+' | '++' | '.+';
}

const UNIT_DAYS: Record<string, number> = { d: 1, w: 7, m: 30.4, y: 365.25 };
const toDays = (value: number, unit: string) => Math.floor(value * (UNIT_DAYS[unit] ?? NaN));

/** Is the entry at `offset` a habit (its own `STYLE` property, as org-use-property-inheritance is nil)? */
export function isHabit(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
) {
	return getProperty(source, offset, 'STYLE', config)?.trim() === 'habit';
}

/** `org-habit-parse-todo`, or `null` if the entry isn't a valid habit. */
export function parseHabit(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): Habit | null {
	if (!isHabit(source, offset, config)) return null;
	const lines = splitLines(source);
	const h = owningHeadline(source, offset, config, lines);
	if (!h) return null;
	// The entry's own text: up to its first child (or the end of the subtree).
	let end = lines.length;
	for (let i = h.line.index + 1; i < lines.length; i += 1) {
		const level = headlineLevel(lines[i]!.text);
		if (level > 0) {
			end = i;
			break;
		}
	}
	let scheduled: { date: string; repeater: string | null } | null = null;
	const done: number[] = [];
	const doneRe = new RegExp(
		String.raw`^[ \t]*-[ \t]+(?:State[ \t]+"(?:${config.doneKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') || '\u0000'})".*?|CLOSING NOTE[ \t]*)\[(\d{4}-\d{2}-\d{2})[^\]]*\]`,
	);
	for (let i = h.line.index + 1; i < end; i += 1) {
		const text = lines[i]!.text;
		const s = /SCHEDULED:[ \t]*(<[^>]+>)/.exec(text);
		if (s && !scheduled) {
			const ts = parseTimestamp(s[1]!);
			if (ts) scheduled = { date: ts.date, repeater: ts.repeater };
		}
		const d = doneRe.exec(text);
		if (d && done.length < HABIT_PRECEDING_DAYS + HABIT_FOLLOWING_DAYS)
			done.push(toDayNumber(d[1]!));
	}
	if (!scheduled?.repeater) return null;
	const m = /^(\+\+|\.\+|\+)(\d+)([dwmy])(?:\/(\d+)([dwmy]))?$/.exec(scheduled.repeater);
	if (!m) return null;
	const repeat = toDays(Number(m[2]), m[3]!);
	if (!(repeat > 0)) return null;
	const day = toDayNumber(scheduled.date);
	let deadline: number | null = null;
	let deadlineRepeat: number | null = null;
	if (m[4]) {
		deadlineRepeat = toDays(Number(m[4]), m[5]!);
		if (deadlineRepeat <= repeat) return null;
		deadline = day + (deadlineRepeat - repeat);
	}
	return {
		scheduled: day,
		repeat,
		deadline,
		deadlineRepeat,
		done: done.sort((a, b) => a - b),
		type: m[1] as Habit['type'],
	};
}

const habitDeadline = (h: Habit) =>
	h.deadline ?? (h.deadlineRepeat ? h.scheduled + (h.repeat - 1) : h.scheduled);
const habitDeadlineRepeat = (h: Habit) => h.deadlineRepeat ?? h.repeat;

export type HabitFace = 'clear' | 'ready' | 'alert' | 'overdue';

/** `org-habit-get-faces`: the colour of a day (and of the days after it). */
function faces(h: Habit, day: number, scheduledDay: number | null, donep: boolean): HabitFace {
	const scheduled = scheduledDay ?? h.scheduled;
	const deadline =
		scheduledDay !== null ? scheduledDay + (habitDeadlineRepeat(h) - h.repeat) : habitDeadline(h);
	if (day < scheduled) return 'clear';
	if (day < deadline) return 'ready';
	if (day === deadline) return donep ? 'ready' : 'alert';
	return 'overdue';
}

export interface HabitCell {
	date: string;
	glyph: '*' | '!' | '';
	face: HabitFace;
	/** Org's lighter "future" variant of the colour. */
	future: boolean;
	done: boolean;
}

/** `org-habit-build-graph` from `today - 21` to `today + 7` (28 days). */
export function habitGraph(
	h: Habit,
	today: string,
	preceding = HABIT_PRECEDING_DAYS,
	following = HABIT_FOLLOWING_DAYS,
): HabitCell[] {
	const now = toDayNumber(today);
	const first = now - preceding;
	const end = now + following;
	const all = h.done;
	let doneDates = [...all];
	let lastDone: number | null = null;
	while (doneDates.length && doneDates[0]! < first) {
		lastDone = doneDates[0]!;
		doneDates = doneDates.slice(1);
	}
	const out: HabitCell[] = [];
	for (let start = first; start < end; start += 1) {
		const past = start < now;
		const todayp = start === now;
		const donep = doneDates.length > 0 && doneDates[0] === start;
		let pair: HabitFace;
		if (past && lastDone === null && !(h.scheduled < now))
			pair = all.length && all[0] === start ? 'ready' : 'clear';
		else {
			let sched: number | null = null;
			if (past && lastDone !== null) {
				if (!doneDates.length) sched = h.scheduled;
				else if (h.type === '.+') sched = lastDone + h.repeat;
				else if (h.type === '+') sched = h.scheduled - doneDates.length * h.repeat;
				else {
					const firstDone = all[0]!;
					const shift = (((h.scheduled - firstDone) % h.repeat) + h.repeat) % h.repeat;
					let s = (shift === 0 ? h.repeat : shift) + firstDone;
					if (firstDone !== lastDone)
						for (const d of all.slice(1)) {
							s += (1 + Math.floor(Math.max(d - s, 0) / h.repeat)) * h.repeat;
							if (d === lastDone) break;
						}
					sched = s;
				}
			}
			pair = faces(h, start, sched, donep);
		}
		let marked = false;
		let glyph: HabitCell['glyph'] = '';
		if (donep) {
			glyph = '*';
			marked = true;
			while (doneDates.length && doneDates[0] === start) {
				lastDone = doneDates[0]!;
				doneDates = doneDates.slice(1);
			}
		} else if (todayp) glyph = '!';
		let future = !(past || todayp);
		if (past && pair !== 'overdue' && !marked) future = true;
		out.push({ date: fromDayNumber(start), glyph, face: pair, future, done: donep });
	}
	return out;
}

export interface HabitStats {
	/** Completions in a row, each within the habit's window of the one before, up to now. */
	streak: number;
	/** Completions in the last `days` days (today included). */
	done: number;
	/** How many the schedule asks for in that time. */
	expected: number;
	/** done / expected, at most 1. */
	rate: number;
	lastDone: string | null;
	/** The longest gap allowed: the deadline period if there is one, else the repeat. */
	window: number;
}

/** A habit's streak and completion rate, from its logged completions. */
export function habitStats(
	h: Habit,
	today: string,
	days = HABIT_PRECEDING_DAYS + HABIT_FOLLOWING_DAYS,
): HabitStats {
	const now = toDayNumber(today);
	const window = h.deadlineRepeat ?? h.repeat;
	const done = [...new Set(h.done)].filter((d) => d <= now).sort((a, b) => a - b);
	const last = done.at(-1) ?? null;
	let streak = 0;
	if (last !== null && now - last <= window) {
		streak = 1;
		for (let i = done.length - 1; i > 0; i -= 1) {
			if (done[i]! - done[i - 1]! > window) break;
			streak += 1;
		}
	}
	const recent = done.filter((d) => d > now - days).length;
	const expected = Math.max(1, Math.floor(days / h.repeat));
	return {
		streak,
		done: recent,
		expected,
		rate: Math.min(1, recent / expected),
		lastDone: last === null ? null : fromDayNumber(last),
		window,
	};
}

/** The schedule in words: "Every day", "Every 2–4 days", "Every week". */
export function habitRhythm(h: Habit): string {
	const every = (n: number) =>
		n === 1 ? 'day' : n === 7 ? 'week' : n % 7 === 0 ? `${n / 7} weeks` : `${n} days`;
	if (h.deadlineRepeat) {
		const unit = h.repeat % 7 === 0 && h.deadlineRepeat % 7 === 0 ? 7 : 1;
		const word = unit === 7 ? 'weeks' : 'days';
		return `Every ${h.repeat / unit}–${h.deadlineRepeat / unit} ${word}`;
	}
	return `Every ${every(h.repeat)}`;
}

/**
 * Turn the entry at `offset` into a habit, as org-habit wants one: `:STYLE:
 * habit`, and a repeating SCHEDULED date. A schedule without a repeat gets
 * `.+1d` (every day, counted from when it's done); no schedule gets today,
 * `.+1d`. A repeat it already has is kept. Returns the new source.
 */
export function makeHabit(
	source: string,
	offset: number,
	today: string,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): string {
	const scheduled = getPlanning(source, offset, config).SCHEDULED;
	let s = source;
	if (!scheduled?.repeater) {
		const ts = scheduled
			? withTimestamp(scheduled, { repeater: '.+1d' })
			: makeTimestamp({ date: today, repeater: '.+1d', active: true });
		s = applyChanges(s, setPlanning(s, offset, 'SCHEDULED', ts, config));
	}
	return applyChanges(s, setProperty(s, offset, 'STYLE', 'habit', config));
}

/** Stop the entry at `offset` being a habit: its `STYLE` goes; the schedule stays. */
export function unmakeHabit(
	source: string,
	offset: number,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): string {
	return applyChanges(source, setProperty(source, offset, 'STYLE', null, config));
}
