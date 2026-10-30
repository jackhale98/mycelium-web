import { describe, expect, it } from 'vitest';
import { Vault } from '$lib/vault/vault';
import {
	dayPlan,
	fillSessions,
	fromMinutes,
	hours,
	layoutBlocks,
	planDays,
	planTotals,
	snap,
	taskKey,
	toMinutes,
} from './planner';

const kw = { todoKeywords: ['TODO'], doneKeywords: ['DONE'] };

describe('day planner', () => {
	it('converts and snaps times', () => {
		expect(toMinutes('09:30')).toBe(570);
		expect(fromMinutes(570)).toBe('09:30');
		expect(fromMinutes(-5)).toBe('00:00');
		expect(fromMinutes(2000)).toBe('23:59');
		expect(snap(577)).toBe(570);
		expect(snap(583)).toBe(585);
	});

	it('lays overlapping blocks side by side, and lone ones full width', () => {
		const out = layoutBlocks([
			{ id: 'a', start: 540, end: 600 },
			{ id: 'b', start: 570, end: 630 },
			{ id: 'c', start: 600, end: 660 },
			{ id: 'd', start: 720, end: 780 },
		]);
		const by = Object.fromEntries(out.map((b) => [b.id, b]));
		expect([by['a']!.col, by['b']!.col, by['c']!.col]).toEqual([0, 1, 0]);
		expect([by['a']!.cols, by['b']!.cols, by['c']!.cols]).toEqual([2, 2, 2]);
		expect([by['d']!.col, by['d']!.cols]).toEqual([0, 1]);
	});

	it('counts planned time once inside working hours', () => {
		const t = planTotals(
			[
				{ start: 480, end: 600 }, // 08:00-10:00: only 09:00-10:00 counts
				{ start: 570, end: 630 }, // overlaps the first
				{ start: 1080, end: 1140 }, // after hours
			],
			{ start: '09:00', end: '18:00' },
		);
		expect(t).toEqual({ planned: 90, free: 450 });
		expect(hours(270)).toBe('4 h 30');
		expect(hours(45)).toBe('45 min');
		expect(hours(120)).toBe('2 h');
	});

	it('reads a day: ranges, Effort, the default length, appointments, and what to plan', () => {
		const vault = Vault.fromSources(
			{
				'a.org': [
					'* TODO Write report',
					'SCHEDULED: <2026-10-29 Thu 09:00-10:30>',
					'* TODO Call Sam',
					'SCHEDULED: <2026-10-29 Thu 14:00>',
					':PROPERTIES:',
					':Effort:   0:45',
					':END:',
					'* TODO Water plants',
					'SCHEDULED: <2026-10-29 Thu 16:00>',
					'* Dentist',
					'Appointment <2026-10-29 Thu 11:00-11:30>.',
					'* TODO Buy stamps',
					'SCHEDULED: <2026-10-29 Thu>',
					'* Conference',
					'<2026-10-29 Thu>',
					'',
				].join('\n'),
			},
			kw,
		);
		const plan = dayPlan(vault, '2026-10-29', '2026-10-29');
		const by = Object.fromEntries(plan.blocks.map((b) => [b.item.title, b]));
		expect(by['Write report']).toMatchObject({
			start: 540,
			end: 630,
			ranged: true,
			source: 'SCHEDULED',
		});
		expect(by['Call Sam']).toMatchObject({ start: 840, end: 885, ranged: false });
		expect(by['Water plants']).toMatchObject({ start: 960, end: 990 });
		expect(by['Dentist']).toMatchObject({ start: 660, end: 690, source: 'appointment' });
		expect(plan.unplanned.map((i) => i.title)).toEqual(['Buy stamps']);
		expect(plan.allDay.map((i) => i.title)).toEqual(['Conference']);
	});

	it('reads sessions on the day, and tracks Effort planned across days', () => {
		const vault = Vault.fromSources(
			{
				'r.org': [
					'* TODO Write the report',
					'SCHEDULED: <2026-10-28 Wed>',
					':PROPERTIES:',
					':Effort:   12:00',
					':END:',
					'<2026-10-28 Wed 09:00-12:00>',
					'<2026-10-29 Thu 13:00-15:00>',
					'<2026-10-29 Thu 16:00-17:00>',
					'Agreed with Sam <2026-10-29 Thu 10:00-10:30>.',
					'',
				].join('\n'),
			},
			kw,
		);
		const plan = dayPlan(vault, '2026-10-29', '2026-10-29');
		const sessions = plan.blocks.filter((b) => b.source === 'session');
		expect(sessions.map((b) => [b.start, b.end])).toEqual([
			[780, 900],
			[960, 1020],
		]);
		expect(plan.blocks.find((b) => b.source === 'appointment')).toMatchObject({
			start: 600,
			end: 630,
		});
		const item = plan.blocks[0]!.item;
		// 3 h + 2 h + 1 h of 12 h planned: still in the tray.
		expect(plan.progress.get(taskKey(item))).toEqual({ effort: 720, planned: 360 });
		expect(plan.unplanned.map((i) => i.title)).toEqual(['Write the report']);
		// A later day with no session still offers it, while Effort is left.
		expect(dayPlan(vault, '2026-10-31', '2026-10-29').unplanned.map((i) => i.title)).toEqual([
			'Write the report',
		]);
		// Several days at once read the same as one at a time.
		const days = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31'];
		const strip = (p: ReturnType<typeof dayPlan>) => ({
			blocks: p.blocks,
			unplanned: p.unplanned,
			allDay: p.allDay,
		});
		expect(planDays(vault, days, '2026-10-29').map(strip)).toEqual(
			days.map((d) => strip(dayPlan(vault, d, '2026-10-29'))),
		);
		// Effort in other units: 2d of an 8-hour day.
		const twoDays = dayPlan(vault, '2026-10-29', '2026-10-29', undefined, { effortOf: () => 960 });
		expect(twoDays.progress.get(taskKey(item))?.effort).toBe(960);
	});

	it("doesn't offer a task to plan on its deadline day once it has a time", () => {
		const vault = Vault.fromSources(
			{
				'd.org': [
					'* TODO Generate CAD estimates',
					'SCHEDULED: <2026-10-30 Fri 13:15-14:30> DEADLINE: <2026-11-01 Sun>',
					'* TODO Not placed yet',
					'DEADLINE: <2026-11-01 Sun>',
					'* TODO Long one',
					'SCHEDULED: <2026-10-30 Fri 09:00-10:00> DEADLINE: <2026-11-01 Sun>',
					':PROPERTIES:',
					':Effort:   3:00',
					':END:',
					'',
				].join('\n'),
			},
			kw,
		);
		const week = ['2026-10-30', '2026-10-31', '2026-11-01'];
		const [fri, , sun] = planDays(vault, week, '2026-10-30');
		expect(fri!.blocks.map((b) => b.item.title).sort()).toEqual([
			'Generate CAD estimates',
			'Long one',
		]);
		// Sunday: the one with no time yet, and the one with Effort left; not the placed one.
		expect(sun!.unplanned.map((i) => i.title).sort()).toEqual(['Long one', 'Not placed yet']);
	});

	it('fills the rest of an estimate into free working time', () => {
		const busy: Record<string, { start: number; end: number }[]> = {
			'2026-10-29': [{ start: 600, end: 720 }], // 10:00-12:00 taken
		};
		const out = fillSessions(400, '2026-10-29', 9 * 60 + 5, (d) => busy[d] ?? [], {
			start: '09:00',
			end: '13:00',
		});
		expect(out).toEqual([
			{ date: '2026-10-29', start: 555, end: 600 }, // 09:15, the next quarter hour, to 10:00
			{ date: '2026-10-29', start: 720, end: 780 }, // after the busy stretch, to closing
			{ date: '2026-10-30', start: 540, end: 660 }, // the next day, 2 h at most
			{ date: '2026-10-30', start: 660, end: 780 },
			{ date: '2026-10-31', start: 540, end: 595 }, // what's left: 55 min
		]);
	});
});
