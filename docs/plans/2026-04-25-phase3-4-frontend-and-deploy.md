# trip-road Phase 3-4 Implementation Plan - Frontend + Deploy + Real-Device Test

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vanilla JS + Leaflet + Turf.js でフロントエンドを実装し、Cloudflare Pages（独自ドメイン `trip-road.tetutetu214.com`）にデプロイ、iPhone Safari で「ホーム画面に追加」→ スタンドアロンモード起動 → 実走で trip-road アプリが動作する状態を実現する。

**Architecture:** Plan A の `trip-road-data.tetutetu214.com`（N03 分割 GeoJSON + adjacency.json）と Plan B の `trip-road-api.tetutetu214.com/api/describe`（認証付き Anthropic プロキシ）を消費するフロント。単一ページ構成で、GPS→P-in-P 判定→LLM 呼出（キャッシュあり）→ 地図・軌跡・制覇カウント更新 という 1 本のパイプラインを回す。モックアップ `docs/design/preview.html` のダークテーマを CSS トークンとして再現。

**Tech Stack:** Vanilla JavaScript (ES Modules) / Leaflet.js 1.9.4 (CDN) / Turf.js 7.x booleanPointInPolygon (CDN) / 地理院タイル / PWA (apple-touch-icon + manifest.json) / Vitest 1.6 for unit tests / Cloudflare Pages (wrangler 4.x)

---

## ブランチ戦略

Plan C の全タスクは単一ブランチ `feature/phase3-4-frontend` で進める。最終タスクで main への PR を作成してマージする。

## File Structure

**新規作成**:
- `public/index.html` — PWA メタタグ + アプリ DOM 構造
- `public/manifest.json` — PWA マニフェスト
- `public/icon-180.png` — apple-touch-icon（仮置き "TR"）
- `public/assets/app.css` — ダークテーマ CSS
- `public/assets/config.js` — URL 定数
- `public/assets/season.js` — 純粋関数（TDD）
- `public/assets/cache.js` — 純粋関数（TDD）
- `public/assets/storage.js` — localStorage ラッパー（TDD）
- `public/assets/api.js` — Workers fetch + 指数バックオフ
- `public/assets/gsi.js` — GSI 逆ジオコーダ client
- `public/assets/muni.js` — P-in-P + 隣接プリフェッチ
- `public/assets/map.js` — Leaflet 初期化
- `public/assets/geo.js` — Geolocation ラッパー
- `public/assets/ui.js` — DOM 更新
- `public/assets/app.js` — メインオーケストレータ
- `test/season.test.js`
- `test/cache.test.js`
- `test/storage.test.js`
- `package.json` — フロント用 devDependency
- `vitest.config.js`

**修正**:
- `.gitignore` — `node_modules/` は既存ルートルールで OK
- `docs/todo.md`
- `docs/knowledge.md`

---

## Phase 3-4 Tasks

### Task 1: feature ブランチ + フロント構造 + vitest セットアップ

**Files:**
- Create: `/home/tetutetu/projects/trip-road/package.json`
- Create: `/home/tetutetu/projects/trip-road/vitest.config.js`

- [ ] **Step 1: feature ブランチ作成**

```bash
git -C /home/tetutetu/projects/trip-road switch -c feature/phase3-4-frontend
```

Expected: `Switched to a new branch 'feature/phase3-4-frontend'`

- [ ] **Step 2: ディレクトリ作成**

```bash
mkdir -p /home/tetutetu/projects/trip-road/public/assets
mkdir -p /home/tetutetu/projects/trip-road/test
```

- [ ] **Step 3: ルート package.json を作成**

```bash
cat > /home/tetutetu/projects/trip-road/package.json <<'EOF'
{
  "name": "trip-road-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "serve": "python3 -m http.server 8000 --directory public",
    "deploy": "wrangler pages deploy public --project-name=trip-road --branch=main"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
EOF
```

- [ ] **Step 4: vitest.config.js 作成**

```bash
cat > /home/tetutetu/projects/trip-road/vitest.config.js <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
EOF
```

- [ ] **Step 5: vitest インストール**

```bash
cd /home/tetutetu/projects/trip-road
npm install
```

Expected: `added N packages`

- [ ] **Step 6: 動作確認**

```bash
cd /home/tetutetu/projects/trip-road
npx vitest run
```

Expected: `No test files found`（test/ が空のため）。exit code 1 だが OK。

---

### Task 2: `icon-180.png`（仮置きアイコン作成）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/icon-180.png`

- [ ] **Step 1: ImageMagick の存在確認、無ければインストール**

```bash
command -v convert > /dev/null 2>&1 && echo "ImageMagick OK" || sudo apt install -y imagemagick
```

Expected: `ImageMagick OK` もしくはインストール完了。

- [ ] **Step 2: 180×180 PNG アイコン生成**

```bash
convert -size 180x180 xc:"#0f0f10" \
  -fill "#5dcaa5" -pointsize 90 -font "DejaVu-Sans-Bold" \
  -gravity center -annotate +0+0 "TR" \
  /home/tetutetu/projects/trip-road/public/icon-180.png
```

Expected: エラー無し、ファイルが生成される。

- [ ] **Step 3: 検証**

```bash
file /home/tetutetu/projects/trip-road/public/icon-180.png
identify /home/tetutetu/projects/trip-road/public/icon-180.png
```

Expected: `PNG image data, 180 x 180, 8-bit/color RGB...` 形式の出力。

---

### Task 3: `index.html` + `manifest.json`（PWA 基盤）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/index.html`
- Create: `/home/tetutetu/projects/trip-road/public/manifest.json`

- [ ] **Step 1: `manifest.json` を Write ツールで作成**

ファイル: `/home/tetutetu/projects/trip-road/public/manifest.json`

```json
{
  "name": "trip-road",
  "short_name": "trip-road",
  "description": "GPSで土地のたよりを届ける、旅のお供",
  "icons": [
    { "src": "/icon-180.png", "sizes": "180x180", "type": "image/png" }
  ],
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f10",
  "theme_color": "#0f0f10",
  "orientation": "portrait"
}
```

- [ ] **Step 2: `index.html` を Write ツールで作成**

ファイル: `/home/tetutetu/projects/trip-road/public/index.html`

