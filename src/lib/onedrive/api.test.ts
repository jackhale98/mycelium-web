import { describe, expect, it } from 'vitest';
import { RemoteConflict } from '$lib/sync/remote';
import { FakeGraph } from '../../../tests/support/fake-graph';
import { GraphDrive, graphPath, microsoftAuthorizeUrl, parentPath } from './api';

const drive = (g: FakeGraph) => new GraphDrive('d1', async () => 'tok', g.fetch);

describe('Graph paths', () => {
	it('encodes path segments and reads parent references', () => {
		expect(graphPath('/Notes/a b/c#d.org')).toBe('Notes/a%20b/c%23d.org');
		expect(parentPath('/drive/root:/Notes/daily')).toBe('/Notes/daily');
		expect(parentPath('/drives/abc/root:')).toBe('');
		expect(parentPath('/drive/root:/caf%C3%A9')).toBe('/café');
		expect(parentPath(undefined)).toBeNull();
	});
});

describe('GraphDrive', () => {
	it('lists a folder recursively, ignoring hidden folders', async () => {
		const g = new FakeGraph();
		g.put('/Notes/a.org', 'A');
		g.put('/Notes/daily/2026-10-21.org', 'D');
		g.put('/Notes/.trash/old.org', 'X');
		g.put('/Other/b.org', 'B');
		const r = await drive(g).listAll({ path: '/Notes' });
		expect(r.complete).toBe(true);
		expect(r.entries.map((e) => e.path).sort()).toEqual([
			'/Notes/a.org',
			'/Notes/daily/2026-10-21.org',
		]);
	});

	it('follows changes under the folder only', async () => {
		const g = new FakeGraph();
		g.put('/Notes/a.org', 'A');
		const d = drive(g);
		const first = await d.listAll({ path: '/Notes' });
		g.put('/Notes/a.org', 'A2');
		g.put('/Other/b.org', 'B');
		const r = await d.listAll({ cursor: first.cursor });
		expect(r.complete).toBeUndefined();
		expect(r.entries).toEqual([
			expect.objectContaining({
				tag: 'file',
				path: '/Notes/a.org',
				rev: g.find('/Notes/a.org')!.eTag,
			}),
		]);
		// And nothing new after that.
		expect((await d.listAll({ cursor: r.cursor })).entries).toEqual([]);
	});

	it('lists the files of a folder that appears, and places deletions', async () => {
		const g = new FakeGraph();
		g.put('/Notes/a.org', 'A');
		const d = drive(g);
		const first = await d.listAll({ path: '/Notes' });
		g.put('/Notes/projects/p.org', 'P');
		await d.delete('/Notes/a.org', null);
		const r = await d.listAll({ cursor: first.cursor });
		expect(r.entries.map((e) => `${e.tag} ${e.path}`)).toEqual(
			expect.arrayContaining(['file /Notes/projects/p.org', 'deleted /Notes/a.org']),
		);
	});

	it('lists everything again when a folder is renamed or a deletion can’t be placed', async () => {
		const g = new FakeGraph();
		g.put('/Notes/daily/x.org', 'X');
		const d = drive(g);
		const first = await d.listAll({ path: '/Notes' });
		const daily = g.find('/Notes/daily')!;
		g.nodes.set(daily.id, { ...daily, name: 'journal' });
		g.changes.push(g.item(daily.id));
		const r = await d.listAll({ cursor: first.cursor });
		expect(r.complete).toBe(true);
		expect(r.entries.map((e) => e.path)).toEqual(['/Notes/journal/x.org']);

		g.changes.push({ id: 'unknown', deleted: {} });
		expect((await d.listAll({ cursor: r.cursor })).complete).toBe(true);
	});

	it('downloads through the pre-signed link, without the bearer token', async () => {
		const g = new FakeGraph();
		const n = g.put('/Notes/a.org', '* Hi\n');
		expect(await drive(g).download('/Notes/a.org')).toEqual({ text: '* Hi\n', rev: n.eTag });
		const last = g.calls.at(-1)!;
		expect(last.url).toBe(`https://download.test/${n.id}`);
		expect(last.headers.Authorization).toBeUndefined();
	});

	it('uploads against the eTag, and refuses to replace a file it didn’t know about', async () => {
		const g = new FakeGraph();
		const n = g.put('/Notes/a.org', 'A');
		const d = drive(g);
		const { rev } = await d.upload('/Notes/a.org', 'A2', n.eTag);
		expect(rev).toBe(g.find('/Notes/a.org')!.eTag);
		await expect(d.upload('/Notes/a.org', 'A3', n.eTag)).rejects.toBeInstanceOf(RemoteConflict);
		await expect(d.upload('/Notes/a.org', 'new', null)).rejects.toBeInstanceOf(RemoteConflict);
		await d.upload('/Notes/new folder/b.org', 'B', null);
		expect(g.find('/Notes/new folder/b.org')!.text).toBe('B');
		expect(g.calls.some((c) => c.url.includes('Notes/new%20folder/b.org:/content'))).toBe(true);
	});

	it('deletes only the version it knew', async () => {
		const g = new FakeGraph();
		g.put('/Notes/a.org', 'A');
		const d = drive(g);
		await expect(d.delete('/Notes/a.org', 'stale')).rejects.toBeInstanceOf(RemoteConflict);
		await d.delete('/Notes/a.org', g.find('/Notes/a.org')!.eTag);
		await d.delete('/Notes/a.org', null);
		expect(g.find('/Notes/a.org')).toBeUndefined();
	});

	it('browses folders and counts org files', async () => {
		const g = new FakeGraph();
		g.put('/Notes/a.org', 'A');
		g.put('/Notes/b.txt', 'B');
		g.put('/Notes/daily/x.org', 'X');
		expect(await drive(g).browse('/Notes')).toEqual({
			folders: [{ name: 'daily', path: '/Notes/daily' }],
			orgFiles: 1,
		});
	});
});

describe('Microsoft sign-in', () => {
	it('asks for a code with PKCE and the given scopes', () => {
		const url = new URL(
			microsoftAuthorizeUrl('cid', 'https://x.test/cb/', 's', 'c', 'offline_access User.Read'),
		);
		expect(url.origin + url.pathname).toBe(
			'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
		);
		expect(Object.fromEntries(url.searchParams)).toMatchObject({
			client_id: 'cid',
			response_type: 'code',
			response_mode: 'query',
			redirect_uri: 'https://x.test/cb/',
			scope: 'offline_access User.Read',
			code_challenge: 'c',
			code_challenge_method: 'S256',
		});
	});
});
