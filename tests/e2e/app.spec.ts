import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const MYCELIAL = '8f3a2c1e-6b4d-4e2a-9c7f-1a2b3c4d5e01';
const PROJECT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12';

/** Open an app route and wait for the boot loader to get out of the way. */
async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
}

/** The editor shows plain source (no live preview), for tests reading its lines. */
const sourceMode = (page: Page) =>
	page.addInitScript(() => localStorage.setItem('mycelium:editor-mode', 'source'));

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
		await expect(
			page.getByRole('status').filter({ hasText: "Saved to today's note" }),
		).toBeVisible();
	}
	await page.getByRole('status').getByRole('link', { name: 'Open' }).click();
	// Both land as list items under one "Captured" heading, not as headings of their own.
	await expect(page.getByRole('heading', { name: 'Captured' })).toHaveCount(1);
	await expect(page.getByRole('heading', { name: /capture from Playwright/ })).toHaveCount(0);
	const items = page.getByRole('listitem').filter({ hasText: /capture from Playwright/ });
	await expect(items).toHaveCount(2);
	await expect(items.first()).toContainText(/\d{4}-\d{2}-\d{2} \w{3} \d{2}:\d{2}/);
});

test('the capture sheet picks templates by key and writes a task', async ({ page }) => {
	await open(page, 'app#/');
	await page.keyboard.press('ControlOrMeta+Alt+KeyC');
	const sheet = page.getByRole('dialog', { name: 'Capture' });
	await expect(sheet).toBeVisible();
	// org-capture's menu keys: "t" picks Task when not typing in a field.
	await sheet.getByRole('radio', { name: /Note/ }).focus();
	await page.keyboard.press('t');
	await expect(sheet.getByRole('radio', { name: /Task/ })).toHaveAttribute('aria-checked', 'true');
	// Tasks go to the inbox, each a top-level item to decide later.
	await expect(sheet.getByText(/To inbox\.org/)).toBeVisible();
	await sheet.getByRole('textbox', { name: 'Text' }).fill('Prune the apple tree');
	await sheet.getByText('Preview').click();
	await expect(sheet.locator('pre')).toHaveText('* TODO Prune the apple tree');
	await page.keyboard.press('ControlOrMeta+Enter');
	await expect(sheet).toBeHidden();
	await page.getByRole('status').getByRole('link', { name: 'Open' }).click();
	await expect(
		page.locator('.org-section', { hasText: 'Prune the apple tree' }).first(),
	).toBeVisible();
	await expectAccessible(page);
});

test('a custom template with prompts writes into a file under a heading', async ({ page }) => {
	await open(page, 'app#/settings/capture');
	await page.getByRole('button', { name: 'Add template' }).click();
	const tpl = page.locator('.tpl').last();
	await tpl.getByLabel('Name').fill('Call');
	await tpl.getByLabel('Key').fill('c');
	await tpl.getByLabel('Into').selectOption('file');
	await tpl.getByLabel(/File/).fill('inbox.org');
	await tpl.getByLabel('Under heading').fill('Calls');
	await tpl.getByLabel('Template').fill('* TODO Call %^{Who|Sam|Alex} %^g\n%?');
	await expect(tpl.locator('pre')).toContainText('* TODO Call Sam :tag:');
	await page.getByRole('button', { name: 'Save templates' }).click();
	await expect(page.getByText('Capture templates saved')).toBeVisible();

	await page.keyboard.press('ControlOrMeta+k');
	await page.keyboard.type('Capture: Call');
	await page.keyboard.press('Enter');
	const sheet = page.getByRole('dialog', { name: 'Capture' });
	await expect(sheet.getByLabel('Who')).toHaveValue('Sam');
	await sheet.getByLabel('Who').fill('Alex');
	await sheet.getByLabel('Tags').fill('phone, errands');
	await sheet.getByRole('textbox', { name: 'Text' }).fill('About the budget');
	await sheet.getByRole('button', { name: 'Capture', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'Saved to' })).toBeVisible();
	await page.getByRole('status').getByRole('link', { name: 'Open' }).click();
	await expect(page).toHaveURL(/#\/file\/inbox\.org(\?at=\d+)?$/);
	await expect(page.getByText('Call Alex').first()).toBeVisible();

	// The task shows on the agenda, and the diff shows exactly what was written.
	await page.goto('app#/agenda');
	await expect(page.getByText('Call Alex').first()).toBeVisible();
	await page.goto('app#/changes');
	const row = page.getByRole('button', { name: /inbox\.org/ }).first();
	if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
	const diff = page.getByRole('region', { name: 'Diff of inbox.org' });
	await expect(diff).toContainText('* Calls');
	await expect(diff).toContainText('** TODO Call Alex :phone:errands:');
	await expect(diff).toContainText('About the budget');
});

