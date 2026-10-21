import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	authorizeUrl,
	availableProviders,
	challengeFor,
	completeSignIn,
	needsRefresh,
	takeCloudResult,
	takeSignInResult,
	refreshCredentials,
} from './oauth';

const store = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
});

afterEach(() => {
	store.clear();
	vi.unstubAllGlobals();
	vi.stubGlobal('sessionStorage', {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
		removeItem: (k: string) => void store.delete(k),
	});
});

const config = { worker: 'https://w.example/', clientIds: { github: 'gh', gitlab: 'gl' } };

describe('oauth', () => {
	it('computes the RFC 7636 S256 challenge', async () => {
		expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
		);
	});

	it('builds provider authorize URLs', () => {
		const gl = new URL(authorizeUrl('gitlab', 'gl', 'https://app/cb/', 's', 'c'));
		expect(gl.origin + gl.pathname).toBe('https://gitlab.com/oauth/authorize');
		expect(Object.fromEntries(gl.searchParams)).toMatchObject({
			client_id: 'gl',
			redirect_uri: 'https://app/cb/',
			state: 's',
			code_challenge: 'c',
			code_challenge_method: 'S256',
			scope: 'read_user read_api read_repository write_repository',
		});
		const bb = new URL(authorizeUrl('bitbucket', 'bb', 'https://app/cb/', 's', 'c'));
		expect(bb.searchParams.has('code_challenge')).toBe(false);
	});

	it('only offers configured providers with a worker', () => {
		expect(availableProviders(config)).toEqual(['github', 'gitlab']);
		expect(availableProviders({ ...config, worker: '' })).toEqual([]);
	});

	it('trades a Dropbox code with Dropbox itself, never the worker', async () => {
		store.set(
			'mycelium:oauth-pending',
			JSON.stringify({
				provider: 'dropbox',
				state: 'abc',
				verifier: 'v',
				redirectUri: 'https://app/cb/',
				returnTo: '/app#/vaults',
			}),
		);
		const fetch = vi.fn(
			async () =>
				new Response(
					JSON.stringify({ access_token: 'sl.a', refresh_token: 'r', expires_in: 14400 }),
				),
		);
		vi.stubGlobal('fetch', fetch);
		const next = await completeSignIn(new URLSearchParams('code=xyz&state=abc'), {
			...config,
			dropboxAppKey: 'dbx',
		});
		expect(next).toBe('/app#/vaults');
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://api.dropboxapi.com/oauth2/token');
		expect(new URLSearchParams(String(init.body)).get('client_id')).toBe('dbx');
		// Only the Dropbox panel picks it up; the git sign-in doesn't.
		expect(takeSignInResult()).toBeNull();
		expect(takeCloudResult()).toMatchObject({
			service: 'dropbox',
			tokens: { accessToken: 'sl.a', refreshToken: 'r' },
			renew: null,
		});
		expect(takeCloudResult()).toBeNull();
	});

	it('trades a Microsoft code with Microsoft, repeating the scopes asked for', async () => {
		store.set(
			'mycelium:oauth-pending',
			JSON.stringify({
				provider: 'onedrive',
				state: 'abc',
				verifier: 'v',
				redirectUri: 'https://app/cb/',
				returnTo: '/app#/vaults',
				scopes: 'offline_access User.Read Files.ReadWrite.All Sites.Read.All',
				renew: 'vault-1',
			}),
		);
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ access_token: 'ey', refresh_token: 'r', expires_in: 3600 })),
		);
		vi.stubGlobal('fetch', fetch);
		await completeSignIn(new URLSearchParams('code=xyz&state=abc'), {
			...config,
			onedriveClientId: 'ms',
		});
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
		const form = new URLSearchParams(String(init.body));
		expect(form.get('client_id')).toBe('ms');
		expect(form.get('code_verifier')).toBe('v');
		expect(form.get('scope')).toContain('Sites.Read.All');
		expect(takeCloudResult()).toMatchObject({
			service: 'onedrive',
			sharepoint: true,
			renew: 'vault-1',
		});
	});

	it('checks state and trades the code through the worker', async () => {
		store.set(
			'mycelium:oauth-pending',
			JSON.stringify({
				provider: 'github',
				state: 'abc',
				verifier: 'v',
				redirectUri: 'https://app/cb/',
				returnTo: '/app#/vaults',
			}),
		);
		const fetch = vi.fn(
			async () => new Response('access_token=t1&refresh_token=r1&expires_in=28800'),
		);
		vi.stubGlobal('fetch', fetch);
		const next = await completeSignIn(new URLSearchParams('code=xyz&state=abc'), config);
		expect(next).toBe('/app#/vaults');
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://w.example/oauth/github/token');
		expect(JSON.parse(String(init.body))).toEqual({
			code: 'xyz',
			code_verifier: 'v',
			redirect_uri: 'https://app/cb/',
		});
		const result = JSON.parse(store.get('mycelium:oauth-result')!);
		expect(result).toMatchObject({ provider: 'github', accessToken: 't1', refreshToken: 'r1' });
		expect(result.expiresAt).toBeGreaterThan(Date.now());
	});

	it('sends Bitbucket only the code (its authorize link has no redirect or PKCE)', async () => {
		store.set(
			'mycelium:oauth-pending',
			JSON.stringify({
				provider: 'bitbucket',
				state: 'abc',
				verifier: 'v',
				redirectUri: 'https://app/cb/',
				returnTo: '/app#/vaults',
			}),
		);
		const fetch = vi.fn(async () => Response.json({ access_token: 't', expires_in: 7200 }));
		vi.stubGlobal('fetch', fetch);
		await completeSignIn(new URLSearchParams('code=xyz&state=abc'), {
			...config,
			clientIds: { bitbucket: 'bb' },
		});
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe('https://w.example/oauth/bitbucket/token');
		expect(JSON.parse(String(init.body))).toEqual({ code: 'xyz' });
		expect(authorizeUrl('bitbucket', 'bb', 'https://app/cb/', 's', 'c')).not.toMatch(
			/redirect_uri|code_challenge/,
		);
	});

	it('rejects a mismatched state', async () => {
		store.set(
			'mycelium:oauth-pending',
			JSON.stringify({
				provider: 'github',
				state: 'abc',
				verifier: 'v',
				redirectUri: 'x',
				returnTo: '/',
			}),
		);
		await expect(completeSignIn(new URLSearchParams('code=x&state=evil'), config)).rejects.toThrow(
			/mismatch/,
		);
	});

	it('refreshes tokens that are about to expire', async () => {
		const creds = { token: 'old', oauth: { refreshToken: 'r', expiresAt: Date.now() + 1000 } };
		expect(needsRefresh(creds)).toBe(true);
		expect(needsRefresh({ token: 'pat' })).toBe(false);
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response('{"access_token":"new","expires_in":7200}')),
		);
		const next = await refreshCredentials('gitlab', creds, config, 'https://app/cb/');
		expect(next.token).toBe('new');
		expect(next.oauth?.refreshToken).toBe('r');
	});
});
