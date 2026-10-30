import { describe, expect, it } from 'vitest';
import { durationToMinutes, durationUnits, effortValue, orgDurationUnitsLisp } from '../duration';
import { addSession, removeSession, sessionsOf, setSession } from '../sessions';
import { applyChanges } from '../text';
import { makeTimestamp } from '../timestamp';

const ts = (date: string, time: string, endTime: string) =>
	makeTimestamp({ date, time, endTime, active: true });

const entry = [
	'* TODO Write the report',
	'SCHEDULED: <2026-11-02 Mon>',
	':PROPERTIES:',
	':Effort:   12:00',
	':END:',
	':LOGBOOK:',
	'- Note taken on [2026-10-30 Fri 10:00] \\\\',
	'  outline first',
	':END:',
	'Some notes about it.',
	'Meeting <2026-11-05 Thu 10:00> to agree the outline.',
	'** TODO A sub-task',
	'<2026-11-06 Fri 09:00-10:00>',
	'',
].join('\n');

describe('work sessions', () => {
	it('adds the first after the planning line and drawers, then after the last one', () => {
		let s = applyChanges(entry, addSession(entry, 0, ts('2026-11-02', '09:00', '12:00')));
		s = applyChanges(s, addSession(s, 0, ts('2026-11-03', '13:00', '17:00')));
		expect(s.split('\n').slice(8, 12)).toEqual([
			':END:',
			'<2026-11-02 Mon 09:00-12:00>',
			'<2026-11-03 Tue 13:00-17:00>',
			'Some notes about it.',
		]);
		// Only lines that are a timestamp alone, and only the entry's own (not a child's).
		expect(sessionsOf(s, 0).map((x) => x.timestamp.raw)).toEqual([
			'<2026-11-02 Mon 09:00-12:00>',
			'<2026-11-03 Tue 13:00-17:00>',
		]);
	});

	it('moves and removes a session, line and all', () => {
		const s = applyChanges(entry, addSession(entry, 0, ts('2026-11-02', '09:00', '12:00')));
		const [first] = sessionsOf(s, 0);
		const moved = applyChanges(s, setSession(first!, ts('2026-11-02', '10:00', '12:30')));
		expect(moved).toContain('\n<2026-11-02 Mon 10:00-12:30>\nSome notes');
		const [again] = sessionsOf(moved, 0);
		expect(applyChanges(moved, removeSession(moved, again!))).toBe(entry);
	});

	it('works on a bare heading, and on a last line without a newline', () => {
		const bare = '* TODO Call Sam';
		expect(applyChanges(bare, addSession(bare, 0, ts('2026-11-02', '09:00', '09:30')))).toBe(
			'* TODO Call Sam\n<2026-11-02 Mon 09:00-09:30>',
		);
		const planned = '* TODO Call Sam\nSCHEDULED: <2026-11-02 Mon>\n';
		expect(applyChanges(planned, addSession(planned, 0, ts('2026-11-02', '09:00', '09:30')))).toBe(
			'* TODO Call Sam\nSCHEDULED: <2026-11-02 Mon>\n<2026-11-02 Mon 09:00-09:30>\n',
		);
	});
});

describe('effort units', () => {
	it("reads durations with org's defaults or a working day", () => {
		expect(durationToMinutes('2d')).toBe(2880);
		const work = durationUnits(8, 5);
		expect(durationToMinutes('2d', work)).toBe(960);
		expect(durationToMinutes('1w', work)).toBe(2400);
		expect(durationToMinutes('1d 2:30', work)).toBe(630);
		expect(durationToMinutes('1:30', work)).toBe(90);
		expect(durationUnits()).toMatchObject({ d: 1440, w: 10080, m: 43200, y: 525960 });
	});

	it('reads an Effort typed by hand', () => {
		for (const [typed, org] of [
			['1:30', '1:30'],
			['90', '1:30'],
			['90m', '1:30'],
			['45 min', '0:45'],
			['1h30', '1:30'],
			['1h 30m', '1:30'],
			['1.5h', '1:30'],
			['2h', '2:00'],
			['2d', '2d'],
			['1d 3:00', '1d 3:00'],
		] as const)
			expect(effortValue(typed), typed).toBe(org);
		expect(effortValue('')).toBeNull();
		expect(effortValue('soon')).toBeUndefined();
		expect(effortValue('0')).toBeUndefined();
	});

	it('writes the matching Emacs setting', () => {
		expect(orgDurationUnitsLisp(durationUnits(8, 5))).toBe(
			`(setq org-duration-units '(("min" . 1) ("h" . 60) ("d" . 480) ("w" . 2400) ("m" . 9600) ("y" . 124800)))`,
		);
	});
});
