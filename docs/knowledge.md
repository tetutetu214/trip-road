# trip-road 開発知見

本ドキュメントは開発中の決定事項・トレードオフ・ハマリポイントを蓄積する。セッションをまたいだ記憶の連続性を保つための重要文書。

---

## 1. ブレインストーミング決定事項（2026-04-22）

### 1.1 LLM プロンプト設計（B）

| 項目 | 決定 | 理由 |
|---|---|---|
| 口調 | 観光ガイド風、です・ます調 | てつてつが「行ってみたい」と思える情報重視 |
| 厳格さ | ハイブリッド | 歴史・名物は具体的、祭り日程は「例年◯月頃」で日付ハルシネーション回避 |
| 文字数 | 120〜180字 | 移動中に5〜8秒で読める密度 |
| キャッシュキー | `{市町村コード}_{季節}` | 同一 prompt の重複生成を防ぎ、かつ季節差は反映 |
| 失敗時 | 市町村名のみ表示 | 壊さない・騙さない・自動回復に任せる |

**判断軸**: 「情報重視だがハルシネーションは押さえたい」。PoC なので外部事実 API によるグラウンディングは行わず、プロンプト制約と免責表示で対応。

### 1.2 パスワード認証（C）

| 項目 | 決定 | 理由 |
|---|---|---|
| 利用者 | てつてつ1人（スマホ限定） | 身内向け PoC |
| 方式 | 単一パスワード + localStorage | Cloudflare Access より電波依存が少なく UX が安定 |
| 形式 | 32文字hex | 128bit エントロピーで実質ブルートフォース不能 |
| ヘッダー | `X-App-Password` | JWT 認証と混同しない明示的名前 |
| 比較 | 定数時間比較（crypto.subtle） | タイミング攻撃対策の作法 |
| 保管 | Workers Secrets | 環境変数より一段堅い |
| レート制限 | 不要 | 認証失敗時は Anthropic を呼ばないのでコスト被害ゼロ |

**判断軸**: 「URL踏み逃げ対策の柵」として十分なら良い。本格ユーザ認証ではない。

### 1.3 GPS 判定（D）

| 項目 | 決定 | 理由 |
|---|---|---|
| watchPosition | `enableHighAccuracy: true, timeout: 10000, maximumAge: 0` | speed-mater 踏襲、timeout のみ電車内想定で5→10秒に延長 |
| 判定頻度 | watchPosition ごと（約1秒） | P-in-P は1〜5ms で軽量、間引きメリットなし |
| 判定順序 | 現在 → 隣接ロード済み → GSI | 99%は現在市町村内なので最初の1発で終わる |
| GSI 発動 | 3条件（隣接ミス / 起動直後 / 連続3回不一致） | フォールバックとしての発動を最小化 |
| 振動対策 | なし | シンプル優先（PoC判断） |

**判断軸**: まずは動かす。振動問題が実走で顕在化したら対策を追加。

### 1.4 N03 前処理（E）

| 項目 | 決定 | 理由 |
|---|---|---|
| tolerance | 0.0005度（≈55m） | GPS 誤差レンジ内で体感影響ゼロ、サイズ1/5〜1/10 |
| 座標精度 | 小数5桁 | 1m 精度で十分、JSONサイズ10〜20%削減 |
| 保持プロパティ | N03_001/004/007 のみ | 不要属性を削ってサイズ削減 |
| 飛び地 | MultiPolygon 保持 | Turf.js が対応、特殊処理不要 |
| 政令指定都市 | 区単位 | 解説粒度を細かくしたいため |
| adjacency 生成 | touches ∪ intersects | 微小隙間での隣接ミスを拾う |

### 1.5 UI / PWA

| 項目 | 決定 | 理由 |
|---|---|---|
| 対象デバイス | iPhone のみ | 使用者の環境に特化 |
| ホーム画面追加 | スタンドアロンモード（apple-mobile-web-app-capable） | ネイティブアプリ風 UX |
| カラーベース | ダーク `#0f0f10`（当初の #1a1a1a から変更） | モックアップ採用、夜行列車内での目の優しさ優先 |
| アクセント | ティール系 `#5dcaa5` / `#9fe1cb` | 地図記号の森林・河川を想起、警告色回避 |
| レイアウト | モックアップ準拠（地図主役、下部に「土地のたより」） | memo.txt 3.6 より情報の視覚的優先順位が明確 |
| 解説テキストの呼称 | 「土地のたより」 | "Description" / "Info" の機能的ラベルより旅情表現を優先 |
| 追従モード | 常時 ON（ON/OFF ボタン無し） | memo.txt 3.4 の「ボタンで切替」から変更、PoC の UI をシンプル化 |
| アイコン | 仮置き「TR」→後日差し替え | PoC はデザインより動作優先 |
| デザインカンプ | `docs/design/trip_road_main_screen_mockup.html` を正とする | HTML フラグメントで CSS 実装時の値が直接抽出可能 |

---

## 2. トレードオフ記録

### 2.1 重要な「選ばなかった道」

- **Cloudflare Access（SSO）を採用しなかった**: Zero Trust は学習価値が高いが、スマホでCookie 切れ時の Google ログイン往復が不安定回線で詰まる懸念。PoC は単一パスワードで確実性を優先。フェーズ2以降で検討可能。
- **LLM を Wikipedia でグラウンディングしなかった**: 精度は上がるが、実装・レイテンシともにコスト増。PoC はプロンプト制約と免責表示で対応。
- **政令指定都市を市単位に統合しなかった**: 区単位で細かく判定することでファイル数が175増えるが、解説の粒度を細かく楽しめる方を優先。
- **境界振動対策を入れなかった**: 実装コストは小さいが、PoC ではシンプル優先。実走で問題出たら追加する。
- **Android 対応を一旦外した**: manifest.json は置くが、テストは iPhone のみ。Android は実機がない / 使用者が iPhone ユーザー。
- **モックアップを memo.txt 3.6 より優先した**: memo.txt では「市町村名 → 解説 → 速度 → 地図 → 制覇カウント」の縦並びだったが、モックアップは「地図主役＋上部フロートチップ＋下部カード」構成。後者のほうが情報の視覚的優先順位が明確で、旅アプリとしての性格（"いま自分がどこにいて、どう動いてきたか"）が強まる。仕様の原典を memo.txt から `docs/design/trip_road_main_screen_mockup.html` に切り替え。
- **追従 ON/OFF ボタンを撤去**: memo.txt 3.4 では追従切替ボタンが仕様だったが、PoC では常時 ON とする判断。電車・徒歩での通過用途では地図スクロールより自動追従が圧倒的に自然で、ボタン UI を追加する価値が低い。ユーザが地図を自由に操作したい要望が実機で出たらフェーズ 2 で復活検討。

### 2.2 「選んでよかったはず」の判断

- **speed-mater を流用ではなく参考にするに留めた**: speed-mater は独立したPoCとして完結している。上書きすると git 履歴が混乱する。単純なコピーで十分。
- **Vanilla JS で始めた**: 環境構築コストゼロで早期に動かせる。React 化はフェーズ4で検討。

---

## 3. 設計インサイト（ブレストで得た技術的学び）

### 3.1 アーキテクチャ
- Cloudflare Pages + Workers の2層構成は、バックエンドDB・認証サーバ・キャッシュ層という運用で死にがちな層が無く、個人開発で非常に堅牢。外部依存を限界まで減らす設計。
- localStorage 集約管理は 1ユーザ・1デバイス前提だからこそ成立。マルチユーザ化すると設計全体が崩れる。

### 3.2 セキュリティ
- APIキー隠蔽の定石: フロントから直接 Anthropic を叩かず、薄いプロキシを挟む。Workers Secrets にキーを置けばソースを覗かれても安全。
- 認証チェックを Anthropic 呼出の「前」に置くことで、ブルートフォース されても課金ゼロ。
- 定数時間比較（`crypto.subtle`）は PoC でも作法として入れる（コスト5行）。
- CORS は二重の防御。パスワードを知っていても別ドメインからは fetch できない。

### 3.3 LLM 運用
- Claude の得意領域（抽象的な文化・歴史）と苦手領域（具体的な日付・数字）を分離してプロンプトで制御する。
- キャッシュキーに入力パラメータをそのまま使うのは定石。Season × Municipality の2次元で重複生成を完全に防げる。
- 「情報は目安」の免責表示は LLM 時代前から定着している UI パターン。

### 3.4 空間演算
- Turf.js の booleanPointInPolygon は MultiPolygon を正しく扱える（飛び地対応不要）。
- 市町村移動は平均3〜10分、watchPosition は1秒。判定の99%は「同じ市町村」なので最初の一発で終わらせる順序が最適。
- 隣接プリフェッチは、境界越えの瞬間までに次のデータを用意する空間分割ロードのパターン。

### 3.5 データ処理
- tolerance 0.0005度（≈55m）は GPS 誤差レンジ内に収まる上限。
- 座標小数5桁に丸めるだけで JSON サイズが10〜20% 縮む。
- adjacency を touches だけで作ると川挟みで漏れる。intersects で微小バッファを足すのが実務的。

