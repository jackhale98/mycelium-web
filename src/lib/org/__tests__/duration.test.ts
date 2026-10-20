import { describe, expect, it } from 'vitest';
import { durationToMinutes } from '../duration';

describe('durationToMinutes', () => {
	it.each([
		['1:30', 90],
		['0:10', 10],
		['0:45:30', 45.5],
		['90', 90],
		['2h', 120],
		['1d 3h 20min', 1640],
		['1d 3:20', 1640],
		['', null],
		['soon', null],
	])('%s → %s', (input, minutes) => expect(durationToMinutes(input)).toBe(minutes));
});
