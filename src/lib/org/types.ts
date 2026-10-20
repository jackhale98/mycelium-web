/// Shared types for the pure org-mode logic in `$lib/org`.
/// Nothing in this directory may import Svelte, browser APIs or read the clock.

/** The three planning keywords org recognises on a planning line. */
export type PlanningKind = 'SCHEDULED' | 'DEADLINE' | 'CLOSED';

/** Units accepted by repeater and warning cookies. */
export type TimeUnit = 'h' | 'd' | 'w' | 'm' | 'y';

/**
 * Repeater flavours:
 * - `cumulate`  — `+1w`  shift from the stored date
 * - `catch-up`  — `++1w` shift from the stored date until strictly after today
 * - `restart`   — `.+1w` shift from today
 */
export type RepeaterType = 'cumulate' | 'catch-up' | 'restart';

/** A parsed org timestamp such as `<2024-01-15 Mon 09:00-10:30 ++1w -2d>`. */
export interface OrgTimestamp {
	/** Exact source text, delimiters included. */
	raw: string;
	/** `true` for `<…>`, `false` for `[…]`. */
	active: boolean;
	/** `YYYY-MM-DD`. */
	date: string;
	/** Day-name token as written, e.g. `Mon`. `null` when absent. */
	dayName: string | null;
	/** `HH:MM` start time, or `null`. */
	time: string | null;
	/** `HH:MM` end time of a same-day time range, or `null`. */
	endTime: string | null;
	/** Repeater cookie text, e.g. `+1w`, `++1w`, `.+1d`. */
	repeater: string | null;
	/** Warning cookie text, e.g. `-2d`, `--1d`. */
	warning: string | null;
}

/** A parsed repeater or warning cookie. */
export interface RepeaterCookie {
	raw: string;
	type: RepeaterType;
	value: number;
	unit: TimeUnit;
}

/** TODO/DONE keyword sets: org's not-done and done halves of a `#+TODO:` line. */
export interface KeywordConfig {
	todoKeywords: string[];
	doneKeywords: string[];
	/**
	 * Per-keyword state logging from `#+TODO:` markers: `WAIT(w@/!)` logs on
	 * entering (`!` time, `@` note) and on leaving (`/!`). Notes are recorded
	 * as timestamps.
	 */
	log?: Record<string, { enter: boolean; leave: boolean }>;
}

/** How state changes are recorded, mirroring org's logging options. */
export interface LogSettings {
	/** `org-log-done`: stamp `CLOSED:` when a task is completed. Emacs default: off. */
	logDone: boolean;
	/** `org-log-repeat`: record `LAST_REPEAT` and a state note when a repeater fires. Emacs default: on. */
	logRepeat: boolean;
	/** `org-log-into-drawer`: drawer for state notes (`LOGBOOK`), or `null` to log under the heading. */
	logIntoDrawer: string | null;
	/** `org-todo-repeat-to-state`: state a repeating task returns to; `null` means the first TODO keyword. */
	repeatToState: string | null;
}

/** Emacs' out-of-the-box logging behaviour. */
export const EMACS_LOG_DEFAULTS: LogSettings = {
	logDone: false,
	logRepeat: true,
	logIntoDrawer: null,
	repeatToState: null,
};

/** Priority values, highest first. */
export interface PriorityConfig {
	priorities: string[];
}

/** Injected "current moment" — logic in this directory never calls `new Date()`. */
export interface OrgNow {
	/** `YYYY-MM-DD` in the user's local time. */
	date: string;
	/** `HH:MM` in the user's local time. */
	time?: string | null;
}

export const DEFAULT_KEYWORD_CONFIG: KeywordConfig = {
	todoKeywords: ['TODO'],
	doneKeywords: ['DONE'],
};

export const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
	priorities: ['A', 'B', 'C'],
};

/** Order org itself writes planning entries in. */
export const PLANNING_ORDER: readonly PlanningKind[] = ['CLOSED', 'DEADLINE', 'SCHEDULED'];

/** A half-open `[from, to)` range of source offsets. */
export interface Span {
	from: number;
	to: number;
}
