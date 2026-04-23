# trip-road Phase 2 Implementation Plan - Cloudflare Workers API

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `POST /api/describe` を提供する Cloudflare Workers API を実装・本番デプロイし、X-App-Password 認証を通った正規リクエストに対して Claude Haiku の生成文を返す状態を実現する。

**Architecture:** Cloudflare Workers をフロント（Plan C）からの薄い API プロキシとして運用する。受信 → `X-App-Password` 定数時間比較 → JSON バリデーション → Anthropic Messages API へフォワード → 生成テキストを JSON で返す、という 5 ステップ。責任を `auth.js` / `cors.js` / `anthropic.js` / `index.js` の 4 ファイルに分離し、前 3 つは純粋関数として単体テストする。

**Tech Stack:** JavaScript (ES modules) / Cloudflare Workers (wrangler 4.x) / Vitest 1.x / Web Crypto API / Anthropic Messages API v1 / Node.js 20 LTS

---

## ブランチ戦略

Plan B の全タスクは単一ブランチ `feature/phase2-workers` で進める。最終タスクで main への PR を作成してマージする。

## File Structure

**新規作成**:
- `workers/wrangler.toml` — プロジェクト設定
- `workers/package.json` — 開発依存（vitest）
- `workers/vitest.config.js` — テストランナー設定
- `workers/src/index.js` — メイン fetch ハンドラ
- `workers/src/auth.js` — 定数時間パスワード比較
- `workers/src/cors.js` — CORS プリフライト/ヘッダ
- `workers/src/anthropic.js` — プロンプト組立 + Anthropic API 呼出
- `workers/test/auth.test.js`
- `workers/test/cors.test.js`
- `workers/test/anthropic.test.js`

**修正**:
- `.gitignore` — `workers/node_modules/`, `workers/.wrangler/` 追加
- `docs/todo.md` — Phase 2 完了マーク
- `docs/knowledge.md` — Workers 実装時の知見追記

**Secrets（リポジトリに含めない、wrangler secret put で登録）**:
- `APP_PASSWORD`: `~/.secrets/trip-road.env` の値
- `ANTHROPIC_API_KEY`: 同
- `ALLOWED_ORIGIN`: 同（Plan C 完成後に正式な Pages URL に更新）

---

## Phase 2 Tasks

### Task 1: workers/ 構造作成 + wrangler.toml + package.json

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/wrangler.toml`
- Create: `/home/tetutetu/projects/trip-road/workers/package.json`
- Modify: `/home/tetutetu/projects/trip-road/.gitignore`

- [ ] **Step 1: feature ブランチを作成**

```bash
cd /home/tetutetu/projects/trip-road
git switch -c feature/phase2-workers
```

Expected: `Switched to a new branch 'feature/phase2-workers'`

- [ ] **Step 2: workers/ ディレクトリ構造を作成**

```bash
mkdir -p /home/tetutetu/projects/trip-road/workers/src
mkdir -p /home/tetutetu/projects/trip-road/workers/test
```

- [ ] **Step 3: wrangler.toml を作成**

```bash
cat > /home/tetutetu/projects/trip-road/workers/wrangler.toml <<'EOF'
name = "trip-road-api"
main = "src/index.js"
compatibility_date = "2024-10-01"

# 開発環境のデフォルト値（本番は wrangler secret put で上書き）
[vars]
# ここには秘密情報を置かない。Secrets のみを使用する。

# 本番デプロイ時の注意: 以下を wrangler secret put で設定すること
# - APP_PASSWORD          （32 文字 hex）
# - ANTHROPIC_API_KEY     （sk-ant-...）
# - ALLOWED_ORIGIN        （https://trip-road.pages.dev 等、Plan C デプロイ後に確定）

