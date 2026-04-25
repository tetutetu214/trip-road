# trip-road

> 電車・徒歩の旅で現在地の市町村をリアルタイム判定し、Claude Haiku がその土地の季節感ある解説を生成して届けるスマホ Web アプリ（PWA）。

🌐 **本番**: <https://trip-road.tetutetu214.com>

## できること

- 📍 GPS で「いる市町村」を自動判定（Turf.js Point-in-Polygon + 国土地理院逆ジオコーダのフォールバック）
- 📜 Claude Haiku が「**土地のたより**」を 120〜180 字で生成。歴史・名物・地形は具体的に、季節イベントは「例年◯月頃」で曖昧に（ハルシネーション抑制）
- 🗺️ Leaflet + 地理院タイル（淡色）で地図表示、ティールの軌跡ポリラインで通過跡を描画
- 🏆 訪問済み市町村の制覇カウント（localStorage に永続化）
- 📱 iPhone Safari の「ホーム画面に追加」でスタンドアロンモード起動可能
- 🎨 ダークテーマ + glassmorphism のフロートチップ

### 生成される「土地のたより」例（埼玉県久喜市・春）

> 久喜市は埼玉県東部に位置し、利根川沿いの豊かな自然が特徴です。春には市内の桜並木が満開となり、古利根川周辺の景観が一層引き立ちます。江戸時代の宿場町として栄えた歴史を持ち、現在も趣深い町並みが残っています。春の新鮮な野菜や山菜が旬を迎える季節、地元産の食材を使った料理も味わえます。

## アーキテクチャ

3 つの Cloudflare サービス + Anthropic API で構成。バックエンド DB は持たず、状態は localStorage に集約。

```
       ┌─────────────────────────────────┐
       │    iPhone Safari (PWA)           │
       │   trip-road.tetutetu214.com      │
       └────────┬─────────────────┬──────┘
                │                 │
       静的配信 │       認証付きAPI │
                ▼                 ▼
   ┌───────────────────┐  ┌──────────────────────────┐
   │ Cloudflare Pages   │  │ Cloudflare Workers         │
   │ trip-road          │  │ trip-road-api              │
   │ (HTML/JS/CSS)      │  │ (X-App-Password 認証 +     │
   └───────────────────┘  │  Anthropic プロキシ)       │
                          └──────────┬───────────────┘
   ┌───────────────────┐             │
   │ Cloudflare Pages   │             ▼
   │ trip-road-data     │  ┌──────────────────────────┐
   │ (1,905 市町村       │  │ Anthropic Messages API     │
   │  GeoJSON +         │  │ Claude Haiku               │
   │  adjacency.json)   │  └──────────────────────────┘
   └───────────────────┘

   外部参照:
   - 地理院タイル（地図背景、PDL1.0）
   - 国土地理院 逆ジオコーダ（P-in-P フォールバック）
```

## 技術スタック

| レイヤー | 採用技術 | バージョン |
|---|---|---|
| フロント | Vanilla JS (ES Modules) + Leaflet + Turf.js | Leaflet 1.9.4, Turf 7.x（CDN） |
| バックエンド | Cloudflare Workers | wrangler 4.x |
| LLM | Claude Haiku | `claude-haiku-4-5-20251001` |
| 静的配信 | Cloudflare Pages | — |
| データ前処理 | Python + geopandas + shapely | Python 3.12 |
| 単体テスト | vitest | 1.6 |
| E2E テスト | Playwright | 1.59 |

## リポジトリ構成

```
trip-road/
├── public/                # Cloudflare Pages デプロイ対象
│   ├── index.html
│   ├── manifest.json
│   ├── icon-180.png
│   └── assets/            # 12 JS モジュール + app.css
├── workers/               # Cloudflare Workers (認証 + Anthropic プロキシ)
│   ├── src/               # auth.js / cors.js / anthropic.js / index.js
│   ├── test/              # vitest 20 テスト
│   └── *.sh               # 運用スクリプト
├── preprocess/            # N03 データ前処理（Python）
│   ├── helpers.py / split_and_simplify.py / build_adjacency.py
│   └── *.sh               # 運用スクリプト
├── test/                  # フロント単体テスト（vitest 10）
├── tests/e2e/             # Playwright E2E（4 シナリオ）
├── docs/                  # 計画・仕様・知見・モックアップ
│   ├── plan.md
│   ├── spec.md
│   ├── knowledge.md
│   ├── todo.md
│   ├── plans/             # フェーズ別実装プラン
│   └── design/            # モックアップ HTML + コンセプト
├── deploy_frontend.sh
└── README.md              # このファイル
```

