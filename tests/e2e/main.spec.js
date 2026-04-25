import { test, expect } from '@playwright/test';

const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  throw new Error('APP_PASSWORD env var is required. Run: source ~/.secrets/trip-road.env && npx playwright test');
}

test.describe('trip-road メイン画面 E2E', () => {
  test('1. パスワード画面が表示される（スモーク）', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('trip-road');
    await expect(page.locator('#password-screen')).toBeVisible();
    await expect(page.locator('#main-screen')).toBeHidden();
    await expect(page.locator('.password-title')).toHaveText('trip-road');
    await page.screenshot({ path: 'tests/e2e/results/01-password-screen.png' });
  });

  test('2. 空入力で「はじめる」が disabled', async ({ page }) => {
    await page.goto('/');
    const submit = page.locator('#password-submit');
    await expect(submit).toBeDisabled();
    await page.locator('#password-input').fill('a');
    await expect(submit).toBeEnabled();
  });

  test('3. 正しいパスワードでメイン画面に遷移、地図と土地のたよりが表示される', async ({ page }) => {
    // Console エラーを収集
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto('/');
    await page.locator('#password-input').fill(APP_PASSWORD);
    await page.locator('#password-submit').click();

    // メイン画面遷移確認
    await expect(page.locator('#main-screen')).toBeVisible();
    await expect(page.locator('#password-screen')).toBeHidden();

    // 地図コンテナと現在地マーカー
    await expect(page.locator('#map')).toBeVisible();

    // 市町村名が「現在地を取得中...」から実際の名前に変わるまで待機
    await expect(page.locator('#muni-name')).not.toHaveText('現在地を取得中...', { timeout: 30000 });
    const muniName = await page.locator('#muni-name').textContent();
    expect(muniName).toBeTruthy();
    expect(muniName.length).toBeGreaterThan(0);

    // 土地のたよりが skeleton から実テキストになるまで待機（Anthropic 呼出 + 数秒）
    await expect(page.locator('#description-skeleton')).toBeHidden({ timeout: 30000 });
    const description = await page.locator('#description').textContent();
    expect(description).toBeTruthy();
    expect(description.length).toBeGreaterThan(50);  // 120-180字想定だが下限ゆるめ

    // 制覇カウントが 1 以上
    const visitedCount = await page.locator('#visited-count').textContent();
    expect(parseInt(visitedCount, 10)).toBeGreaterThanOrEqual(1);

    await page.screenshot({ path: 'tests/e2e/results/03-main-screen.png', fullPage: true });

    // クリティカルなコンソールエラーがないこと（CORS や Failed fetch など）
    const criticalErrors = consoleErrors.filter(
      (msg) => msg.includes('CORS') || msg.includes('Failed to fetch') || msg.includes('Uncaught')
    );
    expect(criticalErrors).toEqual([]);
  });

  test('4. visibilitychange 後も地図サイズが正しく保たれる（バグ修正検証）', async ({ page }) => {
    await page.goto('/');
    await page.locator('#password-input').fill(APP_PASSWORD);
    await page.locator('#password-submit').click();
    await expect(page.locator('#main-screen')).toBeVisible();
    await page.waitForTimeout(2000);  // 地図初期描画

    // 地図サイズ取得（before）
    const mapBefore = await page.locator('#map').boundingBox();
    const topBarBefore = await page.locator('.top-bar').boundingBox();

    // visibilitychange イベントを手動 dispatch
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { value: true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      // 復帰
      Object.defineProperty(document, 'hidden', { value: false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.waitForTimeout(500);  // map.invalidateSize の setTimeout 100ms 待ち

    // 地図サイズが大きく変わっていないこと
    const mapAfter = await page.locator('#map').boundingBox();
    const topBarAfter = await page.locator('.top-bar').boundingBox();

    expect(mapAfter.height).toBeCloseTo(mapBefore.height, -1); // ±10px 程度の許容
    expect(topBarAfter.y).toBeCloseTo(topBarBefore.y, -1);

    await page.screenshot({ path: 'tests/e2e/results/04-after-visibility.png' });
  });
});
