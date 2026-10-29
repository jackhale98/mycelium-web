import { expect, test, type Locator, type Page } from '@playwright/test';

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

/** Drag with the mouse in steps, picking the item up near its top, as a person does. */
async function drag(page: Page, from: Locator, to: Locator) {
	await from.scrollIntoViewIfNeeded();
	const a = (await from.boundingBox())!;
	await page.mouse.move(a.x + a.width / 2, a.y + Math.min(10, a.height / 2));
	await page.mouse.down();
	const b = (await to.boundingBox())!;
	await page.mouse.move(b.x + b.width / 2, b.y + Math.min(24, b.height / 2), { steps: 8 });
	await page.mouse.up();
}

test('aliases and refs are added and removed from the note details', async ({ page }) => {
	await open(page, `app#/node/${MYCELIAL}`);
	await page.getByRole('button', { name: 'Details' }).click();
	const sheet = details(page);
	await sheet.getByLabel('New alias').fill('Hyphal web');
	await sheet.getByRole('region', { name: 'Aliases' }).getByRole('button', { name: 'Add' }).click();
	await sheet.getByLabel('New ref').fill('https://en.wikipedia.org/wiki/Mycelium');
	await sheet.getByRole('region', { name: 'Refs' }).getByRole('button', { name: 'Add' }).click();
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
	await section.getByRole('button', { name: /Edit heading/ }).press('Enter');
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

test('refiling: the search box stays put as the results narrow', async ({ page }) => {
	await open(page, `app#/node/${PROJECT}`);
	const section = page.locator('.org-section', { hasText: 'Write the self-hosting guide' }).first();
	await section.getByRole('button', { name: /Edit heading/ }).press('Enter');
	await page.getByRole('button', { name: 'Refile…' }).click();
	const search = page.getByRole('searchbox', { name: 'Find a heading or file' });
	await expect(search).toBeVisible();
	const before = (await search.boundingBox())!.y;
	await search.fill('2026-10-1');
	await expect(
		page.getByRole('list', { name: 'Refile targets' }).getByRole('listitem'),
	).not.toHaveCount(0);
	expect(Math.abs((await search.boundingBox())!.y - before)).toBeLessThan(2);
	await search.fill('no such heading anywhere');
	await expect(page.getByText('No headings match.')).toBeVisible();
	expect(Math.abs((await search.boundingBox())!.y - before)).toBeLessThan(2);
});

test('properties are added, changed and removed; the ID stays read-only', async ({ page }) => {
	await open(page, `app#/node/${MYCELIAL}`);
	await page.getByRole('button', { name: 'Details' }).click();
	const sheet = details(page);
	await expect(sheet.locator('code', { hasText: MYCELIAL })).toBeVisible();
	await expect(sheet.getByRole('button', { name: 'Remove ID' })).toHaveCount(0);
	await sheet.getByLabel('New property name').fill('CATEGORY');
	await sheet.getByLabel('New property value').fill('biology');
	await sheet
		.getByRole('region', { name: 'Properties' })
		.getByRole('button', { name: 'Add', exact: true })
		.click();
	const value = sheet.getByRole('textbox', { name: 'CATEGORY' });
	await expect(value).toHaveValue('biology');
	await value.fill('fungi');
	await value.press('Enter');
	await value.blur();
	await expect(value).toHaveValue('fungi');
	await sheet.getByLabel('New property name').fill('Effort');
	await sheet.getByLabel('New property value').fill('1:30');
	await sheet
		.getByRole('region', { name: 'Properties' })
		.getByRole('button', { name: 'Add', exact: true })
		.click();
	await sheet.getByRole('button', { name: 'Remove Effort' }).click();
	await expect(sheet.getByRole('textbox', { name: 'Effort' })).toHaveCount(0);
	await sheet.getByRole('button', { name: 'Close' }).click();
	await page.goto(page.url().replace(/#.*/, '#/changes'));
	await expect(page.locator('main')).toContainText(/:CATEGORY: +fungi/);
	await expect(page.locator('main')).not.toContainText(':Effort:');
});

test('stuck projects list projects without a next action', async ({ page }) => {
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'Stuck' }).click();
	const section = page.getByRole('region', { name: /Stuck projects/ });
	await expect(section.getByRole('heading', { name: /Stuck projects/ })).toBeVisible();
	// org's default (second-level headings) finds none in the demo, whose projects are level 1.
	await expect(section).toContainText('No stuck projects');
	await page.getByText('What counts as a stuck project').click();
	const match = page.getByLabel('Projects are headings matching');
	// Tagged :project: (the demo note's file tag, inherited as in org).
	await match.fill('+project');
	await page.getByRole('button', { name: 'Save for this vault' }).click();
	await expect(section.getByText('Inspiration', { exact: true })).toBeVisible();
	await match.fill('+design');
	await page.getByRole('button', { name: 'Save for this vault' }).click();
	await expect(section.getByText('Ship the design system', { exact: true })).toBeVisible();
	await expect(section.getByText('Inspiration', { exact: true })).toHaveCount(0);
	// A match string that doesn't parse says so.
	await match.fill('+{unclosed');
	await page.getByRole('button', { name: 'Save for this vault' }).click();
	await expect(page.getByRole('alert')).toContainText('definition doesn’t work');
});

test('stuck projects are configured in Settings too, all four org parts', async ({ page }) => {
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'Stuck' }).click();
	await page.getByRole('link', { name: 'Change in Settings' }).click();
	await expect(page).toHaveURL(/#\/settings\/tasks$/);
	await page.getByLabel('Projects are headings matching').fill('+project');
	await page.getByLabel('…or its text matches').fill('name and the graph');
	await page.getByRole('button', { name: 'Save for this vault' }).click();
	await expect(page.getByText('Saved for this vault.')).toBeVisible();
	await page.goBack();
	const section = page.getByRole('region', { name: /Stuck projects/ });
	await expect(section.getByText('Ship the design system', { exact: true })).toBeVisible();
	// Its text mentions "name and the graph": not stuck.
	await expect(section.getByText('Inspiration', { exact: true })).toHaveCount(0);
	await expect(section).toContainText('or matches the text pattern');
});

test('month view: days with their items, pick a day, drag to reschedule', async ({
	page,
	isMobile,
}) => {
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'Month' }).click();
	const grid = page.getByRole('table', { name: /\d{4}/ });
	await expect(grid.getByRole('columnheader')).toHaveCount(7);
	await expect(grid).not.toContainText('Invalid');
	const todayCell = grid.locator('.gc.today');
	if (isMobile) {
		// The grid stays put; the day is a drawer above the bottom bar.
		const scroll = await page.evaluate(
			() => document.documentElement.scrollHeight - window.innerHeight,
		);
		expect(scroll).toBeLessThanOrEqual(2);
		const drawer = page.getByRole('region', { name: 'Selected day' });
		await expect(drawer).toContainText(/more|Nothing/);
		const handle = drawer.getByRole('button', { name: 'Day details' });
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
		await handle.click();
		await expect(handle).toHaveAttribute('aria-expanded', 'true');
		// The page behind is locked while it's open.
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe(
			'hidden',
		);
		await page.keyboard.press('Escape');
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
		// A pull down on the open list closes it.
		await handle.click();
		await expect(handle).toHaveAttribute('aria-expanded', 'true');
		const cdp = await page.context().newCDPSession(page);
		const l = (await drawer.locator('.dlist').boundingBox())!;
		const x = l.x + l.width / 2;
		const y = l.y + 40;
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
		for (let i = 1; i <= 10; i++)
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x, y: y + i * 25 }],
			});
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		await expect(handle).toHaveAttribute('aria-expanded', 'false');
		expect(
			await page.evaluate(() => getComputedStyle(document.documentElement).overflowY),
		).not.toBe('hidden');
		// Swipe the grid to the next month and back.
		const label = page.getByRole('navigation', { name: 'Month' });
		const before = await label.textContent();
		// Retried: under load a synthetic gesture can lose its moves.
		await expect(async () => {
			const box = (await grid.boundingBox())!;
			await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2, { steps: 6 });
			await page.mouse.up();
			await expect(label).not.toHaveText(before!, { timeout: 1000 });
		}).toPass({ timeout: 10_000 });
		await label.getByRole('button', { name: 'Today' }).click();
		// Once the months have slid past each other, one grid is left.
		await expect(page.getByRole('table', { name: /\d{4}/ })).toHaveCount(1);
	}
	const list = page.getByRole('region', { name: /Today/ });
	if (isMobile) await page.getByRole('button', { name: 'Day details' }).click();
	const first = (await list.locator('li').first().textContent())!;
	expect(first.length).toBeGreaterThan(0);
	if (isMobile) await page.keyboard.press('Escape');
	// Another day: its list.
	const next = todayCell.locator('xpath=following-sibling::div[1]');
	test.skip(!(await next.count()), 'today is the last day of its week row');
	// By its number, in the corner: labels cover the middle (and select the day too).
	await next.getByRole('button').click({ position: { x: 12, y: 12 } });
	await expect(page.getByRole('region', { name: /Today/ })).toHaveCount(0);
	if (isMobile) return;
	// Drag a scheduled item (not a habit: those show on today only) to the next day.
	const chip = grid
		.locator('.gc:not(:last-child) li[draggable="true"]', { hasNotText: 'flashcards' })
		.first();
	// Pin both days by position: the locators would otherwise follow the item.
	const index = await chip.evaluate((el) =>
		[...document.querySelectorAll('.month-panel:not([inert]) .gc')].indexOf(el.closest('.gc')!),
	);
	const cells = grid.locator('.gc');
	const from = cells.nth(index);
	const to = cells.nth(index + 1);
	const title = (await chip.textContent())!.replace(/^\d\d:\d\d/, '').trim();
	await drag(page, chip, to);
	await expect(from.locator('li', { hasText: title })).toHaveCount(0);
	// The drop picks the new day: its list has the item.
	await expect(to.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.month-view section.side')).toContainText(title);
});