[observability]
enabled = true
EOF
```

- [ ] **Step 4: package.json を作成**

```bash
cat > /home/tetutetu/projects/trip-road/workers/package.json <<'EOF'
{
  "name": "trip-road-workers",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
EOF
```

- [ ] **Step 5: .gitignore を更新**

Edit ツールで `/home/tetutetu/projects/trip-road/.gitignore` の `node_modules/` セクションに `workers/` 系を追加。`node_modules/` の近くに以下を挿入：

```
# Cloudflare Workers
workers/node_modules/
workers/.wrangler/
```

`node_modules/` の既存行は保持（ルート直下でも使うケースに備え）。

- [ ] **Step 6: vitest インストール**

```bash
cd /home/tetutetu/projects/trip-road/workers
npm install
```

Expected: `added N packages` のメッセージ。`workers/node_modules/` が作られる。

- [ ] **Step 7: 動作確認**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest --version
wrangler --version
```

Expected: vitest が 1.x、wrangler が 4.x を表示。

---

### Task 2: vitest 設定

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/vitest.config.js`

- [ ] **Step 1: vitest.config.js を作成**

```bash
cat > /home/tetutetu/projects/trip-road/workers/vitest.config.js <<'EOF'
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.js'],
    environment: 'node',
  },
});
EOF
```

- [ ] **Step 2: 空テストを実行して設定が動くか確認**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run
```

Expected: `No test files found` というメッセージ（test/ 配下にまだテストファイルが無いため）。エラー終了（exit code != 0）は想定範囲。

---

### Task 3: auth.js のテスト（TDD Red）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/test/auth.test.js`

- [ ] **Step 1: 単体テスト作成**

Write ツールで `/home/tetutetu/projects/trip-road/workers/test/auth.test.js` を作成：

```javascript
import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '../src/auth.js';

describe('timingSafeEqual', () => {
  it('同じ文字列に対して true を返す', async () => {
    const expected = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    const received = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    expect(await timingSafeEqual(received, expected)).toBe(true);
  });

  it('異なる文字列に対して false を返す', async () => {
    const expected = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    const received = 'a3f9b12c8e4d6710ff293a4bc1e8d5d3'; // 最終1文字違い
    expect(await timingSafeEqual(received, expected)).toBe(false);
  });

  it('長さが異なる文字列に対して false を返す', async () => {
    const expected = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    const received = 'a3f9b12c';
    expect(await timingSafeEqual(received, expected)).toBe(false);
  });

  it('空文字列 vs 非空に対して false を返す', async () => {
    expect(await timingSafeEqual('', 'nonempty')).toBe(false);
    expect(await timingSafeEqual('nonempty', '')).toBe(false);
  });

  it('両方空文字列に対して true を返す', async () => {
    expect(await timingSafeEqual('', '')).toBe(true);
  });

  it('null/undefined 入力に対して false を返す（安全側）', async () => {
    expect(await timingSafeEqual(null, 'expected')).toBe(false);
    expect(await timingSafeEqual(undefined, 'expected')).toBe(false);
  });
});
```

- [ ] **Step 2: テスト実行（失敗確認）**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run test/auth.test.js
```

Expected: `Cannot find module '../src/auth.js'` エラー（未作成のため全テスト失敗）。これが TDD Red。

---

### Task 4: auth.js 実装（TDD Green）+ commit

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/src/auth.js`

- [ ] **Step 1: auth.js を実装**

Write ツールで `/home/tetutetu/projects/trip-road/workers/src/auth.js` を作成：

```javascript
/**
 * 定数時間で 2 つの文字列を比較する。
 *
 * 通常の === 比較は「最初の不一致文字でショートサーキット」するため、
 * 処理時間の差から文字列内容を推測できる攻撃（タイミング攻撃）を許す。
 * Web Crypto API の crypto.subtle.digest を使って両者を同じ長さの
 * バイト列（ハッシュ）に変換し、バイト単位の XOR で比較することで、
 * 処理時間を入力内容に依存させない。
 *
 * @param {string} received - クライアントから受け取った値
 * @param {string} expected - Workers Secrets に登録されている値
 * @returns {Promise<boolean>} 一致なら true
 */
export async function timingSafeEqual(received, expected) {
  // null/undefined の早期 return（安全側に false）
  if (typeof received !== 'string' || typeof expected !== 'string') {
    return false;
  }

  // 長さが違えば即 false。ただしこの判定自体が長さで分岐するため、
  // ハッシュに通して固定長バイト列にしてから比較する。
  const encoder = new TextEncoder();
  const receivedBuf = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(received)
  );
  const expectedBuf = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(expected)
  );

  // ハッシュは常に 32 バイト。XOR で差分ビットを OR し、0 なら一致
  const receivedArr = new Uint8Array(receivedBuf);
  const expectedArr = new Uint8Array(expectedBuf);
  let diff = 0;
  for (let i = 0; i < receivedArr.length; i++) {
    diff |= receivedArr[i] ^ expectedArr[i];
  }

  // 更に元の長さも一致することを確認（ハッシュ衝突の可能性はほぼ無いが念のため）
  return diff === 0 && received.length === expected.length;
}
```