### 3.6 デザイン・UX
- "土地のたより" という和の呼称は、機能ラベル（Description / Info）から旅情ラベルに変えるだけで UX 全体の性格が変わる。小さな命名の差がプロダクトの"空気"を決める。
- ティール系アクセント（#5dcaa5）を軌跡と現在地マーカーに使うのは、グレースケール地図背景の中で「自分の線」を浮かび上がらせる優れた選択。信号色（赤・黄）だと警告感が出るので旅文脈には不適。
- glassmorphism（`backdrop-filter: blur`）は iOS Safari 15+ でサポート済。地図タイルの上に重ねると効果が出る。低スペック端末でスクロール時にカクつく可能性はあるが iPhone では問題なし。
- 純白 `#ffffff` ではなく `#f5f5f7` を使うと、ダーク背景でもコントラストが鋭すぎず目に優しい。Apple のシステムUI色選定と同じ考え方。
- 情報重複に見える「上部フロート市町村名」と「下部カード市町村名」は意図的な役割分離：フロートは常時視認用・カードは解説の主題タイトル。

---

## 4. ハマリポイント・注意事項

### 4.1 環境系（Phase 0-1 で実際にハマった・学んだこと）

#### npm グローバル install の権限エラー (WSL/Linux)

`npm install -g wrangler` が `EACCES: permission denied, mkdir '/usr/lib/node_modules/wrangler'` で失敗する。原因は Node.js が apt/snap でシステム領域にインストールされているため、一般ユーザから `/usr/lib/node_modules/` に書けない。

**解決**: `npm config set prefix '~/.npm-global'` で prefix をユーザ配下に変更し、`~/.bashrc` の PATH に `~/.npm-global/bin` を追加。sudo npm の手間と権限混在を避ける王道。

#### PEP 668 externally-managed-environment

Ubuntu / Debian 系の最近の Python は `pip install --user` もブロックする（PEP 668）。

**解決**: プロジェクト内 venv（`python3 -m venv .venv` → `source .venv/bin/activate`）を作成してそこに依存をインストール。`.gitignore` に `.venv/` 追加（既に登録済）。

#### NumPy 2.x + 古い shapely の ABI 不整合

`shapely==2.0.2` は NumPy 1.x ABI でビルドされており、NumPy 2.4.x 環境で import すると `AttributeError: _ARRAY_API not found` になる。また `geopandas==0.14.3` は `fiona.path` 非対応で `gpd.read_file` が失敗。

**解決**: `requirements.txt` を厳密 pin から範囲 pin に変更。`shapely>=2.0.6,<2.2` / `geopandas>=0.14.4,<2.0` で現代の NumPy 2.x と共存可能に。再現性よりも実用動作を優先する PoC の判断。

#### Bash 長コマンドの paste 事故

長いコマンド（80 文字以上、特に `\` で行継続するもの）をターミナルに paste すると、行継続が壊れたり空白が入り込んで引数分離が崩れる。何度 paste しても再発する。

**解決**: ラッパースクリプト化（`preprocess/run_*.sh`）。スクリプトにしておけば paste 事故が起きない上、再実行可能な資産として残る。`cd "$(dirname "$0")"` + `source .venv/bin/activate` + 本体コマンドのイディオムで、どこから呼んでも動く形に。

### 4.2 データ前処理の実測値（2026-04-23、ローカル WSL 実行）

| 指標 | 実測値 |
|---|---|
| N03-20240101 原本 zip | 583.12 MB |
| N03-20240101.shp 読込後 feature 数 | 約 21 万（全国） |
| 出力ファイル数（`out/municipalities/`） | 1,905（区単位込み） |
| 合計サイズ | 32 MB |
| 最大単ファイル（推定） | 数百 KB（北海道の広域市町村） |
| `adjacency.json` | 96 KB、1,852 エントリ |
| 隣接マスタ漏れ（1905 - 1852 = 53） | 離島・飛び地（北山村など） |
| `split_and_simplify.py` 実行時間 | 約 15〜30 分（WSL、家庭 PC） |
| `build_adjacency.py` 実行時間 | 約 3〜5 分 |
| Cloudflare Pages デプロイ | 1,906 ファイル・41 秒（初回） |

#### Cloud Shell は不要だった

Plan A では Google Cloud Shell を推奨していたが、ローカル WSL で十分実行可能。帯域・CPU・メモリとも家庭 PC で問題なし。再クローン不要・既存の venv をそのまま使えるので、ローカル実行の方が効率的だった。「Cloud Shell / CI / ローカル」の選び方は、動く環境がある場所を使うのが一番早い、という教訓。

#### N03 zip の内部構造変動

`download_n03.sh` は「zip 内に `N03-20240101_GML/` というフォルダがある」と想定して書かれていたが、**実際はフラット展開**（tmp/ 直下に `.shp` `.dbf` 等が並ぶ）だった。`ls -la "N03-20240101_GML/"` が `No such file or directory` で失敗。処理本体には影響なし（`split_and_simplify.py` への `--input` パスは `tmp/N03-20240101.shp` で動く）。

**教訓**: 外部配布データの zip 構造は年次で変わりうるので、スクリプトは `find tmp/ -name "*.shp"` のように動的に見つける方が堅牢。Phase 2 以降での改善候補。

### 4.3 Cloudflare Pages の ブランチ/デプロイの仕組み

`wrangler pages deploy` は現在の git ブランチ名を読み取り、production branch 以外の場合は preview deployment として扱う。結果、`<project>.pages.dev`（production URL）ではなく `<branch>-<project>.pages.dev` や `<sha>.<project>.pages.dev` にのみデプロイされる。

**解決**: `--branch=main` を明示してデプロイすると production として扱われ、`<project>.pages.dev` に反映される。`--commit-dirty=true` も付けておくと「未コミットの変更あり」警告を抑制（PoC の一時的な未コミットファイル対策）。

### 4.4 認証系・Workers（Phase 2 で追加）

#### Web Crypto API による定数時間比較

Node の `crypto.timingSafeEqual` は Workers ランタイムに無い。代替として `crypto.subtle.digest('SHA-256', ...)` で両者を固定長 32 バイトに変換してから XOR 比較。ショートサーキットしない for ループで各バイトを `|=` する実装が定石。`auth.js` の `timingSafeEqual` 関数として実装、6 テストで検証。

#### wrangler dev のローカル Secrets: `.dev.vars`

本番は `wrangler secret put` で登録するが、ローカル開発は `.dev.vars` ファイルで環境変数を注入する。`.gitignore` で除外必須。`setup_dev_vars.sh` が `~/.secrets/trip-road.env` から自動生成する仕組みを用意。

#### Anthropic Messages API の直接 fetch

SDK 不使用で `fetch('https://api.anthropic.com/v1/messages')` を直接呼ぶ。ヘッダは `x-api-key`, `anthropic-version: 2023-06-01`, `content-type`。レスポンスは `data.content[0].text` に生成テキスト。Workers のバンドル制限（7.34 KiB → 2.66 KiB gzipped に収まった）を避けられる。

#### Workers サブドメインの仕組み

Cloudflare アカウントに 1 つの `<subdomain>.workers.dev` が割り当てられ、すべての Worker は `<worker-name>.<subdomain>.workers.dev` で公開される。今回のアカウントでは `lemoned-i-scream-art-of-noise` が初回 deploy 時に自動決定（email prefix 由来、ドットはハイフン化）。一度決まったら永続。

- 本番 Worker URL: `https://trip-road-api.lemoned-i-scream-art-of-noise.workers.dev`（既存、残置）
- **独自ドメイン版**（Phase 2 後に追加）: `https://trip-road-api.tetutetu214.com`

#### 独自ドメイン（tetutetu214.com）への移行

Plan C 作成前に、teutetu214 が保有していた Cloudflare 管理下ドメイン `tetutetu214.com` のサブドメインを Pages / Workers に紐付けた。

- `trip-road-data.tetutetu214.com` → 既存 Pages `trip-road-data`（Dashboard で Custom domain 追加）
- `trip-road-api.tetutetu214.com` → 既存 Worker `trip-road-api`（Dashboard で Custom domain 追加）
- `trip-road.tetutetu214.com` → Plan C フロント（Phase 4 で紐付け予定）

Cloudflare 管理下ドメインなので、ネームサーバー変更不要で DNS + SSL + ルーティングが Dashboard クリック操作だけで完結。設定〜Active まで 1 分程度。既存の `*.pages.dev` / `*.workers.dev` URL は残置（両方から同じサービスにアクセス可能）。

これに伴い Workers の `ALLOWED_ORIGIN` を `https://trip-road.pages.dev` から `https://trip-road.tetutetu214.com` に更新（`update_allowed_origin.sh`）。Plan C のフロントは独自ドメイン前提で実装される。

#### `wrangler secret put` の transient error と idempotency

Cloudflare API の一瞬の瞬断で `fetch failed` が発生することがある（2 件目の secret 登録で実際に発生）。`wrangler secret put` は同じキー名で何度呼んでも最新値で上書きされるだけなので、**スクリプト再実行で復旧可能**。ネットワーク確認は `curl -v https://api.cloudflare.com/` で HTTP 301 が返れば OK。

