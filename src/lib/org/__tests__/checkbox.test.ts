import { describe, expect, it } from 'vitest';
import { toggleCheckbox } from '../checkbox';
import { at } from './helpers';

describe('checkboxes', () => {
	it('toggles one mark', () => {
		const src = '- [ ] one\n- [X] two\n';
		expect(toggleCheckbox(src, 0).text).toBe('- [X] one\n- [X] two\n');
		expect(toggleCheckbox(src, at(src, 'two')).text).toBe('- [ ] one\n- [ ] two\n');
	});

	it('updates cookies on the owning headline', () => {
		const src = '* Tasks [1/3] [33%]\n- [X] a\n- [ ] b\n- [ ] c\n';
		expect(toggleCheckbox(src, at(src, '- [ ] b')).text).toBe(
			'* Tasks [2/3] [66%]\n- [X] a\n- [X] b\n- [ ] c\n',
		);
	});

	it('fixes parent boxes and nested cookies', () => {
		const src = '- [ ] parent [0/2]\n  - [ ] x\n  - [ ] y\n';
		const one = toggleCheckbox(src, at(src, '- [ ] x')).text;
		expect(one).toBe('- [-] parent [1/2]\n  - [X] x\n  - [ ] y\n');
		const two = toggleCheckbox(one, at(one, '- [ ] y')).text;
		expect(two).toBe('- [X] parent [2/2]\n  - [X] x\n  - [X] y\n');
	});

	it('leaves unrelated cookies alone', () => {
		const src = '* Other [0/0]\n* Tasks [0/1]\n- [ ] a\n';
		expect(toggleCheckbox(src, at(src, '- [ ]')).text).toBe(
			'* Other [0/0]\n* Tasks [1/1]\n- [X] a\n',
		);
	});

	it('ignores lines without a box', () => {
		expect(toggleCheckbox('- plain\n', 0).steps).toEqual([]);
	});
});