- [ ] **Step 2: テスト実行（成功確認）**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run test/auth.test.js
```

Expected: `6 passed`

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add workers/wrangler.toml workers/package.json workers/package-lock.json workers/vitest.config.js workers/src/auth.js workers/test/auth.test.js .gitignore
git commit -m "$(cat <<'EOF'
feat(workers): 構造と定数時間比較認証を TDD で追加

- workers/wrangler.toml: Cloudflare Workers プロジェクト設定
- workers/package.json: vitest 開発依存
- workers/src/auth.js: SHA-256 ハッシュを介した定数時間比較
- workers/test/auth.test.js: 6 テスト（一致・不一致・長さ違い・null 等）
- .gitignore: workers/node_modules/ と workers/.wrangler/ 追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push -u origin feature/phase2-workers
```

Expected: `branch 'feature/phase2-workers' set up to track 'origin/feature/phase2-workers'.`

---

### Task 5: cors.js のテスト（TDD Red）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/test/cors.test.js`

- [ ] **Step 1: 単体テスト作成**

Write ツールで `/home/tetutetu/projects/trip-road/workers/test/cors.test.js` を作成：

```javascript
import { describe, it, expect } from 'vitest';
import { corsHeaders, handlePreflight } from '../src/cors.js';

describe('corsHeaders', () => {
  it('指定オリジンに対して必要なヘッダを返す', () => {
    const headers = corsHeaders('https://trip-road.pages.dev');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://trip-road.pages.dev');
    expect(headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(headers['Access-Control-Allow-Headers']).toContain('Content-Type');
    expect(headers['Access-Control-Allow-Headers']).toContain('X-App-Password');
  });
});

describe('handlePreflight', () => {
  it('OPTIONS リクエストに対して 204 を返す', () => {
    const req = new Request('https://example.com/api/describe', {
      method: 'OPTIONS',
      headers: { Origin: 'https://trip-road.pages.dev' },
    });
    const res = handlePreflight(req, 'https://trip-road.pages.dev');
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://trip-road.pages.dev');
  });

  it('非 OPTIONS リクエストに対して null を返す', () => {
    const req = new Request('https://example.com/api/describe', {
      method: 'POST',
    });
    const res = handlePreflight(req, 'https://trip-road.pages.dev');
    expect(res).toBeNull();
  });
});
```

- [ ] **Step 2: テスト実行（失敗確認）**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run test/cors.test.js
```

Expected: `Cannot find module '../src/cors.js'`。TDD Red。

---

### Task 6: cors.js 実装（TDD Green）+ commit

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/src/cors.js`

- [ ] **Step 1: cors.js 実装**

Write ツールで `/home/tetutetu/projects/trip-road/workers/src/cors.js` を作成：

```javascript
/**
 * CORS ヘッダをビルドする。
 * allowedOrigin は Workers Secrets の ALLOWED_ORIGIN から渡される。
 *
 * @param {string} allowedOrigin - 許可するオリジン URL
 * @returns {object} ヘッダ辞書
 */
export function corsHeaders(allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    'Access-Control-Max-Age': '86400', // 24h プリフライトキャッシュ
  };
}

/**
 * OPTIONS プリフライトを処理する。
 *
 * @param {Request} request - 受信リクエスト
 * @param {string} allowedOrigin - 許可するオリジン
 * @returns {Response|null} プリフライト該当なら 204 Response、そうでなければ null
 */
export function handlePreflight(request, allowedOrigin) {
  if (request.method !== 'OPTIONS') {
    return null;
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders(allowedOrigin),
  });
}
```

- [ ] **Step 2: テスト実行**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run test/cors.test.js
```

Expected: `3 passed`

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add workers/src/cors.js workers/test/cors.test.js
git commit -m "$(cat <<'EOF'
feat(workers): CORS ヘッダ生成とプリフライト処理を TDD で追加

- src/cors.js: corsHeaders / handlePreflight
- test/cors.test.js: 3 テスト（ヘッダ内容・OPTIONS 204・非 OPTIONS null）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 7: anthropic.js のテスト（TDD Red）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/test/anthropic.test.js`