```html
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0f0f10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="trip-road">
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
<link rel="manifest" href="/manifest.json">
<title>trip-road</title>

<!-- Leaflet CSS (CDN) -->
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
      crossorigin=""/>

<link rel="stylesheet" href="/assets/app.css">
</head>
<body>

<!-- パスワード入力画面 -->
<section id="password-screen" class="screen">
  <div class="password-wrap">
    <div class="password-title">trip-road</div>
    <div class="password-subtitle">旅のお供、始めます</div>
    <input type="password" id="password-input" placeholder="合言葉" autocomplete="off" spellcheck="false">
    <button type="button" id="password-submit" disabled>はじめる</button>
    <div id="password-error" class="password-error hidden"></div>
  </div>
</section>

<!-- メイン画面 -->
<section id="main-screen" class="screen hidden">
  <!-- 上部フロートチップ -->
  <div class="top-bar">
    <div class="chip chip-now">
      <svg class="pin" viewBox="0 0 18 18"><circle cx="9" cy="9" r="7" stroke="#9fe1cb" stroke-width="1.2" fill="none"/><circle cx="9" cy="9" r="2.5" fill="#9fe1cb"/></svg>
      <div>
        <div class="chip-label">いま</div>
        <div class="chip-value" id="muni-name">現在地を取得中...</div>
      </div>
    </div>
    <div class="chip chip-count">
      <div class="chip-label">制覇</div>
      <div class="chip-value"><span id="visited-count">0</span><span class="chip-unit">市町村</span></div>
    </div>
  </div>

  <!-- 地図エリア -->
  <div id="map" class="map"></div>
  <div class="map-attribution">出典：地理院タイル</div>

  <!-- 下部カード -->
  <div class="bottom-card">
    <div class="drag-handle"></div>
    <div class="muni-row">
      <div>
        <div class="muni-romaji" id="muni-romaji"></div>
        <div class="muni-name-big" id="muni-name-big">—</div>
      </div>
      <div class="speed-wrap">
        <div class="speed-label">SPEED</div>
        <div class="speed-value"><span id="speed">--</span><span class="speed-unit">km/h</span></div>
      </div>
    </div>

    <!-- 土地のたよりカード -->
    <div class="tayori-card">
      <div class="tayori-label-row">
        <div class="tayori-line"></div>
        <span class="tayori-label">土地のたより</span>
      </div>
      <div id="description" class="tayori-body"></div>
      <div id="description-skeleton" class="tayori-skeleton hidden">
        <div></div><div></div><div class="short"></div>
      </div>
    </div>

    <!-- フッター -->
    <div class="footer-row">
      <div class="disclaimer">
        <svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" stroke="#6a6a70" stroke-width="0.8" fill="none"/><path d="M5 3 L5 5.5 L6.5 6.5" stroke="#6a6a70" stroke-width="0.8" stroke-linecap="round"/></svg>
        情報は目安です
      </div>
      <div class="gps-status" id="gps-status">
        <span class="dot dot-inactive" id="gps-dot"></span>
        <span id="gps-text">GPS 測位中</span>
      </div>
    </div>
  </div>
</section>

<!-- Leaflet JS (CDN) -->
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
        integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="
        crossorigin=""></script>

<!-- Turf.js booleanPointInPolygon (CDN) -->
<script src="https://unpkg.com/@turf/turf@7.0.0/turf.min.js"></script>

<!-- App entry point -->
<script type="module" src="/assets/app.js"></script>
</body>
</html>
```

- [ ] **Step 3: Python HTTP サーバで開いて HTML 構造を目視確認**

```bash
cd /home/tetutetu/projects/trip-road
python3 -m http.server 8000 --directory public &
sleep 1
curl -s http://localhost:8000/ | head -30
kill %1
```

Expected: `<!DOCTYPE html>` で始まる HTML の冒頭が返る。

---

### Task 4: `app.css`（ダークテーマ + レイアウト）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/assets/app.css`

- [ ] **Step 1: Write ツールで `app.css` 作成**

ファイル: `/home/tetutetu/projects/trip-road/public/assets/app.css`

```css
:root {
  --color-bg: #0f0f10;
  --color-bg-map: #18181a;
  --color-bg-card: rgba(22,22,24,0.85);
  --color-bg-card-inner: rgba(255,255,255,0.03);

  --color-text: #f5f5f7;
  --color-text-body: #d8d8dc;
  --color-text-muted: #7a7a80;
  --color-text-hint: #6a6a70;

  --color-accent: #5dcaa5;
  --color-accent-light: #9fe1cb;
  --color-error: #e08080;

  --color-border: rgba(255,255,255,0.08);
  --color-border-subtle: rgba(255,255,255,0.06);

  --font-sans: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", "Meiryo", sans-serif;
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--color-bg);
  color: var(--color-text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
  overscroll-behavior: none;
}

body {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.hidden { display: none !important; }

.screen {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
}

/* ===== パスワード画面 ===== */
#password-screen {
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
}
.password-wrap {
  width: 280px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.password-title {
  font-size: 14px;
  letter-spacing: 0.14em;
  color: var(--color-accent-light);
  text-transform: uppercase;
  margin-bottom: 4px;
}
.password-subtitle {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-bottom: 24px;
}
#password-input {
  width: 260px;
  height: 44px;
  padding: 0 16px;
  background: rgba(255,255,255,0.05);
  border: 0.5px solid var(--color-border);
  border-radius: 12px;
  color: var(--color-text);
  font-size: 15px;
  font-family: inherit;
  outline: none;
  margin-bottom: 12px;
}
#password-input:focus { border-color: var(--color-accent); }
#password-submit {
  width: 260px;
  height: 44px;
  background: var(--color-accent);
  color: var(--color-bg);
  border: none;
  border-radius: 12px;
  font-size: 15px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: opacity 150ms;
}
#password-submit:disabled { opacity: 0.4; pointer-events: none; }
#password-submit:active { opacity: 0.8; }
.password-error {
  font-size: 11px;
  color: var(--color-error);
  margin-top: 8px;
}

/* ===== メイン画面 ===== */
#main-screen {
  position: fixed;
  inset: 0;
  background: var(--color-bg);
}

.top-bar {
  position: absolute;
  top: env(safe-area-inset-top, 12px);
  left: 16px;
  right: 16px;
  z-index: 5;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  pointer-events: none;
}
.chip {
  background: var(--color-bg-card);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 0.5px solid var(--color-border);
  border-radius: 14px;
  padding: 10px 14px;
  pointer-events: auto;
}
.chip-now {
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: 70%;
}
.chip-now .pin { width: 18px; height: 18px; flex-shrink: 0; }
.chip-count {
  text-align: center;
  min-width: 62px;
  padding: 10px 12px;
}
.chip-label {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: var(--color-text-muted);
  text-transform: uppercase;
  line-height: 1;
  margin-bottom: 3px;
}
.chip-value {
  font-size: 15px;
  font-weight: 500;
  color: var(--color-text);
  line-height: 1.2;
}
.chip-count .chip-value { font-size: 17px; }
.chip-unit {
  font-size: 11px;
  color: var(--color-text-muted);
  margin-left: 2px;
}

.map {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 320px;
  background: var(--color-bg-map);
}
.map-attribution {
  position: absolute;
  bottom: 332px;
  right: 12px;
  background: rgba(22,22,24,0.9);
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 9px;
  color: var(--color-text-hint);
  z-index: 6;
}

.bottom-card {
  position: absolute;
  bottom: env(safe-area-inset-bottom, 0);
  left: 0;
  right: 0;
  background: linear-gradient(180deg, rgba(15,15,16,0) 0%, var(--color-bg) 14%, var(--color-bg) 100%);
  padding: 28px 20px 20px;
  z-index: 6;
}

.drag-handle {
  width: 36px;
  height: 4px;
  background: #3a3a3e;
  border-radius: 2px;
  margin: 0 auto 18px;
}

.muni-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 18px;
}
.muni-romaji {
  font-size: 11px;
  letter-spacing: 0.12em;
  color: var(--color-accent-light);
  text-transform: uppercase;
  margin-bottom: 6px;
  min-height: 14px;
}
.muni-name-big {
  font-size: 24px;
  font-weight: 500;
  line-height: 1.1;
  letter-spacing: -0.01em;
}
.speed-wrap { text-align: right; }
.speed-label {
  font-size: 10px;
  letter-spacing: 0.1em;
  color: var(--color-text-hint);
  text-transform: uppercase;
  margin-bottom: 2px;
}
.speed-value {
  display: flex;
  align-items: baseline;
  gap: 4px;
  justify-content: flex-end;
}
.speed-value > span:first-child {
  font-size: 28px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
.speed-unit {
  font-size: 12px;
  color: var(--color-text-muted);
}

.tayori-card {
  background: var(--color-bg-card-inner);
  border: 0.5px solid var(--color-border-subtle);
  border-radius: 16px;
  padding: 16px 18px;
  margin-bottom: 14px;
}
.tayori-label-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.tayori-line {
  width: 14px;
  height: 1px;
  background: var(--color-accent-light);
}
.tayori-label {
  font-size: 10px;
  letter-spacing: 0.14em;
  color: var(--color-accent-light);
  text-transform: uppercase;
}
.tayori-body {
  font-size: 14px;
  line-height: 1.75;
  color: var(--color-text-body);
  margin: 0;
  font-feature-settings: 'palt';
  min-height: 74px;
}
.tayori-body.muted {
  color: var(--color-text-muted);
  font-size: 12px;
  font-style: italic;
}
.tayori-skeleton {
  min-height: 74px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.tayori-skeleton > div {
  height: 12px;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  animation: skeleton 1.5s ease-in-out infinite;
}
.tayori-skeleton > div.short { width: 60%; }
@keyframes skeleton {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}

.footer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.disclaimer {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--color-text-hint);
}
.disclaimer svg { width: 10px; height: 10px; }

.gps-status {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  letter-spacing: 0.04em;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.dot-active {
  background: var(--color-accent);
  box-shadow: 0 0 0 0 rgba(93,202,165,0.6);
  animation: pulse 2s infinite;
}
.dot-inactive { background: var(--color-text-hint); }
.gps-status { color: var(--color-accent-light); }
.gps-status.inactive { color: var(--color-text-hint); }
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(93,202,165,0.6); }
  70% { box-shadow: 0 0 0 8px rgba(93,202,165,0); }
  100% { box-shadow: 0 0 0 0 rgba(93,202,165,0); }
}

/* ===== Leaflet 地図のダークテーマ調整 ===== */
.leaflet-container { background: var(--color-bg-map); }
.leaflet-control-attribution { display: none !important; }
```

