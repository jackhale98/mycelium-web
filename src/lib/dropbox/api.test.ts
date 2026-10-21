import { describe, expect, it } from 'vitest';
import {
	DropboxApi,
	DropboxConflict,
	apiArg,
	dropboxAuthorizeUrl,
	exchangeDropboxCode,
	refreshDropboxToken,
} from './api';

type Call = { url: string; init: RequestInit };

function fakeFetch(responses: Response[]) {
	const calls: Call[] = [];
	const fetcher = (async (url: string, init: RequestInit) => {
		calls.push({ url, init });
		return responses.shift()!;
	}) as unknown as typeof fetch;
	return { calls, fetcher };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json', ...headers },
	});
const header = (c: Call, name: string) => (c.init.headers as Record<string, string>)[name];

describe('Dropbox API client', () => {
	it('escapes non-ASCII characters in API arguments', () => {
		expect(apiArg({ path: '/Notes/café.org' })).toBe('{"path":"/Notes/caf\\u00e9.org"}');
	});

	it('lists every page of a folder', async () => {
		const { calls, fetcher } = fakeFetch([
			json({
				entries: [{ '.tag': 'file', path_display: '/N/a.org', path_lower: '/n/a.org', rev: '1' }],
				cursor: 'c1',
				has_more: true,
			}),
			json({
				entries: [{ '.tag': 'deleted', path_display: '/N/b.org', path_lower: '/n/b.org' }],
				cursor: 'c2',
				has_more: false,
			}),
		]);
		const api = new DropboxApi(async () => 'tok', fetcher);
		const r = await api.listAll({ path: '/N' });
		expect(r.cursor).toBe('c2');
		expect(r.entries).toEqual([
			{ tag: 'file', path: '/N/a.org', pathLower: '/n/a.org', rev: '1' },
			{ tag: 'deleted', path: '/N/b.org', pathLower: '/n/b.org' },
		]);
		expect(calls[0]!.url).toMatch(/files\/list_folder$/);
		expect(JSON.parse(calls[0]!.init.body as string)).toMatchObject({
			path: '/N',
			recursive: true,
		});
		expect(calls[1]!.url).toMatch(/list_folder\/continue$/);
		expect(header(calls[0]!, 'Authorization')).toBe('Bearer tok');
	});

	it('downloads text with its revision', async () => {
		const { calls, fetcher } = fakeFetch([
			new Response('* Hi\n', { headers: { 'Dropbox-API-Result': '{"rev":"abc"}' } }),
		]);
		const api = new DropboxApi(async () => 'tok', fetcher);
		expect(await api.download('/N/a.org')).toEqual({ text: '* Hi\n', rev: 'abc' });
		expect(header(calls[0]!, 'Dropbox-API-Arg')).toBe('{"path":"/N/a.org"}');
	});

	it('uploads against a revision and reports conflicts', async () => {
		const { calls, fetcher } = fakeFetch([
			json({ rev: 'r2', path_display: '/N/a.org' }),
			json({ error_summary: 'path/conflict/file/..' }, 409),
		]);
		const api = new DropboxApi(async () => 'tok', fetcher);
		expect(await api.upload('/N/a.org', 'x', 'r1')).toEqual({ rev: 'r2', path: '/N/a.org' });
		expect(JSON.parse(header(calls[0]!, 'Dropbox-API-Arg')!)).toMatchObject({
			mode: { '.tag': 'update', update: 'r1' },
			strict_conflict: true,
		});
		await expect(api.upload('/N/b.org', 'y', null)).rejects.toBeInstanceOf(DropboxConflict);
		expect(JSON.parse(header(calls[1]!, 'Dropbox-API-Arg')!).mode).toEqual({ '.tag': 'add' });
	});

	it('treats deleting a missing file as done', async () => {
		const { fetcher } = fakeFetch([json({ error_summary: 'path_lookup/not_found/..' }, 409)]);
		await new DropboxApi(async () => 'tok', fetcher).delete('/N/gone.org', 'r1');
	});

	it('retries once with a fresh token after a 401', async () => {
		const { calls, fetcher } = fakeFetch([
			json({ error_summary: 'expired_access_token/' }, 401),
			json({ name: { display_name: 'Ada' }, email: 'ada@example.com' }),
		]);
		const tokens: boolean[] = [];
		const api = new DropboxApi(async (force) => {
			tokens.push(!!force);
			return force ? 'fresh' : 'old';
		}, fetcher);
		expect(await api.account()).toEqual({ name: 'Ada', email: 'ada@example.com' });
		expect(tokens).toEqual([false, true]);
		expect(header(calls[1]!, 'Authorization')).toBe('Bearer fresh');
	});
});

describe('Dropbox sign-in', () => {
	it('builds a PKCE authorize link asking for offline access', () => {
		const url = new URL(dropboxAuthorizeUrl('key', 'https://x.test/auth/callback/', 'st', 'ch'));
		expect(url.origin + url.pathname).toBe('https://www.dropbox.com/oauth2/authorize');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			client_id: 'key',
			response_type: 'code',
			redirect_uri: 'https://x.test/auth/callback/',
			state: 'st',
			code_challenge: 'ch',
			code_challenge_method: 'S256',
			token_access_type: 'offline',
		});
	});

	it('exchanges the code with the verifier and no secret', async () => {
		const { calls, fetcher } = fakeFetch([
			json({ access_token: 'a', refresh_token: 'r', expires_in: 14400 }),
		]);
		const t = await exchangeDropboxCode(
			{ appKey: 'key', code: 'c', verifier: 'v', redirectUri: 'https://x.test/cb' },
			fetcher,
			1000,
		);
		expect(t).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 1000 + 14400 * 1000 });
		const form = new URLSearchParams(calls[0]!.init.body as string);
		expect(Object.fromEntries(form)).toEqual({
			grant_type: 'authorization_code',
			code: 'c',
			client_id: 'key',
			code_verifier: 'v',
			redirect_uri: 'https://x.test/cb',
		});
	});

	it('refreshes and keeps the refresh token', async () => {
		const { fetcher } = fakeFetch([json({ access_token: 'b', expires_in: 100 })]);
		expect(await refreshDropboxToken('key', 'r', fetcher, 0)).toEqual({
			accessToken: 'b',
			refreshToken: 'r',
			expiresAt: 100000,
		});
	});

	it('surfaces token errors', async () => {
		const { fetcher } = fakeFetch([
			json({ error: 'invalid_grant', error_description: 'code doesn’t exist' }, 400),
		]);
		await expect(
			exchangeDropboxCode({ appKey: 'k', code: 'c', verifier: 'v', redirectUri: 'u' }, fetcher),
		).rejects.toThrow('code doesn’t exist');
	});
});
