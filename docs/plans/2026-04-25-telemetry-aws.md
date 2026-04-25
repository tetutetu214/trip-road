# trip-road Telemetry & AWS S3 Sink Implementation Plan (Plan D)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** trip-road のフロントから「生成された土地のたよりに対するユーザの暗黙シグナル（滞在時間・再訪・操作）」を localStorage に蓄積し、定期的に Workers 経由で AWS S3 に永続化、Athena で SQL 分析できる状態を構築する。**agentic 改善ループ（Critic / Few-shot / プロンプト調整）の土台になる**。

**Architecture:** 3 ステージ構成。Stage 1 はフロントだけで完結（AWS 不要）、Stage 2 で Workers → S3 の SigV4 PUT を追加、Stage 3 で Athena の DDL とクエリ集をドキュメント化。trace_id をフロント生成 → Workers レスポンスヘッダで照合 → S3 で永続、という単一 ID で生成と反応を紐付ける設計。Cloudflare 2 層構成は維持し、AWS は分析専用バックエンドとして外出し。

**Tech Stack:** Vanilla JS (ES Modules) / vitest 1.6 / Playwright 1.59 / Cloudflare Workers + aws4fetch / AWS S3 / AWS Athena / SigV4

---

## ブランチ戦略

Plan D の全タスクは単一ブランチ `feature/telemetry-aws` で進める。実装は Stage ごとに順次でも、まとめてでもよい。最終タスクで main への PR を作成。

## E〜G 論点の確定事項（再掲、設計の前提）

| 論点 | 決定 |
|---|---|
| **E プライバシー** | localStorage に閉じる、AWS S3 は teutetu214 のアカウントのみアクセス |
| **F 評価頻度** | 初期 100% 記録、運用で 10〜20% に絞る（telemetry.js 内で sample 制御） |
| **G UX 負担** | 暗黙シグナル中心。👍👎 ボタンは将来 Phase で検討 |

---

## ステージ概要

| Stage | スコープ | 完了時の状態 | 必要時間 |
|---|---|---|---|
| **Stage 1** | フロント localStorage 蓄積 + 手動エクスポート | データが localStorage に溜まる、JSON ダウンロード可 | 4〜6h |
| **Stage 2** | Workers `/api/telemetry` + S3 SigV4 PUT | フロントから自動で S3 に永続 | 3〜5h |
| **Stage 3** | Athena テーブル + サンプルクエリのドキュメント化 | SQL でユーザ反応分析可能 | 1〜2h |

実装順序は Stage 1 → 2 → 3。各 Stage 完了で独立して動作するので、途中で止めて運用しても OK。

---

## File Structure

**新規作成**:
- `public/assets/telemetry.js` — テレメトリ entry 組立 + trace_id 生成（pure）
- `test/telemetry.test.js` — vitest
- `workers/src/aws.js` — SigV4 署名 + S3 PUT helper
- `workers/test/aws.test.js` — vitest
- `tests/e2e/telemetry.spec.js` — Playwright
- `docs/athena/create_table.sql` — Athena テーブル DDL
- `docs/athena/sample_queries.sql` — 分析クエリ集

**修正**:
- `public/assets/storage.js` — appendTelemetry / getTelemetryBatch / clearTelemetryBatch / getTelemetryCount 追加
- `public/assets/api.js` — sendTelemetryBatch 関数追加
- `public/assets/app.js` — テレメトリ呼出 site 4 箇所追加（生成完了・画面離脱・再訪検知・パスワード変更）
- `workers/package.json` — aws4fetch 依存追加
- `workers/src/index.js` — `/api/telemetry` エンドポイント追加
- `test/storage.test.js` — テレメトリ関連テスト追加
- `docs/todo.md` / `docs/knowledge.md`

---

# Stage 1: localStorage 蓄積 + エクスポート

## Task 1: feature ブランチ + `telemetry.js` TDD（trace_id 生成 + entry 組立）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/test/telemetry.test.js`
- Create: `/home/tetutetu/projects/trip-road/public/assets/telemetry.js`

### Step 1: feature ブランチ作成

```bash
git -C /home/tetutetu/projects/trip-road switch -c feature/telemetry-aws
```

Expected: `Switched to a new branch 'feature/telemetry-aws'`

### Step 2: Write ツールで `test/telemetry.test.js` を作成（Red）

```javascript
import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  buildTelemetryEntry,
  shouldSample,
} from '../public/assets/telemetry.js';

describe('generateTraceId', () => {
  it('UUID v4 形式の文字列を返す', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('複数回呼んでも一意', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateTraceId());
    expect(ids.size).toBe(100);
  });
});

describe('buildTelemetryEntry', () => {
  it('必須フィールドが揃った entry を返す', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '11210',
      season: 'spring',
      description: '埼玉県久喜市…',
      ts_generated: 1745000000000,
    });
    expect(entry.trace_id).toBe('test-id');
    expect(entry.muni_code).toBe('11210');
    expect(entry.season).toBe('spring');
    expect(entry.description).toBe('埼玉県久喜市…');
    expect(entry.ts_generated).toBe(1745000000000);
    expect(entry.ts_displayed).toBeNull();
    expect(entry.ts_left).toBeNull();
    expect(entry.dwell_ms).toBeNull();
    expect(entry.re_visited_count).toBe(0);
    expect(entry.user_rating).toBeNull();
  });
});

describe('shouldSample', () => {
  it('sample_rate=1.0 で常に true', () => {
    for (let i = 0; i < 10; i++) expect(shouldSample(1.0)).toBe(true);
  });
  it('sample_rate=0.0 で常に false', () => {
    for (let i = 0; i < 10; i++) expect(shouldSample(0.0)).toBe(false);
  });
  it('sample_rate=0.5 で確率的に true/false が混じる', () => {
    let trues = 0;
    for (let i = 0; i < 1000; i++) if (shouldSample(0.5)) trues++;
    // 統計的に 350-650 の範囲（3σ 程度の許容）
    expect(trues).toBeGreaterThan(350);
    expect(trues).toBeLessThan(650);
  });
});
```

### Step 3: Red 確認

```bash
cd /home/tetutetu/projects/trip-road && npx vitest run test/telemetry.test.js
```

