import { describe, expect, it } from 'vitest';
import { DEMO_DAY, demoSourcesFor, shiftDates } from './demo';

describe('demo dates', () => {
	it('moves dates and their weekdays, leaving IDs and file stamps alone', () => {
		const text =
			':ID:       d0a1b2c3-0000-4000-8000-202610200001\nSCHEDULED: <2026-10-20 Tue .+1d>\n- State "DONE" from "TODO" [2026-10-19 Mon 08:05]\n#+title: 2026-10-18\n';
		expect(shiftDates(text, 9)).toBe(
			':ID:       d0a1b2c3-0000-4000-8000-202610200001\nSCHEDULED: <2026-10-29 Thu .+1d>\n- State "DONE" from "TODO" [2026-10-28 Wed 08:05]\n#+title: 2026-10-27\n',
		);
		expect(shiftDates('<2026-12-30 Wed>', 3)).toBe('<2027-01-02 Sat>');
		expect(shiftDates('<2026-10-20 Tue>', -20)).toBe('<2026-09-30 Wed>');
	});

	it('dates the demo for today: dailies, schedules and their file names', () => {
		const same = demoSourcesFor(DEMO_DAY);
		expect(same['daily/2026-10-20.org']).toContain('#+title: 2026-10-20');
		const later = demoSourcesFor('2027-03-02');
		expect(later['daily/2027-03-02.org']).toContain('#+title: 2027-03-02');
		expect(later['daily/2026-10-20.org']).toBeUndefined();
		const flashcards = Object.entries(later).find(([p]) => p.includes('spaced_repetition'))![1];
		expect(flashcards).toContain('SCHEDULED: <2027-03-02 Tue .+1d>');
		expect(flashcards).toContain('[2027-03-01 Mon 08:05]');
	});
});