test('home card links fit on one line inside their cards', async ({ page }) => {
	await open(page, 'app#/');
	for (const link of await page.locator('.card-head a.more').all()) {
		const box = (await link.boundingBox())!;
		const card = (await link.locator('xpath=ancestor::section[1]').boundingBox())!;
		expect(box.x + box.width).toBeLessThanOrEqual(card.x + card.width);
		expect(box.height).toBeLessThan(30);
	}
});

test('on phones the capture sheet stays above the on-screen keyboard', async ({ page }) => {
	test.skip((page.viewportSize()?.width ?? 0) > 720, 'phone layout only');
	await open(page, 'app#/');
	await page.keyboard.press('ControlOrMeta+Alt+KeyC');
	const sheet = page.getByRole('dialog', { name: 'Capture' });
	await expect(sheet).toBeVisible();
	// Simulate iOS: a keyboard covers the bottom 45% and the page isn't resized.
	const visible = await page.evaluate(() => {
		const vv = window.visualViewport!;
		const h = Math.round(window.innerHeight * 0.55);
		Object.defineProperty(vv, 'height', { configurable: true, get: () => h });
		Object.defineProperty(vv, 'offsetTop', { configurable: true, get: () => 0 });
		vv.dispatchEvent(new Event('resize'));
		return h;
	});
	await expect
		.poll(async () => {
			const box = (await sheet.boundingBox())!;
			return box.y >= 0 && box.y + box.height <= visible + 1;
		})
		.toBe(true);
	await expect(sheet.getByRole('heading', { name: 'Capture' })).toBeInViewport();
	await expect(sheet.getByRole('button', { name: 'Capture', exact: true })).toBeInViewport();
});

