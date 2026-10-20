/// Sign in with GitHub, GitLab or Bitbucket (OAuth 2 authorization code with
/// PKCE). The browser redirects to the provider, which returns to
/// `/auth/callback/`; that page trades the code for tokens through the sync
/// worker, which adds the client secret the browser must never hold. Tokens
/// are stored only in this browser, with the vault.

import type { Credentials, ProviderId } from '$lib/git/providers';

export type OAuthProvider = Exclude<ProviderId, 'other'>;

export interface OAuthConfig {
	/** Base URL of the deployed worker (same one that proxies git). */
	worker: string;
	clientIds: Partial<Record<OAuthProvider, string | undefined>>;
	/** GitHub App slug, for the "choose repositories" install link. */
	githubAppSlug?: string | undefined;
}

export interface TokenSet {
	provider: OAuthProvider;
	accessToken: string;
	refreshToken: string | null;
	expiresAt: number | null;
}

interface PendingSignIn {
	provider: OAuthProvider;
	state: string;
	verifier: string;
	redirectUri: string;
	returnTo: string;
}

const PENDING_KEY = 'mycelium:oauth-pending';
export const RESULT_KEY = 'mycelium:oauth-result';

const AUTHORIZE: Record<OAuthProvider, string> = {
	github: 'https://github.com/login/oauth/authorize',
	gitlab: 'https://gitlab.com/oauth/authorize',
	bitbucket: 'https://bitbucket.org/site/oauth2/authorize',
};

const GITLAB_SCOPES = 'read_user read_api read_repository write_repository';

function base64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomString(bytes = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** PKCE S256 challenge for a verifier. */
export async function challengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
	return base64url(new Uint8Array(digest));
}

/** The provider's authorize URL. */
export function authorizeUrl(
	provider: OAuthProvider,
	clientId: string,
	redirectUri: string,
	state: string,
	challenge: string,
): string {
	const url = new URL(AUTHORIZE[provider]);
	url.searchParams.set('client_id', clientId);
	url.searchParams.set('response_type', 'code');
	url.searchParams.set('state', state);
	// Bitbucket uses the consumer's registered callback and has no PKCE.
	if (provider !== 'bitbucket') {
		url.searchParams.set('redirect_uri', redirectUri);
		url.searchParams.set('code_challenge', challenge);
		url.searchParams.set('code_challenge_method', 'S256');
	}
	if (provider === 'gitlab') url.searchParams.set('scope', GITLAB_SCOPES);
	return url.toString();
}

/** Providers that can sign in with this build's configuration. */
export function availableProviders(config: OAuthConfig): OAuthProvider[] {
	if (!config.worker) return [];
	return (['github', 'gitlab', 'bitbucket'] as const).filter((p) => !!config.clientIds[p]);
}

/** Leave for the provider's sign-in page. */
export async function beginSignIn(
	provider: OAuthProvider,
	config: OAuthConfig,
	redirectUri: string,
	returnTo: string,
): Promise<void> {
	const clientId = config.clientIds[provider];
	if (!clientId) throw new Error(`${provider} sign-in isn't configured for this site`);
	const pending: PendingSignIn = {
		provider,
		state: randomString(16),
		verifier: randomString(48),
		redirectUri,
		returnTo,
	};
	sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
	location.assign(
		authorizeUrl(
			provider,
			clientId,
			redirectUri,
			pending.state,
			await challengeFor(pending.verifier),
		),
	);
}

interface TokenResponse {
	access_token?: string;
	refresh_token?: string;
	expires_in?: number;
	error?: string;
	error_description?: string;
}

function toTokenSet(provider: OAuthProvider, body: TokenResponse, now = Date.now()): TokenSet {
	if (!body.access_token) throw new Error(body.error_description || body.error || 'Sign-in failed');
	return {
		provider,
		accessToken: body.access_token,
		refreshToken: body.refresh_token ?? null,
		expiresAt: body.expires_in ? now + body.expires_in * 1000 : null,
	};
}

async function post(url: string, body: object): Promise<TokenResponse> {
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	let parsed: TokenResponse;
	try {
		parsed = JSON.parse(text) as TokenResponse;
	} catch {
		// GitHub can answer in form encoding.
		parsed = Object.fromEntries(new URLSearchParams(text)) as TokenResponse;
		if (parsed.expires_in) parsed.expires_in = Number(parsed.expires_in);
	}
	if (!res.ok && !parsed.error) parsed.error = text || `HTTP ${res.status}`;
	return parsed;
}

/**
 * On the callback page: check the state, trade the code for tokens and
 * remember them for the app. Returns where to go next.
 */
export async function completeSignIn(
	params: URLSearchParams,
	config: OAuthConfig,
): Promise<string> {
	const raw = sessionStorage.getItem(PENDING_KEY);
	sessionStorage.removeItem(PENDING_KEY);
	if (!raw) throw new Error('This sign-in has expired. Start again from Mycelium.');
	const pending = JSON.parse(raw) as PendingSignIn;
	const error = params.get('error');
	if (error) throw new Error(params.get('error_description') || error);
	if (params.get('state') !== pending.state)
		throw new Error('Sign-in state mismatch. Start again from Mycelium.');
	const code = params.get('code');
	if (!code) throw new Error('No authorization code came back.');
	// Bitbucket's authorize link carries no redirect_uri or PKCE challenge (it uses the
	// consumer's registered callback), and it rejects a token request that adds them.
	const body = await post(
		`${config.worker.replace(/\/$/, '')}/oauth/${pending.provider}/token`,
		pending.provider === 'bitbucket'
			? { code }
			: { code, code_verifier: pending.verifier, redirect_uri: pending.redirectUri },
	);
	const tokens = toTokenSet(pending.provider, body);
	sessionStorage.setItem(RESULT_KEY, JSON.stringify(tokens));
	return pending.returnTo;
}

