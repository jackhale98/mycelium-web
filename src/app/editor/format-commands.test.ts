import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
	cycleHeading,
	insertLink,
	setHeadingLevel,
	toggleList,
	toggleMark,
} from './format-commands';

/** Run a command on `text`; `|` marks the cursor, `[`…`]` a selection (written back the same way). */
function exec(cmd: StateCommand, text: string): string | false {
	const sel = /\{(.*?)\}/s.exec(text);
	const doc = text.replace(/[{}|]/g, '');
	const selection = sel
		? EditorSelection.range(sel.index, sel.index + sel[1]!.length)
		: EditorSelection.cursor(text.indexOf('|'));
	let state = EditorState.create({ doc, selection });
	if (!cmd({ state, dispatch: (tr) => (state = tr.state) })) return false;
	const out = state.doc.toString();
	const { from, to, empty } = state.selection.main;
	return empty
		? out.slice(0, from) + '|' + out.slice(from)
		: out.slice(0, from) + '{' + out.slice(from, to) + '}' + out.slice(to);
}

describe('emphasis', () => {
	it('wraps the selection, leaving surrounding spaces outside', () => {
		expect(exec(toggleMark('*'), 'a {big } deal')).toBe('a *{big}*  deal');
		expect(exec(toggleMark('/'), '{word}')).toBe('/{word}/');
		expect(exec(toggleMark('+'), 'x {gone} y')).toBe('x +{gone}+ y');
	});
	it('starts after a bullet or heading stars in the selection', () => {
		expect(exec(toggleMark('*'), '{- [ ] buy milk}')).toBe('- [ ] *{buy milk}*');
		expect(exec(toggleMark('/'), '{** Plan}')).toBe('** /{Plan}/');
	});
	it('unwraps when the selection is already wrapped', () => {
		expect(exec(toggleMark('*'), 'a *{big}* deal')).toBe('a {big} deal');
		expect(exec(toggleMark('~'), 'a {~code~} b')).toBe('a {code} b');
	});
	it('inserts a pair at the cursor, and steps out of an empty one', () => {
		expect(exec(toggleMark('_'), 'see |')).toBe('see _|_');
		expect(exec(toggleMark('_'), 'see _|_')).toBe('see |');
		expect(exec(toggleMark('*'), 'a *loud|*')).toBe('a *loud*|');
	});
});

describe('headings', () => {
	it('cycles text → * → ** → *** → **** → text', () => {
		expect(exec(cycleHeading, 'Plan|')).toBe('* Plan|');
		expect(exec(cycleHeading, '* Plan|')).toBe('** Plan|');
		expect(exec(cycleHeading, '*** Plan|')).toBe('**** Plan|');
		expect(exec(cycleHeading, '**** Plan|')).toBe('Plan|');
	});
	it('sets a level directly, dropping a list bullet', () => {
		expect(exec(setHeadingLevel(2), '- [ ] Call Sam|')).toBe('** Call Sam|');
		expect(exec(setHeadingLevel(1), '  indented|')).toBe('* indented|');
		expect(exec(setHeadingLevel(2), '** Same|')).toBe(false);
	});
	it("doesn't take bold text for a heading", () => {
		expect(exec(cycleHeading, '*bold*|')).toBe('* *bold*|');
	});
});

describe('lists', () => {
	it('makes and removes bullets', () => {
		expect(exec(toggleList('bullet'), 'milk|')).toBe('- milk|');
		expect(exec(toggleList('bullet'), '- milk|')).toBe('milk|');
		expect(exec(toggleList('bullet'), '|')).toBe('- |');
		expect(exec(toggleList('bullet'), '* Heading|')).toBe('- Heading|');
	});
	it('numbers several lines in order, skipping blank ones', () => {
		expect(exec(toggleList('number'), '{one\ntwo\n\nthree}')).toBe('{1. one\n2. two\n\n3. three}');
		expect(exec(toggleList('number'), '- one|')).toBe('1. one|');
	});
	it('adds a checkbox, then ticks and unticks it', () => {
		expect(exec(toggleList('checkbox'), 'buy milk|')).toBe('- [ ] buy milk|');
		expect(exec(toggleList('checkbox'), '- buy milk|')).toBe('- [ ] buy milk|');
		expect(exec(toggleList('checkbox'), '- [ ] buy milk|')).toBe('- [X] buy milk|');
		expect(exec(toggleList('checkbox'), '- [X] buy milk|')).toBe('- [ ] buy milk|');
	});
	it('keeps indentation', () => {
		expect(exec(toggleList('checkbox'), '  - sub|')).toBe('  - [ ] sub|');
	});
});

describe('links', () => {
	it('opens a link at the cursor or around the selection', () => {
		expect(exec(insertLink, 'see |')).toBe('see [[|]]');
		expect(exec(insertLink, 'see {notes}')).toBe('see [[notes]]|');
	});
});