test('board: a column per state, move by menu or drag, rows by tag', async ({ page, isMobile }) => {
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'Board' }).click();
	const heads = page.locator('.col-head');
	await expect(heads).toHaveCount(3);
	await expect(heads.first()).toContainText('TODO');
	const todo = page.getByRole('list', { name: 'TODO', exact: true });
	const next = page.getByRole('list', { name: 'NEXT', exact: true });
	if (isMobile) {
		// A short swipe lands on the next whole column.
		const scroller = page.locator('.board-view .scroller');
		await scroller.evaluate((el) => el.scrollBy({ left: 60 }));
		await expect
			.poll(() =>
				scroller.evaluate((el) => {
					const second = el.querySelectorAll('.col-head')[1] as HTMLElement;
					return Math.abs(
						el.scrollLeft -
							(second.offsetLeft - el.querySelector<HTMLElement>('.board')!.offsetLeft),
					);
				}),
			)
			.toBeLessThan(2);
		await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
	}
	const card = todo.locator('li', { hasText: 'How to Take Smart Notes' });
	// Edit a card's heading from the board.
	await card.getByRole('button', { name: 'Edit “How to Take Smart Notes”' }).press('Enter');
	const sheet = page.getByRole('dialog');
	await expect(sheet.getByLabel('Heading', { exact: true })).toHaveValue('How to Take Smart Notes');
	await page.keyboard.press('Escape');
	await expect(sheet).toHaveCount(0);
	await card.getByRole('combobox').selectOption('NEXT');
	await expect(next.locator('li', { hasText: 'How to Take Smart Notes' })).toBeVisible();
	await expect(card).toHaveCount(0);
	if (!isMobile) {
		const done = page.getByRole('list', { name: 'DONE', exact: true });
		await drag(page, next.locator('li', { hasText: 'How to Take Smart Notes' }), done);
		await expect(done.locator('li', { hasText: 'How to Take Smart Notes' })).toBeVisible();
	}
	// Rows by tag: a card shows in each of its tags' rows.
	await page.getByLabel('Rows').selectOption('tag');
	await expect(page.getByRole('heading', { level: 3, name: 'books' })).toBeVisible();
	await expect(page.getByRole('list', { name: 'TODO, books' })).toBeVisible();
	// Remembered.
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.getByLabel('Rows')).toHaveValue('tag');
	// The state change is what's in the file.
	await page.goto(page.url().replace(/#.*/, '#/changes'));
	await expect(page.locator('main')).toContainText(
		`${isMobile ? 'NEXT' : 'DONE'} [#B] How to Take Smart Notes`,
	);
});

