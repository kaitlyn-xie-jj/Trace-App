import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const origin = 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true, hasTouch: true, locale: 'zh-CN',
    acceptDownloads: true
  });
  const page = await context.newPage();
  page.on('pageerror', error => { throw error; });
  await page.goto(origin, { waitUntil: 'domcontentloaded' });

  // Visual-capture.mjs has already seeded known photo and item records.
  await page.getByText('电子元件抽屉').first().waitFor({ timeout: 10000 });
  await page.screenshot({ path: 'visual-screenshots/05-gallery-with-export.png' });

  // A browser download must preserve complete photos, locations, future fields.
  page.on('dialog', dialog => dialog.accept());
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.getByRole('button', { name: '导出完整收纳记录' }).click()
  ]);
  assert.match(download.suggestedFilename(), /^Trace-export-\d{4}-\d\d-\d\d\.json$/);
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const exported = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  assert.equal(exported.format, 'trace-scenes-export');
  assert.equal(exported.formatVersion, 1);
  assert.equal(exported.scenes.length, 2);
  assert(exported.categories.includes('工程实验室'));
  const scene = exported.scenes.find(s => s.id === 'visual-lab');
  assert(scene && scene.fullImageUrl.startsWith('data:image/svg+xml;base64,'));
  assert(scene.items.some(item => item.itemName === 'M5 螺丝'));

  // A failed scenes API must *not* render 'empty gallery' / data-loss messaging.
  await page.route('**/api/scenes', route => route.fulfill({
    status: 503, contentType: 'application/json',
    body: JSON.stringify({ error: 'deliberate smoke-test outage' })
  }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '暂时无法读取收纳记录' })
    .waitFor({ timeout: 10000 });
  assert.equal(await page.getByText('百宝箱是空的').count(), 0);
  assert.equal(await page.getByRole('button', { name: '导出完整收纳记录' }).isDisabled(), true);

  // Retry after outage should render the original inventory, not an empty list.
  await page.unroute('**/api/scenes');
  await page.getByRole('button', { name: '重新加载' }).click();
  await page.getByText('电子元件抽屉').first().waitFor({ timeout: 10000 });

  // The existing 'find item' flow must work without external model calls.
  await page.getByRole('button', { name: '找东西' }).first().click();
  await page.getByRole('textbox', { name: '描述要找的物品' })
    .fill('Pigeon IMU在哪里？');
  await page.getByRole('button', { name: '发送搜索问题' }).click();
  await page.getByText(/根据上次记录/).waitFor({ timeout: 10000 });
  await page.getByText('电子元件抽屉').first().waitFor({ timeout: 10000 });

  // This is a mobile viewport check, not a native iPhone/Android test.
  const bounds = await page.evaluate(() => ({
    contentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }));
  assert(bounds.contentWidth <= bounds.viewportWidth + 2, 'Horizontal overflow on 390px viewport');
  console.log('PASS: gallery download, photo integrity, fetch error, retry, local search, mobile overflow.');
} finally {
  await browser.close();
}
