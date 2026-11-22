import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const api = 'http://127.0.0.1:3001';
const origin = 'http://127.0.0.1:3000';
const pngDir = 'visual-screenshots';
await mkdir(pngDir, { recursive: true });

const illustration = (heading, sub, color) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="580" viewBox="0 0 900 580">
    <rect width="900" height="580" fill="#eef5f8"/>
    <rect x="70" y="72" width="760" height="436" rx="36" fill="${color}"/>
    <rect x="115" y="120" width="670" height="340" rx="20" fill="#ffffff" opacity=".85"/>
    <rect x="148" y="152" width="180" height="135" rx="13" fill="#dae5e8"/>
    <rect x="350" y="152" width="185" height="135" rx="13" fill="#bfccd1"/>
    <rect x="555" y="152" width="180" height="135" rx="13" fill="#d2e1e1"/>
    <rect x="148" y="311" width="585" height="104" rx="13" fill="#e8eff0"/>
    <text x="450" y="355" font-size="36" font-family="Arial, sans-serif" fill="#334155" text-anchor="middle">${heading}</text>
    <text x="450" y="400" font-size="21" font-family="Arial, sans-serif" fill="#64748b" text-anchor="middle">${sub}</text>
  </svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
};

async function post(route, body) {
  const response = await fetch(api + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Seed failed: ${route} HTTP ${response.status} ${await response.text()}`);
}

const now = Date.now();
for (const name of ['家里', '工程实验室']) await post('/api/categories', { name });
await post('/api/scenes', {
  id: 'visual-kitchen', locationCategory: '厨房收纳柜', superCategory: '家里',
  timestamp: now - 5000,
  fullImageUrl: illustration('Kitchen drawer', 'DEMO PHOTO', '#b7d5cf'),
  items: [
    { itemName: '咖啡滤纸', category: '日用品', scene: '厨房', preciseLocation: '上层盒子',
      remarks: '', box_2d: [250, 300, 650, 650] },
    { itemName: '茶包', category: '食品', scene: '厨房', preciseLocation: '右侧',
      remarks: '', box_2d: [520, 200, 790, 530] }
  ]
});
await post('/api/scenes', {
  id: 'visual-lab', locationCategory: '电子元件抽屉', superCategory: '工程实验室',
  timestamp: now - 15000,
  fullImageUrl: illustration('Electronics lab', 'DEMO PHOTO', '#b9cbd9'),
  items: [
    { itemName: 'Pigeon IMU', category: '传感器', scene: '书房', preciseLocation: '第二层',
      remarks: '', box_2d: [210, 310, 620, 660] },
    { itemName: 'M5 螺丝', category: '紧固件', scene: '书房', preciseLocation: '左侧分格',
      remarks: '', box_2d: [110, 230, 420, 570] }
  ]
});

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  locale: 'zh-CN'
});
const page = await context.newPage();
page.on('pageerror', err => console.log('Page error:', err.message));
await page.route('**/dashscope-api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({
    output: { choices: [{ message: { content: [{
      text: JSON.stringify({
        suggestedSpace: '工程实验室',
        suggestedLocation: '测试抽屉',
        items: [
          { itemName: 'Pigeon IMU', category: '传感器', scene: '书房',
            preciseLocation: '左侧', remarks: '', box_2d: [100, 120, 400, 500] },
          { itemName: 'M5 螺丝', category: '紧固件', scene: '书房',
            preciseLocation: '右侧', remarks: '', box_2d: [500, 100, 800, 440] }
        ]
      })
    }] } }] }
  })
}));
await page.goto(origin, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1400);
await page.screenshot({ path: `${pngDir}/01-gallery-mobile.png` });

await page.getByRole('button', { name: /找东西/ }).first().click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${pngDir}/02-search-mobile.png` });

await page.getByRole('button', { name: /记东西/ }).first().click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${pngDir}/03-add-photo-mobile.png` });

const chooserPromise = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /选一张/ }).click();
const chooser = await chooserPromise;
const photoSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">
<rect width="800" height="600" fill="#d8e8ee"/><rect x="50" y="80" width="700" height="440" fill="#bacfd5" rx="20"/>
<rect x="95" y="120" width="260" height="165" fill="#ffffff" rx="14"/>
<rect x="395" y="120" width="260" height="165" fill="#ffffff" rx="14"/>
<text x="400" y="395" text-anchor="middle" font-family="Arial" font-size="52">DEMO IMAGE</text>
</svg>`;
await chooser.setFiles({ name: 'demo.svg', mimeType: 'image/svg+xml',
  buffer: Buffer.from(photoSvg) });
await page.waitForTimeout(1700);
await page.screenshot({ path: `${pngDir}/04-capture-mobile.png` });
console.log('Captured four mobile screenshots using seeded demonstration inventory.');
await browser.close();