- [ ] **Step 1: 単体テスト作成**

Write ツールで `/home/tetutetu/projects/trip-road/workers/test/anthropic.test.js` を作成：

```javascript
import { describe, it, expect } from 'vitest';
import { buildMessagesRequest, seasonToJa, parseDescribeRequest } from '../src/anthropic.js';

describe('seasonToJa', () => {
  it('spring を 春 に変換', () => {
    expect(seasonToJa('spring')).toBe('春');
  });
  it('summer を 夏 に変換', () => {
    expect(seasonToJa('summer')).toBe('夏');
  });
  it('autumn を 秋 に変換', () => {
    expect(seasonToJa('autumn')).toBe('秋');
  });
  it('winter を 冬 に変換', () => {
    expect(seasonToJa('winter')).toBe('冬');
  });
  it('未知の季節は undefined', () => {
    expect(seasonToJa('unknown')).toBeUndefined();
  });
});

describe('parseDescribeRequest', () => {
  it('有効な JSON を parse して 3 フィールドを返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', season: 'spring' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(body);
  });

  it('prefecture が欠落したら error を返す', () => {
    const body = { municipality: '相模原市緑区', season: 'spring' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('prefecture');
  });

  it('municipality が欠落したら error を返す', () => {
    const body = { prefecture: '神奈川県', season: 'spring' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('municipality');
  });

  it('season が欠落したら error を返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('season');
  });

  it('season が無効な値なら error を返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', season: 'autumn2' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('season');
  });
});

describe('buildMessagesRequest', () => {
  it('Anthropic Messages API 互換 JSON をビルドする', () => {
    const req = buildMessagesRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      season: 'spring',
    });
    expect(req.model).toBe('claude-haiku-4-5-20251001');
    expect(req.max_tokens).toBe(400);
    expect(req.system).toContain('観光ガイド');
    expect(req.system).toContain('120〜180字');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content).toContain('神奈川県');
    expect(req.messages[0].content).toContain('相模原市緑区');
    expect(req.messages[0].content).toContain('春');
  });
});
```

- [ ] **Step 2: テスト実行（失敗確認）**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run test/anthropic.test.js
```

Expected: `Cannot find module '../src/anthropic.js'`。TDD Red。

---

### Task 8: anthropic.js 実装（TDD Green）+ commit

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/src/anthropic.js`

- [ ] **Step 1: anthropic.js 実装**

Write ツールで `/home/tetutetu/projects/trip-road/workers/src/anthropic.js` を作成：

```javascript
/**
 * Anthropic Messages API v1 を使った「土地のたより」生成。
 *
 * このモジュールは純粋関数 3 つ:
 *   - seasonToJa: 英語季節 → 日本語季節
 *   - parseDescribeRequest: 受信 JSON body のバリデーション
 *   - buildMessagesRequest: Anthropic API 向けリクエスト JSON 組立
 * と、副作用ありの 1 関数:
 *   - callAnthropic: Anthropic API に実際に fetch
 * で構成される。
 */

const SEASON_MAP = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

const SYSTEM_PROMPT = `あなたは日本の旅行ガイドです。指定された都道府県・市区町村・季節から、旅人が通過する際に楽しめる3〜4文の観光ガイド文を書いてください。