/** Is a sign-in started from Mycelium waiting for its callback (in this tab)? */
export function hasPendingSignIn(): boolean {
	try {
		return sessionStorage.getItem(PENDING_KEY) !== null;
	} catch {
		return false;
	}
}

/** Pick up tokens left by the callback page (once). */
export function takeSignInResult(): TokenSet | null {
	try {
		const raw = sessionStorage.getItem(RESULT_KEY);
		if (!raw) return null;
		sessionStorage.removeItem(RESULT_KEY);
		return JSON.parse(raw) as TokenSet;
	} catch {
		return null;
	}
}

export function credentialsFrom(tokens: TokenSet): Credentials {
	return {
		token: tokens.accessToken,
		oauth: { refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt },
	};
}

/** `true` when an OAuth token expires within `margin` ms and can be refreshed. */
export function needsRefresh(
	creds: Credentials | null,
	now = Date.now(),
	margin = 120_000,
): boolean {
	return (
		!!creds?.oauth?.refreshToken && !!creds.oauth.expiresAt && creds.oauth.expiresAt - now < margin
	);
}

/** Swap a refresh token for fresh credentials. */
export async function refreshCredentials(
	provider: OAuthProvider,
	creds: Credentials,
	config: OAuthConfig,
	redirectUri: string,
): Promise<Credentials> {
	const refresh = creds.oauth?.refreshToken;
	if (!refresh) return creds;
	const body = await post(`${config.worker.replace(/\/$/, '')}/oauth/${provider}/refresh`, {
		refresh_token: refresh,
		...(provider === 'bitbucket' ? {} : { redirect_uri: redirectUri }),
	});
	const tokens = toTokenSet(provider, body);
	return credentialsFrom({ ...tokens, refreshToken: tokens.refreshToken ?? refresh });
}

// ---------------------------------------------------------------- accounts

export interface RemoteRepo {
	slug: string;
	cloneUrl: string;
	defaultBranch: string | null;
	private: boolean;
	updatedAt: string | null;
}

export interface Account {
	name: string;
	email: string;
	login: string;
}

const api = async <T>(url: string, token: string): Promise<T> => {
	const res = await fetch(url, {
		headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
	});
	if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
	return (await res.json()) as T;
};

/** Who signed in, with a commit identity that attributes commits to them. */
export async function fetchAccount(provider: OAuthProvider, token: string): Promise<Account> {
	if (provider === 'github') {
		const u = await api<{ login: string; id: number; name: string | null }>(
			'https://api.github.com/user',
			token,
		);
		return {
			login: u.login,
			name: u.name || u.login,
			email: `${u.id}+${u.login}@users.noreply.github.com`,
		};
	}
	if (provider === 'gitlab') {
		const u = await api<{
			username: string;
			name: string;
			commit_email?: string;
			public_email?: string;
		}>('https://gitlab.com/api/v4/user', token);
		return {
			login: u.username,
			name: u.name,
			email: u.commit_email || u.public_email || `${u.username}@users.noreply.gitlab.com`,
		};
	}
	const u = await api<{ username: string; display_name: string }>(
		'https://api.bitbucket.org/2.0/user',
		token,
	);
	return {
		login: u.username,
		name: u.display_name,
		email: `${u.username}@users.noreply.bitbucket.org`,
	};
}

/** Repositories the signed-in account can open, most recently updated first. */
export async function fetchRepos(provider: OAuthProvider, token: string): Promise<RemoteRepo[]> {
	if (provider === 'github') {
		// A GitHub App's user token sees the repositories the app is installed on.
		const inst = await api<{ installations: { id: number }[] }>(
			'https://api.github.com/user/installations',
			token,
		);
		const repos: RemoteRepo[] = [];
		for (const { id } of inst.installations) {
			const page = await api<{
				repositories: {
					full_name: string;
					clone_url: string;
					default_branch: string;
					private: boolean;
					pushed_at: string | null;
				}[];
			}>(`https://api.github.com/user/installations/${id}/repositories?per_page=100`, token);
			for (const r of page.repositories)
				repos.push({
					slug: r.full_name,
					cloneUrl: r.clone_url,
					defaultBranch: r.default_branch,
					private: r.private,
					updatedAt: r.pushed_at,
				});
		}
		return repos.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
	}
	if (provider === 'gitlab') {
		const list = await api<
			{
				path_with_namespace: string;
				http_url_to_repo: string;
				default_branch: string | null;
				visibility: string;
				last_activity_at: string;
			}[]
		>(
			'https://gitlab.com/api/v4/projects?membership=true&simple=true&order_by=last_activity_at&per_page=100',
			token,
		);
		return list.map((r) => ({
			slug: r.path_with_namespace,
			cloneUrl: r.http_url_to_repo,
			defaultBranch: r.default_branch,
			private: r.visibility !== 'public',
			updatedAt: r.last_activity_at,
		}));
	}
	const page = await api<{
		values: {
			full_name: string;
			is_private: boolean;
			updated_on: string;
			mainbranch?: { name: string };
			links: { clone: { name: string; href: string }[] };
		}[];
	}>('https://api.bitbucket.org/2.0/repositories?role=member&sort=-updated_on&pagelen=100', token);
	return page.values.map((r) => ({
		slug: r.full_name,
		cloneUrl: (
			r.links.clone.find((c) => c.name === 'https')?.href ??
			`https://bitbucket.org/${r.full_name}.git`
		).replace(/^https:\/\/[^@/]+@/, 'https://'),
		defaultBranch: r.mainbranch?.name ?? null,
		private: r.is_private,
		updatedAt: r.updated_on,
	}));
}
