import { describe, expect, it } from 'vitest';
import { applyChanges, extractSubtree, renameLinkDescriptions, setFileTitle } from '..';

describe('setFileTitle', () => {
	it('replaces the title, and only the title', () => {
		const src = ':PROPERTIES:\n:ID: a\n:END:\n#+TITLE:  Old one\nBody\n';
		expect(applyChanges(src, setFileTitle(src, 'New one'))).toBe(
			':PROPERTIES:\n:ID: a\n:END:\n#+TITLE:  New one\nBody\n',
		);
	});
	it('adds one after the property drawer when there is none', () => {
		const src = ':PROPERTIES:\n:ID: a\n:END:\nBody\n';
		expect(applyChanges(src, setFileTitle(src, 'Fresh'))).toBe(
			':PROPERTIES:\n:ID: a\n:END:\n#+title: Fresh\nBody\n',
		);
	});
});

describe('renameLinkDescriptions', () => {
	it('updates links that said the old title, not other wording or other notes', () => {
		const src = 'See [[id:n1][Old]] and [[id:n1][that idea]], [[id:n2][Old]], [[id:n1][Old]].\n';
		expect(applyChanges(src, renameLinkDescriptions(src, 'n1', 'Old', 'New'))).toBe(
			'See [[id:n1][New]] and [[id:n1][that idea]], [[id:n2][Old]], [[id:n1][New]].\n',
		);
	});
});

describe('extractSubtree', () => {
	const src = [
		'#+title: Projects',
		'* Garden',
		'** TODO [#A] Compost bins :outdoor:diy:',
		'SCHEDULED: <2026-11-01 Sun>',
		':PROPERTIES:',
		':CUSTOM_ID: compost',
		':END:',
		'Three bays.',
		'*** Materials',
		'Pallets.',
		'',
		'** Seeds',
		'',
	].join('\n');

	it('makes the heading a note, and links to it where it was', () => {
		const at = src.indexOf('** TODO');
		const r = extractSubtree(src, at, 'new-id')!;
		expect(r.title).toBe('Compost bins');
		expect(r.text).toBe(
			[
				':PROPERTIES:',
				':ID:       new-id',
				':CUSTOM_ID: compost',
				':END:',
				'#+title: Compost bins',
				'#+filetags: :outdoor:diy:',
				'SCHEDULED: <2026-11-01 Sun>',
				'Three bays.',
				'* Materials',
				'Pallets.',
				'',
			].join('\n'),
		);
		expect(applyChanges(src, r.changes)).toBe(
			['#+title: Projects', '* Garden', '** [[id:new-id][Compost bins]]', '', '** Seeds', ''].join(
				'\n',
			),
		);
	});

	it('keeps an existing ID, and can leave nothing behind', () => {
		const withId = '* A\n:PROPERTIES:\n:ID: keep-me\n:END:\nText\n* B\n';
		const r = extractSubtree(withId, 0, 'unused', { leaveLink: false })!;
		expect(r.id).toBe('keep-me');
		expect(r.text).toBe(':PROPERTIES:\n:ID: keep-me\n:END:\n#+title: A\nText\n');
		expect(applyChanges(withId, r.changes)).toBe('* B\n');
	});
});
