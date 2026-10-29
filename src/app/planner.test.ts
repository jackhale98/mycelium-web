import { describe, expect, it } from 'vitest';
import { Vault } from '$lib/vault/vault';
import { dayPlan, fromMinutes, hours, layoutBlocks, planTotals, snap, toMinutes } from './planner';

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
});
