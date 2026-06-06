# trip-road プロジェクト設定

このファイルは Claude Code に対する trip-road 固有の指示書です。`~/.claude/CLAUDE.md`（個人設定）で共通ルールを定義しており、本ファイルはそれを拡張する位置づけです。

## 1. プロジェクト概要

GPS ベースの旅ガイド Webアプリ。電車・徒歩移動中に iPhone Safari で現在地の市町村を判定し、Claude Haiku が生成する季節感ある解説を楽しむ「旅のお供」ツール。使用者はてつてつ個人、スマホホーム画面追加でスタンドアロンモード起動。

詳細は `docs/plan.md` を参照。

## 2. 技術スタック

- **フロントエンド**: Vanilla JS + HTML + CSS
- **地図（メイン画面）**: Mapbox GL JS v3（Standard スタイル、端末時刻で lightPreset を dawn/day/dusk/night 自動切替。2026-06-03 に地理院タイル+Leaflet から移行）
- **地図（履歴画面）**: Leaflet.js 1.9.4（背景は地理院タイル 淡色地図。コロプレスが Leaflet 依存のため未移行）
- **空間演算**: Turf.js（booleanPointInPolygon のみ使用）
- **バックエンド**: Cloudflare Workers（認証 + Bedrock Runtime プロキシ + Plan E Judge 統合）
- **LLM (生成・Judge とも)**: **Amazon Bedrock Nova Pro**（`us.amazon.nova-pro-v1:0` cross-region inference profile） — Plan H で Anthropic Claude（Haiku 4.5 / Sonnet 4.6）から全面移行（2026-05-08）
  - Generator: temperature 0.7、`maxTokens` 400 を必ず明示
  - Judge: temperature 0、`maxTokens` 600、4 軸並列、合格時のみフロント localStorage に書込
- **RAG**: 日本語版 Wikipedia API（`https://ja.wikipedia.org/w/api.php`）— Judge 軸 1（事実正確性）の根拠資料、Workers Cache API で 30 日 TTL
- **静的配信**: Cloudflare Pages
- **テレメトリ Sink**: AWS S3（パーティション: `year=YYYY/month=MM/day=DD/`）
- **データ前処理**: Python 3.12 + geopandas + shapely、ローカル WSL 上で実行
- **パッケージ管理**: wrangler CLI（Cloudflare）、pip（Python）、aws4fetch（Workers から S3 / Bedrock の SigV4 署名）

## 3. インフラ構成

- **Cloudflare Pages**: `public/` ディレクトリを配信、独自ドメイン `trip-road.tetutetu214.com`
- **Cloudflare Workers**: `workers/` の Worker を `trip-road-api.tetutetu214.com` で配信
- **Workers Secrets**（Plan H 反映後）:
   - `APP_PASSWORD`（32 文字 hex）
   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION`（Bedrock Runtime + S3 共用、IAM ユーザー `trip-road-telemetry-writer`）
   - `S3_TELEMETRY_BUCKET`（テレメトリ Sink）
   - `ALLOWED_ORIGIN`（CORS 許可オリジン）
   - `MAPBOX_TOKEN`（Mapbox 公開トークン pk。`/api/mapbox-token` で認証済みクライアントに配布）
   - 旧 `ANTHROPIC_API_KEY` は Plan H で削除済
- **外部 API**:
   - Amazon Bedrock Runtime: Workers から SigV4 署名で Converse API 呼出（aws4fetch、modelId は `us.amazon.nova-pro-v1:0` cross-region inference profile）
   - Wikipedia API（ja.wikipedia.org）: Workers から直接、User-Agent 必須、Cache API で 30 日キャッシュ
   - AWS S3: Workers から SigV4 署名付きで PUT（aws4fetch ライブラリ）
   - 国土地理院 逆ジオコーダ: ブラウザから直接（フォールバック用途）
   - 地理院タイル: ブラウザから直接（Leaflet の TileLayer）

## 4. リポジトリ構成

```
trip-road/
├── CLAUDE.md                  # このファイル
├── memo.txt                   # 元の要件書（参考）
├── .gitignore
├── docs/                      # プロジェクト文書
│   ├── plan.md                # 計画・ロードマップ
│   ├── spec.md                # 詳細仕様
│   ├── todo.md                # タスク管理
│   ├── knowledge.md           # 決定事項・知見
│   └── design/                # モックアップ画像
├── public/                    # Pages 配信対象
│   ├── index.html
│   ├── manifest.json
│   ├── icon-180.png
│   ├── assets/                # JS/CSS
│   ├── municipalities/        # 分割GeoJSON
│   └── adjacency.json
├── workers/                   # Cloudflare Workers
│   ├── src/index.js
│   └── wrangler.toml
└── preprocess/                # N03 前処理スクリプト
    └── split_and_simplify.py
