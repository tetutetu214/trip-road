/**
 * 踏破履歴ビュー（Phase 13）の E2E。
 *
 * 既存 main.spec.js と同じ chromium-iphone-emulated で iPhone Safari 相当の
 * 挙動を再現する。タップによる「2 タップ遷移」「市町村クリックで詳細モーダル」
 * など、iPhone 実機で確認していたフローを自動化する。
 *
 * 実行: source ~/.secrets/trip-road.env && npx playwright test history.spec.js
 */
import { test, expect } from '@playwright/test';

const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  throw new Error('APP_PASSWORD env var is required.');
}

/**
 * パスワード画面 → メイン画面 → 履歴画面まで遷移するヘルパー。
 * conquests 同期で時間を取られないよう、最小限の待機にする。
 */
async function enterHistoryScreen(page) {
  await page.goto('/');
  await page.locator('#password-input').fill(APP_PASSWORD);
  await page.locator('#password-submit').click();
  await expect(page.locator('#main-screen')).toBeVisible();

  // 🗺️ ボタンが表示されるまで待つ
  const historyBtn = page.locator('#history-open');
  await expect(historyBtn).toBeVisible();
  await historyBtn.click();

  await expect(page.locator('#history-screen')).toBeVisible({ timeout: 10000 });
}

test.describe('踏破履歴ビュー E2E', () => {
  test('diag: 関東タップ前後の内部状態と Canvas hit testing の検証', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
      if (msg.text().includes('[history]')) console.log('  >', msg.text());
    });

    await enterHistoryScreen(page);
    await page.waitForTimeout(2500); // データロード待ち

    const before = await page.evaluate(() => ({
      level: window.__tripRoadHistory?.level,
      region: window.__tripRoadHistory?.region,
      pendingRegion: window.__tripRoadHistory?.pendingRegion,
      conquestsCount: window.__tripRoadHistory?.conquests?.length,
    }));
    console.log('BEFORE tap:', before);

    // タップ位置のピクセル座標と、その位置の HTML 要素を確認
    const tapInfo = await page.evaluate(({ lat, lng }) => {
      const map = window.__tripRoadHistory?.map;
      if (!map) return { error: 'no map' };
      const point = map.latLngToContainerPoint([lat, lng]);
      const mapEl = document.getElementById('history-map');
      const rect = mapEl.getBoundingClientRect();
      const pageX = rect.left + point.x;
      const pageY = rect.top + point.y;
      const elem = document.elementFromPoint(pageX, pageY);
      return {
        latLng: [lat, lng],
        mapPoint: { x: point.x, y: point.y },
        pageXY: { x: pageX, y: pageY },
        elemTag: elem?.tagName,
        elemClass: elem?.className,
      };
    }, { lat: 36.2, lng: 139.5 });
    console.log('TAP TARGET:', tapInfo);

    // 実タップ（touchscreen）
    await page.touchscreen.tap(tapInfo.pageXY.x, tapInfo.pageXY.y);
    await page.waitForTimeout(800);

    const after = await page.evaluate(() => ({
      level: window.__tripRoadHistory?.level,
      region: window.__tripRoadHistory?.region,
      pendingRegion: window.__tripRoadHistory?.pendingRegion,
    }));
    console.log('AFTER tap (touchscreen):', after);

    // touchscreen で何も変わっていなければ、map.fire('click') で内部発火を試す
    if (after.pendingRegion === before.pendingRegion && after.level === before.level) {
      console.log('  touchscreen.tap did NOT trigger Leaflet click. Trying map.fire("click")...');
      await page.evaluate(({ lat, lng }) => {
        const map = window.__tripRoadHistory?.map;
        map.fire('click', { latlng: L.latLng(lat, lng), containerPoint: map.latLngToContainerPoint([lat, lng]) });
      }, { lat: 36.2, lng: 139.5 });
      await page.waitForTimeout(500);
      const after2 = await page.evaluate(() => ({
        level: window.__tripRoadHistory?.level,
        region: window.__tripRoadHistory?.region,
        pendingRegion: window.__tripRoadHistory?.pendingRegion,
      }));
      console.log('AFTER map.fire("click"):', after2);
    }

    // mouse.click も試す
    await page.evaluate(() => { window.__tripRoadHistory.pendingRegion = null; });
    await page.mouse.click(tapInfo.pageXY.x, tapInfo.pageXY.y);
    await page.waitForTimeout(500);
    const afterMouse = await page.evaluate(() => ({
      pendingRegion: window.__tripRoadHistory?.pendingRegion,
    }));
    console.log('AFTER mouse.click:', afterMouse);

    console.log('console errors:', consoleErrors);
  });

  test('履歴画面オープン: 🗺️ で開き、デバッグログにオープンが記録される', async ({ page }) => {
    await enterHistoryScreen(page);

    // debugMsg で「history open」が表示される
    const debugLog = page.locator('#history-debug-log');
    await expect(debugLog).toBeVisible({ timeout: 5000 });
    await expect(debugLog).toContainText('history open');

    // タイトルが「日本全土」
    await expect(page.locator('.history-title')).toHaveText('日本全土');

    await page.screenshot({ path: 'tests/e2e/results/history-01-level0.png' });
  });

  test('レベル0→1: 地方を 2 タップで都道府県レベルに遷移する', async ({ page }) => {
    await enterHistoryScreen(page);

    // Leaflet の SVG / Canvas に対して、Leaflet の API から関東地方を取得して
    // その中心座標をクリックする（DOM 上の path 要素のタップは Canvas で困難）
    const kantoCenter = { lat: 36.2, lng: 139.5 };

    // map のピクセル座標に変換してタップ
    const tapAt = async (lat, lng) => {
      const point = await page.evaluate(
        ({ lat, lng }) => {
          const map = window.__tripRoadHistory?.map;
          if (!map) throw new Error('window.__tripRoadHistory.map is not exposed');
          const p = map.latLngToContainerPoint([lat, lng]);
          return { x: p.x, y: p.y };
        },
        { lat, lng },
      );
      const mapBox = await page.locator('#history-map').boundingBox();
      // iPhone エミュレーション（hasTouch: true）では mouse event ではなく
      // touch event を発火しないと Leaflet の Canvas hit testing が動かない
      await page.touchscreen.tap(mapBox.x + point.x, mapBox.y + point.y);
    };

    // 1 タップ目: ハイライト（pendingRegion がセットされる）
    await tapAt(kantoCenter.lat, kantoCenter.lng);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.pendingRegion),
      { timeout: 3000 },
    ).toBe('kanto');
    await expect(page.locator('.history-title')).toHaveText('日本全土');

    // 2 タップ目: 遷移
    await tapAt(kantoCenter.lat, kantoCenter.lng);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.level),
      { timeout: 5000 },
    ).toBe(1);
    await expect(page.locator('.history-title')).toHaveText('関東');

    await page.screenshot({ path: 'tests/e2e/results/history-02-level1-kanto.png' });
  });

  test('レベル1→2→3: 関東 → 神奈川 → 緑塗り市町村タップで詳細モーダル表示', async ({ page }) => {
    await enterHistoryScreen(page);

    const tapAt = async (lat, lng) => {
      const point = await page.evaluate(
        ({ lat, lng }) => {
          const map = window.__tripRoadHistory?.map;
          if (!map) throw new Error('window.__tripRoadHistory.map is not exposed');
          const p = map.latLngToContainerPoint([lat, lng]);
          return { x: p.x, y: p.y };
        },
        { lat, lng },
      );
      const mapBox = await page.locator('#history-map').boundingBox();
      // iPhone エミュレーション（hasTouch: true）では mouse event ではなく
      // touch event を発火しないと Leaflet の Canvas hit testing が動かない
      await page.touchscreen.tap(mapBox.x + point.x, mapBox.y + point.y);
    };

    // 関東 → 神奈川 → 県内へ
    await tapAt(36.2, 139.5);
    await page.waitForTimeout(500);
    await tapAt(36.2, 139.5);
    await page.waitForTimeout(1500);
    await expect(page.locator('.history-title')).toHaveText('関東');

    // 神奈川県（横浜あたり）をタップ
    await tapAt(35.4, 139.5);
    await page.waitForTimeout(500);
    await tapAt(35.4, 139.5);
    await page.waitForTimeout(2000);
    await expect(page.locator('.history-title')).toContainText('神奈川');

    // デバッグログに L2 が出ているはず
    await expect(page.locator('#history-debug-log')).toContainText('L2');

    // 県内の踏破済 muni_code を JS から取得し、その代表点をタップ
    const targetCenter = await page.evaluate(() => {
      const conquests = window.__tripRoadHistory?.conquests || [];
      const target = conquests.find((c) => c.prefecture_code === '14');
      if (!target) return null;
      // 簡易的に Leaflet の latLngToContainerPoint で位置取得は無理なので
      // muni_code から大まかな緯度経度をマッピング
      // 14216 = 綾瀬市 → 約 35.43, 139.43
      // 14152 = 厚木市 → 約 35.44, 139.36
      // 14150 = 相模原市緑区 → 約 35.59, 139.34
      const guess = {
        '14216': { lat: 35.43, lng: 139.43 },
        '14152': { lat: 35.44, lng: 139.36 },
        '14150': { lat: 35.59, lng: 139.34 },
        '14151': { lat: 35.55, lng: 139.34 },
      };
      return guess[target.muni_code] || null;
    });

    if (!targetCenter) {
      test.skip(true, '神奈川県の踏破済 muni がテスト想定の中になかったためスキップ');
    }

    await tapAt(targetCenter.lat, targetCenter.lng);
    await page.waitForTimeout(1000);

    // 詳細モーダルが表示されることを期待
    await expect(page.locator('#history-detail')).toBeVisible({ timeout: 3000 });

    // デバッグログに tap と L3 が出ているはず
    await expect(page.locator('#history-debug-log')).toContainText('tap');
    await expect(page.locator('#history-debug-log')).toContainText('L3');

    await page.screenshot({ path: 'tests/e2e/results/history-03-detail-modal.png' });
  });
});
