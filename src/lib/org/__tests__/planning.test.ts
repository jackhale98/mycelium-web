import { describe, expect, it } from 'vitest';
import { getPlanning, setPlanning } from '../planning';
import { makeTimestamp, parseTimestamp, parseTimestampInput, withTimestamp } from '../timestamp';
import { apply } from './helpers';

const ts = (date: string, extra: Partial<Parameters<typeof makeTimestamp>[0]> = {}) => makeTimestamp({ date, ...extra });

describe('timestamps', () => {
	it('parses every component', () => {
		expect(parseTimestamp('<2024-01-15 Mon 09:00-10:30 ++1w -2d>')).toMatchObject({
			active: true,
			date: '2024-01-15',
			dayName: 'Mon',
			time: '09:00',
			endTime: '10:30',
			repeater: '++1w',
			warning: '-2d',
		});
	});

	it('edits only date tokens when only the date changes', () => {
		const t = parseTimestamp('<2024-01-15  Mon 09:00 +1w>')!;
		expect(withTimestamp(t, { date: '2024-01-22' }).raw).toBe('<2024-01-22  Mon 09:00 +1w>');
		expect(withTimestamp(t, { date: '2024-01-23' }).raw).toBe('<2024-01-23  Tue 09:00 +1w>');
	});

	it('keeps repeater cookies when a date picker supplies a new date', () => {
		const base = parseTimestamp('<2024-01-15 Mon +1w -2d>');
		expect(parseTimestampInput('2024-02-01', base)?.raw).toBe('<2024-02-01 Thu +1w -2d>');
	});
});

describe('setPlanning', () => {
	it('creates a planning line directly after the headline', () => {
		const src = '* TODO Task\n:PROPERTIES:\n:ID: x\n:END:\nBody\n';
		expect(apply(src, setPlanning(src, 0, 'DEADLINE', ts('2024-06-01')))).toBe(
			'* TODO Task\nDEADLINE: <2024-06-01 Sat>\n:PROPERTIES:\n:ID: x\n:END:\nBody\n',
		);
	});

	it('follows an indented planning convention', () => {
		const src = '* A\n  SCHEDULED: <2024-01-01 Mon>\n** B\n';
		const out = apply(src, setPlanning(src, src.indexOf('** B'), 'DEADLINE', ts('2024-01-02')));
		expect(out).toBe('* A\n  SCHEDULED: <2024-01-01 Mon>\n** B\n   DEADLINE: <2024-01-02 Tue>\n');
	});

	it('adds a terminator to a final headline without one', () => {
		const src = '* Task';
		expect(apply(src, setPlanning(src, 0, 'SCHEDULED', ts('2024-01-01')))).toBe('* Task\nSCHEDULED: <2024-01-01 Mon>');
	});

	it('replaces only the targeted timestamp', () => {
		const src = '* T\nSCHEDULED: <2024-01-15 Mon +1w>   DEADLINE: <2024-01-20 Sat>\n';
		expect(apply(src, setPlanning(src, 0, 'DEADLINE', ts('2024-01-21')))).toBe(
			'* T\nSCHEDULED: <2024-01-15 Mon +1w>   DEADLINE: <2024-01-21 Sun>\n',
		);
	});

	it('inserts entries in org order', () => {
		const src = '* T\nSCHEDULED: <2024-01-15 Mon>\n';
		const out = apply(src, setPlanning(src, 0, 'DEADLINE', ts('2024-01-20')));
		expect(out).toBe('* T\nDEADLINE: <2024-01-20 Sat> SCHEDULED: <2024-01-15 Mon>\n');
		const closed = apply(out, setPlanning(out, 0, 'CLOSED', ts('2024-01-16', { active: false, time: '10:00' })));
		expect(closed).toBe('* T\nCLOSED: [2024-01-16 Tue 10:00] DEADLINE: <2024-01-20 Sat> SCHEDULED: <2024-01-15 Mon>\n');
	});

	it('removes one entry and keeps the rest', () => {
		const src = '* T\nDEADLINE: <2024-01-20 Sat> SCHEDULED: <2024-01-15 Mon>\n';
		expect(apply(src, setPlanning(src, 0, 'DEADLINE', null))).toBe('* T\nSCHEDULED: <2024-01-15 Mon>\n');
		expect(apply(src, setPlanning(src, 0, 'SCHEDULED', null))).toBe('* T\nDEADLINE: <2024-01-20 Sat>\n');
	});

	it('removes the line with its last entry', () => {
		const src = '* T\nDEADLINE: <2024-01-20 Sat>\nBody\n';
		expect(apply(src, setPlanning(src, 0, 'DEADLINE', null))).toBe('* T\nBody\n');
	});

	it('ignores body text that mentions planning keywords', () => {
		const src = '* T\nThe DEADLINE: <2024-01-20 Sat> is soon\n';
		expect(getPlanning(src, 0).DEADLINE).toBeNull();
		const out = apply(src, setPlanning(src, 0, 'DEADLINE', ts('2024-02-01')));
		expect(out).toBe('* T\nDEADLINE: <2024-02-01 Thu>\nThe DEADLINE: <2024-01-20 Sat> is soon\n');
	});

	it('preserves CRLF', () => {
		const src = '* T\r\nBody\r\n';
		expect(apply(src, setPlanning(src, 0, 'SCHEDULED', ts('2024-01-01')))).toBe('* T\r\nSCHEDULED: <2024-01-01 Mon>\r\nBody\r\n');
	});
});
