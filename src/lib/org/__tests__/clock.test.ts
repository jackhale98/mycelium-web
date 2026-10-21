import { describe, expect, it } from 'vitest';
import { applyChanges } from '../text';
import {
	clockCancel,
	clockDrawerName,
	clockDuration,
	clockEntries,
	clockIn,
	clockOut,
	clockStamp,
	formatDuration,
	runningClocks,
	subtreeClockSum,
} from '../clock';

const at9 = { date: '2026-10-21', time: '09:00' };
const at1030 = { date: '2026-10-21', time: '10:30' };

describe('clock formats', () => {
	it('stamps and durations as org-clock writes them', () => {
		expect(clockStamp(at9)).toBe('[2026-10-21 Wed 09:00]');
		expect(clockDuration(90)).toBe(' 1:30');
		expect(clockDuration(5)).toBe(' 0:05');
		expect(clockDuration(26 * 60)).toBe('26:00');
		expect(formatDuration(26 * 60 + 5)).toBe('1d 2:05');
		expect(formatDuration(45)).toBe('0:45');
	});
});

describe('clock in', () => {
	it('creates a LOGBOOK after the planning line and property drawer', () => {
		const src = '* TODO Task\nSCHEDULED: <2026-10-21 Wed>\n:PROPERTIES:\n:ID: x\n:END:\nBody\n';
		expect(applyChanges(src, clockIn(src, 0, at9))).toBe(
			'* TODO Task\nSCHEDULED: <2026-10-21 Wed>\n:PROPERTIES:\n:ID: x\n:END:\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]\n:END:\nBody\n',
		);
	});

	it('puts the new clock at the top of an existing drawer, keeping its indentation', () => {
		const src =
			'* Task\n  :LOGBOOK:\n  CLOCK: [2026-10-20 Tue 09:00]--[2026-10-20 Tue 10:00] =>  1:00\n  :END:\n';
		expect(applyChanges(src, clockIn(src, 0, at9))).toBe(
			'* Task\n  :LOGBOOK:\n  CLOCK: [2026-10-21 Wed 09:00]\n  CLOCK: [2026-10-20 Tue 09:00]--[2026-10-20 Tue 10:00] =>  1:00\n  :END:\n',
		);
	});

	it('uses the log drawer of state notes, and the heading alone at the end of a file', () => {
		const src = '* Task';
		expect(applyChanges(src, clockIn(src, 0, at9, { logDrawer: 'LOGBOOK' }))).toBe(
			'* Task\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]\n:END:',
		);
	});

	it('gathers loose CLOCK lines into the new drawer', () => {
		const src = '* Task\nCLOCK: [2026-10-20 Tue 09:00]--[2026-10-20 Tue 10:00] =>  1:00\nText\n';
		expect(applyChanges(src, clockIn(src, 0, at9))).toBe(
			'* Task\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]\nCLOCK: [2026-10-20 Tue 09:00]--[2026-10-20 Tue 10:00] =>  1:00\n:END:\nText\n',
		);
	});

	it('gathers several loose clocks back to front, as org-clock-find-position does', () => {
		const src = '* Task\nCLOCK: => 0:10\nCLOCK: => 0:20\n';
		expect(applyChanges(src, clockIn(src, 0, at9))).toBe(
			'* Task\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]\nCLOCK: => 0:20\nCLOCK: => 0:10\n:END:\n',
		);
	});

	it('honours an inherited CLOCK_INTO_DRAWER', () => {
		const src = '* P\n:PROPERTIES:\n:CLOCK_INTO_DRAWER: nil\n:END:\n** Child\n';
		const child = src.indexOf('** Child');
		expect(clockDrawerName(src, child, null)).toBeNull();
		expect(applyChanges(src, clockIn(src, child, at9))).toBe(
			'* P\n:PROPERTIES:\n:CLOCK_INTO_DRAWER: nil\n:END:\n** Child\nCLOCK: [2026-10-21 Wed 09:00]\n',
		);
		const named = '* P\n:PROPERTIES:\n:CLOCK_INTO_DRAWER: CLOCKING\n:END:\n';
		expect(clockDrawerName(named, 0, null)).toBe('CLOCKING');
	});

	it('ignores drawers and clocks inside source blocks', () => {
		const src = '* Task\n#+begin_src org\n:LOGBOOK:\n:END:\n#+end_src\n';
		const out = applyChanges(src, clockIn(src, 0, at9));
		expect(
			out.startsWith('* Task\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]\n:END:\n#+begin_src'),
		).toBe(true);
	});
});

describe('clock out and cancel', () => {
	const running = '* Task\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]\n:END:\n';

	it('closes the running clock with its duration', () => {
		expect(applyChanges(running, clockOut(running, 0, at1030))).toBe(
			'* Task\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]--[2026-10-21 Wed 10:30] =>  1:30\n:END:\n',
		);
		const overnight = { date: '2026-10-22', time: '11:00' };
		expect(applyChanges(running, clockOut(running, 0, overnight))).toContain('=> 26:00');
		expect(clockOut('* Task\n', 0, at1030)).toEqual([]);
	});

	it('cancels, removing an emptied drawer', () => {
		expect(applyChanges(running, clockCancel(running, 0))).toBe('* Task\n');
		const two =
			'* Task\n:LOGBOOK:\nCLOCK: [2026-10-21 Wed 09:00]\nCLOCK: [2026-10-20 Tue 09:00]--[2026-10-20 Tue 10:00] =>  1:00\n:END:\n';
		expect(applyChanges(two, clockCancel(two, 0))).toBe(
			'* Task\n:LOGBOOK:\nCLOCK: [2026-10-20 Tue 09:00]--[2026-10-20 Tue 10:00] =>  1:00\n:END:\n',
		);
	});

	it('finds running clocks in a file', () => {
		expect(runningClocks(running)).toEqual([
			{ heading: 0, title: 'Task', start: at9, line: running.indexOf('CLOCK') },
		]);
	});
});

describe('clock sums', () => {
	// From test-org-clock/org-clock-sum: open clocks don't count.
	const src = `* This is test
CLOCK: [2025-10-18 Sat 09:00]--[2025-10-18 Sat 10:00] =>  1:00
** Child
:LOGBOOK:
CLOCK: [2025-10-18 Sat 13:00]
CLOCK: [2025-10-18 Sat 10:00]--[2025-10-18 Sat 11:00] =>  1:00
:END:
#+begin_src org
CLOCK: [2025-10-18 Sat 01:00]--[2025-10-18 Sat 05:00] =>  4:00
#+end_src
* Other
CLOCK: => 0:30
`;
	it('sums subtrees from the timestamps, skipping running clocks and blocks', () => {
		expect(subtreeClockSum(src, 0)).toBe(120);
		expect(subtreeClockSum(src, src.indexOf('** Child'))).toBe(60);
		expect(subtreeClockSum(src, src.indexOf('* Other'))).toBe(30);
	});

	it('clips to a range and lists entries for a report', () => {
		const start = new Date(2025, 9, 18, 9, 30).getTime();
		const end = new Date(2025, 9, 18, 10, 30).getTime();
		expect(subtreeClockSum(src, 0, undefined, { start, end })).toBe(60);
		expect(clockEntries(src).map((e) => [e.title, e.minutes, e.olp])).toEqual([
			['This is test', 60, []],
			['Child', 60, ['This is test']],
			['Other', 30, []],
		]);
	});
});