以下のルールを守ってください：
- 文体は「です・ます調」の現代的な観光ガイド
- 120〜180字の範囲に収める
- 歴史・地形・名物・特産品は具体的に書いてよい
- 祭りやイベントの具体的な日付・回数・年号は書かない（代わりに「例年◯月頃」と表現する）
- その土地の「春/夏/秋/冬」の季節感（旬の食材・景色・花・魚など）に必ず触れる
- プレーンテキストのみ、マークダウン記法や箇条書きは使わない
- 確信が持てない情報は無理に書かない（情報量が減っても正確さを優先）
- 旅情を損なう過度な商業表現（「おすすめ！」など）は避ける`;

/**
 * 英語の季節キー（spring/summer/autumn/winter）を日本語に変換。
 * 未知の値は undefined を返す。
 */
export function seasonToJa(season) {
  return SEASON_MAP[season];
}

/**
 * POST /api/describe の body をバリデーション。
 *
 * @param {any} body - JSON.parse 済みの値
 * @returns {{ok: true, value: {prefecture, municipality, season}} | {ok: false, error: string}}
 */
export function parseDescribeRequest(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const { prefecture, municipality, season } = body;
  if (typeof prefecture !== 'string' || prefecture.length === 0) {
    return { ok: false, error: 'missing required field: prefecture' };
  }
  if (typeof municipality !== 'string' || municipality.length === 0) {
    return { ok: false, error: 'missing required field: municipality' };
  }
  if (typeof season !== 'string' || !SEASON_MAP[season]) {
    return { ok: false, error: 'invalid season (must be spring/summer/autumn/winter)' };
  }
  return { ok: true, value: { prefecture, municipality, season } };
}

/**
 * Anthropic Messages API にそのまま POST できる JSON を組み立てる。
 *
 * @param {{prefecture: string, municipality: string, season: string}} req
 * @returns {object} Messages API request body
 */
export function buildMessagesRequest(req) {
  const seasonJa = seasonToJa(req.season);
  return {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `都道府県: ${req.prefecture}\n市区町村: ${req.municipality}\n季節: ${seasonJa}`,
      },
    ],
  };
}

/**
 * Anthropic Messages API を実際に叩く（副作用あり）。
 *
 * @param {object} messagesRequest - buildMessagesRequest の出力
 * @param {string} apiKey - Anthropic API キー
 * @returns {Promise<{ok: true, description: string} | {ok: false, status: number, detail: string}>}
 */
export async function callAnthropic(messagesRequest, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(messagesRequest),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, detail: `Anthropic API error: ${text}` };
  }

  const data = await res.json();
  // Messages API の応答: { content: [{type: "text", text: "..."}] }
  const description = data?.content?.[0]?.text ?? '';
  if (!description) {
    return { ok: false, status: 502, detail: 'empty response from Anthropic' };
  }
  return { ok: true, description };
}
```

- [ ] **Step 2: テスト実行**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx vitest run test/anthropic.test.js
```

Expected: `11 passed`（seasonToJa 5 + parseDescribeRequest 5 + buildMessagesRequest 1）

- [ ] **Step 3: 全テスト再実行**

```bash
npx vitest run
```

Expected: `20 passed`（auth 6 + cors 3 + anthropic 11）

- [ ] **Step 4: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add workers/src/anthropic.js workers/test/anthropic.test.js
git commit -m "$(cat <<'EOF'
feat(workers): Anthropic プロンプト組立と API 呼出を TDD で追加

- src/anthropic.js: seasonToJa / parseDescribeRequest / buildMessagesRequest / callAnthropic
- test/anthropic.test.js: 11 テスト（季節 5 / バリデーション 5 / リクエストビルド 1）
- SYSTEM_PROMPT は spec.md 6.1 を転記（120〜180字、具体日付禁止、季節感必須等）

全 20 テスト pass 確認。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 9: index.js メイン fetch ハンドラを実装

**Files:**
- Create: `/home/tetutetu/projects/trip-road/workers/src/index.js`

index.js は純粋関数の glue で、`env` へのアクセスと `fetch` の副作用があるため単体テストは wrangler dev + curl に任せる。

- [ ] **Step 1: index.js 実装**

Write ツールで `/home/tetutetu/projects/trip-road/workers/src/index.js` を作成：

```javascript
import { timingSafeEqual } from './auth.js';
import { corsHeaders, handlePreflight } from './cors.js';
import {
  parseDescribeRequest,
  buildMessagesRequest,
  callAnthropic,
} from './anthropic.js';

/**
 * レスポンスを JSON 形式で組み立てる（CORS ヘッダ付き）。
 */