#### `printf '%s'` vs `echo -n`

Secret 値を stdin で渡す時、`echo -n` はシェル実装差（sh、dash で挙動が変わる）があるため、`printf '%s'` が POSIX で確実。パスワードに余計な改行が混ざる事故を防ぐ。

#### `workers_dev` と `preview_urls` のデフォルト挙動

wrangler 4.x は `wrangler.toml` に `workers_dev` / `preview_urls` が未指定だとデフォルト有効。警告が出るが PoC では問題なし。本番運用で preview を無効化したい場合は明示する。

#### ラッパースクリプト群（Phase 2）

Plan A 同様、paste 事故回避と再実行可能な資産化のため以下を追加:
- `workers/setup_dev_vars.sh`: ~/.secrets/ から .dev.vars を安全に生成
- `workers/test_api_local.sh`: ローカル wrangler dev に対する 4 ケース E2E テスト
- `workers/deploy_production.sh`: Secrets 登録 + deploy + 本番 E2E テストを 1 本化

### 4.5 GPS・判定系・フロント実装（Phase 3-4 で追加）

#### iPhone Safari の Geolocation 挙動

- 初回 `watchPosition` 呼出で iOS が「位置情報の使用を許可しますか？」ダイアログ表示
- 許可後は `coords.speed` が m/s で取得される（停止中は null か 0）
- WiFi 三角測量 → GPS 衛星測位の順に精度が上がる
- iPhone 実機で 5〜20m 精度
- WSL の PC ブラウザでも HTTPS 経由なら Geolocation API が動作する（Google Geolocation API による WiFi 推測）

#### Leaflet + 地理院タイルの組み合わせ

- `https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png` で淡色地図
- `attributionControl: false` で標準クレジット非表示にし、自前で「出典：地理院タイル」を右下配置
- `zoomControl: false` で追従モード固定運用、ズームコントロール非表示
- ティール `#5dcaa5` の SVG divIcon で現在地マーカー、軌跡ポリラインも同色

#### iPhone Safari + Leaflet のバックグラウンド復帰問題

- アプリを最小化 → 復帰すると `viewport` が一時的にずれて、地図要素の高さが膨張
- 結果として上部チップ（市町村名・制覇カウント）が地図に隠れる
- **解決策**: `map.js` の `initMap` 内で `visibilitychange` / `pageshow` / `resize` / `orientationchange` イベントに `setTimeout(100ms) → map.invalidateSize()` を登録
- `setTimeout` は CSS 再計算完了を待つため

#### CORS と独自ドメイン

- ローカル `http://localhost:8000` は Workers の `ALLOWED_ORIGIN=https://trip-road.tetutetu214.com` と一致しないため LLM 呼出が CORS エラー
- 独自ドメイン `trip-road.tetutetu214.com` から fetch すれば CORS 通過
- ローカル動作確認は「LLM 以外は動く」状態で十分（Plan C Task 13 の想定通り）

#### Cloudflare Pages の deduplication

- `wrangler pages deploy` 時、同一ハッシュのファイルは「Uploaded 0 files (N already uploaded)」と表示され再アップロードされない
- ファイル変更後でも別の場所で同内容が既にあれば「0 files」になることがあるが、本番には新版が反映されている（diff で検証可）

#### Playwright + WebKit 依存

- iPhone 13 Pro 等の Apple device profile は WebKit エンジンを要求
- Linux 環境では `npx playwright install-deps webkit` で sudo インストールが必要
- 代替策: Chromium で iPhone viewport（390x844、isMobile、hasTouch、UA）をエミュレート
- 実 Safari ではないが PoC E2E 検証には十分

#### wrangler の git commit message UTF-8 エラー回避

- 非対話シェルで `wrangler pages deploy` 実行時、日本語の git commit message が "Invalid commit message, it must be a valid UTF-8 string" で弾かれることがある
- 対策: `--commit-message="ASCII text"` を明示指定

#### deploy_frontend.sh の PATH 補強

- 対話シェルなら `~/.bashrc` の export で `~/.npm-global/bin` が PATH に入るが、非対話シェル（CI や Claude の Bash ツール）では入らず `wrangler: command not found`
- スクリプト冒頭に `export PATH="$HOME/.npm-global/bin:$PATH"` を追加してポータブル化

#### Phase 3-4 実機/E2E 検証結果

- **iPhone Safari 実機（実走）**: パスワード認証・地図描画・GPS マーカー・速度表示・市町村切替・Anthropic 生成テキスト・軌跡描画・ホーム画面追加・スタンドアロン起動すべて成功
- **Playwright E2E（Chromium iPhone エミュ、本番ドメイン）**: 4 シナリオ全 pass（パスワード画面、disabled 制御、フル E2E、visibilitychange バグ修正検証）
- **生成テキスト品質**: 観光ガイド口調、170 字、具体的地名（利根川・古利根川・宿場町）、春の季節感（桜並木・新鮮な野菜・山菜）、日付なし、商業表現なし

---

## 4.X レイアウト：下部カードの3層バグ修正（2026-04-27〜2026-04-29）

スクリーンショット解析により、下部カード周辺に **3 層構造のレイアウトバグ** が併存していることが判明。1 層目だけ直しても次の層の症状が前面化するため、最終的に全層に同時対処した。1 層目・2 層目は 04-27 に対処、3 層目（safe-area 食い違い）は実機 Safari でだけ症状が残ったため 04-29 に追加対処。

### バグ1：地図ラベルがカード不透明部分で見切れる

**症状**: スクショ上で地理院タイル上の地名ラベル（例：座間市）の文字が、カード上端付近に視覚的に隠れて見える。

**原因**: `app.css` で地図とカードの高さ関係がハードコード前提だった。

- `.map { bottom: 320px }`（地図下端を 320px 固定）
- `.bottom-card` は高さ指定なし、コンテンツ依存
- `.map-attribution { bottom: 332px }`（320px 前提）

LLM 出力（`spec.md` 5節で 120〜180 字）が長文になると、カード実高が 350〜500px に達し、地図の下端 320px ラインを超える。`.bottom-card` の不透明背景がはみ出して地図ラベル領域を物理的に覆う。

**修正**: ResizeObserver + CSS 変数 `--card-height` でカード実高に動的追従。

```css
:root { --card-height: 320px; }  /* フォールバック */
.map { bottom: var(--card-height); }
.map-attribution { bottom: calc(var(--card-height) + 12px); }
```

```js
// map.js initMap 内
const card = document.querySelector('.bottom-card');
const ro = new ResizeObserver(() => {
  document.documentElement.style.setProperty('--card-height', `${card.offsetHeight}px`);
  map.invalidateSize();
});
ro.observe(card);
```

### バグ2：muni-row 上半分が透明グラデーション越しに地図透けで消える

**症状**: 「相模原市」が下半分しか見えない。`-- km/h` の `--`（中央線記号）が完全に消える。

**原因**: `.bottom-card` の背景グラデーションが **% 比率指定** だった。

```css
/* 旧: 不透明境界が 14% × カード高さ で可変 */
background: linear-gradient(180deg, rgba(15,15,16,0) 0%, var(--color-bg) 14%, var(--color-bg) 100%);
```

| カード高さ | 不透明境界 | muni-row top（card top + 50px） |
|---|---|---|
| 320px | 45px | 50px → ほぼ opaque ✓ |
| 350px | 49px | 50px → ぎりぎり ✓ |
| 500px | **70px** | 50px → **20px transparent ゾーン内** ✗ |

長文時に muni-row が透明グラデーションに入り、後ろの **地理院淡色地図（白っぽいタイル）** が透けて、白系文字が白系背景に乗ってコントラスト不足で消える。下半分は不透明領域に達するので見える。

**修正**: グラデーションのストップを **px 固定** に変更。

```css
/* 新: 44px 固定で不透明化、muni-row top（50px）の手前で必ず opaque */
background: linear-gradient(180deg, rgba(15,15,16,0) 0px, var(--color-bg) 44px, var(--color-bg) 100%);
```

### バグ3：`.bottom-card` の `bottom: env(safe-area-inset-bottom)` と `.map` の `bottom: var(--card-height)` の食い違い（2026-04-29 追加）

**症状**: バグ 1・2 修正後も、iPhone Safari 実機（home indicator 機種）で「相模原市」と `-- km/h` の **上半分が地図タイルに同化して消える** 事象が継続。PC ブラウザのレスポンシブ確認では再現せず、実機でだけ顕在化。

**原因**: card と map の bottom 基準がズレていた。

```css
.bottom-card { bottom: env(safe-area-inset-bottom, 0); }  /* 画面下から 34px 浮く */
.map         { bottom: var(--card-height); }              /* card.offsetHeight だけ上げる */
```

`map.js` の ResizeObserver は `card.offsetHeight` を `--card-height` に書く。だが `card.offsetHeight` は **card 自身の高さだけ**で、env による底上げ分（safe-area-inset-bottom ≒ 34px）は含まない。

| 項目 | 画面下からの y |
|---|---|
| card 視覚上端 | `card.offsetHeight + 34px`（高い） |
| map 下端     | `card.offsetHeight`（低い） |

