import { describe, expect, it } from 'vitest';
import { matches, MatchSyntaxError, parseMatch, type MatchEntry } from '../match';
import { parseTimestamp } from '../timestamp';

const ctx = {
	now: { date: '2026-10-20', time: '09:00' },
	isDone: (k: string) => k === 'DONE' || k === 'CANCELLED',
};
const entry = (over: Partial<MatchEntry> & { props?: Record<string, string> } = {}) => {
	const { props, ...rest } = over;
	const e: MatchEntry = {
		title: 'Task',
		todo: 'TODO',
		priority: null,
		tags: [],
		level: 1,
		category: 'work',
		scheduled: null,
		deadline: null,
		closed: null,
		file: 'a.org',
		...rest,
	};
	return [e, { ...ctx, properties: () => props ?? {} }] as const;
};
const ok = (q: string, over: Parameters<typeof entry>[0] = {}) => {
	const [e, c] = entry(over);
	return matches(parseMatch(q), e, c);
};

describe('org match strings (manual examples)', () => {
	it('+work-boss', () => {
		expect(ok('+work-boss', { tags: ['work'] })).toBe(true);
		expect(ok('+work-boss', { tags: ['work', 'boss'] })).toBe(false);
		expect(ok('work-boss', { tags: ['work'] })).toBe(true);
	});

	it('work|laptop+night: & binds tighter than |', () => {
		expect(ok('work|laptop+night', { tags: ['work'] })).toBe(true);
		expect(ok('work|laptop+night', { tags: ['laptop'] })).toBe(false);
		expect(ok('work|laptop+night', { tags: ['laptop', 'night'] })).toBe(true);
		expect(ok('work|laptop&night', { tags: ['laptop', 'night'] })).toBe(true);
	});

	it('tag regexps', () => {
		expect(ok('work+{^boss.*}', { tags: ['work', 'bossman'] })).toBe(true);
		expect(ok('work+{^boss.*}', { tags: ['work', 'theboss'] })).toBe(false);
	});

	it('TODO part with /!', () => {
		expect(ok('work/!-WAITING-NEXT', { tags: ['work'], todo: 'TODO' })).toBe(true);
		expect(ok('work/!-WAITING-NEXT', { tags: ['work'], todo: 'NEXT' })).toBe(false);
		expect(ok('work/!-WAITING-NEXT', { tags: ['work'], todo: 'DONE' })).toBe(false);
		expect(ok('work/!-WAITING-NEXT', { tags: ['work'], todo: null })).toBe(false);
		expect(ok('work/!+WAITING|+NEXT', { tags: ['work'], todo: 'NEXT' })).toBe(true);
		expect(ok('work/WAITING', { tags: ['work'], todo: 'WAITING' })).toBe(true);
		expect(ok('/DONE', { todo: 'DONE' })).toBe(true);
	});

	it('property comparisons', () => {
		expect(ok('PRIORITY="A"', { priority: 'A' })).toBe(true);
		expect(ok('PRIORITY="B"')).toBe(true); // org's default priority
		expect(ok('TODO="DONE"', { todo: 'DONE' })).toBe(true);
		expect(ok('LEVEL=2', { level: 2 })).toBe(true);
		expect(ok('LEVEL>1', { level: 1 })).toBe(false);
		expect(ok('CATEGORY="work"')).toBe(true);
		expect(ok('With={Sarah\\|Denny}', { props: { WITH: 'Denny' } })).toBe(true);
		expect(ok('With<>{Sarah\\|Denny}', { props: { WITH: 'Denny' } })).toBe(false);
		expect(ok('boss\\-prio="C"', { props: { 'BOSS-PRIO': 'C' } })).toBe(true);
	});

	it('starred operators need the property', () => {
		expect(ok('Effort<*2', { props: {} })).toBe(false);
		expect(ok('Effort<2', { props: {} })).toBe(true);
		expect(ok('Effort<*2', { props: { EFFORT: '1' } })).toBe(true);
	});

	it('dates', () => {
		const deadline = parseTimestamp('<2026-10-19 Mon>');
		expect(ok('DEADLINE<="<today>"', { deadline })).toBe(true);
		expect(ok('DEADLINE<="<-2d>"', { deadline })).toBe(false);
		expect(ok('DEADLINE>="<2026-10-01>"', { deadline })).toBe(true);
		expect(ok('SCHEDULED<="<tomorrow>"', { scheduled: null })).toBe(false);
	});

	it('reports syntax errors', () => {
		expect(() => parseMatch('work+{unclosed')).toThrow(MatchSyntaxError);
		expect(() => parseMatch('PRIORITY=')).toThrow(MatchSyntaxError);
		expect(() => parseMatch('work!!')).toThrow(MatchSyntaxError);
	});
});
