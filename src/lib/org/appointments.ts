/// Appointments, as org's agenda finds them: active timestamps (`<…>`) in an
/// entry's heading or text, besides its SCHEDULED/DEADLINE line. Skipped:
/// the planning line, drawers (properties, LOGBOOK…), and source/example
/// blocks. A range (`<a>--<b>`) covers every day from a to b.

import { readTimestamp } from './timestamp';
import type { OrgTimestamp } from './types';

export interface Appointment {
	timestamp: OrgTimestamp;
	/** Last day of a `<a>--<b>` range (`YYYY-MM-DD`), or null. */
	until: string | null;
}

const HEADLINE = /^\*+[ \t]/;
const PLANNING = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const DRAWER_START = /^[ \t]*:[\w-]+:[ \t]*$/;
const DRAWER_END = /^[ \t]*:END:[ \t]*$/i;
const BLOCK_START = /^[ \t]*#\+begin_(src|example|export|comment)\b/i;

function stampsIn(text: string): Appointment[] {
	const out: Appointment[] = [];
	for (let i = text.indexOf('<'); i !== -1; i = text.indexOf('<', i + 1)) {
		const read = readTimestamp(text, i);
		if (!read || !read.timestamp.active) continue;
		let until: string | null = null;
		if (text.startsWith('--<', read.to)) {
			const end = readTimestamp(text, read.to + 2);
			if (end?.timestamp.active && end.timestamp.date > read.timestamp.date) {
				until = end.timestamp.date;
				i = end.to - 1;
			}
		}
		out.push({ timestamp: read.timestamp, until });
		if (!until) i = read.to - 1;
	}
	return out;
}

/** Each heading's appointments, by the heading's offset. */
export function appointmentsIn(source: string): Map<number, Appointment[]> {
	const out = new Map<number, Appointment[]>();
	if (!source.includes('<')) return out;
	let heading = -1;
	let drawer = false;
	let block: RegExp | null = null;
	let offset = 0;
	for (const raw of source.split('\n')) {
		const line = raw.replace(/\r$/, '');
		const at = offset;
		offset += raw.length + 1;
		if (block) {
			if (block.test(line)) block = null;
			continue;
		}
		if (HEADLINE.test(line)) {
			heading = at;
			drawer = false;
		} else if (heading === -1) continue;
		else if (drawer) {
			if (DRAWER_END.test(line)) drawer = false;
			continue;
		} else if (DRAWER_START.test(line)) {
			drawer = true;
			continue;
		} else if (PLANNING.test(line)) continue;
		else {
			const b = BLOCK_START.exec(line);
			if (b) {
				block = new RegExp(`^[ \\t]*#\\+end_${b[1]}\\b`, 'i');
				continue;
			}
		}
		if (!line.includes('<')) continue;
		const found = stampsIn(line);
		if (found.length) out.set(heading, [...(out.get(heading) ?? []), ...found]);
	}
	return out;
}
