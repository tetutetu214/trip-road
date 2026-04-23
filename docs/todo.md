# trip-road タスク一覧

**最終更新**: 2026-04-22

---

## 現在のステータス

- [x] memo.txt 読解
- [x] speed-mater 調査（GPS取得コードの流用元として確認済み）
- [x] ブレインストーミングで B/C/D/E 確定
- [x] docs/plan.md 作成
- [x] docs/knowledge.md 作成
- [x] CLAUDE.md（プロジェクト）作成
- [ ] **docs/plan.md てつてつレビュー（← イマココ）**
- [ ] docs/spec.md 詳細化
- [ ] docs/design/main.png（Canva MCP でモックアップ生成）
- [ ] writing-plans スキルで実装計画作成

---

## Phase 0: 準備

- [ ] GitHub リポジトリ `tetutetu214/trip-road` 作成（パブリック + Secret Scanning 有効）
- [ ] 初回コミット & プッシュ（docs / CLAUDE.md / memo.txt）
- [x] Cloudflare アカウント動作確認（Pages・Workers 利用可能か）
- [x] Anthropic アカウント作成 + $5 クレジット前払い + APIキー発行
- [x] 32文字ランダムパスワード生成（`openssl rand -hex 16`）し `~/.secrets/trip-road.env` に保存
- [x] Google Cloud Shell 接続確認
- [ ] `feature/phase0-setup` ブランチで PR 作成

## Phase 1: データ前処理

- [ ] `preprocess/split_and_simplify.py` スクリプト作成
- [ ] N03 全国データ取得（国土数値情報サービス）
- [ ] 市町村単位 GeoJSON 分割（tolerance 0.0005、座標5桁丸め）
- [ ] adjacency.json 生成（touches ∪ intersects）
- [ ] サンプル市町村で Turf.js P-in-P 動作確認
- [ ] Cloudflare Pages に data を配置
- [ ] 帯域・応答速度の実測

## Phase 2: Workers 実装

- [ ] `workers/wrangler.toml` 作成
- [ ] `workers/src/index.js` 実装（CORS + 認証 + Anthropic プロキシ）
- [ ] 定数時間比較の実装確認
- [ ] `wrangler secret put APP_PASSWORD`
- [ ] `wrangler secret put ANTHROPIC_API_KEY`
- [ ] `wrangler dev` でローカル動作確認
- [ ] `wrangler deploy` で本番デプロイ
- [ ] curl でエンドツーエンド確認（認証成功/失敗、Anthropic 呼出）

## Phase 3: フロントエンド実装（段階コミット）

- [ ] 3-1: HTML骨格 + PWA メタタグ + ダークテーマCSS
- [ ] 3-2: Leaflet 地図表示（地理院タイル）
- [ ] 3-3: GPS取得 + 速度表示（speed-mater コード流用）
- [ ] 3-4: P-in-P判定 + adjacency プリフェッチ + GSI フォールバック
- [ ] 3-5: LLM 呼び出し + `{code}_{season}` キャッシュ + 3回指数バックオフ
- [ ] 3-6: 軌跡ポリライン + 制覇カウント + localStorage 永続化
- [ ] 3-7: パスワード入力UI + エラー表示 + 免責表示 + 追従ON/OFFボタン

## Phase 4: デプロイ＆実機確認

- [ ] 仮アイコン（180x180 PNG「TR」）作成・配置
- [ ] manifest.json 作成
- [ ] Cloudflare Pages に `public/` をデプロイ
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
