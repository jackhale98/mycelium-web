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
	vite: {
		worker: { format: 'es' },
	},
});
