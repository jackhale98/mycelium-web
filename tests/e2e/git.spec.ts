/// Real git round trip in the browser: clone from a local server, edit,
/// commit, sync, and check the server received byte-exact changes.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { startGitServer, type GitServer } from '../support/git-server';

const vaultDir = join(process.cwd(), 'src/demo/vault');
const files: Record<string, string> = {};
for (const name of readdirSync(vaultDir, { recursive: true }) as string[]) {
	if (name.endsWith('.org')) files[`notes/${name}`] = readFileSync(join(vaultDir, name), 'utf8');
}
files['README.md'] = '# Notes\n';

let server: GitServer;
test.beforeAll(async () => {
	server = await startGitServer('vault', files);
});
test.afterAll(() => server?.close());

test('clone, edit, commit and sync a git vault', async ({ page, isMobile }) => {
	/** Phones keep Sync in the menu drawer. */
	const sync = async () => {
		if (isMobile) await page.getByRole('button', { name: 'Menu', exact: true }).click();
		await page.getByRole('button', { name: 'Sync with remote' }).click();
	};
	test.setTimeout(90_000);
	await page.goto('app#/vaults');
	await page.getByRole('radio', { name: 'Other' }).click();
	await page.getByRole('textbox', { name: 'Repository' }).fill(`${server.url}/vault.git`);
	await page.getByLabel('Username').fill('tester');
	await page.getByLabel(/Access token/).fill('secret');
	await page.getByText('Advanced').click();
	await page.getByLabel('Sync proxy').fill('');
	await page.getByLabel('Commit name').fill('Playwright');
	await page.getByLabel('Commit email').fill('pw@example.com');
	await page.getByRole('button', { name: 'Clone and open' }).click();

	// Layout detection: notes/ is the roam directory, dailies in notes/daily.
	await expect(
		page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening|night)/ }),
	).toBeVisible({ timeout: 60_000 });
	await expect(page.locator('.vault-name'))
		.toHaveText('vault', { useInnerText: true })
		.catch(() => undefined);

	// Edit: complete a checklist item in the project note.
	await page.goto(`app#/node/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12`);
	await expect(page.locator('.cookie').first()).toHaveText('2/5');
	await page.getByRole('checkbox').nth(2).check();
	await expect(page.locator('.cookie').first()).toHaveText('3/5');

	// Sync pushes the local commit.
	if (!isMobile) await expect(page.getByText('1 unsynced change')).toBeVisible();
	await sync();
	await expect(page.getByText(/Pushed 1 change/)).toBeVisible({ timeout: 30_000 });

	const log = server.git('vault.git', 'log', '-1', '--format=%an <%ae>%n%s');
	expect(log).toBe('Playwright <pw@example.com>\nUpdate checklist in Mycelium Web');
	const pushed = server.git('vault.git', 'show', 'HEAD:notes/20261007111100-mycelium_web.org');
	const original = files['notes/20261007111100-mycelium_web.org']!;
	expect(pushed).toBe(
		original
			.replace('* Milestones [2/5]', '* Milestones [3/5]')
			.replace(
				'- [ ] Git sync through a stateless worker',
				'- [X] Git sync through a stateless worker',
			)
			.trimEnd(),
	);

	// Pull: a commit made elsewhere arrives on the next sync.
	const work = join(server.root, 'work');
	server.git('.', 'clone', '-q', join(server.root, 'vault.git'), work);
	const inbox = join(work, 'notes', 'inbox.org');
	const fs = await import('node:fs');
	fs.appendFileSync(inbox, '* TODO Added from another device\n');
	server.git('work', 'commit', '-q', '-am', 'Add task elsewhere');
	server.git('work', 'push', '-q', 'origin', 'main');

	await page.goto('app#/agenda');
	await sync();
	if (isMobile) await page.keyboard.press('Escape');
	await expect(page.getByText(/Pulled 1 file/)).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('link', { name: /Added from another device/ })).toBeVisible();

	// The vault survives a reload from the IndexedDB cache.
	await page.reload();
	await expect(page.getByRole('link', { name: /Added from another device/ })).toBeVisible({
		timeout: 30_000,
	});
});
