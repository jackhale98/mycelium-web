// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// Cloudflare (Workers Builds sets WORKERS_CI=1, Pages sets CF_PAGES=1) serves
// my-celium.org from the root; GitHub Pages project sites live under /<repo>/.
// SITE_BASE and SITE_URL override either.
const cloudflare = process.env.WORKERS_CI === '1' || process.env.CF_PAGES === '1';
const base = process.env.SITE_BASE ?? (cloudflare ? '/' : '/mycelium-web');
const site =
	process.env.SITE_URL ?? (cloudflare ? 'https://my-celium.org' : 'https://jackhale98.github.io');

export default defineConfig({
	site,
	base,
	output: 'static',
	trailingSlash: 'ignore',
	integrations: [svelte()],
	// Strict CSP: Astro hashes its own inline scripts and styles. connect-src
	// gains the git providers and the sync worker once those land.
	security: {
		csp: {
			directives: [
				"default-src 'self'",
				"img-src 'self' data: blob:",
				"font-src 'self'",
				// Git hosts, the user's sync proxy and provider APIs are all HTTPS; plain
				// HTTP is only allowed to a local git server during development.
				"connect-src 'self' https: http://localhost:* http://127.0.0.1:*",
				"object-src 'none'",
				"base-uri 'self'",
				"form-action 'self'",
				'upgrade-insecure-requests',
			],
			// Inline style *attributes* (CSS custom properties components set, e.g. the
			// loader's per-thread timings). Scripts and <style> elements stay hash-locked.
			styleDirective: { resources: ["'self'", { resource: "'unsafe-inline'", kind: 'attribute' }] },
		},
	},
	markdown: { syntaxHighlight: false },
	vite: {
		worker: { format: 'es' },
		// Emit every asset as a file: inlined data: URLs would need a looser CSP.
		build: { assetsInlineLimit: 0 },
	},
});