test('phones: a task sheet locks the page behind and a pull down closes it', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'bottom sheets are for phones');
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'List' }).click();
	await page
		.getByRole('button', { name: /^Edit “/ })
		.first()
		.press('Enter');
	const sheet = page.getByRole('dialog');
	await expect(sheet).toBeVisible();
	const overflow = () => page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
	expect(await overflow()).toBe('hidden');
	// A short pull springs back.
	const cdp = await page.context().newCDPSession(page);
	// Measure once it has finished sliding up.
	await expect.poll(() => sheet.evaluate((el) => el.getAnimations().length)).toBe(0);
	const box = (await sheet.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + 12;
	const pull = async (by: number) => {
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
		for (let i = 1; i <= 10; i++) {
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [{ x, y: y + (i * by) / 10 }],
			});
			await page.waitForTimeout(30);
		}
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	};
	await pull(40);
	await page.waitForTimeout(300);
	await expect(sheet).toBeVisible();
	// A real one closes it, and the page scrolls again.
	await pull(260);
	await expect(sheet).toHaveCount(0);
	expect(await overflow()).not.toBe('hidden');
});

test('a habit: its graph on the agenda, details with streak and rate, mark done today', async ({
	page,
}) => {
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'List' }).click();
	// The demo's daily habit: done on 17 of the last 21 days, the last three in a row.
	const graph = page.getByRole('button', { name: /^Habit: done 17 of the last 28 days/ });
	await expect(graph).toBeVisible();
	const box = (await graph.boundingBox())!;
	expect(box.width).toBeGreaterThan(200);
	await graph.click();
	const habit = page.getByRole('dialog', { name: "Review this week's flashcards" });
	await expect(habit).toContainText('Every day, counted from when it was last done');
	const values = habit.getByRole('definition');
	await expect(values.nth(0)).toHaveText('3');
	await expect(values.nth(1)).toContainText('61%');
	await expect(values.nth(2)).toHaveText('Yesterday');
	await habit.getByRole('button', { name: 'Mark done today' }).click();
	await expect(habit.getByRole('button', { name: 'Done today', exact: true })).toBeDisabled();
	await expect(values.nth(0)).toHaveText('4');
	await expect(values.nth(2)).toHaveText('Today');
	await habit.getByRole('button', { name: 'Close' }).click();
	await expect(habit).toHaveCount(0);
	await page.goto(page.url().replace(/#.*/, '#/changes'));
	await expect(page.locator('main')).toContainText(/- State "DONE" +from "TODO" +\[/);
});

/** A one-finger horizontal swipe on a phone, from `from` to `to` (x positions) at height `y`. */
async function swipe(page: Page, y: number, from: number, to: number) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from, y }] });
	for (let i = 1; i <= 10; i++)
		await cdp.send('Input.dispatchTouchEvent', {
			type: 'touchMove',
			touchPoints: [{ x: from + ((to - from) * i) / 10, y }],
		});
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

