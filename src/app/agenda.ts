import {
	addDays,
	dayNameFor,
	getProperties,
	isHabit,
	matches,
	parseMatch,
	timestampDates,
} from '$lib/org';
import type { AgendaItem, Vault } from '$lib/vault/vault';

export interface AgendaGroups {
	overdue: AgendaItem[];
	today: AgendaItem[];
	upcoming: AgendaItem[];
	later: AgendaItem[];
	unscheduled: AgendaItem[];
	done: AgendaItem[];
}

const PRIORITY_ORDER = (p: string | null) => (p ? p.charCodeAt(0) : 1000);

/** Split open tasks by when they're due, org-agenda style. */
export function groupAgenda(
	vault: Vault,
	today: string,
	horizon = 7,
	keep: (item: AgendaItem) => boolean = () => true,
): AgendaGroups {
	const groups: AgendaGroups = {
		overdue: [],
		today: [],
		upcoming: [],
		later: [],
		unscheduled: [],
		done: [],
	};
	const end = addDays(today, horizon);
	for (const item of vault.agenda()) {
		if (!keep(item)) continue;
		if (vault.isDone(item.todo, item.file)) {
			groups.done.push(item);
			continue;
		}
		const due = item.deadline ?? item.scheduled;
		// Habits are shown on today's agenda only (org-habit-show-habits-only-for-today),
		// however late: their graph shows how late.
		const source = item.scheduled ? vault.file(item.file)?.source : undefined;
		if (source && isHabit(source, item.pos, vault.file(item.file)!.index.keywords)) {
			if (item.scheduled!.date <= today) groups.today.push(item);
			continue;
		}
		if (!due) {
			if (item.todo) groups.unscheduled.push(item);
		} else if (due.date < today) groups.overdue.push(item);
		else if (due.date === today) groups.today.push(item);
		else if (due.date <= end) groups.upcoming.push(item);
		else groups.later.push(item);
	}
	const time = (i: AgendaItem) => (i.deadline ?? i.scheduled)?.time ?? '99:99';
	const byDate = (a: AgendaItem, b: AgendaItem) =>
		((a.deadline ?? a.scheduled)?.date ?? '').localeCompare(
			(b.deadline ?? b.scheduled)?.date ?? '',
		) ||
		time(a).localeCompare(time(b)) ||
		PRIORITY_ORDER(a.priority) - PRIORITY_ORDER(b.priority);
	for (const list of [groups.overdue, groups.today, groups.upcoming, groups.later])
		list.sort(byDate);
	groups.unscheduled.sort((a, b) => PRIORITY_ORDER(a.priority) - PRIORITY_ORDER(b.priority));
	groups.done.sort((a, b) => (b.closed?.date ?? '').localeCompare(a.closed?.date ?? ''));
	return groups;
}

// ---------------------------------------------------------------- week

export interface AgendaDay {
	date: string;
	items: AgendaItem[];
}

/** The Monday on or before `date` (org-agenda-start-on-weekday 1). */
export function weekStart(date: string): string {
	const back =
		(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(dayNameFor(date)) + 7) % 7;
	return addDays(date, -back);
}

/**
 * org's week agenda: each day of the week from `start` with the open items
 * scheduled or due that day (repeating ones on every day they recur), timed
 * ones first in time order; today also lists what is overdue.
 */
export function weekAgenda(
	vault: Vault,
	start: string,
	today: string,
	keep: (item: AgendaItem) => boolean = () => true,
): AgendaDay[] {
	const end = addDays(start, 6);
	const days = Array.from({ length: 7 }, (_, i) => ({
		date: addDays(start, i),
		items: [] as { item: AgendaItem; time: string }[],
	}));
	const byDate = new Map(days.map((d) => [d.date, d]));
	for (const item of vault.agenda()) {
		if (!keep(item) || vault.isDone(item.todo, item.file)) continue;
		const placed = new Set<string>();
		// Habits show on today only (org-habit-show-habits-only-for-today).
		const source = item.scheduled ? vault.file(item.file)?.source : undefined;
		const habit = !!source && isHabit(source, item.pos, vault.file(item.file)!.index.keywords);
		for (const ts of [item.scheduled, item.deadline]) {
			if (!ts?.active) continue;
			for (const date of timestampDates(ts, start, end)) {
				if (placed.has(date) || (habit && date !== today)) continue;
				// Before today, a repeat is only where it's written: missed repeats aren't entries.
				if (date < today && date !== ts.date) continue;
				placed.add(date);
				byDate.get(date)!.items.push({ item, time: ts.time ?? '99:99' });
			}
		}
		const due = item.deadline ?? item.scheduled;
		const todayRow = byDate.get(today);
		if (todayRow && due && due.date < today && !placed.has(today) && !habit)
			todayRow.items.push({ item, time: '99:99' });
	}
	return days.map((d) => ({
		date: d.date,
		items: d.items
			.sort(
				(a, b) =>
					a.time.localeCompare(b.time) ||
					PRIORITY_ORDER(a.item.priority) - PRIORITY_ORDER(b.item.priority),
			)
			.map((x) => x.item),
	}));
}

