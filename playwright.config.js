import { defineConfig, devices } from '@playwright/test';

/**
 * trip-road E2E テスト設定。
 * 本番デプロイ済の https://trip-road.tetutetu214.com を対象に
 * iPhone 13 Pro エミュレーションで動作確認する。
 *
 * 実行: APP_PASSWORD=xxx npx playwright test
 *   または: source ~/.secrets/trip-road.env && npx playwright test
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,  // 順序依存はないが API 課金を抑えるため逐次
  retries: 1,            // ネットワーク瞬断対策
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'tests/e2e/report' }]],
  outputDir: 'tests/e2e/results',
  use: {
    baseURL: 'https://trip-road.tetutetu214.com',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium-iphone-emulated',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },  // iPhone 13 Pro size
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        permissions: ['geolocation'],
        // 久喜市役所付近 (saitama)
        geolocation: { latitude: 36.0640, longitude: 139.6691 },
      },
    },
    {
      // 実 iPhone Safari と同じエンジン (WebKit)。Linux 依存ライブラリが
      // インストール済みでないと起動しないが、揃っていれば実機相当の検証ができる。
      // 起動失敗時は --project=chromium-iphone-emulated で代替可能。
      name: 'webkit-iphone',
      use: {
        browserName: 'webkit',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        permissions: ['geolocation'],
        geolocation: { latitude: 36.0640, longitude: 139.6691 },
      },
    },
    {
      // PC ワイド画面 (Chromium) での検証用。履歴画面が PC で開かれる
      // ケースで viewport が広いことに起因するレイアウト問題を再現する。
      name: 'desktop-chromium',
      use: {
        browserName: 'chromium',
        viewport: { width: 1456, height: 819 },
        isMobile: false,
        hasTouch: false,
        permissions: ['geolocation'],
        geolocation: { latitude: 36.0640, longitude: 139.6691 },
      },
    },
  ],
});
