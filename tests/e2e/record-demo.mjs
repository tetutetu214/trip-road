/**
 * trip-road デモ録画スクリプト（Playwright・スタンドアロン）。
 *
 * 流れ: パスワード画面スキップ → 地球俯瞰を約3秒 → 新宿へ西回りで回り込み →
 *       市街地までズーム → 「土地のたより」表示、を iPhone 縦サイズで動画に録る。
 *
 * 自宅の位置情報は一切使わない（navigator.geolocation を新宿固定のフェイクに差し替え）。
 *
 * 実行: set -a && source ~/.secrets/trip-road.env && set +a && node tests/e2e/record-demo.mjs
 */
import { chromium } from '@playwright/test';
import fs from 'node:fs';

const APP_PASSWORD = process.env.APP_PASSWORD;
if (!APP_PASSWORD) {
  throw new Error('APP_PASSWORD env var is required. Run: source ~/.secrets/trip-road.env && node tests/e2e/record-demo.mjs');
}

const URL = 'https://trip-road.tetutetu214.com/';
// 新宿駅あたり（自宅ではなくここを現在地として見せる）。
const SHINJUKU = { latitude: 35.6896, longitude: 139.7006 };
const GLOBE_HOLD_MS = 3000; // 地球俯瞰を見せる時間（この後に新宿の fix を発火）
const OUT_DIR = 'demo';

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 13 Pro 相当
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: OUT_DIR, size: { width: 390, height: 844 } },
});
const page = await context.newPage();

// ページの全スクリプトより前に実行される。localStorage にパスワードを仕込んで
// パスワード画面をスキップし、geolocation を「3秒待ってから新宿」を返すフェイクに差し替える。
await page.addInitScript(
  ({ pw, coords, holdMs }) => {
    // パスワード画面スキップ（app.js は state.password があれば即メイン画面へ）。
    localStorage.setItem(
      'trip-road-state',
      JSON.stringify({ password: pw, visited: {}, track: [], currentMuniCd: null }),
    );

    // 自宅を一切問い合わせない固定フェイク。最初の holdMs は何も返さず地球俯瞰を見せ、
    // その後に新宿を報告→以降も定期的に同じ位置を送る（追従用）。
    const position = {
      coords: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy: 20,
        altitude: 40,
        altitudeAccuracy: 10,
        heading: null,
        speed: null,
      },
      timestamp: Date.now(),
    };
    // 自動発火せず、外（Playwright 側）から window.__fireFix() を呼んだ時だけ
    // 新宿を報告する。これで「スタイル読込完了→地球儀を3秒見せる→発火」を
    // 正確に制御できる（holdMs は使わない）。
    window.__fireFix = () => {};
    const fake = {
      getCurrentPosition(success) {
        window.__fireFix = () => success(position);
      },
      watchPosition(success) {
        window.__fireFix = () => {
          success(position);
          setInterval(() => success(position), 2000);
        };
        return 1;
      },
      clearWatch() {},
    };
    Object.defineProperty(navigator, 'geolocation', { value: fake, configurable: true });
  },
  { pw: APP_PASSWORD, coords: SHINJUKU, holdMs: GLOBE_HOLD_MS },
);

const tNav = Date.now();
await page.goto(URL, { waitUntil: 'domcontentloaded' });

// メイン画面（地図）表示を待つ。
await page.waitForSelector('#main-screen', { state: 'visible', timeout: 15000 });

// 地図スタイルの読込完了を待つ（ここまでは黒い画面なので後でトリミングする）。
await page.waitForFunction(() => window.__trMap && window.__trMap.isStyleLoaded(), { timeout: 20000 });
// 動画のうち、この秒数より前は黒い読込画面なのでトリミングの起点にする。
const blackMs = Date.now() - tNav;

// 地球儀をしっかり見せる（この間 idle 自転がゆっくり回る）。
await page.waitForTimeout(GLOBE_HOLD_MS);

// 新宿の位置を発火 → 西回りで回り込み → ズームイン。
await page.evaluate(() => window.__fireFix());

// 回り込み(3.5s) → ズーム(2.5s) の演出完了まで待つ。
await page.waitForTimeout(3500 + 2500 + 500);

// 「土地のたより」本文が出るまで待つ（Bedrock 生成。最大15s）。
await page
  .waitForFunction(
    () => {
      const el = document.querySelector('#description');
      return el && el.textContent && el.textContent.trim().length > 20;
    },
    { timeout: 15000 },
  )
  .catch(() => {});

// 解説を見せる余韻。
await page.waitForTimeout(2500);

const video = page.video(); // クローズ前に参照を取得
await context.close(); // ここで動画が確定保存される
await browser.close();

const videoPath = await video.path();
console.log('VIDEO_PATH=' + videoPath);
console.log('BLACK_MS=' + blackMs);