test('files without an ID open on their own page and can become notes', async ({ page }) => {
	// From the agenda: a task in inbox.org (which has no :ID:).
	await open(page, 'app#/agenda');
	await page
		.getByRole('link', { name: /Email Sam about the reading group/ })
		.first()
		.click();
	await expect(page).toHaveURL(/#\/file\/inbox\.org(\?at=\d+)?$/);
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await expect(page.getByText('Email Sam about the reading group').first()).toBeVisible();
	await expectAccessible(page);

	// From the palette, by name.
	await open(page, 'app#/');
	await page.keyboard.press('ControlOrMeta+k');
	await page.keyboard.type('inbox');
	await page.getByRole('option', { name: /Inbox.*inbox\.org/ }).click();
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();

	// Editing works as on a note.
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(page.locator('.cm-content')).toContainText('#+title: Inbox');
	await page.getByRole('button', { name: 'Read', exact: true }).click();

	// Make it a note: an :ID: drawer goes at the top, and its note page opens.
	await page.getByRole('button', { name: 'Make this a note' }).click();
	await expect(page).toHaveURL(/#\/node\//);
	await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
	await page.goto('app#/changes');
	const row = page.getByRole('button', { name: /inbox\.org/ }).first();
	if ((await row.getAttribute('aria-expanded')) !== 'true') await row.click();
	await expect(page.getByRole('region', { name: 'Diff of inbox.org' })).toContainText(':ID:');
});

test('the cursor starts in the first empty field of a template', async ({ page }) => {
	await open(page, 'app#/');
	await page.keyboard.press('ControlOrMeta+Alt+KeyC');
	const sheet = page.getByRole('dialog', { name: 'Capture' });
	await expect(sheet.getByRole('textbox', { name: 'Text' })).toBeFocused();
	await sheet.getByRole('radio', { name: /New note/ }).click();
	await expect(sheet.getByRole('textbox', { name: 'Title' })).toBeFocused();
	await sheet.getByRole('radio', { name: /Journal/ }).click();
	await expect(sheet.getByRole('textbox', { name: 'Title' })).toBeFocused();
	await page.keyboard.type('Morning');
	await sheet.getByRole('radio', { name: /Task/ }).click();
	await expect(sheet.getByRole('textbox', { name: 'Text' })).toBeFocused();
});

test('settings export to a file and import back, section by section', async ({ page }) => {
	await open(page, 'app#/settings/capture');
	// A custom template to carry across.
	await page.getByRole('button', { name: 'Add template' }).click();
	await page.locator('.tpl').last().getByLabel('Name').fill('Reading');
	await page.getByRole('button', { name: 'Save templates' }).click();
	await expect(page.getByText('Capture templates saved')).toBeVisible();

	const tab = (name: string) =>
		page.getByRole('navigation', { name: 'Settings sections' }).getByRole('link', { name }).click();
	await tab('About');
	const download = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export settings' }).click();
	const file = await download;
	expect(file.suggestedFilename()).toMatch(/^mycelium-settings-.*\.json$/);
	const text = await (
		await file.createReadStream()
	)
		.toArray()
		.then((c) => Buffer.concat(c).toString());
	const json = JSON.parse(text);
	expect(json.format).toBe('mycelium-settings');
	expect(json.capture.templates.map((t: { name: string }) => t.name)).toContain('Reading');
	expect(text).not.toMatch(/token|credentials/);

	// Back to defaults, then bring only the templates back.
	await tab('Capture');
	page.once('dialog', (d) => d.accept());
	await page.getByRole('button', { name: 'Reset to defaults' }).click();
	await expect(page.locator('.tpl').getByLabel('Name').last()).not.toHaveValue('Reading');
	await tab('About');
	await page.getByLabel('Settings file to import').setInputFiles({
		name: 'mine.json',
		mimeType: 'application/json',
		buffer: Buffer.from(text),
	});
	const dialog = page.getByRole('group', { name: 'Import from mine.json' });
	for (const box of await dialog.getByRole('checkbox').all()) await box.uncheck();
	await dialog.getByRole('checkbox', { name: /Capture templates/ }).check();
	await dialog.getByRole('button', { name: 'Import' }).click();
	await expect(page.getByText('Imported 1 section from mine.json.')).toBeVisible();
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await tab('Capture');
	await expect(page.locator('.tpl').getByLabel('Name').last()).toHaveValue('Reading');

	// A file that isn't valid says why.
	await tab('About');
	await page.getByLabel('Settings file to import').setInputFiles({
		name: 'bad.json',
		mimeType: 'application/json',
		buffer: Buffer.from('{"format":"something-else"}'),
	});
	await expect(page.getByRole('alert')).toContainText("isn't a Mycelium settings file");
	await expectAccessible(page);
});

test('on phones, swiping up on the search button opens capture; a tap still searches', async ({
	page,
}) => {
	test.skip((page.viewportSize()?.width ?? 0) > 960, 'phone layout only');
	await open(page, 'app#/');
	const button = page.getByRole('button', { name: 'Search', exact: true });
	const box = (await button.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await button.dispatchEvent('pointerdown', {
		clientX: x,
		clientY: y,
		pointerId: 1,
		isPrimary: true,
	});
	for (const dy of [10, 25, 45])
		await button.dispatchEvent('pointermove', {
			clientX: x,
			clientY: y - dy,
			pointerId: 1,
			isPrimary: true,
		});
	await button.dispatchEvent('pointerup', {
		clientX: x,
		clientY: y - 45,
		pointerId: 1,
		isPrimary: true,
	});
	await button.dispatchEvent('click');
	await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible();
	await expect(
		page.getByRole('dialog', { name: 'Capture' }).getByRole('textbox', { name: 'Text' }),
	).toBeFocused();
	await page.keyboard.press('Escape');
	await button.click();
	await expect(page.getByRole('combobox').first()).toBeVisible();
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
	await section.getByRole('button', { name: /Edit heading/ }).press('Enter');
	await page.getByRole('radio', { name: 'B', exact: true }).click();
	await page.getByLabel('Tags', { exact: true }).fill('urgent');
	await page.keyboard.press('Enter');
	await page.getByRole('textbox', { name: 'Scheduled', exact: true }).fill('2026-11-02');
	await expect(section.getByRole('button', { name: /Scheduled Mon, Nov 2/ })).toBeVisible();
	await expect(section.locator('.htags')).toContainText('#urgent');
	await expect(section.locator('.prio')).toHaveText('B');
});

test('clocking in and out writes an org CLOCK line into the LOGBOOK', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	const section = page.locator('.org-section', { hasText: 'Ship the design system' }).first();
	await section.getByRole('button', { name: /Edit heading/ }).press('Enter');
	await page.getByRole('button', { name: 'Clock in' }).click();
	const bar = page.locator('.clockbar');
	await expect(bar).toContainText('Ship the design system');
	// A tap that lands on Stop as the bar appears (pushing the page down) is ignored.
	await bar.getByRole('button', { name: 'Stop' }).dispatchEvent('click');
	await expect(bar).toContainText('Ship the design system');
	// Clocking in elsewhere stops (and records) the running clock.
	await page.keyboard.press('Escape');
	const other = page.locator('.org-section', { hasText: 'Write the self-hosting guide' }).first();
	await other.getByRole('button', { name: /Edit heading/ }).press('Enter');
	await expect(page.getByText('Stops and records “Ship the design system”')).toBeVisible();
	await page.getByRole('button', { name: 'Clock in' }).click();
	await expect(bar).toContainText('Write the self-hosting guide');
	// Cancel discards it, and can be undone; Stop records it.
	await page.waitForTimeout(1100); // the bar's buttons wait a moment after it appears
	await bar.getByRole('button', { name: 'Cancel' }).click();
	await expect(bar).toContainText('Clock cancelled');
	await bar.getByRole('button', { name: 'Undo' }).click();
	await expect(bar).toContainText('Write the self-hosting guide');
	await page.waitForTimeout(1100);
	await bar.getByRole('button', { name: 'Cancel' }).click();
	await bar.getByRole('button', { name: 'Dismiss' }).click();
	await expect(bar).toHaveCount(0);
	await page.keyboard.press('Escape');
	// What was written to the file, as the Changes page's diff shows it (the editor
	// would show only the lines in view).
	await page.goto(page.url().replace(/#.*/, '#/changes'));
	const diff = page.locator('main');
	await expect(diff).toContainText(':LOGBOOK:');
	await expect(diff).toContainText(
		/CLOCK: \[\d{4}-\d\d-\d\d \w{3} \d\d:\d\d\]--\[\d{4}-\d\d-\d\d \w{3} \d\d:\d\d\] => +\d+:\d\d/,
	);
});

test('archiving a heading moves it to the archive file', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	const section = page.locator('.org-section', { hasText: 'Ship the design system' }).first();
	await section.getByRole('button', { name: /Edit heading/ }).press('Enter');
	await page.getByRole('button', { name: 'Archive', exact: true }).click();
	await expect(page.locator('.org-section', { hasText: 'Ship the design system' })).toHaveCount(0);
	await page.goto('app#/changes');
	await expect(page.getByText(/mycelium_web\.org_archive/).first()).toBeVisible();
});

test('LaTeX maths renders with KaTeX', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type('\nEnergy is \\(E = mc^2\\) here.\n');
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await expect(page.locator('.node-body .katex').first()).toBeVisible();
});

test('a numbered checklist keeps its numbers when reading', async ({ page }) => {
	// Today's daily in the demo has one.
	await open(page, 'app#/node/d0a1b2c3-0000-4000-8000-202610200001');
	const list = page.locator('main ol.checklist', { hasText: 'Pack the hand lens' });
	await expect(list.locator('.num')).toHaveText(['1.', '2.', '3.']);
	await expect(list.getByRole('checkbox')).toHaveCount(3);
	await expect(list.getByRole('checkbox').first()).toBeChecked();
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
	// Live preview: the title shows without its `#+title:` (the line's text is unchanged).
	await expect(page.locator('.cm-content')).toContainText('Lichen symbiosis');
	await expect(page.locator('.cm-content')).not.toContainText('#+title:');
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
	await section.getByRole('button', { name: /Edit heading/ }).press('Enter');
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

	await row.getByRole('button', { name: /Edit “Ship the design system”/ }).press('Enter');
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
	await open(page, 'app#/settings/tasks');
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
	await sourceMode(page);
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

test('live preview hides markup away from the cursor; checkboxes tick; Source shows it all', async ({
	page,
}) => {
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const editor = page.locator('.cm-content');
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText('\n- [ ] eggs, *fresh* ones\n\\(x^2\\) here\nend');
	const line = editor.locator('.cm-line', { hasText: 'eggs' });
	// The cursor is on the last line: the item shows a dot, a box, and no stars.
	await expect(line).toHaveText('•  eggs, fresh ones');
	await expect(line.locator('.cm-org-dot')).toHaveCount(1);
	await expect(editor.locator('.cm-tex-shown math')).toHaveCount(1, { timeout: 10_000 });
	// Ticking the box writes [X] into the note.
	await line.locator('input.cm-org-box').click();
	await expect(line.locator('input.cm-org-box')).toBeChecked();
	// Markup shows piece by piece, where the cursor is.
	await line.getByText('fresh').click();
	await expect(line).toHaveText('•  eggs, *fresh* ones');

	await page.goto(page.url().replace(/#.*/, '#/settings'));
	await page.getByRole('radio', { name: 'Source' }).click();
	await page.goBack();
	// (Still editing: the note reopens in the editor.)
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	await expect(editor.locator('.cm-line', { hasText: 'eggs' })).toHaveText(
		'- [X] eggs, *fresh* ones',
	);
	await expect(editor).toContainText('#+title:');
	await expect(editor.locator('.cm-tex-shown')).toHaveCount(0);
});

test('the formatting bar shapes the line, and reading keeps line breaks', async ({ page }) => {
	await sourceMode(page);
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const editor = page.locator('.cm-content');
	await editor.click();
	await page.keyboard.press('ControlOrMeta+End');
	const bar = page.getByRole('toolbar', { name: 'Formatting' });
	await expect(bar).toBeVisible();
	const last = (n: number) =>
		expect.poll(async () =>
			(await editor.locator('.cm-line').allInnerTexts()).slice(-n).map((t) => t.trimEnd()),
		);
	// Text goes in as input events, as a phone keyboard sends it.
	const type = (text: string) => page.keyboard.insertText(text);
	await type('\nShopping');
	await bar.getByRole('button', { name: 'Make a heading' }).click();
	await bar.getByRole('button', { name: /Heading level 1/ }).click();
	await last(1).toEqual(['** Shopping']);
	await type('\nmilk');
	await bar.getByRole('button', { name: /Checkbox/ }).click();
	await last(2).toEqual(['** Shopping', '- [ ] milk']);
	await bar.getByRole('button', { name: /Checkbox/ }).click();
	await last(1).toEqual(['- [X] milk']);
	await type('\n\nfirst line ');
	await bar.getByRole('button', { name: 'Bold' }).click();
	await type('loud');
	await bar.getByRole('button', { name: 'Bold' }).click();
	await type('\nsecond line');
	await last(2).toEqual(['first line *loud*', 'second line']);
	// The editor's mono text draws `***` as three stars, not a ligature.
	expect(await editor.evaluate((el) => getComputedStyle(el).fontVariantLigatures)).toBe('none');

	await page.getByRole('button', { name: 'Read', exact: true }).click();
	const para = page.locator('.node-body p', { hasText: 'second line' });
	await expect(para.locator('strong')).toHaveText('loud');
	// One paragraph, two lines (as written), unless the reader chooses to join them.
	const lines = () =>
		para.evaluate((el) =>
			Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)),
		);
	expect(await lines()).toBe(2);
	await page.goto('app#/settings');
	await page.getByRole('radio', { name: 'Join into paragraphs' }).click();
	await page.goBack();
	await expect(para).toBeVisible();
	expect(await lines()).toBe(1);
});

test('on a long note the toolbar comes back when you scroll up', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText(
		'\n' + Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'),
	);
	await page.mouse.move(600, 400);
	await page.mouse.wheel(0, -900);
	await page.mouse.wheel(0, 400);
	// Scrolled down: only the toolbar at the top of the note, now out of view.
	await expect(page.locator('.floating')).toBeHidden();
	await page.mouse.wheel(0, -80);
	await expect(page.locator('.floating')).toBeVisible();
	// Wait for it to finish sliding in: clicking mid-slide makes the test scroll
	// it into view, which brings the real toolbar back instead.
	await expect(page.locator('.floating')).toHaveCSS('transform', 'none');
	await page.locator('.floating').getByRole('button', { name: 'Read' }).click();
	await expect(page.locator('.cm-content')).toHaveCount(0);
});

const READING = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d13';

test('a table is edited in the table sheet and saved aligned, as org does', async ({ page }) => {
	await open(page, `app#/node/${READING}`);
	await page.getByRole('button', { name: 'Edit table' }).click();
	const sheet = page.getByRole('dialog', { name: 'Edit table' });
	await expect(sheet).toBeVisible();
	// Row 1 is the table's <l>/<c> alignment row.
	await sheet.getByRole('textbox', { name: 'Row 4, Status' }).fill('reading');
	// Enter goes down a row, as in org (over the rule, to Total).
	await sheet.getByRole('textbox', { name: 'Row 4, Status' }).press('Enter');
	await expect(sheet.getByRole('textbox', { name: 'Row 5, Status' })).toBeFocused();
	await sheet.getByRole('button', { name: 'Add row below' }).click();
	await sheet.getByRole('radio', { name: 'One row' }).click();
	await sheet.getByRole('textbox', { name: 'Book' }).fill('Braiding Sweetgrass');
	await sheet.getByRole('textbox', { name: 'Pages' }).fill('408');
	await sheet.getByRole('button', { name: 'Save table' }).click();
	await expect(sheet).toBeHidden();
	await expect(page.locator('.node-body table')).toContainText('Braiding Sweetgrass');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const lines = () => page.locator('.cm-line').allInnerTexts();
	await expect
		.poll(lines)
		.toContain('| Entangled Life           | Merlin Sheldrake |   368 |    0 | reading |');
	expect(await lines()).toContain(
		'| Braiding Sweetgrass      |                  |   408 |      |         |',
	);
});

test('maths: the formula sheet checks LaTeX as you type, and the editor previews it', async ({
	page,
}) => {
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText('\nEnergy: ');
	await page
		.getByRole('toolbar', { name: 'Formatting' })
		.getByRole('button', { name: 'Maths (LaTeX)' })
		.click();
	const sheet = page.getByRole('dialog', { name: 'Insert formula' });
	await sheet.getByRole('textbox', { name: 'LaTeX' }).fill('\\frac{E}{m');
	await expect(sheet.getByText('A { is never closed')).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Insert', exact: true })).toBeDisabled();
	await sheet.getByRole('textbox', { name: 'LaTeX' }).fill('\\frac{E}{m} = ');
	await sheet.getByRole('button', { name: 'Square root', exact: true }).click();
	await page.keyboard.type('c');
	await expect(sheet.locator('.typeset .katex')).toBeVisible();
	await sheet.getByRole('button', { name: 'Insert', exact: true }).click();
	await expect(page.locator('.cm-line').last()).toHaveText(
		'Energy: \\(\\frac{E}{m} = \\sqrt{c}\\)',
	);
	// The cursor sits in the formula: its preview shows under the line.
	await page.keyboard.press('ArrowLeft');
	await expect(page.locator('.cm-tex-preview math')).toBeVisible();
	// A broken formula is underlined, with the reason.
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText('\nOops \\(\\alhpa\\)');
	await expect(page.locator('.cm-tex-error')).toHaveAttribute('title', /\\alhpa isn't a command/);
	// Typing a command inside maths offers LaTeX commands, filled in as snippets.
	await page.keyboard.insertText('\nMore \\(');
	await page.keyboard.type('\\fra');
	await page.locator('.cm-tooltip-autocomplete li', { hasText: '\\frac' }).first().click();
	await page.keyboard.type('x');
	await expect(page.locator('.cm-line').last()).toHaveText('More \\(\\frac{x}{b}');
});

test('tables in the source editor: the bar inserts one, Tab moves and realigns', async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, 'phones edit tables in the sheet');
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.press('Enter');
	await page
		.getByRole('toolbar', { name: 'Formatting' })
		.getByRole('button', { name: 'Table' })
		.click();
	await page.keyboard.type('Name');
	await page.keyboard.press('Tab');
	await page.keyboard.type('Phone');
	await page.keyboard.press('Tab');
	const lines = () => page.locator('.cm-line').allInnerTexts();
	await expect
		.poll(async () => (await lines()).slice(-4))
		.toEqual([
			'| Name | Phone |   |',
			'|------+-------+---|',
			'|      |       |   |',
			'|      |       |   |',
		]);
});

test('on phones the bottom bar steps aside while the keyboard is up', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'phones only');
	// A stand-in for the visual viewport, so the test can "open the keyboard".
	await page.addInitScript(() => {
		const vv = new EventTarget() as EventTarget & Record<string, number>;
		Object.assign(vv, {
			height: innerHeight,
			width: innerWidth,
			offsetTop: 0,
			offsetLeft: 0,
			scale: 1,
		});
		Object.defineProperty(window, 'visualViewport', { value: vv });
		(window as unknown as { keyboard: (open: boolean) => void }).keyboard = (open) => {
			vv.height = open ? innerHeight - 300 : innerHeight;
			vv.dispatchEvent(new Event('resize'));
		};
	});
	await open(page, `app#/node/${PROJECT}`);
	const nav = page.getByRole('navigation', { name: 'Quick navigation' });
	const keyboard = (o: boolean) =>
		page.evaluate((o) => (window as unknown as { keyboard: (o: boolean) => void }).keyboard(o), o);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await keyboard(true);
	await expect(nav).toBeHidden();
	// Keyboard dismissed (the field may keep focus, as Android's back button leaves it): back.
	await keyboard(false);
	await expect(nav).toBeVisible();
});

