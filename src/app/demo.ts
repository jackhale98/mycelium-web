/// The bundled demo vault, used until a repository is connected.
///
/// Its notes are written as if today were DEMO_DAY; when the demo loads, every
/// date in them (timestamps, CLOSED stamps, logged completions, dailies and
/// their file names) moves by the same number of days, so the agenda, the
/// dailies and the habits' history always read as current.

const files = import.meta.glob('../demo/vault/**/*.org', {
	query: '?raw',
	import: 'default',
	eager: true,
}) as Record<string, string>;

/** The day the demo notes are written for. */
export const DEMO_DAY = '2026-10-20';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_MS = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);

/** Today on this device, `YYYY-MM-DD`. */
function localToday(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Move every `YYYY-MM-DD` in `text` by `days`, with the English weekday that
 * follows it (as in org timestamps) updated to match.
 */
export function shiftDates(text: string, days: number): string {
	if (!days) return text;
	return text.replace(
		/\b(\d{4}-\d{2}-\d{2})(?: (Sun|Mon|Tue|Wed|Thu|Fri|Sat)\b)?/g,
		(match, date: string, weekday?: string) => {
			const t = utc(date);
			if (Number.isNaN(t)) return match;
			const moved = new Date(t + days * DAY_MS);
			const iso = moved.toISOString().slice(0, 10);
			return weekday ? `${iso} ${WEEKDAYS[moved.getUTCDay()]}` : iso;
		},
	);
}

/** The demo notes, dated as if `today` were the day they were written for. */
export function demoSourcesFor(today: string): Record<string, string> {
	const days = Math.round((utc(today) - utc(DEMO_DAY)) / DAY_MS);
	return Object.fromEntries(
		Object.entries(files).map(([path, source]) => [
			shiftDates(path.replace('../demo/vault/', ''), days),
			shiftDates(source, days),
		]),
	);
}

/** The day the demo below is dated for. */
export const demoDay = localToday();
export const demoSources: Record<string, string> = demoSourcesFor(demoDay);