→ map が card 上端より **34px 分はみ出している**。card 上端の 0〜44px は透明グラデなので、その重なり領域は地理院淡色タイル（白系）が透けて、白系の muni-row 文字が背景に同化する。さらに iPhone Safari は Leaflet タイルを GPU 合成レイヤーに上げる挙動があり、z-index の効き方が PC と異なるため実機限定で顕在化した。

**修正**: card を `bottom: 0` に張り付け、safe-area は `padding-bottom` で吸収する。これで `card.offsetHeight` に safe-area 分が含まれるようになり、`--card-height` を介した map との辻褄が合う。

```css
.bottom-card {
  bottom: 0;
  padding: 28px 20px calc(20px + env(safe-area-inset-bottom, 0));
}
```

### 教訓

- **可変長コンテンツ × 比率指定の組み合わせは罠**。コンテンツが特定の長さのときだけ顕在化するので、PoC 段階のテストでは見逃しやすい。短文・中文・長文の 3 ケースで必ず実機確認する。
- **多層バグの構造**: バグ 1（地図ラベル隠れ）を直すと、隠れていたバグ 2（muni-row 透け）の症状条件が変わる。バグ 2 を直しても、バグ 3（safe-area 食い違い）は **実機でしか出ない**ので PC では「直った」と勘違いしやすい。1 層目だけ直して終わりにせず、症状が完全に消えたか実機で確認するまで掘る必要があった。
- **絶対配置で 2 要素の境界を揃える時は基準を 1 つに統一する**。card と map の両方が `bottom` で位置決めしている時、片方に env を入れると `offsetHeight` には反映されないため、CSS 変数経由で連動させても辻褄が崩れる。env 系は **片側に集約**（今回は padding-bottom 側）するのが安全。
- **スクショは決定打**: 文字列で症状を聞くだけだとループしやすい。「`-- km/h` の `--` が消えて `km/h` だけ見える」という事実は、スクショで一発で分かった。今後デバッグで詰まったらまず実画面を見る。
- **PC レスポンシブ ≠ iPhone 実機**: GPU 合成レイヤーや safe-area の挙動は実機固有。UI バグは「PC で再現しないなら実機で見る」を即決すべき。
- **過剰な安全マージンは UX を損なう**: バグ 2 修正時に drag-handle の `margin-bottom` を 18px → 60px と過剰に取ったが、44px の gradient 境界に対して必要なのは padding-top(28px) + drag-handle高さ(4px) を引いた 12px 以上だけ。実機確認後 20px に詰め直し（2026-04-29、muni-row top 52px、安全マージン 8px）。bug fix の数値は「動く最小値 + 数 px の余裕」が原則で、不安からくる大きすぎる値は次の改善で必ず巻き戻す。

---

## 4.7 テレメトリ + AWS S3 Sink + LLM 分析（2026-04-26〜27、Plan D）

### 全体構成

GPS 移動 → 市町村判定 → Haiku 生成のたびに entry を localStorage に積み、
市町村切替の瞬間に Workers `/api/telemetry` 経由で AWS S3 に PUT する。
S3 に溜まったデータは `docs/analysis/fetch_entries.sh` でローカル JSONL に集約し、
Claude（claude.ai or API）に貼って自然言語で分析する。

### Cloudflare ↔ AWS マルチクラウドの繋ぎ方

- フロント・API は Cloudflare、データ分析は AWS という棲み分け
- Workers から S3 PUT は `aws4fetch`（5KB の Workers 互換ライブラリ）で SigV4 署名
- IAM ユーザ `trip-road-telemetry-writer` は当初 `s3:PutObject` のみの最小権限
- 後に analysis 用途で `s3:ListBucket` / `s3:GetObject` / `s3:DeleteObject` を追加。
  Worker は変わらず PutObject だけ使うが、同一ユーザに権限集約してシンプルに保つ判断
  （別ユーザ作成も検討したが PoC 規模ではオーバーヘッドが上回る）

### S3 partition layout の選択

`year=YYYY/month=MM/day=DD/<uuid>.json` 形式。当初は Athena の partition projection で
WHERE 句最適化する想定だったが、LLM 分析方式に切り替えても日付ベースのプレフィックスは
sync 単位や絞り込みにそのまま使えるので維持。

### dwell_ms 暗黙シグナルの限界（実走で判明）

実機で iPhone 持って旅して気付いたこと：

- ユーザ（てつてつ）は description を集中して読んで離脱判断するわけではなく、
  画面開きっぱなしで次の街に移動する、別作業に切り替えるなどの外的要因で離脱する
- つまり `dwell_ms` は「読書時間」ではなく「画面表示時間」になり、品質シグナルとして弱い
- 「dwell_ms < 3 秒 = つまらなかった」「dwell_ms > 30 秒 = 面白かった」という
  当初の閾値解釈は実態と乖離する

**設計上の影響**: 当初 Plan D の暗黙シグナル中心戦略の前提が揺らいだので、
分析プロンプトでは LLM に「dwell_ms はノイズが多いので結論を急がない」と明示的に
伝える方針にした（`docs/analysis/prompts.md` 冒頭）。

### Athena → LLM 分析への方針変更

当初 Stage 3 は Athena テーブル DDL + サンプル SQL を作る計画だった。
しかし実走で以下が判明し方針変更：

1. trip-road は個人 1 ユーザなので、月の蓄積件数が 100 件程度。Claude の
   1M context window の 1% にも満たない → 全件 LLM に渡せる
2. 「春野菜」のような汎用フレーズの検出は SQL では書きづらいが、自然言語で
   「汎用的な使い回し表現を抽出して」と頼めば一発
3. Athena のテーブル DDL / partition projection / SerDe / クエリ結果保存先 S3 の
   セットアップが PoC スケールには重い

**判断**: Athena は「データが TB 級になったとき」のスケーラビリティ保険であって、
個人 PoC では LLM 単独分析の方が学習効果・実装コストとも有利。

### Telemetry 自動 flush の閾値設計（修正履歴あり）

当初実装：「localStorage に 10 件以上溜まれば 60 秒ごとにバッチ送信」。
→ 実走でユーザ指摘「1 セッションで 10 市町村も移動しないことが多い、これでは
ほぼ送信されない」。

修正実装：閾値を 1 に下げ、市町村切替の `finalizeCurrentTelemetry()` 直後に
直接 `tryFlushTelemetry(password)` を呼出すよう変更（2026-04-27 commit `86daa8d`）。

- 結果: 確定 entry はほぼリアルタイムで S3 に届く
- localStorage は送信失敗時の再送保険として残置
- 60 秒タイマーは未送信のリトライ用に残置（電波切れ時の保険）

### Critic（自己評価）は未導入の判断

Plan D の `buildTelemetryEntry` には `critic_accuracy` / `critic_meaningfulness` /
`critic_density` の 3 フィールドが用意されているが、すべて null 初期化のまま。
実装は意図的に Plan E に持ち越した。

**理由**: Critic を先に入れると「LLM が LLM を評価する閉じたループ」になり、
スコアの正当性を検証する基準が無い。先に **人間の実反応データ（dwell_ms など）**
を S3 に貯めておけば、Critic 導入時に「Critic スコアと人間反応の相関」を後から
検証できる。

ただし上述のとおり dwell_ms の信号強度が弱いと判明したので、Critic 導入の必要性が
むしろ上がった。Plan E で実装予定。

### LLM 評価ツールエコシステムを採用しない判断

Ragas / LangSmith / promptfoo / Arize Phoenix / W&B / Galileo 等を検討したが、
trip-road 個人 PoC スケールでは以下の理由で全部見送り：

- Ragas: trip-road は RAG ではない（document retrieval していない）→ メトリクスが NA
- LangSmith / Galileo / W&B: SaaS、ベンダーロックイン、月数百件規模ではオーバースペック
- Arize Phoenix: OSS だが別サーバ立てる手間が PoC には重い
- promptfoo: 唯一相性が良いが、本格的なプロンプト改善 iteration に入るタイミング
  （Plan F 以降）で導入するのが筋

**判断**: 既存の Workers + Anthropic API + S3 という配線に乗っかって DIY で
Critic を組み込む方が、依存とコストの両面で最小。

### IAM access key 漏洩・ローテーション対応（教訓）

シークレット値の確認時、`grep | sed 's/=.\{4\}/=****/'` のような「先頭 4 文字置換」型の
マスクを使うと、AWS_SECRET_ACCESS_KEY（40 文字）の場合は 36 文字が露出する。

**対応**: IAM で新キー発行 → ローカル env 更新 → Workers Secrets 更新 → 本番疎通確認 →
旧キー削除、の順序でダウンタイムなしローテーション。`shred -u` でローカルバックアップも削除。

**再発防止**: シークレット値の出力は「行数チェック / 長さチェック / 先頭 4 文字（≒固定 prefix）
だけ表示」に留めること。Claude Code 側のメモリにも記録（`feedback_secret_masking.md`）。

---

## 4.X 二十四節気への移行（2026-04-29）

### 4.X.1 経緯と動機

