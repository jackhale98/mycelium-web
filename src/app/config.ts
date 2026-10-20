/// Build-time configuration. Set PUBLIC_GIT_PROXY to your deployed worker.

/**
 * Default prefix for git's HTTP traffic. Browsers need a CORS proxy to talk
 * to git hosts; the public isomorphic-git proxy is for trying things out —
 * deploy `worker/` and set PUBLIC_GIT_PROXY for real use.
 */
export const DEFAULT_GIT_PROXY: string =
	import.meta.env.PUBLIC_GIT_PROXY || 'https://cors.isomorphic-git.org';
export const PUBLIC_TEST_PROXY = 'https://cors.isomorphic-git.org';

/** A public org-roam repository anyone can open read-only. */
export const DEMO_REPO = { provider: 'github' as const, slug: 'jackhale98/mycelium-demo-vault' };