test('switching between reading and editing keeps your place', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	const scrollTo = (y: number) =>
		page.evaluate((y) => {
			// Wide screens scroll the pane; phones the page.
			const pane = document.querySelector('.pane-scroll');
			if (pane) pane.scrollTop = y;
			else window.scrollTo(0, y);
		}, y);
	// Click the toolbar button in place (a normal click would scroll it into view first).
	const toggle = () =>
		page.evaluate(() =>
			document.querySelector<HTMLElement>('.toolbar:not(.floating) [aria-pressed]')!.click(),
		);
	const top = (text: string) =>
		page.evaluate((text) => {
			const host = document.querySelector('.editor');
			const els = [
				...document.querySelectorAll('.node-body li'),
				...(host?.shadowRoot?.querySelectorAll('.cm-line') ?? []),
			];
			const el = els.find((e) => e.textContent?.includes(text));
			return el ? el.getBoundingClientRect().top : null;
		}, text);
	await scrollTo(450);
	// Within about a line: reading and editing size headings differently, so a
	// line a little below the one kept in place drifts by a few pixels.
	const line = 'Git sync through a stateless worker';
	const reading = (await top(line))!;
	await toggle();
	await expect(page.locator('.cm-content')).toBeVisible();
	await expect.poll(async () => Math.abs((await top(line))! - reading)).toBeLessThan(40);
	await toggle();
	await expect(page.locator('.node-body')).toBeVisible();
	await expect.poll(async () => Math.abs((await top(line))! - reading)).toBeLessThan(40);
});

