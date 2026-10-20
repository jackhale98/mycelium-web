import { describe, expect, it } from 'vitest';
import {
	fileTodoKeywords,
	getFileKeyword,
	getFiletags,
	setFileKeyword,
	setFiletags,
} from '../keywords';
import { apply } from './helpers';

describe('file keywords', () => {
	it('reads keywords outside blocks only', () => {
		const src = '#+begin_example\n#+title: Fake\n#+end_example\n#+TITLE: Real\n';
		expect(getFileKeyword(src, 'title')).toBe('Real');
	});

	it('updates in place', () => {
		const src = ':PROPERTIES:\n:ID: x\n:END:\n#+title:   Old\n';
		expect(apply(src, setFileKeyword(src, 'TITLE', 'New'))).toBe(
			':PROPERTIES:\n:ID: x\n:END:\n#+title:   New\n',
		);
	});

	it('inserts into the metadata block using the file casing', () => {
		const src = ':PROPERTIES:\n:ID: x\n:END:\n#+title: T\n\n* H\n';
		expect(apply(src, setFileKeyword(src, 'FILETAGS', ':a:'))).toBe(
			':PROPERTIES:\n:ID: x\n:END:\n#+title: T\n#+filetags: :a:\n\n* H\n',
		);
	});

	it('reads and writes file tags', () => {
		expect(getFiletags('#+FILETAGS: :a:b:\n')).toEqual(['a', 'b']);
		expect(getFiletags('#+filetags: a b\n')).toEqual(['a', 'b']);
		const src = '#+TITLE: T\n#+FILETAGS: :a:\n';
		expect(apply(src, setFiletags(src, ['a', 'b']))).toBe('#+TITLE: T\n#+FILETAGS: :a:b:\n');
		expect(apply(src, setFiletags(src, []))).toBe('#+TITLE: T\n');
	});

	it('parses per-file TODO sequences', () => {
		expect(fileTodoKeywords('#+TODO: TODO(t) NEXT(n) | DONE(d!) CANCELLED(c@)\n')).toEqual({
			todoKeywords: ['TODO', 'NEXT'],
			doneKeywords: ['DONE', 'CANCELLED'],
			log: { DONE: { enter: true, leave: false }, CANCELLED: { enter: true, leave: false } },
		});
		expect(fileTodoKeywords('#+SEQ_TODO: OPEN CLOSED\n')).toEqual({
			todoKeywords: ['OPEN'],
			doneKeywords: ['CLOSED'],
		});
		expect(fileTodoKeywords('#+title: none\n')).toBeNull();
	});
});
