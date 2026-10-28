import { expect, test, type Page } from '@playwright/test';

/// org-roam note tools: aliases, refs, renaming (with the links that used
/// the old title), and extracting a heading into a note of its own.

const MYCELIAL = '8f3a2c1e-6b4d-4e2a-9c7f-1a2b3c4d5e01';
const ZETTEL = '3c9d7e10-2f4b-4a8e-b1c6-7d8e9f0a1b02';
const ORG_MODE = '6c7d8e90-0a1b-4c2d-9e3f-4a5b6c7d8e08';
const CHEAT_SHEET = '6c7d8e90-0a1b-4c2d-9e3f-4a5b6c7d8e09';

async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
}
const details = (page: Page) => page.getByRole('dialog', { name: 'Note details' });

test('aliases and refs are added and removed from the note details', async ({ page }) => {
	await open(page, `app#/node/${MYCELIAL}`);
	await page.getByRole('button', { name: 'Details' }).click();
	const sheet = details(page);
	await sheet.getByLabel('New alias').fill('Hyphal web');
	await sheet.getByRole('button', { name: 'Add' }).first().click();
	await sheet.getByLabel('New ref').fill('https://en.wikipedia.org/wiki/Mycelium');
	await sheet.getByRole('button', { name: 'Add' }).last().click();
	await expect(
		sheet.getByRole('link', { name: 'https://en.wikipedia.org/wiki/Mycelium' }),
	).toBeVisible();
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(page.locator('.aliases')).toHaveText(
		'Also known as Mycelium, Fungal networks, Hyphal web',
	);

	// The palette finds it by its alias.
	await page.keyboard.press('ControlOrMeta+k');
	await page.keyboard.type('Hyphal web');
	await expect(page.getByRole('option', { name: /Mycelial networks/ }).first()).toBeVisible();
	await page.keyboard.press('Escape');

	await page.getByRole('button', { name: 'Details' }).click();
	await sheet.getByRole('button', { name: 'Remove alias Hyphal web' }).click();
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(page.locator('.aliases')).toHaveText('Also known as Mycelium, Fungal networks');
	// What's in the file, as org-roam writes it.
	await page.goto(page.url().replace(/#.*/, '#/changes'));
	await expect(page.locator('main')).toContainText(
		':ROAM_REFS: https://en.wikipedia.org/wiki/Mycelium',
	);
});

test('renaming a note updates the links that used its old title', async ({ page }) => {
	await open(page, `app#/node/${MYCELIAL}`);
	await page.getByRole('button', { name: 'Details' }).click();
	const sheet = details(page);
	await sheet.getByLabel('Title').fill('Fungal webs');
	await expect(
		sheet.getByText('Also update 4 links that say “Mycelial networks” (4 notes)'),
	).toBeVisible();
	await sheet.getByRole('button', { name: 'Rename' }).click();
	await expect(sheet.getByRole('status')).toHaveText('Renamed, and updated 4 links.');
	await sheet.getByRole('button', { name: 'Close' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Fungal webs' })).toBeVisible();
	await page.goto(page.url().replace(/#.*/, `#/node/${ZETTEL}`));
	await expect(page.locator('.node-body').getByRole('link', { name: 'Fungal webs' })).toBeVisible();
});

test('a heading is extracted into a note of its own, keeping its ID', async ({ page }) => {
	await open(page, `app#/node/${ORG_MODE}`);
	const section = page.locator('.org-section', { hasText: 'Markup cheat sheet' }).first();
	await section.getByRole('button', { name: /Edit heading/ }).click();
	await page.getByRole('button', { name: 'Extract to note' }).click();
	// The same note (its ID), now a file of its own.
	await expect(page).toHaveURL(new RegExp(`#/node/${CHEAT_SHEET}$`));
	await expect(page.getByRole('heading', { level: 1, name: 'Markup cheat sheet' })).toBeVisible();
	await expect(page.getByText(/-markup_cheat_sheet\.org/)).toBeVisible();
	// Where it was, a link to it.
	await page.goto(page.url().replace(/#.*/, `#/node/${ORG_MODE}`));
	await expect(
		page.locator('.node-body').getByRole('link', { name: 'Markup cheat sheet' }),
	).toBeVisible();
});

const PROJECT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12';

test('a long note has contents to jump to its headings', async ({ page, isMobile }) => {
	await open(page, `app#/node/${PROJECT}`);
	if (isMobile) await page.getByText('Contents').first().click();
	const contents = isMobile
		? page.locator('details.toc')
		: page.getByRole('navigation', { name: 'Contents' });
	await contents.getByRole('link', { name: 'Inspiration' }).click();
	await expect(
		page.locator('.org-section', { hasText: 'Inspiration' }).getByRole('heading').first(),
	).toBeInViewport();
});

test('the agenda week view shows each day, and remembers it', async ({ page }) => {
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'Week' }).click();
	const days = page.locator('section.day');
	await expect(days).toHaveCount(7);
	await expect(page.locator('section.day.today')).toContainText('Today');
	const label = page.locator('.week-label');
	const thisWeek = await label.textContent();
	await page.getByRole('button', { name: 'Next week' }).click();
	await expect(label).not.toHaveText(thisWeek!);
	await expect(page.locator('section.day.today')).toHaveCount(0);
	await page
		.getByRole('navigation', { name: 'Week' })
		.getByRole('button', { name: 'This week' })
		.click();
	await expect(label).toHaveText(thisWeek!);
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByRole('radio', { name: 'Week' })).toHaveAttribute('aria-checked', 'true');
	await expect(days).toHaveCount(7);
});
