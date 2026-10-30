import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function ready(page: Page) {
  await page.goto('/');
  await expect(page.locator('#loading')).toBeHidden({ timeout: 20_000 });
}
async function focusArena(page: Page) {
  await page.locator('#focus-hint').click();
  await expect(page.locator('#arena canvas')).toBeFocused();
}

test('arena loads and the requested mouse/keyboard defaults drive, jump, and toggle camera', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await ready(page); await focusArena(page);
  await page.keyboard.press('Space');
  await expect(page.locator('#camera-label')).toHaveText('CAR CAM');
  await page.keyboard.press('Space');
  await expect(page.locator('#camera-label')).toHaveText('BALL CAM');
  const box = (await page.locator('#arena canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 130);
  await page.keyboard.down('w'); await page.mouse.down({ button: 'left' });
  await expect.poll(async () => Number(await page.locator('#speed-value').textContent())).toBeGreaterThan(25);
  await page.mouse.up({ button: 'left' }); await page.keyboard.up('w');
  await page.mouse.down({ button: 'right' }); await page.waitForTimeout(200); await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(100); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await expect(page.locator('#flip-status')).toContainText('Flip used');
  const prevented = await page.locator('#arena canvas').evaluate(el => { const event = new MouseEvent('contextmenu', { cancelable: true, bubbles: true }); el.dispatchEvent(event); return event.defaultPrevented; });
  expect(prevented).toBe(true);
  await page.keyboard.press('r');
  await expect(page.locator('#speed-value')).toHaveText('0');
  expect(errors).toEqual([]);
});

test('keys and mouse buttons can be rebound with conflict detection and persistence', async ({ page }) => {
  await ready(page); await page.locator('.controls-button').click();
  const boost = page.locator('[data-rebind="boost"]'), jump = page.locator('[data-rebind="jump"]');
  await expect(boost).toHaveText('Left click'); await expect(jump).toHaveText('Right click');
  await expect(page.locator('[data-rebind="camera"]')).toHaveText('Space');
  await expect(page.locator('[data-rebind="powerslide"]')).toHaveText('Left Shift');
  await boost.click(); await page.keyboard.press('j');
  await expect(boost).toHaveText('J');
  await jump.click(); await page.keyboard.press('j');
  await expect(page.locator('#binding-message')).toContainText('already assigned');
  await page.keyboard.press('Escape');
  await expect(jump).toHaveText('Right click');
  await boost.click(); await page.locator('#controls-dialog h2').click({ button: 'left' });
  await expect(boost).toHaveText('Left click');
  await expect(boost).not.toHaveClass(/listening/);
  await jump.click(); await page.keyboard.press('k');
  await boost.click(); await page.locator('#controls-dialog h2').click({ button: 'right' });
  await expect(boost).toHaveText('Right click');
  await page.getByRole('button', { name: 'Back to the field' }).click();
  await expect(page.locator('#controls-dialog')).toBeHidden();
  await page.locator('.controls-button').click();
  await boost.click(); await page.keyboard.press('f');
  await page.getByRole('button', { name: 'Back to the field' }).click();
  await page.reload(); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('.controls-button').click(); await expect(boost).toHaveText('F');
  await page.locator('[data-action="defaults"]').click(); await expect(boost).toHaveText('Left click');
});

test('TAS applies inputs, scrubs, branches, restores checkpoints, and round-trips a take', async ({ page }) => {
  await ready(page); await page.locator('.nav-item[data-mode="tas"]').click();
  await expect(page.locator('#live-status')).toHaveText('PAUSED');
  await page.locator('[data-tas="forward"]').click(); await page.locator('[data-tas="boost"]').click();
  await page.locator('#frame-count').fill('24'); await page.locator('[data-action="runframes"]').click();
  await expect(page.locator('#frame-display')).toHaveText('0024 / 0024');
  await page.locator('[data-action="checkpoint"]').click();
  await page.locator('#timeline').evaluate((el: HTMLInputElement) => { el.value = '5'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#frame-count').fill('3'); await page.locator('[data-action="runframes"]').click();
  await expect(page.locator('#frame-display')).toHaveText('0008 / 0008');
  await page.locator('[data-action="restore"]').click();
  await expect(page.locator('#frame-display')).toHaveText('0000 / 0000');
  await page.locator('[data-action="runframes"]').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-action="export"]').click()]);
  const take = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(take.frames).toHaveLength(4); expect(take.frames[3].input.boost).toBe(true);
  expect(take.frames[0].tick).toBe(24);
  await page.locator('#take-file').setInputFiles({ name: 'take.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(take)) });
  await expect(page.locator('#frame-display')).toHaveText('0000 / 0003');
  await page.locator('#play-take').click();
  await expect(page.locator('#frame-display')).toHaveText('0003 / 0003');
  await expect(page.locator('#live-status')).toHaveText('PAUSED');
  await page.locator('#take-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"bad"}') });
  await expect(page.locator('#toasts')).toContainText('not a compatible');
});

test('recorded canvas video persists in the library, plays, renames, and downloads', async ({ page }) => {
  await ready(page); await page.locator('#record-button').click();
  await expect(page.locator('#recording-indicator')).toBeVisible();
  await page.keyboard.down('w'); await page.waitForTimeout(1600); await page.keyboard.up('w');
  await page.locator('#record-button').click();
  await expect(page.locator('#clip-count')).toHaveText('1', { timeout: 15_000 });
  await page.locator('.nav-item[data-action="library"]').click();
  await expect(page.locator('.clip-card')).toHaveCount(1);
  const video = page.locator('.clip-card video');
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState)).toBeGreaterThanOrEqual(2);
  await video.evaluate((el: HTMLVideoElement) => el.play());
  await expect.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime)).toBeGreaterThan(0.1);
  await page.locator('.clip-title').fill('My reset attempt'); await page.locator('.clip-title').press('Tab');
  await expect(page.locator('#toasts')).toContainText('Clip renamed');
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download clip' }).click()]);
  expect(download.suggestedFilename()).toBe('My reset attempt.webm');
  expect((await readFile((await download.path())!)).length).toBeGreaterThan(1000);
  await page.reload(); await expect(page.locator('#loading')).toBeHidden();
  await page.locator('.nav-item[data-action="library"]').click();
  await expect(page.locator('.clip-title')).toHaveValue('My reset attempt');
  page.on('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Delete clip' }).click();
  await expect(page.locator('.empty-library')).toBeVisible();
});

test('trainer assists and a narrow viewport remain usable', async ({ page }) => {
  await ready(page); await page.locator('.nav-item[data-mode="trainer"]').click();
  await expect(page.locator('#preset-select')).toHaveValue('reset');
  await expect(page.locator('#trainer-options')).toBeVisible();
  await page.locator('#trajectory-toggle').check();
  await page.locator('#auto-retry').check();
  await page.locator('[data-speed="0.25"]').click();
  await expect(page.locator('[data-speed="0.25"]')).toHaveClass(/selected/);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('.sidebar-bottom [data-action="controls"]').isVisible().then(async visible => { if (!visible) await page.locator('.app-footer [data-action="controls"]').click(); });
  await expect(page.locator('#controls-dialog')).toBeVisible();
  await page.screenshot({ path: 'test-results/mobile-controls.png', fullPage: true });
});