Expected: Import 失敗で 5 テスト fail。

### Step 4: Write ツールで `public/assets/telemetry.js` を作成（Green）

```javascript
/**
 * テレメトリ entry の生成・trace_id 発行・サンプリング判定。
 * 純粋関数のみ。副作用（localStorage 書込）は storage.js が担当。
 */

/**
 * UUID v4 を生成する。crypto.randomUUID() が使える環境（モダンブラウザ・Node 19+）
 * を前提とする。fallback は Math.random ベースで衝突確率を妥協（PoC 用途）。
 */
export function generateTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for very old environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * テレメトリ entry を組み立てる（生成直後）。
 * その後 storage.js に appendTelemetry で追加し、表示・離脱時に updateTelemetry で更新。
 *
 * @param {{trace_id: string, muni_code: string, season: string, description: string, ts_generated: number}} args
 * @returns {object}
 */
export function buildTelemetryEntry(args) {
  return {
    trace_id: args.trace_id,
    muni_code: args.muni_code,
    season: args.season,
    description: args.description,
    ts_generated: args.ts_generated,

    // Critic スコア（生成と同期で評価する場合、Stage 2 以降）
    critic_accuracy: null,
    critic_meaningfulness: null,
    critic_density: null,

    // 暗黙シグナル
    ts_displayed: null,
    ts_left: null,
    dwell_ms: null,
    re_visited_count: 0,

    // 明示シグナル（任意）
    user_rating: null,    // null | 'up' | 'down'
    user_comment: null,
  };
}

/**
 * サンプリング判定。Math.random で確率的に true/false。
 *
 * @param {number} sampleRate - 0.0 〜 1.0
 * @returns {boolean}
 */
export function shouldSample(sampleRate) {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0.0) return false;
  return Math.random() < sampleRate;
}
```

### Step 5: Green 確認

```bash
npx vitest run test/telemetry.test.js
```

Expected: `5 passed`

### Step 6: コミット

```bash
git -C /home/tetutetu/projects/trip-road add public/assets/telemetry.js test/telemetry.test.js
git -C /home/tetutetu/projects/trip-road commit -m "$(cat <<'EOF'
feat(telemetry): trace_id 生成・entry 組立・サンプリング判定を TDD で追加

Stage 1: テレメトリ蓄積パイプラインの最上流の純粋関数群。
- generateTraceId: UUID v4 生成（crypto.randomUUID + fallback）
- buildTelemetryEntry: 全フィールド null 初期化の entry オブジェクト
- shouldSample: Math.random ベースの確率サンプリング

副作用なし、5 vitest テストでカバー。後続 Task で storage / app に組込。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git -C /home/tetutetu/projects/trip-road push -u origin feature/telemetry-aws
```

---

## Task 2: `storage.js` 拡張（テレメトリ CRUD）+ TDD

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/public/assets/storage.js`
- Modify: `/home/tetutetu/projects/trip-road/test/storage.test.js`

### Step 1: 既存 `test/storage.test.js` の末尾にテストを追加

Edit ツールで追加するセクション:

```javascript
// ===== Telemetry テスト追加 =====
describe('telemetry helpers', () => {
  beforeEach(() => {
    // 既存の beforeEach の localStorage モックは活きる
  });

  it('appendTelemetry / getTelemetryCount', () => {
    const { appendTelemetry, getTelemetryCount } = require('../public/assets/storage.js');
    expect(getTelemetryCount()).toBe(0);
    appendTelemetry({ trace_id: 'a', muni_code: '11210' });
    appendTelemetry({ trace_id: 'b', muni_code: '11211' });
    expect(getTelemetryCount()).toBe(2);
  });

  it('updateTelemetry で trace_id 指定の entry を部分更新', () => {
    const { appendTelemetry, updateTelemetry, getTelemetryBatch } = require('../public/assets/storage.js');
    appendTelemetry({ trace_id: 'a', dwell_ms: null });
    updateTelemetry('a', { dwell_ms: 30000, ts_left: 1745000099000 });
    const batch = getTelemetryBatch(10);
    expect(batch[0].dwell_ms).toBe(30000);
    expect(batch[0].ts_left).toBe(1745000099000);
  });

  it('getTelemetryBatch で max N 件取得', () => {
    const { appendTelemetry, getTelemetryBatch } = require('../public/assets/storage.js');
    for (let i = 0; i < 5; i++) appendTelemetry({ trace_id: `t${i}` });
    const batch = getTelemetryBatch(3);
    expect(batch).toHaveLength(3);
    expect(batch[0].trace_id).toBe('t0');
  });

  it('clearTelemetryBatch で trace_id 配列の entry を削除', () => {
    const { appendTelemetry, clearTelemetryBatch, getTelemetryCount } = require('../public/assets/storage.js');
    appendTelemetry({ trace_id: 'a' });
    appendTelemetry({ trace_id: 'b' });
    appendTelemetry({ trace_id: 'c' });
    clearTelemetryBatch(['a', 'c']);
    expect(getTelemetryCount()).toBe(1);
  });

  it('exportTelemetryAsJson で全 entry を JSON 文字列で取得', () => {
    const { appendTelemetry, exportTelemetryAsJson } = require('../public/assets/storage.js');
    appendTelemetry({ trace_id: 'a', muni_code: '11210' });
    const json = exportTelemetryAsJson();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trace_id).toBe('a');
  });
});
```

注意: 既存テストは `import` 構文だが、describe 内で `require` を使うのは vitest でも有効（`type: "module"` でも node の require が動く）。ESM 統一したい場合は top レベルに import を移動。

### Step 2: Red 確認

```bash
cd /home/tetutetu/projects/trip-road && npx vitest run test/storage.test.js
```

Expected: 5 新規テストが fail（telemetry helpers が未実装）。既存 5 テストは pass のはず。

### Step 3: Edit ツールで `public/assets/storage.js` を拡張

末尾に追加（既存 `appendTrack` の後）:

```javascript
// === Telemetry ===
export function appendTelemetry(entry) {
  const state = loadState();
  state.telemetry ??= [];
  state.telemetry.push(entry);
  saveState(state);
}

