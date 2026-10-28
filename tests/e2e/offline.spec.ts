import { expect, test } from '@playwright/test';

/// The service worker keeps the app's files: with no connection, the app
/// still opens, and so do pages and parts loaded on demand.

test.use({ serviceWorkers: 'allow' });

const PROJECT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12';

test('the app opens and works with no connection', async ({ page, context }) => {
	test.setTimeout(60_000);
	await page.goto(`app#/node/${PROJECT}`);
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	// Wait until the worker has stored everything and controls the page.
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller)
			await new Promise((r) =>
				navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
			);
	});

	await context.setOffline(true);
	// Also fail anything that still reaches the network (some browser builds don't
	// apply offline mode to the service worker's own requests).
	await context.route('**/*', (route) => route.abort('internetdisconnected'));
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByRole('heading', { level: 1, name: 'Mycelium Web' })).toBeVisible();
	// Parts loaded on demand: the editor, maths and the graph.
	await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
	await expect(page.locator('.cm-content')).toBeVisible();
	await page.goto('app#/graph');
	await expect(page.getByRole('img', { name: /Link graph: \d+ notes/ })).toBeVisible();
	// Even typed straight into the address bar.
	await page.goto('app/#/agenda');
	await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
	await context.setOffline(false);
});

test('a pushed reminder shows once, even when the open app showed it already', async ({
	page,
	context,
	browserName,
}) => {
	test.skip(browserName !== 'chromium', 'delivers the push through Chromium DevTools');
	await context.grantPermissions(['notifications']);
	const cdp = await context.newCDPSession(page);
	await cdp.send('ServiceWorker.enable');
	const registration = new Promise<string>((resolve) =>
		cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
			const r = registrations.find((x) => !x.isDeleted);
			if (r) resolve(r.registrationId);
		}),
	);
	await page.goto('app#/');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	// Installed (everything stored) and in control, so it's ready for pushes.
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
		if (!navigator.serviceWorker.controller)
			await new Promise((r) =>
				navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }),
			);
	});
	const registrationId = await registration;
	const origin = new URL(page.url()).origin;
	const push = (r: object) =>
		cdp.send('ServiceWorker.deliverPushMessage', {
			origin,
			registrationId,
			data: JSON.stringify(r),
		});
	const notifications = () =>
		page.evaluate(async () =>
			(await (await navigator.serviceWorker.ready).getNotifications()).map((n) => ({
				title: n.title,
				tag: n.tag,
				silent: n.silent,
			})),
		);

	const reminder = { id: 'r1', title: 'TODO Call the bank', body: 'Due at 17:00', url: '#/agenda' };
	const recorded = () =>
		page.evaluate(async () => !!(await (await caches.open('reminders-shown')).match('/shown/r1')));
	// A push sent while the worker is still starting up can be dropped: send until it lands.
	await expect
		.poll(
			async () => {
				if (!(await recorded())) await push(reminder);
				return recorded();
			},
			{ timeout: 20_000, intervals: [1000] },
		)
		.toBe(true);
	// Headless Chromium refuses notifications whatever the permission: what's shown
	// can only be checked where they're allowed.
	if ((await page.evaluate(() => Notification.permission)) !== 'granted') {
		test
			.info()
			.annotations.push({ type: 'note', description: 'notifications not displayable here' });
		return;
	}
	await expect
		.poll(notifications, { timeout: 10_000 })
		.toEqual([{ title: 'TODO Call the bank', tag: 'r1', silent: false }]);
	// The same occurrence again (the app showed it, say): replaced quietly, not doubled.
	await push(reminder);
	await expect
		.poll(notifications, { timeout: 10_000 })
		.toEqual([{ title: 'TODO Call the bank', tag: 'r1', silent: true }]);
});
