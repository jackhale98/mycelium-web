import { describe, expect, it } from 'vitest';
import { sharedText } from './share';

describe('sharedText', () => {
	it('makes an org link of a shared page', () => {
		expect(sharedText({ title: 'Org mode', url: 'https://orgmode.org/' })).toBe(
			'[[https://orgmode.org/][Org mode]]',
		);
	});
	it('finds the link inside the text, as Android apps send it', () => {
		expect(sharedText({ title: 'A read', text: 'Worth a look https://example.com/a?b=1' })).toBe(
			'[[https://example.com/a?b=1][A read]]\nWorth a look',
		);
	});
	it('keeps plain text, and brackets out of link descriptions', () => {
		expect(sharedText({ text: 'Buy oat milk' })).toBe('Buy oat milk');
		expect(sharedText({ title: '[Draft] notes', url: 'https://x.test' })).toBe(
			'[[https://x.test][(Draft) notes]]',
		);
		expect(sharedText({ title: 'Same', text: 'Same' })).toBe('Same');
	});
});
