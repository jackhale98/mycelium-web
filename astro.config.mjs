// @ts-check
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

// GitHub Pages project sites live under /<repo>/. Override with SITE_BASE=/ for a custom domain.
const base = process.env.SITE_BASE ?? '/mycelium-web';
const site = process.env.SITE_URL ?? 'https://jackhale98.github.io';

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
		},
	},
	markdown: { syntaxHighlight: false },
	vite: {
		worker: { format: 'es' },
		// Emit every asset as a file: inlined data: URLs would need a looser CSP.
		build: { assetsInlineLimit: 0 },
	},
});
