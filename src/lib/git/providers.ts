/// Git hosts: how to build clone URLs and authenticate with a token.

export type ProviderId = 'github' | 'gitlab' | 'bitbucket' | 'other';

export interface Credentials {
	/** Personal access token, app password or OAuth access token. */
	token: string;
	/** Needed by Bitbucket app passwords and generic hosts. */
	username?: string | undefined;
	/** Set when the token came from signing in (OAuth) rather than being pasted. */
	oauth?: {
		refreshToken: string | null;
		/** Epoch ms when the access token expires, if it does. */
		expiresAt: number | null;
	};
}

export interface Provider {
	id: ProviderId;
	name: string;
	host: string | null;
	/** Where users create a token with the right scopes. */
	tokenUrl: string | null;
	tokenHelp: string;
	needsUsername: boolean;
	auth(credentials: Credentials): { username: string; password: string };
}

export const PROVIDERS: Record<ProviderId, Provider> = {
	github: {
		id: 'github',
		name: 'GitHub',
		host: 'github.com',
		tokenUrl: 'https://github.com/settings/personal-access-tokens/new',
		tokenHelp: 'Fine-grained token with “Contents: Read and write” on just your notes repository.',
		needsUsername: false,
		auth: ({ token }) => ({ username: 'x-access-token', password: token }),
	},
	gitlab: {
		id: 'gitlab',
		name: 'GitLab',
		host: 'gitlab.com',
		tokenUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
		tokenHelp:
			'Personal or project access token with the read_repository and write_repository scopes.',
		needsUsername: false,
		auth: ({ token }) => ({ username: 'oauth2', password: token }),
	},
	bitbucket: {
		id: 'bitbucket',
		name: 'Bitbucket',
		host: 'bitbucket.org',
		tokenUrl: 'https://bitbucket.org/account/settings/app-passwords/',
		tokenHelp:
			'Your Bitbucket username and an app password (or API token) with repository read and write.',
		needsUsername: true,
		auth: ({ token, username }) =>
			username ? { username, password: token } : { username: 'x-token-auth', password: token },
	},
	other: {
		id: 'other',
		name: 'Other',
		host: null,
		tokenUrl: null,
		tokenHelp: 'Any HTTPS git server. Use the username and password or token it expects.',
		needsUsername: true,
		auth: ({ token, username }) => ({ username: username || 'git', password: token }),
	},
};

export interface RepoLocation {
	provider: ProviderId;
	/** HTTPS clone URL. */
	url: string;
	/** `owner/name`, for display. */
	slug: string;
}

/**
 * Accept `owner/repo`, a web URL or a clone URL and return a clone URL.
 * Only HTTPS remotes are supported in the browser.
 */
export function parseRepo(input: string, provider: ProviderId): RepoLocation | null {
	const value = input.trim().replace(/\/+$/, '');
	if (!value) return null;
	const shorthand = /^([\w.-]+(?:\/[\w.-]+)+?)(?:\.git)?$/.exec(value);
	if (shorthand && !value.includes(':') && provider !== 'other') {
		const host = PROVIDERS[provider].host!;
		const slug = shorthand[1]!;
		return { provider, url: `https://${host}/${slug}.git`, slug };
	}
	let url: URL;
	try {
		url = new URL(value.replace(/^git@([^:]+):/, 'https://$1/'));
	} catch {
		return null;
	}
	// Browsers need HTTPS remotes; plain HTTP is allowed only for a local server.
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
	const path = url.pathname
		.replace(/^\/+/, '')
		.replace(/\.git$/, '')
		.replace(/\/-\/.*$/, '')
		.replace(/\/(?:tree|src|blob)\/.*$/, '');
	const detected = (Object.values(PROVIDERS).find((p) => p.host === url.hostname)?.id ??
		'other') as ProviderId;
	// Hosted providers always use owner/name; self-hosted servers may not.
	if (!path || (!path.includes('/') && detected !== 'other')) return null;
	return { provider: detected, url: `${url.protocol}//${url.host}/${path}.git`, slug: path };
}