export function updateTelemetry(traceId, partial) {
  const state = loadState();
  state.telemetry ??= [];
  const idx = state.telemetry.findIndex(e => e.trace_id === traceId);
  if (idx >= 0) {
    state.telemetry[idx] = { ...state.telemetry[idx], ...partial };
    saveState(state);
  }
}

export function getTelemetryBatch(maxN) {
  const t = loadState().telemetry ?? [];
  return t.slice(0, maxN);
}

export function getTelemetryCount() {
  return (loadState().telemetry ?? []).length;
}

export function clearTelemetryBatch(traceIds) {
  const state = loadState();
  state.telemetry ??= [];
  const toRemove = new Set(traceIds);
  state.telemetry = state.telemetry.filter(e => !toRemove.has(e.trace_id));
  saveState(state);
}

export function exportTelemetryAsJson() {
  const t = loadState().telemetry ?? [];
  return JSON.stringify(t, null, 2);
}
```

### Step 4: Green 確認

```bash
npx vitest run test/storage.test.js
```

Expected: `10 passed`（既存 5 + 新規 5）

### Step 5: 全テスト確認

```bash
npx vitest run
```

Expected: `15 passed`（telemetry 5 + storage 10）

### Step 6: コミット

```bash
git -C /home/tetutetu/projects/trip-road add public/assets/storage.js test/storage.test.js
git -C /home/tetutetu/projects/trip-road commit -m "$(cat <<'EOF'
feat(storage): テレメトリ CRUD を追加

localStorage に telemetry 配列を保持し、append / update / batch 取得 /
バッチ削除 / JSON エクスポート の 5 関数を提供。

- appendTelemetry: entry 追加
- updateTelemetry(traceId, partial): trace_id で部分更新
- getTelemetryBatch(maxN): 先頭 N 件
- clearTelemetryBatch(traceIds): trace_id 配列で削除
- exportTelemetryAsJson: 全件を JSON 文字列で

新規 5 テスト + 既存 5 テスト 全 10 passed。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git -C /home/tetutetu/projects/trip-road push
```

---

## Task 3: `app.js` にテレメトリ呼出 site を 4 箇所追加

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/public/assets/app.js`

### Step 1: import 追加

`app.js` 冒頭の import 群に以下を追加:

```javascript
import { generateTraceId, buildTelemetryEntry, shouldSample } from './telemetry.js';
import { appendTelemetry, updateTelemetry } from './storage.js';
```

### Step 2: モジュールスコープ定数追加

```javascript
const TELEMETRY_SAMPLE_RATE = 1.0;  // 初期 100%、運用で 0.1〜0.2 に下げる
let currentTraceId = null;
let currentDisplayStartMs = null;
```

### Step 3: `handlePosition` 内の市町村切替ブロックを修正

既存の「LLM 呼出 or キャッシュ」ブロックを以下に置換:

```javascript
    // LLM 呼出 or キャッシュ
    const season = getSeason();
    const cached = getCachedDescription(muni.code, season);

    // === テレメトリ: 直前 entry の離脱情報を確定 ===
    if (currentTraceId && currentDisplayStartMs) {
      const ts_left = Date.now();
      updateTelemetry(currentTraceId, {
        ts_left,
        dwell_ms: ts_left - currentDisplayStartMs,
      });
    }

    // === 新 trace_id 発行 ===
    const sampled = shouldSample(TELEMETRY_SAMPLE_RATE);
    currentTraceId = sampled ? generateTraceId() : null;
    currentDisplayStartMs = null;

    if (cached) {
      setDescription(cached);
      // === テレメトリ: キャッシュヒットも記録 ===
      if (currentTraceId) {
        appendTelemetry(buildTelemetryEntry({
          trace_id: currentTraceId,
          muni_code: muni.code,
          season,
          description: cached,
          ts_generated: Date.now(),
        }));
        currentDisplayStartMs = Date.now();
        updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
      }
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
        // === テレメトリ: 新規生成記録 ===
        if (currentTraceId) {
          appendTelemetry(buildTelemetryEntry({
            trace_id: currentTraceId,
            muni_code: muni.code,
            season,
            description: result.description,
            ts_generated: Date.now(),
          }));
          currentDisplayStartMs = Date.now();
          updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
        }
      } else if (result.status === 401) {
        clearPassword();
        clearDescription();
        setupPasswordScreen();
        showPasswordError('パスワードが違います');
      } else {
        setDescriptionFailed();
      }
    }
```

### Step 4: 画面離脱時の保存（visibilitychange / beforeunload）

`enterMainApp` 関数の末尾に追加:

```javascript
  // === テレメトリ: 画面離脱時に dwell_ms を確定 ===
  const finalizeCurrent = () => {
    if (currentTraceId && currentDisplayStartMs) {
      const ts_left = Date.now();
      updateTelemetry(currentTraceId, {
        ts_left,
        dwell_ms: ts_left - currentDisplayStartMs,
      });
    }
  };
  window.addEventListener('beforeunload', finalizeCurrent);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finalizeCurrent();
  });
```

### Step 5: 構文チェック

```bash
node --check /home/tetutetu/projects/trip-road/public/assets/app.js && echo "OK"
```

Expected: `OK`

### Step 6: vitest 確認（壊れていないこと）

```bash
cd /home/tetutetu/projects/trip-road && npx vitest run
```

Expected: `15 passed`（変動なし、app.js は対象外）

### Step 7: コミット

```bash
git -C /home/tetutetu/projects/trip-road add public/assets/app.js
git -C /home/tetutetu/projects/trip-road commit -m "$(cat <<'EOF'
feat(app): テレメトリ呼出 site を 4 箇所追加

市町村切替、キャッシュヒット、新規生成完了、画面離脱の 4 タイミングで
trace_id と dwell_ms を記録する。

- 切替前に直前 entry の ts_left + dwell_ms を確定
- 新 trace_id を発行（sample_rate=1.0 で全件）
- キャッシュ/新規どちらでも entry 作成 + ts_displayed 記録
- visibilitychange + beforeunload で離脱時保存

Stage 1 完了: localStorage にテレメトリが蓄積される状態。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git -C /home/tetutetu/projects/trip-road push
```

---

