# trip-road 開発計画

**バージョン**: 1.0  
**作成日**: 2026-04-22  
**ステータス**: レビュー待ち  
**出典**: memo.txt（要件定義書 v0.3）+ ブレインストーミング結果

---

## 1. プロジェクト概要

### 1.1 目的
電車・徒歩の旅行中に、GPSで現在地の市町村をリアルタイム判定し、その土地の季節感ある解説を Claude Haiku で生成して表示するスマホWebアプリ。

### 1.2 想定ユーザー
てつてつ個人。iPhone の Safari から「ホーム画面に追加」経由でアクセスし、スタンドアロンモードで利用する。

### 1.3 スコープ（フェーズ1 / PoC）
GPS取得・市町村判定・LLM解説・地図軌跡・速度表示・制覇カウント・パスワード認証の7機能。道の駅表示・GPXエクスポート・オフライン対応はフェーズ2以降。

---

## 2. アーキテクチャ

### 2.1 全体構成

```
┌─────────────────────────────┐
│ iPhone Safari（ホーム画面追加起動） │
│  Vanilla JS + Leaflet + Turf │
│  localStorage（履歴/軌跡/キャッシュ/パスワード）│
└─────────┬──────────────┬────┘
          │ 静的配信       │ 認証付きAPI呼出
          ↓              ↓
┌──────────────────┐ ┌──────────────────────┐
│ Cloudflare Pages  │ │ Cloudflare Workers    │
│ HTML/JS/GeoJSON   │ │ パスワード検証＋Anthropicプロキシ│
└──────────────────┘ └──────────┬────────────┘
                                │
        ┌───────────────────────┴────────────────────┐
        ↓              ↓                ↓            ↓
  地理院タイル    Anthropic API    GSI逆ジオコーダ  N03（静的配置）
  （地図背景）   (Claude Haiku)     (フォールバック)  (P-in-P 判定用)
```

### 2.2 データフロー（市町村切替時）

1. watchPosition → 緯度経度
2. Turf.js booleanPointInPolygon で現在市町村判定（まず現在 → 隣接 → GSIフォールバック）
3. 市町村コード変更を検知
4. キャッシュ（`{code}_{season}`）に既存エントリあり → 即表示して終了
5. 無ければ Cloudflare Workers 経由で Claude Haiku 呼出
6. 生成テキストを localStorage にキャッシュ、画面「土地のたより」カードにフェードイン表示

---

## 3. 技術スタック

| レイヤー | 採用技術 | 選定理由 |
|---|---|---|
| フロントエンド | Vanilla JS + HTML + CSS | 環境構築コスト最小。React化はフェーズ4で検討 |
| 地図ライブラリ | Leaflet.js 1.9.4（BSD-2-Clause） | 軽量・モバイル対応・地理院タイル対応 |
| 空間判定 | Turf.js booleanPointInPolygon（MIT） | クライアント内P-in-P判定の定番 |
| バックエンド | Cloudflare Workers | APIキー隠蔽・CORSゲート・無料枠内運用 |
| LLM | Claude Haiku（claude-haiku-4-5-20251001） | 低コスト・高速・日本語品質十分 |
| 静的配信 | Cloudflare Pages | GeoJSONデータとHTMLを無料配信 |
| データ前処理 | Python 3.12 + geopandas + shapely | N03 分割・間引き・adjacency 生成 |
| 前処理環境 | Google Cloud Shell | セットアップ不要・無料 |

---

## 4. ブレストで確定した主要設計

### 4.1 LLM プロンプト（B）
- **口調**: 観光ガイド風、です・ます調、情報重視
- **厳格さ**: ハイブリッド - 歴史・地形・名物は具体的、祭り日程は「例年◯月頃」でぼかす
- **出力**: プレーンテキスト 3〜4文 120〜180字
- **キャッシュ**: `{市町村コード}_{季節}` をキーに localStorage へ永続化（コスト75-87%削減見込）
- **失敗時**: 市町村名＋「解説を取得できませんでした」の控えめ注記、3回指数バックオフ（1→2→4秒）
- **免責表示**: 画面下部に「情報は目安です」を常時表示

### 4.2 認証（C）
- **方式**: 32文字hex 単一パスワード + localStorage 自動ログイン
- **ヘッダー**: `X-App-Password`
- **比較**: Workers 側で `crypto.subtle` による定数時間比較
- **保管**: Cloudflare Workers Secrets（`wrangler secret put`）
- **レート制限**: 不要（認証失敗時は Anthropic を呼ばない → コスト被害ゼロ）
- **失敗UX**: 401 → localStorage クリア → 入力画面復帰
- **CORS**: Cloudflare Pages のドメインのみ許可

