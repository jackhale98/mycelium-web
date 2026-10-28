import { describe, expect, it } from 'vitest';
import {
	localTime,
	parseTimestamp,
	timestampDates,
	upcomingReminders,
	type ReminderSource,
} from '..';

const item = (over: Partial<ReminderSource> & { s?: string; d?: string }): ReminderSource => ({
	title: 'Call the bank',
	todo: 'TODO',
	scheduled: over.s ? parseTimestamp(over.s) : null,
	deadline: over.d ? parseTimestamp(over.d) : null,
	done: false,
	url: '#/node/x',
	key: 'notes.org|Call the bank',
	...over,
});

const opts = {
	from: localTime('2026-10-28', '08:00'),
	to: localTime('2026-11-04', '08:00'),
	lead: 10,
	scheduled: true,
	deadline: true,
	untimedAt: null,
};

describe('upcomingReminders', () => {
	it('reminds ahead of timed SCHEDULED and DEADLINE entries, earliest first', () => {
		const r = upcomingReminders(
			[
				item({ d: '<2026-10-29 Thu 17:00>' }),
				item({ title: 'Stand-up', key: 'b', s: '<2026-10-28 Wed 09:30>' }),
			],
			opts,
		);
		expect(r.map((x) => [x.title, x.body, x.at])).toEqual([
			['TODO Stand-up', 'Scheduled at 09:30', localTime('2026-10-28', '09:20')],
			['TODO Call the bank', 'Due at 17:00', localTime('2026-10-29', '16:50')],
		]);
	});

	it('leaves out done items, untimed ones (unless asked), inactive stamps and turned-off kinds', () => {
		expect(upcomingReminders([item({ s: '<2026-10-29 Thu 10:00>', done: true })], opts)).toEqual(
			[],
		);
		expect(upcomingReminders([item({ s: '<2026-10-29 Thu>' })], opts)).toEqual([]);
		expect(upcomingReminders([item({ s: '[2026-10-29 Thu 10:00]' })], opts)).toEqual([]);
		expect(
			upcomingReminders([item({ d: '<2026-10-29 Thu 10:00>' })], { ...opts, deadline: false }),
		).toEqual([]);
		const untimed = upcomingReminders([item({ d: '<2026-10-30 Fri>' })], {
			...opts,
			untimedAt: '09:00',
		});
		// At the set hour itself, not ahead of it.
		expect(untimed.map((x) => [x.at, x.body])).toEqual([[localTime('2026-10-30', '09:00'), 'Due']]);
	});

	it('repeats on the interval of every repeater style, from a date long past', () => {
		const at = (s: string) =>
			upcomingReminders([item({ s })], { ...opts, lead: 0 }).map((x) =>
				new Date(x.due).toDateString(),
			);
		expect(at('<2026-01-07 Wed 09:00 +1w>')).toEqual([new Date(2026, 9, 28).toDateString()]);
		expect(at('<2026-10-01 Thu 09:00 .+1d>')).toHaveLength(7);
		expect(at('<2025-11-03 Mon 09:00 ++1m>')).toEqual([new Date(2026, 10, 3).toDateString()]);
	});

	it('gives each occurrence its own stable id', () => {
		const a = upcomingReminders([item({ s: '<2026-10-28 Wed 12:00 +1d>' })], opts);
		const b = upcomingReminders([item({ s: '<2026-10-28 Wed 12:00 +1d>' })], opts);
		expect(a.map((x) => x.id)).toEqual(b.map((x) => x.id));
		expect(new Set(a.map((x) => x.id)).size).toBe(a.length);
	});
});

describe('timestampDates', () => {
	const ts = (s: string) => parseTimestamp(s)!;
	it('lists the days in a range a timestamp falls on, repeats included', () => {
		expect(timestampDates(ts('<2026-10-28 Wed>'), '2026-10-26', '2026-11-01')).toEqual([
			'2026-10-28',
		]);
		expect(timestampDates(ts('<2026-10-28 Wed>'), '2026-11-02', '2026-11-08')).toEqual([]);
		expect(timestampDates(ts('<2026-09-02 Wed +1w>'), '2026-10-26', '2026-11-01')).toEqual([
			'2026-10-28',
		]);
		expect(timestampDates(ts('<2026-10-27 Tue .+2d>'), '2026-10-26', '2026-11-01')).toEqual([
			'2026-10-27',
			'2026-10-29',
			'2026-10-31',
		]);
	});
});
