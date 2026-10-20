import { describe, expect, it } from 'vitest';
import { getProperties, getProperty, joinPropertyValues, setProperty, splitPropertyValues } from '../properties';
import { apply } from './helpers';

describe('property drawers', () => {
	it('reads file and headline drawers', () => {
		const src = ':PROPERTIES:\n:ID: file-id\n:END:\n#+title: T\n* H\nSCHEDULED: <2024-01-01 Mon>\n:PROPERTIES:\n:ID:       h-id\n:ROAM_ALIASES: "A b" c\n:END:\n';
		expect(getProperty(src, null, 'id')).toBe('file-id');
		expect(getProperties(src, src.indexOf('* H'))).toEqual({ ID: 'h-id', ROAM_ALIASES: '"A b" c' });
	});

	it('does not mistake a later drawer for the headline drawer', () => {
		const src = '* H\nBody\n:PROPERTIES:\n:ID: nope\n:END:\n';
		expect(getProperty(src, 0, 'ID')).toBeNull();
	});

	it('replaces a value in place', () => {
		const src = '* H\n:PROPERTIES:\n:ID:       abc\n:END:\n';
		expect(apply(src, setProperty(src, 0, 'ID', 'xyz'))).toBe('* H\n:PROPERTIES:\n:ID:       xyz\n:END:\n');
	});

	it('appends a property aligned to the drawer', () => {
		const src = '* H\n:PROPERTIES:\n:ID:       abc\n:END:\n';
		expect(apply(src, setProperty(src, 0, 'CATEGORY', 'work'))).toBe(
			'* H\n:PROPERTIES:\n:ID:       abc\n:CATEGORY: work\n:END:\n',
		);
	});

	it('creates a headline drawer after the planning line', () => {
		const src = '* H\nSCHEDULED: <2024-01-01 Mon>\nBody\n';
		expect(apply(src, setProperty(src, 0, 'ID', 'abc'))).toBe(
			'* H\nSCHEDULED: <2024-01-01 Mon>\n:PROPERTIES:\n:ID:       abc\n:END:\nBody\n',
		);
	});

	it('creates a file drawer at the top', () => {
		const src = '#+title: T\n\nText\n';
		expect(apply(src, setProperty(src, null, 'ID', 'abc'))).toBe(':PROPERTIES:\n:ID:       abc\n:END:\n#+title: T\n\nText\n');
	});

	it('removes a property line', () => {
		const src = '* H\n:PROPERTIES:\n:ID: a\n:X: b\n:END:\n';
		expect(apply(src, setProperty(src, 0, 'X', null))).toBe('* H\n:PROPERTIES:\n:ID: a\n:END:\n');
	});

	it('splits and joins quoted values', () => {
		expect(splitPropertyValues('"Rust lang" rustlang "say \\"hi\\""')).toEqual(['Rust lang', 'rustlang', 'say "hi"']);
		expect(joinPropertyValues(['Rust lang', 'x'])).toBe('"Rust lang" x');
	});
});