## Task 4: 手動エクスポート UI（最小実装）

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/public/index.html`
- Modify: `/home/tetutetu/projects/trip-road/public/assets/app.css`
- Modify: `/home/tetutetu/projects/trip-road/public/assets/ui.js`
- Modify: `/home/tetutetu/projects/trip-road/public/assets/app.js`

### Step 1: `index.html` に小さな「データ書出」リンクを足す（フッター行）

`index.html` の `.footer-row` 内、disclaimer の後に追加:

```html
        <a href="#" id="export-link" class="export-link">📤</a>
```

### Step 2: `app.css` に export-link スタイル追加

```css
.export-link {
  font-size: 14px;
  text-decoration: none;
  color: var(--color-text-hint);
  margin-left: 8px;
  cursor: pointer;
}
.export-link:active { opacity: 0.6; }
```

### Step 3: `ui.js` に export 関数追加

```javascript
export function downloadJson(filename, jsonString) {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

### Step 4: `app.js` の `enterMainApp` に export ボタンの click ハンドラ追加

```javascript
  // === エクスポートボタン ===
  document.getElementById('export-link').addEventListener('click', (e) => {
    e.preventDefault();
    const json = exportTelemetryAsJson();
    const filename = `trip-road-telemetry-${new Date().toISOString().slice(0, 10)}.json`;
    downloadJson(filename, json);
  });
```

`app.js` 冒頭 import に追加:

```javascript
import { exportTelemetryAsJson } from './storage.js';
import { downloadJson } from './ui.js';
```

### Step 5: 動作確認

ブラウザで `https://trip-road.tetutetu214.com` を開き、フッター右に 📤 が出ること、クリックで `trip-road-telemetry-2026-04-25.json` がダウンロードされることを確認。

### Step 6: コミット + デプロイ

```bash
git -C /home/tetutetu/projects/trip-road add public/index.html public/assets/app.css public/assets/ui.js public/assets/app.js
git -C /home/tetutetu/projects/trip-road commit -m "$(cat <<'EOF'
feat(ui): テレメトリ手動エクスポートボタンを追加

下部フッター右に 📤 アイコンを追加。クリックで localStorage の telemetry
配列を JSON ファイル trip-road-telemetry-YYYY-MM-DD.json として
ダウンロードする。

Stage 1 完了。AWS S3 sink 実装前でも、ユーザは手動でデータを取り出して
分析可能。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git -C /home/tetutetu/projects/trip-road push
bash /home/tetutetu/projects/trip-road/deploy_frontend.sh
```

**Stage 1 完了**。これ以降は localStorage にテレメトリが溜まり、いつでも JSON 化可能。

---

# Stage 2: Workers → AWS S3 自動 Sink

## Task 5: AWS S3 + IAM 準備（てつてつの手作業）

**Files:** なし（AWS Console 作業）

### Step 1: AWS Console で S3 バケット作成

ブラウザで https://console.aws.amazon.com/s3/ を開く（リージョン: us-east-1）:

1. **Create bucket**
2. Bucket name: `trip-road-telemetry-tetutetu214`（global unique 必須）
3. Region: `us-east-1` (N. Virginia)
4. Block all public access: **チェック ON のまま**（非公開）
5. Bucket Versioning: 有効
6. Encryption: SSE-S3 (default)
7. Create bucket

### Step 2: IAM ユーザ作成

https://console.aws.amazon.com/iam/ → Users → Create user:

1. User name: `trip-road-telemetry-writer`
2. Access type: **Programmatic access** のみ（Console アクセス不要）
3. Permissions: Attach policy → Create inline policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject"],
      "Resource": "arn:aws:s3:::trip-road-telemetry-tetutetu214/*"
    }
  ]
}
```

4. Policy name: `TripRoadTelemetryWritePolicy`
5. Create user
6. **Access key ID と Secret access key をメモ**（この画面でしか見られない）

### Step 3: `~/.secrets/trip-road.env` に追加

```bash
nano ~/.secrets/trip-road.env
```

末尾に追加:

```
# AWS Telemetry Sink (Plan D)
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_TELEMETRY_BUCKET=trip-road-telemetry-tetutetu214
```

### Step 4: 確認

```bash
source ~/.secrets/trip-road.env && \
  echo "AWS key prefix: ${AWS_ACCESS_KEY_ID:0:6}" && \
  echo "Bucket: $S3_TELEMETRY_BUCKET" && \
  echo "Region: $AWS_REGION"
```

Expected:
```
AWS key prefix: AKIA12
Bucket: trip-road-telemetry-tetutetu214
Region: us-east-1
```

### Step 5: AWS CLI で疎通確認（オプション）

```bash
aws s3 ls s3://trip-road-telemetry-tetutetu214/ --profile default
```

エラー無く（空のリストが返れば）OK。AWS CLI 未設定なら次の Task で wrangler 経由で確認するのでスキップ可。

---

## Task 6: Workers に aws4fetch 追加 + `aws.js` helper

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/workers/package.json`
- Create: `/home/tetutetu/projects/trip-road/workers/src/aws.js`
- Create: `/home/tetutetu/projects/trip-road/workers/test/aws.test.js`

### Step 1: aws4fetch インストール

```bash
cd /home/tetutetu/projects/trip-road/workers
npm install aws4fetch
```

`package.json` の dependencies に `"aws4fetch": "^1.0.20"` が入る。

### Step 2: Write ツールで `workers/src/aws.js` 作成

```javascript
/**
 * AWS S3 PUT ラッパー（SigV4 署名は aws4fetch が担当）。
 */
import { AwsClient } from 'aws4fetch';

/**
 * S3 にオブジェクトを PUT する。
 *
 * @param {object} env - Workers env オブジェクト
 * @param {string} key - S3 キー（パス）
 * @param {string} body - JSON 文字列
 * @returns {Promise<{ok: true} | {ok: false, status: number, detail: string}>}
 */
export async function putToS3(env, key, body) {
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    service: 's3',
    region: env.AWS_REGION,
  });

  const url = `https://${env.S3_TELEMETRY_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
  const res = await aws.fetch(url, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, detail: text.slice(0, 200) };
  }
  return { ok: true };
}

/**
 * 日付ベースのプレフィックス + バッチ ID で S3 キーを生成。
 *
 * @returns {string} 例: "year=2026/month=04/day=25/<uuid>.json"
 */