## 開発

### 前提

- Node.js v18 以上
- Python 3.12（前処理スクリプトを再実行する場合のみ）
- `~/.secrets/trip-road.env` に以下を設定:
  ```
  ANTHROPIC_API_KEY=sk-ant-...
  APP_PASSWORD=<32文字hex>
  ALLOWED_ORIGIN=https://trip-road.tetutetu214.com
  ```

### セットアップ

```bash
git clone https://github.com/tetutetu214/trip-road.git
cd trip-road
npm install
cd workers && npm install && cd ..
```

### テスト

```bash
# フロント単体テスト（10 テスト）
npm test

# Workers 単体テスト（20 テスト）
cd workers && npm test && cd ..

# E2E テスト（Playwright、4 テスト、本番ドメインに対して実行）
source ~/.secrets/trip-road.env
npm run test:e2e
```

### ローカル動作確認

```bash
npm run serve
# → http://localhost:8000 をブラウザで開く
# 注: ローカルからは Workers の CORS 制約で LLM 呼出が失敗するが、
# UI と GPS 動作は確認可能
```

### デプロイ

```bash
# フロント (Cloudflare Pages → trip-road.tetutetu214.com)
bash deploy_frontend.sh

# Workers API (Cloudflare Workers → trip-road-api.tetutetu214.com)
cd workers && bash deploy_production.sh

# データ前処理（再生成する場合のみ、Google Cloud Shell や WSL で）
cd preprocess
source .venv/bin/activate
bash run_split.sh         # N03 分割（15〜30 分）
bash run_adjacency.sh     # 隣接マスタ生成（3〜5 分）
bash run_deploy.sh        # Cloudflare Pages → trip-road-data.tetutetu214.com
```

## ドキュメント

| ファイル | 内容 |
|---|---|
| `docs/plan.md` | 開発計画・アーキテクチャ・マイルストーン |
| `docs/spec.md` | 機能・API・データ・UI 仕様（実装の原典） |
| `docs/knowledge.md` | 設計判断・トレードオフ・ハマリポイント・実装知見 |
| `docs/todo.md` | タスク一覧・将来的な改善 |
| `docs/plans/` | フェーズ別の実装プラン（Plan A / B / C） |
| `docs/design/` | デザインモックアップ HTML + コンセプト |
| `memo.txt` | 元の要件定義書（v0.3） |

## 開発フェーズ

| フェーズ | 内容 | ステータス | PR |
|---|---|---|---|
| **Phase 0** | 環境準備（Anthropic / Cloudflare / Wrangler） | ✅ | #3 |
| **Phase 1** | N03 データ前処理 + Cloudflare Pages 配信 | ✅ | #3 |
| **Phase 2** | Cloudflare Workers API（認証 + Anthropic プロキシ） | ✅ | #5 |
| **Phase 3** | フロントエンド実装（Vanilla JS + Leaflet + Turf.js） | ✅ | #8 |
| **Phase 4** | Cloudflare Pages デプロイ + 独自ドメイン + iPhone 実機 | ✅ | #8 |

詳細は `docs/plans/` の各 Plan ファイルを参照。

## テスト

| 種別 | 件数 | 場所 | 対象 |
|---|---|---|---|
| vitest 単体（フロント） | 10 | `test/` | 純粋関数（season/cache/storage） |
| vitest 単体（Workers） | 20 | `workers/test/` | 認証・CORS・Anthropic プロキシ |
| Playwright E2E | 4 | `tests/e2e/` | 本番ドメインへの全機能 E2E |
| **合計** | **34** | | |

## ライセンス・出典

このプロジェクトは個人の PoC ですが、以下の OSS とデータを利用しています：

- [Leaflet.js](https://github.com/Leaflet/Leaflet) — BSD-2-Clause
- [Turf.js](https://github.com/Turfjs/turf) — MIT
- [geopandas](https://github.com/geopandas/geopandas) — BSD-3-Clause
- [shapely](https://github.com/shapely/shapely) — BSD-3-Clause
- 国土数値情報 N03（行政区域データ）— PDL1.0 ©国土交通省を加工して作成
- 地理院タイル — PDL1.0 ©国土地理院

## 開発履歴

[プロジェクト初期化](https://github.com/tetutetu214/trip-road/commit/4575814) から [Phase 3-4 完了](https://github.com/tetutetu214/trip-road/commit/fabc050) まで、ブレインストーミング → 設計 → 実装 → 実機検証を Anthropic Claude Code (Opus 4.7) との協業で進めました。

主な技術判断・知見は `docs/knowledge.md` に記録しています。
