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

## 9. ロードマップ進捗

- Phase 0〜4（準備・データ前処理・Workers・フロント・デプロイ）: **完了**（2026-04-22 〜 04-25）
- Phase 5（テレメトリ + AWS S3 Sink + LLM 分析セットアップ / Plan D）: **完了**（2026-04-26 〜 04-29、PR #27 マージ済）
- Phase 6（Plan E: LLM as a judge による精度評価）: **計画中**（本章）

---

## 10. Phase 6 / Plan E: LLM as a judge

### 10.1 背景と課題

Phase 5 までで S3 にテレメトリは溜まるようになったが、LLM 出力の **精度（事実誤認・具体性・季節整合・情報密度）** を継続的に検証する仕組みは未整備。実データ（2026-04-26〜27 の 8 entry）を観察した結果、

- 「相模原市は…城下町です」「江戸時代から続く城跡」のような **事実誤認の疑い** がある記述
- 「春野菜」「桜が美しく咲き誇る」のような **他市町村でも通る汎用フレーズ** が散見
- 「淡紅色に染まり」「のんびりとした春の時間」のような **情緒的修飾に字数を使い、肝心の事実情報が薄い** 記述

を確認。**trip-road は `{muni_code}_{季節}` でキャッシュするため、誤情報が一度入ると同じキーが来るたびに半永久的に表示し続ける**（致命的）。よって判定はオフラインではなく、生成と同時に行うオンライン評価が必須。

### 10.2 設計方針

| 項目 | 選択 | 主要な選定理由 |
|---|---|---|
| 評価のタイミング | **オンライン** | キャッシュ汚染防止。NG なら再生成して、合格出力のみキャッシュ |
| Judge モデル | **Claude Sonnet 4.6** | Generator (Haiku 4.5) より上位モデル、自己評価バイアス軽減。別ベンダー（GPT/Gemini）採用は Anthropic 統一方針からスコープ外 |
| 軸の構成 | **4 LLM 軸 + 1 機械軸** | 軸を分けて別 prompt にすることで迎合（Score Inflation）を抑える |
| 事実検証 | **Wikipedia API グラウンディング** | Judge の知識限界・幻覚から独立。`prop=extracts&exintro=true` で intro セクションのみ取得 |
| Wikipedia キャッシュ | **Workers Cache API、TTL 30 日** | 同じ市町村は2回目以降キャッシュヒット、Wikipedia 側への負荷ゼロ |
| 迎合対策 | **CoT・校閲者ロール・Few-shot** | 各 prompt に「先に減点根拠を引用、点数は最後」「あなたは校閲者である」「3点 / 5点のキャリブレーション例」を仕込む |
| 再生成上限 | **2 回（生成→評価→NGなら再生成→再評価で打ち切り）** | コスト・レイテンシのバランス。3 回目までいくならプロンプト自体を直す合図 |
| NG 連発時 | **表示はする / キャッシュしない / `judge_passed: false` 記録** | UX を壊さず、次回生成のチャンスを残す |
| Judge 障害時 | **Fail-open（生成のみ表示・キャッシュなし）** | Sonnet が落ちても trip-road は止まらない |
| 既存キャッシュ | **触らない** | 明日以降の新ログから蓄積する運用で十分 |

### 10.3 評価軸（5 軸構成）