// ---------------------------------------------------------------- stuck projects

/** org's `org-stuck-projects`, its four parts. */
export interface StuckSettings {
	/** Which headings are projects: an org match string. */
	match: string;
	/** A project with an entry under it in one of these states isn't stuck. */
	keywords: string[];
	/** …or with a heading under it carrying one of these tags. */
	tags: string[];
	/** …or whose text (below its heading) matches this regular expression. */
	regexp: string;
}

/** org's default `org-stuck-projects`. */
export const DEFAULT_STUCK: StuckSettings = {
	match: '+LEVEL=2/-DONE',
	keywords: ['TODO', 'NEXT', 'NEXTACTION'],
	tags: [],
	regexp: '',
};

/** A vault's saved definition, with org's defaults for any part it lacks. */
export function stuckSettingsOf(saved: Partial<StuckSettings> | undefined): StuckSettings {
	return { ...DEFAULT_STUCK, ...saved };
}

/**
 * org's stuck projects (`C-c a #`): headings matching the project match
 * string with nothing under them in a next-action state. Throws when the
 * match string doesn't parse.
 */
export function stuckProjects(
	vault: Vault,
	settings: StuckSettings,
	now: { date: string; time: string },
): AgendaItem[] {
	const matcher = parseMatch(settings.match);
	const next = new Set(settings.keywords);
	const tags = new Set(settings.tags);
	let re: RegExp | null = null;
	try {
		re = settings.regexp.trim() ? new RegExp(settings.regexp, 'm') : null;
	} catch {
		throw new Error(`the text pattern “${settings.regexp}” isn't a valid regular expression`);
	}
	const out: AgendaItem[] = [];
	for (const file of vault.files.values()) {
		if (file.index.excluded) continue;
		const hs = file.index.headlines;
		hs.forEach((h, i) => {
			const ok = matches(
				matcher,
				{ ...h, file: file.path },
				{
					now,
					isDone: (k) => vault.isDone(k, file.path),
					properties: () => getProperties(file.source, h.pos, file.index.keywords),
				},
			);
			if (!ok) return;
			let j = i + 1;
			for (; j < hs.length && hs[j]!.level > h.level; j += 1) {
				const sub = hs[j]!;
				if (sub.todo && next.has(sub.todo)) return;
				// The tag written on that heading (not inherited from the project).
				if (tags.size && ownTags(file.source, sub.pos).some((t) => tags.has(t))) return;
			}
			if (re) {
				const end = hs[j]?.pos ?? file.source.length;
				const below = file.source.slice(file.source.indexOf('\n', h.pos) + 1, end);
				if (h.pos < end && re.test(below)) return;
			}
			out.push({ ...h, file: file.path, node: (h.ownerId && vault.nodes.get(h.ownerId)) || null });
		});
	}
	return out;
}