test('phones: swipe a task right to complete it (with undo), left for quick actions', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'swipes are for touch screens');
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'List' }).click();
	const row = page.locator('li.row', { hasText: 'Write the self-hosting guide' });
	await expect(row).toBeVisible();
	await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	let box = (await row.boundingBox())!;
	const y = box.y + 20;
	// A short swipe springs back and changes nothing.
	await swipe(page, y, box.x + 60, box.x + 110);
	await expect(row.locator('.front')).not.toHaveAttribute('style', /translateX/);
	// All the way right: done, with an undo.
	await swipe(page, y, box.x + 60, box.x + box.width - 20);
	const toast = page.getByRole('status').filter({ hasText: 'Done: Write the self-hosting guide' });
	await expect(toast).toBeVisible();
	await toast.getByRole('button', { name: 'Undo' }).click();
	await expect(row.getByRole('button', { name: /TODO/ }).first()).toBeVisible();
	// Right to left: the tray (Schedule, State, More by default), then a day.
	await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	box = (await row.boundingBox())!;
	await swipe(page, box.y + 20, box.x + box.width - 40, box.x + 60);
	const tray = row.locator('.tray');
	await expect(tray.getByRole('button')).toHaveText(['Schedule', 'State', 'More']);
	await tray.getByRole('button', { name: 'Schedule' }).click();
	const sheet = page.getByRole('dialog', { name: 'Schedule' });
	await sheet.getByRole('button', { name: /^Tomorrow/ }).click();
	await expect(
		page.getByRole('status').filter({ hasText: 'Tomorrow: Write the self-hosting guide' }),
	).toBeVisible();
	// State: straight to another keyword.
	await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	box = (await row.boundingBox())!;
	await swipe(page, box.y + 20, box.x + box.width - 40, box.x + 60);
	await tray.getByRole('button', { name: 'State' }).click();
	await page.getByRole('dialog', { name: 'State' }).getByRole('button', { name: 'NEXT' }).click();
	await expect(row.getByRole('button', { name: /NEXT/ }).first()).toBeVisible();
	await page.goto(page.url().replace(/#.*/, '#/changes'));
	await expect(page.locator('main')).toContainText(/SCHEDULED: <\d{4}-\d\d-\d\d \w{3}>/);
});

