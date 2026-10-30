// The quick-add grammar against phrases people type, edge cases included.
// Today is Friday 30 October 2026. Each case: what's scheduled (or due),
// the repeat, and the title left over. `once` is a repeat asked for that no
// org repeater can say ("every third Friday"): only the next one is scheduled.

import { describe, expect, it } from 'vitest';
import { parseQuickAdd } from '../quick-add';

const today = '2026-10-30';
type Want = { s?: string; d?: string; r?: string; once?: string; title: string };

const CASES: [string, Want][] = [
	// Shorthands for days.
	['Call Sam tom', { s: '2026-10-31', title: 'Call Sam' }],
	['Call Sam tmr 3pm', { s: '2026-10-31 15:00', title: 'Call Sam' }],
	['Call Sam tmrw', { s: '2026-10-31', title: 'Call Sam' }],
	['Call Sam tomo', { s: '2026-10-31', title: 'Call Sam' }],
	['Call Sam 2moro', { s: '2026-10-31', title: 'Call Sam' }],
	['Call Tom about the car', { title: 'Call Tom about the car' }],
	['Party day after tomorrow', { s: '2026-11-01', title: 'Party' }],
	['Movie tonight', { s: '2026-10-30 20:00', title: 'Movie' }],
	// Days of the month.
	['Pay rent the 13th', { s: '2026-11-13', title: 'Pay rent' }],
	['Pay rent on the 13th', { s: '2026-11-13', title: 'Pay rent' }],
	['Pay rent 13th', { s: '2026-11-13', title: 'Pay rent' }],
	['Bills on the 31st', { s: '2026-10-31', title: 'Bills' }],
	['Pay card by the 1st', { d: '2026-11-01', title: 'Pay card' }],
	// Numeric dates (month first; day first when it can't be a month).
	['Flight 11/20 8am', { s: '2026-11-20 08:00', title: 'Flight' }],
	['Flight 11/20/2027', { s: '2027-11-20', title: 'Flight' }],
	['Trip 20/11', { s: '2026-11-20', title: 'Trip' }],
	['Read 2026-11-12', { s: '2026-11-12', title: 'Read' }],
	// Relative.
	['Taxes end of month', { s: '2026-10-31', title: 'Taxes' }],
	['Taxes by end of the month', { d: '2026-10-31', title: 'Taxes' }],
	['Wrap up end of week', { s: '2026-10-30', title: 'Wrap up' }],
	['Report 2 days from now', { s: '2026-11-01', title: 'Report' }],
	['Report a week from today', { s: '2026-11-06', title: 'Report' }],
	['Dentist in 2 weeks', { s: '2026-11-13', title: 'Dentist' }],
	['Plan next thursday', { s: '2026-11-05', title: 'Plan' }],
	// Times.
	['Call at 3', { s: '2026-10-30 15:00', title: 'Call' }],
	['Call at 10', { s: '2026-10-30 10:00', title: 'Call' }],
	['Call 3p', { s: '2026-10-30 15:00', title: 'Call' }],
	['Call 3 p.m. tomorrow', { s: '2026-10-31 15:00', title: 'Call' }],
	['Gym tomorrow morning', { s: '2026-10-31 09:00', title: 'Gym' }],
	['Dinner tomorrow evening', { s: '2026-10-31 18:00', title: 'Dinner' }],
	['Call next friday at 3', { s: '2026-11-06 15:00', title: 'Call' }],
	['Workshop mon 9-11am', { s: '2026-11-02 09:00-11:00', title: 'Workshop' }],
	['Lunch at noon', { s: '2026-10-30 12:00', title: 'Lunch' }],
	// Repeats.
	// Org has no repeater for these: the next one only, marked as such.
	[
		'Book club every third friday',
		{ s: '2026-11-20', once: 'third Friday of the month', title: 'Book club' },
	],
	[
		'Pay card every last friday',
		{ s: '2026-10-30', once: 'last Friday of the month', title: 'Pay card' },
	],
	[
		'Team sync every 2nd tuesday',
		{ s: '2026-11-10', once: 'second Tuesday of the month', title: 'Team sync' },
	],
	['Standup every weekday', { s: '2026-10-30', once: 'weekday', title: 'Standup' }],
	['Rent every 1st', { s: '2026-11-01', r: '+1m', title: 'Rent' }],
	['Rent every month on the 1st', { s: '2026-11-01', r: '+1m', title: 'Rent' }],
	['Review every other friday', { s: '2026-10-30', r: '+2w', title: 'Review' }],
	['Standup biweekly', { s: '2026-10-30', r: '+2w', title: 'Standup' }],
	['Gym every monday 7am', { s: '2026-11-02 07:00', r: '+1w', title: 'Gym' }],
	['Water plants every 3 days', { s: '2026-10-30', r: '+3d', title: 'Water plants' }],
	[
		'Book club every third friday 7pm',
		{ s: '2026-11-20 19:00', once: 'third Friday of the month', title: 'Book club' },
	],
	[
		'Bins on the last monday of each month',
		{ s: '2026-11-30', once: 'last Monday of the month', title: 'Bins' },
	],
	['Call Sam this evening', { s: '2026-10-30 18:00', title: 'Call Sam' }],
	['Check in tom morning', { s: '2026-10-31 09:00', title: 'Check in' }],
	['Pay invoice due the 13th', { d: '2026-11-13', title: 'Pay invoice' }],
	['Ship release by end of week', { d: '2026-10-30', title: 'Ship release' }],
	['Sat exam sat 9am', { s: '2026-10-31 09:00', title: 'Sat exam' }],
	// Words that only look like dates stay words.
	['Enjoy the sun', { title: 'Enjoy the sun' }],
	['Sat with Ana', { title: 'Sat with Ana' }],
	['I may call', { title: 'I may call' }],
	['Read chapter 3', { title: 'Read chapter 3' }],
	['Buy 2 apples', { title: 'Buy 2 apples' }],
];

const when = (w: { date: string; time: string | null; endTime: string | null } | null) =>
	w ? `${w.date}${w.time ? ` ${w.time}` : ''}${w.endTime ? `-${w.endTime}` : ''}` : undefined;

describe('quick add reads what people type', () => {
	for (const [text, want] of CASES)
		it(text, () => {
			const q = parseQuickAdd(text, { today });
			expect({
				s: when(q.scheduled),
				d: when(q.deadline),
				r: q.repeater ?? undefined,
				once: q.once ?? undefined,
				title: q.title,
			}).toEqual({ s: undefined, d: undefined, r: undefined, once: undefined, ...want });
		});
});
