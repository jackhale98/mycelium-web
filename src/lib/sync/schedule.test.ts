import { describe, expect, it } from 'vitest';
import { MAX_WAIT, nextCheckDelay, SAVE_DATA_MAX_WAIT, SAVE_DATA_WAIT } from './schedule';

const MINUTE = 60_000;

describe('nextCheckDelay', () => {
	it('starts at the service pace and doubles while quiet, up to five minutes', () => {
		const at = (quiet: number) => nextCheckDelay({ base: MINUTE, quiet, saveData: false });
		expect([0, 1, 2, 3, 4, 20].map(at)).toEqual([
			MINUTE,
			2 * MINUTE,
			4 * MINUTE,
			MAX_WAIT,
			MAX_WAIT,
			MAX_WAIT,
		]);
	});

	it('keeps a slow service at its own pace', () => {
		expect(nextCheckDelay({ base: 5 * MINUTE, quiet: 0, saveData: false })).toBe(5 * MINUTE);
		expect(nextCheckDelay({ base: 5 * MINUTE, quiet: 3, saveData: false })).toBe(5 * MINUTE);
	});

	it('checks far less often with Data Saver on', () => {
		expect(nextCheckDelay({ base: MINUTE, quiet: 0, saveData: true })).toBe(SAVE_DATA_WAIT);
		expect(nextCheckDelay({ base: MINUTE, quiet: 5, saveData: true })).toBe(SAVE_DATA_MAX_WAIT);
	});
});
