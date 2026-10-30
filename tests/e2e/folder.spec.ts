/// Local folder vaults. The folder picker is stubbed with a directory in the
/// origin-private file system, which has the same handle API as a real folder.

import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'File System Access is Chromium-only');

test('open a folder, edit a note and see it written to disk', async ({ page }) => {
	await page.addInitScript(() => {
		(
			window as unknown as { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle> }
		).showDirectoryPicker = async () => {
			const opfs = await navigator.storage.getDirectory();
			const root = await opfs.getDirectoryHandle('my-notes', { create: true });
			const write = async (dir: FileSystemDirectoryHandle, name: string, text: string) => {
				const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
				await w.write(text);
				await w.close();
			};
			await write(
				root,
				'garden.org',
				':PROPERTIES:\n:ID: g1\n:END:\n#+title: Garden\n\n* TODO Plant garlic\nIn autumn.\n',
			);
			const daily = await root.getDirectoryHandle('daily', { create: true });
			await write(daily, '2026-10-20.org', '#+title: 2026-10-20\n\nSee [[id:g1][Garden]].\n');
			const hidden = await root.getDirectoryHandle('.git', { create: true });
			await write(hidden, 'config.org', '* not a note\n');
			return root;
		};
	});
	await page.goto('app#/vaults');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await page.getByRole('button', { name: 'Choose folder…' }).click();
	await expect(page.getByRole('heading', { level: 1, name: /^Good / })).toBeVisible();
	await expect(
		page.getByText('Folder on this computer').or(page.getByText('saved to disk')).first(),
	).toBeAttached();

	await page.goto('app#/node/g1');
	await expect(page.getByRole('heading', { level: 1, name: 'Garden' })).toBeVisible();
	await page.getByRole('button', { name: /^TODO\. Change task state/ }).click();
	await page.getByRole('menuitemradio', { name: 'DONE' }).click();

	const read = () =>
		page.evaluate(async () => {
			const opfs = await navigator.storage.getDirectory();
			const root = await opfs.getDirectoryHandle('my-notes');
			return (await (await root.getFileHandle('garden.org')).getFile()).text();
		});
	await expect.poll(read).toContain('* DONE Plant garlic');

	await page.goto('app#/changes');
	await expect(page.getByText(/saved straight to its files/)).toBeVisible();
	await page.goto('app#/vaults');
	await expect(page.getByText('Folder on this computer', { exact: true })).toBeVisible();
});
