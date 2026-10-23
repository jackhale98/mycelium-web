// @ts-check
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
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

const LUCIDE_LICENSE = `ISC License

Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.`;

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
						// Icons adapted from Lucide live inline in Icon.svelte, not as a package.
						[
							'='.repeat(78),
							'Lucide (icons, adapted)',
							'License: ISC',
							'Source: https://github.com/lucide-icons/lucide',
							'',
							LUCIDE_LICENSE,
							'',
						].join('\n'),
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

/**
 * The service worker (scripts/sw.js), written to /sw.js with this build's
 * files: the pages, every script and font, icons and the manifest, so the
 * app opens offline. Its version is a hash of their contents.
 */
const offlineApp = {
	name: 'offline-app',
	hooks: {
		'astro:build:done': async (/** @type {{ dir: URL }} */ { dir }) => {
			const root = fileURLToPath(dir);
			const all = /** @type {string[]} */ (await readdir(root, { recursive: true }));
			const files = all
				.map((f) => f.split('\\').join('/'))
				.filter(
					(f) =>
						/^_astro\/.*\.(js|css|woff2)$/.test(f) ||
						/^icons\/.*\.png$/.test(f) ||
						['index.html', 'app/index.html', 'manifest.webmanifest', 'favicon.svg'].includes(f) ||
						/^mycelium-.*\.svg$/.test(f),
				)
				.sort();
			const hash = createHash('sha256');
			for (const f of files) hash.update(f).update(await readFile(new URL(f, dir)));
			// Pages are stored under their address (`./`, `app/`), not their file name.
			const paths = files.map((f) => f.replace(/(^|\/)index\.html$/, '$1') || './');
			const template = await readFile(new URL('./scripts/sw.js', import.meta.url), 'utf8');
			await writeFile(
				new URL('sw.js', dir),
				template
					.replace(
						"const VERSION = '__VERSION__';",
						`const VERSION = '${hash.digest('hex').slice(0, 16)}';`,
					)
					.replace('const FILES = __FILES__;', `const FILES = ${JSON.stringify(paths)};`),
			);
		},
	},
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
		offlineApp,
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
	// allows HTTPS for the git hosts, cloud storage and sync worker people connect.
	security: {
		csp: {
			directives: [
				"default-src 'self'",
				"img-src 'self' data: blob:",
				"font-src 'self'",
				// The service worker that keeps the app working offline.
				"worker-src 'self'",
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
