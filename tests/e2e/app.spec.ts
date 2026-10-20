import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const MYCELIAL = '8f3a2c1e-6b4d-4e2a-9c7f-1a2b3c4d5e01';
const PROJECT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12';

/** Open an app route and wait for the boot loader to get out of the way. */
async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
}

async function expectAccessible(page: Page) {
	const results = await new AxeBuilder({ page })
		.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
		.analyze();
	expect(
		results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
	).toEqual([]);
}

test('landing page links to the app and is accessible', async ({ page }) => {
	await page.goto('./');
	await expect(page.getByRole('heading', { level: 1 })).toContainText('Your second brain');
	await expectAccessible(page);
	await page.getByRole('link', { name: /Explore the demo vault/ }).click();
	await expect(page).toHaveURL(/\/app/);
});

test('a note renders with backlinks and is accessible', async ({ page }) => {
	await open(page, `app#/node/${MYCELIAL}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Mycelial networks' })).toBeVisible();
	await expect(page.getByText('Also known as')).toBeVisible();
	await expect(page.getByRole('heading', { name: /Backlinks/ }).first()).toBeVisible();
	await expectAccessible(page);
});

test('internal links navigate between notes', async ({ page }) => {
	await open(page, `app#/node/${MYCELIAL}`);
	await page.locator('.node-body').getByRole('link', { name: 'Zettelkasten' }).first().click();
	await expect(page.getByRole('heading', { level: 1, name: 'Zettelkasten' })).toBeVisible();
});

test('toggling a checkbox updates the progress cookie', async ({ page, isMobile }) => {
	await open(page, `app#/node/${PROJECT}`);
	await expect(page.locator('.cookie').first()).toHaveText('2/5');
	await page.getByRole('checkbox').nth(2).check();
	await expect(page.locator('.cookie').first()).toHaveText('3/5');
	// The edit autosaves to the working tree and waits to be committed.
	await open(page, 'app#/changes');
	// One changed file: its diff opens without a tap.
	await expect(page.getByRole('region', { name: /Diff of .*mycelium_web\.org$/ })).toContainText(
		'[X] Git sync through a stateless worker',
	);
	if (!isMobile) await expect(page.getByLabel('1 uncommitted')).toBeVisible();
});

test('completing a task stamps CLOSED', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	await page
		.getByRole('button', { name: /^TODO\. Change task state/ })
		.first()
		.click();
	await page
		.getByRole('button', { name: /^NEXT\. Change task state/ })
		.last()
		.click();
	await expect(page.getByText(/^Closed /)).toBeVisible();
});

test('search finds notes by alias', async ({ page, isMobile }) => {
	await open(page, 'app#/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	if (isMobile) await page.getByRole('button', { name: 'Search' }).click();
	else await page.keyboard.press('Control+k');
	await page.getByRole('combobox').fill('CMN');
	await expect(page.getByRole('option').first()).toContainText('The wood wide web');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'The wood wide web' })).toBeVisible();
});

test("capture appends to today's daily note", async ({ page }) => {
	await open(page, 'app#/');
	await page.getByLabel(/Capture a thought/).fill('Test capture from Playwright');
	await page.getByRole('button', { name: 'Capture', exact: true }).click();
	await page.getByRole('status').getByRole('link', { name: "today's note" }).click();
	await expect(page.getByRole('heading', { name: 'Test capture from Playwright' })).toBeVisible();
});

test('agenda lists open tasks', async ({ page }) => {
	await open(page, 'app#/agenda');
	await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Ship the design system/ })).toBeVisible();
	await expectAccessible(page);
});

test.describe('dark theme', () => {
	test.use({ colorScheme: 'dark' });

	for (const [name, path] of [
		['landing', './'],
		['home', 'app#/'],
		['note', `app#/node/${MYCELIAL}`],
		['agenda', 'app#/agenda'],
	] as const) {
		test(`${name} is accessible`, async ({ page }) => {
			await page.goto(path);
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
			await expectAccessible(page);
		});
	}
});