function jsonResponse(body, status, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(allowedOrigin),
    },
  });
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';

    // 1. CORS プリフライト
    const preflight = handlePreflight(request, allowedOrigin);
    if (preflight) return preflight;

    // 2. /api/describe 以外は 404
    const url = new URL(request.url);
    if (url.pathname !== '/api/describe') {
      return jsonResponse({ error: 'not_found' }, 404, allowedOrigin);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, allowedOrigin);
    }

    // 3. 認証（X-App-Password を Secrets と定数時間比較）
    const received = request.headers.get('X-App-Password') || '';
    const expected = env.APP_PASSWORD || '';
    if (!expected) {
      // Secrets 未設定は 500（運用ミス）
      return jsonResponse({ error: 'server_misconfigured' }, 500, allowedOrigin);
    }
    const authed = await timingSafeEqual(received, expected);
    if (!authed) {
      return jsonResponse({ error: 'unauthorized' }, 401, allowedOrigin);
    }

    // 4. リクエストボディ読み込み・バリデーション
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ error: 'bad_request', detail: 'invalid JSON' }, 400, allowedOrigin);
    }
    const parsed = parseDescribeRequest(body);
    if (!parsed.ok) {
      return jsonResponse({ error: 'bad_request', detail: parsed.error }, 400, allowedOrigin);
    }

    // 5. Anthropic 呼出
    const messagesRequest = buildMessagesRequest(parsed.value);
    const result = await callAnthropic(messagesRequest, env.ANTHROPIC_API_KEY);
    if (!result.ok) {
      return jsonResponse(
        { error: 'upstream_error', detail: result.detail },
        result.status >= 500 && result.status < 600 ? 502 : result.status,
        allowedOrigin,
      );
    }

    // 6. 成功
    return jsonResponse({ description: result.description }, 200, allowedOrigin);
  },
};
```

- [ ] **Step 2: コミット（実装のみ、動作確認は次のタスクで）**

```bash
cd /home/tetutetu/projects/trip-road
git add workers/src/index.js
git commit -m "$(cat <<'EOF'
feat(workers): index.js メイン fetch ハンドラを実装

auth/cors/anthropic を glue する fetch エントリポイント。
- CORS プリフライト処理
- /api/describe 以外は 404、非 POST は 405
- X-App-Password を Secrets の APP_PASSWORD と定数時間比較
- JSON body バリデーション
- Anthropic 呼出 + 成功時 {description} を返す
- 各エラーで適切な HTTP ステータス（401/400/502/500）

副作用を含むため単体テストではなく wrangler dev + curl で E2E 検証する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

---

### Task 10: wrangler dev ローカル動作確認（手動テスト）

**Files:** なし（手動テスト）

- [ ] **Step 1: ローカル用 .dev.vars を作成**（Secrets のローカル代替、git 管理外）

```bash
cat > /home/tetutetu/projects/trip-road/workers/.dev.vars <<EOF
APP_PASSWORD=$(grep '^APP_PASSWORD=' ~/.secrets/trip-road.env | cut -d= -f2)
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' ~/.secrets/trip-road.env | cut -d= -f2)
ALLOWED_ORIGIN=http://localhost:8788
EOF
chmod 600 /home/tetutetu/projects/trip-road/workers/.dev.vars
```

- [ ] **Step 2: .dev.vars が .gitignore で除外されることを確認**

```bash
cd /home/tetutetu/projects/trip-road
git check-ignore workers/.dev.vars
```

Expected: `workers/.dev.vars`（表示されれば除外されている）。もし表示されなければ `.gitignore` に `workers/.dev.vars` を追加。

注意: 既存の `.gitignore` の `.env` 系ルールで自動除外されている想定。もし check-ignore が空なら次の Edit ツール操作：`.gitignore` に `workers/.dev.vars` を明示追加。

- [ ] **Step 3: wrangler dev を起動（別ターミナルで）**

**新しいターミナルで**実行（このターミナルは占有される）:

```bash
cd /home/tetutetu/projects/trip-road/workers
npx wrangler dev --local
```

Expected: `[wrangler:info] Ready on http://localhost:8787` のようなメッセージ（ポート番号は変動）。

- [ ] **Step 4: curl で正常リクエスト**

**元のターミナル**で（`APP_PASSWORD` を ~/.secrets から読み込む）:

```bash
source ~/.secrets/trip-road.env
curl -sv -X POST http://localhost:8787/api/describe \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -H "Origin: http://localhost:8788" \
  -d '{"prefecture":"神奈川県","municipality":"相模原市緑区","season":"spring"}'
```

Expected: HTTP 200、body が `{"description":"緑区は津久井湖..."}` のような形式。Anthropic 課金が実際に発生する点に注意（約 $0.003〜0.005）。

- [ ] **Step 5: curl で認証失敗**

```bash
curl -si -X POST http://localhost:8787/api/describe \
  -H "Content-Type: application/json" \
  -H "X-App-Password: wrong_password" \
  -d '{"prefecture":"神奈川県","municipality":"相模原市緑区","season":"spring"}'
```

