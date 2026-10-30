<script lang="ts">
	// The planner (time blocking): timed tasks as blocks on a timeline, one
	// day or a week of them side by side, and untimed ones in a tray to plan.
	// Everything writes the task's SCHEDULED (or DEADLINE) time as an org
	// range, repeater and all, or a work session in its entry, with Undo in
	// the bar; appointments written in an entry's text show but stay put.
	// - Any screen: pick a task in the tray, then tap a time on a day (or
	//   type a time and Plan); tap a block for a toolbar (day before or
	//   after, no time, plan the rest, edit).
	// - Mouse, or a finger after a long press: drag a task onto a day, drag a
	//   block to move it (to another day too, in the week), drag its bottom
	//   edge to change its end, drag it onto the tray to take its time off.
	// - Keyboard, on a block: ↑/↓ move 15 minutes, Shift+↑/↓ change the end,
	//   ←/→ move a day, Enter edits, Delete takes the time off.
	// The week shows working hours, with early and late hours folded away
	// until asked for; it's the default where the pane is wide, and a narrow
	// pane (a phone) always shows a day.
	import { untrack } from 'svelte';
	import { addDays } from '$lib/org';
	import type { AgendaItem } from '$lib/vault/vault';
	import { sessionsOf } from '$lib/org';
	import { weekStart } from '../agenda';
	import {
		DEFAULT_MINUTES,
		fillSessions,
		SESSION_MAX,
		fromMinutes,
		hours,
		planDays,
		planTotals,
		snap,
		SNAP,
		toMinutes,
		type PlanBlock,
	} from '../planner';
	import { app, localNow } from '../state.svelte';
	import Icon from './Icon.svelte';

	let { today, keep }: { today: string; keep: (item: AgendaItem) => boolean } = $props();

	// ---- day or week ----
	const VIEW_KEY = 'mycelium:plan-view';
	type View = 'day' | 'week';
	/** Narrower than this, the week doesn't fit: a day it is. */
	const WEEK_MIN = 760;
	/** Wider than this, the week is the default. */
	const WEEK_DEFAULT = 1100;
	let chosen = $state<View | null>(
		(() => {
			try {
				const v = localStorage.getItem(VIEW_KEY);
				return v === 'day' || v === 'week' ? v : null;
			} catch {
				return null;
			}
		})(),
	);
	let width = $state(0);
	const canWeek = $derived(width >= WEEK_MIN);
	const view = $derived<View>(
		!canWeek ? 'day' : (chosen ?? (width >= WEEK_DEFAULT ? 'week' : 'day')),
	);
	function setView(v: View, remember = true) {
		chosen = v;
		if (!remember) return;
		try {
			localStorage.setItem(VIEW_KEY, v);
		} catch {
			// Not remembered: fine.
		}
	}

	// svelte-ignore state_referenced_locally
	let date = $state(today);
	const dates = $derived(
		view === 'week' ? Array.from({ length: 7 }, (_, n) => addDays(weekStart(date), n)) : [date],
	);
	const options = { effortOf: (i: AgendaItem) => app.effortOf(i) };
	const days = $derived.by(() => {
		void app.rev;
		return planDays(app.vault, dates, today, keep, options).map((plan, n) => ({
			date: dates[n]!,
			plan,
			totals: planTotals(plan.blocks, app.workHours),
		}));
	});
	/** A block on its day; `id` is unique across the days shown. */
	type DayBlock = PlanBlock & { date: string; id: string };
	const blocks = $derived<DayBlock[]>(
		days.flatMap((d) =>
			d.plan.blocks.map((b) => ({ ...b, date: d.date, id: `${d.date}\u0001${b.key}` })),
		),
	);
	const keyOf = (i: AgendaItem) => `${i.file}\u0000${i.pos}`;
	/** What's left to plan on the days shown, each task once. */
	const unplanned = $derived.by(() => {
		const seen = new Set<string>();
		return days
			.flatMap((d) => d.plan.unplanned)
			.filter((i) => !seen.has(keyOf(i)) && !!seen.add(keyOf(i)));
	});
	const progress = $derived(new Map(days.flatMap((d) => [...d.plan.progress])));
	const totals = $derived(
		days.reduce(
			(sum, d) => ({ planned: sum.planned + d.totals.planned, free: sum.free + d.totals.free }),
			{ planned: 0, free: 0 },
		),
	);
	/** A task's Effort and how much of it is planned (any day). */
	const progressOf = (i: AgendaItem) => progress.get(keyOf(i)) ?? { effort: null, planned: 0 };
	/** Effort still to plan, or null without an estimate. */
	const remainingOf = (i: AgendaItem) => {
		const p = progressOf(i);
		return p.effort ? Math.max(0, p.effort - p.planned) : null;
	};
	/** How long a block placed now lasts: what's left of the estimate, two hours at most. */
	const lengthOf = (i: AgendaItem) => {
		const left = remainingOf(i);
		return left ? Math.min(left, SESSION_MAX) : DEFAULT_MINUTES;
	};
	/** "5 h of 12 h", for a task with an estimate. */
	const progressLabel = (i: AgendaItem) => {
		const p = progressOf(i);
		return p.effort ? `${hours(p.planned)} of ${hours(p.effort)}` : '';
	};

	/** What's picked: a task in the tray (to place), or a block (for its toolbar). */
	let picked = $state<{ kind: 'tray' | 'block'; key: string } | null>(null);
	const pickedTray = $derived(
		picked?.kind === 'tray' ? (unplanned.find((i) => keyOf(i) === picked!.key) ?? null) : null,
	);
	const pickedBlock = $derived(
		picked?.kind === 'block' ? (blocks.find((b) => b.id === picked!.key) ?? null) : null,
	);
	let placeAt = $state('09:00');
	let placeOn = $state('');

	const dayName = (d: string, opts: Intl.DateTimeFormatOptions) =>
		new Date(`${d}T12:00`).toLocaleDateString(undefined, opts);
	const label = $derived(
		view === 'week'
			? `${dayName(dates[0]!, { day: 'numeric', month: 'short' })} – ${dayName(dates[6]!, { day: 'numeric', month: 'short', year: 'numeric' })}`
			: dayName(date, { weekday: 'long', day: 'numeric', month: 'long' }),
	);
	const step = $derived(view === 'week' ? 7 : 1);

	// ---- writing ----
	const kindOf = (b: PlanBlock) => (b.source === 'DEADLINE' ? 'DEADLINE' : 'SCHEDULED');
	/** A deadline stays on its day (only its time moves); appointments don't move at all. */
	const movesDays = (b: PlanBlock) => b.source === 'SCHEDULED' || b.source === 'session';
	/**
	 * Place a task on `on` at `start`. A task that fits one block, with no
	 * time yet, gets its SCHEDULED time (org's own way); one that needs more,
	 * or already has a time, gets a work session in its entry.
	 */
	function place(item: AgendaItem, on: string, start: number) {
		const s = Math.max(0, snap(start));
		const end = Math.min(s + lengthOf(item), 24 * 60 - 1);
		const file = app.vault.file(item.file);
		const sessions = file ? sessionsOf(file.source, item.pos, file.index.keywords).length : 0;
		const left = remainingOf(item);
		const onePiece = !item.scheduled?.time && !sessions && (left === null || left <= SESSION_MAX);
		if (onePiece) app.planTask(item.file, item.pos, 'SCHEDULED', on, s, end);
		else app.addSessions(item.file, item.pos, [{ date: on, start: s, end }]);
		picked = null;
	}
	function move(b: DayBlock, on: string, start: number, end: number) {
		if (b.source === 'appointment') return;
		if (!movesDays(b)) on = b.date;
		if (on === b.date && start === b.start && end === b.end) return;
		if (b.source === 'session' && b.session)
			app.moveSession(b.item.file, b.item.pos, b.session, { date: on, start, end });
		else app.planTask(b.item.file, b.item.pos, kindOf(b), on, start, end);
	}
	function unplan(b: DayBlock) {
		if (b.source === 'appointment') return;
		if (b.source === 'session' && b.session)
			app.removeSessionAt(b.item.file, b.item.pos, b.session);
		else app.planTask(b.item.file, b.item.pos, kindOf(b), b.date, null);
		picked = null;
	}
	/**
	 * Fill the rest of a task's estimate into free working time: from now (or
	 * the day shown), or in the week from its first day still to come.
	 */
	function planRest(item: AgendaItem) {
		const left = remainingOf(item);
		if (!left) return;
		const first = view === 'week' ? (dates[0]! > today ? dates[0]! : today) : date;
		const from = first === today ? now : toMinutes(app.workHours.start);
		// The two weeks it may fill, planned at once.
		const ahead = Array.from({ length: 14 }, (_, n) => addDays(first, n));
		const plans = planDays(app.vault, ahead, today, keep, options);
		const busyOn = (d: string) => plans[ahead.indexOf(d)]?.blocks ?? [];
		const sessions = fillSessions(left, first, from, busyOn, app.workHours, { horizon: 14 });
		if (!sessions.length) return;
		const total = sessions.reduce((sum, x) => sum + x.end - x.start, 0);
		const count = new Set(sessions.map((x) => x.date)).size;
		app.addSessions(
			item.file,
			item.pos,
			sessions,
			`${hours(total)} planned over ${count} ${count === 1 ? 'day' : 'days'}: ${item.title}`,
		);
		picked = null;
	}
	const nudge = (b: DayBlock, by: number) =>
		move(b, b.date, Math.max(0, b.start + by), Math.min(24 * 60 - 1, b.end + by));
	const stretch = (b: DayBlock, by: number) =>
		move(b, b.date, b.start, Math.max(b.start + SNAP, Math.min(24 * 60 - 1, b.end + by)));
	/** Move a block a day earlier or later, the day view following it. */
	function shiftDay(b: DayBlock, by: number) {
		if (!movesDays(b)) return;
		const to = addDays(b.date, by);
		move(b, to, b.start, b.end);
		if (view === 'day') date = to;
		// Keep the keyboard on it, under its new day.
		const id = `${to}\u0001${b.key}`;
		if (picked?.kind === 'block') picked = { kind: 'block', key: id };
		refocus = id;
	}
	/** A block moved to another day, to focus once it's drawn there. */
	let refocus: string | null = null;
	$effect(() => {
		void blocks;
		if (!refocus) return;
		// (Not a selector: keys hold NULs, which CSS.escape doesn't keep.)
		const el = [...(root?.querySelectorAll<HTMLElement>('.block') ?? [])].find(
			(x) => x.dataset.key === refocus,
		);
		if (!el) return;
		refocus = null;
		el.focus();
	});

	// ---- the timeline ----
	const FULL_FIRST = 6;
	/** Early and late hours shown in the week (always shown in a day). */
	let expanded = $state(false);
	const range = $derived.by(() => {
		const open = Math.floor(toMinutes(app.workHours.start) / 60);
		const close = Math.ceil(toMinutes(app.workHours.end) / 60);
		const full = { first: Math.min(FULL_FIRST, open), last: 24 };
		if (view === 'day' || expanded || close <= open) return full;
		return { first: Math.max(full.first, open), last: Math.min(24, close) };
	});
	/** The earliest and latest minute a block can be dragged to. */
	const lo = $derived(range.first * 60);
	const hi = $derived(Math.min(range.last * 60, 24 * 60 - 1));
	const fullFirst = $derived(Math.min(FULL_FIRST, Math.floor(toMinutes(app.workHours.start) / 60)));
	const HOUR_PX = $derived(view === 'week' ? 48 : 64);
	const px = (minutes: number) => ((minutes - range.first * 60) / 60) * HOUR_PX;
	/** Blocks out of sight in the folded early and late hours. */
	const folded = $derived({
		early: blocks.filter((b) => b.start < lo).length,
		late: blocks.filter((b) => b.end > hi).length,
	});

	let line = $state<HTMLElement>();
	let scroller = $state<HTMLElement>();
	let tray = $state<HTMLElement>();
	const lanes: HTMLElement[] = $state([]);
	const minutesAt = (clientY: number) => {
		const r = line!.getBoundingClientRect();
		return range.first * 60 + ((clientY - r.top) / HOUR_PX) * 60;
	};
	/** The day under a point: its lane, or the nearest one. */
	const dateAt = (clientX: number) => {
		let best = dates[0]!;
		let gap = Infinity;
		dates.forEach((d, n) => {
			const r = lanes[n]?.getBoundingClientRect();
			if (!r) return;
			const off = clientX < r.left ? r.left - clientX : clientX > r.right ? clientX - r.right : 0;
			if (off < gap) {
				gap = off;
				best = d;
			}
		});
		return best;
	};
	/** Where a lane is drawn: its share of the width after the hour labels. */
	const laneLeft = (n: number, share = 0) =>
		`calc(3.5rem + (100% - 3.75rem) * ${(n + share) / dates.length})`;
	const laneWidth = (share = 1) => `calc((100% - 3.75rem) * ${share / dates.length})`;

	/** A tap on a day (not on a block) places the picked task there. */
	function onTimelineClick(e: MouseEvent) {
		if (justDragged || (e.target as Element).closest('.block')) return;
		if (pickedTray) place(pickedTray, dateAt(e.clientX), minutesAt(e.clientY));
		else picked = null;
	}
	/** A day's header: open that day on its own. */
	function openDay(d: string) {
		date = d;
		setView('day', false);
	}

	// ---- dragging: a mouse right away, a finger after a long press ----
	type Drag = {
		mode: 'move' | 'resize' | 'place';
		key: string;
		/** The day it started on, and the day it's over now. */
		from: string;
		date: string;
		/** It can't change day (a resize, a deadline). */
		pinned: boolean;
		/** Where the pointer was within the block when it started (minutes). */
		grip: number;
		length: number;
		start: number;
		end: number;
		x: number;
		y: number;
		/** Where the pointer is now (screen), for the floating card and edge scrolling. */
		cx: number;
		cy: number;
		moved: boolean;
		overTray: boolean;
		overLine: boolean;
		touch: boolean;
	};
	let drag = $state<Drag | null>(null);
	/** A drag just ended: the click that follows it isn't a tap. */
	let justDragged = false;

	function startDrag(
		mode: Drag['mode'],
		key: string,
		on: string,
		pinned: boolean,
		start: number,
		end: number,
		x: number,
		y: number,
		touch: boolean,
	) {
		const at = line ? minutesAt(y) : start;
		drag = {
			mode,
			key,
			from: on,
			date: on,
			pinned,
			grip: mode === 'move' ? at - start : 0,
			length: end - start,
			start,
			end,
			x,
			y,
			cx: x,
			cy: y,
			// A finger has already held still to pick it up: it's lifted at once.
			moved: touch,
			overTray: false,
			overLine: false,
			touch,
		};
	}
	function beginDrag(e: PointerEvent, mode: Drag['mode'], b: DayBlock) {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		startDrag(
			mode,
			b.id,
			b.date,
			mode === 'resize' || !movesDays(b),
			b.start,
			b.end,
			e.clientX,
			e.clientY,
			false,
		);
	}
	function beginPlace(e: PointerEvent, item: AgendaItem) {
		if (e.pointerType !== 'mouse' || e.button !== 0) return;
		startDrag(
			'place',
			keyOf(item),
			dates[0]!,
			false,
			0,
			lengthOf(item),
			e.clientX,
			e.clientY,
			false,
		);
	}
	function dragTo(x: number, y: number) {
		const d = drag;
		if (!d || !line) return;
		if (!d.moved && Math.hypot(x - d.x, y - d.y) < 4) return;
		d.moved = true;
		d.cx = x;
		d.cy = y;
		const sr = scroller!.getBoundingClientRect();
		d.overLine = x >= sr.left && x <= sr.right && y >= sr.top && y <= sr.bottom;
		const tr = tray?.getBoundingClientRect();
		d.overTray = !!tr && x >= tr.left && x <= tr.right && y >= tr.top && y <= tr.bottom;
		if (!d.pinned) d.date = dateAt(x);
		const at = minutesAt(y);
		if (d.mode === 'resize') d.end = Math.max(d.start + SNAP, Math.min(hi, snap(at)));
		else {
			d.start = Math.max(lo, Math.min(hi - d.length, snap(at - d.grip)));
			d.end = d.start + d.length;
		}
		drag = { ...d };
	}
	function endDrag() {
		const d = drag;
		drag = null;
		if (!d?.moved) return;
		justDragged = true;
		setTimeout(() => (justDragged = false), 0);
		if (d.mode === 'place') {
			const item = unplanned.find((i) => keyOf(i) === d.key);
			if (item && d.overLine) place(item, d.date, d.start);
			return;
		}
		const b = blocks.find((x) => x.id === d.key);
		if (!b) return;
		if (d.mode === 'move' && d.overTray) return unplan(b);
		if (d.overLine || d.mode === 'resize') move(b, d.date, d.start, d.end);
	}
	const onPointerMove = (e: PointerEvent) => {
		if (drag && !drag.touch) dragTo(e.clientX, e.clientY);
	};
	const onPointerUp = () => {
		if (drag && !drag.touch) endDrag();
	};
	// Resting near the timeline's top or bottom edge (inside it), a drag
	// scrolls it; passing through on the way in (from the tray) doesn't.
	/** A drag is under way (changes only when one starts or ends, not as it moves). */
	const lifted = $derived(!!drag?.moved);
	$effect(() => {
		if (!lifted) return;
		let since = 0;
		let last = 0;
		/** Fractions of a pixel left over, so slow scrolling still moves. */
		let carry = 0;
		const tick = () => {
			const t = performance.now();
			const dt = last ? Math.min(250, t - last) : 0;
			last = t;
			const d = drag;
			const el = scroller;
			if (d && el) {
				const r = el.getBoundingClientRect();
				const edge = 44;
				const inside = d.cx >= r.left && d.cx <= r.right && d.cy >= r.top && d.cy <= r.bottom;
				// Pixels a second: faster the closer to the edge (up to about 9 hours a minute).
				const depth = !inside
					? 0
					: d.cy < r.top + edge
						? -(r.top + edge - d.cy)
						: d.cy > r.bottom - edge
							? d.cy - (r.bottom - edge)
							: 0;
				const speed = (depth / edge) * 600;
				if (!speed) since = 0;
				else if (!since) since = t;
				else if (t - since > 350) {
					carry += (speed * dt) / 1000;
					const step = Math.trunc(carry);
					carry -= step;
					el.scrollTop += step;
					dragTo(d.cx, d.cy);
				}
			}
		};
		// A timer, not animation frames, so the pace is the same however busy the page is.
		const timer = setInterval(tick, 16);
		return () => clearInterval(timer);
	});

	// Fingers: hold a block or a task for a moment to lift it, then drag; the
	// bottom of a block resizes it. Blocks and tasks don't hand touches to the
	// browser's own scrolling (touch-action: none), so a lifted drag can never
	// race a native scroll; a quick swipe that starts on one is scrolled here
	// instead, coasting on a little as a native scroll would.
	let root = $state<HTMLElement>();
	$effect(() => {
		const el = root;
		if (!el) return;
		let hold: ReturnType<typeof setTimeout> | null = null;
		let from: { x: number; y: number } | null = null;
		/** A swipe that started on a block or task: what it scrolls, and how fast. */
		let pan: { el: Element; y: number; t: number; v: number; moving: boolean } | null = null;
		let coast: ReturnType<typeof setInterval> | null = null;
		const stopCoast = () => {
			if (coast) clearInterval(coast);
			coast = null;
		};
		const cancelHold = () => {
			if (hold) clearTimeout(hold);
			hold = null;
		};
		/** The nearest ancestor that scrolls up and down (the timeline, else the page). */
		const scrollerOf = (n: Element): Element => {
			for (let p = n.parentElement; p; p = p.parentElement) {
				const y = getComputedStyle(p).overflowY;
				if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
			}
			return document.scrollingElement ?? document.documentElement;
		};
		const touchstart = (e: TouchEvent) => {
			cancelHold();
			stopCoast();
			pan = null;
			const t = e.touches[0];
			const target = (e.target as Element).closest<HTMLElement>('[data-drag]');
			if (e.touches.length !== 1 || !t || !target) return;
			from = { x: t.clientX, y: t.clientY };
			pan = { el: scrollerOf(target), y: t.clientY, t: e.timeStamp, v: 0, moving: false };
			const key = target.dataset.key!;
			hold = setTimeout(() => {
				hold = null;
				if (!from || pan?.moving) return;
				if (target.dataset.drag === 'place') {
					const item = unplanned.find((i) => keyOf(i) === key);
					if (!item) return;
					startDrag('place', key, dates[0]!, false, 0, lengthOf(item), from.x, from.y, true);
				} else {
					const b = blocks.find((x) => x.id === key);
					if (!b || b.source === 'appointment') return;
					const r = target.getBoundingClientRect();
					const mode = from.y > r.bottom - 16 ? 'resize' : 'move';
					const pinned = mode === 'resize' || !movesDays(b);
					startDrag(mode, key, b.date, pinned, b.start, b.end, from.x, from.y, true);
				}
				picked = null;
				navigator.vibrate?.(12);
			}, 280);
		};
		const touchmove = (e: TouchEvent) => {
			const t = e.touches[0];
			if (!t) return;
			if (drag?.touch) {
				// Lifted: the finger drags it.
				e.preventDefault();
				dragTo(t.clientX, t.clientY);
				return;
			}
			if (!pan) return;
			if (!pan.moving && from && Math.hypot(t.clientX - from.x, t.clientY - from.y) > 10) {
				cancelHold();
				pan.moving = true;
			}
			if (!pan.moving) return;
			// A swipe: scroll what's under it by the finger's move.
			e.preventDefault();
			const dy = t.clientY - pan.y;
			const dt = Math.max(1, e.timeStamp - pan.t);
			pan.el.scrollTop -= dy;
			pan.v = 0.8 * (dy / dt) + 0.2 * pan.v;
			pan.y = t.clientY;
			pan.t = e.timeStamp;
		};
		const touchend = () => {
			cancelHold();
			from = null;
			if (drag?.touch) endDrag();
			const p = pan;
			pan = null;
			// Let a quick swipe coast to a stop.
			if (p?.moving && Math.abs(p.v) > 0.2) {
				let v = p.v;
				coast = setInterval(() => {
					p.el.scrollTop -= v * 16;
					v *= 0.94;
					if (Math.abs(v) < 0.02) stopCoast();
				}, 16);
			}
		};
		el.addEventListener('touchstart', touchstart, { passive: true });
		el.addEventListener('touchmove', touchmove, { passive: false });
		el.addEventListener('touchend', touchend);
		el.addEventListener('touchcancel', touchend);
		return () => {
			cancelHold();
			stopCoast();
			el.removeEventListener('touchstart', touchstart);
			el.removeEventListener('touchmove', touchmove);
			el.removeEventListener('touchend', touchend);
			el.removeEventListener('touchcancel', touchend);
		};
	});

	/** A block where it's drawn: being dragged (maybe to another day), or as written. */
	const shown = (b: DayBlock) => {
		const d = drag;
		if (d && d.moved && d.key === b.id && d.mode !== 'place') {
			const moved = d.date !== b.date;
			return {
				date: d.date,
				start: d.start,
				end: d.end,
				col: moved ? 0 : b.col,
				cols: moved ? 1 : b.cols,
			};
		}
		return b;
	};

	function onBlockKey(e: KeyboardEvent, b: DayBlock) {
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const by = e.key === 'ArrowUp' ? -SNAP : SNAP;
			if (e.shiftKey) stretch(b, by);
			else nudge(b, by);
		} else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
			e.preventDefault();
			shiftDay(b, e.key === 'ArrowLeft' ? -1 : 1);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			app.headingSheet = { path: b.item.file, pos: b.item.pos };
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			unplan(b);
		} else if (e.key === 'Escape') picked = null;
	}

	// ---- now, and where the day opens ----
	let now = $state(toMinutes(localNow().time));
	$effect(() => {
		const t = setInterval(() => (now = toMinutes(localNow().time)), 60_000);
		return () => clearInterval(t);
	});
	const hasToday = $derived(dates.includes(today));
	$effect(() => {
		void dates[0];
		void range.first;
		const el = scroller;
		if (!el) return;
		const focus = untrack(() => (hasToday ? now - 60 : toMinutes(app.workHours.start) - 30));
		// Open on a whole hour, so its label shows.
		el.scrollTop = Math.max(0, px(Math.floor(focus / 60) * 60));
	});
	// A newly picked task offers a day and the next quarter hour (or the
	// start of the working day); only then, so a time being typed isn't
	// overwritten.
	let offeredFor: string | null = null;
	$effect(() => {
		const key = picked?.kind === 'tray' ? picked.key : null;
		if (key === offeredFor) return;
		offeredFor = key;
		if (!key) return;
		untrack(() => {
			placeOn = hasToday ? today : dates[0]!;
			const start = toMinutes(app.workHours.start);
			placeAt = fromMinutes(snap(placeOn === today ? Math.max(now, start) : start));
		});
	});

	const hoursList = $derived(
		Array.from({ length: range.last - range.first }, (_, i) => range.first + i),
	);
	const work = $derived({
		top: px(Math.max(lo, toMinutes(app.workHours.start))),
		bottom: px(Math.min(range.last * 60, toMinutes(app.workHours.end))),
	});
	const timeOf = (b: { start: number; end: number }) =>
		`${fromMinutes(b.start)}–${fromMinutes(b.end)}`;
	/** A block's day, said in its label when the week shows. */
	const onDay = (d: string) =>
		view === 'week' ? `, ${dayName(d, { weekday: 'long', day: 'numeric', month: 'long' })}` : '';
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={onPointerUp} />

