import { expect, test, type Page } from '@playwright/test';

const FOREST = '2d4e6f80-1a3c-4e5b-9d7f-8a9b0c1d2e05';
const EVERGREEN = '9b8c7d60-5e4f-4a3b-8c2d-1e0f9a8b7c06';
const SIMARD = '7a2b3c40-9d8e-4f1a-b2c3-d4e5f6a7b804';
const ZETTEL = '3c9d7e10-2f4b-4a8e-b1c6-7d8e9f0a1b02';

async function open(page: Page, path: string) {
	await page.goto(path);
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
}
/** The note's link suggestions (in the side panel, or under the note on a narrow screen). */
const suggestions = (page: Page) =>
	page.getByRole('region', { name: /Link suggestions/ }).filter({ visible: true });

test('link suggestions in the reading view: link one, link all, stop suggesting', async ({
	page,
}) => {
	await open(page, `app#/node/${FOREST}`);
	const body = page.locator('.node-body');
	// The plain words are underlined; tapping them offers the link.
	await body.getByRole('button', { name: /Suzanne Simard, a mention of Suzanne Simard/ }).click();
	await page.getByRole('menuitem', { name: /Link to Suzanne Simard/ }).click();
	await expect(body.getByRole('link', { name: 'Suzanne Simard' })).toBeVisible();
	await expect(suggestions(page)).toHaveCount(0);
	// One Undo puts the words back.
	await page
		.getByRole('status')
		.filter({ hasText: 'Linked' })
		.getByRole('button', { name: 'Undo' })
		.click();
	await expect(body.getByRole('button', { name: /a mention of Suzanne Simard/ })).toBeVisible();

	await open(page, `app#/node/${EVERGREEN}`);
	await expect(suggestions(page)).toContainText('Org mode');
	await expect(suggestions(page)).toContainText('Emacs');
	// Don't suggest Emacs: gone here, and remembered.
	await suggestions(page).getByRole('button', { name: 'Don’t suggest Emacs' }).click();
	await expect(page.locator('.node-body .mention')).toHaveCount(1);
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(suggestions(page).getByRole('button', { name: 'Don’t suggest Emacs' })).toHaveCount(
		0,
	);
	await expect(page.locator('.node-body .mention')).toHaveCount(1);

	// Settings can suggest it again.
	await open(page, 'app#/settings/appearance');
	await page.getByRole('button', { name: 'Suggest again' }).click();
	await open(page, `app#/node/${EVERGREEN}`);
	await expect(page.locator('.node-body .mention')).toHaveCount(2);

	// Link all: both at once (one Undo).
	await suggestions(page).getByRole('button', { name: 'Link all 2' }).click();
	const body2 = page.locator('.node-body');
	await expect(body2.getByRole('link', { name: 'Org mode' })).toBeVisible();
	await expect(body2.getByRole('link', { name: 'Emacs' })).toBeVisible();
	await expect(suggestions(page)).toHaveCount(0);

	await page.goto(page.url().replace(/#.*/, '#/changes'));
	await expect(page.locator('main')).toContainText(
		/\[\[id:[0-9a-f-]+\]\[Org mode\]\] inside \[\[id:[0-9a-f-]+\]\[Emacs\]\]/,
	);
});

test('link suggestions on a phone: the formatting bar links the words at the cursor', async ({
	page,
	isMobile,
}) => {
	test.skip(!isMobile, 'the formatting bar shows while typing on a phone');
	await open(page, `app#/node/${FOREST}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const mention = page.locator('.cm-content .cm-mention', { hasText: 'Suzanne Simard' });
	await mention.click();
	await page.getByRole('button', { name: 'Link to a note' }).click();
	await expect(page.locator('.cm-content .cm-mention')).toHaveCount(0);
	await page.getByRole('button', { name: 'Read', exact: true }).click();
	await expect(
		page.locator('.node-body').getByRole('link', { name: 'Suzanne Simard' }),
	).toBeVisible();
});

test('link suggestions in the editor: Ctrl-. links the words; Link to… keeps them', async ({
	page,
	isMobile,
}) => {
	test.skip(isMobile, 'keyboard shortcuts');
	await open(page, `app#/node/${FOREST}`);
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	const editor = page.locator('.cm-content');
	await expect(editor.locator('.cm-mention', { hasText: 'Suzanne Simard' })).toBeVisible();
	// The cursor in a suggestion, then Ctrl-.
	await editor.locator('.cm-mention', { hasText: 'Suzanne Simard' }).click();
	await page.keyboard.press('ControlOrMeta+.');
	await expect(editor.locator('.cm-mention')).toHaveCount(0);

	// Selected words, linked to a chosen note, keep their wording.
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type('\nNotes about slips of paper');
	for (let i = 0; i < 'slips of paper'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft');
	await page.keyboard.press('ControlOrMeta+.');
	const picker = page.getByRole('dialog', { name: /Link “slips of paper” to/ });
	await expect(picker).toBeVisible();
	await picker.getByRole('combobox', { name: 'Note to link to' }).fill('zettel');
	await page.keyboard.press('Enter');
	await expect(picker).toBeHidden();

	// Pasting a note's source URL offers the note's link.
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.type('\nSource: ');
	await page.evaluate(() => {
		const data = new DataTransfer();
		data.setData('text/plain', 'https://zettelkasten.de/introduction/');
		const target = document.querySelector('.editor')!.shadowRoot!.querySelector('.cm-content')!;
		target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
	});
	await page.getByRole('button', { name: 'Link the note instead' }).click();

	await page.getByRole('button', { name: 'Read', exact: true }).click();
	const body = page.locator('.node-body');
	await expect(body.getByRole('link', { name: 'Suzanne Simard' })).toBeVisible();
	await expect(body.getByRole('link', { name: 'slips of paper' })).toHaveAttribute(
		'href',
		new RegExp(ZETTEL),
	);
	await expect(body.getByRole('link', { name: 'Zettelkasten' })).toBeVisible();

	await page.goto(page.url().replace(/#.*/, '#/changes'));
	const main = page.locator('main');
	await expect(main).toContainText(`[[id:${SIMARD}][Suzanne Simard]]`);
	await expect(main).toContainText(`Notes about [[id:${ZETTEL}][slips of paper]]`);
	await expect(main).toContainText(`Source: [[id:${ZETTEL}][Zettelkasten]]`);
});
