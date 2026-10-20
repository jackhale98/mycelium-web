// Capture screenshots of the built site for design review.
// Usage: node scripts/screenshots.mjs <base-url> <out-dir>
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [base = 'http://localhost:4321/mycelium-web', out = 'screenshots'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const executablePath = process.env.CHROMIUM_PATH || undefined;
const browser = await chromium.launch({ executablePath });
const errors = [];

async function shot(
	name,
	path,
	{ width = 1440, height = 900, theme = 'light', full = false, before } = {},
) {
	const context = await browser.newContext({
		viewport: { width, height },
		deviceScaleFactor: 2,
		colorScheme: theme,
	});
	const page = await context.newPage();
	page.on('console', (m) => m.type() === 'error' && errors.push(`${name}: ${m.text()}`));
	page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
	await page.goto(`${base}${path}`, { waitUntil: 'networkidle' });
	await page.evaluate(() => document.fonts.ready);
	if (before) await before(page);
	await page.waitForTimeout(250);
	await page.screenshot({ path: `${out}/${name}.png`, fullPage: full });
	await context.close();
}

const node = (id) => `/app#/node/${id}`;
await shot('01-landing', '/', { full: true });
await shot('02-home', '/app#/');
await shot('03-note', node('8f3a2c1e-6b4d-4e2a-9c7f-1a2b3c4d5e01'));
await shot('04-note-dark', node('8f3a2c1e-6b4d-4e2a-9c7f-1a2b3c4d5e01'), { theme: 'dark' });
await shot('05-project', node('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12'));
await shot('06-agenda', '/app#/agenda');
await shot('07-search', '/app#/', {
	before: async (page) => {
		await page.keyboard.press('Control+k');
		await page.keyboard.type('wood');
	},
});
await shot('08-daily-dark', '/app#/daily/2026-10-20', { theme: 'dark' });
await shot('09-mobile-home', '/app#/', { width: 390, height: 844 });
await shot('10-mobile-note', node('5e1f9a20-7c3d-4b9e-8a2f-0c1d2e3f4a03'), {
	width: 390,
	height: 844,
	full: true,
});
await shot('11-landing-dark', '/', { theme: 'dark' });

await browser.close();
if (errors.length) {
	console.error('Console errors:\n' + errors.join('\n'));
	process.exitCode = 1;
} else console.log('No console errors.');