### 4.3 GPS判定（D）
- **watchPosition**: `enableHighAccuracy: true, timeout: 10000, maximumAge: 0`
- **判定頻度**: watchPosition 発火ごと（約1秒に1回、間引きなし）
- **判定順序**: 現在の市町村 → 隣接のロード済み → GSI 逆ジオコーダ
- **GSI発動条件**: (i) 隣接にヒットせず (ii) 起動直後で前回位置から遠い (iii) 連続3回同一市町村でない
- **境界振動対策**: 無し（シンプル優先）
- **プリフェッチ**: 市町村切替時に adjacency.json から隣接を取得してバックグラウンド fetch

### 4.4 N03 前処理（E）
- **簡略化**: shapely `simplify(tolerance=0.0005, preserve_topology=True)` ≈ 55m 誤差
- **保持プロパティ**: `N03_001`（県名）/ `N03_004`（市区町村名）/ `N03_007`（コード）のみ
- **座標精度**: 小数5桁（約1m）に丸め
- **飛び地**: MultiPolygon 構造そのまま保持
- **政令指定都市**: 区単位で保持（N03 通り、175ファイル増）
- **ファイル配置**: `/municipalities/{N03_007}.geojson` 平坦構造
- **adjacency 生成**: `touches()` ∪ `intersects()`、出力は `/adjacency.json`（ルート）

### 4.5 UI / PWA（デザインカンプ採用版）

- **デザインの正**: `docs/design/trip_road_main_screen_mockup.html` を仕様の原典とする（memo.txt 3.6 のレイアウト順より優先）
- **コンセプト**: 「地図が主役、解説は物語として沿わせる」構成。上半分に地図、下半分に「土地のたより」カード
- **カラーベース**: ダーク `#0f0f10`（speed-mater の #1a1a1a より一段深く、夜行列車車内でも目に優しい）
- **アクセント（ティール系）**: `#5dcaa5`（軌跡・現在地マーカー）/ `#9fe1cb`（英字ラベル）。地図記号の森林・河川を想起、警告色を避けた穏やかさ
- **テキスト色**: メイン `#f5f5f7`、本文 `#d8d8dc`、副次 `#7a7a80`、ヒント `#6a6a70`
- **解説テキストの呼称**: **「土地のたより」**（memo.txt の「土地の解説」を和の旅情を優先した表現に変更）
- **上部レイアウト**: glassmorphism（`backdrop-filter: blur(12px)`）のフロート帯に「いま（市町村名）」と「制覇（カウント）」を常時表示
- **下部カード**: 市町村名（24px）と 速度（28px）を左右に、その下に「土地のたより」本文（14px / line-height 1.75 / `font-feature-settings: 'palt'`）
- **追従モード**: **常時 ON**（ON/OFF ボタンは設置しない。memo.txt 3.4 の仕様を更新）
- **対応デバイス**: iPhone Safari のみ（Android は将来課題）
- **ホーム画面追加対応**: `apple-mobile-web-app-capable` でスタンドアロンモード
- **アイコン**: 180×180 PNG を仮置き「TR」、後日差し替え
- **未デザイン状態の扱い**: パスワード入力画面・エラー・初期・ローディング状態は spec.md に文言と CSS 状態として定義し、メイン画面の設計言語（色・フォント・ラベル流儀）を踏襲する（別途モックアップは作成しない）

---

## 5. リポジトリ構成（予定）

```
trip-road/
├── CLAUDE.md                 # プロジェクト設定
├── memo.txt                  # 元の要件書（参考として残す）
├── .gitignore
├── docs/
│   ├── plan.md              # 本ファイル
│   ├── spec.md              # 詳細仕様（次フェーズで作成）
│   ├── todo.md              # タスク管理
│   ├── knowledge.md         # 決定事項・インサイト
│   └── design/
│       └── main.png         # Canva モックアップ
├── public/                   # フロントエンド（Pages配信対象）
│   ├── index.html
│   ├── manifest.json
│   ├── icon-180.png
│   ├── assets/
│   │   ├── app.js
│   │   └── app.css
│   ├── municipalities/      # 分割GeoJSON（前処理で生成）
│   │   └── {code}.geojson
│   └── adjacency.json
├── workers/                  # Cloudflare Workers
│   ├── src/
│   │   └── index.js
│   └── wrangler.toml
└── preprocess/               # N03 前処理スクリプト
    └── split_and_simplify.py
```

