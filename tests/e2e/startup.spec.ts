/// Pages aren't torn down and rebuilt while the app starts up: what you type
/// straight away stays put.

import { expect, test, type Page } from '@playwright/test';
import { startGitServer, type GitServer } from '../support/git-server';

let server: GitServer;
test.beforeAll(async () => {
	server = await startGitServer('mine', { 'notes/garden.org': '#+title: My garden\n' });
});
test.afterAll(() => server?.close());

async function countFormMounts(page: Page) {
	await page.addInitScript(() => {
		const w = window as unknown as { formMounts: number };
		w.formMounts = 0;
		let present = false;
		new MutationObserver(() => {
			const now = !!document.getElementById('repo');
			if (now && !present) w.formMounts++;
			present = now;
		}).observe(document, { childList: true, subtree: true });
	});
}
const mounts = (page: Page) =>
	page.evaluate(() => (window as unknown as { formMounts: number }).formMounts);

test('a return visit keeps the page you are typing in', async ({ page }) => {
	// First visit: the demo's repository gets built in the background.
	await page.goto('app#/');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect
		.poll(() => page.evaluate(() => localStorage.getItem('mycelium:active-vault')))
		.toBe('demo');
	await page.waitForTimeout(2500);

	// Return visit, typing as soon as the form is there.
	await countFormMounts(page);
	await page.goto('app#/vaults');
	await page.reload();
	const field = page.getByRole('textbox', { name: 'Repository' });
	await field.waitFor();
	await field.fill('octo/notes');
	await page.waitForTimeout(2500);
	await expect(field).toHaveValue('octo/notes');
	// The form was put on the page once, not removed and rebuilt.
	expect(await page.evaluate(() => (window as unknown as { formMounts: number }).formMounts)).toBe(
		1,
	);
});

test('a return visit to your own vault builds the page once', async ({ page }) => {
	await page.goto('app#/vaults');
	await page.getByRole('radio', { name: 'Other' }).click();
	await page.getByRole('textbox', { name: 'Repository' }).fill(`${server.url}/mine.git`);
	await page.getByText('Advanced').click();
	await page.getByLabel('Sync proxy').fill('');
	await page.getByRole('button', { name: 'Clone and open' }).click();
	await expect(
		page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening|night)/ }),
	).toBeVisible({ timeout: 30_000 });

	await countFormMounts(page);
	await page.goto('app#/vaults');
	await page.reload();
	await page.getByRole('textbox', { name: 'Repository' }).waitFor();
	await page.waitForTimeout(2500);
	expect(await mounts(page)).toBe(1);
	await expect(page.locator('.vault.active')).toContainText('mine');
});
