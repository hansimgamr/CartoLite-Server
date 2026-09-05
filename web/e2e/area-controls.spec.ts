import { test, expect, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/state', (route) => route.fulfill({ json: {
    schemaVersion: 2, bootId: 'synthetic-area', seq: 0, serverTime: 100,
    status: { feed: 'connected', activity: 'quiet', lastPacketAt: 0, dropped: 0, version: 'test', gitSha: 'test' },
    map: { center: [11, 21], zoom: 7 }, nodes: [], routes: []
  } }));
  await page.route(/https:\/\//, (route) => route.request().url().includes('tiles.json')
    ? route.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://example.invalid/{z}/{x}/{y}.mvt'], minzoom: 0, maxzoom: 14 } })
    : route.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    class QuietFeed extends EventTarget { close() {} }
    Object.defineProperty(window, 'EventSource', { value: QuietFeed });
  });
});

async function openArea(page: Page) {
  if (await page.locator('#layers-summary').isVisible()) await page.locator('#layers-summary').click();
  await page.locator('#area-button').click();
  await expect(page.locator('#area-panel')).toBeVisible();
}

test('preset, custom edits, cancel, reload and clear stay usable within the viewport', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?area=test-region');
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '10,20,12,22');
  await expect(page.locator('#area-summary')).toContainText('Test region');
  await openArea(page);
  await expect(page.locator('#area-mode')).toHaveValue('test-region');
  await page.locator('#area-mode').selectOption('custom');
  await expect(page.locator('.area-handle')).toHaveCount(5);
  await expect(page.locator('#area-west')).toHaveValue('10');
  await page.locator('#area-west').fill('');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#area-error')).toContainText('Check all four');
  await page.locator('#area-cancel').click();
  await expect(page.locator('#area-panel')).toBeHidden();
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '10,20,12,22');
  await expect(page.locator('.area-handle')).toHaveCount(0);
  await openArea(page);
  await page.locator('#area-mode').selectOption('custom');
  await page.locator('#area-west').fill('9.5');
  await page.locator('#area-fit').click();
  const outside = await page.locator('#area-panel, #area-summary-bar').evaluateAll((elements) => elements.some((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left < 0 || rect.top < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1 || element.scrollWidth > element.clientWidth + 1;
  }));
  expect(outside).toBe(false);
  const sizes = await page.locator('#area-panel button, #area-panel input, #area-panel select').evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect(); return [rect.width, rect.height];
  }));
  for (const [width, height] of sizes) { expect(width).toBeGreaterThanOrEqual(44); expect(height).toBeGreaterThanOrEqual(44); }
  await page.screenshot({ path: info.outputPath('custom-area.png') });
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.locator('#area-summary')).toContainText('Custom area');
  await expect(page).toHaveURL(/area=9.5%2C20%2C12%2C22/);
  await page.goto('/'); // Saved preference, not just the URL.
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '9.5,20,12,22');
  await page.mouse.move(30, 170);
  await page.mouse.down();
  await page.mouse.move(65, 200, { steps: 4 });
  await page.mouse.up();
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '9.5,20,12,22');
  await openArea(page);
  await page.locator('#area-west').fill('11');
  await page.keyboard.press('Escape');
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '9.5,20,12,22');
  await page.locator('#area-clear').click();
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '');
  await expect(page.locator('#area-summary')).toContainText('All received traffic');
  await page.reload();
  await expect(page.locator('#area-summary')).toContainText('All received traffic');
  expect(errors).toEqual([]);
});

test('invalid links and blocked storage do not break startup or cancellation', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Storage blocked'); } }));
  await page.goto('/?area=bad&area=test-region');
  await expect(page.locator('#area-summary')).toContainText('All received traffic');
  await openArea(page);
  await expect(page.locator('#area-status')).toContainText('Invalid');
  await page.locator('#area-mode').selectOption('test-region');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await openArea(page);
  await expect(page.locator('#area-status')).toContainText('storage is unavailable');
  await expect(page.locator('#area-link')).toHaveAttribute('href', /area=test-region/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#fatal')).toBeHidden();
  expect(errors).toEqual([]);
});

test('drag handles move/resize, and keyboard fields provide an equivalent path', async ({ page, isMobile }) => {
  await page.goto('/?area=test-region');
  await openArea(page);
  await page.locator('#area-mode').selectOption('custom');
  await page.locator('#area-fit').click();
  const centre = page.locator('.area-handle').nth(4);
  const rect = await centre.boundingBox();
  expect(rect).not.toBeNull();
  if (isMobile) {
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect!.x + 22, y: rect!.y + 22 }] });
    for (let step = 1; step <= 5; step++) await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: rect!.x + 22 + step * 4, y: rect!.y + 22 - step * 2 }] });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
  } else {
    await page.mouse.move(rect!.x + 22, rect!.y + 22);
    await page.mouse.down();
    await page.mouse.move(rect!.x + 42, rect!.y + 12, { steps: 5 });
    await page.mouse.up();
  }
  await expect(page.locator('#area-west')).not.toHaveValue('10');
  const west = Number(await page.locator('#area-west').inputValue());
  const east = Number(await page.locator('#area-east').inputValue());
  expect(east - west).toBeCloseTo(2);
  const corner = await page.locator('.area-handle').nth(2).boundingBox();
  await page.mouse.move(corner!.x + 22, corner!.y + 22);
  await page.mouse.down();
  await page.mouse.move(corner!.x + 32, corner!.y + 12, { steps: 5 });
  await page.mouse.up();
  expect(Number(await page.locator('#area-east').inputValue()) - west).not.toBeCloseTo(2);
  await page.locator('#area-west').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('#area-south')).toBeFocused();
  await page.locator('#area-cancel').click();
  await expect(page.locator('#map')).toHaveAttribute('data-area-bounds', '10,20,12,22');
});
