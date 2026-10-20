import { addDays, getProperties, matches, parseMatch } from '$lib/org';
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
		if (!due) {
			if (item.todo) groups.unscheduled.push(item);
		} else if (due.date < today) groups.overdue.push(item);
		else if (due.date === today) groups.today.push(item);
		else if (due.date <= end) groups.upcoming.push(item);
		else groups.later.push(item);
	}
	const byDate = (a: AgendaItem, b: AgendaItem) =>
		((a.deadline ?? a.scheduled)?.date ?? '').localeCompare(
			(b.deadline ?? b.scheduled)?.date ?? '',
		) || PRIORITY_ORDER(a.priority) - PRIORITY_ORDER(b.priority);
	for (const list of [groups.overdue, groups.today, groups.upcoming, groups.later])
		list.sort(byDate);
	groups.unscheduled.sort((a, b) => PRIORITY_ORDER(a.priority) - PRIORITY_ORDER(b.priority));
	groups.done.sort((a, b) => (b.closed?.date ?? '').localeCompare(a.closed?.date ?? ''));
	return groups;
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
