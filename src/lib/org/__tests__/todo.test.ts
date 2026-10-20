import { describe, expect, it } from 'vitest';
import { changeTodoState, nextOccurrence } from '../todo';
import { parseTimestamp } from '../timestamp';

const config = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };
const now = { date: '2024-03-10', time: '14:05' };

describe('repeaters', () => {
	it("implements org's three flavours", () => {
		const t = (raw: string) => nextOccurrence(parseTimestamp(raw)!, now).raw;
		expect(t('<2024-03-01 Fri +1w>')).toBe('<2024-03-08 Fri +1w>');
		expect(t('<2024-03-01 Fri ++1w>')).toBe('<2024-03-15 Fri ++1w>');
		expect(t('<2024-03-01 Fri .+1w>')).toBe('<2024-03-17 Sun .+1w>');
		expect(t('<2024-01-31 Wed +1m>')).toBe('<2024-02-29 Thu +1m>');
	});
});

describe('changeTodoState', () => {
	it('stamps CLOSED when completing', () => {
		const src = '* TODO Task\nBody\n';
		expect(changeTodoState(src, 0, 'DONE', { config, now }).text).toBe(
			'* DONE Task\nCLOSED: [2024-03-10 Sun 14:05]\nBody\n',
		);
	});

	it('can skip the CLOSED stamp', () => {
		expect(changeTodoState('* TODO Task\n', 0, 'DONE', { config, now, logDone: false }).text).toBe(
			'* DONE Task\n',
		);
	});

	it('removes CLOSED when reopening', () => {
		const src = '* DONE Task\nCLOSED: [2024-03-09 Sat 10:00] DEADLINE: <2024-03-12 Tue>\n';
		expect(changeTodoState(src, 0, 'TODO', { config, now }).text).toBe(
			'* TODO Task\nDEADLINE: <2024-03-12 Tue>\n',
		);
	});

	it('reschedules repeating tasks instead of closing them', () => {
		const src = '* NEXT Water plants\nSCHEDULED: <2024-03-08 Fri .+3d>\n';
		const result = changeTodoState(src, 0, 'DONE', { config, now });
		expect(result.repeated).toBe(true);
		expect(result.text).toBe('* NEXT Water plants\nSCHEDULED: <2024-03-13 Wed .+3d>\n');
	});
});
