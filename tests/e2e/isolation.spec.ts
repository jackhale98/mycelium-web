/// A cloned vault shows only its own notes, never the demo's.

import { expect, test } from '@playwright/test';
import { startGitServer, type GitServer } from '../support/git-server';

let server: GitServer;
test.beforeAll(async () => {
	server = await startGitServer('mine', {
		'notes/garden.org':
			':PROPERTIES:\n:ID:       11111111-2222-4333-8444-555555555555\n:END:\n#+title: My garden\n\n* TODO Water the tomatoes\nSCHEDULED: <2026-10-20 Tue>\n',
	});
});
test.afterAll(() => server?.close());

test('a cloned vault shows only its own notes', async ({ page }) => {
	// Go straight to connecting, while the demo is still being set up in the background.
	await page.goto('app#/vaults');
	await page.getByRole('radio', { name: 'Other' }).click();
	await page.getByRole('textbox', { name: 'Repository' }).fill(`${server.url}/mine.git`);
	await page.getByText('Advanced').click();
	await page.getByLabel('Sync proxy').fill('');
	await page.getByRole('button', { name: 'Clone and open' }).click();
	await expect(
		page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening|night)/ }),
	).toBeVisible({ timeout: 30_000 });
	// Straight after cloning, before navigating anywhere.
	const shown = (await page.locator('main, aside').allInnerTexts()).join('\n');
	for (const demo of [
		'Mycelial networks',
		'Zettelkasten',
		'Ship the design system',
		'Spaced repetition',
	])
		expect(shown, `${demo} is from the demo vault`).not.toContain(demo);
	expect(shown).toContain('My garden');

	const check = async () => {
		await page.goto('app#/agenda');
		await expect(page.getByText('Water the tomatoes').first()).toBeVisible();
		await expect(page.getByText('Ship the design system')).toHaveCount(0);
		await page.goto('app#/search?q=mycelial');
		await expect(page.getByRole('link', { name: 'Mycelial networks' })).toHaveCount(0);
		await page.goto('app#/graph');
		await expect(page.getByText(/1 notes?\b/).first()).toBeVisible();
	};
	await check();
	// Give the idle-time demo setup every chance to run, then reload, watching the
	// screen from the first paint: the demo must never appear while the vault loads.
	await page.waitForTimeout(3000);
	await page.addInitScript(() => {
		const w = window as unknown as { sawDemo: string[] };
		w.sawDemo = [];
		const look = () => {
			const text = document.body?.innerText ?? '';
			for (const s of ['Mycelial networks', 'Zettelkasten', 'exploring the demo vault'])
				if (text.includes(s) && !w.sawDemo.includes(s)) w.sawDemo.push(s);
		};
		new MutationObserver(look).observe(document, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	});
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	expect(await page.evaluate(() => (window as unknown as { sawDemo: string[] }).sawDemo)).toEqual(
		[],
	);
	await check();
});
