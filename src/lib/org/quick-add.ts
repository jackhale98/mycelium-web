/// Quick add: a task written in plain language, read into org.
///
///   Call Sam tomorrow 3pm #work !A every week ~30m
///   → * TODO [#A] Call Sam  :work:   SCHEDULED: <… Fri 15:00 +1w>   :Effort: 0:30
///
/// A small fixed grammar (English words), no guessing service: tags (#work),
/// priority (!A–!C or !1–!3), a leading TODO keyword, dates (today,
/// tomorrow, weekdays, next week, this weekend, in 3 days, nov 4, ISO), times
/// and ranges (3pm, 15:00, 3-4pm, noon), deadlines (due/by/deadline + a
/// date), repeats (every day/2 weeks/monday, daily, weekly…) and effort
/// (~30m, ~1h30). Words in "quotes" are kept as they are. Every recognised
/// part keeps its place in the text, so it can be shown, and undone by
/// passing its start in `keep`.

import { addDays } from './date';
import { headlineAt, setHeadlineTags, setPriority, setTodoKeyword } from './headline';
import { setPlanning } from './planning';
import { getProperty, setProperty } from './properties';
import { applyChanges } from './text';
import { makeTimestamp } from './timestamp';
import { DEFAULT_KEYWORD_CONFIG, type KeywordConfig } from './types';

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
const DATE = [
	'today',
	'tomorrow',
	'tmrw?',
	`(?:next|this)\\s+${WEEKDAY}`,
	WEEKDAY,
	'next\\s+week',
	'(?:this\\s+)?weekend',
	'next\\s+month',
	`in\\s+${COUNT}\\s+(?:days?|weeks?|months?)`,
	`${MONTH}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?`,
	`\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH}(?:\\s+\\d{4})?`,
	'\\d{4}-\\d{2}-\\d{2}',
].join('|');
const CLOCK12 = '\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)';
const CLOCK24 = '\\d{1,2}:\\d{2}';
const RANGE = `\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?\\s*(?:-|–|to)\\s*${CLOCK12}|${CLOCK24}\\s*(?:-|–|to)\\s*${CLOCK24}`;
const TIME = `${RANGE}|${CLOCK12}|${CLOCK24}|noon|midnight`;

/** Whole words only: not inside another word, a #tag or a number. */
const word = (body: string) => new RegExp(`(?<![\\w#:@-])(?:${body})(?![\\w])`, 'gi');

/** The weekday index (0 = Sunday) a word names. */
function weekdayIndex(text: string): number {
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
	if (p === 'today') return today;
	if (/^(tomorrow|tmrw?)$/.test(p)) return addDays(today, 1);
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

function isRealDate(iso: string): boolean {
	const d = new Date(`${iso}T12:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso;
}

/** `3pm`, `15:00`, `noon` → `HH:MM`; `fallback` gives a missing am/pm. */
function readClock(text: string, fallback?: 'am' | 'pm'): string | null {
	const t = text.toLowerCase().replace(/\s+/g, '');
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

/** A repeat phrase → an org repeater and, for "every monday", the day it starts. */
function readRepeat(phrase: string, today: string): { repeater: string; date?: string } | null {
	const p = phrase.toLowerCase().replace(/\s+/g, ' ').trim();
	const simple: Record<string, string> = {
		daily: '+1d',
		weekly: '+1w',
		monthly: '+1m',
		yearly: '+1y',
		annually: '+1y',
		'every weekday': '+1d',
	};
	if (simple[p]) return { repeater: simple[p] };
	let m = /^every (other )?(?:(\S+) )?(day|week|month|year)s?$/.exec(p);
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
		effort: null,
		parts,
	};
	let scheduledDate: string | null = null;
	let scheduledTime: { time: string; endTime: string | null } | null = null;

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
			`every\\s+(?:other\\s+)?(?:${COUNT}\\s+)?(?:days?|weeks?|months?|years?)|every\\s+${WEEKDAY}|every\\s+weekday|daily|weekly|monthly|yearly|annually`,
		),
		'repeat',
		(m) => {
			if (result.repeater) return false;
			const r = readRepeat(m[0], today);
			if (!r) return false;
			result.repeater = r.repeater;
			if (r.date && !scheduledDate) scheduledDate = r.date;
			return true;
		},
	);
	scan(word(`(?:on\\s+)?(?:${DATE})`), 'date', (m) => {
		if (scheduledDate && parts.some((p) => p.kind === 'date')) return false;
		const date = readDate(m[0].replace(/^on\s+/i, ''), today);
		if (!date) return false;
		scheduledDate = date;
		return true;
	});
	scan(word(`(?:at\\s+|from\\s+)?(?:${TIME})`), 'time', (m) => {
		if (scheduledTime) return false;
		const t = readTime(m[0].replace(/^(?:at|from)\s+/i, ''));
		if (!t) return false;
		scheduledTime = t;
		return true;
	});

	if (scheduledDate || scheduledTime || (result.repeater && !result.deadline)) {
		// A time alone is today's; a repeat alone starts today.
		const date = scheduledDate ?? today;
		// Set inside the scans' callbacks, which TypeScript doesn't follow.
		const found = scheduledTime as { time: string; endTime: string | null } | null;
		result.scheduled = {
			date,
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
	result.title = title
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
	else if (q.deadline && /SCHEDULED:/.test(s))
		// Due a day, with no day to start: the template's "scheduled today" goes.
		edit((src) => setPlanning(src, 0, 'SCHEDULED', null, config));
	if (q.deadline)
		edit((src) =>
			setPlanning(src, 0, 'DEADLINE', stamp(q.deadline!, q.scheduled ? null : q.repeater), config),
		);
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