```

## 5. 主要な設計決定（ブレストで確定）

設計の根拠と選定理由は `docs/knowledge.md` を参照。仕様の完全版は `docs/spec.md` を参照。

- LLM 出力: プレーンテキスト 120〜180 字、キャッシュキーは `{市町村コード}_{季節}`
- 認証: `X-App-Password` 単一パスワード、Workers Secrets 管理、定数時間比較
- GPS 判定: 現在 → 隣接 → GSI フォールバック、watchPosition 毎に実行（間引きなし）
- N03: tolerance 0.0005 度で簡略化、政令指定都市は区単位
- UI: ダークテーマ、iPhone 専用、ホーム画面追加対応

## 6. 開発コマンド

※ Phase 0 準備完了後に追記・更新します。

```bash
# ローカル開発（フロント + Workers プロキシ）
npx wrangler pages dev public/ --proxy 8787

# Workers 単独開発
cd workers && wrangler dev

# Workers デプロイ
cd workers && wrangler deploy

# Secrets 設定（初回のみ、Plan H 反映後の構成）
cd workers && wrangler secret put APP_PASSWORD
cd workers && wrangler secret put AWS_ACCESS_KEY_ID
cd workers && wrangler secret put AWS_SECRET_ACCESS_KEY
cd workers && wrangler secret put AWS_REGION
cd workers && wrangler secret put S3_TELEMETRY_BUCKET
cd workers && wrangler secret put ALLOWED_ORIGIN
cd workers && wrangler secret put MAPBOX_TOKEN
# 旧 ANTHROPIC_API_KEY は Plan H 本番反映後に削除：
# cd workers && wrangler secret delete ANTHROPIC_API_KEY

