# trip-road タスク一覧

**最終更新**: 2026-05-03（6.5 完了）

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
- [x] `feature/telemetry-aws` → main の PR 作成・マージ（PR #27、2026-04-29）

### LLM プロンプトを二十四節気・地名・歴史・地形対応に刷新（2026-04-29）

- [x] `season.js` を `getSolarTerm()` に書き換え（節気番号 '01'〜'24' を返す）
- [x] `cache.js` / `storage.js` のキャッシュ層を可変キー構造に変更
- [x] `app.js` / `api.js` / `telemetry.js` のフィールド名を `season` → `solar_term` に
- [x] `workers/src/anthropic.js` のプロンプトとバリデーションを刷新（節気名+番号で渡し、地名・歴史・地形を確信ある範囲で書かせる）
- [x] フロント・Worker 両方のテスト更新（全パス）
- [x] `docs/spec.md` の API 仕様・プロンプト仕様・データ仕様を更新
- [x] `docs/knowledge.md` 4.X セクションに移行の決定事項を記録

---

## Phase 6 / Plan E: LLM as a judge（精度評価、計画中）

詳細は `docs/plan.md` 第 10 章。

### 6.1 Wikipedia API helper（完了 2026-05-03）

- [x] `workers/src/wikipedia.js` 実装（`prop=extracts&exintro=true` で intro 取得）
- [x] Workers Cache API による 30 日キャッシュ（`buildCacheKey` + `getCachedWikipediaExtract`）
- [x] 政令指定都市の区 → Wikipedia タイトルのマッピング検証（実 API で 6 市町村テスト、知見は `knowledge.md` 4.8.2 章）
- [x] Wikipedia ヒットしない / 失敗時の null 返却挙動（曖昧さ回避ページ判定として「句点なし extract は null」を追加）
- [x] 単体テスト（純粋関数 24 ケース、`workers/test/wikipedia.test.js`、全 pass）
- [ ] **持ち越し**: 政令市の区への完全対応（フロントが N03_003 親市名も送る → Worker で `${区} (${親市})` 形式の title を作る）。6.7 までの間に検討

### 6.2 Judge prompts（4 軸別、完了 2026-05-03）

- [x] `workers/src/judge_prompts.js`: 事実正確性 prompt（Wikipedia 抜粋を埋込、根拠なき記述を引用列挙、null 時は「情報なし」差し替え + 保守的評価指示）
- [x] 同: 具体性 prompt（固有名詞の含有度合いを評価、汎用フレーズを引用列挙）
- [x] 同: 季節整合 prompt（二十四節気の name + period を埋込、矛盾する記述を引用列挙）
- [x] 同: 情報密度 prompt（情緒修飾に字数を取られていないか・事実が淡々と伝わっているかを評価）
- [x] 各 prompt に Few-shot キャリブレーション例（5 点 / 2 点 or 1 点を 1 件ずつ）
- [x] 各 prompt に校閲者ロール + 「先に減点根拠引用、点数最後」の CoT 指示
- [x] 出力スキーマ: `{ score: number, deductions: string[], notes: string }` をプリアンブルで明示
- [x] `SOLAR_TERM_META`（番号 → name + period の 24 個マッピング）を新設（既存 `anthropic.js` の SOLAR_TERM_MAP は generator 用なので分離）
- [x] 単体テスト 13 ケース（`workers/test/judge_prompts.test.js`、全 pass）

### 6.3 Judge 統合（完了 2026-05-03）

- [x] `workers/src/judge.js`: 4 軸を並列で Sonnet 4.6 に投げ、結果集約（`Promise.all`）
- [x] 文字数機械判定（120〜180 字、外れたら即 NG、他軸を呼ばずに早期リターン）
- [x] 合格条件: LLM 軸全 4 点以上 + 文字数 OK
- [x] Judge 自体エラー時の `null` 返却（fail-open フラグ、`passed=null, error=msg`）
- [x] HTTP 429 / 5xx は 1 回だけ指数バックオフ 1 秒リトライ（spec.md 10.8）
- [x] Sonnet レスポンス JSON 抽出（前後に説明文付き対応の正規表現マッチ）
- [x] 単体テスト 19 ケース（`workers/test/judge.test.js`、全 pass、`fetchFn`/`wikipediaFetcher`/`judgeRunner`/`sleepFn` を引数注入してモック）
- [x] モデル ID `claude-sonnet-4-6`（公式エイリアス推奨を確認）

### 6.4 `/api/describe` への組込（完了 2026-05-03）

