# trip-road タスク一覧

**最終更新**: 2026-04-29

---

## 現在のステータス（設計・計画フェーズ）

- [x] memo.txt 読解
- [x] speed-mater 調査（GPS取得コードの流用元として確認済み）
- [x] ブレインストーミングで B/C/D/E 確定
- [x] docs/plan.md 作成
- [x] docs/knowledge.md 作成
- [x] CLAUDE.md（プロジェクト）作成
- [x] docs/plan.md てつてつレビュー完了
- [x] docs/spec.md 詳細化（611 行、実装詳細版）
- [x] docs/design/ にモックアップ HTML + preview.html 配置
- [x] writing-plans スキルで Plan A（Phase 0-1）作成済

---

## Phase 0: 準備

- [x] GitHub リポジトリ `tetutetu214/trip-road` 作成（パブリック + Secret Scanning 有効）
- [x] 初回コミット & プッシュ（docs / CLAUDE.md / memo.txt）
- [x] Cloudflare アカウント動作確認（Pages・Workers 利用可能か）
- [x] Anthropic アカウント作成 + $5 クレジット前払い + APIキー発行
- [x] 32文字ランダムパスワード生成（`openssl rand -hex 16`）し `~/.secrets/trip-road.env` に保存
- [x] Google Cloud Shell 接続確認（実際はローカル WSL で実行した、Cloud Shell は不要と判断）
- [x] `feature/phase0-1-setup-and-data` ブランチで PR 作成（Task 16 にて）

## Phase 1: データ前処理

- [x] `preprocess/helpers.py` と単体テスト（TDD、5 テスト pass）
- [x] `preprocess/split_and_simplify.py` スクリプト作成（TDD、4 テスト pass）
- [x] `preprocess/build_adjacency.py` スクリプト作成（TDD、2 テスト pass）
- [x] `preprocess/download_n03.sh` 作成
- [x] 全 pytest 11 テスト pass 確認
- [x] N03 全国データ取得（ローカル WSL 上で 583MB ダウンロード）
- [x] 市町村単位 GeoJSON 分割（tolerance 0.0005、座標5桁丸め）→ 1,905 ファイル・合計 32MB
- [x] adjacency.json 生成（touches ∪ intersects）→ 96KB、1,852 エントリ
- [x] ラッパースクリプト作成（`run_split.sh` / `run_adjacency.sh` / `run_summary.sh` / `run_deploy.sh`）
- [x] Cloudflare Pages プロジェクト `trip-road-data` 作成
- [x] `out/` を production ブランチとしてデプロイ
- [x] 本番動作確認（千代田区 HTTP 200、adjacency.json 取得 OK）

## Phase 2: Workers 実装（完了）

- [x] `workers/wrangler.toml` 作成
- [x] `workers/src/auth.js`（定数時間比較、TDD 6 テスト）
- [x] `workers/src/cors.js`（プリフライト + ヘッダ、TDD 3 テスト）
- [x] `workers/src/anthropic.js`（プロンプト組立 + API 呼出、TDD 11 テスト）
- [x] `workers/src/index.js` 実装（4 モジュールを glue）
- [x] 全 20 pytest（vitest）pass 確認
- [x] `workers/.dev.vars` 生成スクリプト（setup_dev_vars.sh）
- [x] `wrangler dev` ローカル E2E テスト（test_api_local.sh、4 ケース全 pass）
- [x] `wrangler secret put APP_PASSWORD / ANTHROPIC_API_KEY / ALLOWED_ORIGIN`
- [x] `wrangler deploy` で本番デプロイ完了
- [x] 本番 URL: `https://trip-road-api.lemoned-i-scream-art-of-noise.workers.dev`
- [x] 本番 curl で認証成功・401・404 動作確認

## Phase 3: フロントエンド実装（完了）

- [x] PWA メタタグ + ダークテーマCSS（モックアップ準拠）
- [x] Leaflet 地図表示（地理院タイル）
- [x] GPS取得 + 速度表示（geo.js）
- [x] P-in-P判定 + adjacency プリフェッチ + GSI フォールバック（muni.js）
- [x] LLM 呼び出し + `{code}_{season}` キャッシュ + 3回指数バックオフ（api.js + storage.js）
- [x] 軌跡ポリライン + 制覇カウント + localStorage 永続化
- [x] パスワード入力UI + エラー表示 + 免責表示
- [x] 純粋関数 3 モジュール（season/cache/storage）を vitest で 10 テスト pass
- [x] バグ修正: 最小化→復帰時の地図サイズ崩れ（visibilitychange + invalidateSize）
- [x] バグ修正: 下部カードの3層レイアウトバグ（地図ラベル隠れ + muni-row 上半分透け + iPhone 実機での safe-area 食い違い）
      → ResizeObserver で `--card-height` 動的反映 + gradient を px 固定（2026-04-27、`knowledge.md` 4.X 章）
      → `.bottom-card` を `bottom: 0` に張替え + padding-bottom で safe-area-inset-bottom を吸収（2026-04-29、3 層目）

