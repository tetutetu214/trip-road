# trip-road プロジェクト設定

このファイルは Claude Code に対する trip-road 固有の指示書です。`~/.claude/CLAUDE.md`（個人設定）で共通ルールを定義しており、本ファイルはそれを拡張する位置づけです。

## 1. プロジェクト概要

GPS ベースの旅ガイド Webアプリ。電車・徒歩移動中に iPhone Safari で現在地の市町村を判定し、Claude Haiku が生成する季節感ある解説を楽しむ「旅のお供」ツール。使用者はてつてつ個人、スマホホーム画面追加でスタンドアロンモード起動。

詳細は `docs/plan.md` を参照。

## 2. 技術スタック

- **フロントエンド**: Vanilla JS + HTML + CSS
- **地図**: Leaflet.js 1.9.4（背景は地理院タイル 淡色地図）
- **空間演算**: Turf.js（booleanPointInPolygon のみ使用）
- **バックエンド**: Cloudflare Workers（認証 + Anthropic API プロキシ + Plan E Judge 統合）
- **LLM (生成)**: Claude Haiku（`claude-haiku-4-5-20251001`）— 土地のたよりを生成
- **LLM (Judge)**: Claude Sonnet 4.6（`claude-sonnet-4-6` エイリアス）— 4 軸並列で出力を評価し、合格時のみキャッシュ書込（Plan E）
- **RAG**: 日本語版 Wikipedia API（`https://ja.wikipedia.org/w/api.php`）— Judge 軸 1（事実正確性）の根拠資料、Workers Cache API で 30 日 TTL
- **静的配信**: Cloudflare Pages
- **テレメトリ Sink**: AWS S3（パーティション: `year=YYYY/month=MM/day=DD/`）
- **データ前処理**: Python 3.12 + geopandas + shapely、Google Cloud Shell 上で実行
- **パッケージ管理**: wrangler CLI（Cloudflare）、pip（Python）、aws4fetch（Workers から S3 SigV4）

## 3. インフラ構成

- **Cloudflare Pages**: `public/` ディレクトリを配信、独自ドメイン `trip-road.tetutetu214.com`
- **Cloudflare Workers**: `workers/` の Worker を `trip-road-api.tetutetu214.com` で配信
- **Workers Secrets**:
   - `APP_PASSWORD`（32文字hex）
   - `ANTHROPIC_API_KEY`（Haiku 生成 + Sonnet Judge で共用）
   - `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_REGION` / `S3_TELEMETRY_BUCKET`（テレメトリ Sink 用 IAM）
- **外部 API**:
   - Anthropic API: Workers 経由でのみ呼出（Haiku 生成 + Sonnet Judge）
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

# Secrets 設定（初回のみ）
cd workers && wrangler secret put APP_PASSWORD
cd workers && wrangler secret put ANTHROPIC_API_KEY

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

- 「地理院タイル」
- 「国土数値情報（行政区域データ）（国土交通省）を加工して作成」
- Leaflet.js（BSD-2-Clause）
- Turf.js（MIT）