- [x] **6.4a** spec.md 10.5 のキャッシュ条件を実態（フロント localStorage が単一の真実）に合わせて修正
- [x] **6.4b** `workers/src/describe_flow.js` 新設: 生成 → judge → NG なら 1 回だけ再生成 → 集約レスポンス
- [x] **6.4b** Judge エラー時（fail-open）は再生成しない、生成出力をそのまま返す
- [x] **6.4b** `workers/src/index.js` の /api/describe ハンドラを describe_flow 経由に変更、レスポンスに judge_passed / judge_scores / judge_deductions / regenerated / judge_error 追加
- [x] **6.4b** 統合テスト 6 ケース（1回合格 / 1回NG→2回合格 / 2回NG / fail-open / 再生成エラー / 1回目生成エラー）
- [x] **6.4c** フロント `api.js` の fetchDescription 戻り値を Plan E フィールドで拡張
- [x] **6.4c** フロント `app.js` で `judge_passed===true` のときだけ `setCachedDescription` を呼ぶ判断ロジック
- [x] **6.4c** フロント `telemetry.js` の buildTelemetryEntry スキーマを spec.md 10.6 に合わせ更新（critic_meaningfulness 廃止、critic_specificity / critic_season_fit / critic_deductions / judge_passed / regenerated / judge_error 追加）

### 6.5 フロント UI 演出（完了 2026-05-03）

- [x] **6.5a** `api.js`: fetchDescription に opts.onPhaseChange 引数追加（2 秒 / 5 秒タイマー、必ずクリア）
- [x] **6.5a** `app.js`: 段階表示（生成中→確認中→書き直し中）の配線、regenerated=true 時の 0.3 秒「✏️」演出
- [x] **6.5a** `ui.js`: setDescriptionLoadingPhase + phaseToText（純粋関数、4 ケーステスト）
- [x] **6.5a** CSS: `.tayori-loading-text` のスタイル追加
- [x] **6.5b** デバッグオーバーレイ：フッター ⚙️ トグル、setDebugInfo + formatDebugInfo、localStorage `tripRoad.debug` で永続化
- [x] **6.5b** `formatDebugInfo` 純粋関数の 6 ケーステスト
- [x] **6.5b** テレメトリ手動 export（📤 ボタン + exportTelemetryAsJson + downloadJson）削除：Plan D Stage 2 の自動 flush で全 entry が S3 に蓄積されているため不要
- [x] `telemetry.js` の `critic_*` / `judge_passed` 拡張は 6.4c で実施済

### 案 C: fetch_entries.sh 出力強化（完了 2026-05-03）

- [x] 既存サマリの「最古/最新 ts_generated」表示バグ修正（bc + xargs を bash 算術展開に置換）
- [x] Plan E 集計セクション追加：合格率 / NG 確定 / fail-open / 再生成率
- [x] 軸別平均スコア（null 除外、小数 2 桁）
- [x] NG 確定 entry の listing（muni_code / solar_term / 4 軸スコア / regen フラグ）
- [x] Plan E より前の entry は has("judge_passed") でフィルタして除外
- [x] docs/analysis/README.md に新サマリ出力例を追記

### 6.6 ドキュメント・本番反映

- [ ] `docs/spec.md` に Plan E の API 仕様・プロンプト仕様・S3 スキーマ更新を追記
- [ ] `docs/knowledge.md` 4.8 章として設計判断・実装ハマりどころを記録
- [ ] `CLAUDE.md` に Sonnet 4.6 / Wikipedia API を技術スタックへ追記
- [ ] Workers `wrangler deploy` で本番反映
- [ ] 翌日実走で S3 に `judge_passed` / スコアが正しく入ることを確認

---

## 将来的な改善（Plan F 以降）

- [ ] 道の駅の近隣表示（進行方向 ±60°、1200駅データ）
- [ ] GPXエクスポート
- [ ] オフライン対応（Service Worker）
- [ ] React + Vite 移行
- [ ] Web 検索 API（Brave 等）による多源グラウンディング（Wikipedia の補完）
- [ ] 既存キャッシュの遡及評価・無効化スクリプト（運用で必要になった時点で）
- [ ] Judge スコアと dwell_ms 等の満足度シグナルの相関分析
- [ ] 境界振動対策
- [ ] Android Chrome 対応テスト
- [ ] 本格アイコンデザイン
- [ ] 解説の「再生成」ボタン
- [ ] 軌跡のlocalStorage トリム戦略
- [ ] `download_n03.sh` の最終 `ls` を動的に（MLIT の zip 構造変更への備え）
- [ ] `build_adjacency.py` の入力 0 件時の防御的 early return
