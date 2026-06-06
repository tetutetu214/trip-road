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

  // 回り込み中の中心経度・ズームを時系列で収集する（ブラウザ側で実行）。
  const data = await page.evaluate(async () => {
    const lng = [];
    const zoom = [];
    let everHadMap = false;
    const start = Date.now();
    return await new Promise((resolve) => {
      const id = setInterval(() => {
        const map = window.__trMap; // 毎回読み直す（initMap 前は未定義のため）
        if (map) {
          everHadMap = true;
          lng.push(Number(map.getCenter().lng.toFixed(2)));
          zoom.push(Number(map.getZoom().toFixed(2)));
        }
        if (Date.now() - start > 7000) {
          clearInterval(id);
          resolve({ hasMap: everHadMap, lng, zoom });
        }
      }, 120);
    });
  });

  const samples = data.lng;
  // 連続差分を unwrap（±180 をまたぐジャンプを補正）して総移動量を求める。
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    let d = samples[i] - samples[i - 1];
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    total += d;
  }
  console.log('hasMap=', data.hasMap, 'n=', samples.length, 'total=', total.toFixed(1));
  console.log('lng=', JSON.stringify(samples));
  console.log('zoom=', JSON.stringify(data.zoom));

  // 西回り = 経度が減る = total が大きく負。逆回転なら 0 付近〜小さい正値。
  expect(total).toBeLessThan(-90);
});