test('dragging a node in the graph moves it with the pointer, zoomed in or not', async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, 'mouse drag');
	test.setTimeout(60_000);
	await open(page, 'app#/graph');
	const canvas = page.locator('canvas');
	await page.waitForTimeout(2500); // let the layout settle
	const box = (await canvas.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, -300); // zoom in
	await page.waitForTimeout(400);
	const overNode = () => canvas.evaluate((el) => el.style.cursor === 'pointer');
	let at: [number, number] | null = null;
	for (let y = box.y + 80; y < box.y + box.height - 80 && !at; y += 20)
		for (let x = box.x + 80; x < box.x + box.width - 240; x += 20) {
			await page.mouse.move(x, y);
			if (await overNode()) {
				at = [x, y];
				break;
			}
		}
	expect(at).not.toBeNull();
	const [x, y] = at!;
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) await page.mouse.move(x + i * 15, y + i * 8);
	await page.mouse.up();
	// The node is where it was dropped, under the pointer.
	await page.mouse.move(x + 150, y + 80);
	await expect.poll(overNode).toBe(true);
});

test('opening a TODO from the agenda goes to its heading, not the top of the note', async ({
	page,
}) => {
	await open(page, 'app#/agenda');
	await page.getByRole('link', { name: 'Write the self-hosting guide' }).first().click();
	await expect(page).toHaveURL(/at=\d+/);
	const heading = page.locator('.org-section', { hasText: 'Write the self-hosting guide' }).first();
	await expect(heading).toBeInViewport();
	await expect(heading).toHaveClass(/flash/);
});

