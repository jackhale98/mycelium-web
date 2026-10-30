// What Mycelium writes for tasks, read back by Emacs' own org-mode: quick
// adds (times, ranges, deadlines, repeats, tags, priority, Effort) and the
// day planner's and Schedule sheet's edits (time ranges on a habit with
// properties and a LOGBOOK, taking a time off, moving a day). Each heading
// must come back with the same planning, Effort and state, its planning line
// right under the heading, and a habit still a valid org-habit. Runs where
// Emacs is installed (CI installs it); skipped otherwise.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	addSession,
	applyChanges,
	applyQuickAdd,
	durationToMinutes,
	durationUnits,
	makeTimestamp,
	DEFAULT_CAPTURE_TEMPLATES,
	expandTemplate,
	getPlanning,
	parseQuickAdd,
	parseTimestampInput,
	setPlanning,
	shapeCapture,
} from '..';
import { findMentions, linkMentionChanges, mentionMatcher } from '../../vault/mentions';

const hasEmacs = (() => {
	try {
		execFileSync('emacs', ['--version'], { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
})();

const kw = { todoKeywords: ['TODO', 'NEXT'], doneKeywords: ['DONE'] };
const today = '2026-10-29';
const now = { date: today, time: '20:15' };
const task = DEFAULT_CAPTURE_TEMPLATES.find((t) => t.id === 'task')!;

/** What capture writes for a quick add with the Task template. */
const quick = (text: string) => {
	const q = parseQuickAdd(text, { today, keywords: kw });
	const shaped = shapeCapture(expandTemplate(task.template, { now, text: q.title }), task.type);
	return applyQuickAdd(shaped, q, kw);
};
/** What app.setPlanningDate writes (the day planner, the Schedule sheet). */
const plan = (src: string, kind: 'SCHEDULED' | 'DEADLINE', input: string) => {
	const ts = parseTimestampInput(input, getPlanning(src, 0, kw)[kind], { active: true });
	return applyChanges(src, setPlanning(src, 0, kind, ts, kw));
};

const habit = [
	'* TODO Review flashcards',
	'SCHEDULED: <2026-10-29 Thu .+1d>',
	':PROPERTIES:',
	':STYLE:    habit',
	':Effort:   0:20',
	':END:',
	':LOGBOOK:',
	'- State "DONE"       from "TODO"       [2026-10-28 Wed 08:05]',
	':END:',
	'',
].join('\n');

/** Each case: what we write, and what org-mode must read from it. */
/** What the day planner writes for a long task: a start day and two sessions. */
const sessions = (() => {
	let s = '* TODO Write the report\n:PROPERTIES:\n:Effort:   12:00\n:END:\n';
	s = applyChanges(
		s,
		setPlanning(s, 0, 'SCHEDULED', makeTimestamp({ date: '2026-11-02', active: true }), kw),
	);
	for (const [date, time, endTime] of [
		['2026-11-02', '09:00', '12:00'],
		['2026-11-03', '13:00', '17:00'],
	] as const)
		s = applyChanges(s, addSession(s, 0, makeTimestamp({ date, time, endTime, active: true }), kw));
	return s;
})();

const CASES: { org: string; expect: string }[] = [
	{
		org: sessions,
		expect:
			'Write the report|TODO|-|-|active 2026-11-02|-|720|no|t|2026-11-02 09:00-12:00,2026-11-03 13:00-17:00',
	},
	{
		org: quick('Call Sam tomorrow 3pm #work !A every week ~30m'),
		expect: 'Call Sam|TODO|A|work|active 2026-10-30 15:00 +1w|-|30|no|t|-',
	},
	{
		org: quick('Draft report mon due fri 5pm ~1h30'),
		expect: 'Draft report|TODO|-|-|active 2026-11-02|active 2026-10-30 17:00|90|no|t|-',
	},
	{ org: quick('Pay rent due nov 1'), expect: 'Pay rent|TODO|-|-|-|active 2026-11-01|-|no|t|-' },
	{
		org: quick('Workshop nov 4 9am-12:30pm #learning'),
		expect: 'Workshop|TODO|-|learning|active-range 2026-11-04 09:00-12:30|-|-|no|t|-',
	},
	{
		org: quick('NEXT Water plants daily ~5m'),
		expect: 'Water plants|NEXT|-|-|active 2026-10-29 +1d|-|5|no|t|-',
	},
	{
		org: plan(habit, 'SCHEDULED', '2026-10-29T14:00-14:30'),
		expect: 'Review flashcards|TODO|-|-|active-range 2026-10-29 14:00-14:30 .+1d|-|20|valid|t|-',
	},
	{
		org: plan(plan(habit, 'SCHEDULED', '2026-10-29T14:00-14:30'), 'SCHEDULED', '2026-10-29'),
		expect: 'Review flashcards|TODO|-|-|active 2026-10-29 .+1d|-|20|valid|t|-',
	},
	{
		org: plan(
			'* TODO Stand-up\nSCHEDULED: <2026-10-29 Thu 09:30>\n',
			'SCHEDULED',
			'2026-10-30T09:30',
		),
		expect: 'Stand-up|TODO|-|-|active 2026-10-30 09:30|-|-|no|t|-',
	},
];

/** Run Emacs in batch mode; on failure, say what Emacs said. */
function emacs(args: string[]): string {
	try {
		return execFileSync('emacs', ['--batch', '-Q', ...args], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (e) {
		const err = e as { stderr?: string };
		throw new Error(`Emacs failed:\n${(err.stderr ?? '').split('\n').slice(-8).join('\n')}`);
	}
}

const ELISP = `
(require 'org) (require 'org-element) (require 'org-habit) (require 'org-duration)
(setq org-todo-keywords '((sequence "TODO" "NEXT" "|" "DONE")))
(defun ts (ts)
  (if (not ts) "-"
    (concat (symbol-name (org-element-property :type ts)) " "
      (format "%04d-%02d-%02d" (org-element-property :year-start ts) (org-element-property :month-start ts) (org-element-property :day-start ts))
      (if (org-element-property :hour-start ts) (format " %02d:%02d" (org-element-property :hour-start ts) (org-element-property :minute-start ts)) "")
      (if (and (org-element-property :hour-end ts) (eq (org-element-property :type ts) 'active-range))
          (format "-%02d:%02d" (org-element-property :hour-end ts) (org-element-property :minute-end ts)) "")
      (if (org-element-property :repeater-type ts)
          (format " %s%s%s" (pcase (org-element-property :repeater-type ts) ('cumulate "+") ('catch-up "++") ('restart ".+"))
                  (org-element-property :repeater-value ts)
                  (substring (symbol-name (org-element-property :repeater-unit ts)) 0 1)) ""))))
(defun sessions ()
  "Active timestamps in the entry's own text (not its planning line), as DATE HH:MM-HH:MM."
  (let* ((beg (save-excursion (org-end-of-meta-data t) (point)))
         (end (save-excursion (outline-next-heading) (point)))
         (out nil))
    (save-excursion
      (goto-char beg)
      (while (re-search-forward org-ts-regexp-both end t)
        (let ((ts (save-excursion (goto-char (match-beginning 0)) (org-element-timestamp-parser))))
          (when (memq (org-element-property :type ts) '(active active-range))
            (push (substring (ts ts) (1+ (string-match " " (ts ts)))) out)))))
    (if out (mapconcat #'identity (nreverse out) ",") "-")))
(with-temp-buffer
  (insert-file-contents (car command-line-args-left))
  (org-mode)
  (org-map-entries
   (lambda ()
     (let* ((hl (org-element-at-point)) (effort (org-entry-get nil "Effort")))
       (princ (format "%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n"
         (org-get-heading t t t t) (or (org-get-todo-state) "-")
         (if (org-element-property :priority hl) (char-to-string (org-element-property :priority hl)) "-")
         (if (org-get-tags nil t) (mapconcat #'identity (org-get-tags nil t) ":") "-")
         (ts (org-element-property :scheduled hl)) (ts (org-element-property :deadline hl))
         (if effort (format "%d" (org-duration-to-minutes effort)) "-")
         (if (org-is-habit-p) (if (org-habit-parse-todo) "valid" "invalid") "no")
         (save-excursion (forward-line 1)
           (if (or (not (or (org-element-property :scheduled hl) (org-element-property :deadline hl)))
                   (eq (org-element-type (org-element-at-point)) 'planning)) "t" "nil"))
         (sessions)))))))
`;

describe.skipIf(!hasEmacs)("Emacs' org-mode reads what we write", () => {
	it('quick adds and planner edits come back as written', () => {
		const dir = mkdtempSync(join(tmpdir(), 'org-compliance-'));
		const file = join(dir, 'tasks.org');
		const script = join(dir, 'read.el');
		writeFileSync(file, `#+title: check\n\n${CASES.map((c) => c.org.trimEnd()).join('\n')}\n`);
		writeFileSync(script, ELISP);
		const out = emacs(['-l', script, file]).trim().split('\n');
		expect(out).toEqual(CASES.map((c) => c.expect));
	});

	it('org reads durations with the same units we do', () => {
		const dir = mkdtempSync(join(tmpdir(), 'org-units-'));
		const units = durationUnits(8, 5);
		const values = ['0:30', '1:30', '3h', '2d', '1d 2:30', '1w', '1w 2d 4h'];
		const script = join(dir, 'units.el');
		writeFileSync(
			script,
			`(require 'org-duration)
(setq org-duration-units '(("min" . 1) ("h" . 60) ("d" . ${units['d']}) ("w" . ${units['w']}) ("m" . ${units['m']}) ("y" . ${units['y']})))
(org-duration-set-regexps)
(dolist (v '(${values.map((v) => JSON.stringify(v)).join(' ')}))
  (princ (format "%d\\n" (org-duration-to-minutes v))))`,
		);
		const out = emacs(['-l', script]).trim().split('\n').map(Number);
		expect(out).toEqual(values.map((v) => durationToMinutes(v, units)));
	});

	it('org reads the links that link suggestions write', () => {
		const dir = mkdtempSync(join(tmpdir(), 'org-links-'));
		const source = [
			'#+title: Forest walk',
			'',
			'Suzanne Simard found that mycelial networks feed seedlings (see the Wood',
			'Wide Web), as =Simard= wrote.',
			'',
		].join('\n');
		const matcher = mentionMatcher([
			{ id: 'aaa-1', file: 'simard.org', title: 'Suzanne Simard', aliases: [], level: 0 },
			{ id: 'bbb-2', file: 'net.org', title: 'Mycelial network', aliases: [], level: 0 },
		]);
		const found = findMentions(source, matcher, { path: 'walk.org' });
		const linked = applyChanges(source, linkMentionChanges(found));
		const file = join(dir, 'walk.org');
		writeFileSync(file, linked);
		const script = join(dir, 'links.el');
		writeFileSync(
			script,
			`(require 'org) (require 'org-element)
(with-temp-buffer
  (insert-file-contents (car command-line-args-left))
  (org-mode)
  (org-element-map (org-element-parse-buffer) 'link
    (lambda (l)
      (princ (format "%s|%s|%s\\n" (org-element-property :type l) (org-element-property :path l)
        (buffer-substring-no-properties (org-element-property :contents-begin l) (org-element-property :contents-end l)))))))`,
		);
		const out = emacs(['-l', script, file]).trim().split('\n');
		expect(out).toEqual(['id|aaa-1|Suzanne Simard', 'id|bbb-2|mycelial networks']);
	});

	it("org's agenda shows each session on its day", () => {
		const dir = mkdtempSync(join(tmpdir(), 'org-agenda-'));
		const file = join(dir, 'work.org');
		writeFileSync(file, `#+title: work\n\n${sessions}`);
		const script = join(dir, 'agenda.el');
		writeFileSync(
			script,
			`(require 'org-agenda)
(setq org-todo-keywords '((sequence "TODO" "NEXT" "|" "DONE")))
(setq org-agenda-files (list ${JSON.stringify(file)}) org-agenda-start-on-weekday nil org-agenda-use-time-grid nil)
(org-agenda-list nil "2026-11-02" 2)
(princ (buffer-substring-no-properties (point-min) (point-max)))`,
		);
		const out = emacs(['-l', script]);
		const days = out.split(/\n(?=\S)/).filter((d) => /^\w+day /.test(d));
		expect(days[0]).toMatch(/9:00-12:00\s+TODO Write the report/);
		expect(days[0]).toMatch(/Scheduled:\s+TODO Write the report/);
		expect(days[1]).toMatch(/13:00-17:00\s+TODO Write the report/);
	});
});
