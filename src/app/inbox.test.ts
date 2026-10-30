import { describe, expect, it } from 'vitest';
import { inboxEntries } from './inbox';

const h = (level: number, title: string, todo: string | null = null) => ({ level, title, todo });
const titles = (heads: ReturnType<typeof h>[]) => inboxEntries(heads, ['DONE']).map((x) => x.title);

describe('inbox entries', () => {
	it('are the top-level headings, done ones left out', () => {
		expect(titles([h(1, 'Call Sam', 'TODO'), h(1, 'Idea'), h(1, 'Old', 'DONE')])).toEqual([
			'Call Sam',
			'Idea',
		]);
	});

	it('are the sub-headings of a heading captures are filed under', () => {
		expect(
			titles([h(1, 'Inbox'), h(2, 'Call Sam', 'TODO'), h(2, 'Paid', 'DONE'), h(2, 'Idea')]),
		).toEqual(['Call Sam', 'Idea']);
		// Even once that heading was marked done by mistake.
		expect(titles([h(1, 'Inbox', 'DONE'), h(2, 'Call Sam', 'TODO')])).toEqual(['Call Sam']);
	});

	it('keep a task with steps as one item', () => {
		expect(
			titles([h(1, 'Plan the trip', 'TODO'), h(2, 'Book trains', 'TODO'), h(1, 'Idea')]),
		).toEqual(['Plan the trip', 'Idea']);
	});

	it('mix groups and loose items', () => {
		expect(
			titles([h(1, 'Loose', 'TODO'), h(1, 'Tasks'), h(2, 'A', 'TODO'), h(3, 'A note'), h(2, 'B')]),
		).toEqual(['Loose', 'A', 'B']);
	});
});
