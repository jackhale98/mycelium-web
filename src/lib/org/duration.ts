/// Org durations (`org-duration-to-minutes`): `1:30`, `0:45:30`, `90`
/// (minutes), `2h`, `1d 3h 20min`. Units follow `org-duration-units`.

const UNITS: Record<string, number> = {
	min: 1,
	h: 60,
	d: 60 * 24,
	w: 60 * 24 * 7,
	m: 60 * 24 * 30,
	y: 60 * 24 * 365.25,
};

/** Minutes in an org duration string, or `null` if it isn't one. */
export function durationToMinutes(value: string | null | undefined): number | null {
	const s = (value ?? '').trim();
	if (!s) return null;
	const clock = /^(\d+):(\d{2})(?::(\d{2}))?$/.exec(s);
	if (clock) return Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3] ?? 0) / 60;
	if (/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
	let total = 0;
	let rest = s;
	const part = /^\s*(\d+(?:\.\d+)?)\s*(min|h|d|w|m|y)\b/;
	while (rest.trim()) {
		const m = part.exec(rest);
		if (!m) {
			// A trailing H:MM after unit parts, e.g. "1d 3:20".
			const tail = /^\s*(\d+):(\d{2})\s*$/.exec(rest);
			if (!tail) return null;
			return total + Number(tail[1]) * 60 + Number(tail[2]);
		}
		total += Number(m[1]) * UNITS[m[2]!]!;
		rest = rest.slice(m[0].length);
	}
	return total;
}