- [ ] **Step 2: 最終行までファイル存在確認**

```bash
wc -l /home/tetutetu/projects/trip-road/public/assets/app.css
```

Expected: 280 行前後。

- [ ] **Step 3: コミット（Tasks 1-4 をまとめて）**

```bash
cd /home/tetutetu/projects/trip-road
git add package.json vitest.config.js package-lock.json public/index.html public/manifest.json public/icon-180.png public/assets/app.css
git commit -m "$(cat <<'EOF'
feat(frontend): PWA 基盤と HTML/CSS 骨格を追加

Plan C Phase 3 の土台として以下を実装:
- public/index.html: PWA メタタグ + パスワード画面 + メイン画面 DOM
- public/manifest.json: スタンドアロンモード用マニフェスト
- public/icon-180.png: 仮置き "TR" アイコン（180x180 PNG）
- public/assets/app.css: モックアップ準拠のダークテーマ (色トークン +
  glassmorphism のフロートチップ + 下部カード + 土地のたよりカード +
  スケルトンローディング + GPS パルスドット)
- package.json + vitest.config.js: フロント用テスト環境

Leaflet 1.9.4 と Turf.js 7.x は CDN で読み込む設計（バンドル不要）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin feature/phase3-4-frontend
```

Expected: `branch 'feature/phase3-4-frontend' set up to track ...`

---

### Task 5: `season.js` TDD（Red → Green → Commit）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/test/season.test.js`
- Create: `/home/tetutetu/projects/trip-road/public/assets/season.js`

- [ ] **Step 1: Write ツールで `test/season.test.js` を作成**

```javascript
import { describe, it, expect } from 'vitest';
import { getSeason } from '../public/assets/season.js';

describe('getSeason', () => {
  it('3-5月はspring', () => {
    expect(getSeason(new Date(2026, 2, 1))).toBe('spring');   // 3/1
    expect(getSeason(new Date(2026, 3, 15))).toBe('spring');  // 4/15
    expect(getSeason(new Date(2026, 4, 31))).toBe('spring');  // 5/31
  });
  it('6-8月はsummer', () => {
    expect(getSeason(new Date(2026, 5, 1))).toBe('summer');   // 6/1
    expect(getSeason(new Date(2026, 7, 31))).toBe('summer');  // 8/31
  });
  it('9-11月はautumn', () => {
    expect(getSeason(new Date(2026, 8, 1))).toBe('autumn');
    expect(getSeason(new Date(2026, 10, 30))).toBe('autumn');
  });
  it('12-2月はwinter', () => {
    expect(getSeason(new Date(2026, 11, 1))).toBe('winter');  // 12/1
    expect(getSeason(new Date(2026, 0, 15))).toBe('winter');  // 1/15
    expect(getSeason(new Date(2026, 1, 28))).toBe('winter');  // 2/28
  });
});
```

- [ ] **Step 2: テスト実行（Red）**

```bash
cd /home/tetutetu/projects/trip-road
npx vitest run test/season.test.js
```

Expected: Import 失敗で全テスト失敗。

- [ ] **Step 3: Write ツールで `public/assets/season.js` を作成**

```javascript
/**
 * 日付から日本の季節（spring/summer/autumn/winter）を返す。
 * 3-5月=春、6-8月=夏、9-11月=秋、12-2月=冬。
 *
 * @param {Date} [date=new Date()] - 判定する日付
 * @returns {'spring'|'summer'|'autumn'|'winter'}
 */
export function getSeason(date = new Date()) {
  const m = date.getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}
```

- [ ] **Step 4: テスト実行（Green）**

```bash
npx vitest run test/season.test.js
```

Expected: `4 passed`（it は 4 つ、各 it 内で複数 assertion）

- [ ] **Step 5: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/season.js test/season.test.js
git commit -m "$(cat <<'EOF'
feat(frontend): season.js を TDD で追加

月から季節（spring/summer/autumn/winter）を返す純粋関数。
境界値（3/1, 5/31, 6/1, 8/31, 9/1, 11/30, 12/1, 2/28）を含む
9 テストですべての月をカバー。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 6: `cache.js` TDD

**Files:**
- Create: `/home/tetutetu/projects/trip-road/test/cache.test.js`
- Create: `/home/tetutetu/projects/trip-road/public/assets/cache.js`

