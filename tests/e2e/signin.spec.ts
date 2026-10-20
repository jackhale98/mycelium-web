/// GitHub sign-in end to end, with GitHub and the worker simulated. Needs a
/// build with PUBLIC_GITHUB_CLIENT_ID and PUBLIC_GIT_PROXY=https://sync.example.test
/// (skipped otherwise).

import { expect, test, type Page } from '@playwright/test';
import { startGitServer, type GitServer } from '../support/git-server';

const WORKER = 'https://sync.example.test';

let mine: GitServer;
test.beforeAll(async () => {
	mine = await startGitServer('mine', { 'notes/garden.org': '#+title: My garden\n' });
});
test.afterAll(() => mine?.close());

async function fakeGitHub(page: Page) {
	await page.route('https://github.com/login/oauth/authorize**', async (route) => {
		const url = new URL(route.request().url());
		const back = new URL(url.searchParams.get('redirect_uri')!);
		back.searchParams.set('code', 'the-code');
		back.searchParams.set('state', url.searchParams.get('state')!);
		await route.fulfill({ status: 302, headers: { location: back.toString() } });
	});
	const json = (body: unknown) => ({
		status: 200,
		headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	await page.route(`${WORKER}/oauth/github/token`, (r) =>
		r.fulfill(json({ access_token: 'ghu_test', refresh_token: 'ghr_test', expires_in: 28800 })),
	);
	await page.route('https://api.github.com/user', (r) =>
		r.fulfill(json({ login: 'octo', id: 1, name: 'Octo Cat' })),
	);
	await page.route('https://api.github.com/user/installations**', (r) =>
		r.request().url().includes('/repositories')
			? r.fulfill(
					json({
						repositories: [
							{
								full_name: 'octo/roam',
								private: true,
								default_branch: 'master',
								clone_url: 'https://github.com/octo/roam.git',
								updated_at: '2026-10-20T00:00:00Z',
							},
						],
					}),
				)
			: r.fulfill(json({ installations: [{ id: 7 }] })),
	);
}

async function signIn(page: Page) {
	await page.goto('app#/vaults');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	const button = page.getByRole('button', { name: 'Sign in with GitHub' });
	test.skip((await button.count()) === 0, 'build has no GitHub client id');
	await fakeGitHub(page);
	await button.click();
	await expect(page).toHaveURL(/#\/vaults/, { timeout: 15_000 });
	// The list must stay up while the app reopens the vault behind it.
	await expect(page.getByText('octo/roam')).toBeVisible({ timeout: 15_000 });
	await page.waitForTimeout(1500);
	await expect(page.getByText('octo/roam')).toBeVisible();
	await expect(page.getByText('GitHub · octo')).toBeVisible();
}

test('sign in with GitHub from the demo lists your repositories', async ({ page }) => {
	await signIn(page);
});

test('sign in with GitHub while a git vault is open', async ({ page }) => {
	await page.goto('app#/vaults');
	await page.getByRole('radio', { name: 'Other' }).click();
	await page.getByRole('textbox', { name: 'Repository' }).fill(`${mine.url}/mine.git`);
	await page.getByText('Advanced').click();
	await page.getByLabel('Sync proxy').fill('');
	await page.getByRole('button', { name: 'Clone and open' }).click();
	await expect(
		page.getByRole('heading', { level: 1, name: /Good (morning|afternoon|evening|night)/ }),
	).toBeVisible({ timeout: 30_000 });
	await signIn(page);
});

test('coming back from installing the GitHub App signs in and lists repositories', async ({
	page,
}) => {
	await page.goto('app#/vaults');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	test.skip(
		(await page.getByRole('button', { name: 'Sign in with GitHub' }).count()) === 0,
		'build has no GitHub client id',
	);
	await fakeGitHub(page);
	// GitHub's own redirect after installation: a code, but no state of ours.
	await page.goto('auth/callback/?code=from-install&installation_id=7&setup_action=install');
	await expect(page).toHaveURL(/app#\/vaults/, { timeout: 15_000 });
	await expect(page.getByText('octo/roam')).toBeVisible({ timeout: 15_000 });
	await expect(page.getByText(/sign-in has expired/)).toHaveCount(0);
});
