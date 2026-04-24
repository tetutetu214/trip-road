# trip-road タスク一覧

**最終更新**: 2026-04-23

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

## Phase 3: フロントエンド実装（Plan C で実施、段階コミット）

- [ ] 3-1: HTML骨格 + PWA メタタグ + ダークテーマCSS
- [ ] 3-2: Leaflet 地図表示（地理院タイル）
- [ ] 3-3: GPS取得 + 速度表示（speed-mater コード流用）
- [ ] 3-4: P-in-P判定 + adjacency プリフェッチ + GSI フォールバック
- [ ] 3-5: LLM 呼び出し + `{code}_{season}` キャッシュ + 3回指数バックオフ
- [ ] 3-6: 軌跡ポリライン + 制覇カウント + localStorage 永続化
- [ ] 3-7: パスワード入力UI + エラー表示 + 免責表示 + 追従ON/OFFボタン

## Phase 4: デプロイ＆実機確認（Plan C 末尾で実施）

- [ ] 仮アイコン（180x180 PNG「TR」）作成・配置
- [ ] manifest.json 作成
- [ ] Cloudflare Pages `trip-road` プロジェクトにフロントデプロイ
- [ ] iPhone Safari で「ホーム画面に追加」確認
- [ ] スタンドアロンモード起動確認
- [ ] 近所散歩で実走テスト
- [ ] LLM解説品質の実使用確認
- [ ] 必要に応じ tolerance / プロンプト / UI 調整

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
