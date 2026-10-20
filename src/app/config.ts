/// Build-time configuration. Set PUBLIC_GIT_PROXY to your deployed worker.

/**
 * Default prefix for git's HTTP traffic. Browsers need a CORS proxy to talk
 * to git hosts; the public isomorphic-git proxy is for trying things out —
 * deploy `worker/` and set PUBLIC_GIT_PROXY for real use.
 */
export const DEFAULT_GIT_PROXY: string =
	import.meta.env.PUBLIC_GIT_PROXY || 'https://cors.isomorphic-git.org';
export const PUBLIC_TEST_PROXY = 'https://cors.isomorphic-git.org';

/** A public org-roam vault anyone can open read-only (an orphan branch of this repository). */
export const DEMO_REPO = {
	provider: 'github' as const,
	slug: 'jackhale98/mycelium-web',
	branch: 'demo-vault',
};

/** The deployed sync worker, if this build has one (it also does OAuth). */
export const WORKER_URL: string = import.meta.env.PUBLIC_GIT_PROXY || '';

/** OAuth sign-in: enabled per provider by setting its public client id at build time. */
export const OAUTH_CONFIG = {
	worker: WORKER_URL,
	clientIds: {
		github: import.meta.env.PUBLIC_GITHUB_CLIENT_ID || undefined,
		gitlab: import.meta.env.PUBLIC_GITLAB_CLIENT_ID || undefined,
		bitbucket: import.meta.env.PUBLIC_BITBUCKET_CLIENT_ID || undefined,
	},
	githubAppSlug: import.meta.env.PUBLIC_GITHUB_APP_SLUG || undefined,
};

/** Absolute URL of a page on this site (e.g. the OAuth callback). */
export function siteUrl(path: string): string {
	return `${location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
}

export const OAUTH_REDIRECT = () => siteUrl('auth/callback/');