初版は `getSeason()` で 4 季節（spring/summer/autumn/winter）に分類していたが、
「春」だけでは早春・春分・晩春の差が伝わらず、その土地の旬や景色を語る粒度として粗い、
という課題があった。てつてつの要望で、二十四節気で季節感を表現するように変更。
あわせてプロンプトに「具体的な地名・歴史的背景・地形的特徴」を促すルールを追加した。

### 4.X.2 主要決定

| 項目 | 決定 | 理由・トレードオフ |
|---|---|---|
| 識別子 | 二十四節気の番号文字列 `'01'`〜`'24'` | ローマ字（risshun 等）よりタイポリスクが少ない。番号は立春=01 から年内昇順に振った |
| 境界判定 | 太陽黄経ではなく「固定の月日テーブル」で近似 | 年により ±1 日のずれはあるが、旅情アプリでは体感差が無く、保守・テストが極めて簡単 |
| キャッシュ粒度 | 節気ごとに別キャッシュ（24分割） | 季節感を真に反映するため。デメリットは Anthropic API 呼出が最大 6 倍に増えるが、PoC 段階では許容 |
| 字数 | 既存の 120〜180 字を維持 | 「全部書こうとせず書ける範囲だけ書く」をプロンプトに明示し、収まらなければ要素を絞らせる |
| プロンプト方針 | 必須は節気の季節感のみ、地名・歴史・地形・名物は確信を持って書ける範囲だけ | 「全部を満たす都市があると思えない、ないものは書かなくていい」というてつてつの判断（既存の「確信が持てない情報は書かない」原則と一貫） |
| 旧キャッシュ | localStorage の旧 `descriptions: {spring,summer,…}` は移行せず自然消滅 | PoC 段階で利用者が1人なので、互換コードを書くより捨てるほうが簡単 |

### 4.X.3 影響範囲

- フロント: `season.js`（getSolarTerm 新設）、`cache.js`、`storage.js`（descriptions を可変キーに）、`app.js`、`api.js`、`telemetry.js`（フィールド名 `season` → `solar_term`）
- Worker: `anthropic.js`（SOLAR_TERM_MAP、parseDescribeRequest、System prompt 全面改訂）
- API: `POST /api/describe` のフィールド名 `season`→`solar_term`、値は `'01'`〜`'24'`
- テレメトリ entry のフィールド名も `season`→`solar_term` に変更（旧データとの混在は PoC 段階で許容）

### 4.X.4 ハマりポイント・要注意

**1/1〜1/5 は前年の冬至期間扱い**: 二十四節気の「冬至」は 12/22 から始まり翌年 1/5 まで続く。
`getSolarTerm()` は年内の節気テーブルを線形に走査するが、入力が 1/1〜1/5 のときはテーブルの
最小値（1/6 小寒）に届かないため、初期値として 22（冬至）を返すように実装している。

**境界日の年差**: 二十四節気は太陽黄経で決まるため、実際は年により 1 日ほど前後する。
本実装は固定値で近似しており、ぴったり境界日に走るときは公式と 1 日ずれる可能性がある。
旅情アプリとしては許容範囲、精度を上げる場合は太陽黄経計算ライブラリに切り替える。

---

## 4.8 Plan E / Phase 6.1 Wikipedia API helper（2026-05-03）

Judge 軸 1（事実正確性）の RAG 用に Wikipedia から市町村記事の intro を取得する `workers/src/wikipedia.js` を実装した。Plan E 全体（Wikipedia → Judge 4 軸 → 再生成ループ）の最初のレンガ。

### 4.8.1 設計の要点

- 純粋関数（`buildWikipediaUrl` / `parseWikipediaExtract` / `cleanExtract` / `resolveWikipediaTitle` / `buildCacheKey`）と副作用関数（`fetchWikipediaExtract` / `getCachedWikipediaExtract`）を明確に分離。テストは純粋関数中心、24 ケース pass
- fetch / Cache API は引数注入で差し替え可能にしたが、Cloudflare Cache API はローカル再現が難しいので統合動作は wrangler dev / 本番で確認する方針（既存の anthropic.js も同流儀）
- User-Agent は Wikipedia の Etiquette に従い識別可能な文字列（`trip-road/1.0 (https://github.com/tetutetu214/trip-road; tetutetu214@github)`）を必ず付ける
- Cache TTL 30 日、キーは `https://wikipedia-cache.internal/<muni_code>` のダミー Request

### 4.8.2 実 API 検証で発見した重要な落とし穴

サンプル 6 市町村（相模原市・緑区・新宿区・海老名市・座間市・綾瀬市）で実 API を叩いて挙動確認した結果、2 つの重要な問題が判明：

**(1) 曖昧さ回避ページ問題（致命度: 中、対応済）**

「緑区」だけで検索すると `redirects=true` を付けても**曖昧さ回避ページ**にヒットし、extract として「緑区（みどりく）」のたった 8 字しか返ってこない（緑区は横浜・千葉・相模原・さいたま・名古屋に存在）。この極端に短い extract が `null` ではなく値として返ってしまうと、Sonnet judge に「Wikipedia 情報なし」とは別の「ほぼ空の extract」が渡って判定が暴れる。

対策: `parseWikipediaExtract` 内で「extract に句点（`。`）を含まない場合は null とみなす」判定を追加。Wikipedia 正常記事の intro は通常句点を含むため、曖昧さ回避ページや読み仮名のみのスタブを安全にフィルタできる。

**(2) 政令指定都市の区への redirect 慣習がバラバラ（致命度: 中、要追加対応）**

実検証で発見：
- **redirect あり**: `大阪市北区` → `北区 (大阪市)`、`札幌市中央区` → `中央区 (札幌市)`
- **redirect なし**: `相模原市緑区` / `横浜市西区` → どちらも missing

つまり結合形式が市ごとに動いたり動かなかったりする。Wikipedia 編集者の慣習依存。

さらに、現在のフォールバック `{municipality} ({prefecture})` は「緑区 (神奈川県)」を作るが、Wikipedia 上の正式タイトルは「緑区 (相模原市)」「緑区 (横浜市)」のように **親市名カッコ付き** なので、これも missing で取れない。

現状の対応：政令市の区については Wikipedia extract = null となり、Judge 軸 1 は spec.md 10.6 の通り「Wikipedia 情報なし前提で評価（保守的に高得点傾向）」となる。fail-open 動作なので致命的ではないが、軸 1 の精度は下がる。

**今後の対応案（6.7 までの間に検討）**: フロントから N03_003（郡・政令市名）も送ってもらい、Worker 側で `${区} (${親市})` 形式のタイトルを構築する。spec.md API 仕様の小改訂が必要。

### 4.8.3 非問題（spec.md 通り動いた箇所）

- 通常市町村（海老名市・座間市・綾瀬市）：`municipality` そのままでヒット、extract 37〜84 字
- 東京特別区（新宿区・渋谷区）：`municipality` そのままでヒット、extract 200 字程度
- `[1]` 等の参考文献記号除去・1500 字切り詰め：cleanExtract で対応（実 intro には [n] が見当たらず、ガードとして残す）

### 4.8.4 テストの組み立て上ハマったところ

- `URLSearchParams.toString()` のエンコードは `encodeURIComponent` と差がある（`(` `)` を非エンコード、スペースを `+` に変換）。Wikipedia API はどちらも受理するので動作は問題ないが、テストで生 URL 文字列の expect 比較をすると壊れる。`new URLSearchParams(url.split('?')[1])` でパースしてからデコード後の値を比較する方式に統一

---

## 4.9 Plan E / Phase 6.2 Judge prompts 構築（2026-05-03）

Sonnet 4.6 を 4 軸並列で叩くためのプロンプト構築関数群 `workers/src/judge_prompts.js` を実装した。すべて純粋関数。Phase 6.3 の judge.js で `Promise.all` で並列呼出する材料が揃った。

### 4.9.1 設計の要点

- 共通プリアンブル + 軸別差分 + Few-shot + 末尾「採点してください」の四段構成。`buildCommonPreamble` を共通関数にし、4 軸関数はそれを呼んで先頭に置くだけ
- プロンプトの本文は spec.md 10.3 章のテンプレをほぼそのままハードコード。Few-shot もハードコード（カリブレーション例は頻繁に変えるものではない）
- 出力した実プロンプトの長さは軸 1 で約 1247 文字、軸 3 で約 1027 文字。Sonnet コンテキストウィンドウに対して十分小さい

### 4.9.2 SOLAR_TERM_META の二重持ち判断（重要）

既存 `workers/src/anthropic.js` には `SOLAR_TERM_MAP`（番号 → 名前のみ）があり、judge 側で必要な `period`（例: 「4月5日頃〜穀雨前」）は持っていない。この設計判断で 2 案あった：

- 案 A（採用）: judge 側に `SOLAR_TERM_META`（{name, period}）を新設、anthropic 側はそのまま
- 案 B: anthropic の SOLAR_TERM_MAP を {name, period} に拡張して両者が import

**案 A 採用理由**: generator 側の system prompt に period を埋め込む計画はないので、anthropic.js の SOLAR_TERM_MAP に period を持たせるのは責務違反。重複コストはマップ 24 行 × 1 ファイル分だけで、可読性のメリットが上回る。

