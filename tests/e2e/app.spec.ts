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

test("capture adds a timestamped item to today's daily note", async ({ page }) => {
	await open(page, 'app#/');
	for (const text of ['First capture from Playwright', 'Second capture from Playwright']) {
		await page.getByLabel(/Capture a thought/).fill(text);
		await page.getByRole('button', { name: 'Capture', exact: true }).click();
	}
	await page.getByRole('status').getByRole('link', { name: "today's note" }).click();
	// Both land as list items under one "Captured" heading, not as headings of their own.
	await expect(page.getByRole('heading', { name: 'Captured' })).toHaveCount(1);
	await expect(page.getByRole('heading', { name: /capture from Playwright/ })).toHaveCount(0);
	const items = page.getByRole('listitem').filter({ hasText: /capture from Playwright/ });
	await expect(items).toHaveCount(2);
	await expect(items.first()).toContainText(/\d{4}-\d{2}-\d{2} \w{3} \d{2}:\d{2}/);
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

test('graph view draws the vault', async ({ page, isMobile }) => {
	await open(page, 'app#/graph');
	await expect(page.getByRole('img', { name: /Link graph: \d+ notes/ })).toBeVisible();
	if (isMobile) await page.getByRole('button', { name: 'Show graph options' }).click();
	await page.locator('summary:visible', { hasText: /Notes in view/ }).click();
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

test('edit a heading from the agenda: date chip and heading sheet', async ({ page }) => {
	await open(page, 'app#/agenda');
	const row = page.locator('.agenda .item', { hasText: 'Ship the design system' }).first();
	// The date chip opens the native picker; set the value as the picker would.
	await row.locator('input[type="date"]').fill('2026-11-05');
	await expect(row.getByRole('button', { name: /change due date/ })).toBeVisible();

	await row.getByRole('button', { name: /Edit “Ship the design system”/ }).click();
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	await sheet.getByRole('textbox', { name: 'Heading', exact: true }).fill('Ship the design tokens');
	await sheet.getByRole('radio', { name: 'A', exact: true }).click();
	await sheet.getByRole('button', { name: 'Done' }).click();
	await expect(sheet).toBeHidden();

	await open(page, 'app#/changes');
	const diff = page.getByRole('region', { name: /Diff of .*mycelium_web\.org$/ });
	await expect(diff).toContainText('* NEXT [#A] Ship the design tokens');
	await expect(diff).toContainText('DEADLINE: <2026-11-05 Thu>');
});

test('graph controls are a collapsible footer on phones', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'phone layout');
	await open(page, 'app#/graph');
	const toggle = page.getByRole('button', { name: 'Show graph options' });
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(page.getByRole('checkbox', { name: 'Dailies' })).toBeHidden();
	const share = await page.evaluate(() => {
		const panel = document.querySelector('.controls')!.getBoundingClientRect();
		return panel.height / innerHeight;
	});
	expect(share).toBeLessThan(0.12);
	await toggle.click();
	await expect(page.getByRole('checkbox', { name: 'Dailies' })).toBeVisible();
	await page.getByRole('button', { name: 'Hide graph options' }).click();
	await expect(page.getByRole('checkbox', { name: 'Dailies' })).toBeHidden();
});

test('rename a TODO keyword across the vault from Settings', async ({ page }) => {
	await open(page, 'app#/settings');
	const editor = page.locator('.kw-editor');
	await expect(editor.locator('pre')).toContainText('#+TODO: TODO NEXT | DONE');
	const next = editor.locator('.state', { hasText: 'NEXT' }).getByRole('textbox', { name: 'Name' });
	await next.fill('DOING');
	await expect(editor.locator('pre')).toContainText('#+TODO: TODO DOING | DONE');
	await editor.getByRole('button', { name: 'Save keywords' }).click();
	await expect(editor.getByText(/NEXT → DOING/)).toBeVisible();
	await editor.getByRole('button', { name: 'Confirm and save' }).click();
	await expect(editor.getByRole('status')).toContainText(/Updated \d+ heading/);

	await open(page, 'app#/changes');
	await expect(page.locator('.diff').first()).toContainText('DOING');
	await open(page, 'app#/agenda');
	await expect(
		page.getByRole('button', { name: /^DOING\. Change task state/ }).first(),
	).toBeVisible();
});

test('agenda filters: tags, org match strings, text and URL', async ({ page }) => {
	await open(page, 'app#/agenda');
	const titles = () => page.locator('.agenda .item .title').allInnerTexts();
	const before = await titles();
	expect(before.length).toBeGreaterThan(2);

	await page.getByRole('button', { name: /^Filters/ }).click();
	// Include a tag, then exclude it (org's + and -).
	const tagChip = page.locator('.chips button', { hasText: '#design' });
	await tagChip.click();
	expect(await titles()).toEqual(
		expect.arrayContaining([expect.stringContaining('Ship the design')]),
	);
	expect((await titles()).every((t) => t.includes('design'))).toBe(true);
	await expect(page).toHaveURL(/#\/agenda\?tag=%2Bdesign/);
	await tagChip.click();
	expect((await titles()).some((t) => t.includes('Ship the design'))).toBe(false);
	await tagChip.click();

	// An org match string: open TODOs only, and in the TODO state.
	await page.getByLabel('Match', { exact: true }).fill('/!TODO');
	await expect(page.getByRole('button', { name: /^NEXT\. Change/ })).toHaveCount(0);
	await page.getByLabel('Match', { exact: true }).fill('PRIORITY=');
	await expect(page.getByRole('alert')).toContainText(/Expected a value/);
	await page.getByLabel('Match', { exact: true }).fill('');

	// The text filter is a case-insensitive regexp.
	await page.getByRole('searchbox', { name: /Filter by text/ }).fill('flash|graph');
	await expect(page.locator('.agenda .item')).toHaveCount(2);

	// Filters survive a reload through the URL.
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.locator('.agenda .item')).toHaveCount(2);
	await page.keyboard.press('|');
	expect((await titles()).length).toBe(before.length);
});

test('agenda views can be named, saved, renamed and opened from the palette', async ({ page }) => {
	await open(page, 'app#/agenda');
	const all = await page.locator('.agenda .item').count();
	await page.getByRole('searchbox', { name: /Filter by text/ }).fill('flash|graph');
	await expect(page.locator('.agenda .item')).toHaveCount(2);
	await page.getByRole('button', { name: 'Save view…' }).click();
	await page.getByLabel('View name').fill('Field work');
	await page.getByRole('button', { name: 'Save', exact: true }).click();
	const view = page.getByRole('button', { name: 'Field work', exact: true });
	await expect(view).toHaveAttribute('aria-pressed', 'true');

	await page.getByRole('button', { name: 'Rename Field work' }).click();
	await page.getByLabel('View name').fill('Lab');
	await page.keyboard.press('Enter');
	const lab = page.getByRole('button', { name: 'Lab', exact: true });
	await expect(lab).toBeVisible();

	// Clear the filters, then return through the saved view and the palette.
	await page.getByRole('button', { name: 'Clear', exact: true }).click();
	await expect(page.locator('.agenda .item')).toHaveCount(all);
	await lab.click();
	await expect(page.locator('.agenda .item')).toHaveCount(2);
	await page.keyboard.press('|');
	await page.keyboard.press('ControlOrMeta+k');
	await page.keyboard.type('Agenda: Lab');
	await page.keyboard.press('Enter');
	await expect(page.locator('.agenda .item')).toHaveCount(2);
	await expectAccessible(page);

	// Saved views belong to the vault, so they survive a reload with no filter in the URL.
	await open(page, 'app#/agenda');
	await page.reload();
	await expect(lab).toBeVisible();
	await lab.click();
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Delete Lab' }).click();
	await expect(lab).toHaveCount(0);
});

test('lists continue on Enter and indent with Tab in the editor', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const editor = page.locator('.cm-content');
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	const last = (n: number) =>
		expect.poll(async () =>
			(await editor.locator('.cm-line').allInnerTexts()).slice(-n).map((t) => t.trimEnd()),
		);
	await page.keyboard.type('\n- [ ] milk');
	await page.keyboard.press('Enter');
	await last(1).toEqual(['- [ ]']);
	await page.keyboard.type('oat');
	await page.keyboard.press('Tab');
	await last(1).toEqual(['  - [ ] oat']);
	await page.keyboard.press('Enter');
	await last(1).toEqual(['  - [ ]']);
	await page.keyboard.type('eggs');
	await page.keyboard.press('Shift+Tab');
	await last(1).toEqual(['- [ ] eggs']);
	await page.keyboard.press('Enter');
	await last(1).toEqual(['- [ ]']);
	await page.keyboard.press('Enter');
	await last(1).toEqual(['']);
	await page.keyboard.type('done');
	await last(4).toEqual(['- [ ] milk', '  - [ ] oat', '- [ ] eggs', 'done']);
});

test('a page whose code vanished in a deploy reloads, then explains instead of going blank', async ({
	page,
}) => {
	await open(page, 'app#/');
	// The old build's chunk is gone after a deploy.
	await page.route('**/_astro/SettingsView.*.js', (r) => r.fulfill({ status: 404 }));
	const reloaded = page.waitForEvent('load');
	await page.goto('app#/settings');
	await reloaded;
	await expect(page.getByRole('heading', { name: "This page didn't load" })).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();
	// Once the new build is reachable, reloading recovers. (Checked with a plain reload: while the
	// app is still starting up the page may also retry on its own.)
	await page.unroute('**/_astro/SettingsView.*.js');
	await page.reload();
	await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible({
		timeout: 15_000,
	});
});

test('phones scroll the page itself, so long pages reach the bottom', async ({ page }) => {
	test.skip((page.viewportSize()?.width ?? 0) > 960, 'phone layout only');
	await open(page, 'app#/settings');
	await page.getByRole('button', { name: 'Remove vault' }).scrollIntoViewIfNeeded();
	const state = await page.evaluate(() => ({
		page: window.scrollY,
		main: document.querySelector('main')!.scrollTop,
		overflow: getComputedStyle(document.querySelector('main')!).overflowY,
	}));
	expect(state.page).toBeGreaterThan(0);
	expect(state.main).toBe(0);
	expect(state.overflow).toBe('visible');
	await expect(page.getByRole('button', { name: 'Remove vault' })).toBeInViewport();
	// A new page starts at the top.
	await page.goto('app#/agenda');
	await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
});

test('org tables render with caption, header, groups and alignment', async ({ page }) => {
	await open(page, 'app#/node/b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d13');
	const table = page.locator('table#reading-log');
	await expect(table.locator('caption')).toHaveText('Pages read this year');
	await expect(table.locator('thead th')).toHaveText(['Book', 'Author', 'Pages', 'Read', 'Status']);
	// The cookie row is hidden; two row groups split by the rule before the total.
	await expect(table.locator('tbody')).toHaveCount(2);
	await expect(table.getByText('<l20>')).toHaveCount(0);
	await expect(table.locator('tbody tr').first().locator('td').nth(2)).toHaveCSS(
		'text-align',
		'right',
	);
	await expect(table.locator('tbody tr').first().locator('td').nth(4)).toHaveCSS(
		'text-align',
		'center',
	);
	await expectAccessible(page);
});

test('heading fold buttons stay on screen and work', async ({ page, isMobile }) => {
	await open(page, `app#/node/${PROJECT}`);
	const fold = page.getByRole('button', { name: 'Collapse section' }).first();
	await expect(fold).toBeVisible();
	const box = (await fold.boundingBox())!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.width).toBeGreaterThanOrEqual(24);
	// Desktop reveals it on hover; touch screens always show it.
	if (isMobile)
		expect(await fold.evaluate((el) => Number(getComputedStyle(el).opacity))).toBeGreaterThan(0.5);
	else await fold.hover();
	await fold.click();
	await expect(page.getByRole('button', { name: 'Expand section' }).first()).toBeVisible();
});
