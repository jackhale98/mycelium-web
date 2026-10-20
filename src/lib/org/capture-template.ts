/// Capture templates in the style of `org-capture-templates`: where a capture
/// goes (today's daily, a file and heading, or a new note), what kind of
/// thing it is (entry, list item, checkbox, plain text), and a template
/// written with org-capture's %-escapes.
///
/// Supported escapes:
///   %?            where the typed text goes (appended when absent)
///   %U %u %T %t   now as [inactive]/<active> timestamps, with or without time
///   %<FORMAT>     strftime-style date (%Y %y %m %d %e %H %M %S %a %A %b %B)
///   %^{Prompt}    ask for a value; %^{Prompt|default|other} offers choices
///   %^t %^T %^u %^U  ask for a date (T/U include a time)
///   %^{Prompt}t   the same, with a label
///   %^g %^G       ask for tags
///   %\1 … %\9     reuse the answer to the Nth %^{…} prompt
///   %a            a link to the note captured from, when there is one
///   %i            initial content (empty here: there is no selected region)
///   %%            a literal %

import { detectEol, type Change } from './text';
import { formatTimestamp, makeTimestamp } from './timestamp';

export type CaptureType = 'entry' | 'item' | 'checkitem' | 'plain';

export type CaptureTarget =
	| { kind: 'daily'; heading: string | null }
	| { kind: 'file'; path: string; heading: string | null }
	| { kind: 'node' };

export interface CaptureTemplate {
	id: string;
	/** One-letter shortcut, as in org-capture's template menu. */
	key: string;
	name: string;
	type: CaptureType;
	target: CaptureTarget;
	template: string;
	/** Entries go first under the heading instead of last. */
	prepend?: boolean;
}

/** What Mycelium offers until a vault defines its own. */
export const DEFAULT_CAPTURE_TEMPLATES: CaptureTemplate[] = [
	{
		id: 'note',
		key: 'n',
		name: 'Note',
		type: 'item',
		target: { kind: 'daily', heading: 'Captured' },
		template: '%U %?',
	},
	{
		id: 'task',
		key: 't',
		name: 'Task',
		type: 'entry',
		target: { kind: 'daily', heading: 'Tasks' },
		template: '* TODO %?\nSCHEDULED: %t',
	},
	{
		id: 'journal',
		key: 'j',
		name: 'Journal',
		type: 'entry',
		target: { kind: 'daily', heading: null },
		template: '* %<%H:%M> %^{Title}\n%?',
	},
	{
		id: 'new-note',
		key: 'r',
		name: 'New note',
		type: 'plain',
		target: { kind: 'node' },
		template: '%?',
	},
];

export interface PromptField {
	/** Key into the values passed to `expandTemplate`. */
	id: string;
	label: string;
	kind: 'text' | 'date' | 'datetime' | 'tags';
	/** `true` for <active> dates (%^t / %^T). */
	active: boolean;
	options: string[];
	default: string;
}

export interface CaptureNow {
	date: string;
	time: string;
}

export interface ExpandContext {
	now: CaptureNow;
	/** The typed text, placed at %?. */
	text: string;
	/** Answers to the template's prompts, by `PromptField.id`. */
	values?: Record<string, string> | undefined;
	/** `[[id:…][Title]]` for %a. */
	link?: string | undefined;
}

const ESCAPE =
	/%(?:(\?)|([UuTt])|<([^>]*)>|\^\{([^}]*)\}([tTuUgG])?|\^([gGtTuU])|\\([1-9])|([ia])|(%))/g;

/** The prompts a template will ask, in order. */
export function templatePrompts(template: string): PromptField[] {
	const fields: PromptField[] = [];
	let n = 0;
	for (const m of template.matchAll(ESCAPE)) {
		const [, , , , braced, bracedType, bare] = m;
		const type = bracedType ?? bare;
		if (braced === undefined && !bare) continue;
		const id = `p${n++}`;
		const [label = '', ...rest] = (braced ?? '').split('|');
		if (type === 'g' || type === 'G')
			fields.push({
				id,
				label: label || 'Tags',
				kind: 'tags',
				active: false,
				options: [],
				default: '',
			});
		else if (type)
			fields.push({
				id,
				label: label || (type === 't' || type === 'u' ? 'Date' : 'Date and time'),
				kind: type === 't' || type === 'u' ? 'date' : 'datetime',
				active: type === 't' || type === 'T',
				options: [],
				default: '',
			});
		else
			fields.push({
				id,
				label: label || 'Value',
				kind: 'text',
				active: false,
				options: rest,
				default: rest[0] ?? '',
			});
	}
	return fields;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December',
];