- [ ] **Step 1: Write ツールで `test/cache.test.js` 作成**

```javascript
import { describe, it, expect } from 'vitest';
import { makeCacheKey } from '../public/assets/cache.js';

describe('makeCacheKey', () => {
  it('市町村コードと季節を "_" で繋ぐ', () => {
    expect(makeCacheKey('14151', 'spring')).toBe('14151_spring');
    expect(makeCacheKey('13101', 'winter')).toBe('13101_winter');
  });
});
```

- [ ] **Step 2: テスト実行（Red）**

```bash
cd /home/tetutetu/projects/trip-road
npx vitest run test/cache.test.js
```

Expected: Import 失敗。

- [ ] **Step 3: Write ツールで `public/assets/cache.js` 作成**

```javascript
/**
 * 市町村コードと季節からキャッシュキーを生成する。
 * 形式: "{code}_{season}" （例: "14151_spring"）
 *
 * @param {string} code - 市町村コード
 * @param {'spring'|'summer'|'autumn'|'winter'} season
 * @returns {string}
 */
export function makeCacheKey(code, season) {
  return `${code}_${season}`;
}
```

- [ ] **Step 4: テスト実行（Green）**

```bash
npx vitest run test/cache.test.js
```

Expected: `1 passed`（it 1 個に assertion 2 つ）。

- [ ] **Step 5: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/cache.js test/cache.test.js
git commit -m "feat(frontend): cache.js を TDD で追加（キャッシュキー生成）

$(printf '\n')Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

---

### Task 7: `storage.js` TDD（localStorage 抽象化）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/test/storage.test.js`
- Create: `/home/tetutetu/projects/trip-road/public/assets/storage.js`

- [ ] **Step 1: Write ツールで `test/storage.test.js` 作成**

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadState,
  savePassword,
  getPassword,
  clearPassword,
  markVisited,
  getCachedDescription,
  setCachedDescription,
  appendTrack,
  getVisitedCount,
} from '../public/assets/storage.js';

// localStorage のメモリモック
beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (key) => (store[key] ?? null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
});

describe('password helpers', () => {
  it('savePassword / getPassword / clearPassword', () => {
    expect(getPassword()).toBeNull();
    savePassword('secret');
    expect(getPassword()).toBe('secret');
    clearPassword();
    expect(getPassword()).toBeNull();
  });
});

describe('visited helpers', () => {
  it('markVisited で新しい市町村が登録される', () => {
    expect(getVisitedCount()).toBe(0);
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(getVisitedCount()).toBe(1);
    const state = loadState();
    expect(state.visited['14151'].name).toBe('相模原市緑区');
    expect(state.visited['14151'].prefecture).toBe('神奈川県');
    expect(state.visited['14151'].firstVisit).toBeDefined();
  });

  it('同じ市町村を再訪問してもカウント増えない', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(getVisitedCount()).toBe(1);
  });
});

describe('description cache', () => {
  it('setCachedDescription / getCachedDescription', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(getCachedDescription('14151', 'spring')).toBeNull();
    setCachedDescription('14151', 'spring', '緑区は…');
    expect(getCachedDescription('14151', 'spring')).toBe('緑区は…');
    // 違う季節はまだ null
    expect(getCachedDescription('14151', 'summer')).toBeNull();
  });
});

describe('track', () => {
  it('appendTrack で座標が追加される', () => {
    appendTrack(35.681, 139.767);
    appendTrack(35.682, 139.768);
    const state = loadState();
    expect(state.track).toHaveLength(2);
    expect(state.track[0].lat).toBe(35.681);
    expect(state.track[1].lon).toBe(139.768);
    expect(state.track[0].ts).toBeDefined();
  });
});
```

- [ ] **Step 2: テスト実行（Red）**

```bash
cd /home/tetutetu/projects/trip-road
npx vitest run test/storage.test.js
```

Expected: Import 失敗。

- [ ] **Step 3: Write ツールで `public/assets/storage.js` 作成**

```javascript
/**
 * trip-road の localStorage スキーマを抽象化するラッパー。
 *
 * キー "trip-road-state" に単一 JSON オブジェクトを保存する形式:
 *   {
 *     password: string | null,
 *     visited: { [code]: { name, prefecture, firstVisit, descriptions: {spring, summer, autumn, winter} } },
 *     track: [{ lat, lon, ts }],
 *     currentMuniCd: string | null
 *   }
 */

const STORAGE_KEY = 'trip-road-state';