export function generateS3Key(date = new Date(), batchId = null) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const id = batchId || crypto.randomUUID();
  return `year=${y}/month=${m}/day=${d}/${id}.json`;
}
```

### Step 3: Write ツールで `workers/test/aws.test.js` 作成

```javascript
import { describe, it, expect } from 'vitest';
import { generateS3Key } from '../src/aws.js';

describe('generateS3Key', () => {
  it('日付ベースのパーティションキーを生成', () => {
    const date = new Date('2026-04-25T10:00:00Z');
    const key = generateS3Key(date, 'test-batch-id');
    expect(key).toBe('year=2026/month=04/day=25/test-batch-id.json');
  });

  it('batchId 省略時は UUID 自動生成', () => {
    const date = new Date('2026-04-25T10:00:00Z');
    const key = generateS3Key(date);
    expect(key).toMatch(/^year=2026\/month=04\/day=25\/[0-9a-f-]+\.json$/);
  });

  it('月日が 1 桁でも 0 パディング', () => {
    const date = new Date('2026-01-05T10:00:00Z');
    const key = generateS3Key(date, 'x');
    expect(key).toBe('year=2026/month=01/day=05/x.json');
  });
});

// putToS3 はモック fetch で署名 URL の妥当性のみ確認するか、wrangler dev で実環境テスト。
// 今回は generateS3Key の純粋関数 3 テストのみで Stage 2 の品質を担保。
```

### Step 4: テスト実行

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run test/aws.test.js
```

Expected: `3 passed`

### Step 5: 全 Workers テスト確認

```bash
npx vitest run
```

Expected: `23 passed`（既存 20 + 新規 3）

### Step 6: コミット

```bash
cd /home/tetutetu/projects/trip-road
git add workers/package.json workers/package-lock.json workers/src/aws.js workers/test/aws.test.js
git commit -m "$(cat <<'EOF'
feat(workers): aws4fetch + S3 PUT helper を追加

- workers/src/aws.js:
  - putToS3(env, key, body): aws4fetch で SigV4 署名 → S3 PUT
  - generateS3Key(date, batchId): year=YYYY/month=MM/day=DD/<uuid>.json
    パーティション形式（Athena 用）
- aws4fetch 1.0.x（5KB、純粋 Web API のみ使用、Workers 互換）
- 3 vitest テスト（generateS3Key の純粋関数のみ。putToS3 は wrangler dev で
  実環境テスト）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 7: Workers `/api/telemetry` エンドポイント追加

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/workers/src/index.js`

### Step 1: Edit ツールで import 追加

```javascript
import { putToS3, generateS3Key } from './aws.js';
```

### Step 2: `fetch` ハンドラの URL ルーティングを拡張

既存の `if (url.pathname !== '/api/describe')` を以下に置換:

```javascript
    // /api/telemetry エンドポイント
    if (url.pathname === '/api/telemetry') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed' }, 405, allowedOrigin);
      }
      // 認証
      const received = request.headers.get('X-App-Password') || '';
      if (!await timingSafeEqual(received, env.APP_PASSWORD || '')) {
        return jsonResponse({ error: 'unauthorized' }, 401, allowedOrigin);
      }
      // body 取得
      let entries;
      try {
        const body = await request.json();
        entries = body.entries;
        if (!Array.isArray(entries) || entries.length === 0) {
          return jsonResponse({ error: 'bad_request', detail: 'entries must be non-empty array' }, 400, allowedOrigin);
        }
      } catch (e) {
        return jsonResponse({ error: 'bad_request', detail: 'invalid JSON' }, 400, allowedOrigin);
      }
      // S3 PUT
      const key = generateS3Key();
      const result = await putToS3(env, key, JSON.stringify(entries));
      if (!result.ok) {
        return jsonResponse({ error: 'upstream_error', detail: result.detail }, 502, allowedOrigin);
      }
      return jsonResponse({ ok: true, key, count: entries.length }, 200, allowedOrigin);
    }

    // /api/describe 以外は 404（既存の処理）
    if (url.pathname !== '/api/describe') {
      return jsonResponse({ error: 'not_found' }, 404, allowedOrigin);
    }
```

### Step 3: wrangler dev で動作確認

```bash
cd /home/tetutetu/projects/trip-road/workers
# .dev.vars に AWS 認証情報を追加（既存スクリプトに統合）
bash setup_dev_vars.sh  # ~/.secrets から自動で .dev.vars 作る
```

`.dev.vars` に以下が含まれていることを確認:

```
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1
S3_TELEMETRY_BUCKET=trip-road-telemetry-tetutetu214
```

不足していれば `setup_dev_vars.sh` を以下のように改修:

```bash
# Edit ツールで workers/setup_dev_vars.sh の cat > .dev.vars 部分を以下に置換
cat > .dev.vars <<EOF
APP_PASSWORD=${APP_PASSWORD}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ALLOWED_ORIGIN=http://localhost:8788
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-}
AWS_REGION=${AWS_REGION:-us-east-1}
S3_TELEMETRY_BUCKET=${S3_TELEMETRY_BUCKET:-}
EOF
```

### Step 4: wrangler dev 起動 + curl テスト

別ターミナルで:

```bash
cd /home/tetutetu/projects/trip-road/workers
npx wrangler dev --local
```

元ターミナルで:

```bash
source ~/.secrets/trip-road.env
curl -sv -X POST http://localhost:8787/api/telemetry \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -d '{"entries":[{"trace_id":"test-1","muni_code":"11210","dwell_ms":42000}]}'
```

Expected: HTTP 200、body `{"ok":true,"key":"year=2026/month=04/day=25/...json","count":1}`

### Step 5: AWS Console で S3 オブジェクトを確認

`https://s3.console.aws.amazon.com/s3/buckets/trip-road-telemetry-tetutetu214` を開き、`year=2026/month=04/day=25/<uuid>.json` が作られていることを確認。中身の JSON が test-1 entry なら成功。

### Step 6: 本番 Secrets 登録 + デプロイ