# Pages デプロイ（public/ を配信）
wrangler pages deploy public/ --project-name=trip-road
```

## 7. セキュリティ

- **APIキー・パスワードは絶対にコミットしない**
- シークレット管理: `~/.secrets/trip-road.env` にローカル開発用の値を置く。リポジトリ内には `.env.example`（値を空にしたテンプレート）のみ
- Workers Secrets は `wrangler secret put` で登録（ダッシュボードでもマスク表示）
- CORS: Workers が受け付けるのは Cloudflare Pages のドメインのみ
- ブラウザに Anthropic API キーが露出していないことをデプロイ前に必ず DevTools で確認

## 8. Git 運用

共通ルールは `~/.claude/CLAUDE.md` 参照。本プロジェクト固有の追加事項：

- GitHub リポジトリ: `tetutetu214/trip-road`（パブリック + Secret Scanning 有効）
- デフォルトブランチ: `main`
- ブランチ: `feature/phase0-setup`, `feature/phase1-preprocess` のようにフェーズ単位で切る
- コミット粒度: 論理的区切り（例: `feat(workers): パスワード検証を追加`）ごと、溜め込まない

## 9. 参考リンク

- 元要件書: `memo.txt`
- speed-mater（GPS取得ロジックの参考元）: https://github.com/tetutetu214/speed-mater
- 国土数値情報 N03: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html
- 地理院タイル: https://maps.gsi.go.jp/development/ichiran.html
- 国土地理院 逆ジオコーダ: https://maps.gsi.go.jp/development/reversegeocode.html
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare Cache API（Workers）: https://developers.cloudflare.com/workers/runtime-apis/cache/
- Anthropic API: https://docs.anthropic.com/
- Wikipedia API (extracts): https://www.mediawiki.org/wiki/Extension:TextExtracts
- Wikipedia User-Agent ポリシー: https://meta.wikimedia.org/wiki/User-Agent_policy

## 10. ライセンス・出典表記（必須）

アプリ画面または `docs/credits.md` に以下を明示：

- © Mapbox / © OpenStreetMap（メイン地図。Mapbox GL JS が組込みの attribution で自動表示。CSS で消さない）
- 「地理院タイル」（履歴画面の背景）
- 「国土数値情報（行政区域データ）（国土交通省）を加工して作成」
- Mapbox GL JS（メイン地図ライブラリ）
- Leaflet.js（BSD-2-Clause、履歴画面）
- Turf.js（MIT）

## 11. 重要な運用上の知見

### モデル選定: Nova Pro 一択 (戻りなし)

Generator・Judge ともに `us.amazon.nova-pro-v1:0` 固定。Anthropic Claude へのロールバックは選択肢にない。Plan H 移行 (2026-05-09) の動機がコスト削減のため、てつてつ個人の PoC でランニングコストを抑えるのが必須要件で、Anthropic Claude (特に Sonnet 4.6 を Judge に使っていた構成) は Nova Pro の数倍以上の価格で現実的でない。

「Plan H 成功 or 失敗 → 失敗なら戻す」という評価枠組み自体が無効。プロンプト不調・Judge 暴走等の問題が見つかっても、Anthropic に戻すのではなく「Nova Pro でプロンプトをどう書き直すか」「Few-shot をどう強化するか」「RAG をどう拡張するか」で答える。例外は Bedrock 障害でしばらく使えない等、技術的に Nova Pro が機能しない緊急時のみ。

### 評価方法: バッチ curl (実走観測ではない)

プロンプト/モデル/Judge ロジック変更時の品質評価は、**実走テレメトリではなくバッチ curl で `/api/describe` を叩いた結果で行う**。

ユーザはてつてつ1人、移動範囲は自宅周辺・通勤ルートに固定で、市町村切替時にしか生成されず、しかも合格時のみキャッシュ書込のため、合格した市町村は二度と再評価されない。1〜2週間の実走でサンプル10件以上集めようとすると永遠に観測サイクルが回らない。

代わりに神奈川県内全市町村など固定セット × 1〜2 節気を `/api/describe` に curl で順に投げて軸別平均と合格率を取る (B1 sweep)。Nova Pro なら1回数十円で30件超のサンプルが一気に取れる。Judge 自体のプロンプト変更時は、別途手動ラベル付きの meta-eval セット 20〜30件で暴走検出。`todo.md` の「1〜2週間の実走」系チェックボックスは観測戦略として無効と判断する。PWA / GPS / UI / レイアウト系の変更は実機確認が必要なので除外。

### Plan I 方針転換 (2026-05-12 〜)

Plan I を 2026-05-12 に本番反映し、アプリのコンセプトが大きく変わった。

**Before (Plan H、〜2026-05-09):** GPS 連動で市町村を判定し、二十四節気＋市町村から **季節感のある旅の解説**を Nova Pro が生成。Judge は 4 軸 (事実 / 具体性 / 季節整合 / 情報密度) で評価。Wikipedia は事実検証用の参照。

**After (Plan I、2026-05-12〜):**

- GPS 連動で市町村を判定し、**その市町村の Wikipedia 抜粋を 120-180 字に要約**して表示
- 二十四節気・季節情報は廃止 (`season.js` / `solar_term_meta.js` / `cache.js` は存在しない)
- Wikipedia 抜粋は「唯一の情報源」、抜粋にない事実は出さないハードルール
- Judge は Faithfulness 1 軸 (抜粋外の固有名詞混入を検出) に簡素化
- Wikipedia 記事が無い市町村は Generator を呼ばずに「この市町村の Wikipedia 記事が見つかりませんでした」を表示
- Judge NG + 再生成 NG の場合は Wikipedia 抜粋を機械的に転載するフォールバック

リクエスト body は `{prefecture, municipality}` のみ (`solar_term` は廃止)。レスポンスは `description / no_wikipedia / judge_passed / faithfulness_score / out_of_kb_terms / regenerated / fallback_to_extract / wikipedia_extract_length / judge_error / generator_model / judge_model`。テレメトリ S3 バケットは新 Plan I のログが `year=YYYY/month=MM/day=DD/`、Plan H 以前の 37 件は `legacy/year=YYYY/...` に退避済。

Phase 2-1 (2026-05-12 完了) で政令市の区の Wikipedia 取得失敗を修正、`resolveWikipediaTitle` attempt=2「{市}{区} → {区} ({市})」追加で no_wikipedia 2/10 → 0/10。Phase 2-3 (2026-05-12 完了) で `exintro=true` を撤廃して本文全体取得に変更、`buildCacheKey` を v2 に昇格して旧キャッシュ無効化。合格率 60% → **100%**、fallback_to_extract 40% → 0% を達成。残課題は Faithfulness Judge の形態素解析化 (Phase 2-2 候補、`out_of_kb_terms` 誤検知への対策)。

仕様詳細は `docs/plans/2026-05-11-plan-i-wikipedia-summary-pivot.md`、知見は `docs/knowledge.md` 4.24 / 4.25 / 4.26 章。

### 既存節との整合性メモ

§ 1〜5 の記述は Plan H 時点 (季節感ある解説 / キャッシュキー = 市町村_季節 等) のままで、上記 Plan I 方針転換と矛盾する箇所がある。本ファイルの書き換えは別途実施予定。本節 (§11) が現行仕様の正である。