{#if drag?.moved && drag.mode === 'place' && !drag.overLine}
	{@const item = unplanned.find((i) => keyOf(i) === drag!.key)}
	{#if item}
		<div class="float" style:left="{drag.cx}px" style:top="{drag.cy}px" aria-hidden="true">
			{item.title}
		</div>
	{/if}
{/if}

<div
	class="planner"
	class:week={view === 'week'}
	class:dragging={drag?.moved}
	bind:this={root}
	bind:clientWidth={width}
>
	<div class="top">
		<nav class="day-nav" aria-label={view === 'week' ? 'Week' : 'Day'}>
			<button
				type="button"
				class="btn small icon-only"
				aria-label={view === 'week' ? 'Previous week' : 'Previous day'}
				onclick={() => (date = addDays(date, -step))}><Icon name="chevronLeft" size={16} /></button
			>
			<span class="day-label" aria-live="polite">{label}</span>
			<button
				type="button"
				class="btn small icon-only"
				aria-label={view === 'week' ? 'Next week' : 'Next day'}
				onclick={() => (date = addDays(date, step))}><Icon name="chevronRight" size={16} /></button
			>
			{#if !hasToday}<button type="button" class="btn small" onclick={() => (date = today)}
					>{view === 'week' ? 'This week' : 'Today'}</button
				>{/if}
		</nav>
		{#if canWeek}
			<div class="segmented view" role="radiogroup" aria-label="Plan by">
				<button
					type="button"
					role="radio"
					aria-checked={view === 'day'}
					onclick={() => setView('day')}>Day</button
				>
				<button
					type="button"
					role="radio"
					aria-checked={view === 'week'}
					onclick={() => setView('week')}>Week</button
				>
			</div>
		{/if}
	</div>
	<p class="totals" role="status">
		Planned <strong>{hours(totals.planned)}</strong> · free <strong>{hours(totals.free)}</strong>
		between
		{app.workHours.start} and {app.workHours.end}{view === 'week' ? ' this week' : ''}
		{#if view === 'week'}
			<button
				type="button"
				class="link fold"
				aria-pressed={expanded}
				onclick={() => (expanded = !expanded)}
				>{expanded ? 'Fold early and late hours' : 'Show early and late hours'}</button
			>
		{/if}
	</p>

	{#if view === 'day' && days[0]?.plan.allDay.length}
		<ul class="all-day" aria-label="All day">
			<li class="lbl" aria-hidden="true">All day</li>
			{#each days[0].plan.allDay as i (keyOf(i))}<li>{i.title}</li>{/each}
		</ul>
	{/if}

	<div class="body">
		<section
			class="tray"
			class:drop={drag?.overTray && drag.mode === 'move'}
			bind:this={tray}
			aria-labelledby="tray-h"
		>
			<h2 id="tray-h">To plan <span class="count">{unplanned.length}</span></h2>
			{#if unplanned.length}
				<ul>
					{#each unplanned as i (keyOf(i))}
						<li>
							<button
								type="button"
								class="task"
								aria-pressed={picked?.kind === 'tray' && picked.key === keyOf(i)}
								data-drag="place"
								data-key={keyOf(i)}
								class:lifted={drag?.moved && drag.key === keyOf(i)}
								onpointerdown={(e) => beginPlace(e, i)}
								onclick={() =>
									!justDragged &&
									(picked =
										picked?.kind === 'tray' && picked.key === keyOf(i)
											? null
											: { kind: 'tray', key: keyOf(i) })}
							>
								<span class="t">{i.title}</span>
								<span class="len"
									>{progressOf(i).planned && remainingOf(i)
										? `${hours(remainingOf(i)!)} left`
										: hours(lengthOf(i))}</span
								>
							</button>
						</li>
					{/each}
				</ul>
				<p class="hint">
					Hold a task and drag it onto {view === 'week' ? 'a day' : 'the day'}, or pick it and tap a
					time.
				</p>
			{:else}
				<p class="hint">Nothing left to plan {view === 'week' ? 'this week' : 'on this day'}.</p>
			{/if}
		</section>

		<div class="day">
			{#if pickedTray}
				<form
					class="toolbar"
					onsubmit={(e) => {
						e.preventDefault();
						place(pickedTray, view === 'week' ? placeOn : date, toMinutes(placeAt));
					}}
				>
					<span class="what">Plan “{pickedTray.title}”{view === 'week' ? ' on' : ' at'}</span>
					{#if view === 'week'}
						<label class="sr-only" for="dp-on">Day</label>
						<select id="dp-on" class="input" bind:value={placeOn}>
							{#each dates as d (d)}<option value={d}
									>{dayName(d, { weekday: 'short', day: 'numeric' })}</option
								>{/each}
						</select>
						<span class="at" aria-hidden="true">at</span>
					{/if}
					<label class="sr-only" for="dp-at">Start time</label>
					<input id="dp-at" type="time" step="900" class="input" bind:value={placeAt} />
					<button type="submit" class="btn small primary">Plan</button>
					{#if remainingOf(pickedTray)}
						<button type="button" class="btn small" onclick={() => planRest(pickedTray)}
							>Plan the rest ({hours(remainingOf(pickedTray)!)})</button
						>
					{/if}
					<button type="button" class="btn small" onclick={() => (picked = null)}>Cancel</button>
				</form>
			{:else if pickedBlock}
				{@const b = pickedBlock}
				<div
					class="toolbar"
					role="toolbar"
					aria-label={`“${b.item.title}”, ${timeOf(b)}${onDay(b.date)}`}
				>
					<span class="what"
						>{b.item.title} · {view === 'week'
							? `${dayName(b.date, { weekday: 'short' })} `
							: ''}{timeOf(b)}</span
					>
					{#if b.source !== 'appointment'}
						{#if movesDays(b)}
							<button type="button" class="btn small" onclick={() => shiftDay(b, -1)}
								>Day before</button
							>
							<button type="button" class="btn small" onclick={() => shiftDay(b, 1)}
								>Day after</button
							>
						{/if}
						<button type="button" class="btn small" onclick={() => unplan(b)}>No time</button>
						{#if remainingOf(b.item)}
							<button type="button" class="btn small" onclick={() => planRest(b.item)}
								>Plan the rest ({hours(remainingOf(b.item)!)})</button
							>
						{/if}
					{/if}
					<button
						type="button"
						class="btn small"
						onclick={() => (app.headingSheet = { path: b.item.file, pos: b.item.pos })}>Edit</button
					>
					<button
						type="button"
						class="btn small icon-only"
						aria-label="Close"
						onclick={() => (picked = null)}><Icon name="close" size={14} /></button
					>
				</div>
			{/if}

			{#if view === 'week'}
				<div class="week-head">
					<span aria-hidden="true"></span>
					{#each days as d (d.date)}
						<div class="wd" class:today={d.date === today}>
							<button
								type="button"
								class="wd-name"
								aria-label={`Open ${dayName(d.date, { weekday: 'long', day: 'numeric', month: 'long' })}`}
								onclick={() => openDay(d.date)}
							>
								<span class="dow">{dayName(d.date, { weekday: 'short' })}</span>
								<span class="dom">{dayName(d.date, { day: 'numeric' })}</span>
							</button>
							<span class="wd-total">{d.totals.planned ? hours(d.totals.planned) : '—'}</span>
							{#if d.plan.allDay.length}
								<ul class="wd-all" aria-label={`All day, ${dayName(d.date, { weekday: 'long' })}`}>
									{#each d.plan.allDay as i (keyOf(i))}<li title={i.title}>{i.title}</li>{/each}
								</ul>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<div class="scroller" bind:this={scroller}>
				{#if range.first > fullFirst}
					<button type="button" class="band" onclick={() => (expanded = true)}
						>{String(fullFirst).padStart(2, '0')}:00–{String(range.first).padStart(
							2,
							'0',
						)}:00{folded.early ? ` · ${folded.early} more` : ''}</button
					>
				{/if}
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div
					class="line"
					class:placing={!!pickedTray}
					bind:this={line}
					style:height="{(range.last - range.first) * HOUR_PX}px"
					onclick={onTimelineClick}
				>
					<div
						class="work"
						style:top="{work.top}px"
						style:height="{Math.max(0, work.bottom - work.top)}px"
					></div>
					{#each hoursList as h (h)}
						<div class="hour" style:top="{(h - range.first) * HOUR_PX}px">
							<span>{String(h).padStart(2, '0')}:00</span>
						</div>
					{/each}
					{#each dates as d, n (d)}
						<div
							class="lane"
							class:today={view === 'week' && d === today}
							class:target={drag?.moved && view === 'week' && drag.date === d && drag.overLine}
							style:left={laneLeft(n)}
							style:width={laneWidth()}
							bind:this={lanes[n]}
						></div>
					{/each}
					{#if hasToday && now >= lo && now <= range.last * 60}
						<div
							class="now"
							style:top="{px(now)}px"
							style:left={view === 'week' ? laneLeft(dates.indexOf(today)) : '3rem'}
							style:width={view === 'week' ? laneWidth() : null}
							aria-hidden="true"
						></div>
					{/if}
					{#if drag?.moved && drag.mode === 'place' && drag.overLine}
						<div
							class="block ghost"
							style:top="{px(drag.start)}px"
							style:height="{(drag.length / 60) * HOUR_PX}px"
							style:left={laneLeft(dates.indexOf(drag.date))}
							style:width="calc({laneWidth()} - 0.25rem)"
						>
							{fromMinutes(drag.start)}
						</div>
					{/if}
					{#each blocks as b (b.id)}
						{@const s = shown(b)}
						{@const n = dates.indexOf(s.date)}
						{@const top = px(Math.max(lo, s.start))}
						{@const bottom = px(Math.min(range.last * 60, s.end))}
						{#if bottom > top}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_static_element_interactions -->
							<div
								class="block"
								class:fixed={b.source === 'appointment'}
								class:short={s.end - s.start < 45}
								class:deadline={b.source === 'DEADLINE'}
								class:active={picked?.kind === 'block' && picked.key === b.id}
								role="button"
								tabindex="0"
								aria-label={`${b.item.title}, ${timeOf(s)}${onDay(b.date)}${b.source === 'appointment' ? ', appointment' : ''}${progressLabel(b.item) ? `, ${progressLabel(b.item)} planned` : ''}`}
								style:top="{top}px"
								style:height="{Math.max(20, bottom - top - 2)}px"
								style:left={laneLeft(n, s.col / s.cols)}
								style:width="calc({laneWidth(1 / s.cols)} - 2px)"
								onpointerdown={(e) => b.source !== 'appointment' && beginDrag(e, 'move', b)}
								data-drag="move"
								data-key={b.id}
								class:lifted={drag?.moved && drag.key === b.id}
								onclick={() => !justDragged && (picked = { kind: 'block', key: b.id })}
								onkeydown={(e) => onBlockKey(e, b)}
							>
								<span class="bt">{b.item.title}</span>
								<span class="bm"
									>{timeOf(s)}{#if progressLabel(b.item)}<span class="of"
											>{` · ${progressLabel(b.item)}`}</span
										>{/if}</span
								>
								{#if b.source !== 'appointment'}
									<span
										class="handle"
										aria-hidden="true"
										onpointerdown={(e) => {
											e.stopPropagation();
											beginDrag(e, 'resize', b);
										}}
									></span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
				{#if range.last < 24}
					<button type="button" class="band" onclick={() => (expanded = true)}
						>{String(range.last).padStart(2, '0')}:00–24:00{folded.late
							? ` · ${folded.late} more`
							: ''}</button
					>
				{/if}
			</div>
		</div>
	</div>
</div>

<style>
	.planner {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.planner.dragging {
		user-select: none;
		cursor: grabbing;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}
	.day-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-top: 0.25rem;
	}
	.day-label {
		min-width: 12rem;
		font-weight: 650;
		text-align: center;
	}
	.totals {
		margin: 0;
		color: var(--text-2);
		font-size: 0.88rem;
	}
	.fold {
		margin-left: 0.5rem;
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent-text, var(--accent));
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	/* The week's day headers, lined up with its lanes below. */
	.week-head {
		display: grid;
		grid-template-columns: 3.5rem repeat(7, minmax(0, 1fr)) 0.25rem;
		overflow: hidden;
		scrollbar-gutter: stable;
		border: 1px solid transparent;
	}
	.wd {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 0.15rem;
		min-width: 0;
		padding: 0 0.15rem;
	}
	.wd-name {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: 0.3rem;
		padding: 0.3rem 0.25rem;
		border: 0;
		border-radius: 8px;
		background: none;
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.wd-name:hover {
		background: var(--surface-2);
	}
	.dow {
		color: var(--text-muted);
		font-size: 0.78rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.dom {
		font-size: 1.05rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.wd.today .dom {
		color: var(--accent-text, var(--accent));
	}
	.wd-total {
		color: var(--text-faint);
		font-size: 0.72rem;
		text-align: center;
	}
	.wd-all {
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.wd-all li {
		overflow: hidden;
		padding: 0.1rem 0.35rem;
		border-radius: 6px;
		background: var(--surface-2);
		font-size: 0.72rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.lane {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px solid var(--border);
		pointer-events: none;
	}
	.lane.today {
		background: color-mix(in oklab, var(--accent-soft) 30%, transparent);
	}
	.lane.target {
		background: color-mix(in oklab, var(--accent-soft) 60%, transparent);
	}
	/* Folded early or late hours: a thin band that unfolds them. */
	.band {
		display: block;
		width: 100%;
		padding: 0.2rem 0.5rem 0.2rem 3.5rem;
		border: 0;
		border-bottom: 1px dashed var(--border-strong);
		background: var(--surface-2);
		color: var(--text-muted);
		font: inherit;
		font-size: 0.72rem;
		text-align: left;
		cursor: pointer;
	}
	.line + .band {
		border-top: 1px dashed var(--border-strong);
		border-bottom: 0;
	}
	.week .scroller {
		height: auto;
		max-height: min(75vh, 46rem);
		scrollbar-gutter: stable;
	}
	.week .body {
		grid-template-columns: minmax(0, 1fr) 14rem;
	}
	.week .now {
		right: auto;
	}
	.week .block {
		padding: 0.15rem 0.35rem;
	}
	.week .block.short {
		flex-direction: column;
		align-items: stretch;
		gap: 0;
	}
	.week .block.short .bm {
		display: none;
	}
	.all-day {
		display: flex;
		flex-wrap: wrap;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.all-day .lbl {
		padding-left: 0;
		background: none;
		color: var(--text-muted);
		font-weight: 650;
	}
	.all-day li {
		padding: 0.2rem 0.6rem;
		border-radius: 8px;
		background: var(--surface-2);
		font-size: 0.82rem;
	}
	.body {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 16rem;
		gap: 1rem;
		align-items: start;
	}
	.tray {
		order: 2;
		position: sticky;
		top: 0.5rem;
		padding: 0.75rem;
		border: 1px dashed var(--border-strong);
		border-radius: var(--radius-lg);
	}
	.tray.drop {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.tray h2 {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		margin: 0 0 0.5rem;
		font-size: 0.8rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--text-muted);
	}
	.count {
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		background: var(--surface-2);
		font-size: 0.7rem;
	}
	.tray ul {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.task {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		width: 100%;
		min-height: 2.5rem;
		padding: 0.35rem 0.6rem;
		border: 1px solid var(--border);
		border-radius: 10px;
		background: var(--surface);
		color: var(--text);
		font-size: 0.86rem;
		font-weight: 600;
		text-align: left;
		cursor: grab;
	}
	.task,
	.block {
		/* Touches here are the planner's (drag after a hold, or a swipe it scrolls). */
		touch-action: none;
		-webkit-touch-callout: none;
		-webkit-user-select: none;
		user-select: none;
	}
	.task.lifted {
		opacity: 0.45;
	}
	.block.lifted {
		z-index: 4;
		box-shadow: var(--shadow-md);
		transform: scale(1.02);
	}
	.float {
		position: fixed;
		z-index: 50;
		max-width: 14rem;
		padding: 0.45rem 0.7rem;
		border: 1px solid var(--accent);
		border-radius: 10px;
		background: var(--surface);
		box-shadow: var(--shadow-lg);
		font-size: 0.85rem;
		font-weight: 650;
		pointer-events: none;
		transform: translate(-50%, -120%);
	}
	.task[aria-pressed='true'] {
		border-color: var(--accent);
		background: var(--accent-soft);
	}
	.len {
		flex: none;
		color: var(--text-muted);
		font-size: 0.75rem;
		font-weight: 500;
	}
	.hint {
		margin: 0.5rem 0 0;
		color: var(--text-faint);
		font-size: 0.78rem;
	}
	.day {
		order: 1;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		min-width: 0;
	}
	.toolbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.35rem;
		padding: 0.5rem 0.6rem;
		border: 1px solid var(--accent);
		border-radius: 12px;
		background: var(--accent-softer, var(--accent-soft));
	}
	.toolbar .what {
		flex: 1 1 100%;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.toolbar .input {
		width: auto;
	}
	.scroller {
		height: min(70vh, 40rem);
		overflow-y: auto;
		overscroll-behavior: contain;
		border: 1px solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	.line {
		position: relative;
	}
	.line.placing {
		cursor: copy;
	}
	.work {
		position: absolute;
		left: 3.5rem;
		right: 0;
		background: color-mix(in oklab, var(--accent-soft) 35%, transparent);
	}
	.hour {
		position: absolute;
		left: 0;
		right: 0;
		border-top: 1px solid var(--border);
	}
	.hour span {
		position: absolute;
		top: 0.15rem;
		left: 0.5rem;
		color: var(--text-faint);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.now {
		position: absolute;
		left: 3rem;
		right: 0;
		z-index: 3;
		border-top: 2px solid var(--danger);
	}
	.block {
		position: absolute;
		z-index: 2;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		padding: 0.25rem 0.5rem;
		border-left: 3px solid var(--accent);
		border-radius: 8px;
		background: var(--accent-soft);
		color: var(--text);
		cursor: grab;
	}
	.block.deadline {
		border-left-color: var(--danger);
		background: var(--danger-soft);
	}
	.block.fixed {
		border-left-color: var(--text-muted);
		background: var(--surface-2);
		cursor: default;
	}
	.block.active,
	.block:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.block.ghost {
		left: 3.5rem;
		right: 0.25rem;
		border-left-style: dashed;
		opacity: 0.7;
		pointer-events: none;
		font-size: 0.78rem;
	}
	/* Under 45 minutes: title and time on one line. */
	.block.short {
		flex-direction: row;
		align-items: center;
		gap: 0.5rem;
		padding-top: 0;
		padding-bottom: 0;
	}
	.block.short .bm {
		flex: none;
	}
	.bt {
		overflow: hidden;
		font-size: 0.82rem;
		font-weight: 650;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.bm .of {
		opacity: 0.85;
	}
	.bm {
		color: var(--text-muted);
		font-size: 0.72rem;
		font-variant-numeric: tabular-nums;
	}
	.handle {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: 8px;
		cursor: ns-resize;
	}
	/* Touch: the bottom edge shows where a long press resizes. */
	@media (pointer: coarse) {
		.handle {
			left: 40%;
			right: 40%;
			bottom: 3px;
			height: 4px;
			border-radius: 999px;
			background: color-mix(in oklab, currentColor 25%, transparent);
		}
	}
	@media (max-width: 720px) {
		.body {
			grid-template-columns: minmax(0, 1fr);
		}
		.tray {
			order: 0;
			position: static;
		}
		.tray ul {
			flex-direction: row;
			flex-wrap: wrap;
		}
		.task {
			width: auto;
		}
		.scroller {
			height: 60vh;
		}
	}
</style>