```bash
cd /home/tetutetu/projects/trip-road/workers
source ~/.secrets/trip-road.env

printf '%s' "$AWS_ACCESS_KEY_ID" | wrangler secret put AWS_ACCESS_KEY_ID
printf '%s' "$AWS_SECRET_ACCESS_KEY" | wrangler secret put AWS_SECRET_ACCESS_KEY
printf '%s' "$AWS_REGION" | wrangler secret put AWS_REGION
printf '%s' "$S3_TELEMETRY_BUCKET" | wrangler secret put S3_TELEMETRY_BUCKET

wrangler deploy --commit-message="add telemetry endpoint"
```

### Step 7: 本番疎通確認

```bash
curl -sv -X POST https://trip-road-api.tetutetu214.com/api/telemetry \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -H "Origin: https://trip-road.tetutetu214.com" \
  -d '{"entries":[{"trace_id":"prod-test-1","muni_code":"11210"}]}'
```

Expected: HTTP/2 200, S3 にオブジェクト保存

### Step 8: コミット

```bash
cd /home/tetutetu/projects/trip-road
git add workers/src/index.js workers/setup_dev_vars.sh
git commit -m "$(cat <<'EOF'
feat(workers): /api/telemetry エンドポイントを追加

POST /api/telemetry で受信した entries 配列を SigV4 署名で S3 PUT。
認証は既存の X-App-Password、CORS は既存の jsonResponse ヘルパー
経由で同じヘッダ付与。

key は year=YYYY/month=MM/day=DD/<uuid>.json で Athena パーティション
最適化済。

setup_dev_vars.sh も AWS 系変数 4 種を追加するよう改修。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 8: フロント `api.js` に sendTelemetryBatch + 自動 flush

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/public/assets/api.js`
- Modify: `/home/tetutetu/projects/trip-road/public/assets/app.js`

### Step 1: `api.js` に sendTelemetryBatch 追加

```javascript
/**
 * テレメトリバッチを Workers /api/telemetry に送る。
 * 失敗時は 1 回だけリトライ、それ以上は呼び出し側で諦める（再送は次回 flush で）。
 *
 * @param {string} password
 * @param {Array<object>} entries
 * @returns {Promise<{ok: true, key: string} | {ok: false, status: number, error: string}>}
 */
export async function sendTelemetryBatch(password, entries) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Password': password,
        },
        body: JSON.stringify({ entries }),
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, key: data.key };
      }
      if (res.status === 401) {
        return { ok: false, status: 401, error: 'unauthorized' };
      }
    } catch (e) {
      if (attempt === 0) await new Promise(r => setTimeout(r, 2000));
    }
  }
  return { ok: false, status: 0, error: 'failed_after_retry' };
}
```

### Step 2: `app.js` に自動 flush ロジック追加

`enterMainApp` の末尾（finalizeCurrent の後）に追加:

```javascript
  // === テレメトリ自動 flush ===
  const FLUSH_THRESHOLD = 10;  // 10 entries 溜まったら送信
  const FLUSH_INTERVAL_MS = 60000;  // または 60 秒ごと

  async function tryFlushTelemetry() {
    const count = getTelemetryCount();
    if (count === 0) return;
    const batch = getTelemetryBatch(50);  // 一度に最大 50 件
    const traceIds = batch.map(e => e.trace_id);
    const result = await sendTelemetryBatch(password, batch);
    if (result.ok) {
      clearTelemetryBatch(traceIds);
      console.log(`[telemetry] flushed ${batch.length} entries to ${result.key}`);
    } else {
      console.warn(`[telemetry] flush failed:`, result.error);
    }
  }

  // 閾値超え or 定期で flush
  setInterval(() => {
    if (getTelemetryCount() >= FLUSH_THRESHOLD) tryFlushTelemetry();
  }, FLUSH_INTERVAL_MS);
```

`app.js` 冒頭 import に追加:

```javascript
import { sendTelemetryBatch } from './api.js';
import { getTelemetryCount, getTelemetryBatch, clearTelemetryBatch } from './storage.js';
```

### Step 3: 構文チェック

```bash
node --check /home/tetutetu/projects/trip-road/public/assets/app.js && echo "OK"
node --check /home/tetutetu/projects/trip-road/public/assets/api.js && echo "OK"
```

Expected: 両方 OK

### Step 4: ローカル動作確認

```bash
cd /home/tetutetu/projects/trip-road
npm run serve
# http://localhost:8000 で動作確認、DevTools Network タブで /api/telemetry が叩かれることを確認
# （注: localhost:8000 から本番 API は CORS で弾かれる、確認は本番 URL でやる）
```

### Step 5: 本番デプロイ

```bash
bash /home/tetutetu/projects/trip-road/deploy_frontend.sh
```

### Step 6: 本番動作確認

`https://trip-road.tetutetu214.com` を iPhone or PC で開き、市町村を 10 回切り替える（または 1 分待つ）。AWS S3 Console で新しいオブジェクトが追加されることを確認。

### Step 7: コミット

```bash
cd /home/tetutetu/projects/trip-road
git add public/assets/api.js public/assets/app.js
git commit -m "$(cat <<'EOF'
feat(frontend): テレメトリの自動 flush を追加

10 entries 溜まったら or 60 秒ごとに /api/telemetry に送信し、
成功した entry を localStorage から削除する。

- sendTelemetryBatch: 1 回リトライ込みの fetch
- tryFlushTelemetry: 閾値判定 + 送信 + 成功時 clear
- setInterval(60秒) で定期チェック

Stage 2 完了: フロント → Workers → S3 のパイプラインが自動稼働。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
bash /home/tetutetu/projects/trip-road/deploy_frontend.sh
```

**Stage 2 完了**。S3 にデータが永続化される状態。

---

# Stage 3: Athena セットアップ + 分析クエリ集

## Task 9: Athena テーブル DDL + サンプルクエリのドキュメント化

**Files:**
- Create: `/home/tetutetu/projects/trip-road/docs/athena/create_table.sql`
- Create: `/home/tetutetu/projects/trip-road/docs/athena/sample_queries.sql`
- Create: `/home/tetutetu/projects/trip-road/docs/athena/README.md`

### Step 1: `docs/athena/create_table.sql` 作成

