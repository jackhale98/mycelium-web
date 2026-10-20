import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const MYCELIAL = '8f3a2c1e-6b4d-4e2a-9c7f-1a2b3c4d5e01';
const PROJECT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12';

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
	await page.goto(`app#/node/${MYCELIAL}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Mycelial networks' })).toBeVisible();
	await expect(page.getByText('Also known as')).toBeVisible();
	await expect(page.getByRole('heading', { name: /Backlinks/ }).first()).toBeVisible();
	await expectAccessible(page);
});

test('internal links navigate between notes', async ({ page }) => {
	await page.goto(`app#/node/${MYCELIAL}`);
	await page.locator('.node-body').getByRole('link', { name: 'Zettelkasten' }).first().click();
	await expect(page.getByRole('heading', { level: 1, name: 'Zettelkasten' })).toBeVisible();
});

test('toggling a checkbox updates the progress cookie', async ({ page, isMobile }) => {
	await page.goto(`app#/node/${PROJECT}`);
	await expect(page.locator('.cookie').first()).toHaveText('2/5');
	await page.getByRole('checkbox').nth(2).check();
	await expect(page.locator('.cookie').first()).toHaveText('3/5');
	// The sync status lives in the sidebar, which is a closed drawer on phones.
	if (!isMobile)
		await expect(page.getByRole('status').filter({ hasText: 'in this tab' })).toContainText(
			'1 edit in this tab',
		);
});

test('completing a task stamps CLOSED', async ({ page }) => {
	await page.goto(`app#/node/${PROJECT}`);
	await page
		.getByRole('button', { name: /^TODO\. Change task state/ })
		.first()
		.click();
	await page
		.getByRole('button', { name: /^NEXT\. Change task state/ })
		.last()
		.click();
	await expect(page.locator('.plan.closed')).toBeVisible();
});

test('search finds notes by alias', async ({ page, isMobile }) => {
	await page.goto('app#/');
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	if (isMobile) await page.getByRole('button', { name: 'Search' }).click();
	else await page.keyboard.press('Control+k');
	await page.getByRole('combobox').fill('CMN');
	await expect(page.getByRole('option').first()).toContainText('The wood wide web');
	await page.keyboard.press('Enter');
	await expect(page.getByRole('heading', { level: 1, name: 'The wood wide web' })).toBeVisible();
});

test("capture appends to today's daily note", async ({ page }) => {
	await page.goto('app#/');
	await page.getByLabel(/Capture a thought/).fill('Test capture from Playwright');
	await page.getByRole('button', { name: 'Capture', exact: true }).click();
	await page.getByRole('status').getByRole('link', { name: "today's note" }).click();
	await expect(page.getByRole('heading', { name: 'Test capture from Playwright' })).toBeVisible();
});

test('agenda lists open tasks', async ({ page }) => {
	await page.goto('app#/agenda');
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
