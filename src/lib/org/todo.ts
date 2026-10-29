/// TODO state changes with org's completion semantics.
///
/// Behaviour follows org.el (`org-todo`, `org-auto-repeat-maybe`) with Emacs'
/// default options unless the vault or file says otherwise.

import { addHours, compareDates, shiftDate } from './date';
import { headlineAt, setTodoKeyword } from './headline';
import { addLogNote, entryEnd, startupLogSettings, stateNote } from './log';
import { findPlanning, setPlanning } from './planning';
import { getProperties, setProperty } from './properties';
import { nowTimestamp, readTimestamp, withTimestamp } from './timestamp';
import { runEdits, splitLines, type EditResult } from './text';
import {
	EMACS_LOG_DEFAULTS,
	type KeywordConfig,
	type LogSettings,
	type OrgNow,
	type OrgTimestamp,
	type RepeaterCookie,
} from './types';

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
	/** How changes are recorded. Defaults to Emacs' out-of-the-box behaviour. */
	log?: Partial<LogSettings>;
}

export interface TodoChangeResult extends EditResult {
	/** `true` when a repeating task was rescheduled instead of closed. */
	repeated: boolean;
	keyword: string | null;
}

const isDone = (kw: string | null, config: KeywordConfig) =>
	kw !== null && config.doneKeywords.includes(kw);

const ACTIVE_TS_RE = /<\d{4}-\d{2}-\d{2}[^>\n]*>/g;

/** Every active timestamp with a repeater between the headline and the next heading. */
function repeatingTimestamps(source: string, from: number, to: number) {
	const out: { from: number; to: number; ts: OrgTimestamp }[] = [];
	const text = source.slice(from, to);
	ACTIVE_TS_RE.lastIndex = 0;
	for (let m = ACTIVE_TS_RE.exec(text); m; m = ACTIVE_TS_RE.exec(text)) {
		const read = readTimestamp(text, m.index);
		if (read && parseRepeater(read.timestamp.repeater)) {
			out.push({ from: from + read.from, to: from + read.to, ts: read.timestamp });
		}
	}
	return out;
}

/**
 * Change a headline's TODO state with org's semantics (see `org-todo` and
 * `org-auto-repeat-maybe`):
 *
 * - entering a done state stamps `CLOSED:` when `logDone` is on;
 * - leaving a done state removes `CLOSED:`;
 * - completing a repeating task instead shifts every repeating timestamp in
 *   the entry, drops a non-repeating SCHEDULED, returns the task to
 *   `REPEAT_TO_STATE` (or the first TODO keyword), and with `logRepeat` (or
 *   for a habit, always) sets `LAST_REPEAT` and logs the transition;
 * - `#+TODO:` markers such as `DONE(d!)` or `WAIT(w@/!)` log state notes.
 */
export function changeTodoState(
	source: string,
	offset: number,
	keyword: string | null,
	options: TodoChangeOptions,
): TodoChangeResult {
	const { config, now } = options;
	const log: LogSettings = { ...EMACS_LOG_DEFAULTS, ...startupLogSettings(source), ...options.log };
	const lines = splitLines(source);
	const h = headlineAt(source, offset, config, lines);
	if (!h) return { text: source, steps: [], repeated: false, keyword: null };
	const at = h.line.from;
	const previous = h.keyword?.value ?? null;
	if (previous === keyword) return { text: source, steps: [], repeated: false, keyword };

	const stamp = nowTimestamp(now).raw;
	const stateLogged = (next: string | null) =>
		(next !== null && !!config.log?.[next]?.enter) ||
		(previous !== null && !!config.log?.[previous]?.leave);
	const note = (next: string | null) => (s: string) =>
		addLogNote(s, at, stateNote(next, previous, stamp), log.logIntoDrawer, config);

	if (isDone(keyword, config) && !isDone(previous, config)) {
		const end = entryEnd(lines, h);
		const repeats = repeatingTimestamps(source, h.line.end, end);
		if (repeats.length > 0) {
			const props = getProperties(source, at, config);
			const requested = props['REPEAT_TO_STATE'] ?? log.repeatToState;
			// A habit's history is its logged completions (org-habit needs them), so
			// they're always logged, whatever the vault's style is otherwise.
			const logRepeat = log.logRepeat || props['STYLE']?.trim() === 'habit';
			const all = [...config.todoKeywords, ...config.doneKeywords];
			const back =
				requested && all.includes(requested) ? requested : (config.todoKeywords[0] ?? null);
			const planning = findPlanning(lines, h);
			const scheduled = planning?.entries.find((e) => e.kind === 'SCHEDULED');
			const result = runEdits(source, [
				// Shift repeaters first: all their offsets refer to the original text.
				() =>
					repeats.map((r) => ({ from: r.from, to: r.to, insert: nextOccurrence(r.ts, now).raw })),
				(s) =>
					scheduled && !parseRepeater(scheduled.timestamp.repeater)
						? setPlanning(s, at, 'SCHEDULED', null, config)
						: [],
				(s) => setPlanning(s, at, 'CLOSED', null, config),
				(s) => (logRepeat ? setProperty(s, at, 'LAST_REPEAT', stamp, config) : []),
				(s) => (logRepeat || stateLogged(keyword) ? note(keyword)(s) : []),
				(s) => setTodoKeyword(s, at, back, config),
			]);
			return { ...result, repeated: true, keyword: back };
		}
		const result = runEdits(source, [
			(s) => (log.logDone ? setPlanning(s, at, 'CLOSED', nowTimestamp(now), config) : []),
			(s) => (stateLogged(keyword) ? note(keyword)(s) : []),
			(s) => setTodoKeyword(s, at, keyword, config),
		]);
		return { ...result, repeated: false, keyword };
	}

	const reopening = isDone(previous, config) && !isDone(keyword, config);
	const result = runEdits(source, [
		(s) => (reopening ? setPlanning(s, at, 'CLOSED', null, config) : []),
		(s) => (stateLogged(keyword) ? note(keyword)(s) : []),
		(s) => setTodoKeyword(s, at, keyword, config),
	]);
	return { ...result, repeated: false, keyword };
}
