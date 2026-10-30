/// Which headings in the inbox file are things to decide. Usually its
/// top-level headings; but captures filed under a heading (org-capture's
/// `file+headline`, as `* Inbox` or `* Tasks`) make that heading a group,
/// whose own sub-headings are the items. A heading with sub-headings is a
/// group unless it's an open task itself (a task with steps is one item).
/// Done items are left out.

import type { HeadlineEntry } from '$lib/org';

export function inboxEntries<T extends Pick<HeadlineEntry, 'level' | 'todo'>>(
	heads: readonly T[],
	doneKeywords: readonly string[],
): T[] {
	const done = (h: T) => !!h.todo && doneKeywords.includes(h.todo);
	const out: T[] = [];
	const walk = (from: number, to: number) => {
		if (from >= to) return;
		const top = Math.min(...heads.slice(from, to).map((h) => h.level));
		for (let i = from; i < to;) {
			const h = heads[i]!;
			let end = i + 1;
			while (end < to && heads[end]!.level > top) end += 1;
			if (h.level === top) {
				const children = end > i + 1;
				if (children && (!h.todo || done(h))) walk(i + 1, end);
				else if (!done(h)) out.push(h);
			}
			i = end;
		}
	};
	walk(0, heads.length);
	return out;
}
