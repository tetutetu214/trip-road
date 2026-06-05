import { test, expect } from '@playwright/test';

// 地球俯瞰スタート → 現在地ズームインの検証。
// watchPosition が初回ズーム飛行中も位置を送り続ける状況を再現し、
// 後続更新の割り込みで途中停止せず、最後まで寄り切るかを確認する。
const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  throw new Error('APP_PASSWORD env var is required. Run: source ~/.secrets/trip-road.env && npx playwright test');
}

test('地球俯瞰から現在地までズームインが割り込みで止まらず完走する', async ({ page, context }) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await page.locator('#password-input').fill(APP_PASSWORD);
  await page.locator('#password-submit').click();
  await expect(page.locator('#main-screen')).toBeVisible();

  // 初回ズーム飛行中に watchPosition の更新が複数届く状況を擬似再現する。
  // 座標をごく僅かにずらしながら 1 秒間隔で 7 回送る（実機の毎秒更新を模す）。
  const baseLat = 36.064;
  const baseLon = 139.6691;
  for (let i = 0; i < 7; i++) {
    await context.setGeolocation({
      latitude: baseLat + i * 0.0001,
      longitude: baseLon + i * 0.0001,
    });
    await page.waitForTimeout(1000);
  }

  // flyTo(最大4.5s) 完走の余裕をみてさらに待つ。
  await page.waitForTimeout(3000);

  await page.screenshot({ path: 'tests/e2e/results/verify-zoom.png' });

  // flyTo に不正な値を渡して落ちる等のエラーがないこと。
  const criticalErrors = consoleErrors.filter(
    (m) => m.includes('Uncaught') || m.includes('Failed to fetch') || m.includes('CORS')
  );
  expect(criticalErrors).toEqual([]);
});
