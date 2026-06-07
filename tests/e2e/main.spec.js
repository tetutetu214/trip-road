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

  test('5. 解説表示後に 👍/👎 が出てトグル記録できる（Issue #17）', async ({ page }) => {
    await page.goto('/');
    await page.locator('#password-input').fill(APP_PASSWORD);
    await page.locator('#password-submit').click();
    await expect(page.locator('#main-screen')).toBeVisible();

    // skeleton はアプリ起動直後（GPS 確定前・ロード開始前）も hidden なので、
    // 先に GPS 確定（muni-name が「現在地を取得中...」から変わる）を待たないと
    // skeleton の hidden 判定が早すぎて、解説ロード前に rating を見にいってしまう。
    await expect(page.locator('#muni-name')).not.toHaveText('現在地を取得中...', { timeout: 30000 });

    // 解説が確定する（skeleton が消える）と rating 行が表示される
    await expect(page.locator('#description-skeleton')).toBeHidden({ timeout: 30000 });
    const rating = page.locator('#tayori-rating');
    await expect(rating).toBeVisible({ timeout: 10000 });

    const up = page.locator('#rating-up');
    const down = page.locator('#rating-down');

    // 初期は未選択
    await expect(up).toHaveAttribute('aria-pressed', 'false');
    await expect(down).toHaveAttribute('aria-pressed', 'false');

    // 👍 を押すと up だけが選択状態になる
    await up.click();
    await expect(up).toHaveAttribute('aria-pressed', 'true');
    await expect(down).toHaveAttribute('aria-pressed', 'false');

    // localStorage の telemetry に user_rating='up' が記録される
    const recorded = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('trip-road-state') || '{}');
      const rated = (s.telemetry || []).filter((e) => e.user_rating != null);
      return rated.length ? rated[rated.length - 1].user_rating : null;
    });
    expect(recorded).toBe('up');

    // 同じ 👍 を再タップすると取り消されて未選択に戻る
    await up.click();
    await expect(up).toHaveAttribute('aria-pressed', 'false');

    await page.screenshot({ path: 'tests/e2e/results/05-rating.png' });
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