test('phones: swipe a task heading in a note; the tray is the one chosen in Settings', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'swipes are for touch screens');
	await open(page, 'app#/settings/tasks');
	await page.getByLabel('First button').selectOption('clock');
	await expect(page.locator('.swipe-preview')).toHaveText(/Clock in\s*State\s*More/);
	await page.goto(page.url().replace(/#.*/, '#/node/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12'));
	const heading = page.locator('.swipe', { hasText: 'Write the self-hosting guide' });
	await heading.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	// The gear is out of sight on touch screens; the swipe does its job.
	await expect(heading.locator('.more')).toHaveCSS('position', 'absolute');
	const box = (await heading.boundingBox())!;
	await swipe(page, box.y + 14, box.x + box.width - 40, box.x + 60);
	const tray = heading.locator('.tray');
	await expect(tray.getByRole('button')).toHaveText(['Clock in', 'State', 'More']);
	await tray.getByRole('button', { name: 'More' }).click();
	await expect(page.getByRole('dialog').getByLabel('Heading', { exact: true })).toHaveValue(
		'Write the self-hosting guide',
	);
});

test('quick add on the agenda: plain language becomes an org task', async ({ page }) => {
	await open(page, 'app#/agenda');
	await page.getByRole('radio', { name: 'List' }).click();
	const field = page.getByRole('textbox', { name: 'Add a task' });
	await field.fill('Call Sam tomorrow 3pm #work !A every week ~30m');
	const chips = page.getByRole('list', { name: 'Understood' });
	await expect(chips).toContainText('Tomorrow');
	await expect(chips).toContainText('15:00');
	await expect(chips).toContainText('#work');
	await expect(chips).toContainText('Priority A');
	await expect(chips).toContainText('Repeats every week');
	await expect(chips).toContainText('30 min');
	await field.press('Enter');
	await expect(field).toHaveValue('');
	await expect(page.locator('main')).toContainText('Call Sam');

	// A chip's × keeps those words in the title.
	await field.fill('Lunch with Friday team fri');
	await chips.getByRole('button', { name: 'Keep “Friday” as words' }).click();
	await expect(chips.locator('li')).toHaveCount(1);
	await field.press('Enter');

	await page.goto(page.url().replace(/#.*/, '#/changes'));
	const main = page.locator('main');
	await expect(main).toContainText(/\* TODO \[#A\] Call Sam +:work:/);
	await expect(main).toContainText(/SCHEDULED: <\d{4}-\d\d-\d\d \w{3} 15:00 \+1w>/);
	await expect(main).toContainText(/:Effort: +0:30/);
	await expect(main).toContainText('* TODO Lunch with Friday team');
});

test('triage the inbox: done, schedule, delete (with undo), later', async ({ page }) => {
	await open(page, 'app#/triage');
	const card = page.locator('article.card');
	const title = page.locator('#triage-title');
	await expect(page.getByRole('status')).toContainText('4 to go');
	await expect(title).toHaveText('Email Sam about the reading group');
	await page.getByRole('button', { name: /^Done/ }).click();
	await expect(title).toHaveText('Try org-cite for ROAM_REFS');
	// Schedule moves on once it's set, leaving the card in the inbox.
	await page.getByRole('button', { name: /^Schedule/ }).click();
	await page
		.getByRole('dialog', { name: 'Schedule' })
		.getByRole('button', { name: /^Tomorrow/ })
		.click();
	await expect(title).toHaveText('Book a table for the reading group dinner');
	await expect(card).toContainText('six people');
	// Delete, undo, delete again (by key).
	await page.getByRole('button', { name: /^Delete/ }).click();
	await expect(title).toHaveText('Idea: a seasonal walk log');
	await page
		.getByRole('status')
		.filter({ hasText: 'Deleted' })
		.getByRole('button', { name: 'Undo' })
		.click();
	await expect(title).toHaveText('Book a table for the reading group dinner');
	await page.keyboard.press('x');
	await expect(title).toHaveText('Idea: a seasonal walk log');
	await expect(card).toContainText('#forest');
	await page.keyboard.press('Space');
	await expect(page.getByText("You've been through everything.")).toBeVisible();
	await expect(page.getByText('2 things stay in the inbox for later.')).toBeVisible();

	await page.goto(page.url().replace(/#.*/, '#/changes'));
	const main = page.locator('main');
	await expect(main).toContainText('* DONE Email Sam about the reading group');
	await expect(main).toContainText(/SCHEDULED: <\d{4}-\d\d-\d\d \w{3}>/);
	// Deleted: shown as a removed line.
	await expect(main).toContainText('* Book a table for the reading group dinner');
});

test('the weekly review walks its steps and remembers the day', async ({ page }) => {
	await open(page, 'app#/');
	await expect(page.getByRole('link', { name: /Weekly review\s*not yet/ })).toBeVisible();
	await page.getByRole('link', { name: /Weekly review/ }).click();
	const steps = page.getByRole('list', { name: 'Steps' });
	await expect(steps.getByRole('button')).toHaveCount(7);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Empty the inbox');
	await expect(page.locator('main')).toContainText('4 things in the inbox.');
	const next = page.getByRole('button', { name: /^Next/ });
	for (const heading of [
		'Overdue',
		'Coming up',
		'Waiting on others',
		'Stuck projects',
		'Habits',
		'Done this week',
	]) {
		await next.click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
	}
	await expect(page.locator('main')).toContainText('Read chapter 3');
	await page.getByRole('button', { name: 'Finish review' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Review done');
	await page.locator('.review').getByRole('link', { name: 'Home' }).click();
	await expect(page.getByRole('link', { name: /Weekly review\s*today/ })).toBeVisible();
});
