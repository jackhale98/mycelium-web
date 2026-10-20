import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import {
	continueList,
	indentItem,
	nextBullet,
	outdentItem,
	toggleItemCheckbox,
} from './list-commands';

/** Run a command on `text`, with `|` marking the cursor; returns the new text with `|`. */
function exec(cmd: StateCommand, text: string): string | false {
	const at = text.indexOf('|');
	let state = EditorState.create({
		doc: text.replace('|', ''),
		selection: EditorSelection.cursor(at),
	});
	const ok = cmd({ state, dispatch: (tr) => (state = tr.state) });
	if (!ok) return false;
	const doc = state.doc.toString();
	const head = state.selection.main.head;
	return doc.slice(0, head) + '|' + doc.slice(head);
}

describe('list editing', () => {
	it('continues bullets, numbers and checklists on Enter', () => {
		expect(exec(continueList, '- milk|')).toBe('- milk\n- |');
		expect(exec(continueList, '  + eggs|')).toBe('  + eggs\n  + |');
		expect(exec(continueList, '3. three|')).toBe('3. three\n4. |');
		expect(exec(continueList, '- [X] done|')).toBe('- [X] done\n- [ ] |');
		expect(exec(continueList, '- spl|it')).toBe('- spl\n- |it');
	});

	it('ends the list on an empty item, and ignores other lines', () => {
		expect(exec(continueList, '- one\n- |')).toBe('- one\n|');
		expect(exec(continueList, '  - [ ] |')).toBe('  |');
		expect(exec(continueList, 'plain text|')).toBe(false);
		expect(exec(continueList, '* Heading|')).toBe(false);
	});

	it('indents and outdents an item with its children', () => {
		expect(exec(indentItem, '- a\n- b|\n  - c\n- d')).toBe('- a\n  - b|\n    - c\n- d');
		expect(exec(outdentItem, '- a\n  - b|\n    - c')).toBe('- a\n- b|\n  - c');
		expect(exec(indentItem, '1. a\n2. b|')).toBe('1. a\n   2. b|');
	});

	it('demotes and promotes headings', () => {
		expect(exec(indentItem, '* Head|')).toBe('** Head|');
		expect(exec(outdentItem, '** Head|')).toBe('* Head|');
		expect(exec(outdentItem, '* Head|')).not.toBe(false);
		expect(exec(indentItem, 'text|')).toBe(false);
	});

	it('toggles checkboxes and updates cookies', () => {
		expect(exec(toggleItemCheckbox, '* Tasks [0/1]\n- [ ] one|')).toBe('* Tasks [1/1]\n- [X] one|');
	});

	it('steps bullets', () => {
		expect([nextBullet('-'), nextBullet('9)'), nextBullet('a.')]).toEqual(['-', '10)', 'b.']);
	});
});
