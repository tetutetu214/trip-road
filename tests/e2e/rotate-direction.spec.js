import { test, expect } from '@playwright/test';

// GPS 確定時の回り込みが「西回り（経度が減る＝長い方）」であることを定量検証する。
// 逆回転（最短経路で東へ戻る）だと総移動量はごく小さい正値になる。
// 西回りで回り込むと総移動量は大きな負値になる。
const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  throw new Error('APP_PASSWORD env var is required. Run: source ~/.secrets/trip-road.env && npx playwright test');
}

test('確定時の回り込みは西回り（東向きの逆回転ではない）', async ({ page }) => {
  await page.goto('/');
  await page.locator('#password-input').fill(APP_PASSWORD);
  await page.locator('#password-submit').click();
  await expect(page.locator('#main-screen')).toBeVisible();

  // 回り込み中の中心経度を時系列で収集する（ブラウザ側で実行）。
  const samples = await page.evaluate(async () => {
    const map = window.__trMap;
    const out = [];
    const start = Date.now();
    return await new Promise((resolve) => {
      const id = setInterval(() => {
        if (map) out.push(map.getCenter().lng);
        if (Date.now() - start > 5000) {
          clearInterval(id);
          resolve(out);
        }
      }, 150);
    });
  });

  // 連続差分を unwrap（±180 をまたぐジャンプを補正）して総移動量を求める。
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    let d = samples[i] - samples[i - 1];
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    total += d;
  }

  // 西回り = 経度が減る = total が大きく負。逆回転なら 0 付近〜小さい正値。
  expect(total).toBeLessThan(-90);
});
