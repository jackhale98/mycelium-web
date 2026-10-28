import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYWORD_CONFIG } from '$lib/org';
import { Vault } from '$lib/vault/vault';
import {
	agendaDays,
	DEFAULT_STUCK,
	monthGrid,
	stuckProjects,
	stuckSettingsOf,
	weekAgenda,
	weekStart,
} from './agenda';

const vault = Vault.fromSources(
	{
		'tasks.org': [
			'* TODO Weekly review',
			'SCHEDULED: <2026-09-04 Fri 16:00 +1w>',
			'* TODO Dentist',
			'SCHEDULED: <2026-10-27 Tue 09:30>',
			'* TODO Tax return',
			'DEADLINE: <2026-10-20 Tue>',
			'* DONE Old thing',
			'SCHEDULED: <2026-10-28 Wed>',
			'* TODO Early call',
			'SCHEDULED: <2026-10-28 Wed 08:00>',
			'* TODO Lunch',
			'SCHEDULED: <2026-10-28 Wed 12:00>',
			'* TODO Stretch',
			'SCHEDULED: <2026-10-20 Tue .+1d>',
			':PROPERTIES:',
			':STYLE: habit',
			':END:',
			'* TODO Standup',
			'SCHEDULED: <2026-10-26 Mon 09:00 +1d>',
			'',
		].join('\n'),
	},
	DEFAULT_KEYWORD_CONFIG,
);

describe('weekAgenda', () => {
	it('starts weeks on Monday', () => {
		expect(weekStart('2026-10-28')).toBe('2026-10-26');
		expect(weekStart('2026-10-26')).toBe('2026-10-26');
		expect(weekStart('2026-11-01')).toBe('2026-10-26');
	});

	it('puts items on their days, repeats included, timed first; overdue carried to today', () => {
		const days = weekAgenda(vault, '2026-10-26', '2026-10-28');
		const titles = Object.fromEntries(days.map((d) => [d.date, d.items.map((i) => i.title)]));
		expect(titles).toEqual({
			'2026-10-26': ['Standup'],
			// A daily repeat shows where it's written, not on past days it was missed.
			'2026-10-27': ['Dentist'],
			// As org shows "Sched. 2x" and missed deadlines: on today, after the timed items.
			// The habit only today.
			'2026-10-28': [
				'Early call',
				'Standup',
				'Lunch',
				'Weekly review',
				'Dentist',
				'Tax return',
				'Stretch',
			],
			'2026-10-29': ['Standup'],
			'2026-10-30': ['Standup', 'Weekly review'],
			'2026-10-31': ['Standup'],
			'2026-11-01': ['Standup'],
		});
	});
});

describe('stuckProjects', () => {
	const projects = Vault.fromSources(
		{
			'work.org': [
				'* Projects',
				'** Website redesign',
				'*** NEXT Draft the sitemap',
				'** Garden shed',
				'*** WAITING Quote from builder',
				'*** Some notes',
				'** DONE Old launch',
				'** Tax prep :project:',
				'',
			].join('\n'),
		},
		{ ...DEFAULT_KEYWORD_CONFIG, todoKeywords: ['TODO', 'NEXT', 'WAITING'] },
	);
	const now = { date: '2026-10-28', time: '09:00' };

	it("finds org's default projects with no next action under them", () => {
		expect(stuckProjects(projects, DEFAULT_STUCK, now).map((p) => p.title)).toEqual([
			'Garden shed',
			'Tax prep',
		]);
	});

	it('follows a different project definition and next-action keywords', () => {
		expect(
			stuckProjects(projects, stuckSettingsOf({ match: '+project', keywords: ['NEXT'] }), now).map(
				(p) => p.title,
			),
		).toEqual(['Tax prep']);
		expect(
			stuckProjects(projects, stuckSettingsOf({ keywords: ['NEXT', 'WAITING'] }), now).map(
				(p) => p.title,
			),
		).toEqual(['Tax prep']);
	});

	it('is not stuck with a tagged heading or matching text under it, as org allows', () => {
		const more = Vault.fromSources(
			{
				'p.org': [
					'* Areas',
					'** Kitchen remodel :home:',
					'*** Ideas :someday:',
					'** Learn Rust',
					'Reading the book; see https://doc.rust-lang.org',
					'** Travel',
					'',
				].join('\n'),
			},
			DEFAULT_KEYWORD_CONFIG,
		);
		const titles = (s: Partial<typeof DEFAULT_STUCK>) =>
			stuckProjects(more, stuckSettingsOf(s), now).map((p) => p.title);
		expect(titles({})).toEqual(['Kitchen remodel', 'Learn Rust', 'Travel']);
		// A :someday: heading under it: parked, not stuck. (Tags it only inherits don't count.)
		expect(titles({ tags: ['someday'] })).toEqual(['Learn Rust', 'Travel']);
		expect(titles({ tags: ['home'] })).toEqual(['Kitchen remodel', 'Learn Rust', 'Travel']);
		expect(titles({ regexp: 'https?://' })).toEqual(['Kitchen remodel', 'Travel']);
		expect(() => titles({ regexp: '(' })).toThrow(/isn't a valid regular expression/);
	});
});

describe('agendaDays', () => {
	const v = Vault.fromSources(
		{
			'cal.org': [
				'* Team lunch <2026-10-29 Thu 12:30>',
				'* Conference',
				'<2026-10-30 Fri>--<2026-11-02 Mon>',
				'* TODO Report',
				'DEADLINE: <2026-10-30 Fri 17:00>',
				'',
			].join('\n'),
		},
		DEFAULT_KEYWORD_CONFIG,
	);
	it('shows appointments, ranges on every day, timed first', () => {
		const days = agendaDays(v, '2026-10-28', '2026-11-03', '2026-10-28');
		const titles = Object.fromEntries(days.map((d) => [d.date, d.items.map((i) => i.title)]));
		expect(titles).toEqual({
			'2026-10-28': [],
			'2026-10-29': ['Team lunch <2026-10-29 Thu 12:30>'],
			'2026-10-30': ['Report', 'Conference'],
			'2026-10-31': ['Conference'],
			'2026-11-01': ['Conference'],
			'2026-11-02': ['Conference'],
			'2026-11-03': [],
		});
	});
	it('covers a month in whole Monday-started weeks', () => {
		expect(monthGrid('2026-10')).toEqual({ start: '2026-09-28', end: '2026-11-01' });
		expect(monthGrid('2026-02')).toEqual({ start: '2026-01-26', end: '2026-03-01' });
		expect(monthGrid('2026-12')).toEqual({ start: '2026-11-30', end: '2027-01-03' });
	});
});
