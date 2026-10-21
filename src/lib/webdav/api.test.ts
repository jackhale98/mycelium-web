import { describe, expect, it } from 'vitest';
import { FakeDav } from '../../../tests/support/fake-dav';
import { syncFolder, type Base } from '$lib/sync/engine';
import { RemoteAuthError, RemoteConflict } from '$lib/sync/remote';
import { nextcloudUrl, parseMultistatus, WebDav } from './api';

const ROOT = '/remote.php/dav/files/ada';
const dav = (server: FakeDav, proxy: string | null = null) =>
	new WebDav(
		{ url: `https://cloud.test${ROOT}/`, username: 'ada', password: 'pässword', proxy },
		server.fetch,
	);

describe('parseMultistatus', () => {
	it('reads hrefs, collections and ETags whatever the namespace prefix', () => {
		const xml = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:">
 <D:response><D:href>https://cloud.test/dav/Notes/</D:href>
  <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype><D:getetag>"f1"</D:getetag></D:prop></D:propstat></D:response>
 <D:response><D:href>/dav/Notes/caf%C3%A9%20%26%20tea.org</D:href>
  <D:propstat><D:prop><D:resourcetype/></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  <D:propstat><D:prop><D:getetag/></D:prop><D:status>HTTP/1.1 404</D:status></D:propstat>
  <D:propstat><D:prop><D:getetag>W/&quot;abc&quot;</D:getetag></D:prop></D:propstat></D:response>
</D:multistatus>`;
		expect(parseMultistatus(xml, '/dav')).toEqual([
			{ path: '/Notes', folder: true, etag: '"f1"' },
			{ path: '/Notes/café & tea.org', folder: false, etag: 'W/"abc"' },
		]);
	});

	it('builds Nextcloud addresses', () => {
		expect(nextcloudUrl('https://cloud.test/', 'ada')).toBe(
			'https://cloud.test/remote.php/dav/files/ada/',
		);
		expect(nextcloudUrl('https://cloud.test/remote.php/webdav', 'ada')).toBe(
			'https://cloud.test/remote.php/webdav/',
		);
	});
});

describe('WebDav', () => {
	it('sends requests through the relay, with UTF-8 basic auth', async () => {
		const server = new FakeDav(ROOT, { user: 'ada', pass: 'pässword' });
		server.put('/Notes/a.org', 'A');
		const calls: string[] = [];
		const client = new WebDav(
			{
				url: `https://cloud.test${ROOT}`,
				username: 'ada',
				password: 'pässword',
				proxy: 'https://w.test/dav/',
			},
			(async (u: string, i: RequestInit) => {
				calls.push(u);
				return server.fetch(
					`https://cloud.test${new URL(u).pathname.replace('/dav/cloud.test', '')}`,
					i,
				);
			}) as unknown as typeof fetch,
		);
		expect((await client.download('/Notes/a.org')).text).toBe('A');
		expect(calls[0]).toBe(`https://w.test/dav/cloud.test${ROOT}/Notes/a.org`);
		const bad = new WebDav({ ...client.config, password: 'nope', proxy: null }, server.fetch);
		await expect(bad.download('/Notes/a.org')).rejects.toBeInstanceOf(RemoteAuthError);
	});

	it('lists a folder tree and every listing is complete', async () => {
		const server = new FakeDav(ROOT);
		server.put('/Notes/a.org', 'A');
		server.put('/Notes/daily/d.org', 'D');
		server.put('/Notes/.hidden/h.org', 'H');
		const r = await dav(server).listAll({ path: '/Notes' });
		expect(r.complete).toBe(true);
		expect(r.entries.map((e) => e.path).sort()).toEqual(['/Notes/a.org', '/Notes/daily/d.org']);
		const again = await dav(server).listAll({ cursor: r.cursor });
		expect(again.complete).toBe(true);
		expect(again.entries).toHaveLength(2);
	});

	it('skips unchanged folders on Nextcloud, and only there', async () => {
		for (const nextcloud of [true, false]) {
			const server = new FakeDav(ROOT, { nextcloud });
			server.put('/Notes/a.org', 'A');
			server.put('/Notes/daily/d.org', 'D');
			server.put('/Notes/projects/p.org', 'P');
			const client = dav(server);
			const first = await client.listAll({ path: '/Notes' });
			server.put('/Notes/projects/p.org', 'P2');
			server.requests = [];
			const r = await client.listAll({ cursor: first.cursor });
			const listed = server.requests.filter((q) => q.method === 'PROPFIND').map((q) => q.path);
			expect(listed.includes('/Notes/daily')).toBe(!nextcloud);
			expect(listed).toContain('/Notes/projects');
			expect(r.entries.map((e) => e.path).sort()).toEqual([
				'/Notes/a.org',
				'/Notes/daily/d.org',
				'/Notes/projects/p.org',
			]);
		}
	});

	it('writes against the ETag, creates missing folders, and refuses blind overwrites', async () => {
		const server = new FakeDav(ROOT);
		server.put('/Notes/a.org', 'A');
		const client = dav(server);
		const { rev } = await client.download('/Notes/a.org');
		const next = await client.upload('/Notes/a.org', 'A2', rev);
		expect(next.rev).toBe(server.files.get('/Notes/a.org')!.etag);
		await expect(client.upload('/Notes/a.org', 'A3', rev)).rejects.toBeInstanceOf(RemoteConflict);
		await expect(client.upload('/Notes/a.org', 'new', null)).rejects.toBeInstanceOf(RemoteConflict);
		await client.upload('/Notes/new/deep/b.org', 'B', null);
		expect(server.text('/Notes/new/deep/b.org')).toBe('B');
		await expect(client.delete('/Notes/a.org', rev)).rejects.toBeInstanceOf(RemoteConflict);
		await client.delete('/Notes/a.org', next.rev);
		await client.delete('/Notes/a.org', null);
		expect(server.text('/Notes/a.org')).toBeUndefined();
	});

	it('checks weak ETags before writing, since If-Match can never match them', async () => {
		const server = new FakeDav(ROOT, { weak: true });
		server.put('/Notes/a.org', 'A');
		const client = dav(server);
		const { rev } = await client.download('/Notes/a.org');
		expect(rev.startsWith('W/')).toBe(true);
		await client.upload('/Notes/a.org', 'A2', rev);
		expect(server.text('/Notes/a.org')).toBe('A2');
		await expect(client.upload('/Notes/a.org', 'A3', rev)).rejects.toBeInstanceOf(RemoteConflict);
	});

	it('syncs two devices through the engine, merging their edits', async () => {
		const server = new FakeDav(ROOT, { nextcloud: true });
		server.put('/Notes/list.org', '* TODO one\n* TODO two\n');
		const device = () => ({
			files: new Map<string, string>(),
			bases: new Map<string, Base>(),
			cursor: null as string | null,
			pending: new Set<string>(),
		});
		const run = async (d: ReturnType<typeof device>) => {
			const r = await syncFolder({
				api: dav(server),
				root: '/Notes',
				cursor: d.cursor,
				pending: d.pending,
				include: (p) => p.endsWith('.org'),
				caseSensitive: true,
				store: {
					local: async (p) => d.files.get(p) ?? null,
					paths: async () => [...d.files.keys()],
					bases: async () => new Map(d.bases),
				},
			});
			for (const w of r.writes)
				if (w.source === null) d.files.delete(w.path);
				else d.files.set(w.path, w.source);
			for (const [p, b] of r.bases)
				if (b) d.bases.set(p, b);
				else d.bases.delete(p);
			d.cursor = r.cursor;
			d.pending = new Set(r.pending);
			return r;
		};
		const phone = device();
		const laptop = device();
		await run(phone);
		await run(laptop);
		laptop.files.set('list.org', '* DONE one\n* TODO two\n');
		laptop.pending.add('list.org');
		await run(laptop);
		phone.files.set('list.org', '* TODO one\n* DONE two\n');
		phone.pending.add('list.org');
		expect((await run(phone)).conflicts).toEqual([]);
		expect(server.text('/Notes/list.org')).toBe('* DONE one\n* DONE two\n');
		server.files.delete('/Notes/list.org');
		await run(laptop);
		expect(laptop.files.has('list.org')).toBe(false);
	});
});