| # | 軸名 | 判定方式 | 内容 | 採点の方向 |
|---|---|---|---|---|
| 1 | 事実正確性 | Sonnet + Wikipedia RAG | Wikipedia 抜粋に根拠のない記述（地理・歴史・地形）を引用列挙 | **減点根拠が多いほど低スコア**、5 点満点 |
| 2 | 具体性 | Sonnet 単独 | 単語レベルで具体的な固有名詞（地名・施設名・特産品・年号・人物等）の含有を見る。「春野菜」「桜が美しい」のような他市町村でも通る抽象・汎用フレーズの多寡を引用列挙 | **固有名詞が多いほど高スコア / 汎用フレーズが多いほど低スコア**、5 点満点 |
| 3 | 季節整合 | Sonnet 単独 | 二十四節気（穀雨・立夏など、`solar_term` で渡される）と矛盾する記述を引用列挙 | **矛盾が多いほど低スコア**、5 点満点 |
| 4 | 情報密度 | Sonnet 単独 | 文章全体で旅人にとって有用な情報（地名・歴史・地形・特産・ランドマーク等）を淡々と伝えているか。情緒的修飾（「淡紅色に染まり」「心地よい春風」「のんびりとした時間」）に字数を使うと低スコア。「3月下旬〜4月中旬に開花」のような事実陳述は高スコア | **情緒修飾が多く事実が薄いほど低スコア**、5 点満点 |
| 5 | 文字数 | コードで `length` 判定 | 120〜180 字（仕様）から外れていれば即 NG | 範囲内なら無条件 pass |

合格条件: **LLM 軸（1〜4）すべて 4 点以上 かつ 文字数判定 OK**。

### 10.4 UX 設計（待ち時間の演出）

| 段階 | 表示 | 想定時間 |
|---|---|---|
| 生成中 | 📡 土地のたよりを生成中… | 1〜2 秒 |
| Judge 評価中 | ✓ 内容を確認しています… | 2〜3 秒（追加） |
| Judge pass | 即表示 | 合計 3〜5 秒 |
| Judge NG → 再生成 | ✏️ より良い表現に書き直しています… | 追加 3〜5 秒 |
| 2 回目で合格 | 表示 | 合計 6〜10 秒 |
| 2 回目も NG | 表示（ユーザには知らせない、内部で `judge_passed: false`） | 合計 6〜10 秒 |

文言は「精度確認」のニュアンスに留め、「間違っていたので」のような責めるトーンは出さない。

### 10.5 コスト・レイテンシ見積もり

- Sonnet 4.6 単価: 入力 \$3 / Mtok、出力 \$15 / Mtok
- 1 entry あたり Judge 呼出: 4 軸 × 約 2,000 入力 tok + 200 出力 tok ≒ \$0.033
- Wikipedia API: 無料、Workers Cache でほぼヒット
- 月間想定: 100 entries × 平均 1.3 回呼出（再生成考慮） = 130 判定 ≒ **\$4.3 / 月（約 650 円）**
- レイテンシ: 4 軸を並列で叩くため、Judge 部分は逐次でなく同時実行。1 回目合格時 3〜5 秒、再生成発生時 6〜10 秒（軸数増加でも並列実行で吸収）

### 10.6 実装段取り（TDD）

| Phase | 内容 | 主な成果物 |
|---|---|---|
| 6.1 | Wikipedia API helper（取得 + Workers Cache）| `workers/src/wikipedia.js` + テスト |
| 6.2 | Judge prompts（4 軸別: 事実正確性 / 具体性 / 季節整合 / 情報密度、Few-shot 込み）| `workers/src/judge_prompts.js` + テスト |
| 6.3 | Judge 統合（4 軸並列呼出 + スコア集約 + 文字数判定）| `workers/src/judge.js` + テスト |
| 6.4 | `/api/explain` への組込（再生成ループ + キャッシュ条件）| `workers/src/index.js` 修正 + 統合テスト |
| 6.5 | フロント UI 演出（段階表示）| `public/assets/api.js` / `app.js` / CSS |
| 6.6 | spec.md / knowledge.md / CLAUDE.md 更新 | docs |
| 6.7 | 本番デプロイ + 翌日実走検証 | wrangler deploy、S3 で `judge_passed` / スコア確認 |

### 10.7 やらないこと（スコープ外）

- 既存キャッシュの再評価・無効化（運用で発見次第手動対応）
- 評価フレームワーク（Ragas / promptfoo / LangSmith 等）の採用 → DIY で十分
- Judge を別ベンダー（OpenAI / Google）にすること → Anthropic 統一方針維持
- Web 検索 API（Brave / Google）による多源グラウンディング → Plan F 以降
- 満足度シグナル（dwell_ms 等）との相関分析 → S3 にデータが溜まってから別タスク
