import { defineConfig, devices } from '@playwright/test';

/** The site's base path, as built (`SITE_BASE=/` tests a root-domain build like my-celium.org). */
const BASE = `${(process.env.SITE_BASE ?? '/mycelium-web').replace(/\/$/, '')}/`;

// Use a preinstalled Chromium when CHROMIUM_PATH is set (e.g. sandboxes without downloads).
const launchOptions = process.env.CHROMIUM_PATH
	? { executablePath: process.env.CHROMIUM_PATH }
	: {};

export default defineConfig({
	testDir: 'tests/e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',
	use: {
		baseURL: `http://localhost:4321${BASE}`,
		trace: 'retain-on-failure',
		launchOptions,
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'], launchOptions } },
		{ name: 'mobile', use: { ...devices['Pixel 7'], launchOptions } },
	],
	webServer: {
		command: 'npm run preview -- --port 4321',
		url: `http://localhost:4321${BASE}`,
		reuseExistingServer: !process.env.CI,
	},
});
