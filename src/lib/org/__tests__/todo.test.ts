/// Expected outputs follow org.el's `org-todo` / `org-auto-repeat-maybe` with
/// default options unless a test says otherwise.

import { describe, expect, it } from 'vitest';
import { fileTodoKeywords } from '../keywords';
import { detectLogSettings, stateNote } from '../log';
import { parseTimestamp } from '../timestamp';
import { changeTodoState, nextOccurrence } from '../todo';

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

describe('stateNote', () => {
	it('matches org-log-note-headings padding', () => {
		expect(stateNote('DONE', 'TODO', '[2024-03-10 Sun 14:05]')).toBe(
			'State "DONE"       from "TODO"       [2024-03-10 Sun 14:05]',
		);
		expect(stateNote('TODO', null, '[x]')).toBe('State "TODO"       from              [x]');
	});
});

describe('changeTodoState', () => {
	it('does not stamp CLOSED by default (org-log-done is nil)', () => {
		expect(changeTodoState('* TODO Task\n', 0, 'DONE', { config, now }).text).toBe('* DONE Task\n');
	});

	it('stamps CLOSED with org-log-done', () => {
		const src = '* TODO Task\nBody\n';
		expect(changeTodoState(src, 0, 'DONE', { config, now, log: { logDone: true } }).text).toBe(
			'* DONE Task\nCLOSED: [2024-03-10 Sun 14:05]\nBody\n',
		);
	});

	it('honours #+STARTUP: logdone', () => {
		const src = '#+STARTUP: logdone\n* TODO Task\n';
		expect(changeTodoState(src, src.indexOf('*'), 'DONE', { config, now }).text).toBe(
			'#+STARTUP: logdone\n* DONE Task\nCLOSED: [2024-03-10 Sun 14:05]\n',
		);
	});

	it('removes CLOSED when reopening', () => {
		const src = '* DONE Task\nCLOSED: [2024-03-09 Sat 10:00] DEADLINE: <2024-03-12 Tue>\n';
		expect(changeTodoState(src, 0, 'TODO', { config, now }).text).toBe(
			'* TODO Task\nDEADLINE: <2024-03-12 Tue>\n',
		);
	});

	it('reschedules repeating tasks the way Emacs does by default', () => {
		const src = '* NEXT Water plants\nSCHEDULED: <2024-03-08 Fri .+3d>\n';
		const result = changeTodoState(src, 0, 'DONE', { config, now });
		expect(result.repeated).toBe(true);
		expect(result.text).toBe(
			[
				'* TODO Water plants',
				'SCHEDULED: <2024-03-13 Wed .+3d>',
				':PROPERTIES:',
				':LAST_REPEAT: [2024-03-10 Sun 14:05]',
				':END:',
				'- State "DONE"       from "NEXT"       [2024-03-10 Sun 14:05]',
				'',
			].join('\n'),
		);
	});

	it('logs repeats newest first into an existing LOGBOOK', () => {
		const src = [
			'* TODO Review',
			'DEADLINE: <2024-03-04 Mon +1w>',
			':PROPERTIES:',
			':LAST_REPEAT: [2024-03-03 Sun 09:00]',
			':END:',
			':LOGBOOK:',
			'- State "DONE"       from "TODO"       [2024-03-03 Sun 09:00]',
			':END:',
			'Notes',
			'',
		].join('\n');
		const out = changeTodoState(src, 0, 'DONE', {
			config,
			now,
			log: { logIntoDrawer: 'LOGBOOK' },
		}).text;
		expect(out).toBe(
			[
				'* TODO Review',
				'DEADLINE: <2024-03-11 Mon +1w>',
				':PROPERTIES:',
				':LAST_REPEAT: [2024-03-10 Sun 14:05]',
				':END:',
				':LOGBOOK:',
				'- State "DONE"       from "TODO"       [2024-03-10 Sun 14:05]',
				'- State "DONE"       from "TODO"       [2024-03-03 Sun 09:00]',
				':END:',
				'Notes',
				'',
			].join('\n'),
		);
	});

	it('honours REPEAT_TO_STATE, body repeaters and drops non-repeating SCHEDULED', () => {
		const src = [
			'* WAIT Standup',
			'SCHEDULED: <2024-03-10 Sun> DEADLINE: <2024-03-10 Sun ++1d>',
			':PROPERTIES:',
			':REPEAT_TO_STATE: NEXT',
			':END:',
			'Also at <2024-03-10 Sun 09:00 +1w> each week.',
			'* Next heading <2024-03-10 Sun +1d>',
			'',
		].join('\n');
		const cfg = { todoKeywords: ['TODO', 'NEXT', 'WAIT'], doneKeywords: ['DONE'] };
		const out = changeTodoState(src, 0, 'DONE', {
			config: cfg,
			now,
			log: { logRepeat: false },
		}).text;
		expect(out).toBe(
			[
				'* NEXT Standup',
				'DEADLINE: <2024-03-11 Mon ++1d>',
				':PROPERTIES:',
				':REPEAT_TO_STATE: NEXT',
				':END:',
				'Also at <2024-03-17 Sun 09:00 +1w> each week.',
				'* Next heading <2024-03-10 Sun +1d>',
				'',
			].join('\n'),
		);
	});

	it('logs state changes marked with ! in #+TODO', () => {
		const src = '#+TODO: TODO WAIT(w!) | DONE(d!)\n* TODO Ask\n';
		const cfg = fileTodoKeywords(src)!;
		expect(cfg.log).toEqual({
			WAIT: { enter: true, leave: false },
			DONE: { enter: true, leave: false },
		});
		const out = changeTodoState(src, src.indexOf('*'), 'WAIT', { config: cfg, now }).text;
		expect(out).toBe(
			'#+TODO: TODO WAIT(w!) | DONE(d!)\n* WAIT Ask\n- State "WAIT"       from "TODO"       [2024-03-10 Sun 14:05]\n',
		);
	});
});

describe('detectLogSettings', () => {
	it("infers the user's Emacs logging from their files", () => {
		expect(detectLogSettings(['* DONE x\nCLOSED: [2024-01-01 Mon 10:00]\n'])).toMatchObject({
			logDone: true,
			logIntoDrawer: null,
		});
		expect(
			detectLogSettings([
				'* TODO x\n:LOGBOOK:\n- State "DONE"       from "TODO"       [2024-01-01 Mon]\n:END:\n',
			]),
		).toMatchObject({
			logDone: false,
			logIntoDrawer: 'LOGBOOK',
		});
		expect(detectLogSettings(['* TODO x\nSCHEDULED: <2024-01-01 Mon +1w>\n'])).toMatchObject({
			logRepeat: false,
		});
		expect(detectLogSettings(['nothing'])).toMatchObject({ logDone: false, logRepeat: true });
	});
});
