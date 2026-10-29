# Plan: quick add, inbox triage and weekly review, time blocking

Three features that make Mycelium the fastest way to run an org task system
from a phone, built on what's there: capture templates, the quick sheets
(Schedule / State / Priority), swipe rows, the refile sheet, undo in the
clock bar, and timestamps with time ranges (`<2026-11-03 Tue 09:00-10:30>`).
Everything writes plain org that Emacs reads the same way.

## 1. Quick add in plain language

**Goal.** Type `Call Sam tomorrow 3pm #work !A every week ~30m` and get

```org
* TODO [#A] Call Sam                                                 :work:
SCHEDULED: <2026-10-30 Fri 15:00 +1w>
:PROPERTIES:
:Effort:   0:30
:END:
```

**Parser** `src/lib/org/quick-add.ts`, pure and unit-tested. No guessing
service, no network: a small deterministic grammar, English words.

| Written                                                                                                                                          | Means                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `#work`, `#home`                                                                                                                                 | tags                                                                     |
| `!A` `!B` `!C` (also `!1`–`!3`)                                                                                                                  | priority                                                                 |
| a leading keyword (`NEXT …`, `WAIT …`)                                                                                                           | that state (the vault's keywords), else the first TODO keyword           |
| `today`, `tomorrow`/`tmr`, `mon`…`sunday`, `next monday`, `this weekend`, `next week`, `in 3 days`, `in 2 weeks`, `nov 4`, `4 nov`, `2026-11-04` | a date                                                                   |
| `3pm`, `at 15:00`, `3:30pm`, `3-4pm`, `15:00-16:30`, `noon`                                                                                      | a time or a time range (on the date, or today when only a time is given) |
| `due fri`, `by friday`, `deadline nov 4`                                                                                                         | that date is the DEADLINE (the other date, if any, stays SCHEDULED)      |
| `every day/week/month/year`, `every 2 weeks`, `daily`, `weekly`, `monthly`, `every monday`                                                       | a repeater (`+1w`…; `every monday` also sets the date)                   |
| `~30m`, `~1h`, `~1h30`                                                                                                                           | `Effort`                                                                 |
| `"…"` around words                                                                                                                               | taken literally (`"Meet Tuesday" notes`)                                 |

It returns the title (what's left, tidied) plus a list of recognised parts,
each with its place in the text, so the interface can show and undo them.

**In the capture sheet.** Templates get a `parse` option ("Understand dates,
#tags and !priority in the text"), on for the built-in Task template and
available to any `entry` template. While typing, recognised parts show as
chips under the text box: _Fri 30 Oct 15:00 · repeats weekly · #work ·
Priority A · 30 min_. Tapping a chip's × keeps those words in the title
instead. The preview shows the org text. A parsed date replaces the
template's own `SCHEDULED: %t`; with no date, the template applies as now.

**On the agenda.** An "Add a task…" field at the top of the List and Day
views uses the Task template with parsing, so adding is one line and Enter.

**Settings → Capture**: the per-template checkbox.

**Tests.** Unit: each row of the table, combinations, literals, words that
only look like dates ("Mayday", "Sunday school" stays when quoted), weekday
math across month and year ends, time ranges, deadlines with schedules.
E2E: type a line in the agenda field and find the task with the right
planning, tags, priority and Effort; undo a chip.

## 2. Inbox triage and weekly review

**Inbox.** Per vault, Settings → Tasks → _Inbox_: a file (default
`inbox.org` when it exists) whose top-level headings are things not yet
decided. The capture templates can point at it. Its count shows on Home.

**Triage** (route `#/triage`, palette "Process inbox", Home's inbox card):
one card at a time, showing the heading, its text (a few lines), tags and
dates, with "3 of 12". Actions, with keys in brackets:

- **Done** (`d`), the same as a swipe right; undoable
- **Schedule** (`s`), the Schedule sheet
- **State** (`t`), the State sheet
- **Refile** (`r`), the refile sheet; the card leaves the inbox
- **Delete** (`x`), removes the subtree, undoable
- **Later** (`space`), moves on without changing anything

Swipe the card right for Done, left for Later. An emptied inbox shows
"Inbox zero" and a way to the weekly review.

**Weekly review** (route `#/review`, palette, Home): steps with progress
dots, Back / Next, each a list of rows that swipe like the agenda's:

1. **Inbox**: count, _Process inbox_ opens triage
2. **Overdue**: decide each (done, reschedule, drop)
3. **Coming up**: deadlines and schedules in the next 7 days
4. **Waiting**: tasks in a waiting state (keywords like WAIT/WAITING/HOLD,
   chosen in Settings)
5. **Stuck projects**: the existing Stuck list
6. **Habits**: the ones whose streak broke this week
7. **Done this week**: closed in the last 7 days, to see what got done

Finishing records the date (per vault); Home shows "Weekly review: 8 days
ago" with a nudge after 7.

**Tests.** Unit: deleting a subtree; inbox listing. E2E: triage a demo
inbox (done, schedule, refile, delete, undo) to inbox zero; walk the review.

## 3. Time blocking

**Day view**: a new agenda mode between List and Week. A timeline of the
day (06:00–24:00, scrolled to now), 15-minute snapping, with:

- **Blocks** for today's timed items: SCHEDULED or DEADLINE with a time,
  appointments, ranges as written; a lone time lasts its `Effort`, else 30
  minutes. Overlaps sit side by side.
- **Unplanned**: today's and overdue tasks without a time, in a tray (a
  column on wide screens, a drawer on phones).
- **Placing**: drag a task from the tray onto the timeline. Its SCHEDULED
  gets that date and time; a range from its Effort, else 30 minutes. Its
  repeater and warning stay. On phones, tap a task then tap a slot (more
  reliable than dragging while scrolling).
- **Moving and resizing**: drag a block to move it, or its bottom edge to
  change the end. Dropping it on the tray takes the time off (the date
  stays). Every change has Undo.
- **Keyboard**: focus a block; ↑/↓ moves 15 minutes, Shift+↑/↓ changes the
  length, Enter opens the edit sheet, Delete takes the time off.
- **Totals**: "Planned 4 h 30 · free 3 h 30 between 09:00 and 18:00" (the
  working hours set in Settings → Tasks).
- **Now line**, and ‹ › to plan tomorrow or other days.

Reminders already follow SCHEDULED times, so planned blocks remind.

**Tests.** Unit: block layout (columns for overlaps, durations from ranges /
Effort / default), snapping, totals. E2E: place a task (desktop drag, phone
tap-to-place), move it, resize it, check the written timestamp and undo.

## Order

1 → 2 → 3, each validated (format, check, unit, full e2e), committed and
pushed on its own, with the README updated as it lands.