function emptyState() {
  return { password: null, visited: {}, track: [], currentMuniCd: null };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return { ...emptyState(), ...parsed };
  } catch (e) {
    return emptyState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// === Password ===
export function savePassword(password) {
  const state = loadState();
  state.password = password;
  saveState(state);
}
export function getPassword() {
  return loadState().password;
}
export function clearPassword() {
  const state = loadState();
  state.password = null;
  saveState(state);
}

// === Visited ===
export function markVisited(code, name, prefecture) {
  const state = loadState();
  if (!state.visited[code]) {
    state.visited[code] = {
      name,
      prefecture,
      firstVisit: new Date().toISOString(),
      descriptions: { spring: null, summer: null, autumn: null, winter: null },
    };
  }
  state.currentMuniCd = code;
  saveState(state);
}
export function getVisitedCount() {
  return Object.keys(loadState().visited).length;
}

// === Description cache ===
export function getCachedDescription(code, season) {
  const v = loadState().visited[code];
  if (!v) return null;
  return v.descriptions?.[season] ?? null;
}
export function setCachedDescription(code, season, text) {
  const state = loadState();
  if (!state.visited[code]) return; // markVisited が先行する前提
  state.visited[code].descriptions ??= {};
  state.visited[code].descriptions[season] = text;
  saveState(state);
}

// === Track ===
export function appendTrack(lat, lon) {
  const state = loadState();
  state.track.push({ lat, lon, ts: Date.now() });
  saveState(state);
}
```

- [ ] **Step 4: テスト実行（Green）**

```bash
npx vitest run test/storage.test.js
```

Expected: `5 passed`

- [ ] **Step 5: 全 TDD テスト実行**

```bash
npx vitest run
```

Expected: `10 passed`（season 4 + cache 1 + storage 5）

- [ ] **Step 6: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/storage.js test/storage.test.js
git commit -m "$(cat <<'EOF'
feat(frontend): storage.js を TDD で追加（localStorage スキーマ抽象化）

- password: savePassword / getPassword / clearPassword
- visited: markVisited（ゾンビ重複防止） + getVisitedCount
- 解説キャッシュ: getCachedDescription / setCachedDescription
- 軌跡: appendTrack

全てキー "trip-road-state" 配下に JSON 1 個で保存。起動時の loadState で
デフォルト展開、部分更新時はマージして書き戻す設計。

vitest の node 環境では localStorage が無いため、メモリモックを
beforeEach で注入して5 テストを pass。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 8: `config.js` + `api.js`（URL 定数 + Workers API client）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/assets/config.js`
- Create: `/home/tetutetu/projects/trip-road/public/assets/api.js`

- [ ] **Step 1: `config.js` を Write ツールで作成**

```javascript
/**
 * trip-road フロントエンドの URL 定数。
 */
export const DATA_BASE_URL = 'https://trip-road-data.tetutetu214.com';
export const API_BASE_URL = 'https://trip-road-api.tetutetu214.com';
export const GSI_REVERSE_GEOCODER = 'https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress';
export const TILE_URL = 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png';
```

- [ ] **Step 2: `api.js` を Write ツールで作成**

```javascript
/**
 * Workers API `/api/describe` を呼び出す。3 回まで指数バックオフで再試行。
 */
import { API_BASE_URL } from './config.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 土地のたよりを取得する。
 *
 * @param {string} password - X-App-Password に送る値
 * @param {{prefecture: string, municipality: string, season: string}} req
 * @returns {Promise<{ok: true, description: string} | {ok: false, status: number, error: string}>}
 */
export async function fetchDescription(password, req) {
  let lastError = { ok: false, status: 0, error: 'unknown' };

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/describe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Password': password,
        },
        body: JSON.stringify(req),
      });

      if (res.status === 401) {
        return { ok: false, status: 401, error: 'unauthorized' };
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, status: 400, error: data.detail ?? 'bad_request' };
      }
      if (res.ok) {
        const data = await res.json();
        if (data?.description) return { ok: true, description: data.description };
        lastError = { ok: false, status: res.status, error: 'empty_description' };
      } else {
        lastError = { ok: false, status: res.status, error: 'upstream_error' };
      }
    } catch (e) {
      lastError = { ok: false, status: 0, error: String(e) };
    }

    // 最後の試行でなければ待機して再試行
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  return lastError;
}
```

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/config.js public/assets/api.js
git commit -m "$(cat <<'EOF'
feat(frontend): config.js と api.js を追加

- config.js: データ/API/GSI/タイルの URL 定数
- api.js: Workers /api/describe を呼び出し、指数バックオフ
  (1秒→2秒→4秒) で 3 回まで再試行

401 は即 return（認証系エラー、リトライしても無駄）、
400 も即 return（入力エラー）、それ以外の 5xx / network は
リトライ対象。

副作用を含むため vitest では未検証、Task 15（app.js 統合）で
ブラウザから動作確認する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 9: `gsi.js` + `muni.js`（フォールバック + P-in-P）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/assets/gsi.js`
- Create: `/home/tetutetu/projects/trip-road/public/assets/muni.js`

- [ ] **Step 1: `gsi.js` を Write ツールで作成**

```javascript
/**
 * 国土地理院 逆ジオコーダへの呼出。緯度経度→市町村コード。
 */
import { GSI_REVERSE_GEOCODER } from './config.js';

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string|null>} 市町村コード、取得失敗なら null
 */
