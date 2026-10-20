/// Org's tag/property match strings (`org-make-tags-matcher`), as used by
/// agenda tag searches and filters:
///
///   +work-boss                 tags (inherited ones count)
///   work|laptop+night          `|` is OR; `&` (implicit) binds tighter
///   +{^boss.*}                 tag regexp
///   PRIORITY="A"  Effort<*2    property comparisons; `*` requires the property
///   DEADLINE<="<today>"        dates: <today> <now> <tomorrow> <+5d> <2026-10-20>
///   With={Sarah\|Denny}        property regexp
///   work/!-WAITING-NEXT        `/` matches TODO keywords; `!` = not-done TODOs only

import { addDays } from './date';
import type { OrgTimestamp } from './types';

type Op = '=' | '<' | '>' | '<=' | '>=' | '<>';
type Value =
	| { type: 'number'; value: number }
	| { type: 'string'; value: string }
	| { type: 'date'; value: string }
	| { type: 'regexp'; value: RegExp };

export type MatchTerm =
	| { neg: boolean; kind: 'tag'; tag: string }
	| { neg: boolean; kind: 'tag-regexp'; re: RegExp }
	| { neg: boolean; kind: 'prop'; name: string; op: Op; value: Value; starred: boolean };

/** OR of AND-groups. */
export type MatchExpr = MatchTerm[][];

export interface Matcher {
	tags: MatchExpr | null;
	todo: MatchExpr | null;
	/** `/!`: only entries with a not-done TODO keyword. */
	todoOnly: boolean;
}

export class MatchSyntaxError extends Error {}

const OPS: [string, Op][] = [
	['<=', '<='],
	['>=', '>='],
	['<>', '<>'],
	['!=', '<>'],
	['/=', '<>'],
	['==', '='],
	['=', '='],
	['<', '<'],
	['>', '>'],
];

function regexp(source: string): RegExp {
	try {
		// Emacs regexps write alternation as \| and groups as \( \); translate the common cases.
		return new RegExp(
			source.replace(/\\\|/g, '|').replace(/\\\(/g, '(').replace(/\\\)/g, ')'),
			'i',
		);
	} catch {
		throw new MatchSyntaxError(`Invalid regexp {${source}}`);
	}
}

function parseExpr(input: string, todo: boolean): MatchExpr {
	const groups: MatchExpr = [];
	for (const part of splitTop(input, '|')) {
		const terms: MatchTerm[] = [];
		let s = part;
		while (s.length) {
			s = s.replace(/^[&\s]+/, '');
			if (!s) break;
			let neg = false;
			if (s[0] === '+' || s[0] === '-') {
				neg = s[0] === '-';
				s = s.slice(1);
			}
			if (s[0] === '{') {
				const end = s.indexOf('}');
				if (end === -1) throw new MatchSyntaxError('Unclosed { in match');
				terms.push({ neg, kind: 'tag-regexp', re: regexp(s.slice(1, end)) });
				s = s.slice(end + 1);
				continue;
			}
			const prop = todo
				? null
				: /^((?:[\p{L}\p{N}_]|\\-)+)(<=|>=|<>|!=|\/=|==|=|<|>)(\*?)/u.exec(s);
			if (prop) {
				const op = OPS.find(([t]) => t === prop[2])![1];
				s = s.slice(prop[0].length);
				let value: Value;
				if (s[0] === '"') {
					const end = s.indexOf('"', 1);
					if (end === -1) throw new MatchSyntaxError('Unclosed " in match');
					const raw = s.slice(1, end);
					value = /^<.*>$/.test(raw)
						? { type: 'date', value: raw.slice(1, -1) }
						: { type: 'string', value: raw };
					s = s.slice(end + 1);
				} else if (s[0] === '{') {
					const end = s.indexOf('}');
					if (end === -1) throw new MatchSyntaxError('Unclosed { in match');
					value = { type: 'regexp', value: regexp(s.slice(1, end)) };
					s = s.slice(end + 1);
				} else {
					const num = /^-?\d+(?:\.\d+)?/.exec(s);
					if (!num) throw new MatchSyntaxError(`Expected a value after ${prop[1]}${prop[2]}`);
					value = { type: 'number', value: Number(num[0]) };
					s = s.slice(num[0].length);
				}
				terms.push({
					neg,
					kind: 'prop',
					name: prop[1]!.replace(/\\-/g, '-').toUpperCase(),
					op,
					value,
					starred: prop[3] === '*',
				});
				continue;
			}
			const word = /^[\p{L}\p{N}_@#%]+/u.exec(s);
			if (!word) throw new MatchSyntaxError(`Unexpected “${s[0]}” in match`);
			terms.push({ neg, kind: 'tag', tag: word[0] });
			s = s.slice(word[0].length);
		}
		if (terms.length) groups.push(terms);
	}
	return groups;
}

/** Split on `sep` outside braces and quotes. */
function splitTop(s: string, sep: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let quoted = false;
	let start = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === '"') quoted = !quoted;
		else if (!quoted && c === '{') depth++;
		else if (!quoted && c === '}') depth--;
		else if (!quoted && depth === 0 && c === sep && s[i - 1] !== '\\') {
			out.push(s.slice(start, i));
			start = i + 1;
		}
	}
	out.push(s.slice(start));
	return out;
}

