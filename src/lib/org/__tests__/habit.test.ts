import { describe, expect, it } from 'vitest';
import {
	habitGraph,
	habitRhythm,
	habitStats,
	isHabit,
	makeHabit,
	parseHabit,
	unmakeHabit,
	type HabitCell,
} from '../habit';

// Org's graph string: one character per day, plus the untouched last cell.
const graph = (cells: HabitCell[]) => cells.map((c) => c.glyph || ' ').join('') + ' ';

/** org-test-habit-agenda-string (test-org-habit.el), newest log entry first. */
const shave = (type: string, deadline: boolean) => `* TODO Shave
SCHEDULED: <2009-10-17 Sat ${type}2d${deadline ? '/4d' : ''}>
:PROPERTIES:
:STYLE:    habit
:LAST_REPEAT: [2009-10-19 Mon 00:36]
:END:
- State "DONE"       from "TODO"       [2009-10-15 Thu]
- State "DONE"       from "TODO"       [2009-10-12 Mon]
- CLOSING NOTE [2009-10-10 Sat] \\
  this style occurs when \`org-log-done' is \`note'.
- State "DONE"       from "TODO"       [2009-10-04 Sun]
- State "DONE"       from "TODO"       [2009-10-02 Fri]
- State "DONE"       from "TODO"       [2009-09-29 Tue]
- State "DONE"       from "TODO"       [2009-09-25 Fri]
- State "DONE"       from "TODO"       [2009-09-19 Sat]
- State "DONE"       from "TODO"       [2009-09-16 Wed]
- State "DONE"       from "TODO"       [2009-09-12 Sat]
`;

describe('org-habit', () => {
	it('test-org-habit/habit: every repeater type, with and without a deadline period', () => {
		for (const type of ['.+', '+', '++'])
			for (const deadline of [false, true]) {
				const h = parseHabit(shave(type, deadline), 0);
				expect(h, `${type} ${deadline}`).not.toBeNull();
				expect(graph(habitGraph(h!, '2009-10-17'))).toBe('   *  * *     * *  * !       ');
			}
	});

	it('test-org-habit/simple-habit', () => {
		const src = `* TODO habit
SCHEDULED: <2009-10-21 Sat ++2d>
:PROPERTIES:
:STYLE:    habit
:END:
- State "DONE"       from "TODO"       [2009-10-19 Sun]
- State "DONE"       from "TODO"       [2009-10-17 Sun]`;
		expect(graph(habitGraph(parseHabit(src, 0)!, '2009-10-22'))).toBe(
			'                * *  !       ',
		);
	});

	it('test-org-habit/simple-habit/week: done today shows *', () => {
		const dates = ['16', '09', '02']
			.map((d) => `2026-06-${d}`)
			.concat(['2026-05-26', '2026-05-12']);
		const src = `* TODO habit
SCHEDULED: <2026-06-16 Tue +1w>
:PROPERTIES:
:STYLE:    habit
:END:
${dates.map((d) => `- State "DONE"       from "TODO"       [${d} Tue]`).join('\n')}`;
		expect(graph(habitGraph(parseHabit(src, 0)!, '2026-06-16'))).toBe(
			'*      *      *      *       ',
		);
	});

	it('test-org-habit/preceding-days and following-days', () => {
		// Those tests read from one column before the graph, hence their extra leading space.
		const h = parseHabit(shave('.+', false), 0)!;
		const at = (p: number, f = 7) => ` ${graph(habitGraph(h, '2009-10-17', p, f))}`;
		expect(at(10)).toBe('    * *  * !       ');
		expect(at(0)).toBe(' !       ');
		expect(at(2)).toBe(' * !       ');
		expect(at(21, 0)).toBe('    *  * *     * *  *  ');
		expect(at(21, 3)).toBe('    *  * *     * *  * !   ');
	});

	it('rejects bad habits as org-habit-parse-todo does', () => {
		const base = (sched: string, style = 'habit') =>
			`* TODO x\n${sched}\n:PROPERTIES:\n:STYLE: ${style}\n:END:\n`;
		expect(parseHabit(base('SCHEDULED: <2009-10-17 Sat>'), 0)).toBeNull();
		expect(parseHabit(base(''), 0)).toBeNull();
		expect(parseHabit(base('SCHEDULED: <2009-10-17 Sat .+2d/1d>'), 0)).toBeNull();
		expect(parseHabit(base('SCHEDULED: <2009-10-17 Sat .+2d>', 'nothabit'), 0)).toBeNull();
	});

	it('colours days as org-habit-get-faces does', () => {
		const h = parseHabit(shave('.+', false), 0)!;
		const cells = habitGraph(h, '2009-10-17');
		const today = cells.find((c) => c.date === '2009-10-17')!;
		// Scheduled today with no deadline period: the last day it may be done.
		expect(today.face).toBe('alert');
		expect(cells.at(-1)!.future).toBe(true);
		expect(cells.find((c) => c.date === '2009-10-15')!).toMatchObject({ done: true, glyph: '*' });
	});
});

