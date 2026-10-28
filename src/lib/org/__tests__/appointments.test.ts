import { describe, expect, it } from 'vitest';
import { appointmentsIn } from '..';

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
