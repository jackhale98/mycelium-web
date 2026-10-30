import { describe, expect, it } from 'vitest';
import { appointmentsIn, applyQuickAdd, floatDates, parseQuickAdd } from '..';

describe('appointmentsIn', () => {
	const src = [
		'Before any heading <2026-10-01 Thu>',
		'* Dentist <2026-10-29 Thu 09:30>',
		'SCHEDULED: <2026-10-28 Wed>',
		':PROPERTIES:',
		':CREATED: <2026-01-01 Thu>',
		':END:',
		'Bring the form. Also <2026-11-05 Thu 14:00-15:00>, not [2026-11-06 Fri].',
		'#+begin_src org',
		'<2026-12-01 Tue>',
		'#+end_src',
		'** Conference',
		'<2026-11-10 Tue>--<2026-11-12 Thu>',
		':LOGBOOK:',
		'- Note taken on <2026-10-20 Tue>',
		':END:',
		'',
	].join('\n');

	it('finds active timestamps in headings and text, skipping planning, drawers and blocks', () => {
		const found = appointmentsIn(src);
		const dentist = src.indexOf('* Dentist');
		const conf = src.indexOf('** Conference');
		expect([...found.keys()]).toEqual([dentist, conf]);
		expect(
			found.get(dentist)!.map((a) => [a.timestamp.date, a.timestamp.time, a.timestamp.endTime]),
		).toEqual([
			['2026-10-29', '09:30', null],
			['2026-11-05', '14:00', '15:00'],
		]);
		expect(found.get(conf)!.map((a) => [a.timestamp.date, a.until])).toEqual([
			['2026-11-10', '2026-11-12'],
		]);
	});
});

describe('diary-float (every third Friday)', () => {
	it('finds the Nth or last weekday of each month', () => {
		const third = { month: null, dayname: 5, n: 3 };
		expect(floatDates(third, '2026-10-01', '2027-01-31')).toEqual([
			'2026-10-16',
			'2026-11-20',
			'2026-12-18',
			'2027-01-15',
		]);
		const last = { month: null, dayname: 1, n: -1 };
		expect(floatDates(last, '2026-11-01', '2026-12-31')).toEqual(['2026-11-30', '2026-12-28']);
		// One month only, and a fifth that some months don't have.
		expect(floatDates({ month: 3, dayname: 5, n: 1 }, '2026-01-01', '2027-12-31')).toEqual([
			'2026-03-06',
			'2027-03-05',
		]);
		expect(floatDates({ month: null, dayname: 4, n: 5 }, '2026-10-01', '2026-12-31')).toEqual([
			'2026-10-29',
			'2026-12-31',
		]);
	});

	it('reads the sexp in an entry, with its time', () => {
		const found = appointmentsIn('* Book club\n<%%(diary-float t 5 3) 19:00-21:00>\n').get(0)!;
		expect(found[0]!.float).toEqual({ month: null, dayname: 5, n: 3 });
		expect([found[0]!.timestamp.time, found[0]!.timestamp.endTime]).toEqual(['19:00', '21:00']);
	});

	it('is what quick add writes for "every third friday"', () => {
		const q = parseQuickAdd('Book club every third friday 7pm', { today: '2026-10-30' });
		expect(applyQuickAdd('* TODO %?\n'.replace('%?', q.title), q)).toBe(
			'* TODO 19:00 Book club\n<%%(diary-float t 5 3)>\n',
		);
	});
});