Expected: `HTTP/1.1 401 Unauthorized`、body `{"error":"unauthorized"}`

- [ ] **Step 6: curl でバリデーション失敗**

```bash
curl -si -X POST http://localhost:8787/api/describe \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -d '{"prefecture":"神奈川県"}'
```

Expected: `HTTP/1.1 400`、body に `"detail":"missing required field: municipality"` を含む。

- [ ] **Step 7: curl で CORS プリフライト**

```bash
curl -si -X OPTIONS http://localhost:8787/api/describe \
  -H "Origin: http://localhost:8788" \
  -H "Access-Control-Request-Method: POST"
```

Expected: `HTTP/1.1 204`、`Access-Control-Allow-Origin: http://localhost:8788` が含まれる。

- [ ] **Step 8: wrangler dev を停止**

別ターミナルで `Ctrl+C`。

---

### Task 11: Workers Secrets 登録（本番環境向け、手作業）

**Files:** なし（Cloudflare Secrets への登録のみ）

- [ ] **Step 1: APP_PASSWORD を登録**

```bash
cd /home/tetutetu/projects/trip-road/workers
source ~/.secrets/trip-road.env
echo -n "$APP_PASSWORD" | npx wrangler secret put APP_PASSWORD
```

Expected: `✨ Success! Uploaded secret APP_PASSWORD`

- [ ] **Step 2: ANTHROPIC_API_KEY を登録**

```bash
echo -n "$ANTHROPIC_API_KEY" | npx wrangler secret put ANTHROPIC_API_KEY
```

Expected: `✨ Success! Uploaded secret ANTHROPIC_API_KEY`

- [ ] **Step 3: ALLOWED_ORIGIN を登録（暫定）**

Phase 2 段階ではフロントが未確定のため、暫定値として Plan C で作る予定の URL を入れる:

```bash
echo -n "https://trip-road.pages.dev" | npx wrangler secret put ALLOWED_ORIGIN
```

Expected: `✨ Success! Uploaded secret ALLOWED_ORIGIN`

Plan C でフロントをデプロイした後、正確な URL に更新する。

- [ ] **Step 4: 登録確認**

```bash
npx wrangler secret list
```

Expected: 3 つ全部が表示される（値はマスクされる）。

---

### Task 12: 本番デプロイ

**Files:** なし

- [ ] **Step 1: デプロイ実行**

```bash
cd /home/tetutetu/projects/trip-road/workers
npx wrangler deploy
```

Expected:
```
⛅️ wrangler 4.x.x
...
✨ Uploaded trip-road-api
✨ Deployed trip-road-api triggers (... )
  https://trip-road-api.<subdomain>.workers.dev
```

表示された URL をメモ（Plan C のフロントから呼ぶエンドポイント）。

- [ ] **Step 2: 本番 curl テスト**

```bash
WORKER_URL=https://trip-road-api.<subdomain>.workers.dev  # Step 1 の URL に置換

source ~/.secrets/trip-road.env
curl -sv -X POST ${WORKER_URL}/api/describe \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -H "Origin: https://trip-road.pages.dev" \
  -d '{"prefecture":"神奈川県","municipality":"相模原市緑区","season":"spring"}'
```

Expected: HTTP 200、Anthropic からの生成テキストが JSON で返る。

- [ ] **Step 3: 本番 curl で認証失敗の確認**

```bash
curl -si -X POST ${WORKER_URL}/api/describe \
  -H "Content-Type: application/json" \
  -H "X-App-Password: wrong" \
  -d '{}'
```

Expected: `HTTP/1.1 401`

- [ ] **Step 4: Cloudflare ダッシュボード観測確認**

ブラウザで Cloudflare ダッシュボード → Workers & Pages → trip-road-api → Metrics を開き、過去の数リクエストが表示されることを確認（成功 200 と 401 のカウントが見える）。

---

### Task 13: docs 更新 + 最終コミット + PR

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/docs/todo.md`
- Modify: `/home/tetutetu/projects/trip-road/docs/knowledge.md`

- [ ] **Step 1: todo.md の Phase 2 を完了マーク**

Edit ツールで `/home/tetutetu/projects/trip-road/docs/todo.md` を開き、Phase 2 セクションの全項目を `- [ ]` → `- [x]` に変更。

- [ ] **Step 2: knowledge.md の 4.4 認証系セクションを具体化**

`docs/knowledge.md` の「### 4.4 認証系」を以下の内容で更新（Edit ツール使用）:

```markdown
### 4.4 認証系（Phase 2 で追加）