test('reading view can hide items marked done', async ({ page }) => {
	await open(page, `app#/node/${READING}`);
	const done = page.locator('.org-section', { hasText: 'The Hidden Life of Trees' }).first();
	await expect(done).toBeVisible();
	await page.getByRole('button', { name: 'Hide done' }).click();
	await expect(done).toHaveCount(0);
	// Remembered on this device.
	await page.reload();
	await expect(page.getByRole('button', { name: /1 done hidden/ })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await expect(page.locator('.org-section', { hasText: 'The Hidden Life of Trees' })).toHaveCount(
		0,
	);
	await page.getByRole('button', { name: /done hidden/ }).click();
	await expect(
		page.locator('.org-section', { hasText: 'The Hidden Life of Trees' }).first(),
	).toBeVisible();
});

test('a file of done tasks with Hide done on says so, instead of reading as blank', async ({
	page,
}) => {
	await page.addInitScript(() => localStorage.setItem('mycelium:hide-done', '1'));
	await open(page, 'app#/file/inbox.org');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText('* DONE Email Sam\n* DONE Book a table\n');
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await expect(page.locator('.org-section')).toHaveCount(0);
	await expect(
		page.getByRole('note').filter({ hasText: 'Everything here is marked done' }),
	).toBeVisible();
	await expect(page.getByRole('button', { name: '2 done hidden' })).toHaveAttribute(
		'aria-pressed',
		'true',
	);
	await page.getByRole('button', { name: 'Show 2 done items' }).click();
	await expect(page.locator('.org-section', { hasText: 'Email Sam' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Hide done' })).toHaveAttribute(
		'aria-pressed',
		'false',
	);
});

test('Hide done keeps a done heading that still has open tasks under it', async ({ page }) => {
	await page.addInitScript(() => localStorage.setItem('mycelium:hide-done', '1'));
	await open(page, 'app#/file/inbox.org');
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.insertText(
		'#+title: inbox\n* DONE Tasks\n** TODO Test task\n* DONE Paid the rent\n** DONE Sent it\n',
	);
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await expect(page.locator('.org-section', { hasText: 'Test task' }).first()).toBeVisible();
	await expect(page.locator('.org-section', { hasText: 'Paid the rent' })).toHaveCount(0);
});

test('adding a picture: offered smaller, saved to images/, linked and shown', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	// A big 3000×2000 picture with photo-like fine detail (noise), as a phone camera makes.
	const png = await page.evaluate(async () => {
		const c = new OffscreenCanvas(3000, 2000);
		const ctx = c.getContext('2d')!;
		const img = ctx.createImageData(3000, 2000);
		let seed = 7;
		for (let i = 0; i < img.data.length; i += 4) {
			seed = (seed * 1103515245 + 12345) & 0x7fffffff;
			const v = 90 + (seed % 80);
			img.data[i] = v;
			img.data[i + 1] = v + ((i >> 9) % 40);
			img.data[i + 2] = 120;
			img.data[i + 3] = 255;
		}
		ctx.putImageData(img, 0, 0);
		const bytes = new Uint8Array(
			await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer(),
		);
		let s = '';
		for (const b of bytes) s += String.fromCharCode(b);
		return btoa(s);
	});
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.press('Enter');
	const chooser = page.waitForEvent('filechooser');
	await page
		.getByRole('toolbar', { name: 'Formatting' })
		.getByRole('button', { name: 'Picture' })
		.click();
	await (
		await chooser
	).setFiles({
		name: 'Garden plan.png',
		mimeType: 'image/png',
		buffer: Buffer.from(png, 'base64'),
	});
	const sheet = page.getByRole('dialog', { name: 'Add picture' });
	const smaller = sheet.getByRole('radio', { name: /Smaller/ });
	await expect(smaller).toBeChecked();
	await expect(sheet.getByText(/2000×1333, JPEG/)).toBeVisible();
	await sheet.getByRole('textbox', { name: /Caption/ }).fill('The garden plan');
	await sheet.getByRole('button', { name: 'Add picture' }).click();
	await expect(sheet).toBeHidden();
	const lines = () => page.locator('.cm-line').allInnerTexts();
	await expect
		.poll(async () => (await lines()).slice(-2))
		.toEqual([
			'#+CAPTION: The garden plan',
			expect.stringMatching(
				/^images\/\d{4}-\d\d-\d\d-\d{6}-garden-plan\.jpg$|^\[\[file:images\/\d{4}-\d\d-\d\d-\d{6}-garden-plan\.jpg\]\]$/,
			),
		]);
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await expect(page.locator('.node-body img[src^="blob:"]').last()).toBeVisible();
	await page.goto('app#/changes');
	await expect(
		page.getByText(/images\/\d{4}-\d\d-\d\d-\d{6}-garden-plan\.jpg/).first(),
	).toBeVisible();
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
	await open(page, 'app#/settings/vault');
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

test('tabs and split view: modifier clicks, own pages per pane, remembered', async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, 'wide screens only');
	await open(page, `app#/node/${PROJECT}`);
	const main = page.getByRole('region', { name: 'Main pane' });
	const mainTabs = main.getByRole('list', { name: 'Main pane tabs' }).getByRole('listitem');
	await expect(mainTabs).toHaveCount(1);
	const link = main.locator('.node-body a[href^="#/node/"]').first();
	const target = (await link.getAttribute('href'))!;

	// ⌘/Ctrl-click: a new tab, which becomes the current one.
	await link.click({ modifiers: ['ControlOrMeta'] });
	await expect(mainTabs).toHaveCount(2);
	await expect(page).toHaveURL(new RegExp(`${target.replace(/[/#]/g, '\\$&')}$`));
	await expect(mainTabs.nth(1).getByRole('button').first()).toHaveAttribute('aria-current', 'page');
	await mainTabs.first().getByRole('button').first().click();
	await expect(page).toHaveURL(new RegExp(`node/${PROJECT}$`));

	// Alt-click: beside, in a second pane; the address bar stays.
	await main
		.locator('.node-body a[href^="#/node/"]')
		.first()
		.click({ modifiers: ['Alt'] });
	const side = page.getByRole('region', { name: 'Side pane' });
	await expect(side).toBeVisible();
	await expect(side.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`node/${PROJECT}$`));
	// Each pane reads or edits on its own.
	await side.getByRole('button', { name: 'Edit', exact: true }).click();
	await expect(side.locator('.cm-content')).toBeVisible();
	await expect(main.locator('.cm-content')).toHaveCount(0);
	await expect(main.locator('.node-body')).toBeVisible();
	// The sidebar opens pages in the pane you're working in.
	await page.getByRole('link', { name: 'Agenda' }).first().click();
	await expect(side.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
	await expect(page).toHaveURL(new RegExp(`node/${PROJECT}$`));
	await expectAccessible(page);

	// Remembered for this vault.
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(mainTabs).toHaveCount(2);
	await expect(side.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();

	await side.getByRole('button', { name: 'Close split view' }).click();
	await expect(side).toHaveCount(0);
});

test('phones show one page, without tabs', async ({ page, isMobile }) => {
	test.skip(!isMobile, 'phones only');
	await open(page, `app#/node/${PROJECT}`);
	await expect(page.getByRole('list', { name: /pane tabs/ })).toHaveCount(0);
	await page.locator('.node-body a[href^="#/node/"]').first().click();
	await expect(page).not.toHaveURL(new RegExp(`node/${PROJECT}$`));
});

test('the agenda shows clocked time only when there is some this week', async ({ page }) => {
	await sourceMode(page);
	await open(page, 'app#/agenda');
	await expect(page.getByRole('heading', { level: 1, name: 'Agenda' })).toBeVisible();
	await expect(page.getByRole('heading', { name: /^Clocked/ })).toHaveCount(0);

	// Clock an hour and a half on a heading today.
	const now = new Date();
	const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${now.toLocaleDateString('en-US', { weekday: 'short' })}`;
	await open(page, `app#/node/${PROJECT}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText(
		`\n* Review notes\n:LOGBOOK:\nCLOCK: [${day} 09:00]--[${day} 10:30] =>  1:30\n:END:\n`,
	);
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await page.goto(page.url().replace(/#.*/, '#/agenda'));
	await expect(page.getByRole('heading', { name: /^Clocked/ })).toContainText('1:30');
	await expect(page.getByRole('cell', { name: 'Review notes' })).toBeVisible();
});

test('sharing a page to Mycelium opens capture with an org link', async ({ page }) => {
	await page.goto(
		`app/?share_title=${encodeURIComponent('Org mode')}&share_text=${encodeURIComponent('Worth a look https://orgmode.org/')}#/`,
	);
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	const sheet = page.getByRole('dialog');
	await expect(sheet.locator('textarea')).toHaveValue(
		'[[https://orgmode.org/][Org mode]]\nWorth a look',
	);
	// Shared once: the address no longer carries it, so a reload doesn't capture again.
	expect(new URL(page.url()).search).toBe('');
});

test('settings are split into sections, each with its own address', async ({ page }) => {
	await open(page, 'app#/settings');
	const tabs = page.getByRole('navigation', { name: 'Settings sections' });
	await expect(tabs.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
		'aria-current',
		'page',
	);
	await expect(page.getByRole('heading', { name: 'Reminders' })).toHaveCount(0);
	await tabs.getByRole('link', { name: 'Reminders' }).click();
	await expect(page).toHaveURL(/#\/settings\/reminders$/);
	await expect(page.getByRole('heading', { name: 'Reminders' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Appearance' })).toHaveCount(0);
	await expectAccessible(page);
});
