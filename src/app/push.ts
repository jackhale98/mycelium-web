/// Reminders while the app is closed: this browser's push subscription, and
/// the next week's reminders sent to the sync worker, each encrypted for this
/// browser first (so the worker can't read them). Refreshed whenever the app
/// is open and notes change; the worker drops a list after 14 days without
/// a refresh.

import { WORKER_URL } from './config';
import { encryptPush, fromBase64Url, toBase64Url } from '$lib/push/encrypt';
import { remindersAhead, type ReminderSettings } from './reminders.svelte';

const WEEK = 7 * 86_400_000;
/** The worker keeps at most this many per subscription. */
const MAX = 64;

/** The worker's push key, or null when it has no reminders set up. */
export async function serverKey(): Promise<string | null> {
	try {
		const res = await fetch(`${WORKER_URL}/push/key`);
		if (!res.ok) return null;
		return ((await res.json()) as { key?: string }).key ?? null;
	} catch {
		return null;
	}
}

/** This app's service worker registration, if it has one (production builds). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
	if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
	return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function pushAvailable(): Promise<boolean> {
	return !!(await registration()) && !!(await serverKey());
}

/** Subscribe this browser and send its reminders. Throws with a reason on failure. */
export async function enablePush(settings: ReminderSettings): Promise<void> {
	const reg = await registration();
	if (!reg) throw new Error('This browser can’t receive reminders while Mycelium is closed.');
	const key = await serverKey();
	if (!key) throw new Error('The sync server doesn’t have reminders set up.');
	const existing = await reg.pushManager.getSubscription();
	const sub =
		existing ??
		(await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: fromBase64Url(key),
		}));
	await uploadPush(settings, sub);
}

/** Send the next week's reminders (replacing what the worker had). */
export async function uploadPush(
	settings: ReminderSettings,
	sub?: PushSubscription | null,
): Promise<void> {
	sub ??= await (await registration())?.pushManager.getSubscription();
	if (!sub) return;
	const p256dh = sub.getKey('p256dh');
	const auth = sub.getKey('auth');
	if (!p256dh || !auth) return;
	const list = settings.enabled ? remindersAhead(settings, WEEK).slice(0, MAX) : [];
	const reminders = await Promise.all(
		list.map(async (r) => ({
			at: r.at,
			payload: toBase64Url(
				await encryptPush(
					new TextEncoder().encode(
						JSON.stringify({ id: r.id, title: r.title, body: r.body, url: r.url }),
					),
					new Uint8Array(p256dh),
					new Uint8Array(auth),
				),
			),
		})),
	);
	const res = await fetch(`${WORKER_URL}/push/reminders`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint: sub.endpoint, reminders }),
	});
	if (!res.ok) throw new Error(`The sync server refused the reminders (${res.status}).`);
}

/** Stop: unsubscribe this browser and have the worker forget its list. */
export async function disablePush(): Promise<void> {
	const sub = await (await registration())?.pushManager.getSubscription();
	if (!sub) return;
	await fetch(`${WORKER_URL}/push/reminders`, {
		method: 'DELETE',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ endpoint: sub.endpoint }),
	}).catch(() => {});
	await sub.unsubscribe();
}
