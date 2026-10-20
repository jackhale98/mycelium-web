/// A failed attempt to add a repository leaves the open vault alone.

import { expect, test } from '@playwright/test';
import { startGitServer, type GitServer } from '../support/git-server';

let mine: GitServer;
let locked: GitServer;
test.beforeAll(async () => {
	mine = await startGitServer('mine', {
		'notes/garden.org':
			':PROPERTIES:\n:ID:       11111111-2222-4333-8444-555555555555\n:END:\n#+title: My garden\n\n* TODO Water the tomatoes\nSCHEDULED: <2026-10-20 Tue>\n',
	});
	locked = await startGitServer(
		'private',
		{ 'notes/x.org': '#+title: Secret\n' },
		{ auth: 'x-bitbucket-api-token-auth:right' },
	);
});
test.afterAll(() => {
	mine?.close();
	locked?.close();
});

async function connect(page: import('@playwright/test').Page, url: string, token = '') {
	await page.goto('app#/vaults');
	await page.getByRole('radio', { name: 'Other' }).click();
	await page.getByRole('textbox', { name: 'Repository' }).fill(url);
	if (token) await page.getByLabel(/Access token/).fill(token);
	await page.getByText('Advanced').click();
	await page.getByLabel('Sync proxy').fill('');
	await page.getByRole('button', { name: 'Clone and open' }).click();
}

test('a rejected token keeps the open vault and the form', async ({ page }) => {
	await connect(page, `${mine.url}/mine.git`);
	await expect(
		page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening|night)/ }),
	).toBeVisible({ timeout: 30_000 });

	await connect(page, `${locked.url}/private.git`, 'wrong');
	await expect(page.getByRole('alert').first()).toBeVisible({ timeout: 30_000 });
	// Still on the form with what was typed, so the token can be corrected.
	await expect(page.getByRole('textbox', { name: 'Repository' })).toHaveValue(
		`${locked.url}/private.git`,
	);
	// The vault that was open is still open, in the list and on every page.
	await expect(page.locator('.vault.active')).toContainText('mine');
	await page.goto('app#/agenda');
	await expect(page.getByText('Water the tomatoes').first()).toBeVisible();
});