```sql
-- Athena テーブル定義
-- データベース: trip_road
-- 実行: AWS Console > Athena > Query editor

CREATE DATABASE IF NOT EXISTS trip_road;

CREATE EXTERNAL TABLE IF NOT EXISTS trip_road.telemetry (
  trace_id STRING,
  muni_code STRING,
  season STRING,
  description STRING,
  ts_generated BIGINT,
  ts_displayed BIGINT,
  ts_left BIGINT,
  dwell_ms BIGINT,
  re_visited_count INT,
  user_rating STRING,
  user_comment STRING,
  critic_accuracy INT,
  critic_meaningfulness INT,
  critic_density INT
)
PARTITIONED BY (
  year INT,
  month INT,
  day INT
)
ROW FORMAT SERDE 'org.openx.data.jsonserde.JsonSerDe'
WITH SERDEPROPERTIES (
  'serialization.format' = '1',
  'ignore.malformed.json' = 'true'
)
LOCATION 's3://trip-road-telemetry-tetutetu214/'
TBLPROPERTIES (
  'projection.enabled' = 'true',
  'projection.year.type' = 'integer',
  'projection.year.range' = '2026,2030',
  'projection.month.type' = 'integer',
  'projection.month.range' = '1,12',
  'projection.month.digits' = '2',
  'projection.day.type' = 'integer',
  'projection.day.range' = '1,31',
  'projection.day.digits' = '2',
  'storage.location.template' = 's3://trip-road-telemetry-tetutetu214/year=${year}/month=${month}/day=${day}/'
);

-- 注: S3 オブジェクトが JSON 配列形式（[{...}, {...}]）の場合、Athena は array of objects として
-- 1 レコードに見えてしまいます。CROSS JOIN UNNEST で展開するか、Lambda で JSON Lines 形式
-- (1 行 1 オブジェクト) に変換する事前処理を入れるかは、実データ確認後に判断。
-- まずは小規模で試して、必要なら preprocess Lambda を追加する方針。
```

### Step 2: `docs/athena/sample_queries.sql` 作成

```sql
-- ======================================
-- 1. 直近 7 日の telemetry 件数推移
-- ======================================
SELECT year, month, day, COUNT(*) as cnt
FROM trip_road.telemetry
WHERE year = 2026 AND month = 4
GROUP BY year, month, day
ORDER BY year, month, day;

-- ======================================
-- 2. 「自分が長く読んだ解説」TOP 10
--    dwell_ms（滞在時間）でソート
-- ======================================
SELECT muni_code, season, dwell_ms, description
FROM trip_road.telemetry
WHERE dwell_ms IS NOT NULL
  AND dwell_ms > 30000  -- 30 秒以上
  AND year = 2026
ORDER BY dwell_ms DESC
LIMIT 10;

-- ======================================
-- 3. 「即離脱された解説」TOP 10
--    プロンプト改善のネタになる
-- ======================================
SELECT muni_code, season, dwell_ms, description
FROM trip_road.telemetry
WHERE dwell_ms IS NOT NULL
  AND dwell_ms < 3000  -- 3 秒未満
  AND year = 2026
ORDER BY dwell_ms ASC
LIMIT 10;

-- ======================================
-- 4. 季節別の平均滞在時間
-- ======================================
SELECT season,
       COUNT(*) as cnt,
       ROUND(AVG(dwell_ms) / 1000.0, 1) as avg_dwell_sec,
       ROUND(APPROX_PERCENTILE(dwell_ms, 0.5) / 1000.0, 1) as median_dwell_sec
FROM trip_road.telemetry
WHERE dwell_ms IS NOT NULL AND year = 2026
GROUP BY season
ORDER BY avg_dwell_sec DESC;

-- ======================================
-- 5. リピート訪問された市町村
--    (同じ muni_code が複数 trace_id で出てる)
-- ======================================
SELECT muni_code,
       COUNT(*) as visit_count,
       COUNT(DISTINCT season) as seasons_covered
FROM trip_road.telemetry
WHERE year = 2026
GROUP BY muni_code
HAVING COUNT(*) > 1
ORDER BY visit_count DESC
LIMIT 20;

-- ======================================
-- 6. Critic 評価（Stage 4 以降に有効）
--    LLM 評価が高いのに即離脱されたケース = プロンプト調整余地
-- ======================================
SELECT muni_code, season, critic_meaningfulness, dwell_ms, description
FROM trip_road.telemetry
WHERE critic_meaningfulness >= 4
  AND dwell_ms < 5000
  AND year = 2026
ORDER BY critic_meaningfulness DESC, dwell_ms ASC;
```

### Step 3: `docs/athena/README.md` 作成

```markdown
# Athena セットアップガイド

trip-road の telemetry データ（S3: `trip-road-telemetry-tetutetu214`）を
Athena で SQL 分析するためのセットアップと基本クエリ集。

## 初回セットアップ

1. AWS Console → Athena を開く（リージョン: us-east-1）
2. Settings で Query result location を設定:
   - 例: `s3://aws-athena-query-results-{account-id}-us-east-1/`
3. Query editor で `create_table.sql` の内容をコピペして実行
4. テーブル `trip_road.telemetry` が作成される

## 動作確認

```sql
SELECT COUNT(*) FROM trip_road.telemetry WHERE year = 2026;
```

数字が返れば成功。

## サンプルクエリ

`sample_queries.sql` 参照。コピペしてそのまま実行可。

## コスト

Athena は「スキャンしたデータ量」に応じて $5/TB 課金（圧縮データで計算）。
trip-road の telemetry は 1 entry 〜 1KB なので、
- 月 1,000 entries（1MB）スキャン → 約 $0.000005
- 実質無料レベル

partition projection（create_table.sql の TBLPROPERTIES）を使うことで、
WHERE 句の year/month/day 指定で必要な S3 prefix だけスキャンされ、コスト最小化。

## 関連ファイル

- `create_table.sql`: テーブル DDL
- `sample_queries.sql`: 分析クエリ集
- `../knowledge.md` 4.7 セクション: 設計判断
```

### Step 4: コミット

```bash
cd /home/tetutetu/projects/trip-road
git add docs/athena/
git commit -m "$(cat <<'EOF'
docs(athena): テーブル DDL + サンプルクエリ + セットアップガイドを追加

Stage 3 完了: S3 に蓄積されたテレメトリデータを Athena で SQL 分析する
ための DDL とよく使うクエリ集をドキュメント化。

