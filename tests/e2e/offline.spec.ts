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