describe('habit stats', () => {
	const habit = (repeater: string, days: string[]) =>
		parseHabit(
			`* TODO Walk\nSCHEDULED: <2026-10-29 Thu ${repeater}>\n:PROPERTIES:\n:STYLE: habit\n:END:\n${days
				.map((d) => `- State "DONE"       from "TODO"       [${d} 08:00]`)
				.join('\n')}\n`,
			0,
		)!;

	it('counts the streak back from the last completion, while within the window', () => {
		const h = habit('.+1d', ['2026-10-28', '2026-10-27', '2026-10-26', '2026-10-24']);
		const s = habitStats(h, '2026-10-29');
		expect(s.streak).toBe(3);
		expect(s.lastDone).toBe('2026-10-28');
		expect(s.done).toBe(4);
		expect(s.expected).toBe(28);
	});

	it('a missed window breaks the streak', () => {
		const h = habit('.+1d', ['2026-10-26', '2026-10-25']);
		expect(habitStats(h, '2026-10-29').streak).toBe(0);
	});

	it('a deadline period widens the window', () => {
		const h = habit('.+2d/4d', ['2026-10-26', '2026-10-22', '2026-10-19']);
		const s = habitStats(h, '2026-10-29');
		expect(s.window).toBe(4);
		expect(s.streak).toBe(3);
		expect(s.expected).toBe(14);
	});

	it('the rate is capped at 100%', () => {
		const h = habit('.+1w', ['2026-10-28', '2026-10-27', '2026-10-26', '2026-10-25', '2026-10-24']);
		expect(habitStats(h, '2026-10-29').rate).toBe(1);
	});

	it('says the rhythm in words', () => {
		expect(habitRhythm(habit('.+1d', []))).toBe('Every day');
		expect(habitRhythm(habit('++1w', []))).toBe('Every week');
		expect(habitRhythm(habit('.+3d', []))).toBe('Every 3 days');
		expect(habitRhythm(habit('.+2d/4d', []))).toBe('Every 2–4 days');
		expect(habitRhythm(habit('.+1w/2w', []))).toBe('Every 1–2 weeks');
	});
});

describe('turning a task into a habit', () => {
	const kw = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };
	it('adds STYLE and a daily repeat to an unscheduled task, from today', () => {
		expect(makeHabit('* TODO Stretch\n', 0, '2026-10-30', kw)).toBe(
			'* TODO Stretch\nSCHEDULED: <2026-10-30 Fri .+1d>\n:PROPERTIES:\n:STYLE:    habit\n:END:\n',
		);
	});
	it('adds a repeat to a schedule without one, and keeps one it has', () => {
		expect(
			makeHabit('* TODO Read\nSCHEDULED: <2026-11-02 Mon 07:30>\n', 0, '2026-10-30', kw),
		).toContain('SCHEDULED: <2026-11-02 Mon 07:30 .+1d>');
		const weekly = '* TODO Run\nSCHEDULED: <2026-11-02 Mon ++1w>\n';
		expect(makeHabit(weekly, 0, '2026-10-30', kw)).toContain('SCHEDULED: <2026-11-02 Mon ++1w>');
	});
	it('makes one isHabit reads, and undoes', () => {
		const h = makeHabit('* TODO Stretch\n', 0, '2026-10-30', kw);
		expect(isHabit(h, 0, kw)).toBe(true);
		expect(isHabit(unmakeHabit(h, 0, kw), 0, kw)).toBe(false);
	});
});