- create_table.sql: trip_road.telemetry テーブルの CREATE 文（partition
  projection で WHERE 句最適化、JSON SerDe で JSON 配列を直接読める）
- sample_queries.sql: 6 種の分析クエリ（件数推移、長/短滞在 TOP10、
  季節別平均、リピート訪問、Critic 評価相関）
- README.md: 初回セットアップ + コスト見積（実質無料）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 10: docs/todo.md / knowledge.md 更新 + PR

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/docs/todo.md`
- Modify: `/home/tetutetu/projects/trip-road/docs/knowledge.md`

### Step 1: `docs/todo.md` 末尾に Phase 5 セクション追加

```markdown
## Phase 5: テレメトリ + AWS S3 Sink（Plan D 実装）

- [ ] Stage 1: localStorage 蓄積 + 手動エクスポート
  - [ ] telemetry.js（trace_id 生成、entry 組立、サンプリング）TDD
  - [ ] storage.js 拡張（appendTelemetry / updateTelemetry / batch CRUD）TDD
  - [ ] app.js に呼出 site 4 箇所追加
  - [ ] 手動エクスポート UI（フッター 📤 ボタン）
- [ ] Stage 2: AWS 自動 sink
  - [ ] S3 バケット + IAM 作成
  - [ ] aws4fetch 導入 + workers/src/aws.js
  - [ ] /api/telemetry エンドポイント追加
  - [ ] フロント自動 flush（10 件 or 60 秒）
- [ ] Stage 3: Athena
  - [ ] テーブル DDL 実行
  - [ ] サンプルクエリで動作確認
- [ ] PR 作成・マージ
```

### Step 2: `docs/knowledge.md` に新セクション追加

```markdown
### 4.7 テレメトリ + AWS S3 Sink（Phase 5 / Plan D で追加）

#### Cloudflare ↔ AWS マルチクラウドの繋ぎ方

- フロント・API は Cloudflare、データ分析は AWS という棲み分け
- Workers から S3 PUT は `aws4fetch`（5KB の Workers 互換ライブラリ）で SigV4 署名
- IAM ユーザは `s3:PutObject` のみ許可、最小権限の原則
- Workers Secrets に `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` を保管

#### S3 partition layout の選択

`year=YYYY/month=MM/day=DD/<uuid>.json` 形式で日付パーティション。Athena の
partition projection で WHERE year=2026 AND month=4 のような絞り込みが
S3 の prefix scan で済み、データ量が増えてもクエリコストが増えない。

#### Telemetry の trace_id 設計

- フロントで UUID v4 を生成（`crypto.randomUUID()`、モダンブラウザは標準）
- entry 全体のキーとして利用、生成時と離脱時の更新で紐付け
- Workers レスポンスに `X-Trace-Id` ヘッダで返す案もあるが、フロント発行の方が単純

#### サンプリング戦略

- 初期 100% で全件記録（少量なので問題なし）
- 月数千件超えてきたら `TELEMETRY_SAMPLE_RATE = 0.2` 程度に下げる
- `Math.random() < rate` で確率判定、決定的でなくてOK

#### Athena vs DynamoDB vs RDS の選択理由

- Athena: 「読み少、書き常時、コスト最小、SQL で集計」 → 一致
- DynamoDB: key/value 偏りで読み書きコスト変動、集計に弱い
- RDS: 常時起動コストが効く、PoC スケールには過剰
- → S3 + Athena が最強

#### "ログ基盤を Critic より先に作る" の理由

Critic（LLM 自己評価）を導入しても、それが正しいか検証する基準が無いと
「LLM が LLM を評価する閉じたループ」になる。先に Logger でユーザの実反応を
蓄積しておけば、Critic 導入時に「Critic スコアと人間の反応が相関するか」を
後から検証可能。
```

### Step 3: コミット + push

```bash
cd /home/tetutetu/projects/trip-road
git add docs/todo.md docs/knowledge.md
git commit -m "docs: Plan D （テレメトリ + AWS S3）の todo / knowledge を更新"
git push
```

### Step 4: PR 作成（MCP）

Claude が `mcp__github__create_pull_request` で:
- title: `Plan D: テレメトリ蓄積 + AWS S3 Sink + Athena 分析基盤`
- body: 各 Stage の成果、E〜G 論点の確定事項、コスト見積を含める

### Step 5: マージ → ブランチ削除

ユーザレビュー → マージ → main 同期 → feature ブランチ削除。

---

## 完了条件（Plan D 全体）

以下が満たされれば Plan D 完了:

1. **Stage 1**: localStorage に telemetry が蓄積、エクスポート UI で JSON ダウンロード可
2. **Stage 2**: 10 件 or 60 秒ごとに自動で S3 に PUT、AWS Console で確認可
3. **Stage 3**: Athena で `SELECT * FROM trip_road.telemetry LIMIT 10` が動く
4. **vitest**: 既存 30 + 新規 8 = 38 テスト pass
5. **PR マージ**: main にマージ済

## コスト試算（PoC スケール想定）

| サービス | 利用量/月 | 月額 |
|---|---|---|
| S3 ストレージ | 1MB | $0.000023 |
| S3 PUT | 100 リクエスト（バッチ後） | $0.0005 |
| Workers | 100 req（既存 + telemetry） | $0（無料枠） |
| Athena | 月数回・1MB スキャン | $0.000005 |
| IAM | — | $0 |
| **合計** | | **$0.001 未満** |

実質無料。

## 将来拡張（Plan E 以降の候補）

- Sonnet による Critic 評価（生成と同時 or 非同期）
- 👍 / 👎 ボタンの追加
- Few-shot prompt 改善（高評価 entry を system prompt に同梱）
- OIDC keyless（Workers ↔ AWS）
- Lambda で JSON Lines 形式に preprocess（Athena 効率化）
- Quicksight or Grafana で可視化ダッシュボード

## 次のステップ

Plan D の文書化のみ完了（実装は後日）。実装を始めるタイミングは:

- trip-road を実走で使い、「データが欲しい」と感じたとき
- 暗黙シグナルだけでなく明示フィードバックも必要になったとき（Plan E への拡張時）
- agentic 改善ループに進む準備ができたとき
