// @ts-check
import { readFileSync } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import license from 'rollup-plugin-license';

// Cloudflare (Workers Builds sets WORKERS_CI=1, Pages sets CF_PAGES=1) serves
// my-celium.org from the root; GitHub Pages project sites live under /<repo>/.
// SITE_BASE and SITE_URL override either.
const cloudflare = process.env.WORKERS_CI === '1' || process.env.CF_PAGES === '1';
const base = process.env.SITE_BASE ?? (cloudflare ? '/' : '/mycelium-web');
const site =
	process.env.SITE_URL ?? (cloudflare ? 'https://my-celium.org' : 'https://jackhale98.github.io');

/** @param {string | { url?: string } | null | undefined} repo */
const repoUrl = (repo) => (typeof repo === 'string' ? repo : (repo?.url ?? ''));

const FONTS = ['inter', 'newsreader', 'jetbrains-mono'];
const LICENSES_TMP = fileURLToPath(
	new URL('./node_modules/.cache/third-party-licenses.txt', import.meta.url),
);

/**
 * Third-party licences of exactly what the browser downloads (the client
 * bundle, not build tools), written to /third-party-licenses.txt with each
 * licence's full text. The GPL and the bundled MIT/BSD/Apache/OFL licences
 * all ask for their notices to travel with the code.
 */
const thirdPartyLicenses = {
	...license({
		thirdParty: {
			includePrivate: false,
			output: {
				file: LICENSES_TMP,
				template: (deps) =>
					[
						'Mycelium is free software: GNU General Public License v3.0 or later.',
						'Source: https://github.com/jackhale98/mycelium-web',
						'',
						'It includes the following third-party software, under these licences.',
						'',
						...[...deps]
							.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
							.map((d) =>
								[
									'='.repeat(78),
									`${d.name} ${d.version ?? ''}`.trim(),
									`License: ${d.license ?? 'unknown'}`,
									repoUrl(d.repository) ? `Source: ${repoUrl(d.repository)}` : '',
									'',
									(d.licenseText ?? '').trim(),
									d.noticeText ? `\n${d.noticeText.trim()}` : '',
									'',
								]
									.filter((line, i) => line !== '' || i > 3)
									.join('\n'),
							),
						// Fonts are CSS assets, which the bundle analysis doesn't see.
						...FONTS.map((name) =>
							[
								'='.repeat(78),
								`@fontsource-variable/${name}`,
								'License: OFL-1.1',
								'',
								readFileSync(
									fileURLToPath(
										new URL(`./node_modules/@fontsource-variable/${name}/LICENSE`, import.meta.url),
									),
									'utf8',
								).trim(),
								'',
							].join('\n'),
						),
					].join('\n'),
			},
		},
	}),
	// The client build only (not the build that prerenders pages on the server).
	applyToEnvironment: (/** @type {{ name: string }} */ environment) =>
		environment.name === 'client',
};

export default defineConfig({
	site,
	base,
	output: 'static',
	// Small per-page stylesheets would each block rendering; inline them (Astro hashes
	// them into the CSP). Assets stay files (see vite.build below).
	build: { inlineStylesheets: 'always' },
	trailingSlash: 'ignore',
	integrations: [
		svelte(),
		{
			name: 'third-party-licenses',
			hooks: {
				'astro:build:done': async ({ dir }) => {
					await copyFile(LICENSES_TMP, new URL('third-party-licenses.txt', dir));
				},
			},
		},
	],
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
		plugins: [thirdPartyLicenses],
	},
});
