/// Quick add: a task written in plain language, read into org.
///
///   Call Sam tomorrow 3pm #work !A every week ~30m
///   → * TODO [#A] Call Sam  :work:   SCHEDULED: <… Fri 15:00 +1w>   :Effort: 0:30
///
/// A small fixed grammar (English words), no guessing service: tags (#work),
/// priority (!A–!C or !1–!3), a leading TODO keyword, dates (today,
/// tomorrow and tom/tmrw/2moro, the day after tomorrow, tonight, weekdays,
/// next week, this weekend, end of the week/month/year, in 3 days, 3 days
/// from now, the 13th, nov 4, 11/20, ISO), parts of the day (tomorrow
/// morning, this evening), times and ranges (3pm, 3p, 3 p.m., 15:00, at 3,
/// 3-4pm, noon), deadlines (due/by/deadline + a date), repeats (every
/// day/2 weeks/monday/other friday/1st, biweekly, daily, weekly…, and every
/// third Friday or last Monday as an org diary sexp) and effort (~30m,
/// ~1h30). A bare "at 3" means the afternoon (1–7) or the morning (8–11).
/// Words that only look like dates (Tom, sat, the sun) stay words. Words in "quotes" are kept as they are. Every recognised
/// part keeps its place in the text, so it can be shown, and undone by
/// passing its start in `keep`.

import { addDays } from './date';
import { headlineAt, setHeadlineTags, setPriority, setTodoKeyword } from './headline';
import { setPlanning } from './planning';
import { getProperty, setProperty } from './properties';
import { applyChanges } from './text';
import { addSession } from './sessions';
import { makeTimestamp } from './timestamp';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig, type OrgTimestamp } from './types';

export type QuickPartKind =
	'tag' | 'priority' | 'state' | 'date' | 'deadline' | 'time' | 'repeat' | 'effort';

export interface QuickPart {
	kind: QuickPartKind;
	/** Where it is in the text (`from` identifies it, to keep it as words). */
	from: number;
	to: number;
	text: string;
}

export interface QuickWhen {
	date: string;
	time: string | null;
	endTime: string | null;
}

export interface QuickAdd {
	/** What's left once the recognised parts are taken out. */
	title: string;
	/** A keyword the text starts with, or null for the template's own. */
	todo: string | null;
	priority: string | null;
	tags: string[];
	scheduled: QuickWhen | null;
	deadline: QuickWhen | null;
	/** An org repeater cookie, e.g. `+1w`. */
	repeater: string | null;
	/**
	 * A repeat no org repeater can say, as an org diary sexp (the inside of
	 * `<…>`): `%%(diary-float t 5 3)` for every third Friday. Org's agenda
	 * shows the entry on each day it matches; a time goes at the start of the
	 * title (`19:00 Book club`), where org's agenda looks for it.
	 */
	diary: string | null;
	/** Effort in minutes. */
	effort: number | null;
	parts: QuickPart[];
}

