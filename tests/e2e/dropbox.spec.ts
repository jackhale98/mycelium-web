/// Dropbox vaults end to end, with Dropbox simulated: connect, choose a
/// folder, edits upload on their own, changes from elsewhere come in, and
/// overlapping edits open the resolver. Needs a build with
/// PUBLIC_DROPBOX_APP_KEY (skipped otherwise).

import { expect, test, type Page, type Route } from '@playwright/test';

type File = { path: string; rev: string; text: string };

/** A small in-memory Dropbox behind page.route. */
class FakeDropbox {
	files = new Map<string, File>();
	log: Record<string, unknown>[] = [];
	uploads: { path: string; text: string; mode: unknown }[] = [];
	#rev = 0;

	put(path: string, text: string) {
		const rev = `rev${String(++this.#rev).padStart(4, '0')}`;
		this.files.set(path.toLowerCase(), { path, rev, text });
		this.log.push(this.#meta({ path, rev, text }));
		return rev;
	}
	text(path: string) {
		return this.files.get(path.toLowerCase())?.text;
	}
	#meta(f: File) {
		return {
			'.tag': 'file',
			name: f.path.split('/').pop(),
			path_display: f.path,
			path_lower: f.path.toLowerCase(),
			rev: f.rev,
		};
	}

	async install(page: Page) {
		const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': '*' };
		const json = (route: Route, body: unknown, status = 200) =>
			route.fulfill({
				status,
				headers: { ...cors, 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});

		await page.route('https://www.dropbox.com/oauth2/authorize**', async (route) => {
			const url = new URL(route.request().url());
			const back = new URL(url.searchParams.get('redirect_uri')!);
			back.searchParams.set('code', 'dbx-code');
			back.searchParams.set('state', url.searchParams.get('state')!);
			await route.fulfill({ status: 302, headers: { location: back.toString() } });
		});
		await page.route('https://api.dropboxapi.com/oauth2/token', (route) =>
			json(route, { access_token: 'sl.test', refresh_token: 'refresh', expires_in: 14400 }),
		);
		await page.route('https://api.dropboxapi.com/2/**', async (route) => {
			const endpoint = new URL(route.request().url()).pathname.replace('/2/', '');
			const body = route.request().postData() ? JSON.parse(route.request().postData()!) : null;
			if (endpoint === 'users/get_current_account')
				return json(route, { name: { display_name: 'Ada' }, email: 'ada@example.com' });
			if (endpoint === 'files/list_folder') {
				const prefix = (body.path as string).toLowerCase();
				const under = [...this.files.values()].filter((f) =>
					f.path.toLowerCase().startsWith(`${prefix}/`),
				);
				let entries: Record<string, unknown>[];
				if (body.recursive) entries = under.map((f) => this.#meta(f));
				else {
					const folders = new Map<string, string>();
					entries = [];
					for (const f of under) {
						const rest = f.path.slice(prefix.length + 1).split('/');
						if (rest.length === 1) entries.push(this.#meta(f));
						else
							folders.set(rest[0]!.toLowerCase(), `${f.path.slice(0, prefix.length)}/${rest[0]}`);
					}
					for (const path of folders.values())
						entries.push({
							'.tag': 'folder',
							path_display: path,
							path_lower: path.toLowerCase(),
						});
				}
				return json(route, { entries, cursor: String(this.log.length), has_more: false });
			}
			if (endpoint === 'files/list_folder/continue')
				return json(route, {
					entries: this.log.slice(Number(body.cursor)),
					cursor: String(this.log.length),
					has_more: false,
				});
			if (endpoint === 'files/delete_v2') {
				this.files.delete((body.path as string).toLowerCase());
				this.log.push({
					'.tag': 'deleted',
					path_display: body.path,
					path_lower: body.path.toLowerCase(),
				});
				return json(route, { metadata: {} });
			}
			return json(route, { error_summary: 'unsupported/' }, 400);
		});
		await page.route('https://content.dropboxapi.com/2/**', async (route) => {
			const endpoint = new URL(route.request().url()).pathname.replace('/2/', '');
			const arg = JSON.parse(route.request().headers()['dropbox-api-arg']!);
			if (endpoint === 'files/download') {
				const f = this.files.get((arg.path as string).toLowerCase());
				if (!f) return json(route, { error_summary: 'path/not_found/' }, 409);
				return route.fulfill({
					status: 200,
					headers: {
						...cors,
						'content-type': 'application/octet-stream',
						'dropbox-api-result': JSON.stringify(this.#meta(f)),
					},
					body: f.text,
				});
			}
			if (endpoint === 'files/upload') {
				const text = route.request().postDataBuffer()!.toString('utf8');
				const current = this.files.get((arg.path as string).toLowerCase());
				const mode = arg.mode as { '.tag': string; update?: string };
				if (mode['.tag'] === 'update' ? current?.rev !== mode.update : current)
					return json(route, { error_summary: 'path/conflict/file/' }, 409);
				this.uploads.push({ path: arg.path, text, mode });
				const rev = this.put(arg.path, text);
				return json(route, { ...this.#meta({ path: arg.path, rev, text }) });
			}
			return json(route, { error_summary: 'unsupported/' }, 400);
		});
	}
}

const pad = (n: number) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

async function connect(page: Page, dbx: FakeDropbox) {
	await page.goto('app#/vaults');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });
	const button = page.getByRole('button', { name: 'Connect Dropbox' });
	test.skip((await button.count()) === 0, 'build has no Dropbox app key');
	await dbx.install(page);
	await button.click();
	await expect(page.getByRole('heading', { name: /Choose your notes folder/ })).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByText('Dropbox · ada@example.com')).toBeVisible();
	await page.getByRole('button', { name: 'Notes' }).click();
	await expect(page.getByText('2 org files here')).toBeVisible();
	await page.getByRole('button', { name: 'Use Notes' }).click();
	await expect(page).toHaveURL(/#\/$/, { timeout: 15_000 });
}

const daily = (body: string) => `:PROPERTIES:\n:ID: day-1\n:END:\n#+title: ${today}\n${body}`;

function seed() {
	const dbx = new FakeDropbox();
	dbx.put(
		'/Notes/garden.org',
		':PROPERTIES:\n:ID: garden-1\n:END:\n#+title: Garden\n\n* TODO Plant tulips\n',
	);
	dbx.put('/Notes/inbox.org', '#+title: Inbox\n');
	dbx.put(`/Notes/daily/${today}.org`, daily(''));
	dbx.put('/Elsewhere/private.org', '#+title: Not in the vault\n');
	return dbx;
}

test('connect a Dropbox folder, and edits upload on their own', async ({ page }) => {
	const dbx = seed();
	await connect(page, dbx);
	await page.goto('app#/node/garden-1');
	await expect(page.getByRole('heading', { name: 'Plant tulips' })).toBeVisible();
	await page.goto('app#/search');
	await page.getByRole('searchbox').first().fill('vault');
	await expect(page.getByText('Not in the vault')).toHaveCount(0);

	await page.goto('app#/');
	await page.getByLabel(/Capture a thought/).fill('Captured on my phone');
	await page.getByRole('button', { name: 'Capture', exact: true }).click();
	// Uploaded a few seconds later, against the revision it was downloaded at.
	await expect
		.poll(() => dbx.text(`/Notes/daily/${today}.org`), { timeout: 15_000 })
		.toContain('Captured on my phone');
	expect(dbx.uploads.at(-1)!.mode).toMatchObject({ '.tag': 'update' });

	// The vault opens again from this browser's copy, and still syncs.
	await page.goto(`app#/daily/${today}`);
	await page.reload();
	await expect(page.getByText('Captured on my phone')).toBeVisible({ timeout: 15_000 });
});

test('changes made elsewhere come in, and overlapping edits ask which to keep', async ({
	page,
}) => {
	const dbx = seed();
	await connect(page, dbx);

	// Another device edits a note.
	dbx.put(
		'/Notes/garden.org',
		':PROPERTIES:\n:ID: garden-1\n:END:\n#+title: Garden\n\n* DONE Plant tulips\n* TODO Water roses\n',
	);
	await page.goto('app#/changes');
	await page.getByRole('button', { name: 'Sync now' }).click();
	await expect(page.getByText('Everything is in Dropbox.')).toBeVisible();
	await page.goto('app#/node/garden-1');
	await expect(page.getByRole('heading', { name: 'Water roses' })).toBeVisible();

	// Both sides add to the end of today's note before the upload goes out: the
	// automatic sync after the edit finds the overlap and asks.
	await page.goto('app#/');
	await page.getByLabel(/Capture a thought/).fill('From this device');
	await page.getByRole('button', { name: 'Capture', exact: true }).click();
	dbx.put(`/Notes/daily/${today}.org`, daily('- From the laptop\n'));

	const dialog = page.getByRole('dialog', { name: 'Both sides changed the same lines' });
	await expect(dialog).toBeVisible({ timeout: 15_000 });
	await expect(dialog.getByText('From the laptop')).toBeVisible();
	await dialog.getByRole('radio', { name: 'Use theirs' }).click();
	await dialog.getByRole('button', { name: 'Merge' }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(() => dbx.text(`/Notes/daily/${today}.org`)).toBe(daily('- From the laptop\n'));
	await page.goto(`app#/daily/${today}`);
	await expect(page.getByText('From the laptop')).toBeVisible();
	await expect(page.getByText('From this device')).toHaveCount(0);
});
