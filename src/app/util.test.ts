import { describe, expect, it } from 'vitest';
import { slugify } from './util';

describe('slugify (org-roam-node-slugify)', () => {
	it.each([
		['Hello, World!', 'hello_world'],
		['  Leading and trailing  ', 'leading_and_trailing'],
		['Café crème', 'cafe_creme'],
		['Œuvre — naïve résumé', 'œuvre_naive_resume'],
		// U+0328 (ogonek) is not in org-roam's list, so ą survives.
		['Gdańsk w Polsce: ąę', 'gdansk_w_polsce_ąę'],
		['数学 ノート', '数学_ノート'],
		['C++ / Rust (2026)', 'c_rust_2026'],
	])('%s → %s', (title, slug) => {
		expect(slugify(title)).toBe(slug);
	});
});
