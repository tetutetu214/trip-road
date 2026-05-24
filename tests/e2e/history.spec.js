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
 * 指定 lat/lng に対応する polygon layer を再帰的に探して click を fire する。
 *
 * Playwright の page.mouse.click / page.touchscreen.tap は、Leaflet がレベル
 * 切替（clearLayers + 再 add）した直後の SVG/Canvas に対して click event を
 * 発火しないことがある（Playwright と Leaflet の renderer 相互作用の問題）。
 * 実機 iPhone Safari の本物の touch event は Leaflet 内部で click に変換され
 * 通常通り動くため、E2E ではハンドラのロジック検証に絞り、内部 fire で代替する。
 */
async function fireAt(page, lat, lng) {
  return await page.evaluate(({ lat, lng }) => {
    const map = window.__tripRoadHistory?.map;
    if (!map) return 'no map';
    // turf で実形状の point-in-polygon 判定（bounds.contains は矩形なので不適切）
    const targetPoint = turf.point([lng, lat]);
    let found = null;
    const walk = (layer) => {
      if (found) return;
      if (layer.feature && layer.feature.geometry) {
        try {
          if (turf.booleanPointInPolygon(targetPoint, layer.feature)) {
            found = layer;
            return;
          }
        } catch (_) { /* unsupported geometry */ }
      }
      if (typeof layer.eachLayer === 'function') layer.eachLayer(walk);
    };
    map.eachLayer(walk);
    if (!found) return 'not found';
    found.fire('click');
    return 'fired';
  }, { lat, lng });
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

  test('履歴画面オープン: 🗺️ で開き「日本全土」タイトルが出る', async ({ page }) => {
    const consoleMessages = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[history]')) consoleMessages.push(msg.text());
    });

    await enterHistoryScreen(page);
    await expect(page.locator('.history-title')).toHaveText('日本全土');

    // console に [history] history open が出ていることも確認
    await expect.poll(() => consoleMessages.find(m => m.includes('history open')) || null)
      .not.toBeNull();

    await page.screenshot({ path: 'tests/e2e/results/history-01-level0.png' });
  });

  test('レベル0→1: 地方を 2 タップで都道府県レベルに遷移する', async ({ page }) => {
    await enterHistoryScreen(page);

    // データロード完了を待つ
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.conquests?.length ?? 0),
      { timeout: 10000 },
    ).toBeGreaterThan(0);

    const kantoCenter = { lat: 36.2, lng: 139.5 };

    // 1 タップ目: pendingRegion がセットされる
    await fireAt(page, kantoCenter.lat, kantoCenter.lng);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.pendingRegion),
      { timeout: 3000 },
    ).toBe('kanto');
    await expect(page.locator('.history-title')).toHaveText('日本全土');

    // 2 タップ目: レベル 1 へ遷移
    await fireAt(page, kantoCenter.lat, kantoCenter.lng);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.level),
      { timeout: 5000 },
    ).toBe(1);
    await expect(page.locator('.history-title')).toHaveText('関東');

    await page.screenshot({ path: 'tests/e2e/results/history-02-level1-kanto.png' });
  });

  test('レベル1→2→3: 関東 → 神奈川 → 緑塗り市町村タップで詳細モーダル表示', async ({ page }) => {
    page.on('console', (msg) => {
      if (msg.text().includes('[history]')) console.log('  CONSOLE>', msg.text());
    });
    await enterHistoryScreen(page);

    // データロード完了を待つ
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.conquests?.length ?? 0),
      { timeout: 10000 },
    ).toBeGreaterThan(0);

    // 関東 → レベル 1 へ（2 タップ）
    await fireAt(page, 36.2, 139.5);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.pendingRegion),
      { timeout: 3000 },
    ).toBe('kanto');
    await fireAt(page, 36.2, 139.5);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.level),
      { timeout: 5000 },
    ).toBe(1);
    await expect(page.locator('.history-title')).toHaveText('関東');

    // 神奈川県の bounds 中心
    const kanagawaCenter = await page.evaluate(() => {
      const map = window.__tripRoadHistory?.map;
      if (!map) return null;
      let found = null;
      const walk = (layer) => {
        if (layer.feature?.properties?.prefecture_code === '14') { found = layer; return; }
        if (typeof layer.eachLayer === 'function') layer.eachLayer(walk);
      };
      map.eachLayer(walk);
      if (!found) return null;
      const center = found.getBounds().getCenter();
      return { lat: center.lat, lng: center.lng };
    });
    if (!kanagawaCenter) throw new Error('神奈川 feature が見つからない');

    // 神奈川 → レベル 2 へ（2 タップ）
    await fireAt(page, kanagawaCenter.lat, kanagawaCenter.lng);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.pendingPrefecture),
      { timeout: 3000 },
    ).toBe('14');
    await fireAt(page, kanagawaCenter.lat, kanagawaCenter.lng);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.level),
      { timeout: 10000 },
    ).toBe(2);
    await expect(page.locator('.history-title')).toContainText('神奈川');

    // L2 描画完了（市町村ポリゴン add 完了）を待つ
    await expect.poll(
      async () => await page.evaluate(() => {
        const map = window.__tripRoadHistory?.map;
        let count = 0;
        map.eachLayer((layer) => {
          if (typeof layer.eachLayer === 'function') {
            layer.eachLayer((sub) => { if (sub.feature?.properties?.N03_007) count++; });
          }
        });
        return count;
      }),
      { timeout: 15000 },
    ).toBeGreaterThan(0);

    // 神奈川県の踏破済 muni を 1 件選び、その polygon の bounds 中心を取得して click
    const muniCenter = await page.evaluate(() => {
      const conquests = window.__tripRoadHistory?.conquests || [];
      const target = conquests.find((c) => c.prefecture_code === '14');
      if (!target) return null;
      const map = window.__tripRoadHistory?.map;
      let found = null;
      const walk = (layer) => {
        if (layer.feature?.properties?.N03_007 === target.muni_code) { found = layer; return; }
        if (typeof layer.eachLayer === 'function') layer.eachLayer(walk);
      };
      map.eachLayer(walk);
      if (!found) return { muni: target.muni_code, error: 'polygon not found' };
      const center = found.getBounds().getCenter();
      return { muni: target.muni_code, name: target.name, lat: center.lat, lng: center.lng };
    });
    console.log('TARGET MUNI:', muniCenter);
    if (!muniCenter || muniCenter.error) {
      throw new Error('踏破済 muni の polygon が見つからない: ' + JSON.stringify(muniCenter));
    }

    // 市町村クリック → 詳細モーダル表示
    await fireAt(page, muniCenter.lat, muniCenter.lng);
    await expect.poll(
      async () => await page.evaluate(() => window.__tripRoadHistory?.level),
      { timeout: 5000 },
    ).toBe(3);

    await expect(page.locator('#history-detail')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('#history-detail')).toContainText(muniCenter.name);

    await page.screenshot({ path: 'tests/e2e/results/history-03-detail-modal.png' });
  });
});
