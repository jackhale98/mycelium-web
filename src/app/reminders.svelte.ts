/// Reminders on this device: notifications for SCHEDULED and DEADLINE times
/// while Mycelium is open (even in a background tab), and a count of today's
/// and overdue tasks on the app icon. Settings are per device, not per vault.
/// With push turned on (see push.ts), the sync worker also sends them while
/// the app is closed; a notification's tag is its occurrence, and a shared
/// "shown" list (CacheStorage, which the service worker can read too) keeps
/// each one from showing twice.

import { sessionsOf, upcomingReminders, type Reminder, type ReminderSource } from '$lib/org';
import { groupAgenda } from './agenda';
import { href } from './router.svelte';
import { app, localNow } from './state.svelte';

export interface ReminderSettings {
	enabled: boolean;
	/** Minutes ahead of the time. */
	lead: number;
	scheduled: boolean;
	deadline: boolean;
	/** `HH:MM` for untimed items on their day, or null. */
	untimedAt: string | null;
	/** Today's and overdue tasks as a count on the app icon. */
	badge: boolean;
	/** Also send them while the app is closed (Web Push through the sync worker). */
	push: boolean;
}

const KEY = 'mycelium:reminders';
const DEFAULTS: ReminderSettings = {
	enabled: false,
	lead: 10,
	scheduled: true,
	deadline: true,
	untimedAt: null,
	badge: false,
	push: false,
};
/** Reminders missed by more than this (the device asleep) are skipped. */
const STALE_MS = 15 * 60_000;
const SHOWN_CACHE = 'reminders-shown';

function read(): ReminderSettings {
	try {
		return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
	} catch {
		return { ...DEFAULTS };
	}
}

/** The line a heading is on, for `?at=` links that open the note there. */
function lineOf(source: string, pos: number): string {
	let line = 1;
	for (let i = source.indexOf('\n'); i !== -1 && i < pos; i = source.indexOf('\n', i + 1))
		line += 1;
	return String(line);
}

/** Every agenda item, as reminders see it. */
export function reminderSources(): ReminderSource[] {
	const vault = app.vault;
	return vault.agenda().map((item) => {
		const source = vault.file(item.file)?.source ?? '';
		const at = lineOf(source, item.pos);
		return {
			title: item.title,
			todo: item.todo,
			scheduled: item.scheduled,
			deadline: item.deadline,
			done: vault.isDone(item.todo, item.file),
			url: item.id
				? href.node(item.id)
				: item.node
					? href.node(item.node.id, at)
					: href.file(item.file, at),
			key: `${app.activeId}|${item.file}|${item.olp.join('/')}|${item.title}`,
			sessions: sessionsOf(source, item.pos, vault.file(item.file)?.index.keywords).map(
				(x) => x.timestamp,
			),
		};
	});
}

/** Reminders for this device's settings in a window starting now. */
export function remindersAhead(s: ReminderSettings, ms: number, from = Date.now()): Reminder[] {
	return upcomingReminders(reminderSources(), {
		from,
		to: from + ms,
		lead: s.lead,
		scheduled: s.scheduled,
		deadline: s.deadline,
		untimedAt: s.untimedAt,
	});
}

/** The app's address for a hash route, for notifications to open. */
export function appUrl(hash: string): string {
	return new URL(`${import.meta.env.BASE_URL.replace(/\/?$/, '/')}app/${hash}`, location.origin)
		.href;
}

/** Whether this occurrence was shown already (here, or by a push), and mark it shown. */
/** Shown this visit (also covers browsers without CacheStorage). */
const shownHere = new Set<string>();

async function firstShowing(id: string): Promise<boolean> {
	if (shownHere.has(id)) return false;
	shownHere.add(id);
	try {
		const cache = await caches.open(SHOWN_CACHE);
		const key = `/shown/${id}`;
		if (await cache.match(key)) return false;
		await cache.put(key, new Response(String(Date.now())));
		return true;
	} catch {
		return true;
	}
}

/** Forget occurrences shown more than two days ago. */
async function pruneShown() {
	try {
		const cache = await caches.open(SHOWN_CACHE);
		for (const req of await cache.keys()) {
			const at = Number(await (await cache.match(req))?.text());
			if (!(Date.now() - at < 2 * 86_400_000)) await cache.delete(req);
		}
	} catch {
		// No CacheStorage (an insecure context): nothing to prune.
	}
}

