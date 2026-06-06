import { test, expect } from '@playwright/test';

// GPS 未確定（何も操作しない）間の地球俯瞰の挙動検証。
// 旧実装は 15 秒のフォールバックで日本へ戻していたが、本来は同じ向きに
// 回り続けるべき。位置情報を拒否して GPS を確定させず、旧フォールバックの
// 発火時刻(15s)を超えて観察し、日本へ戻らず西へ回り続けることを確認する。
const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  throw new Error('APP_PASSWORD env var is required. Run: source ~/.secrets/trip-road.env && npx playwright test');
}

test('GPS未確定の間は地球が回り続け日本へ戻らない', async ({ page, context }) => {
  // 位置情報を拒否して GPS を確定させない（idle 自転を観察するため）。
  await context.clearPermissions();

  await page.goto('/');
  await page.locator('#password-input').fill(APP_PASSWORD);
  await page.locator('#password-submit').click();
  await expect(page.locator('#main-screen')).toBeVisible();

  // 8 秒時点（西へ少し回ったあたり）。
  await page.waitForTimeout(8000);
  await page.screenshot({ path: 'tests/e2e/results/idle-spin-08s.png' });

  // 旧フォールバック(15s)を超えた 18 秒時点。日本へ戻っていないことを目視確認する。
  await page.waitForTimeout(10000);
  await page.screenshot({ path: 'tests/e2e/results/idle-spin-18s.png' });
});