export async function reverseGeocode(lat, lon) {
  try {
    const url = `${GSI_REVERSE_GEOCODER}?lat=${lat}&lon=${lon}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.muniCd ?? null;
  } catch (e) {
    return null;
  }
}
```

- [ ] **Step 2: `muni.js` を Write ツールで作成**

```javascript
/**
 * 市町村ポリゴンの読込・P-in-P 判定・adjacency プリフェッチ。
 * Turf.js（global `turf`）と config.js の DATA_BASE_URL を使用する。
 */
import { DATA_BASE_URL } from './config.js';
import { reverseGeocode } from './gsi.js';

/** @type {Map<string, object>} */
const loadedPolygons = new Map();

/** @type {object|null} */
let adjacencyMap = null;

/**
 * adjacency.json を 1 回だけロード（キャッシュ）。
 */
async function loadAdjacency() {
  if (adjacencyMap) return adjacencyMap;
  try {
    const res = await fetch(`${DATA_BASE_URL}/adjacency.json`);
    adjacencyMap = await res.json();
  } catch (e) {
    adjacencyMap = {};
  }
  return adjacencyMap;
}

/**
 * 指定コードの GeoJSON を fetch してキャッシュに登録。
 */
async function loadMunicipality(code) {
  if (loadedPolygons.has(code)) return loadedPolygons.get(code);
  try {
    const res = await fetch(`${DATA_BASE_URL}/municipalities/${code}.geojson`);
    if (!res.ok) return null;
    const geojson = await res.json();
    const feature = geojson?.features?.[0];
    if (feature) {
      loadedPolygons.set(code, feature);
      return feature;
    }
  } catch (e) {}
  return null;
}

/**
 * 判定: 現在→隣接→GSI の順に市町村コードを確定させる。
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string|null} currentCode - 直近の市町村コード
 * @returns {Promise<{code: string, name: string, prefecture: string}|null>}
 */
export async function identifyMunicipality(lat, lon, currentCode) {
  const pt = turf.point([lon, lat]);

  // Step 1: 現在の市町村
  if (currentCode) {
    const f = await loadMunicipality(currentCode);
    if (f && turf.booleanPointInPolygon(pt, f)) {
      return extractProps(f);
    }
  }

  // Step 2: 隣接
  const adjacency = await loadAdjacency();
  const neighbors = currentCode ? (adjacency[currentCode] ?? []) : [];
  for (const code of neighbors) {
    const f = await loadMunicipality(code);
    if (f && turf.booleanPointInPolygon(pt, f)) {
      return extractProps(f);
    }
  }

  // Step 3: GSI フォールバック
  const gsiCode = await reverseGeocode(lat, lon);
  if (gsiCode) {
    const f = await loadMunicipality(gsiCode);
    if (f) return extractProps(f);
  }

  return null;
}

function extractProps(feature) {
  const p = feature.properties;
  return {
    code: p.N03_007,
    name: p.N03_004,
    prefecture: p.N03_001,
  };
}

/**
 * 市町村切替後、隣接市町村の GeoJSON を背景 fetch（fire-and-forget）。
 *
 * @param {string} code
 */
export async function prefetchNeighbors(code) {
  const adjacency = await loadAdjacency();
  const neighbors = adjacency[code] ?? [];
  for (const n of neighbors) {
    if (!loadedPolygons.has(n)) {
      loadMunicipality(n); // await しない（背景）
    }
  }
}
```

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/gsi.js public/assets/muni.js
git commit -m "$(cat <<'EOF'
feat(frontend): gsi.js と muni.js を追加（市町村判定パイプライン）

- gsi.js: 国土地理院 逆ジオコーダへのフェッチ
- muni.js:
  - 市町村 GeoJSON の lazy load + in-memory キャッシュ
  - adjacency.json を 1 回だけロード
  - identifyMunicipality: 現在→隣接→GSIフォールバックの 3 段階 P-in-P
  - prefetchNeighbors: 市町村切替時の背景 fetch

Turf.js は index.html で CDN 読込の global `turf` を利用。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 10: `map.js` + `geo.js`（Leaflet + Geolocation）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/assets/map.js`
- Create: `/home/tetutetu/projects/trip-road/public/assets/geo.js`

- [ ] **Step 1: `map.js` を Write ツールで作成**

```javascript
/**
 * Leaflet 初期化、現在地マーカー、軌跡ポリラインの管理。
 * Leaflet は index.html で CDN 読込の global `L` を使う。
 */
import { TILE_URL } from './config.js';

let map = null;
let marker = null;
let trackLine = null;

export function initMap(containerId) {
  map = L.map(containerId, {
    center: [35.5, 138],
    zoom: 5,
    zoomControl: false,
    attributionControl: false,
  });
  L.tileLayer(TILE_URL, { maxZoom: 18, tileSize: 256 }).addTo(map);

  // 現在地マーカー（SVG divIcon）
  const iconHtml = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <circle cx="9" cy="9" r="7" stroke="#9fe1cb" stroke-width="1.2" fill="none"/>
    <circle cx="9" cy="9" r="2.5" fill="#9fe1cb"/>
  </svg>`;
  const icon = L.divIcon({ html: iconHtml, className: 'current-location-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
  marker = L.marker([35.5, 138], { icon });
  // 初期位置では add しない（GPS 取得後に add）

  trackLine = L.polyline([], {
    color: '#5dcaa5',
    weight: 3,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(map);

  return map;
}

/**
 * 現在地を更新（追従 ON 固定）。
 */
export function updateCurrentLocation(lat, lon, isFirst = false) {
  if (!map || !marker) return;
  marker.setLatLng([lat, lon]);
  if (!marker._map) marker.addTo(map);
  const zoom = isFirst ? 14 : map.getZoom();
  map.setView([lat, lon], zoom, { animate: true, duration: 0.3 });
}

export function addTrackPoint(lat, lon) {
  if (!trackLine) return;
  trackLine.addLatLng([lat, lon]);
}

export function setTrack(points) {
  if (!trackLine) return;
  trackLine.setLatLngs(points.map(p => [p.lat, p.lon]));
}
```

- [ ] **Step 2: `geo.js` を Write ツールで作成**

```javascript
/**
 * navigator.geolocation.watchPosition のラッパー。
 */

const OPTIONS = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

/**
 * @param {(pos: {lat: number, lon: number, speed: number|null}) => void} onSuccess
 * @param {(err: GeolocationPositionError) => void} onError
 * @returns {number} watchId
 */
export function startWatching(onSuccess, onError) {
  if (!('geolocation' in navigator)) {
    onError({ code: 2, message: 'Geolocation API not available' });
    return -1;
  }
  return navigator.geolocation.watchPosition(
    (position) => {
      onSuccess({
        lat: position.coords.latitude,
        lon: position.coords.longitude,
        speed: position.coords.speed,
      });
    },
    onError,
    OPTIONS,
  );
}

export function stopWatching(watchId) {
  if (watchId >= 0) navigator.geolocation.clearWatch(watchId);
}
```

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/map.js public/assets/geo.js
git commit -m "$(cat <<'EOF'
feat(frontend): map.js と geo.js を追加

- map.js: Leaflet 初期化（地理院タイル）、SVG divIcon 現在地マーカー、
  軌跡ポリライン（ティール #5dcaa5、weight 3）。追従モード固定で
  updateCurrentLocation は常に setView。
- geo.js: navigator.geolocation.watchPosition ラッパー。
  enableHighAccuracy: true / timeout: 10000 / maximumAge: 0。
  onSuccess は {lat, lon, speed} を渡す統一インターフェース。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 11: `ui.js`（DOM 更新）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/assets/ui.js`

- [ ] **Step 1: Write ツールで `ui.js` 作成**

```javascript
/**
 * DOM 要素への書き込みを一元化するユーティリティ。
 */

const $ = (id) => document.getElementById(id);

export function showPasswordScreen() {
  $('password-screen').classList.remove('hidden');
  $('main-screen').classList.add('hidden');
}
export function showMainScreen() {
  $('password-screen').classList.add('hidden');
  $('main-screen').classList.remove('hidden');
}
export function showPasswordError(msg) {
  const el = $('password-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
export function clearPasswordError() {
  $('password-error').classList.add('hidden');
}

export function setMuniName(name) {
  $('muni-name').textContent = name;
  $('muni-name-big').textContent = name;
}
export function setMuniRomaji(romaji) {
  $('muni-romaji').textContent = romaji;
}
export function setSpeed(kmh) {
  $('speed').textContent = kmh === null ? '--' : String(kmh);
}
export function setVisitedCount(n) {
  $('visited-count').textContent = String(n);
}

export function setDescription(text) {
  const body = $('description');
  const skel = $('description-skeleton');
  skel.classList.add('hidden');
  body.classList.remove('muted');
  body.textContent = text;
  body.style.opacity = 0;
  requestAnimationFrame(() => {
    body.style.transition = 'opacity 200ms';
    body.style.opacity = 1;
  });
}
export function setDescriptionLoading() {
  $('description').textContent = '';
  $('description-skeleton').classList.remove('hidden');
}
export function setDescriptionFailed() {
  $('description-skeleton').classList.add('hidden');
  const body = $('description');
  body.classList.add('muted');
  body.textContent = '解説を取得できませんでした';
}
export function clearDescription() {
  $('description').textContent = '';
  $('description-skeleton').classList.add('hidden');
}

export function setGpsActive(active) {
  const dot = $('gps-dot');
  const status = $('gps-status');
  const text = $('gps-text');
  if (active) {
    dot.classList.remove('dot-inactive');
    dot.classList.add('dot-active');
    status.classList.remove('inactive');
    text.textContent = 'GPS 受信中';
  } else {
    dot.classList.add('dot-inactive');
    dot.classList.remove('dot-active');
    status.classList.add('inactive');
    text.textContent = 'GPS 測位中';
  }
}

export function setPermissionDenied() {
  setMuniName('位置情報の許可が必要です');
  const body = $('description');
  body.classList.add('muted');
  body.textContent = 'iPhone の設定 → trip-road → 位置情報 を「App の使用中のみ」に設定してください';
  $('description-skeleton').classList.add('hidden');
}
```

- [ ] **Step 2: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/ui.js
git commit -m "$(cat <<'EOF'
feat(frontend): ui.js を追加（DOM 更新の一元化）

パスワード/メイン画面切替、市町村名・速度・制覇数更新、
土地のたよりの loading/success/failed 状態、GPS インジケータの
active/inactive、GPS 権限拒否時の案内を全て単一モジュールに集約。

app.js からの import で他モジュールは DOM を触らない設計（依存の逆転）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 12: `app.js`（メインオーケストレータ）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/public/assets/app.js`

- [ ] **Step 1: Write ツールで `app.js` 作成**

```javascript
/**
 * trip-road メインオーケストレータ。
 * DOMContentLoaded で初期化、状態遷移を管理。
 */

import { getSeason } from './season.js';
import {
  loadState,
  savePassword,
  getPassword,
  clearPassword,
  markVisited,
  getCachedDescription,
  setCachedDescription,
  appendTrack,
  getVisitedCount,
} from './storage.js';
import { fetchDescription } from './api.js';
import { identifyMunicipality, prefetchNeighbors } from './muni.js';
import { initMap, updateCurrentLocation, addTrackPoint, setTrack } from './map.js';
import { startWatching } from './geo.js';
import {
  showPasswordScreen, showMainScreen,
  showPasswordError, clearPasswordError,
  setMuniName, setMuniRomaji, setSpeed, setVisitedCount,
  setDescription, setDescriptionLoading, setDescriptionFailed, clearDescription,
  setGpsActive, setPermissionDenied,
} from './ui.js';

let currentMuniCd = null;
let isFirstFix = true;

// === 初期化 ===
window.addEventListener('DOMContentLoaded', () => {
  const state = loadState();
  currentMuniCd = state.currentMuniCd;

  if (state.password) {
    enterMainApp(state.password);
  } else {
    setupPasswordScreen();
  }
});

// === パスワード入力フロー ===
function setupPasswordScreen() {
  showPasswordScreen();
  const input = document.getElementById('password-input');
  const submit = document.getElementById('password-submit');

  input.addEventListener('input', () => {
    submit.disabled = input.value.trim().length === 0;
    clearPasswordError();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !submit.disabled) submit.click();
  });
  submit.addEventListener('click', () => {
    const pw = input.value.trim();
    savePassword(pw);
    enterMainApp(pw);
  });
}

// === メイン画面初期化 ===
async function enterMainApp(password) {
  showMainScreen();
  initMap('map');
  setVisitedCount(getVisitedCount());

  // 既存軌跡を復元
  const state = loadState();
  if (state.track.length > 0) setTrack(state.track);

  // 既存の現在地情報を表示（キャッシュ済解説があれば）
  if (currentMuniCd && state.visited[currentMuniCd]) {
    const v = state.visited[currentMuniCd];
    setMuniName(v.name);
    const cached = getCachedDescription(currentMuniCd, getSeason());
    if (cached) setDescription(cached);
  }

  // GPS 監視開始
  startWatching(
    (pos) => handlePosition(pos, password),
    (err) => handleGpsError(err),
  );
}

// === GPS 位置更新時の処理 ===
async function handlePosition({ lat, lon, speed }, password) {
  setGpsActive(true);

  // 速度表示
  setSpeed(speed !== null && speed >= 0 ? Math.round(speed * 3.6) : null);

  // 地図更新 + 軌跡追加
  updateCurrentLocation(lat, lon, isFirstFix);
  isFirstFix = false;
  addTrackPoint(lat, lon);
  appendTrack(lat, lon);

  // 市町村判定
  const muni = await identifyMunicipality(lat, lon, currentMuniCd);
  if (!muni) return;

  if (muni.code !== currentMuniCd) {
    // 切替
    currentMuniCd = muni.code;
    markVisited(muni.code, muni.name, muni.prefecture);
    setVisitedCount(getVisitedCount());
    setMuniName(muni.name);
    setMuniRomaji(romajiOf(muni));

    // プリフェッチ
    prefetchNeighbors(muni.code);

    // LLM 呼出 or キャッシュ
    const season = getSeason();
    const cached = getCachedDescription(muni.code, season);
    if (cached) {
      setDescription(cached);
    } else {
      setDescriptionLoading();
      const result = await fetchDescription(password, {
        prefecture: muni.prefecture,
        municipality: muni.name,
        season,
      });
      if (result.ok) {
        setCachedDescription(muni.code, season, result.description);
        setDescription(result.description);
      } else if (result.status === 401) {
        // パスワード誤り
        clearPassword();
        clearDescription();
        setupPasswordScreen();
        showPasswordError('パスワードが違います');
      } else {
        setDescriptionFailed();
      }
    }
  }
}

// === GPS エラー処理 ===
function handleGpsError(err) {
  if (err.code === 1) {
    setPermissionDenied();
    setGpsActive(false);
  }
  // code 2/3 は次の成功を待つ（何もしない）
}

// === 英字ローマ字（簡易版、ヘボン式でなく固有名詞はそのまま） ===
function romajiOf(muni) {
  // PoC: 都道府県 + 市町村のアルファベット入力がない場合は空文字
  // Phase 4 で辞書 or 外部ライブラリ検討
  return '';
}
```

- [ ] **Step 2: 全テスト実行（壊れていないことを確認）**

```bash
cd /home/tetutetu/projects/trip-road
npx vitest run
```

Expected: `10 passed`（前回から変わらず、app.js は vitest では評価しないため）

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/app.js
git commit -m "$(cat <<'EOF'
feat(frontend): app.js メインオーケストレータを追加

全モジュール（season/storage/api/muni/map/geo/ui）を統合する
エントリポイント。

フロー:
1. DOMContentLoaded: localStorage 確認 → パスワード有無で画面分岐
2. enterMainApp: 地図初期化 + 軌跡復元 + GPS 監視開始
3. handlePosition（watchPosition 毎回）:
   - 速度表示
   - 地図追従（初回は zoom 14 アニメーション）
   - 軌跡 localStorage 追記
   - 市町村判定（現在→隣接→GSI）
   - 切替検知時: markVisited、制覇カウント+1、LLM 呼出 or
     キャッシュ使用、UI 更新
4. 401 エラー時: localStorage クリア → パスワード画面戻し
5. GPS 権限拒否: 案内文表示

romaji 機能は PoC では空文字（Phase 2 以降改善候補）。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 13: ローカル E2E 動作確認（Python HTTP サーバ）

**Files:** なし（手動確認）

- [ ] **Step 1: HTTP サーバ起動（別ターミナル）**

```bash
cd /home/tetutetu/projects/trip-road
python3 -m http.server 8000 --directory public
```

Expected: `Serving HTTP on 0.0.0.0 port 8000`

- [ ] **Step 2: ブラウザで確認**

ブラウザで http://localhost:8000 を開く。以下を確認:

- パスワード入力画面が表示される（ダークテーマ、ティールアクセント）
- 無効な値でボタンが disabled
- 値を入力すると enabled
- パスワード（`~/.secrets/trip-road.env` の APP_PASSWORD と同じ）を入れて はじめる タップ
- メイン画面遷移、地図が日本全体表示、現在地取得中...表示
- Chrome DevTools の Sensors タブで位置を 35.5681, 139.3712 等に設定
- 地図が追従、市町村名が更新、土地のたよりローディング → 表示

- [ ] **Step 3: HTTP サーバ停止**

`Ctrl+C`。

- [ ] **Step 4: CORS ログが出ていないことを Chrome DevTools Console で確認**

Expected: `CORS policy` 関連の赤エラーがない。

（ローカル `http://localhost:8000` は Workers の ALLOWED_ORIGIN `https://trip-road.tetutetu214.com` に一致しないため、本番 API へのリクエストは CORS でブロックされます。これは正常。独自ドメイン経由での実動作は Phase 4 で確認）

- [ ] **Step 5: ローカル 動作確認結果を knowledge.md にメモ**

Edit ツールで `/home/tetutetu/projects/trip-road/docs/knowledge.md` の 4.5 GPS・判定系セクションにローカル動作確認結果を追記（UI表示・DOM構造・ローディング挙動等）。

---

### Task 14: Cloudflare Pages デプロイ + 独自ドメイン紐付け

**Files:** なし（CF Dashboard 操作）

- [ ] **Step 1: Pages プロジェクト作成 + デプロイ**

```bash
cd /home/tetutetu/projects/trip-road
wrangler pages project create trip-road --production-branch main
wrangler pages deploy public --project-name=trip-road --branch=main --commit-dirty=true
```

Expected: `Uploaded trip-road (...)` + URL（例: `https://trip-road.pages.dev`）。

- [ ] **Step 2: Cloudflare Dashboard で独自ドメイン紐付け**

ブラウザで https://dash.cloudflare.com/ を開く:

1. Workers & Pages → `trip-road` をクリック
2. Custom domains → Set up a custom domain
3. `trip-road.tetutetu214.com` を入力 → Continue
4. 自動 DNS 設定 → Activate domain
5. ステータスが Active になるまで待機（1 分程度）

- [ ] **Step 3: 独自ドメインでの動作確認**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://trip-road.tetutetu214.com/
```

Expected: `HTTP 200`

- [ ] **Step 4: Workers の ALLOWED_ORIGIN が正しいことを再確認**

```bash
cd /home/tetutetu/projects/trip-road/workers
wrangler secret list
```

Expected: `ALLOWED_ORIGIN` が登録されていることが見える（値はマスク）。値自体は Part 2 で `https://trip-road.tetutetu214.com` に設定済なので問題なし。

---

### Task 15: iPhone Safari 実機テスト

**Files:** なし（実機操作）

- [ ] **Step 1: iPhone Safari で https://trip-road.tetutetu214.com を開く**

- [ ] **Step 2: 画面の初期確認**

- パスワード画面が表示される（ダークテーマ）
- フォント・余白・色がモックアップに近い
- 下部のホームインジケーターと衝突していない

- [ ] **Step 3: パスワード入力 → メイン画面遷移**

`~/.secrets/trip-road.env` の `APP_PASSWORD` を入力。

Expected: パスワード画面が消え、地図が表示される。

- [ ] **Step 4: GPS 許可ダイアログが表示されることを確認**

iOS Safari が「位置情報の使用を許可しますか？」と聞く。「許可」を選択。

- [ ] **Step 5: 現在地マーカーが表示される**

地図上にティール色の円形マーカーが表示され、現在地を中心とする zoom 14 のビューになる。

- [ ] **Step 6: 市町村名と土地のたよりが表示される**

- 上部チップに「いま」+ 市町村名
- 下部カードに「土地のたより」ラベル + Anthropic 生成文
- 速度表示（stationary なら --）
- 制覇カウント 1 以上

- [ ] **Step 7: 「ホーム画面に追加」**

Safari のメニュー → 共有 → ホーム画面に追加 → 名前「trip-road」を確認 → 追加

- [ ] **Step 8: ホーム画面アイコンから起動**

- スタンドアロンモードで起動（Safari UI が消え全画面）
- パスワードは localStorage から自動読込、直接メイン画面へ

- [ ] **Step 9: 近所散歩で実走テスト**

10-30 分ほど近所を歩く、または電車で短距離移動する。以下を確認:

- 移動に合わせて地図が追従
- 速度が更新
- 市町村を越えたとき解説が更新
- 軌跡がティール色のポリラインで描画される

- [ ] **Step 10: 発見した課題を todo.md に追記**

Edit ツールで `/home/tetutetu/projects/trip-road/docs/todo.md` の「将来的な改善」セクションに、実機テストで気づいた課題（UI微調整、レスポンス遅延、プロンプト調整要望など）を追記。

---

### Task 16: docs 更新 + 最終コミット + PR

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/docs/todo.md`
- Modify: `/home/tetutetu/projects/trip-road/docs/knowledge.md`

- [ ] **Step 1: todo.md の Phase 3-4 を完了マーク**

Edit ツールで Phase 3 と Phase 4 の全項目を `- [x]` に変更。

- [ ] **Step 2: knowledge.md の 4.5 GPS・判定系セクションを具体化**

Edit ツールで `### 4.5 GPS・判定系` 部分を具体化:
- watchPosition の iOS Safari 実挙動
- Leaflet + 地理院タイルの描画性能
- Turf.js booleanPointInPolygon のパフォーマンス
- iPhone PWA スタンドアロンモードの起動時間
- 実機テストで発見した課題

- [ ] **Step 3: コミット + push**

```bash
cd /home/tetutetu/projects/trip-road
git add docs/todo.md docs/knowledge.md
git commit -m "$(cat <<'EOF'
docs: Phase 3-4 完了、フロント実機テスト知見を追記

- docs/todo.md: Phase 3-4 全項目を完了マーク
- docs/knowledge.md: 4.5 GPS・判定系セクションを具体化
  - iPhone Safari 実機での watchPosition 挙動
  - Leaflet + 地理院タイルのパフォーマンス
  - PWA スタンドアロンモード起動時間
  - 発見した課題と対応

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

- [ ] **Step 4: PR 作成（MCP 経由）**

Claude が `mcp__github__create_pull_request` で作成:
- owner: `tetutetu214`
- repo: `trip-road`
- base: `main`
- head: `feature/phase3-4-frontend`
- title: `Phase 3-4 完了: フロントエンド実装 + iPhone 実機動作確認`
- body: 以下を含める
  - 実装サマリ（HTML/CSS/JS モジュール一覧）
  - vitest 15 テスト pass
  - Cloudflare Pages デプロイ URL (`https://trip-road.tetutetu214.com`)
  - iPhone 実機テスト結果
  - モックアップとの差分（あれば）

- [ ] **Step 5: レビュー → マージ**

ユーザが PR 内容を確認 → OK ならマージ（UI または MCP）。

- [ ] **Step 6: ローカル main 同期 + feature ブランチ削除**

```bash
git switch main
git pull origin main
git branch -d feature/phase3-4-frontend
```

---

## 完了条件（Plan C 全体）

以下がすべて満たされれば Plan C 完了:

1. `public/` 配下に 14 ファイル（html + manifest + icon + css + 12 js）が揃う
2. `npx vitest run` で 10 テスト pass（season 4 + cache 1 + storage 5）
3. `https://trip-road.tetutetu214.com` でフロントが動作
4. iPhone Safari で「ホーム画面に追加」→ スタンドアロンモード起動
5. 実走で市町村判定・LLM 生成・軌跡描画・制覇カウントが動く
6. PR が main にマージされる

## コスト見込み（Plan C での追加）

- Anthropic: 実機テスト分 10-20 市町村 = $0.03-0.10
- Cloudflare Pages: 無料枠内
- 既存ドメイン `tetutetu214.com` 維持費は Plan C とは無関係

## 全プロジェクト完了後の状態

Plan A + B + C 完了時点で trip-road は以下の URL で公開:

- フロント: `https://trip-road.tetutetu214.com`
- API: `https://trip-road-api.tetutetu214.com`
- データ: `https://trip-road-data.tetutetu214.com`

iPhone ホーム画面から起動、GPS 追従で市町村を判定、Claude Haiku が土地のたよりを生成、軌跡と制覇数を記録する完全動作の PoC が完成する。
