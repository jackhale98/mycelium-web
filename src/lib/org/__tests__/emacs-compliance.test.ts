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
	applyChanges,
	applyQuickAdd,
	DEFAULT_CAPTURE_TEMPLATES,
	expandTemplate,
	getPlanning,
	parseQuickAdd,
	parseTimestampInput,
	setPlanning,
	shapeCapture,
} from '..';

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
const CASES: { org: string; expect: string }[] = [
	{
		org: quick('Call Sam tomorrow 3pm #work !A every week ~30m'),
		expect: 'Call Sam|TODO|A|work|active 2026-10-30 15:00 +1w|-|30|no|t',
	},
	{
		org: quick('Draft report mon due fri 5pm ~1h30'),
		expect: 'Draft report|TODO|-|-|active 2026-11-02|active 2026-10-30 17:00|90|no|t',
	},
	{ org: quick('Pay rent due nov 1'), expect: 'Pay rent|TODO|-|-|-|active 2026-11-01|-|no|t' },
	{
		org: quick('Workshop nov 4 9am-12:30pm #learning'),
		expect: 'Workshop|TODO|-|learning|active-range 2026-11-04 09:00-12:30|-|-|no|t',
	},
	{
		org: quick('NEXT Water plants daily ~5m'),
		expect: 'Water plants|NEXT|-|-|active 2026-10-29 +1d|-|5|no|t',
	},
	{
		org: plan(habit, 'SCHEDULED', '2026-10-29T14:00-14:30'),
		expect: 'Review flashcards|TODO|-|-|active-range 2026-10-29 14:00-14:30 .+1d|-|20|valid|t',
	},
	{
		org: plan(plan(habit, 'SCHEDULED', '2026-10-29T14:00-14:30'), 'SCHEDULED', '2026-10-29'),
		expect: 'Review flashcards|TODO|-|-|active 2026-10-29 .+1d|-|20|valid|t',
	},
	{
		org: plan(
			'* TODO Stand-up\nSCHEDULED: <2026-10-29 Thu 09:30>\n',
			'SCHEDULED',
			'2026-10-30T09:30',
		),
		expect: 'Stand-up|TODO|-|-|active 2026-10-30 09:30|-|-|no|t',
	},
];

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
(with-temp-buffer
  (insert-file-contents (car command-line-args-left))
  (org-mode)
  (org-map-entries
   (lambda ()
     (let* ((hl (org-element-at-point)) (effort (org-entry-get nil "Effort")))
       (princ (format "%s|%s|%s|%s|%s|%s|%s|%s|%s\\n"
         (org-get-heading t t t t) (or (org-get-todo-state) "-")
         (if (org-element-property :priority hl) (char-to-string (org-element-property :priority hl)) "-")
         (if (org-get-tags nil t) (mapconcat #'identity (org-get-tags nil t) ":") "-")
         (ts (org-element-property :scheduled hl)) (ts (org-element-property :deadline hl))
         (if effort (format "%d" (org-duration-to-minutes effort)) "-")
         (if (org-is-habit-p) (if (org-habit-parse-todo) "valid" "invalid") "no")
         (save-excursion (forward-line 1)
           (if (or (not (or (org-element-property :scheduled hl) (org-element-property :deadline hl)))
                   (eq (org-element-type (org-element-at-point)) 'planning)) "t" "nil"))))))))
`;

describe.skipIf(!hasEmacs)("Emacs' org-mode reads what we write", () => {
	it('quick adds and planner edits come back as written', () => {
		const dir = mkdtempSync(join(tmpdir(), 'org-compliance-'));
		const file = join(dir, 'tasks.org');
		const script = join(dir, 'read.el');
		writeFileSync(file, `#+title: check\n\n${CASES.map((c) => c.org.trimEnd()).join('\n')}\n`);
		writeFileSync(script, ELISP);
		const out = execFileSync('emacs', ['--batch', '-Q', '-l', script, file], {
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'ignore'],
		})
			.trim()
			.split('\n');
		expect(out).toEqual(CASES.map((c) => c.expect));
	});
});
