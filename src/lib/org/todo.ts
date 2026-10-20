/// TODO state changes with org's completion semantics.
///
/// Marking a task done stamps `CLOSED:` (when `logDone` is on, as with
/// `org-log-done 'time`). Completing a *repeating* task does not close it: its
/// SCHEDULED/DEADLINE dates move to the next occurrence and it returns to a
/// not-done state, so the next occurrence stays on the agenda.

import { addHours, compareDates, shiftDate } from './date';
import { headlineAt, setTodoKeyword } from './headline';
import { findPlanning, setPlanning } from './planning';
import { nowTimestamp, withTimestamp } from './timestamp';
import { runEdits, splitLines, type EditResult } from './text';
import type { KeywordConfig, OrgNow, OrgTimestamp, PlanningKind, RepeaterCookie } from './types';

const COOKIE_RE = /^(\+\+|\.\+|\+)(\d+)([hdwmy])/;

export function parseRepeater(cookie: string | null | undefined): RepeaterCookie | null {
	const m = cookie ? COOKIE_RE.exec(cookie) : null;
	if (!m) return null;
	const value = Number(m[2]);
	if (!Number.isFinite(value) || value <= 0) return null;
	return {
		raw: cookie!,
		type: m[1] === '++' ? 'catch-up' : m[1] === '.+' ? 'restart' : 'cumulate',
		value,
		unit: m[3] as RepeaterCookie['unit'],
	};
}

function shiftOnce(
	date: string,
	time: string | null,
	cookie: RepeaterCookie,
): [string, string | null] {
	if (cookie.unit === 'h') {
		const shifted = addHours(date, time, cookie.value);
		return [shifted.date, shifted.time];
	}
	return [shiftDate(date, cookie.value, cookie.unit), time];
}

/**
 * Next occurrence of a repeating timestamp:
 * `+1w` shifts once from the stored date, `++1w` shifts until strictly after
 * today, `.+1w` shifts from today.
 */
export function nextOccurrence(ts: OrgTimestamp, now: OrgNow): OrgTimestamp {
	const cookie = parseRepeater(ts.repeater);
	if (!cookie) return ts;
	if (cookie.type === 'restart') {
		const [date, time] = shiftOnce(now.date, ts.time, cookie);
		return withTimestamp(ts, { date, time });
	}
	let [date, time] = shiftOnce(ts.date, ts.time, cookie);
	if (cookie.type === 'catch-up') {
		for (let i = 0; i < 10000 && compareDates(date, now.date) <= 0; i += 1) {
			[date, time] = shiftOnce(date, time, cookie);
		}
	}
	return withTimestamp(ts, { date, time });
}

export interface TodoChangeOptions {
	config: KeywordConfig;
	now: OrgNow;
	/** Stamp `CLOSED:` on completion (org-log-done). Defaults to `true`. */
	logDone?: boolean;
}

export interface TodoChangeResult extends EditResult {
	/** `true` when a repeating task was rescheduled instead of closed. */
	repeated: boolean;
	keyword: string | null;
}

const isDone = (kw: string | null, config: KeywordConfig) =>
	kw !== null && config.doneKeywords.includes(kw);

/** Change a headline's TODO state, applying CLOSED stamps and repeaters. */
export function changeTodoState(
	source: string,
	offset: number,
	keyword: string | null,
	options: TodoChangeOptions,
): TodoChangeResult {
	const { config, now } = options;
	const logDone = options.logDone ?? true;
	const lines = splitLines(source);
	const h = headlineAt(source, offset, config, lines);
	if (!h) return { text: source, steps: [], repeated: false, keyword: null };
	const lineFrom = h.line.from;
	const previous = h.keyword?.value ?? null;
	const planning = findPlanning(lines, h);
	const ts = (kind: PlanningKind) =>
		planning?.entries.find((e) => e.kind === kind)?.timestamp ?? null;

	if (isDone(keyword, config) && !isDone(previous, config)) {
		const repeating = (['DEADLINE', 'SCHEDULED'] as const).filter((k) =>
			parseRepeater(ts(k)?.repeater),
		);
		if (repeating.length > 0) {
			const back =
				previous && config.todoKeywords.includes(previous)
					? previous
					: (config.todoKeywords[0] ?? null);
			const result = runEdits(source, [
				...repeating.map(
					(kind) => (s: string) =>
						setPlanning(s, lineFrom, kind, nextOccurrence(ts(kind)!, now), config),
				),
				(s: string) => setPlanning(s, lineFrom, 'CLOSED', null, config),
				(s: string) => setTodoKeyword(s, lineFrom, back, config),
			]);
			return { ...result, repeated: true, keyword: back };
		}
		const result = runEdits(source, [
			(s: string) => setTodoKeyword(s, lineFrom, keyword, config),
			(s: string) => (logDone ? setPlanning(s, lineFrom, 'CLOSED', nowTimestamp(now), config) : []),
		]);
		return { ...result, repeated: false, keyword };
	}

	const reopening = isDone(previous, config) && !isDone(keyword, config);
	const result = runEdits(source, [
		(s: string) => setTodoKeyword(s, lineFrom, keyword, config),
		(s: string) => (reopening ? setPlanning(s, lineFrom, 'CLOSED', null, config) : []),
	]);
	return { ...result, repeated: false, keyword };
}