将来 generator にも period が必要になったら、共通モジュール `workers/src/solar_term.js` を切り出して両者が import する形にリファクタする。

### 4.9.3 Wikipedia null 時の軸 1 プロンプト差し替え

`buildFactualityPrompt` は `wikipediaExtract === null | undefined | ''` の 3 ケースで Wikipedia ブロックを差し替える：

```
【Wikipedia 抜粋】
（情報なし。Wikipedia 抜粋が取得できなかったため、明確な事実誤認が見当たらない場合は減点しないこと。
Wikipedia 由来の根拠を欠く記述があっても、地理常識として明らかな矛盾がない限り保守的に評価する。）
```

これは spec.md 10.6 章「Wikipedia 情報なし前提で評価（保守的に高得点傾向）」を実装に落としたもの。fail-open 動作で、政令市の区など Wikipedia が引けない市町村でも軸 1 が極端な低スコアにならないようにする狙い。

Few-shot 例は null ケースでも残す（Wikipedia ありの理想例として「こういう書き方なら 5 点」のキャリブレーションは null でも有効、と判断）。

### 4.9.4 実 entry を入れたプロンプトの目視確認

5/3 取得テレメトリの海老名市 entry（節気=春、本文に「春には桜が淡紅色に染まり」「宿場町として栄えた」「淡紅色」など）を立夏（07）の節気でプロンプト化したところ：

- 軸 3（季節整合）: 「春には桜が」が立夏（5月中旬〜下旬）と矛盾するので減点対象として認識される構造
- 軸 4（情報密度）: 「淡紅色に染まり」「相模野では新鮮な野菜」など情緒修飾と汎用フレーズが Few-shot 例 B と類似、低スコア検出見込み

Plan E の必要性が実プロンプトレベルで裏付けられた。

---

## 4.10 Plan E / Phase 6.3 Judge 統合（2026-05-03）

4 軸並列 Judge + スコア集約 + 文字数判定 + fail-open のメインフロー `workers/src/judge.js` を実装。Phase 6.4 で `/api/describe` から `judgeAll` を呼び出すための材料が揃った。

### 4.10.1 公開 API

- `parseJudgeResponse(text)`: Sonnet 出力 → `{score, deductions, notes}` 抽出（純粋関数）
- `aggregateScores(judgments)`: 4 軸結果 → `{passed, scores, deductions}` 集約（純粋関数）
- `callJudge(axis, params, env, fetchFn?, sleepFn?)`: 1 軸を Sonnet に投げる + リトライ + パース
- `judgeAll({...})`: 文字数 → Wikipedia → 4 軸並列 → 集約

### 4.10.2 callJudge / judgeAll もテスト対象に含めた判断

6.1 / 6.2 の流儀（fetch を直接叩く関数は手動 wrangler 確認、純粋関数だけテスト）を 6.3 では一部破った。理由：
- 文字数早期リターン・並列呼出・aggregate ロジック・fail-open の 4 種類の分岐が同居しており、純粋関数だけのテストでは結合動作が保証できない
- `fetchFn` / `wikipediaFetcher` / `judgeRunner` / `sleepFn` を引数注入できる設計にすればモック差し替えだけで結合テストが書ける（外部 I/O ゼロで高速）
- `judgeRunner` を引数で受け取る形にしておくと、judgeAll 単体では callJudge を呼ばずに任意のスコアを返すスタブで挙動確認できる → 軸ごとのスコアパターンを網羅しやすい

### 4.10.3 Sonnet レスポンス JSON の抽出戦略

プロンプトで「JSON のみ出力」と指示しても、Sonnet は前後に説明文を付けてくる癖がある。`parseJudgeResponse` は `\{[\s\S]*\}` で最初の `{...}` ブロックを正規表現で抽出してから `JSON.parse` する。これで以下が安全に処理できる：

- 「はい、評価します。\n{...}\n以上です。」のような前後の挨拶
- 不正 JSON（trailing comma 等）→ catch して null
- スキーマ不正（score なし、score が範囲外、deductions が配列でない、notes が文字列でない）→ null

null を返した軸は `aggregateScores` で fail-open に倒される（passed=null）。

### 4.10.4 リトライ戦略

429（レート制限）と 5xx（サーバ側障害）のときだけ 1 回だけ指数バックオフ 1 秒リトライ。429 で `Retry-After` ヘッダがあればそれを優先する案も検討したが、実装シンプルさを優先して固定 1 秒に統一（後で必要になったら拡張）。

400/401/403 等の 4xx（429 以外）は何度リトライしても無駄なので即 fail-open。

テストでは `sleepFn` を引数注入で即時 resolve に差し替えており、リトライ込みのテストでも遅延ゼロ。

### 4.10.5 Sonnet モデル ID は日付なしエイリアス採用

`JUDGE_MODEL = 'claude-sonnet-4-6'`。日付付き snapshot（claude-sonnet-4-6-20XXXXXX）は公式ドキュメントに記載がなく、エイリアス使用が推奨されている（Anthropic API ドキュメントで確認）。

エイリアスは新しい snapshot がリリースされたとき自動的に切り替わるリスクがあるが、Sonnet は generator (Haiku) と違い judge 専用なので、新版で評価が変わってもキャッシュ汚染にはつながらない（むしろ評価精度向上が期待できる）。本番で挙動が荒れたら snapshot 固定に切り替える。

### 4.10.6 文字数判定で早期リターンする理由

文字数 NG（120 未満 or 180 超）が出た時点で他軸を呼ばずに `passed=false, lengthOk=false` で即返す。これにより：
- Sonnet API コール 4 回（軸 1〜4）の Anthropic 課金が完全にゼロ
- レイテンシも Wikipedia 取得を待たずに即返し
- 文字数 NG は generator プロンプトの調整で潰す範疇なので、判定軸として独立に扱う

ちなみにテスト初版で SAMPLE description が 84 字（120 字未満）になっており、judgeAll の主要 3 ケースが全部 lengthOk=false で早期リターンしてしまうバグを踏んだ。文字数を Node で実測しながら 121 字に調整して解決。

---

## 4.11 Plan E / Phase 6.4 /api/describe への Judge 統合（2026-05-03）

生成 → judge → NG なら 1 回だけ再生成 → 集約レスポンス のメインフローを Workers の `/api/describe` に組み込み、フロント側で judge_passed を見てキャッシュ判断するアーキテクチャに移行した。

### 4.11.1 重要な実装前の発見：spec.md 10.5 と現状実装の齟齬

実装着手時に **spec.md 10.5「Workers 側でキャッシュ書込」が現状実装と乖離**していることを発見。

実態:
- Workers にはキャッシュ層（KV / Cache API）が**ない**
- キャッシュは `public/assets/storage.js` の localStorage（`setCachedDescription`）が**単一の真実**
- フロント `app.js` がキャッシュをチェックしてミス時だけ Workers を呼ぶ（つまり Workers は「呼ばれた時点で必ず Anthropic を叩く」設計）

判断: spec.md 10.5 を実態に合わせて文言修正（6.4a として独立コミット）。Workers にキャッシュ層を増やす案も検討したが、PoC スケール（利用者 1 人、iPhone 1 台専用）で恩恵ゼロ + 二重キャッシュ管理になるので却下。

### 4.11.2 describe_flow.js を index.js から切り出した判断

`generateAndJudge` を `workers/src/describe_flow.js` に新ファイルで切り出し。`index.js` 内に置く案もあったが：

- `index.js` は 112 行の純粋なルーター + auth + glue で、既存テストなし
- 新しいロジック（生成 → judge → 再生成ループ）を index.js に混入すると責務肥大、テストも書きにくい
- describe_flow.js なら describe_flow.test.js で `generator` / `judger` を引数注入してモック可能、外部 I/O ゼロで全分岐検証

結果: 6 ケースの統合テストが軽量に書けた（1回合格 / 1回NG→2回合格 / 2回NG / fail-open / 再生成エラー / 1回目生成エラー）。

### 4.11.3 fail-open 時に再生成しない判断

`judge1.passed === null`（Sonnet 障害）のとき、再生成を試みず生成出力をそのまま返す設計。

理由:
- Sonnet が落ちた状態で再生成しても、再 judge も同じく fail-open になるので意味がない
- Haiku 出力をそのまま表示する方がコストもレイテンシも節約できる
- ユーザには judge 失敗を伝えない（spec.md 10.4 / 10.7 通り）

代替案として「fail-open 時は generator 出力を信頼して passed=true 扱いでキャッシュに書く」もあったが、Sonnet が一時的に落ちている隙に低品質出力がキャッシュ汚染するリスクがあるので却下。fail-open 時はキャッシュ書込もスキップ（次回 Sonnet 復活後に再評価のチャンスを残す）。

### 4.11.4 再生成エラー時の regenerated フィールドの意味論

「2 回目生成（Haiku 再呼出）が ok=false の場合に regenerated を true / false どちらにするか」を悩んだ。

採用: **false**（1 回目を採用したことを示す）

意味論として「regenerated=採用された生成試行が 2 回目だったか」と定義した。