## Phase 4: デプロイ＆実機確認（完了）

- [x] 仮アイコン（180x180 PNG「TR」）作成・配置
- [x] manifest.json 作成
- [x] Cloudflare Pages `trip-road` プロジェクトにフロントデプロイ
- [x] 独自ドメイン `trip-road.tetutetu214.com` 紐付け
- [x] iPhone Safari で「ホーム画面に追加」確認（実機）
- [x] スタンドアロンモード起動確認（実機）
- [x] 実走テスト（実機、市町村切替・LLM 解説生成・軌跡描画すべて確認）
- [x] LLM解説品質の実使用確認（プロンプト設計通りに具体的地名 + 季節感、日付なし）
- [x] Playwright E2E 4 テスト pass（Chromium iPhone エミュレーション、本番ドメイン対象）

---

## Phase 5: テレメトリ + AWS S3 Sink + LLM 分析（Plan D）

### Stage 1: localStorage 蓄積 + 手動エクスポート

- [x] `telemetry.js`（trace_id 生成、entry 組立、サンプリング）TDD
- [x] `storage.js` 拡張（appendTelemetry / updateTelemetry / batch CRUD）TDD
- [x] `app.js` に呼出 site 4 箇所追加
- [x] 手動エクスポート UI（フッター 📤 ボタン）

### Stage 2: AWS 自動 sink

- [x] S3 バケット + IAM 作成（最小権限 s3:PutObject）
- [x] `aws4fetch` 導入 + `workers/src/aws.js`
- [x] `/api/telemetry` エンドポイント追加 + 本番デプロイ
- [x] フロント自動 flush（市町村切替の都度即送信、60 秒タイマーは失敗時リトライ）
- [x] 漏洩アクセスキーのローテーション（IAM 新規作成 → ローカル / Workers 更新 → 旧削除）

### Stage 3: LLM 分析セットアップ（当初の Athena 案から方針変更）

- [x] `docs/analysis/fetch_entries.sh`（S3 → ローカル JSONL 集約）
- [x] `docs/analysis/prompts.md`（3 種プロンプトテンプレ）
- [x] `docs/analysis/README.md`（使い方ガイド）
- [x] `.gitignore` に `docs/analysis/data/` 追加
- [x] IAM ポリシーを analysis 用に拡張（`s3:ListBucket` / `s3:GetObject` / `s3:DeleteObject`）

### 完了

- [x] `docs/todo.md` / `docs/knowledge.md` 4.7 セクション更新
- [ ] `feature/telemetry-aws` → main の PR 作成・マージ

### LLM プロンプトを二十四節気・地名・歴史・地形対応に刷新（2026-04-29）

- [x] `season.js` を `getSolarTerm()` に書き換え（節気番号 '01'〜'24' を返す）
- [x] `cache.js` / `storage.js` のキャッシュ層を可変キー構造に変更
- [x] `app.js` / `api.js` / `telemetry.js` のフィールド名を `season` → `solar_term` に
- [x] `workers/src/anthropic.js` のプロンプトとバリデーションを刷新（節気名+番号で渡し、地名・歴史・地形を確信ある範囲で書かせる）
- [x] フロント・Worker 両方のテスト更新（全パス）
- [x] `docs/spec.md` の API 仕様・プロンプト仕様・データ仕様を更新
- [x] `docs/knowledge.md` 4.X セクションに移行の決定事項を記録

---

## 将来的な改善（フェーズ2以降）

- [ ] 道の駅の近隣表示（進行方向 ±60°、1200駅データ）
- [ ] GPXエクスポート
- [ ] オフライン対応（Service Worker）
- [ ] React + Vite 移行
- [ ] Wikipedia API によるLLMグラウンディング
- [ ] 境界振動対策
- [ ] Android Chrome 対応テスト
- [ ] 本格アイコンデザイン
- [ ] 解説の「再生成」ボタン
- [ ] 軌跡のlocalStorage トリム戦略
- [ ] `download_n03.sh` の最終 `ls` を動的に（MLIT の zip 構造変更への備え）
- [ ] `build_adjacency.py` の入力 0 件時の防御的 early return
