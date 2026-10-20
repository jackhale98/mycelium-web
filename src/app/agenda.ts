import { addDays } from '$lib/org';
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
export function groupAgenda(vault: Vault, today: string, horizon = 7): AgendaGroups {
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
