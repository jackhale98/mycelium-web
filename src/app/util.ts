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

/** The combining marks `org-roam-node-slugify` removes (and only these). */
const SLUG_TRIM = new Set([
	0x300, 0x301, 0x302, 0x303, 0x304, 0x306, 0x307, 0x308, 0x309, 0x30a, 0x30b, 0x30c, 0x31b, 0x323,
	0x324, 0x325, 0x327, 0x32d, 0x32e, 0x330, 0x331,
]);

/**
 * `org-roam-node-slugify`: decompose, drop common accents, recompose, turn
 * anything not alphanumeric (Emacs `[:alnum:]`) into `_`, squeeze and trim
 * underscores, lower-case.
 */
export function slugify(title: string): string {
	const stripped = [...title.normalize('NFD')]
		.filter((ch) => !SLUG_TRIM.has(ch.codePointAt(0)!))
		.join('')
		.normalize('NFC');
	return stripped
		.replace(/[^\p{L}\p{M}\p{Nl}\p{Nd}]/gu, '_')
		.replace(/_+/g, '_')
		.replace(/^_/, '')
		.replace(/_$/, '')
		.toLowerCase();
}
