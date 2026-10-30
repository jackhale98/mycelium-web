import { describe, expect, it } from 'vitest';
import {
	applyTemplate,
	DEFAULT_CAPTURE_TEMPLATES,
	expandTemplate,
	insertCapture,
	shapeCapture,
	strftime,
	templatePrompts,
	type CaptureTemplate,
} from '../capture-template';
import { applyChanges } from '../text';

const now = { date: '2026-10-20', time: '09:12' };
const tpl = (id: string) => DEFAULT_CAPTURE_TEMPLATES.find((t) => t.id === id)!;
const run = (source: string, t: CaptureTemplate, text: string, values = {}) =>
	applyChanges(
		source,
		applyTemplate(
			source,
			t,
			{ now, text, values },
			'heading' in t.target ? t.target.heading : null,
		),
	);

describe('expandTemplate', () => {
	it('fills timestamps, strftime and the cursor', () => {
		expect(expandTemplate('%U %?', { now, text: 'hi' })).toBe('[2026-10-20 Tue 09:12] hi');
		expect(expandTemplate('%u|%T|%t', { now, text: '' })).toBe(
			'[2026-10-20 Tue]|<2026-10-20 Tue 09:12>|<2026-10-20 Tue>',
		);
		expect(expandTemplate('%<%Y-%m-%d %a %H:%M %B>', { now, text: '' })).toBe(
			'2026-10-20 Tue 09:12 October',
		);
		expect(expandTemplate('100%% done', { now, text: '' })).toBe('100% done');
	});

	it('appends the text when there is no %?', () => {
		expect(expandTemplate('* TODO', { now, text: 'Call Sam' })).toBe('* TODO Call Sam');
	});

	it('answers prompts, choices, back-references, dates and tags', () => {
		const t =
			'* %^{Who|Sam|Alex} %^{Topic}\n%\\1 about %\\2 %^g\nDEADLINE: %^t SCHEDULED: %^{When}T';
		expect(templatePrompts(t).map((p) => [p.id, p.label, p.kind, p.default])).toEqual([
			['p0', 'Who', 'text', 'Sam'],
			['p1', 'Topic', 'text', ''],
			['p2', 'Tags', 'tags', ''],
			['p3', 'Date', 'date', ''],
			['p4', 'When', 'datetime', ''],
		]);
		expect(
			expandTemplate(t, {
				now,
				text: '',
				values: { p1: 'budget', p2: 'work, money', p3: '2026-10-23', p4: '2026-10-21T14:30' },
			}),
		).toBe(
			'* Sam budget\nSam about budget :work:money:\nDEADLINE: <2026-10-23 Fri> SCHEDULED: <2026-10-21 Wed 14:30>',
		);
	});

	it('drops blank prompts cleanly and inserts links', () => {
		expect(expandTemplate('* %^{Title}\n%?\n', { now, text: '' })).toBe('*');
		expect(expandTemplate('%? %a', { now, text: 'see', link: '[[id:1][X]]' })).toBe(
			'see [[id:1][X]]',
		);
	});

	it('formats strftime with padded day', () => {
		expect(strftime('%e/%y', { date: '2026-01-05', time: '00:00' })).toBe(' 5/26');
	});
});

describe('shapeCapture', () => {
	it('turns text into the template type', () => {
		expect(shapeCapture('Call Sam', 'entry')).toBe('* Call Sam');
		expect(shapeCapture('a\nb', 'item')).toBe('- a\n  b');
		expect(shapeCapture('milk', 'checkitem')).toBe('- [ ] milk');
		expect(shapeCapture('- already', 'item')).toBe('- already');
	});
});

describe('insertCapture', () => {
	it('adds items after the heading text, before child headings', () => {
		const source = '* Inbox\n- a\n** Child\n* Next\n';
		expect(
			applyChanges(source, insertCapture(source, '- b', { type: 'item', heading: 'Inbox' })),
		).toBe('* Inbox\n- a\n- b\n** Child\n* Next\n');
	});

	it('adds entries as the last child, demoted to fit', () => {
		const source = '* Projects\n** One\nbody\n\n* Other\n';
		const insert = insertCapture(source, '* Two\n** Sub', { type: 'entry', heading: 'Projects' });
		expect(applyChanges(source, insert)).toBe(
			'* Projects\n** One\nbody\n** Two\n*** Sub\n\n* Other\n',
		);
		const first = insertCapture(source, '* Zero', {
			type: 'entry',
			heading: 'Projects',
			prepend: true,
		});
		expect(applyChanges(source, first)).toBe('* Projects\n** Zero\n** One\nbody\n\n* Other\n');
	});

	it('creates a missing heading and handles file level', () => {
		expect(
			applyChanges(
				'#+title: x\n',
				insertCapture('#+title: x\n', '* TODO a', { type: 'entry', heading: 'Tasks' }),
			),
		).toBe('#+title: x\n* Tasks\n** TODO a\n');
		expect(
			applyChanges(
				'#+title: x\n* H\n',
				insertCapture('#+title: x\n* H\n', '* New', { type: 'entry', heading: null }),
			),
		).toBe('#+title: x\n* H\n* New\n');
		expect(
			applyChanges(
				'#+title: x\n\n* H\n',
				insertCapture('#+title: x\n\n* H\n', 'note', { type: 'plain', heading: null }),
			),
		).toBe('#+title: x\nnote\n\n* H\n');
	});

	it('matches headings with TODO keywords and tags, keeps CRLF', () => {
		const source = '* TODO Inbox :gtd:\r\n- a\r\n';
		expect(
			applyChanges(source, insertCapture(source, '- b', { type: 'item', heading: 'Inbox' })),
		).toBe('* TODO Inbox :gtd:\r\n- a\r\n- b\r\n');
	});
});

describe('default templates', () => {
	it('Note keeps the timestamped Captured list', () => {
		expect(run('#+title: 2026-10-20\n', tpl('note'), 'Call the arborist')).toBe(
			'#+title: 2026-10-20\n* Captured\n- [2026-10-20 Tue 09:12] Call the arborist\n',
		);
		const source = '* Captured\n- [2026-10-20 Tue 08:00] first\n\n* Later\nbody\n';
		expect(run(source, tpl('note'), 'idea\nmore detail')).toBe(
			'* Captured\n- [2026-10-20 Tue 08:00] first\n- [2026-10-20 Tue 09:12] idea\n  more detail\n\n* Later\nbody\n',
		);
	});

	it('Task and Journal write entries', () => {
		// Tasks go to the inbox at the top level: each one an item to decide.
		expect(tpl('task').target).toEqual({ kind: 'file', path: 'inbox.org', heading: null });
		expect(run('#+title: Inbox\n', tpl('task'), 'Prune the apple tree')).toBe(
			'#+title: Inbox\n* TODO Prune the apple tree\n',
		);
		expect(run('#+title: d\n', tpl('journal'), 'Long walk.', { p0: 'Morning' })).toBe(
			'#+title: d\n* 09:12 Morning\nLong walk.\n',
		);
	});
});