---

## 6. 実装マイルストーン

### Phase 0: 準備
- GitHub リポジトリ `trip-road` 作成（パブリック + Secret Scanning）
- Cloudflare アカウント確認、Pages・Workers 有効化
- Anthropic API アカウント作成 + $5 クレジット投入 + APIキー発行
- 32文字ランダムパスワード生成（`openssl rand -hex 16`）
- Google Cloud Shell 接続確認

### Phase 1: データ前処理
- N03 全国データ取得（国土数値情報サービス）
- `preprocess/split_and_simplify.py` 作成・実行
- `/municipalities/*.geojson` と `/adjacency.json` を生成
- サンプル市町村で Turf.js P-in-P 判定の動作確認
- Cloudflare Pages に data-only プロジェクトとしてアップロード

### Phase 2: Workers 実装
- `workers/src/index.js`（認証 + Anthropic プロキシ）実装
- `wrangler.toml` 作成
- Workers Secrets に APP_PASSWORD と ANTHROPIC_API_KEY 登録
- `wrangler dev` でローカル動作確認
- `wrangler deploy` で本番デプロイ
- curl でエンドツーエンド確認

### Phase 3: フロントエンド実装（段階コミット）
- 3-1: HTML骨格 + PWAメタタグ + ダークテーマCSS
- 3-2: Leaflet 地図表示（地理院タイル）
- 3-3: GPS取得 + 速度表示
- 3-4: P-in-P判定 + adjacency プリフェッチ + GSI フォールバック
- 3-5: LLM 呼び出し + `{code}_{season}` キャッシュ + リトライ
- 3-6: 軌跡ポリライン + 制覇カウント + localStorage 永続化
- 3-7: パスワード入力UI + エラー/免責表示 + 追従ON/OFFボタン

### Phase 4: デプロイ＆実機確認
- Cloudflare Pages に public/ をデプロイ
- 仮アイコン（TR文字の180x180 PNG）配置
- iPhone Safari で「ホーム画面に追加」→ スタンドアロン起動確認
- 近所散歩で実走テスト、LLM解説品質確認
- プロンプト・tolerance・UI微調整
- デザインカンプに基づくスタイル調整

---

## 7. コスト見込み

| 項目 | 想定金額 |
|---|---|
| Anthropic API（Claude Haiku、1日15市町村切替想定） | **月30〜150円程度** |
| Cloudflare Pages | 無料枠内（無制限帯域） |
| Cloudflare Workers | 無料枠内（10万req/日） |
| Google Cloud Shell | 無料 |
| GitHub | 無料（パブリックリポジトリ） |
| Anthropic 最低チャージ | $5（約750円、前払い） |

**実質月額: 数十円〜150円程度**

---

## 8. リスクと対策

| リスク | 影響度 | 対策 |
|---|---|---|
| LLMハルシネーション（日付・年号の嘘） | 中 | プロンプトで具体日付禁止・「例年◯月頃」強制、画面に免責表示 |
| GPS取得失敗（地下・トンネル） | 中 | timeout 10秒、エラー時も画面は壊さず次の測位を待つ |
| 市町村判定失敗（N03 飛び地・境界誤差） | 低 | GSI 逆ジオコーダへ自動フォールバック |
| localStorage 容量超過（長期使用） | 低 | 軌跡配列はPoCでは放置。フェーズ2以降でトリム実装 |
| Anthropic API 料金暴走（不正利用） | 高 | Workers 認証必須、CORS制限、Anthropicコンソールで月額上限設定 |
| Cloudflare Workers 月間上限超過 | 低 | 無料枠10万req/日。個人利用で超過は非現実 |
| 認証パスワードの漏洩 | 中 | 32文字hex で推測困難、Secrets管理、コミット禁止、漏れたら即再発行 |

---

## 9. 次のアクション

1. **本 plan.md をてつてつがレビュー**（このステップ）
2. OK なら docs/spec.md を詳細化
   - memo.txt の拡張版として、ブレスト確定事項を反映した完全仕様書
   - Canva MCP で iPhone 縦画面のメインモックアップを生成し docs/design/main.png に保存
3. spec.md レビュー完了後、writing-plans スキルで実装計画（ステップ単位）を作成
4. Phase 0 から着手