#### Web Crypto API による定数時間比較

Node の `crypto.timingSafeEqual` は Workers ランタイムに無い。代替として `crypto.subtle.digest('SHA-256', ...)` で両者を固定長バイト列にしてから XOR 比較。ショートサーキットしない for ループで各バイトを `|=` する実装が定石。

#### wrangler dev のローカル Secrets

本番は `wrangler secret put` で登録するが、ローカル開発は `.dev.vars` というファイルで環境変数を与えられる。`.gitignore` で除外必須（`.env` 系ルールで自動除外される前提）。

#### Anthropic Messages API の直接 fetch

SDK 不使用で `fetch('https://api.anthropic.com/v1/messages')` を直接呼ぶ。ヘッダは `x-api-key`, `anthropic-version: 2023-06-01`, `content-type`。レスポンスは `data.content[0].text` に生成テキスト。Workers のバンドル制限を避けられる。

#### Workers Deploy URL の形式

`<worker-name>.<account-subdomain>.workers.dev` で公開される。account-subdomain は Cloudflare アカウント固有で、初回 deploy 時に設定促される。Plan C のフロントはこの URL を fetch 対象として持つ。
```

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add docs/todo.md docs/knowledge.md
git commit -m "$(cat <<'EOF'
docs: Phase 2 完了、Workers 実装の知見を追記

- todo.md: Phase 2 全項目完了マーク
- knowledge.md: 4.4 認証系セクションを具体化
  - Web Crypto による定数時間比較
  - .dev.vars でローカル Secrets
  - Anthropic API の直接 fetch
  - Workers Deploy URL 形式

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

- [ ] **Step 4: PR 作成（Claude の MCP で実施）**

Claude が `mcp__github__create_pull_request` で PR 作成:
- owner: `tetutetu214`
- repo: `trip-road`
- base: `main`
- head: `feature/phase2-workers`
- title: `Phase 2 完了: Cloudflare Workers API 実装`
- body: 以下を含める
  - 概要（API プロキシの完成）
  - 実装内容（4 ファイル + 3 テストファイル）
  - Secrets 登録 3 件
  - 本番 URL（Task 12 で取得した URL）
  - curl 動作確認結果
  - レビュー観点（定数時間比較の正しさ、Secrets 管理、CORS の範囲）

- [ ] **Step 5: レビュー → マージ**

ユーザが PR 内容を確認 → OK ならマージ（UI または MCP）。

- [ ] **Step 6: ローカル main 同期 + feature ブランチ削除**

```bash
git switch main
git pull origin main
git branch -d feature/phase2-workers
```

---

## 完了条件（Plan B 全体）

以下がすべて満たされれば Plan B 完了:

1. `workers/` 配下に 4 つの src ファイルと 3 つの test ファイルが存在
2. `npx vitest run` で全 20 テスト pass
3. Workers Secrets に `APP_PASSWORD` / `ANTHROPIC_API_KEY` / `ALLOWED_ORIGIN` が登録済
4. `https://trip-road-api.<subdomain>.workers.dev/api/describe` に curl で POST → Anthropic の生成テキストが返る
5. 認証失敗が 401、バリデーション失敗が 400、CORS プリフライトが 204 で返る
6. PR が main にマージされている

## コスト見込み（Plan B での追加）

- Workers リクエスト: 無料枠 10 万/日 以内（PoC では 100〜1000 req/月程度）
- Anthropic API（検証分）: 10 リクエスト程度で $0.03〜0.05
- Plan A と合わせて月額数十円〜百円規模（Plan A の見積もりと変わらず）

## 次のステップ

Plan B 完了後、**Plan C（Phase 3 フロントエンド + Phase 4 デプロイ＆実機確認）**を作成する。Plan C では:

- `public/` 配下に HTML/CSS/JS を構築
- speed-mater 流用の GPS 取得
- Leaflet + 地理院タイルで地図
- Plan A の N03 データを fetch
- Plan B の Workers API を fetch
- localStorage でキャッシュ・訪問履歴
- iPhone Safari で「ホーム画面に追加」→ スタンドアロンモード起動確認