/** A subset of strftime, for %<…>. */
export function strftime(format: string, now: CaptureNow): string {
	const [y, mo, d] = now.date.split('-').map(Number) as [number, number, number];
	const [h, mi] = now.time.split(':').map(Number) as [number, number];
	const day = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
	const pad = (n: number) => String(n).padStart(2, '0');
	const map: Record<string, string> = {
		Y: String(y),
		y: pad(y % 100),
		m: pad(mo),
		d: pad(d),
		e: String(d).padStart(2, ' '),
		H: pad(h),
		M: pad(mi),
		S: '00',
		a: DAYS[day]!.slice(0, 3),
		A: DAYS[day]!,
		b: MONTHS[mo - 1]!.slice(0, 3),
		B: MONTHS[mo - 1]!,
		'%': '%',
	};
	return format.replace(/%(.)/g, (all, c: string) => map[c] ?? all);
}

function stamp(date: string, time: string | null, active: boolean): string {
	return formatTimestamp(makeTimestamp({ date, time, active }));
}

/** `a b`, `a,b` or `:a:b:` → `:a:b:`. */
function tagString(value: string): string {
	const tags = value
		.split(/[\s,:]+/)
		.map((t) => t.trim())
		.filter(Boolean);
	return tags.length ? `:${tags.join(':')}:` : '';
}

/** Expand a template's escapes. The typed text goes at %? (or at the end). */
export function expandTemplate(template: string, ctx: ExpandContext): string {
	const values = ctx.values ?? {};
	const answers: string[] = [];
	let n = 0;
	let placed = false;
	let out = template.replace(
		ESCAPE,
		(all, cursor, now, fmt, braced, bracedType, bare, backref, other, percent) => {
			if (cursor) {
				placed = true;
				return ctx.text;
			}
			if (now) {
				const withTime = now === 'U' || now === 'T';
				return stamp(ctx.now.date, withTime ? ctx.now.time : null, now === 'T' || now === 't');
			}
			if (fmt !== undefined) return strftime(fmt, ctx.now);
			if (braced !== undefined || bare) {
				const id = `p${n++}`;
				const type = bracedType ?? bare;
				const given = values[id];
				if (type === 'g' || type === 'G') return tagString(given ?? '');
				if (type) {
					if (!given) return '';
					const [date, time = null] = given.split('T');
					const withTime = type === 'T' || type === 'U';
					return stamp(date!, withTime ? time : null, type === 't' || type === 'T');
				}
				const answer = given ?? (braced ?? '').split('|')[1] ?? '';
				answers.push(answer);
				return answer;
			}
			if (backref) return answers[Number(backref) - 1] ?? '';
			if (other === 'a') return ctx.link ?? '';
			if (other === 'i') return '';
			if (percent) return '%';
			return all;
		},
	);
	if (!placed && ctx.text.trim()) out = out.trimEnd() + (out.trim() ? ' ' : '') + ctx.text;
	// Blank prompts and an empty %? leave trailing spaces and empty last lines.
	return out
		.split('\n')
		.map((l) => l.trimEnd())
		.join('\n')
		.replace(/\n+$/, '');
}

/** Shape expanded text as the capture type: a heading, a list item, a checkbox. */
export function shapeCapture(text: string, type: CaptureType): string {
	const lines = text.replace(/\r/g, '').split('\n');
	const [first = '', ...rest] = lines;
	if (type === 'entry') return /^\*+[ \t]/.test(first) ? text : `* ${text}`;
	if (type === 'plain') return text;
	const marker = type === 'checkitem' ? '- [ ] ' : '- ';
	const head = /^[ \t]*(?:[-+]|\d+[.)])[ \t]/.test(first) ? first : `${marker}${first}`;
	return [head, ...rest.map((l) => (l.trim() ? `  ${l}` : ''))].join('\n');
}

