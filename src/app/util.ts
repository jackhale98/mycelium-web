import type { OrgTimestamp } from '$lib/org';
import { addDays, dayNameFor } from '$lib/org';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_DAYS: Record<string, string> = {
	Sun: 'Sunday',
	Mon: 'Monday',
	Tue: 'Tuesday',
	Wed: 'Wednesday',
	Thu: 'Thursday',
	Fri: 'Friday',
	Sat: 'Saturday',
};

/** `2026-10-20` → `Tue, Oct 20`. */
export function shortDate(iso: string): string {
	const [, m, d] = iso.split('-').map(Number);
	return `${dayNameFor(iso)}, ${MONTHS[(m ?? 1) - 1]} ${d}`;
}

/** `2026-10-20` → `Tuesday, October 20`-style long form. */
export function longDate(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const long = [
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
	return `${LONG_DAYS[dayNameFor(iso)] ?? ''}, ${long[(m ?? 1) - 1]} ${d}, ${y}`;
}

/** Human distance from today: `today`, `tomorrow`, `in 3 days`, `2 days ago`. */
export function relativeDay(iso: string, today: string): string {
	if (iso === today) return 'Today';
	if (iso === addDays(today, 1)) return 'Tomorrow';
	if (iso === addDays(today, -1)) return 'Yesterday';
	const diff = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000);
	return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}

export function tsLabel(ts: OrgTimestamp): string {
	return `${shortDate(ts.date)}${ts.time ? ` · ${ts.time}` : ''}`;
}

/** org-roam's default slug: lower-case, non-alphanumerics to underscores. */
export function slugify(title: string): string {
	return title
		.normalize('NFD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^\p{L}\p{N}]+/gu, '_')
		.replace(/^_+|_+$/g, '')
		.toLowerCase();
}
