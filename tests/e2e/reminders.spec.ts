import { expect, test, type Page } from '@playwright/test';

/// Reminders while the app is open: turned on in Settings, shown when an
/// item's time comes, once only, and opening its note when tapped.

const PROJECT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c12';

/** A stand-in for the browser's notifications that records what's shown. */
async function recordNotifications(page: Page) {
	await page.addInitScript(() => {
		const shown: { title: string; body: string | undefined; tag: string | undefined }[] = [];
		class FakeNotification {
			static permission: NotificationPermission = 'default';
			static async requestPermission() {
				FakeNotification.permission = 'granted';
				return 'granted' as const;
			}
			onclick: (() => void) | null = null;
			constructor(title: string, options: NotificationOptions = {}) {
				shown.push({ title, body: options.body, tag: options.tag });
				(window as unknown as { lastNotification: FakeNotification }).lastNotification = this;
			}
		}
		Object.assign(window, { Notification: FakeNotification, shownNotifications: shown });
	});
}

const shown = (page: Page) =>
	page.evaluate(
		() =>
			(window as unknown as { shownNotifications: { title: string; body?: string }[] })
				.shownNotifications,
	);

test('reminders show when an item is due, once, and open its note', async ({ page }) => {
	await recordNotifications(page);
	await page.addInitScript(() => localStorage.setItem('mycelium:editor-mode', 'source'));
	await page.goto('app#/settings');
	await expect(page.locator('#myc-loader')).toHaveCount(0, { timeout: 15_000 });

	await page.getByLabel('Remind me about scheduled items and deadlines').check();
	await page.getByLabel('How early', { exact: true }).selectOption({ label: 'At the time' });
	// Without the published app's service worker, closed-app reminders are off.
	await expect(page.getByLabel('Also when Mycelium is closed')).toBeDisabled();
	await page.getByRole('button', { name: 'Send a test notification' }).click();
	await expect
		.poll(() => shown(page))
		.toEqual([expect.objectContaining({ title: 'Mycelium reminders' })]);

	// Something scheduled for this very minute.
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${now.toLocaleDateString('en-US', { weekday: 'short' })} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
	await page.goto(page.url().replace(/#.*/, `#/node/${PROJECT}`));
	await page.getByRole('button', { name: 'Edit', exact: true }).click();
	await page.locator('.cm-content').click();
	await page.keyboard.press('ControlOrMeta+End');
	await page.keyboard.insertText(`\n* TODO Call the bank\nSCHEDULED: <${stamp}>\n`);

	await expect
		.poll(() => shown(page), { timeout: 30_000 })
		.toContainEqual(
			expect.objectContaining({
				title: 'TODO Call the bank',
				body: `Scheduled at ${stamp.slice(-5)}`,
			}),
		);
	// Once only, however often it checks.
	await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
	await page.waitForTimeout(1000);
	expect((await shown(page)).filter((n) => n.title === 'TODO Call the bank')).toHaveLength(1);

	// Tapping it opens the note at the heading.
	await page.goto(page.url().replace(/#.*/, '#/agenda'));
	await page.evaluate(() =>
		(window as unknown as { lastNotification: { onclick: () => void } }).lastNotification.onclick(),
	);
	await expect(page).toHaveURL(new RegExp(`#/node/${PROJECT}\\?at=\\d+`));
});