const HEADLINE = /^(\*+)[ \t]+(.*?)(?:[ \t]+:[\w@#%:]+:)?[ \t]*\r?$/;

/** Does a heading's title match `name`? Ignores a leading TODO keyword and priority. */
function titleMatches(title: string, name: string): boolean {
	const want = name.trim();
	if (title === want) return true;
	const bare = title.replace(/^[A-Z]+[ \t]+/, '').replace(/^\[#.\][ \t]+/, '');
	return bare === want;
}

/** Shift an entry's headings so its top level becomes `level`. */
function setLevel(entry: string, level: number): string {
	const lines = entry.split('\n');
	const levels = lines.map((l) => /^(\*+)[ \t]/.exec(l)?.[1]!.length ?? 0).filter(Boolean);
	if (!levels.length) return entry;
	const shift = level - Math.min(...levels);
	if (!shift) return entry;
	return lines
		.map((l) => {
			const m = /^(\*+)([ \t].*)$/.exec(l);
			return m ? '*'.repeat(Math.max(1, m[1]!.length + shift)) + m[2] : l;
		})
		.join('\n');
}

/**
 * Insert shaped capture text into `source`: under the first heading titled
 * `heading` (created at the end of the file if missing), or at file level.
 * Entries become children of the heading (last, or first with `prepend`);
 * items and plain text join the heading's own text, before any child heading.
 */
export function insertCapture(
	source: string,
	text: string,
	options: { type: CaptureType; heading: string | null; prepend?: boolean | undefined },
): Change[] {
	const eol = detectEol(source);
	const lines = source.split('\n');
	const starts: number[] = [];
	let offset = 0;
	for (const l of lines) {
		starts.push(offset);
		offset += l.length + 1;
	}
	const lineEnd = (i: number) => starts[i]! + lines[i]!.replace(/\r$/, '').length;
	const level = (i: number) => /^(\*+)[ \t]/.exec(lines[i]!)?.[1]!.length ?? 0;
	const withEol = (s: string) => s.replace(/\r?\n/g, eol);
	/** Insert after line `i` (after its text, before its line break). */
	const after = (i: number, body: string): Change[] => [
		{ from: lineEnd(i), to: lineEnd(i), insert: `${eol}${withEol(body)}` },
	];
	const append = (body: string): Change[] => {
		const lead = source.length > 0 && !source.endsWith('\n') ? eol : '';
		return [{ from: source.length, to: source.length, insert: `${lead}${withEol(body)}${eol}` }];
	};
	const lastText = (from: number, to: number) => {
		let i = to - 1;
		while (i > from && !lines[i]!.trim()) i--;
		return i;
	};

	if (options.heading === null) {
		const firstHeading = lines.findIndex((_, i) => level(i) > 0);
		const body = options.type === 'entry' ? setLevel(text, 1) : text;
		if (options.type === 'entry' && !options.prepend) return append(body);
		// Text, and prepended entries, go before the first heading.
		if (firstHeading === -1) return append(body);
		if (firstHeading === 0) return [{ from: 0, to: 0, insert: `${withEol(body)}${eol}` }];
		return after(lastText(-1, firstHeading), body);
	}

	const at = lines.findIndex((l) => {
		const m = HEADLINE.exec(l);
		return !!m && titleMatches(m[2]!, options.heading!);
	});
	if (at === -1) {
		const body = options.type === 'entry' ? setLevel(text, 2) : text;
		return append(`* ${options.heading.trim()}\n${body}`);
	}
	const own = level(at);
	let subtreeEnd = lines.length;
	let firstChild = -1;
	for (let i = at + 1; i < lines.length; i++) {
		const l = level(i);
		if (!l) continue;
		if (firstChild === -1) firstChild = i;
		if (l <= own) {
			subtreeEnd = i;
			break;
		}
	}
	if (firstChild >= subtreeEnd) firstChild = -1;
	if (options.type === 'entry') {
		const body = setLevel(text, own + 1);
		if (options.prepend && firstChild !== -1) return after(lastText(at, firstChild), body);
		return after(lastText(at, subtreeEnd), body);
	}
	return after(lastText(at, firstChild === -1 ? subtreeEnd : firstChild), text);
}

/** Expand, shape and place a capture in one go. */
export function applyTemplate(
	source: string,
	template: CaptureTemplate,
	ctx: ExpandContext,
	heading: string | null,
): Change[] {
	const text = shapeCapture(expandTemplate(template.template, ctx), template.type);
	return insertCapture(source, text, { type: template.type, heading, prepend: template.prepend });
}

/** Where a template writes, in words. */
export function describeTarget(target: CaptureTarget): string {
	if (target.kind === 'node') return 'a new note';
	const place = target.kind === 'daily' ? "today's daily note" : target.path;
	return target.heading ? `${place} → ${target.heading}` : place;
}