test('the editor saves edits and links to new notes', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const editor = page.locator('.cm-content');
	await expect(editor).toBeVisible();
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type('\nEvery edit saves. See [[Zettelk');
	await page.getByRole('option', { name: 'Zettelkasten' }).click();
	await page.keyboard.type(' and [[Fungal computing');
	await page.getByRole('option', { name: /Create “Fungal computing”/ }).click();
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await expect(page.getByText('Every edit saves.')).toBeVisible();
	await page.locator('.node-body').getByRole('link', { name: 'Fungal computing' }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Fungal computing' })).toBeVisible();
	await expect(page.locator('a:visible', { hasText: 'Mycelium Web' }).first()).toBeVisible();
});

test('heading actions set priority, tags and dates', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	const section = page.locator('.org-section', { hasText: 'Ship the design system' }).first();
	await section.getByRole('button', { name: /Edit heading/ }).click();
	await page.getByRole('radio', { name: 'B', exact: true }).click();
	await page.getByLabel('Tags', { exact: true }).fill('urgent');
	await page.keyboard.press('Enter');
	await page.getByRole('textbox', { name: 'Scheduled', exact: true }).fill('2026-11-02');
	await expect(section.getByRole('button', { name: /Scheduled Mon, Nov 2/ })).toBeVisible();
	await expect(section.locator('.htags')).toContainText('#urgent');
	await expect(section.locator('.prio')).toHaveText('B');
});

test('full-text search finds words inside notes', async ({ page }) => {
	await open(page, 'app#/search/hyphae');
	await expect(page.getByRole('status')).toContainText(/match/);
	await expect(page.locator('mark').first()).toHaveText(/hyphae/i);
	await page.getByRole('searchbox', { name: 'Search notes' }).fill('"wood wide web"');
	await expect(page.getByRole('link', { name: 'The wood wide web' }).first()).toBeVisible();
});

test('new note dialog creates a note and opens the editor', async ({ page }) => {
	await open(page, 'app#/');
	await page.keyboard.press('ControlOrMeta+k');
	await page.keyboard.type('Lichen symbiosis');
	await page.getByRole('option', { name: /Create note “Lichen symbiosis”/ }).click();
	await page.getByRole('textbox', { name: /^Tags/ }).fill('biology');
	await page.getByRole('button', { name: 'Create and edit' }).click();
	await expect(page.locator('.cm-content')).toContainText('#+title: Lichen symbiosis');
	await expect(page.locator('.cm-content')).toContainText('#+filetags: :biology:');
});

test('graph view draws the vault', async ({ page }) => {
	await open(page, 'app#/graph');
	await expect(page.getByRole('img', { name: /Link graph: \d+ notes/ })).toBeVisible();
	await page.getByText(/Notes in view/).click();
	await expect(page.getByRole('link', { name: 'Mycelial networks' }).last()).toBeVisible();
	await expectAccessible(page);
});

test('dailies page lists every daily note; home shows three', async ({ page }) => {
	await open(page, 'app#/');
	await expect(page.locator('.days li')).toHaveCount(3);
	await page.getByRole('link', { name: /^All \d+/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Dailies' })).toBeVisible();
	const entries = page.locator('.entries li');
	expect(await entries.count()).toBeGreaterThanOrEqual(3);
	await page.getByRole('searchbox', { name: 'Filter dailies' }).fill('zzzz-no-match');
	await expect(page.getByText('No daily note matches.')).toBeVisible();
	await expectAccessible(page);
});

test('fields stay at 16px or more on touch screens (no zoom on focus)', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'touch-only rule');
	await open(page, `app#/node/${PROJECT}`);
	const section = page.locator('.org-section', { hasText: 'Ship the design system' }).first();
	await section.getByRole('button', { name: /Edit heading/ }).click();
	for (const field of [
		page.getByRole('combobox', { name: 'Tags', exact: true }),
		page.locator('.actions input[type="date"]').first(),
	]) {
		const size = await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
		expect(size).toBeGreaterThanOrEqual(16);
	}
});

test('text size setting scales the app and persists', async ({ page }) => {
	await open(page, 'app#/settings');
	await page.getByRole('radio', { name: 'Largest' }).click();
	const root = () =>
		page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
	expect(await root()).toBe(24);
	await page.reload();
	// Applied by the inline head script, before the app boots.
	expect(await root()).toBe(24);
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth,
	);
	expect(overflow).toBeLessThanOrEqual(0);
	await page.getByRole('radio', { name: 'Default' }).click();
	expect(await root()).toBe(16);
});