/** Parse a match string. Throws {@link MatchSyntaxError} with a readable message. */
export function parseMatch(input: string): Matcher {
	const text = input.trim();
	// The TODO part starts at the first `/` outside braces, quotes and `\/`-escapes.
	const parts = splitTop(text, '/');
	const tagPart = parts[0] ?? '';
	let todoPart = parts.length > 1 ? parts.slice(1).join('/') : null;
	let todoOnly = false;
	if (todoPart !== null && todoPart.startsWith('!')) {
		todoOnly = true;
		todoPart = todoPart.slice(1);
	}
	const tags = tagPart.trim() ? parseExpr(tagPart, false) : null;
	const todo = todoPart && todoPart.trim() ? parseExpr(todoPart, true) : null;
	return { tags, todo, todoOnly };
}

// ---------------------------------------------------------------- matching

export interface MatchEntry {
	title: string;
	todo: string | null;
	priority: string | null;
	tags: string[];
	level: number;
	category: string;
	scheduled: OrgTimestamp | null;
	deadline: OrgTimestamp | null;
	closed: OrgTimestamp | null;
	file: string;
}

export interface MatchContext {
	/** Today's date and time, for `<today>`, `<now>` and relative dates. */
	now: { date: string; time: string };
	isDone: (keyword: string) => boolean;
	/** Other properties of the entry, read on demand (upper-case keys). */
	properties?: () => Record<string, string>;
	defaultPriority?: string;
}

/** Comparable minutes for a date/time, or null. */
function minutes(date: string, time?: string | null): number | null {
	const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
	if (!d) return null;
	const t = /^(\d{1,2}):(\d{2})/.exec(time ?? '') ?? ['', '0', '0'];
	return Date.UTC(+d[1]!, +d[2]! - 1, +d[3]!, +t[1]!, +t[2]!) / 60000;
}

function resolveDate(spec: string, ctx: MatchContext): number | null {
	const s = spec.trim();
	if (s === 'now') return minutes(ctx.now.date, ctx.now.time);
	if (s === 'today') return minutes(ctx.now.date);
	if (s === 'tomorrow') return minutes(addDays(ctx.now.date, 1));
	if (s === 'yesterday') return minutes(addDays(ctx.now.date, -1));
	const rel = /^([+-]\d+)([dwmy])$/.exec(s);
	if (rel) {
		const n = Number(rel[1]);
		const days = { d: 1, w: 7, m: 30, y: 365 }[rel[2] as 'd'] * n;
		return minutes(addDays(ctx.now.date, days));
	}
	const abs = /^(\d{4}-\d{2}-\d{2})(?:\s+\w+)?(?:\s+(\d{1,2}:\d{2}))?/.exec(s);
	return abs ? minutes(abs[1]!, abs[2]) : null;
}

function compare<T extends number | string>(a: T, op: Op, b: T): boolean {
	switch (op) {
		case '=':
			return a === b;
		case '<>':
			return a !== b;
		case '<':
			return a < b;
		case '>':
			return a > b;
		case '<=':
			return a <= b;
		case '>=':
			return a >= b;
	}
}

function property(name: string, e: MatchEntry, ctx: MatchContext): string | null {
	const ts = (t: OrgTimestamp | null) => t?.raw ?? null;
	switch (name) {
		case 'TODO':
			return e.todo;
		case 'LEVEL':
			return String(e.level);
		case 'PRIORITY':
			return e.priority ?? ctx.defaultPriority ?? 'B';
		case 'CATEGORY':
			return e.category;
		case 'ITEM':
			return e.title;
		case 'FILE':
			return e.file;
		case 'SCHEDULED':
			return ts(e.scheduled);
		case 'DEADLINE':
			return ts(e.deadline);
		case 'CLOSED':
			return ts(e.closed);
		case 'TAGS':
		case 'ALLTAGS':
			return e.tags.length ? `:${e.tags.join(':')}:` : null;
		default:
			return ctx.properties?.()[name] ?? null;
	}
}

function termMatches(t: MatchTerm, e: MatchEntry, ctx: MatchContext, todoPart: boolean): boolean {
	let hit: boolean;
	if (t.kind === 'tag') hit = todoPart ? e.todo === t.tag : e.tags.includes(t.tag);
	else if (t.kind === 'tag-regexp')
		hit = todoPart ? !!e.todo && t.re.test(e.todo) : e.tags.some((tag) => t.re.test(tag));
	else {
		const raw = property(t.name, e, ctx);
		if (raw === null && t.starred) hit = false;
		else {
			const v = raw ?? '';
			const value = t.value;
			if (value.type === 'regexp') hit = (t.op === '<>') !== value.value.test(v);
			else if (value.type === 'number') hit = compare(Number(v) || 0, t.op, value.value);
			else if (value.type === 'date') {
				const a = /<([^>]+)>|\[([^\]]+)\]/.exec(v);
				const left = a ? resolveDate(a[1] ?? a[2]!, ctx) : null;
				const right = resolveDate(value.value, ctx);
				hit = left !== null && right !== null && compare(left, t.op, right);
			} else hit = compare(v, t.op, value.value);
		}
	}
	return t.neg ? !hit : hit;
}

function exprMatches(expr: MatchExpr, e: MatchEntry, ctx: MatchContext, todoPart: boolean) {
	return expr.some((group) => group.every((t) => termMatches(t, e, ctx, todoPart)));
}

export function matches(m: Matcher, e: MatchEntry, ctx: MatchContext): boolean {
	if (m.todoOnly && (!e.todo || ctx.isDone(e.todo))) return false;
	if (m.tags && !exprMatches(m.tags, e, ctx, false)) return false;
	if (m.todo && !exprMatches(m.todo, e, ctx, true)) return false;
	return true;
}