- ✅ 1 回目 NG → 2 回目合格 → `regenerated=true`（採用は 2 回目）
- ✅ 1 回目 NG → 2 回目 NG → `regenerated=true`（採用は 2 回目、判定は false）
- ✅ 1 回目 NG → 2 回目生成エラー → `regenerated=false`（採用は 1 回目、judge_passed は 1 回目の値を維持）
- ✅ 1 回目合格 → そのまま採用 → `regenerated=false`

これにより S3 集計で `regenerated=true` を「再生成試行が成功したケース」として一意にカウントできる。

### 4.11.5 deductions も Workers レスポンス + テレメトリに含めた判断

spec.md 10.5 のレスポンス例には `judge_scores` だけで `judge_deductions` がなかった。実装上は judgeAll の結果に既に deductions が入っているので、レスポンス + テレメトリに含めるかどうか選択肢があった。

採用: **含める**

理由:
- 分析の主目的の 1 つが「汎用フレーズ・情緒修飾の実例を見ること」で、deductions の引用文がそのまま実例
- レスポンスサイズ追加は 1 entry あたり数百〜数千字（誤差）
- S3 PUT のレイテンシ・コスト面で無視できる
- 後で「やっぱり要る」と気づいて足し直すコストの方が高い

採用された judge 試行の deductions を返す（`regenerated=true` なら 2 回目の deductions、それ以外は 1 回目）。

### 4.11.6 フロントのキャッシュ書込判断ロジック（最重要）

`public/assets/app.js` の変更が Plan E の本質的な防御線：

```js
if (result.ok) {
  // judge_passed===true のときだけキャッシュに書く
  if (result.judge_passed === true) {
    setCachedDescription(muni.code, solarTerm, result.description);
  }
  setDescription(result.description);  // 表示は常に行う
  ...
}
```

判断表:

| judge_passed | 表示 | localStorage 書込 | 次回同じ市町村 |
|---|---|---|---|
| `true` | する | する | キャッシュヒット、Workers 呼ばず |
| `false`（NG 確定）| する | しない | 再度 Workers を呼んで生成し直す |
| `null`（fail-open）| する | しない | 同上、Sonnet 復活後に再評価のチャンス |

これで「誤情報が一度入ると同じキーが来るたびに半永久的に表示し続ける」キャッシュ汚染問題（plan.md 10.1 で挙げた致命的問題）が構造的に防がれる。

### 4.11.7 テレメトリ entry スキーマ移行：critic_meaningfulness 廃止

Plan D 構想時の `critic_meaningfulness`（意味性）フィールドを `buildTelemetryEntry` から削除（spec.md 10.6 廃止フィールド）。Plan E では「意味性」という抽象軸ではなく、より具体的な 4 軸（accuracy / specificity / season_fit / density）に分解したため。

過去 entry（4.29 までの 8 件 + 5/3 取得分）には `critic_meaningfulness: null` が残っているが、分析時は欠損フィールドとして許容する（spec.md 10.6 の「後方互換」方針）。

---

## 4.12 Plan E / Phase 6.5 フロント UI 段階表示 + デバッグオーバーレイ（2026-05-03）

### 4.12.1 段階表示 UI（6.5a）

ローディング中の文言を経過時間で切り替え、Plan E の評価・再生成フェーズが進行していることをユーザに伝える。spec.md 10.7 通り：

- 0〜2 秒「📡 土地のたよりを生成中…」
- 2〜5 秒「✓ 内容を確認しています…」
- 5 秒〜「✏️ より良い表現に書き直しています…」
- regenerated=true 時、表示直前に 0.3 秒だけ「✏️」を残す演出

**spec.md からの設計修正**: spec.md 10.7 は「`api.js` に setTimeout を仕込む」と書いていたが、UI 描画は ui.js の責務なので `setDescriptionLoadingPhase` を ui.js 側に持たせ、api.js は文字列 phase を発火するだけに分離。`fetchDescription(password, req, { onPhaseChange })` の opts 引数として配線。

### 4.12.2 タイマーリーク防止

api.js の `fetchDescription` に setTimeout で仕掛けたタイマーは、以下のすべてのパスで必ずクリアする：
- 200 OK レスポンス到着時
- 401 / 400 エラーレスポンス到着時
- 全リトライ終了時（最後の lastError return 直前）

これを怠ると、画面遷移後にも文言が更新されてバグの温床になる。

### 4.12.3 デバッグオーバーレイ（6.5b、案 A 採用）

判定情報（judge_passed / scores / deductions / regenerated / fail-open）を実機で確認できるよう、フッターに ⚙️ トグルを追加。

- デフォルト OFF、`localStorage` キー `tripRoad.debug` で永続化
- ON のとき description の直下にモノスペースのデバッグペイン表示
- 「設定画面」のような大袈裟な構成は作らず、フッターアイコンのトグル 1 つで完結

**最初は「画面右上 5 連タップで表示」ジェスチャを提案したが、てつてつから「誤作動の可能性、ボタン置けばいい」と却下。明示的な ⚙️ ボタンに切り替え**（隠しジェスチャ過剰の典型例）。

### 4.12.4 テレメトリ手動 export（📤）の削除

Plan D Stage 1 で導入した `📤` ボタン（`exportTelemetryAsJson` + `downloadJson`）を削除。

- Stage 2 で全 entry が自動で S3 に flush される実装になった時点で、ローカル JSON への手動書き出しは情報の重複でしかない
- 削除対象: `public/index.html` の `#export-link`、`storage.js` の `exportTelemetryAsJson`、`ui.js` の `downloadJson`、`app.js` のクリックハンドラ
- 「念のため残しておく」誘惑を退け、本当に不要になった機能は完全に消す方針

### 4.12.5 currentJudgeData グローバル変数

デバッグ表示は ⚙️ トグル時に「現在表示中の解説の判定情報」を即時更新する必要があるため、`app.js` に `currentJudgeData` グローバル変数を持たせている。3 つのタイミングで更新：

- 初期表示時のキャッシュヒット → `{ cached: true }`
- handlePosition 内のキャッシュヒット → `{ cached: true }`
- 新規生成成功時 → `{ judge_passed, judge_scores, judge_deductions, regenerated, judge_error }`

グローバル変数を増やすのは本来避けたいが、UI トグルと描画状態を切り離す副作用としてここは許容（同じ理由で currentTraceId / currentDisplayStartMs も既にグローバル）。

---

## 4.13 Plan E / Phase 6.4d 再生成時のフィードバック注入（2026-05-03）

### 4.13.1 発見した穴

6.4 までの実装では、judge passed=false のときの 2 回目生成が **1 回目とまったく同じ messagesReq** で呼ばれていた。Haiku に「前回どこで NG になったか」を一切伝えていない状態。確率論的にしか改善せず、同じ失敗を繰り返す可能性が高い。spec.md にもこの再生成時のフィードバック機構は当初書かれていなかった。

てつてつから「精度が悪い場合、何が悪いかを LLM に伝えて新たに回答を生成してもらえるで OK ですか？何もなしで答えさせても、また失敗すると思うのですが」という指摘で発見。

### 4.13.2 対策

`workers/src/describe_flow.js` に `formatDeductionsForFeedback(deductions)` 純粋関数を追加。judge1 の deductions（軸ごとの引用減点根拠）を箇条書きテキストに整形する：

```
- 事実正確性:
  ・江戸期の城下町（記載なし）
- 具体性:
  ・桜が美しい（汎用）
- 情報密度:
  ・淡紅色に染まり（情緒）
```

これを `buildMessagesRequest({ ..., regenerationFeedback })` の引数として渡し、user メッセージ末尾に「前回の出力で校閲から指摘された箇所」セクション + 「上記の指摘を踏まえ書き直してください」指示を追加する。

### 4.13.3 設計判断

| 項目 | 判断 | 理由 |
|---|---|---|
| 注入先 | user メッセージ末尾 | system prompt は generator 自身の指針なので不変、再生成時の追加指示は user 側 |
| `formatDeductionsForFeedback` の責務 | 純粋関数として独立 | テスト容易、将来 feedback 表現を変えやすい |
| 全軸 deductions ゼロのとき | feedback 空文字 → 注入しない | 文字数 NG だけで passed=false になったケース等で意味のないセクションを足さない |
| 1 回目の generator 呼出 | feedback なし | 1 回目はそもそも前回が存在しない、プレーンな messagesReq で呼ぶ |
| 軸ラベル | 日本語（「事実正確性」「具体性」等） | Haiku は日本語生成タスクなので軸名も日本語の方が文脈一致 |
| 未知の軸キー（mystery_axis 等） | 生キーをそのまま label として使う | 防御的、将来軸が増えても落ちない |

### 4.13.4 検証で得た user メッセージの完成形

```
都道府県: 神奈川県
市区町村: 相模原市緑区
二十四節気: 清明（05）

[前回の出力で校閲から指摘された箇所]
- 具体性:
  ・桜が美しい（汎用）
  ・自然豊かな景観（汎用）
- 情報密度:
  ・淡紅色に染まり（情緒）

上記の指摘を踏まえ、固有名詞を具体的にし、情緒修飾を避け、事実陳述で書き直してください。
```

