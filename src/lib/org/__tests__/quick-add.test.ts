import { describe, expect, it } from 'vitest';
import { applyQuickAdd, describeQuickPart, parseQuickAdd } from '../quick-add';

const today = '2026-10-29'; // a Thursday
const keywords = { todoKeywords: ['TODO', 'NEXT', 'WAIT'], doneKeywords: ['DONE'] };
const parse = (text: string, keep?: number[]) =>
	parseQuickAdd(text, { today, keywords, ...(keep ? { keep } : {}) });

describe('quick add', () => {
	it('reads the example from the plan', () => {
		const q = parse('Call Sam tomorrow 3pm #work !A every week ~30m');
		expect(q.title).toBe('Call Sam');
		expect(q.scheduled).toEqual({ date: '2026-10-30', time: '15:00', endTime: null });
		expect(q.repeater).toBe('+1w');
		expect(q.tags).toEqual(['work']);
		expect(q.priority).toBe('A');
		expect(q.effort).toBe(30);
		expect(q.parts.map((p) => p.kind)).toEqual([
			'date',
			'time',
			'tag',
			'priority',
			'repeat',
			'effort',
		]);
	});

	it('reads dates', () => {
		const date = (t: string) => parse(`x ${t}`).scheduled?.date;
		expect(date('today')).toBe('2026-10-29');
		expect(date('tmr')).toBe('2026-10-30');
		expect(date('fri')).toBe('2026-10-30');
		expect(date('thursday')).toBe('2026-10-29'); // today counts, as in org-read-date
		expect(date('on monday')).toBe('2026-11-02');
		expect(date('this sat')).toBe('2026-10-31');
		expect(date('next fri')).toBe('2026-11-06'); // Friday of next week
		expect(date('next week')).toBe('2026-11-02');
		expect(date('this weekend')).toBe('2026-10-31');
		expect(date('next month')).toBe('2026-11-01');
		expect(date('in 3 days')).toBe('2026-11-01');
		expect(date('in two weeks')).toBe('2026-11-12');
		expect(date('in a month')).toBe('2026-11-29');
		expect(date('nov 4')).toBe('2026-11-04');
		expect(date('4th december')).toBe('2026-12-04');
		expect(date('jan 2')).toBe('2027-01-02'); // past this year: next year's
		expect(date('2027-03-15')).toBe('2027-03-15');
	});

	it('reads times and ranges', () => {
		const at = (t: string) => {
			const s = parse(`x ${t}`).scheduled;
			return s ? `${s.time}${s.endTime ? `-${s.endTime}` : ''}` : null;
		};
		expect(at('3pm')).toBe('15:00');
		expect(at('at 9:30am')).toBe('09:30');
		expect(at('15:00')).toBe('15:00');
		expect(at('noon')).toBe('12:00');
		expect(at('3-4pm')).toBe('15:00-16:00');
		expect(at('11-1pm')).toBe('11:00-13:00');
		expect(at('15:00-16:30')).toBe('15:00-16:30');
		expect(at('from 9am to 11am')).toBe('09:00-11:00');
		// A time alone is today's.
		expect(parse('stand-up 9:15').scheduled?.date).toBe(today);
	});

	it('reads deadlines alongside a schedule', () => {
		const q = parse('Draft report mon due fri 5pm');
		expect(q.title).toBe('Draft report');
		expect(q.scheduled).toEqual({ date: '2026-11-02', time: null, endTime: null });
		expect(q.deadline).toEqual({ date: '2026-10-30', time: '17:00', endTime: null });
		expect(parse('Pay rent by nov 1').deadline?.date).toBe('2026-11-01');
	});

	it('reads repeats', () => {
		expect(parse('x daily').repeater).toBe('+1d');
		expect(parse('x every 2 weeks').repeater).toBe('+2w');
		expect(parse('x every other month').repeater).toBe('+2m');
		const q = parse('Gym every monday');
		expect(q.repeater).toBe('+1w');
		expect(q.scheduled?.date).toBe('2026-11-02');
		// A repeat with no date starts today.
		expect(parse('Water plants weekly').scheduled?.date).toBe(today);
	});

	it('reads tags, priority, effort and a leading keyword', () => {
		const q = parse('NEXT Plan trip #travel:family !2 ~1h30');
		expect(q.todo).toBe('NEXT');
		expect(q.title).toBe('Plan trip');
		expect(q.tags).toEqual(['travel', 'family']);
		expect(q.priority).toBe('B');
		expect(q.effort).toBe(90);
		// Only the vault's keywords, only at the start.
		expect(parse('Call NEXT door').todo).toBeNull();
	});

	it('leaves words alone that only look like dates or times', () => {
		expect(parse('Mayday drill').title).toBe('Mayday drill');
		expect(parse('Buy 3 apples').scheduled).toBeNull();
		expect(parse('Read issue #12 notes').tags).toEqual(['12']);
		expect(parse('Email a@b.com').tags).toEqual([]);
		expect(parse('feb 30 party').scheduled).toBeNull();
		const q = parse('"Sunday school" notes');
		expect(q.title).toBe('Sunday school notes');
		expect(q.scheduled).toBeNull();
	});

	it('keeps a part as words when asked', () => {
		const first = parse('Lunch with Friday team fri');
		const friday = first.parts.find((p) => p.text === 'Friday')!;
		const q = parse('Lunch with Friday team fri', [friday.from]);
		expect(q.title).toBe('Lunch with Friday team');
		expect(q.scheduled?.date).toBe('2026-10-30');
	});

	it('describes parts for chips', () => {
		const q = parse('Call Sam tomorrow 3-4pm weekly ~1h30 due nov 4 !A');
		const labels = q.parts.map((p) => describeQuickPart(p, q, today));
		expect(labels).toContain('Tomorrow');
		expect(labels).toContain('15:00–16:00');
		expect(labels).toContain('Repeats every week');
		expect(labels).toContain('1 h 30 min');
		expect(labels.some((l) => l.startsWith('Due '))).toBe(true);
		expect(labels).toContain('Priority A');
	});

	it('applies to a captured entry', () => {
		const q = parse('Call Sam tomorrow 3pm #work !A every week ~30m');
		const entry = '* TODO Call Sam\nSCHEDULED: <2026-10-29 Thu>\n';
		const out = applyQuickAdd(entry, q, keywords);
		expect(out).toMatch(/^\* TODO \[#A\] Call Sam +:work:\n/);
		expect(out).toContain('SCHEDULED: <2026-10-30 Fri 15:00 +1w>');
		expect(out).not.toContain('2026-10-29');
		expect(out).toMatch(/:Effort: +0:30/);
	});

	it('a deadline alone replaces the template’s "scheduled today"', () => {
		const q = parse('Pay rent due nov 1');
		const out = applyQuickAdd('* TODO Pay rent\nSCHEDULED: <2026-10-29 Thu>\n', q, keywords);
		expect(out).toContain('DEADLINE: <2026-11-01 Sun>');
		expect(out).not.toContain('SCHEDULED');
	});

	it('a leading keyword sets the state', () => {
		const q = parse('WAIT reply from Sam');
		const out = applyQuickAdd('* TODO reply from Sam\n', q, keywords);
		expect(out).toMatch(/^\* WAIT reply from Sam/);
	});
});
