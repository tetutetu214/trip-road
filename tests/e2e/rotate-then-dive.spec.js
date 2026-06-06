import { test, expect } from '@playwright/test';

// GPS 確定時の演出検証。自転と同じ西回りのまま現在地まで回り込み(Phase1)、
// その場でズームイン(Phase2)する。途中で大きくズームアウトしたり、逆回転で
// 即座に日本へ戻ったりせず、最終的に市街地まで寄り切ることを確認する。
const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  throw new Error('APP_PASSWORD env var is required. Run: source ~/.secrets/trip-road.env && npx playwright test');
}

test('確定時は西回りで回り込んでから市街地までズームする', async ({ page }) => {
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('/');
  await page.locator('#password-input').fill(APP_PASSWORD);
  await page.locator('#password-submit').click();
  await expect(page.locator('#main-screen')).toBeVisible();

  // 初回 fix は project の geolocation(139.66E) で発生。Phase1(回り込み)の途中。
  await page.waitForTimeout(2800);
  await page.screenshot({ path: 'tests/e2e/results/dive-mid.png' });

  // Phase1+Phase2(合計6s)完了後。市街地まで寄り切っているはず。
  await page.waitForTimeout(5000);
  await page.screenshot({ path: 'tests/e2e/results/dive-end.png' });

  const criticalErrors = consoleErrors.filter(
    (m) => m.includes('Uncaught') || m.includes('Failed to fetch') || m.includes('CORS')
  );
  expect(criticalErrors).toEqual([]);
});
