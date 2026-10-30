import { expect, test, type Page } from '@playwright/test';

/** Wait until the demo vault's repository is saved in this browser (built after first paint). */
async function demoSaved(page: Page) {
	await expect
		.poll(
			() =>
				page.evaluate(
					() =>
						new Promise<number>((resolve) => {
							const req = indexedDB.open('mycelium');
							req.onsuccess = () => {
								const db = req.result;
								if (!db.objectStoreNames.contains('vaults')) return resolve(0);
								const count = db.transaction('vaults').objectStore('vaults').count();
								count.onsuccess = () => resolve(count.result);
								count.onerror = () => resolve(0);
							};
							req.onerror = () => resolve(0);
						}),
				),
			{ timeout: 20_000 },
		)
		.toBeGreaterThan(0);
}

async function openAgenda(page: Page) {
	await page.goto('app#/agenda');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await page.getByRole('radio', { name: 'List' }).click();
}

const add = async (page: Page, text: string) => {
	const field = page.getByRole('textbox', { name: 'Add a task' });
	await field.fill(text);
	await field.press('Enter');
};

test('two tabs on one vault: one edits, the other follows and can take over', async ({
	context,
	isMobile,
}) => {
	test.skip(isMobile, 'tabs side by side are a desktop matter');
	const a = await context.newPage();
	await openAgenda(a);
	await demoSaved(a);

	// A second tab opens the vault: it edits now, and the first follows.
	const b = await context.newPage();
	await openAgenda(b);
	const banner = (p: Page) => p.getByRole('status').filter({ hasText: /another tab/ });
	await expect(banner(a)).toContainText('being edited in another tab');
	await expect(banner(b)).toHaveCount(0);

	// What the editing tab saves shows in the other.
	await add(b, 'Water the ferns');
	await expect(b.locator('main')).toContainText('Water the ferns');
	await expect(a.locator('main')).toContainText('Water the ferns');

	// The following tab doesn't write: it says why, and nothing is added.
	await add(a, 'Feed the cat');
	await expect(banner(a)).toContainText('can’t be made here');
	await a.waitForTimeout(500);
	await expect(a.locator('main')).not.toContainText('Feed the cat');
	await expect(b.locator('main')).not.toContainText('Feed the cat');

	// "Edit here" takes it over, with the other tab's work kept.
	await banner(a).getByRole('button', { name: 'Edit here' }).click();
	await expect(banner(a)).toHaveCount(0);
	await expect(banner(b)).toContainText('being edited in another tab');
	await add(a, 'Repot the basil');
	await expect(a.locator('main')).toContainText('Repot the basil');
	await expect(a.locator('main')).toContainText('Water the ferns');
	await expect(b.locator('main')).toContainText('Repot the basil');

	// Both edits are in the file, neither overwrote the other.
	await a.goto(a.url().replace(/#.*/, '#/changes'));
	await expect(a.locator('main')).toContainText('* TODO Water the ferns');
	await expect(a.locator('main')).toContainText('* TODO Repot the basil');
});
