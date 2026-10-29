/// OneDrive/SharePoint and WebDAV vaults end to end, with the services
/// simulated (Microsoft Graph, and a WebDAV server behind the sync relay).
/// Needs a build with PUBLIC_ONEDRIVE_CLIENT_ID and
/// PUBLIC_GIT_PROXY=https://sync.example.test (each test skips otherwise).

import { expect, test, type Page, type Route } from '@playwright/test';
import { FakeDav } from '../support/fake-dav';
import { FakeGraph } from '../support/fake-graph';

const RELAY = 'https://sync.example.test/dav/';
const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const daily = (body: string) => `:PROPERTIES:\n:ID: day-1\n:END:\n#+title: ${today}\n${body}`;
const garden = (body: string) => `:PROPERTIES:\n:ID: garden-1\n:END:\n#+title: Garden\n\n${body}`;
const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };

async function vaults(page: Page) {
	await page.goto('app#/vaults');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
}

async function captureAndOpenToday(page: Page, text: string) {
	await page.goto('app#/');
	await page.getByLabel(/Capture a thought/).fill(text);
	await page.getByRole('button', { name: 'Capture', exact: true }).click();
}

test('a Nextcloud folder over WebDAV, through the relay', async ({ page }) => {
	const server = new FakeDav('/remote.php/dav/files/ada', {
		nextcloud: true,
		user: 'ada',
		pass: 'app-pass',
	});
	server.put('/Notes/garden.org', garden('* TODO Plant tulips\n'));
	server.put(`/Notes/daily/${today}.org`, daily(''));
	server.put('/Photos/cat.org', '#+title: Not notes\n');

	await vaults(page);
	await page.route(`${RELAY}**`, async (route: Route) => {
		const req = route.request();
		const url = new URL(req.url());
		const [, , host, ...rest] = url.pathname.split('/');
		expect(host).toBe('cloud.test');
		const r = server.handle(
			req.method(),
			`/${rest.join('/')}`,
			req.headers(),
			req.postData() ?? '',
		);
		await route.fulfill({ status: r.status, headers: { ...cors, ...r.headers }, body: r.body });
	});

	await page.getByRole('button', { name: 'Connect WebDAV / Nextcloud' }).click();
	await page.getByLabel('Server address').fill('https://cloud.test');
	await page.getByLabel('User name').fill('ada');
	await page.getByLabel('App password').fill('wrong');
	await page.getByRole('button', { name: 'Connect', exact: true }).click();
	await expect(page.getByRole('alert')).toContainText('refused the user name or password');
	await page.getByLabel('App password').fill('app-pass');
	await page.getByRole('button', { name: 'Connect', exact: true }).click();

	await page.getByRole('button', { name: 'Notes' }).click();
	await expect(page.getByText('1 org file here')).toBeVisible();
	await page.getByRole('button', { name: 'Use Notes' }).click();
	await expect(page).toHaveURL(/#\/$/, { timeout: 15_000 });

	await page.goto('app#/node/garden-1');
	await expect(page.getByRole('heading', { name: 'Plant tulips' })).toBeVisible();

	await captureAndOpenToday(page, 'Captured over WebDAV');
	await expect
		.poll(() => server.text(`/Notes/daily/${today}.org`), { timeout: 15_000 })
		.toContain('Captured over WebDAV');
	// Written against the file's ETag.
	expect(server.requests.find((r) => r.method === 'PUT')?.headers['if-match']).toMatch(/^"e\d+"$/);

	server.put('/Notes/garden.org', garden('* DONE Plant tulips\n* TODO Water roses\n'));
	await page.goto('app#/changes');
	await expect(page.getByRole('heading', { name: 'WebDAV' })).toBeVisible();
	await page.getByRole('button', { name: 'Sync now' }).click();
	await expect(page.getByText('Everything is in WebDAV.')).toBeVisible();
	await page.goto('app#/node/garden-1');
	await expect(page.getByRole('heading', { name: 'Water roses' })).toBeVisible();
	await page.goto('app#/settings/vault');
	await expect(page.getByRole('heading', { name: 'cloud.test' })).toBeVisible();
	await expect(page.getByText('through the sync relay')).toBeVisible();
});

test('a SharePoint document library, signed in with Microsoft', async ({ page }) => {
	await vaults(page);
	const button = page.getByRole('button', { name: 'Connect SharePoint' });
	test.skip((await button.count()) === 0, 'build has no OneDrive client id');

	const graph = new FakeGraph();
	graph.put('/Notes/garden.org', garden('* TODO Plant tulips\n'));
	graph.put(`/Notes/daily/${today}.org`, daily(''));
	let scopes = '';
	await page.route(
		'https://login.microsoftonline.com/common/oauth2/v2.0/authorize**',
		async (route) => {
			const url = new URL(route.request().url());
			scopes = url.searchParams.get('scope') ?? '';
			const back = new URL(url.searchParams.get('redirect_uri')!);
			back.searchParams.set('code', 'ms-code');
			back.searchParams.set('state', url.searchParams.get('state')!);
			await route.fulfill({ status: 302, headers: { location: back.toString() } });
		},
	);
	await page.route('https://login.microsoftonline.com/common/oauth2/v2.0/token', (route) =>
		route.fulfill({
			status: 200,
			headers: { ...cors, 'content-type': 'application/json' },
			body: JSON.stringify({ access_token: 'ey.test', refresh_token: 'r', expires_in: 3600 }),
		}),
	);
	const viaGraph = async (route: Route) => {
		const req = route.request();
		const res = await graph.fetch(req.url(), {
			method: req.method(),
			headers: req.headers(),
			...(req.postDataBuffer() ? { body: new Uint8Array(req.postDataBuffer()!) } : {}),
		});
		await route.fulfill({
			status: res.status,
			headers: { ...cors, 'content-type': 'application/json' },
			body: res.status === 204 ? '' : await res.text(),
		});
	};
	await page.route('https://graph.microsoft.com/**', viaGraph);
	await page.route('https://download.test/**', viaGraph);

	await button.click();
	await expect(page.getByRole('heading', { name: /Where are your notes/ })).toBeVisible({
		timeout: 15_000,
	});
	expect(scopes).toContain('Sites.Read.All');
	await expect(page.getByText('ada@contoso.test')).toBeVisible();
	await page.getByRole('button', { name: 'Team notes' }).click();
	await page.getByRole('button', { name: 'Documents' }).click();
	await page.getByRole('button', { name: 'Notes' }).click();
	await page.getByRole('button', { name: 'Use Notes' }).click();
	await expect(page).toHaveURL(/#\/$/, { timeout: 15_000 });

	await page.goto('app#/node/garden-1');
	await expect(page.getByRole('heading', { name: 'Plant tulips' })).toBeVisible();

	await captureAndOpenToday(page, 'Captured to SharePoint');
	await expect
		.poll(() => graph.find(`/Notes/daily/${today}.org`)?.text, { timeout: 15_000 })
		.toContain('Captured to SharePoint');

	graph.put('/Notes/garden.org', garden('* DONE Plant tulips\n* TODO Water roses\n'));
	await page.goto('app#/changes');
	await page.getByRole('button', { name: 'Sync now' }).click();
	await expect(page.getByText('Everything is in OneDrive.')).toBeVisible();
	await page.goto('app#/node/garden-1');
	await expect(page.getByRole('heading', { name: 'Water roses' })).toBeVisible();
	await page.goto('app#/settings/vault');
	await expect(
		page.getByRole('heading', { name: 'SharePoint · Team notes › Documents' }),
	).toBeVisible();
});

test('a running clock survives closing and reopening the app (WebDAV)', async ({ page }) => {
	const server = new FakeDav('/dav', { user: 'ada', pass: 'pw' });
	server.put('/Notes/garden.org', garden('* TODO Plant tulips\n'));
	await vaults(page);
	await page.route(`${RELAY}**`, async (route: Route) => {
		const req = route.request();
		const [, , , ...rest] = new URL(req.url()).pathname.split('/');
		const r = server.handle(
			req.method(),
			`/${rest.join('/')}`,
			req.headers(),
			req.postData() ?? '',
		);
		await route.fulfill({ status: r.status, headers: { ...cors, ...r.headers }, body: r.body });
	});
	const button = page.getByRole('button', { name: 'Connect WebDAV / Nextcloud' });
	test.skip((await button.count()) === 0, 'build has no relay');
	await button.click();
	await page.getByLabel('Server address').fill('https://cloud.test/dav');
	await page.getByLabel('User name').fill('ada');
	await page.getByLabel('App password').fill('pw');
	await page.getByRole('button', { name: 'Connect', exact: true }).click();
	await page.getByRole('button', { name: 'Notes' }).click();
	await page.getByRole('button', { name: 'Use Notes' }).click();
	await expect(page).toHaveURL(/#\/$/, { timeout: 15_000 });

	await page.goto('app#/node/garden-1');
	const section = page.locator('.org-section', { hasText: 'Plant tulips' }).first();
	await section.getByRole('button', { name: /Edit heading/ }).press('Enter');
	await page.getByRole('button', { name: 'Clock in' }).click();
	await expect(page.locator('.clockbar')).toContainText('Plant tulips');

	// Closed straight away (before the upload), then reopened.
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.locator('.clockbar')).toContainText('Plant tulips');
	await expect
		.poll(() => server.text('/Notes/garden.org'), { timeout: 15_000 })
		.toMatch(/CLOCK: \[\d{4}-\d\d-\d\d \w{3} \d\d:\d\d\]\n/);
	// And again once uploaded.
	await page.reload();
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	await expect(page.locator('.clockbar')).toContainText('Plant tulips');
});