これで Haiku は「前回どの語句が問題だったか」を引用付きで知った状態で再生成できるので、同じ失敗を繰り返す確率が大幅に下がる（はず）。実走の S3 集計（fetch_entries.sh の Plan E サマリ）で「再生成 → 合格」率を観測して効果を測る。

### 4.13.5 注意：teacher forcing ではない

これは「次の出力例を見せて真似させる」teacher forcing とは違い、「前回ダメだった部分を引用して避けるべきパターンを教える」negative example の渡し方。Few-shot とも別の文脈情報。Sonnet judge が出した deductions（「桜が美しい（汎用）」）を Haiku generator にそのまま渡すという、judge → generator の情報フィードバックループの構築。

## 4.14 再生成完了後の loading-text 残留バグ（2026-05-03）

### 4.14.1 症状

Judge NG → 再生成のフローで本文は差し替わるが、本文の上に出ていた「✏️ より良い表現に書き直しています…」のテキストだけが画面に残り続けていた。再生成成功時のみ目立つが、原因は再生成に固有ではない。

### 4.14.2 原因

`public/assets/ui.js` の `setDescription` が `#description-skeleton`（プレースホルダのバー）は `hidden` 化していた一方で、別要素である `#description-loading-text`（フェーズ別文言を表示する要素、`index.html:79`）には何も触れていなかった。両要素は `index.html` 上で並んでおり、初期状態では両方 `hidden`、ローディング開始時に skeleton と loading-text の両方が `hidden` 解除される。本文確定時に skeleton だけ閉じても loading-text は開いたまま、というアンバランスが原因。

`setDescriptionFailed` は両方を hidden にしていたので失敗系では発症しない。`setDescription` と `clearDescription` の更新漏れ。

### 4.14.3 対策

`setDescription` / `clearDescription` の中で `#description-loading-text` も `hidden` にする 1 行を追加。`document.getElementById` の戻りが null のケースに備えて `if (txt)` で防御。テストは `test/ui_dom.test.js` に新設し、依存追加を避けるため `globalThis.document` を最小スタブして classList と textContent の遷移だけ検証する。

### 4.14.4 教訓

ローディング表示を「skeleton」と「文言テキスト」の 2 要素に分割した時点で、本文確定の出口側でも両方を閉じる責務が発生する。今回はその対応漏れ。表示状態の対称性（開く側で触る要素は閉じる側でも触る）を意識する。

---

## 4.15 README を Plan D / Plan E 反映で全面更新（2026-05-03）

### 4.15.1 経緯

`README.md` は Phase 4 完了時点（2026-04-25）のスナップショットのまま放置されていた。Plan D（テレメトリ + AWS S3 Sink）も Plan E（Sonnet 4.6 Judge + Wikipedia RAG）も本番反映済だったが README からは読み取れず、リポジトリの第一印象が実態と大きく乖離していた。

### 4.15.2 反映した差分（要約）

- アーキテクチャ図に Wikipedia API（30 日 Cache）と AWS S3（aws4fetch SigV4）を追記、Workers の役割を「Anthropic プロキシ」から「生成→Judge→指摘付き再生成→S3 送信のオーケストレーター」に書き換え
- 「できること」に Sonnet 4.6 の 4 軸 Judge（事実正確性 / 具体性 / 季節整合 / 情報密度）と再生成、二十四節気プロンプト、テレメトリ自動 S3 送信、段階表示を追記
- 技術スタック表で LLM 行を「生成（Haiku）」「Judge（Sonnet 4.6）」に分割、RAG 行とテレメトリ Sink 行を新設
- 環境変数欄を「ローカル `~/.secrets/trip-road.env`」と「Workers Secrets（AWS 系を含む）」に分離
- リポジトリ構成の `workers/src/` を 9 ファイル構成（`describe_flow.js` / `judge.js` / `judge_prompts.js` / `wikipedia.js` / `aws.js` 追加）に書き換え、`docs/analysis/` を追記
- テスト件数を実測値で更新（フロント 10→41、Workers 20→97、合計 34→142）
- 開発フェーズ表に Phase 5（Plan D）と Phase 6（Plan E）を追加、Plan F を「計画中」で追記
- 生成例の見出し「春」を「立春〜雨水ごろ」に置換（節気仕様反映）
- ライセンス節に aws4fetch（MIT）と Wikipedia 日本語版（CC BY-SA 4.0）を追記

### 4.15.3 テスト件数は実測で取った

`grep -c "it("` で素朴に数えると `describe` 入れ子や parametrized ケースを取り逃すため、`npm test` を実行してランナーが報告する数字をそのまま採用した（フロント 41 / Workers 97）。次回 README を直すときも実測値で揃える。

### 4.15.4 .env.example は手付かず

README の環境変数説明では Workers Secrets として AWS 系の存在に触れたが、`.env.example` 自体は ANTHROPIC_API_KEY / APP_PASSWORD / ALLOWED_ORIGIN のみで AWS 系を含めていない。**これは意図的**で、AWS のアクセスキーは `~/.secrets/trip-road.env` に置かず Cloudflare Workers Secrets でのみ管理する方針（漏洩経路を Workers 側に閉じ込めるため）。`.env.example` への追記は不要。

### 4.15.5 教訓

ドキュメント類はコードと違って CI が壊れないので、機能を出すたびに「README を見たらこの機能の存在に気付けるか」を確認する習慣が必要。Plan D / Plan E のように 2 フェーズ分も README が遅れた状態は、外から見るとリポジトリの信頼性を下げる。次フェーズ着手時のチェックリストに「README の差分要否を確認」を入れておく価値あり。

## 4.16 自宅起動時に解説が出ない問題（F-4、2026-05-03）

### 4.16.1 症状

自宅（前回と同じ市町村）でアプリを起動すると、地図はピンが立つが解説エリアが空のまま何も出ない。シークレットウィンドウで再ログインすると正常に解説が出る、という再現条件のばらつきがあった。

### 4.16.2 原因

フロントの 2 つの設計が組み合わさった結果。

1. `app.js` の `handlePosition` は「市町村が変わった瞬間」（`muni.code !== currentMuniCd`）にだけ API 呼出フローに入る。同じ市町村に居続けると一度も Workers を呼ばない。
2. Plan E 6.4c 以降、`localStorage` キャッシュは「judge 合格(true)」の解説しか書込まない（不合格を再発信しないため）。

→ 「自宅(=前回と同じ市町村) + 過去に合格していない」という組み合わせで、起動後 API も呼ばれず、キャッシュからも何も出てこない。シークレットウィンドウは `localStorage` が空 → `currentMuniCd = null` で「null と異なる」が成立 → 切替フローに入って正常動作した、という対比でカラクリが見えた。

### 4.16.3 対策（採用案 A）

`handlePosition` の判定式を `muni.code !== currentMuniCd` から「初回 fix なら市町村同一でも切替フローに入る」に変える。`isFirstFix` フラグは元々地図 centering 用に存在していたので、保存して使い回す。

純粋関数として `public/assets/switch_flow.js` に切り出し、`shouldEnterSwitchFlow(newCode, currentCode, wasFirstFix)` を `app.js` から呼ぶ。`app.js` 自体は `window.addEventListener('DOMContentLoaded', ...)` を含むので vitest の node 環境からは import できない（→ そのため判定ロジックの抽出が必要だった）。

### 4.16.4 採用しなかった案

- B「再生成」ボタン: 手動操作必須で起動時の体験は変わらない（ただし F-3.1 として独立に有用、共存させる）
- C 不合格もキャッシュ: Plan E の「悪い解説を流通させない」設計に逆行
- D 「再取得してください」明示文言: ユーザに余計な手数を強いるだけで根治にならない

### 4.16.5 副作用と運用方針

起動毎に必ず Workers へ 1 リクエスト発生。合格すれば次回からキャッシュヒットなので追加コストなし。不合格が続く市町村では起動毎にフェッチが続くが、これは「精度を上げるべき」という設計フィードバックでもあるので、コスト面で許容する。

### 4.16.6 教訓

「現在地と前回の市町村が同じ」を「何もしない」と等価視したのが落とし穴。スマホ常駐アプリと違って Web は毎回ロードからやり直すので、`currentMuniCd` の永続化と「変化検知のみで動くロジック」は相性が悪い。次に同種のロジックを書くときは「リロード直後に欲しい状態が再構成されるか」を必ず想定する。

---

## 5. 参考資料

### 5.1 使用データ・API
- N03: https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N03-v3_1.html
- 地理院タイル: https://maps.gsi.go.jp/development/ichiran.html
- GSI 逆ジオコーダ: https://maps.gsi.go.jp/development/reversegeocode.html
- Anthropic API: https://docs.anthropic.com/

### 5.2 参考プロジェクト
- speed-mater: https://github.com/tetutetu214/speed-mater（GPS取得ロジックの元）

### 5.3 使用OSS
- Leaflet.js 1.9.4（BSD-2-Clause）: https://github.com/Leaflet/Leaflet
- Turf.js booleanPointInPolygon（MIT）: https://github.com/Turfjs/turf
- geopandas（BSD-3-Clause）
- shapely（BSD-3-Clause）