export interface QuickAddOptions {
	/** `YYYY-MM-DD`, what "today" means. */
	today: string;
	/** The vault's keywords: a text starting with one sets the state. */
	keywords?: KeywordConfig;
	/** Starts (`from`) of recognised parts to keep as words instead. */
	keep?: readonly number[];
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUMBER_WORDS: Record<string, number> = {
	a: 1,
	an: 1,
	one: 1,
	two: 2,
	three: 3,
	four: 4,
	five: 5,
	six: 6,
	seven: 7,
	eight: 8,
	nine: 9,
	ten: 10,
};

// Pieces of the grammar, as regular-expression source.
const WEEKDAY =
	'(?:mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)';
const MONTH =
	'(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const COUNT = '(?:\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten)';
const TOMORROW = '(?:tomorrow|tmrw?|tomo|tom|2moro|2morrow)';
const ORDINAL_DAY = '\\d{1,2}(?:st|nd|rd|th)';
const NTH = '(?:first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)';
const PART_OF_DAY = '(?:morning|afternoon|evening|night)';
const DATE = [
	'today',
	'(?:the\\s+)?day\\s+after\\s+tomorrow',
	TOMORROW,
	'tonight|tonite',
	`this\\s+${PART_OF_DAY}`,
	'(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?(?:week|month|year)',
	`${COUNT}\\s+(?:days?|weeks?|months?)\\s+from\\s+(?:now|today|tomorrow)`,
	`(?:next|this)\\s+${WEEKDAY}`,
	WEEKDAY,
	'next\\s+week',
	'(?:this\\s+)?weekend',
	'next\\s+month',
	`in\\s+${COUNT}\\s+(?:days?|weeks?|months?)`,
	`${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
	`\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:\\s+\\d{4})?`,
	'\\d{4}-\\d{2}-\\d{2}',
	'\\d{1,2}/\\d{1,2}(?:/\\d{2}(?:\\d{2})?)?',
	`(?:the\\s+)?${ORDINAL_DAY}`,
].join('|');
const CLOCK12 = '\\d{1,2}(?::\\d{2})?(?:\\s*[ap]\\.?m\\.?|[ap])';
const CLOCK24 = '\\d{1,2}:\\d{2}';
const RANGE = `\\d{1,2}(?::\\d{2})?\\s*(?:[ap]\\.?m\\.?)?\\s*(?:-|–|to)\\s*${CLOCK12}|${CLOCK24}\\s*(?:-|–|to)\\s*${CLOCK24}`;
const TIME = `${RANGE}|${CLOCK12}|${CLOCK24}|noon|midnight`;

/** Whole words only: not inside another word, a #tag or a number. */
const word = (body: string) => new RegExp(`(?<![\\w#:@-])(?:${body})(?![\\w])`, 'gi');

/** The weekday index (0 = Sunday) a word names. */
function weekdayIndex(text: string): number {
	// Whole weekday words only: "month" isn't "mon".
	if (!new RegExp(`^${WEEKDAY}$`, 'i').test(text)) return -1;
	return WEEKDAYS.indexOf(text.slice(0, 3).toLowerCase());
}

function weekday(iso: string): number {
	return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/** The next `index` weekday on or after today (org-read-date's "fri"). */
function onOrAfter(today: string, index: number): string {
	return addDays(today, (index - weekday(today) + 7) % 7);
}

function addMonths(iso: string, months: number): string {
	const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
	const target = new Date(Date.UTC(y, m - 1 + months, 1));
	const last = new Date(
		Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
	).getUTCDate();
	target.setUTCDate(Math.min(d, last));
	return target.toISOString().slice(0, 10);
}

function count(text: string): number {
	return /^\d+$/.test(text) ? Number(text) : (NUMBER_WORDS[text.toLowerCase()] ?? 1);
}

/** A date phrase as `YYYY-MM-DD`, or null if it isn't one after all. */
function readDate(phrase: string, today: string): string | null {
	const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
	if (p === 'today' || /^(tonight|tonite|this (morning|afternoon|evening|night))$/.test(p))
		return today;
	if (/^(tomorrow|tmrw?|tomo|tom|2moro|2morrow)$/.test(p)) return addDays(today, 1);
	if (/^(the )?day after tomorrow$/.test(p)) return addDays(today, 2);
	let e = /^(?:the )?end of (?:the )?(week|month|year)$/.exec(p);
	if (e) {
		if (e[1] === 'week') return onOrAfter(today, 5);
		if (e[1] === 'year') return `${today.slice(0, 4)}-12-31`;
		return addDays(addMonths(today, 1).slice(0, 8) + '01', -1);
	}
	e = /^(\S+) (day|week|month)s? from (now|today|tomorrow)$/.exec(p);
	if (e) {
		const base = e[3] === 'tomorrow' ? addDays(today, 1) : today;
		const n = count(e[1]!);
		return e[2] === 'month' ? addMonths(base, n) : addDays(base, e[2] === 'week' ? n * 7 : n);
	}
	e = /^(?:the )?(\d{1,2})(?:st|nd|rd|th)$/.exec(p);
	if (e) return nextDayOfMonth(today, Number(e[1]));
	e = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(p);
	if (e) {
		// Month first, as people write it in the US; day first when it can't be a month.
		let [month, day] = [Number(e[1]), Number(e[2])];
		if (month > 12) [month, day] = [day, month];
		const year = e[3] ? Number(e[3].length === 2 ? `20${e[3]}` : e[3]) : Number(today.slice(0, 4));
		let iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		if (!e[3] && iso < today) iso = `${year + 1}${iso.slice(4)}`;
		return isRealDate(iso) ? iso : null;
	}
	if (p === 'next week') return onOrAfter(addDays(today, 1), 1);
	if (/^(this )?weekend$/.test(p)) return weekday(today) === 6 ? today : onOrAfter(today, 6);
	if (p === 'next month') return addMonths(today, 1).slice(0, 8) + '01';
	let m = /^(next|this) (\w+)$/.exec(p);
	if (m && weekdayIndex(m[2]!) !== -1) {
		const index = weekdayIndex(m[2]!);
		if (m[1] === 'this') return onOrAfter(today, index);
		// "next fri": Friday of next week (weeks start on Monday).
		const nextMonday = onOrAfter(addDays(today, 1), 1);
		return addDays(nextMonday, (index + 6) % 7);
	}
	if (/^[a-z]+$/.test(p) && weekdayIndex(p) !== -1) return onOrAfter(today, weekdayIndex(p));
	m = /^in (\S+) (day|week|month)s?$/.exec(p);
	if (m) {
		const n = count(m[1]!);
		return m[2] === 'month' ? addMonths(today, n) : addDays(today, m[2] === 'week' ? n * 7 : n);
	}
	m =
		/^([a-z]+)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/.exec(p) ??
		/^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)(?: (\d{4}))?$/.exec(p);
	if (m) {
		const [monthWord, dayText] = /^\d/.test(m[1]!) ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
		const month = MONTHS.indexOf(monthWord.slice(0, 3));
		const day = Number(dayText);
		if (month === -1 || day < 1 || day > 31) return null;
		const year = m[3] ? Number(m[3]) : Number(today.slice(0, 4));
		let iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
		// Without a year, a date already past this year means next year's.
		if (!m[3] && iso < today) iso = `${year + 1}${iso.slice(4)}`;
		return isRealDate(iso) ? iso : null;
	}
	if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return isRealDate(p) ? p : null;
	return null;
}

/** The next day-of-month `day` on or after today (skipping months too short for it). */
function nextDayOfMonth(today: string, day: number): string | null {
	if (day < 1 || day > 31) return null;
	for (let k = 0; k < 13; k += 1) {
		const month = addMonths(today.slice(0, 8) + '01', k);
		const iso = `${month.slice(0, 8)}${String(day).padStart(2, '0')}`;
		if (isRealDate(iso) && iso >= today) return iso;
	}
	return null;
}

function isRealDate(iso: string): boolean {
	const d = new Date(`${iso}T12:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** `3pm`, `15:00`, `noon` → `HH:MM`; `fallback` gives a missing am/pm. */
function readClock(text: string, fallback?: 'am' | 'pm'): string | null {
	const t = text
		.toLowerCase()
		.replace(/\s+|\./g, '')
		.replace(/([ap])$/, '$1m');
	if (t === 'noon') return '12:00';
	if (t === 'midnight') return '00:00';
	const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
	if (!m) return null;
	let h = Number(m[1]);
	const min = Number(m[2] ?? 0);
	const half = (m[3] as 'am' | 'pm' | undefined) ?? (m[2] === undefined ? fallback : undefined);
	if (min > 59) return null;
	if (half) {
		if (h < 1 || h > 12) return null;
		if (half === 'pm' && h !== 12) h += 12;
		if (half === 'am' && h === 12) h = 0;
	} else if (h > 23) return null;
	return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

/** A time or range phrase → start and end (`HH:MM`), or null. */
function readTime(phrase: string): { time: string; endTime: string | null } | null {
	const parts = phrase.split(/\s*(?:-|–|\bto\b)\s*/i);
	if (parts.length === 2) {
		const endHalf = /(am|pm)\s*$/i.exec(parts[1]!)?.[1]?.toLowerCase() as 'am' | 'pm' | undefined;
		const end = readClock(parts[1]!);
		let start = readClock(parts[0]!, endHalf);
		// "11-1pm": the start is the morning before an afternoon end.
		if (start && end && start > end && endHalf === 'pm' && !/am|pm/i.test(parts[0]!))
			start = readClock(parts[0]!, 'am');
		return start && end && end > start ? { time: start, endTime: end } : null;
	}
	const time = readClock(phrase);
	return time ? { time, endTime: null } : null;
}

/** When "tomorrow morning" and the like start. */
const PART_TIMES: Record<string, string> = {
	morning: '09:00',
	afternoon: '14:00',
	evening: '18:00',
	night: '20:00',
};

const NTH_NUMBER: Record<string, number> = {
	first: 1,
	'1st': 1,
	second: 2,
	'2nd': 2,
	third: 3,
	'3rd': 3,
	fourth: 4,
	'4th': 4,
	fifth: 5,
	'5th': 5,
	last: -1,
};

/**
 * A repeat phrase → an org repeater and the day it starts ("every monday",
 * "every 1st"), or a diary sexp for what no repeater can say ("every third
 * friday": `diary-float`, which org's agenda reads).
 */
function readRepeat(
	phrase: string,
	today: string,
): { repeater?: string; date?: string; diary?: string } | null {
	const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
	const simple: Record<string, string> = {
		daily: '+1d',
		weekly: '+1w',
		biweekly: '+2w',
		fortnightly: '+2w',
		'every fortnight': '+2w',
		monthly: '+1m',
		yearly: '+1y',
		annually: '+1y',
		'every weekday': '+1d',
	};
	if (simple[p]) return { repeater: simple[p] };
	let m = /^(?:every|on the|the) (\w+) (\w+)(?: of (?:the|each|every) month)?$/.exec(p);
	if (m && NTH_NUMBER[m[1]!] !== undefined && weekdayIndex(m[2]!) !== -1)
		return { diary: `%%(diary-float t ${weekdayIndex(m[2]!)} ${NTH_NUMBER[m[1]!]})` };
	m =
		/^(?:every (?:month )?on the|every|monthly on the) (\d{1,2})(?:st|nd|rd|th)(?: of (?:the|each|every) month)?$/.exec(
			p,
		);
	if (m) {
		const date = nextDayOfMonth(today, Number(m[1]));
		return date ? { repeater: '+1m', date } : null;
	}
	m = /^every other (\w+)$/.exec(p);
	if (m && weekdayIndex(m[1]!) !== -1)
		return { repeater: '+2w', date: onOrAfter(today, weekdayIndex(m[1]!)) };
	m = /^every (other )?(?:(\S+) )?(day|week|month|year)s?$/.exec(p);
	if (m) {
		const n = m[1] ? 2 : m[2] ? count(m[2]) : 1;
		return { repeater: `+${n}${m[3]![0]}` };
	}
	m = /^every (\w+)$/.exec(p);
	if (m && weekdayIndex(m[1]!) !== -1)
		return { repeater: '+1w', date: onOrAfter(today, weekdayIndex(m[1]!)) };
	return null;
}

function readEffort(text: string): number | null {
	const m =
		/^~(?:(\d+(?:\.\d+)?)\s*h(?:rs?|ours?)?\s*(?:(\d+)\s*(?:m(?:in)?)?)?|(\d+)\s*m(?:in)?)$/i.exec(
			text.replace(/\s+/g, ''),
		);
	if (!m) return null;
	const minutes = m[3] ? Number(m[3]) : Math.round(Number(m[1]) * 60) + Number(m[2] ?? 0);
	return minutes > 0 ? minutes : null;
}

/** Read a quick-add line. */
export function parseQuickAdd(text: string, options: QuickAddOptions): QuickAdd {
	const { today } = options;
	const keep = new Set(options.keep ?? []);
	const keywords = options.keywords ?? DEFAULT_KEYWORD_CONFIG;
	/** Characters already claimed by a part (or a quoted literal). */
	const taken = new Array<boolean>(text.length).fill(false);
	const free = (from: number, to: number) => {
		for (let i = from; i < to; i += 1) if (taken[i]) return false;
		return true;
	};
	const claim = (from: number, to: number) => {
		for (let i = from; i < to; i += 1) taken[i] = true;
	};
	const parts: QuickPart[] = [];
	const result: QuickAdd = {
		title: '',
		todo: null,
		priority: null,
		tags: [],
		scheduled: null,
		deadline: null,
		repeater: null,
		diary: null,
		effort: null,
		parts,
	};
	let scheduledDate: string | null = null;
	let scheduledTime: { time: string; endTime: string | null } | null = null;
	/** A time from a part of the day ("tomorrow evening"), if no clock time is given. */
	let partTime: string | null = null;
	/** A clock time right after `at` (so "sat 1pm" is a day, "I sat down" isn't). */
	const timeFollows = (at: number) => /^\s+(?:at\s+)?\d/.test(text.slice(at));

	// Quoted words are literal: claimed, kept in the title (without quotes).
	const literal = new Set<number>();
	for (const m of text.matchAll(/"[^"]*"/g)) {
		claim(m.index, m.index + m[0].length);
		literal.add(m.index);
	}

	/**
	 * Each match of `re` that's still free becomes a part, unless the person
	 * chose to keep it as words. `apply` returns false when the match turns out
	 * not to mean anything (an impossible date), leaving it as words.
	 */
	const scan = (
		re: RegExp,
		kind: QuickPartKind,
		apply: (m: RegExpMatchArray) => boolean,
		at = (m: RegExpMatchArray) => ({ from: m.index!, to: m.index! + m[0].length }),
	) => {
		for (const m of text.matchAll(re)) {
			const { from, to } = at(m);
			if (!free(from, to)) continue;
			if (keep.has(from)) {
				claim(from, to);
				literal.add(from);
				continue;
			}
			if (!apply(m)) continue;
			claim(from, to);
			parts.push({ kind, from, to, text: text.slice(from, to) });
		}
	};

	// A leading keyword: "NEXT call Sam".
	const lead = /^\s*([A-Z][A-Z0-9_-]*)\b/.exec(text);
	const all = [...keywords.todoKeywords, ...keywords.doneKeywords];
	if (lead && all.includes(lead[1]!)) {
		const from = lead.index + lead[0].indexOf(lead[1]!);
		const to = from + lead[1]!.length;
		if (keep.has(from)) {
			claim(from, to);
			literal.add(from);
		} else {
			result.todo = lead[1]!;
			claim(from, to);
			parts.push({ kind: 'state', from, to, text: lead[1]! });
		}
	}

	scan(/(?<![\w#])#([\w@-]+(?::[\w@-]+)*)/g, 'tag', (m) => {
		for (const t of m[1]!.split(':')) if (t && !result.tags.includes(t)) result.tags.push(t);
		return true;
	});
	scan(/(?<![\w!])!([A-Ca-c1-3])(?![\w])/g, 'priority', (m) => {
		const p = m[1]!.toUpperCase();
		result.priority = ({ '1': 'A', '2': 'B', '3': 'C' } as Record<string, string>)[p] ?? p;
		return true;
	});
	scan(
		/(?<![\w~])~\s*(?:\d+(?:\.\d+)?\s*h(?:rs?|ours?)?(?:\s*\d+\s*(?:m(?:in)?)?)?|\d+\s*m(?:in)?)(?![\w])/gi,
		'effort',
		(m) => {
			const minutes = readEffort(m[0]);
			if (minutes === null) return false;
			result.effort = minutes;
			return true;
		},
	);
	// Deadlines first, so "due fri" isn't read as a plain date.
	scan(
		word(`(?:due|by|deadline)(?:\\s+on)?\\s+(?:${DATE})(?:\\s+(?:at\\s+)?(?:${TIME}))?`),
		'deadline',
		(m) => {
			if (result.deadline) return false;
			const rest = m[0].replace(/^(?:due|by|deadline)(?:\s+on)?\s+/i, '');
			const t = new RegExp(`(?:\\s+(?:at\\s+)?)(${TIME})$`, 'i').exec(rest);
			const datePhrase = t ? rest.slice(0, t.index) : rest;
			const date = readDate(datePhrase, today);
			if (!date) return false;
			const time = t ? readTime(t[1]!) : null;
			result.deadline = { date, time: time?.time ?? null, endTime: time?.endTime ?? null };
			return true;
		},
	);
	scan(
		word(
			[
				`every\\s+${NTH}\\s+${WEEKDAY}(?:\\s+of\\s+(?:the|each|every)\\s+month)?`,
				`(?:on\\s+)?the\\s+${NTH}\\s+${WEEKDAY}\\s+of\\s+(?:each|every)\\s+month`,
				`(?:every\\s+(?:month\\s+)?on\\s+the|every|monthly\\s+on\\s+the)\\s+${ORDINAL_DAY}(?:\\s+of\\s+(?:the|each|every)\\s+month)?`,
				`every\\s+other\\s+${WEEKDAY}`,
				'biweekly|fortnightly|every\\s+fortnight',
				`every\\s+(?:other\\s+)?(?:${COUNT}\\s+)?(?:days?|weeks?|months?|years?)`,
				`every\\s+${WEEKDAY}`,
				'every\\s+weekday|daily|weekly|monthly|yearly|annually',
			].join('|'),
		),
		'repeat',
		(m) => {
			if (result.repeater || result.diary) return false;
			const r = readRepeat(m[0].replace(/^on\s+/i, ''), today);
			if (!r) return false;
			if (r.diary) result.diary = r.diary;
			if (r.repeater) result.repeater = r.repeater;
			if (r.date && !scheduledDate) scheduledDate = r.date;
			return true;
		},
	);
	scan(word(`(?:on\\s+)?(?:${DATE})(?:\\s+${PART_OF_DAY})?`), 'date', (m) => {
		if (scheduledDate && parts.some((p) => p.kind === 'date')) return false;
		let phrase = m[0].replace(/^on\s+/i, '');
		const part = new RegExp(`\\s+(${PART_OF_DAY})$`, 'i').exec(phrase);
		if (part && !/^this\s/i.test(phrase)) phrase = phrase.slice(0, part.index);
		const bare = phrase.trim();
		// "Tom" is a name; only "tom" is tomorrow.
		if (/^tom$/i.test(bare) && bare !== 'tom') return false;
		// "sat", "sun" and "wed" are words too: a day only after "on" or before a time.
		if (
			/^(sun|sat|wed)$/i.test(bare) &&
			!/^on\s/i.test(m[0]) &&
			!timeFollows(m.index! + m[0].length)
		)
			return false;
		const date = readDate(phrase, today);
		if (!date) return false;
		scheduledDate = date;
		const partWord = part?.[1] ?? (/^(?:tonight|tonite)$/i.test(bare) ? 'night' : null);
		if (partWord) partTime = PART_TIMES[partWord.toLowerCase()] ?? null;
		return true;
	});
	scan(word(`(?:at\\s+|from\\s+)?(?:${TIME})|at\\s+\\d{1,2}`), 'time', (m) => {
		if (scheduledTime) return false;
		// "at 3": the afternoon for 1–7, the morning for 8–11, as people mean it.
		const bare = /^at\s+(\d{1,2})$/i.exec(m[0]);
		if (bare) {
			let h = Number(bare[1]);
			if (h >= 1 && h <= 7) h += 12;
			if (h > 23) return false;
			scheduledTime = { time: `${String(h).padStart(2, '0')}:00`, endTime: null };
			return true;
		}
		const t = readTime(m[0].replace(/^(?:at|from)\s+/i, ''));
		if (!t) return false;
		scheduledTime = t;
		return true;
	});

	// Set inside the scans' callbacks, which TypeScript doesn't follow.
	const found =
		(scheduledTime as { time: string; endTime: string | null } | null) ??
		(partTime ? { time: partTime as string, endTime: null } : null);
	let atStart = '';
	if (result.diary) {
		// Org's agenda takes a diary entry's time from its heading.
		if (found) atStart = `${found.time}${found.endTime ? `-${found.endTime}` : ''} `;
		if (scheduledDate) result.scheduled = { date: scheduledDate, time: null, endTime: null };
	} else if (scheduledDate || found || (result.repeater && !result.deadline)) {
		// A time alone is today's; a repeat alone starts today.
		result.scheduled = {
			date: scheduledDate ?? today,
			time: found?.time ?? null,
			endTime: found?.endTime ?? null,
		};
	}

	// The title: everything not claimed by a part (quoted words without quotes).
	let title = '';
	for (let i = 0; i < text.length; i += 1) {
		const part = parts.find((p) => p.from === i);
		if (part) {
			title += ' ';
			i = part.to - 1;
			continue;
		}
		if (literal.has(i) && text[i] === '"') {
			const end = text.indexOf('"', i + 1);
			title += text.slice(i + 1, end === -1 ? undefined : end);
			i = end === -1 ? text.length : end;
			continue;
		}
		title += text[i];
	}
	result.title =
		atStart +
		title
			.replace(/\s+/g, ' ')
			.replace(/\s+([,.;:!?])/g, '$1')
			.replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
			.trim();
	parts.sort((a, b) => a.from - b.from);
	return result;
}

/** A recognised part in words, for its chip. */
export function describeQuickPart(part: QuickPart, q: QuickAdd, today: string): string {
	const day = (iso: string) => {
		if (iso === today) return 'Today';
		if (iso === addDays(today, 1)) return 'Tomorrow';
		return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, {
			weekday: 'short',
			day: 'numeric',
			month: 'short',
			timeZone: 'UTC',
		});
	};
	const when = (w: QuickWhen) =>
		`${day(w.date)}${w.time ? ` ${w.time}${w.endTime ? `–${w.endTime}` : ''}` : ''}`;
	switch (part.kind) {
		case 'tag':
			return part.text;
		case 'priority':
			return `Priority ${q.priority}`;
		case 'state':
			return part.text;
		case 'date':
			return q.scheduled ? day(q.scheduled.date) : part.text;
		case 'time':
			return q.scheduled?.time
				? `${q.scheduled.time}${q.scheduled.endTime ? `–${q.scheduled.endTime}` : ''}`
				: part.text;
		case 'deadline':
			return q.deadline ? `Due ${when(q.deadline)}` : part.text;
		case 'repeat': {
			const f = /diary-float t (\d) (-?\d)\)/.exec(q.diary ?? '');
			if (f) {
				const nth = ['last', '', 'first', 'second', 'third', 'fourth', 'fifth'][Number(f[2]) + 1];
				const dayName = [
					'Sunday',
					'Monday',
					'Tuesday',
					'Wednesday',
					'Thursday',
					'Friday',
					'Saturday',
				][Number(f[1])];
				return `Every ${nth} ${dayName} of the month`;
			}
			const m = /^\+(\d+)([dwmy])$/.exec(q.repeater ?? '');
			const unit = { d: 'day', w: 'week', m: 'month', y: 'year' }[m?.[2] as 'd'] ?? '';
			return m ? `Repeats every ${m[1] === '1' ? unit : `${m[1]} ${unit}s`}` : part.text;
		}
		case 'effort': {
			const e = q.effort ?? 0;
			return `${e >= 60 ? `${Math.floor(e / 60)} h` : ''}${e % 60 ? ` ${e % 60} min` : ''}`.trim();
		}
	}
}

/** org-tags-column's default (-77): a new heading's tags end at column 77. */
const TAGS_COLUMN = 77;

/** Right-align the first heading's tags as Emacs does by default (one space if it's too long). */
function alignTags(entry: string): string {
	const nl = entry.indexOf('\n');
	const line = nl === -1 ? entry : entry.slice(0, nl);
	const m = /^(.*?\S)[ \t]+(:[\w@#%:]+:)[ \t]*$/.exec(line);
	if (!m) return entry;
	const [, head, block] = m as unknown as [string, string, string];
	const pad = Math.max(1, TAGS_COLUMN - [...head].length - [...block].length);
	return `${head}${' '.repeat(pad)}${block}${nl === -1 ? '' : entry.slice(nl)}`;
}

/**
 * Apply a quick add to a captured entry (an `* TODO …` text whose title is
 * already `q.title`): its state, priority, tags, SCHEDULED (replacing the
 * template's own when the text gave one), DEADLINE and Effort.
 */
export function applyQuickAdd(
	entry: string,
	q: QuickAdd,
	config: KeywordConfig = DEFAULT_KEYWORD_CONFIG,
): string {
	let s = entry;
	const edit = (f: (src: string) => ReturnType<typeof setPriority>) => {
		s = applyChanges(s, f(s));
	};
	const h = headlineAt(s, 0, config);
	if (!h) return entry;
	if (q.todo) edit((src) => setTodoKeyword(src, 0, q.todo, config));
	if (q.priority) edit((src) => setPriority(src, 0, q.priority, config));
	if (q.tags.length) {
		const own = headlineAt(s, 0, config)?.tags?.values ?? [];
		edit((src) =>
			setHeadlineTags(src, 0, [...own, ...q.tags.filter((t) => !own.includes(t))], config),
		);
		s = alignTags(s);
	}
	const stamp = (w: QuickWhen, repeater: string | null) =>
		makeTimestamp({ date: w.date, time: w.time, endTime: w.endTime, repeater, active: true });
	if (q.scheduled)
		edit((src) => setPlanning(src, 0, 'SCHEDULED', stamp(q.scheduled!, q.repeater), config));
	else if ((q.deadline || q.diary) && /SCHEDULED:/.test(s))
		// Due a day, with no day to start: the template's "scheduled today" goes.
		edit((src) => setPlanning(src, 0, 'SCHEDULED', null, config));
	if (q.deadline)
		edit((src) =>
			setPlanning(src, 0, 'DEADLINE', stamp(q.deadline!, q.scheduled ? null : q.repeater), config),
		);
	// A diary repeat goes in the entry's text, a line of its own, where org's agenda reads it.
	if (q.diary) {
		const raw = `<${q.diary}>`;
		edit((src) => addSession(src, 0, { raw } as OrgTimestamp, config));
	}
	if (q.effort !== null && getProperty(s, 0, 'Effort', config) === null) {
		const e = q.effort;
		edit((src) =>
			setProperty(
				src,
				0,
				'Effort',
				`${Math.floor(e / 60)}:${String(e % 60).padStart(2, '0')}`,
				config,
			),
		);
	}
	return s;
}
