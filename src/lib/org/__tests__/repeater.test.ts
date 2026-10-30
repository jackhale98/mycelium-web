import { describe, expect, it } from 'vitest';
import { readRepeater, writeRepeater } from '..';

describe('repeater cookies in parts', () => {
	it('reads and writes each kind, a habit interval kept', () => {
		for (const r of ['+1w', '++2d', '.+1m', '.+1d/3d', '+12h', '+1y'])
			expect(writeRepeater(readRepeater(r)!)).toBe(r);
		expect(readRepeater('.+1d/3d')).toEqual({ mark: '.+', n: 1, unit: 'd', habit: '/3d' });
	});
	it("isn't fooled by what org wouldn't read", () => {
		for (const r of [null, '', '1w', '+w', '+1q', '-1d']) expect(readRepeater(r)).toBeNull();
	});
	it('writes a count of at least one', () => {
		expect(writeRepeater({ mark: '+', n: 0, unit: 'w', habit: '' })).toBe('+1w');
	});
});