export async function showReminder(r: Pick<Reminder, 'id' | 'title' | 'body' | 'url'>) {
	if (Notification.permission !== 'granted' || !(await firstShowing(r.id))) return;
	const options: NotificationOptions = {
		body: r.body,
		tag: r.id,
		icon: appUrl('').replace(/app\/$/, 'icons/icon-192.png'),
		data: { url: appUrl(r.url) },
	};
	const reg = await navigator.serviceWorker?.getRegistration();
	if (reg) return reg.showNotification(r.title, options);
	// No service worker (development): a page notification.
	const n = new Notification(r.title, options);
	n.onclick = () => {
		window.focus();
		location.hash = r.url;
	};
}

class Reminders {
	settings = $state<ReminderSettings>(read());
	/** Notification permission, as last seen. */
	permission = $state<NotificationPermission | 'unsupported'>(
		typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
	);

	/** Why reminders while closed last failed, if they did. */
	pushError = $state<string | null>(null);
	#pushTimer: ReturnType<typeof setTimeout> | null = null;

	update(patch: Partial<ReminderSettings>) {
		this.settings = { ...this.settings, ...patch };
		try {
			localStorage.setItem(KEY, JSON.stringify(this.settings));
		} catch {
			// Storage blocked: the setting lasts this visit.
		}
		this.queuePush();
	}

	/** Turn reminders while closed on or off for this browser. */
	async setPush(on: boolean): Promise<void> {
		this.pushError = null;
		const push = await import('./push');
		try {
			if (on) {
				if (Notification.permission !== 'granted' && !(await this.enable())) return;
				await push.enablePush(this.settings);
			} else await push.disablePush();
			this.update({ push: on });
		} catch (e) {
			this.pushError = e instanceof Error ? e.message : String(e);
		}
	}

	/** Send the worker this week's reminders soon (notes changed, or the settings). */
	queuePush(delay = 5000) {
		if (!this.settings.push) return;
		if (this.#pushTimer) clearTimeout(this.#pushTimer);
		this.#pushTimer = setTimeout(() => {
			this.#pushTimer = null;
			void import('./push')
				.then((p) => p.uploadPush(this.settings))
				.then(() => (this.pushError = null))
				.catch((e: unknown) => {
					// Offline, say: the next change or visit tries again.
					this.pushError = e instanceof Error ? e.message : String(e);
				});
		}, delay);
	}

	/** Turn reminders on: needs the browser's permission (asked on a tap). */
	async enable(): Promise<boolean> {
		if (typeof Notification === 'undefined') return false;
		const result = await Notification.requestPermission();
		this.permission = result;
		if (result !== 'granted') return false;
		this.update({ enabled: true });
		return true;
	}

	/** Check for due reminders every 20 s while the app is open. */
	/** Show what's due (in the last 15 minutes, and not shown yet). */
	check() {
		const s = this.settings;
		if (!s.enabled || this.permission !== 'granted') return;
		const now = Date.now();
		for (const r of remindersAhead(s, STALE_MS, now - STALE_MS))
			if (r.at <= now) void showReminder(r);
	}

	/** Check every 20 s while the app is open, and when it comes back into view. */
	start() {
		const tick = () => this.check();
		tick();
		const timer = setInterval(tick, 20_000);
		// Keep the worker's week of reminders fresh while the app is open.
		this.queuePush(3000);
		const refresh = setInterval(() => this.queuePush(0), 6 * 3600_000);
		const onVisible = () => {
			if (typeof Notification !== 'undefined') this.permission = Notification.permission;
			tick();
		};
		document.addEventListener('visibilitychange', onVisible);
		void pruneShown();
		// A notification tapped while the app is open: go to its note.
		const onMessage = (e: MessageEvent) => {
			const data = e.data as { type?: string; hash?: string } | null;
			if (data?.type === 'open' && data.hash?.startsWith('#/')) location.hash = data.hash;
		};
		navigator.serviceWorker?.addEventListener('message', onMessage);
		return () => {
			clearInterval(timer);
			clearInterval(refresh);
			document.removeEventListener('visibilitychange', onVisible);
			navigator.serviceWorker?.removeEventListener('message', onMessage);
		};
	}

	/** Today's and overdue tasks on the app icon, when supported and turned on. */
	badge() {
		const nav = navigator as Navigator & {
			setAppBadge?: (n?: number) => Promise<void>;
			clearAppBadge?: () => Promise<void>;
		};
		if (!nav.setAppBadge) return;
		void app.rev;
		if (!this.settings.badge) {
			void nav.clearAppBadge?.().catch(() => {});
			return;
		}
		const g = groupAgenda(app.vault, localNow().date);
		const n = g.overdue.length + g.today.length;
		void (n ? nav.setAppBadge(n) : nav.clearAppBadge?.())?.catch(() => {});
	}
}

export const reminders = new Reminders();