/** Tags written on the heading line at `pos` (`:a:b:` at its end). */
function ownTags(source: string, pos: number): string[] {
	const eol = source.indexOf('\n', pos);
	const line = source.slice(pos, eol === -1 ? undefined : eol);
	const m = /[ \t](:[\w@#%:]+:)[ \t]*$/.exec(line);
	return m ? m[1]!.split(':').filter(Boolean) : [];
}

// ---------------------------------------------------------------- filters

/** Agenda filters, following org-agenda's tag, category, regexp and top-headline filters. */
export interface AgendaFilter {
	/** tag → true to require it, false to exclude it (org's `+tag` / `-tag`). */
	tags: Record<string, boolean>;
	states: string[];
	priorities: string[];
	categories: string[];
	/** Case-insensitive regexp over title, outline path and note title (org's `=` filter). */
	text: string;
	/** An org match string, e.g. `+work-boss/!NEXT` (org's tag/property search). */
	match: string;
	/** Only items under this level-1 heading (org's `^` filter). */
	top: { file: string; pos: number; title: string } | null;
}

export const emptyFilter = (): AgendaFilter => ({
	tags: {},
	states: [],
	priorities: [],
	categories: [],
	text: '',
	match: '',
	top: null,
});

export function activeFilters(f: AgendaFilter): number {
	return (
		Object.keys(f.tags).length +
		f.states.length +
		f.priorities.length +
		f.categories.length +
		(f.text.trim() ? 1 : 0) +
		(f.match.trim() ? 1 : 0) +
		(f.top ? 1 : 0)
	);
}

/**
 * Build a predicate from a filter. Throws `MatchSyntaxError` (with a
 * readable message) for a bad match string, and `SyntaxError` for a bad
 * text regexp.
 */
export function compileFilter(
	f: AgendaFilter,
	vault: Vault,
	now: { date: string; time: string },
): (item: AgendaItem) => boolean {
	const matcher = f.match.trim() ? parseMatch(f.match) : null;
	const re = f.text.trim() ? new RegExp(f.text.trim(), 'i') : null;
	const include = Object.entries(f.tags)
		.filter(([, v]) => v)
		.map(([t]) => t);
	const exclude = Object.entries(f.tags)
		.filter(([, v]) => !v)
		.map(([t]) => t);
	return (item) => {
		if (include.some((t) => !item.tags.includes(t))) return false;
		if (exclude.some((t) => item.tags.includes(t))) return false;
		if (f.states.length && !f.states.includes(item.todo ?? '')) return false;
		if (f.priorities.length && !f.priorities.includes(item.priority ?? 'B')) return false;
		if (f.categories.length && !f.categories.includes(item.category)) return false;
		if (f.top && (item.file !== f.top.file || item.topPos !== f.top.pos)) return false;
		if (re) {
			const where = vault.fileNode(item.file)?.title ?? item.file;
			if (!re.test([item.title, ...item.olp, where].join(' '))) return false;
		}
		if (matcher) {
			const file = vault.file(item.file);
			const ok = matches(
				matcher,
				{ ...item, file: item.file },
				{
					now,
					isDone: (k) => vault.isDone(k, item.file),
					properties: () => (file ? getProperties(file.source, item.pos, file.index.keywords) : {}),
				},
			);
			if (!ok) return false;
		}
		return true;
	};
}

/** Filters as a URL query (`#/agenda?…`), so a filtered agenda can be bookmarked. */
export function encodeFilter(f: AgendaFilter): string {
	const q = new URLSearchParams();
	for (const [t, v] of Object.entries(f.tags)) q.append('tag', `${v ? '+' : '-'}${t}`);
	for (const s of f.states) q.append('state', s);
	for (const p of f.priorities) q.append('prio', p);
	for (const c of f.categories) q.append('cat', c);
	if (f.text.trim()) q.set('q', f.text.trim());
	if (f.match.trim()) q.set('match', f.match.trim());
	if (f.top) q.set('top', `${f.top.pos}:${f.top.file}`);
	return q.toString();
}

export function decodeFilter(query: string, vault?: Vault): AgendaFilter {
	const q = new URLSearchParams(query);
	const f = emptyFilter();
	for (const t of q.getAll('tag')) {
		const neg = t.startsWith('-');
		const name = t.replace(/^[+-]/, '');
		if (name) f.tags[name] = !neg;
	}
	f.states = q.getAll('state');
	f.priorities = q.getAll('prio');
	f.categories = q.getAll('cat');
	f.text = q.get('q') ?? '';
	f.match = q.get('match') ?? '';
	const top = /^(\d+):(.+)$/.exec(q.get('top') ?? '');
	if (top) {
		const pos = Number(top[1]);
		const file = top[2]!;
		const title = vault?.file(file)?.index.headlines.find((h) => h.pos === pos)?.title ?? file;
		f.top = { file, pos, title };
	}
	return f;
}
