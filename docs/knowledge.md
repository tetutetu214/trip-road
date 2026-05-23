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

## 4.17 Plan D 系テレメトリ 24 件の分析結果（2026-05-05）

F-4 / 6.8 の本番反映後、それまでに S3 に蓄積された 24 件のテレメトリを LLM で分析した。Plan E（Judge 統合）は 2026-05-03 反映なので、24 件のうち `judge_passed` フィールドが付いているのは 1 件のみ（NG 確定）、残り 23 件は Plan D 系のスキーマ（`season` フィールドあり、`solar_term` / `judge_passed` なし）。

### 4.17.1 サンプルの偏り

24 件のうち神奈川県央 5 市（相模原・海老名・座間・綾瀬・厚木周辺）が約 17 件、東京 23 区が 7 件、それ以外ゼロ。生活圏の実走ログがそのまま反映された形で、汎用表現の検出は「相模川流域」コンテキストに引きずられる前提で読む必要がある。

### 4.17.2 汎用フレーズの固定化

複数の `muni_code` をまたいで頻出するフレーズ（市町村が変わっても通用してしまうもの）：

- 「神奈川県の中央部に位置」: 3 市 5 件
- 「春野菜が市場に並ぶ／旬を迎える」: 5 市 9 件
- 「江戸期に栄え／農村地帯」: 5 市 8 件
- 「商業と農業が共存する活力ある地域」: 同文が 14215 で 2 件重複出現

同一 `{muni_code}_{season}` に対するキャッシュキー設計は意図通り動いている一方、品質の低い出力が一度生成されるとその季節の間ずっと使われ続ける構造が顕在化した。

### 4.17.3 事実誤認 3 件（深刻）

Haiku の知識限界に起因するハルシネーションが具体的に観測された：

1. **綾瀬市（14218）spring**: 「相模川と中津川に挟まれた」← 接していない（実際は目久尻川・蓼川・比留川）。海老名市の説明文を市名だけ差し替えた典型的な転写ミス
2. **相模原市（14153）spring**: 「緑豊かな城下町」← 城下町ではない
3. **新宿区（13104）spring**: 「都市農業」← 規模感が合わない

Plan E の Judge 軸 1（事実正確性）は Wikipedia 抜粋を根拠に減点はできるが、Haiku 自身が誤った事実を「知っている」前提で書いてくるため、リトライしても同じ誤認を出すリスクがある。Judge 単独では構造的に解決しない。

### 4.17.4 system prompt 改善案（投資対効果順）

| 優先 | 案 | 副作用 |
| --- | --- | --- |
| 高 | Wikipedia 抜粋に登場する語句のみ使用、不確実なら省略 | Wikipedia が薄い市町村で表現が硬くなり season_fit が下がる |
| 中 | 固有名詞（駅名・公園名・特産品）を 2 つ以上義務化 | 薄い市町村で逆にハルシネーション増加 |
| 低 | 観察された禁止フレーズのブラックリスト | 類義語で言い換えるだけで終わる、メンテ負荷高 |

### 4.17.5 Plan F の優先度更新

24 件で見える傾向から、Plan F の優先度を以下のように更新する：

- **F-1.3（generator にも Wikipedia 抜粋を渡す = 生成側 RAG）を最優先に格上げ**: 事実誤認 3 件すべてが「Wikipedia に載っていない記述」だった。Judge 側で減点しても Haiku が知らないので直らない構造のため、Judge 強化より generator への RAG 投入が刺さる
- **F-1.2（文字数遵守率改善）は様子見**: 現データでは文字数 NG が顕著には観測されず、Plan E が溜まってから判断
- **F-3.1（再生成ボタン）を中優先に**: Plan E 以降は Workers 側にキャッシュ層がなくフロント localStorage が単一の真実なので、品質低キャッシュをユーザ操作でクリアする手段が必要

### 4.17.6 教訓

- Judge は「LLM が知らない事実」の問題を解決しない。減点はできるが、生成側に正しい素材を渡さない限り再生成しても同じ誤りを出す。Judge と generator の両方に Wikipedia を流す構造が必要
- キャッシュ品質低の固定化は単一ユーザーアプリでも顕在化する。`{key}_{season}` のような長期キャッシュキーを採用するなら、最初から再生成 UI を用意するべきだった
- サンプル 24 件でも汎用フレーズと事実誤認の両方が観測できた。「データが少ないから判断できない」と思い込まずに、まず分析を回す価値はある

---

## 4.18 F-1.3b 設計判断（生成側 RAG、2026-05-05）

24 件分析を踏まえ、F-1.3 の実装範囲を確定した。F-1.3a/b/c の選択肢のうち b（Wikipedia + SOLAR_TERM_META）を採用、c（24 節気ヒント表）は見送り、F-3.1（再生成ボタン）は取り下げ。

### 4.18.1 採用しなかった案と理由

- **F-1.3a（Wikipedia のみ）**: SOLAR_TERM_META は既に `judge_prompts.js` に存在するので、Generator にも渡すコストはほぼゼロ。a は b と区別する意味がない
- **F-1.3c（24 節気ヒント表を自作）**: 24 件分析で軸3（season_fit）スコアが他軸より高く、明示的な強化の必要性がデータで立証されていない。c の実装コスト（24 個 × 数行のテーブル整備、prompts.md 改訂、テスト追加）に見合わない
- **F-3.1（再生成ボタン）**: ユーザが画面で Judge スコアを見ない設計（⚙️ デバッグオーバーレイ専用）のため、「ユーザの主観で再生成」シナリオが成立しない。Plan E の自動再生成でカバー済

### 4.18.2 引っ張られ問題への対処

「Wikipedia 抜粋を渡すと文体や構造が引きずられる」という懸念に対し、以下のプロンプト設計で緩和する：

- **役割の明示**: 「Wikipedia は事実確認のための参考資料、抜粋の文章をそのまま引用しない、文の構造を真似ない」を user メッセージに明記
- **Few-shot 例**: 「Wikipedia 抜粋 → 良い土地のたより」の対応例を 1 件入れて、引っ張られの方向を「事実だけ、文体は維持」に誘導
- **Wikipedia null 時の処理**: 抜粋セクション自体を省略し、Haiku に「該当 Wikipedia なし」を意識させない。薄い市町村で固有名詞を捻り出すリスクを増やさない

これは Plan E の Judge プロンプトで既に同じ問題を解決している実績パターン（Judge も Wikipedia を渡されているが評価文は Wikipedia 直訳になっていない）。

### 4.18.3 Generator と Judge の情報量を揃える

現状: Judge には SOLAR_TERM_META（節気名 + 期間）が渡されているが、Generator には節気名 + 番号だけ。Judge は具体的な期間で評価する一方、Haiku は丸腰で書かされる不公平な構造になっていた。F-1.3b で両者の情報量を揃える。

### 4.18.4 期待効果と検証方針

- 軸1（accuracy）の事実誤認が減る → Judge NG → 再生成のループが減る → レイテンシ・コスト削減
- 軸2（specificity）の汎用フレーズが減る → 固有名詞の比率が上がる
- 軸3（season_fit）は現状高スコアなので変化少と予想（むしろ Wikipedia の硬さで微減もあり得る）
- 軸4（density）は引っ張られ次第。情報密度が上がる方向と、情緒修飾が減る方向、両方ありうる

検証は本番反映後 1 週間ほど実走 → S3 集計（`fetch_entries.sh`）で Plan E スコアの変化を見る。サンプル不足で結論が出なければ次の 1 週間も継続。

### 4.18.5 本番反映後の動作確認（2026-05-06）

PR #34 マージ後、`wrangler deploy` で Worker のみ本番反映し、認証付き curl で 2 ケース確認。

#### ケース 1: 横浜市中区 / 立夏（Wikipedia あり）

レスポンスの description 前半「横浜港に面した中心商業地区で、幕末開港時から国際貿易港として機能してきました。山手地区には明治期の洋館が立ち並び、関帝廟や媽祖廟などの中華街関連施設も集中しています」は Wikipedia 抜粋の固有情報がしっかり組み込まれており、24 件分析で観測した「県の中央部に位置」式の汎用フレーズは消えた。F-1.3b の意図通り。

ただし後半の季節要素「市内の青物市場を通じて流通が増えます」で Haiku が「青物市場」を捏造。Judge は accuracy 軸でこれを減点（軸別 acc=3, spec=4, season=4, dens=3、最終 NG）。再生成しても直らず。

#### ケース 2: 架空テスト町（Wikipedia なし、抜粋省略動作）

Haiku が「実在しない市区町村のため、土地情報の解説をお書きすることができません」という拒否文を返却（300 字超）。Judge は文字数 NG で reject、合計 2 リクエスト消費。

本番のフロント（muni.js）は N03 の実在市町村のみ渡すため、この経路は通常発生しない。HTTP 200 で通っており Worker の挙動は正常で、「Wikipedia なしでも壊れない」という当初の確認は満たせた。

#### F-1.3b の射程の理解

- 「Wikipedia 抜粋に書かれている事実」（地名・歴史・地形・特産品の一部）に対する RAG 効果は明確
- 「Wikipedia 抜粋に書かれていない事実」（季節要素・農事暦・地域経済）は F-1.3b の射程外。後半部分でハルシネーションが残る傾向
- 季節要素のハルシネーションが多いようなら、見送り中の F-1.3c（24 節気の旬の食材・行事ヒント表）の必要性が立証される。1 週間の実走テレメトリで判断する

---

## 4.19 Plan E 観測 92% NG の原因分析と Plan G への接続（2026-05-06）

### 4.19.1 観測サマリ

S3 テレメトリ（2026-04-26〜2026-05-06、Plan E entry 14 件）の集計結果:

- 合格 (`judge_passed=true`): **0 / 14（0%）**
- NG 確定 (`false`): 13 / 14（92%）
- fail-open (`null`): 1 / 14（7%）
- 再生成発生: 13 / 14（92%）
- 軸別平均: accuracy 2.63 / specificity 2.75 / season_fit 4.25 / density 2.75

NG 理由の deductions はほぼ全て「○○（Wikipedia に記載なし、根拠なし）」のパターン。例:

- 世田谷区:「多摩川が南側を流れている」→ Wikipedia 記載なしで減点
- 渋谷区:「ビジネス街の気温が上昇」「百貨店が集中」「交通の要所」→ 全部 Wikipedia 記載なしで減点
- 台東区: 再生成時に Generator が「本区の具体的な地形・歴史・産業について、確信を持つ情報が Wikipedia の抜粋に限定されるため、これ以上の詳述は控えます」と自己放棄文を出力

### 4.19.2 構造的原因（一次ソース調査による）

Anthropic 公式「Reduce hallucinations」では:

- **デフォルト推奨**: "Allow Claude to say I don't know"（曖昧なら省略を**選択肢として**与える）
- **External knowledge restriction**（資料外を一切書くな）は **advanced techniques の中の一つ**にすぎず、用途は >20K トークンの長文向けと明記

trip-road では Wikipedia 抜粋数百〜数千字に対して External knowledge restriction を適用し、しかも Judge 軸 1 が「Wikipedia 記載なし → 減点」というルールで全文を叩く構造になっていた。これが組み合わさって RAG over-refusal（学術的に AAAI 2026 採録論文で確認された現象）を強く誘発し、Generator が萎縮して fact を書かなくなり、Judge が「書かれていないこと」ではなく「書かれていて Wikipedia 外のもの」を機械的に減点する shortcut bias（Silent Judge 論文）を獲得した。

### 4.19.3 合格基準の数学的問題

`workers/src/judge.js` の `aggregateScores` は「全軸 ≥4 AND」で判定。独立事象の AND は p^4 に圧縮されるため、各軸 70% で合格しても全体 24% に落ちる。Anthropic / OpenAI / Vertex AI のいずれの公式ドキュメントも全軸 AND を推奨していない（「holistic evaluation のために複数 rubric を使う」までは推奨）。

### 4.19.4 ユーザの原点とのズレ

てつてつの原点（旅人が初訪問の街を知る、土地・歴史 + 季節）に対し、現状の実装は土地・歴史と季節描写を区別せず、すべての記述に Wikipedia 照合をかけている。前回 Claude との合意「季節は LLM の一般知識で OK」がプロンプトに反映されていなかった。

### 4.19.5 Plan G の方針

LLM 自動生成を保ったまま品質を上げる。手作業による解説文の校閲はゼロ。

- G-1（#35）: プロンプト緩和（Generator・Judge 軸 1・合格基準）
- G-2（#36）: Wikipedia API 取得を全本文に拡張
- G-3（#37）: Wikidata QID マッピング（オフラインバッチ、`wdt:P429` で全国地方公共団体コード→QID）
- G-4（#38）: Wikidata SPARQL を runtime RAG に統合（Wikipedia と並列）
- G-5（#39）: Judge meta-eval セット（Judge 校正用 20-30 件、本番表示は触らない）

### 4.19.6 一次ソース根拠（要点）

- **Anthropic Demystifying evals**: "give the LLM a way out, like providing an instruction to return 'Unknown'" / "subtle failure modes" / "grade each dimension with an isolated LLM-as-judge"
- **Anthropic Reduce hallucinations**: External knowledge restriction を advanced 扱い、デフォルトは "Allow I don't know"
- **Anthropic Contextual Retrieval**: 200K トークン以下なら RAG 不要、丸ごと入れて良い
- **OpenAI Graders**: meta-eval（Judge 校正セット）の作成を推奨
- **OpenAI Model Spec Evals**: focus area ごとに独立にコンプライアンス判定（全軸 AND ではない）
- **Silent Judge 論文 (arXiv 2509.26072)**: Judge は shortcut bias を起こしやすい
- **AAAI 2026 RAG Over-refusal 論文**: 薄い RAG context は LLM のパラメトリック知識を抑制し refuse を増やす

### 4.19.7 データソース調査（2026-05-06、Plan G 設計の前提）

「市町村名キーで名産・観光・歴史・風土を返す API」を一次ソース調査した結果:

- **唯一現実的なオープン API**: Wikipedia (MediaWiki Action / Wikimedia REST) + Wikidata SPARQL の組合せ
- 観光予報プラットフォーム / JNTO / 文化庁文化財 DB / 文化遺産オンライン API は一般開発者向けの公開オープン API として存在しない、もしくは参加館限定
- じゃらん Web は新規受付終了（2020-02）、ぐるなびは無料公開終了（2021-06）
- 楽天トラベル API は宿情報のみで土地解説には不適
- 国土数値情報・農水省 GI は DL 型で runtime API なし（事前取込なら可）
- OpenStreetMap Overpass は POI 抽出に有効、ただし `wikipedia`/`wikidata` タグでチェーンする補完用途

→ trip-road が既に Wikipedia 単独の RAG を採用しているのは正しい選択。改善方向は「ソース変更」ではなく「同一ソース系統（Wikipedia + Wikidata）の取り込みを厚くする」。Plan G がこの方針に沿う。

### 4.19.8 教訓

- 一次ソース調査の前にプロンプトで「資料外禁止」を強く書くと、デフォルト推奨の "I don't know" の way out を壊して RAG over-refusal を誘発する
- Judge プロンプトの Few-shot は減点パターンに偏ると、Judge が「特定パターン検出器」になり検証ではなく検閲になる（shortcut bias）
- 評価軸の AND 結合は数学的に合格率を圧縮する。各軸独立の判定を AND で結ぶ前に、p^4 がどこまで落ちるかを見積もる
- 「定量評価したらダメだった → 手作業に退却」は LLM 自動生成プロジェクトでは敗北で、改善手段はほぼ常に「プロンプト・RAG コンテキスト・Judge ルール・閾値の見直し」のいずれかに収まる

---

## 4.20 Plan G-1 実装（プロンプト緩和 + 重み付き合計、2026-05-07）

4.19 章の構造的原因分析を受けて Plan G-1（Issue #35、ブランチ `fix/prompt-overrefusal`）を実装。Generator/Judge プロンプトの緩和と Judge 合格判定ロジックの重み付き合計化を、3 ファイル + テスト + ドキュメントで完結する 2 コミット構成にまとめた。

### 4.20.1 採用した変更

- **Generator (`anthropic.js` SYSTEM_PROMPT)**: 「市町村名以外の固有名詞は確信があるものだけ書く」を「検証必須の固有名詞（人物名・年代・寺社名・建造物名）に限定」へ。「抜粋に書かれていない地名・河川名・歴史的事実は確信があるものだけ書く」を「Wikipedia と直接矛盾しない範囲で LLM の地理・歴史・季節知識を活用してよい、記載なしを省略する必要はない」へ。新規に「自己放棄文・謝罪文の出力禁止」を明示
- **Judge 軸 1 (`judge_prompts.js` `buildFactualityPrompt`)**: 「Wikipedia に明記されていない事項は『根拠なし』とみなし減点」を「直接矛盾のみ重く減点、記載なしは減点しない」へ。Few-shot を 2 → 3 パターンに拡張（5点・整合 / 5点・記載なしだが地理常識として妥当 / 2点・直接矛盾あり）
- **合格基準 (`judge.js` `aggregateScores`)**: 全軸 ≥4 AND を `0.4×accuracy + 0.2×spec + 0.2×season + 0.2×density ≥ 3.5` の重み付き合計に置換。`AXIS_WEIGHTS` と `PASS_THRESHOLD` を export

### 4.20.2 「3 パターン Few-shot」の選定理由

旧 Few-shot は「5点・整合 / 2点・記載なし」の 2 パターンで、Judge に「Wikipedia 記載なしを 2 点として減点する」というパターン認識を強く焼き付けていた（shortcut bias の温床）。3 パターン化で「5点・記載なしだが地理常識として妥当」（世田谷区の多摩川例）を中央に置き、Judge に「記載なしと矛盾は別物」を体感させる。Few-shot 数増加によるトークンコストは Judge 軸 1 のみ（他 3 軸は据置）で 100 字程度の増加に収まる。

### 4.20.3 weighted を返り値に含めなかった理由

`aggregateScores` の戻り値に `weighted` を追加すると `describe_flow.js` / `index.js` のレスポンス組立、フロント `api.js` / `app.js` / `telemetry.js` のスキーマ、`fetch_entries.sh` 集計の順で連動修正が必要になる。G-1 のスコープを「合格判定ロジックの緩和」と「プロンプトの緩和」に閉じるため、`weighted` は内部計算のみに留めた。観測したくなったら `fetch_entries.sh` 側で `AXIS_WEIGHTS` を再適用するだけで済む（4 軸スコアは既に S3 entry に保存されている）。観測ニーズが先行で立証されてから戻り値追加を検討する。

### 4.20.4 重み 0.4 / 0.2×3 と閾値 3.5 の根拠

- **0.4 / 0.2×3**: てつてつの原点（旅人が初訪問の街を知る、土地・歴史 + 季節）に対し accuracy が一次目的、specificity / season_fit / density が二次目的という非対称性を重みに反映。仮に accuracy のみ 0.7、他 0.1×3 と極端化すると specificity と density が事実上無視されるため、二次軸群が同じ重みで残る形を維持
- **3.5**: 5 段階の中央 3 と模範 4 の中間。全軸 4 で重み付き 4.0 が確実に合格する一方、全軸 3 で 3.0 だと NG という設計。accuracy=2 で他軸 5 なら 3.8 で合格、accuracy=1 で他軸 5 でも 3.4 で NG（accuracy 重視の効果が出る境界）。閾値 3.0 まで下げると緩すぎ、4.0 まで上げると 0.4 重み付けの恩恵が消える

### 4.20.5 期待効果と検証方針

- 軸 1（accuracy）の Wikipedia over-refusal 由来の減点が消え、軸 1 平均スコアが 2.56 → 3.5+ に上昇する想定
- 重み付き合計の効果で、accuracy=2 程度でも他軸が高ければ合格が出る → 合格率 0% → 30〜50% 改善が目標（Issue #35 完了条件）
- 副作用: 緩和により Haiku のハルシネーション（4.17 の「相模川と中津川に挟まれた」型）が再増する可能性。Judge 軸 1 の「直接矛盾は重く減点」を残すこと、`AXIS_WEIGHTS.accuracy = 0.4` で accuracy 重視を保つことで対抗
- 検証: 本番反映後 1〜2 週間の S3 テレメトリを `fetch_entries.sh` で集計し、軸別平均と合格率の推移を見る。改善が頭打ちなら Plan G-2（Wikipedia 全本文）→ G-3 / G-4（Wikidata RAG）に進む

### 4.20.6 教訓

- LLM-as-a-judge で Few-shot を 2 パターンしか出さないと、Judge は片側パターン（NG）の検出器に偏る。最低 3 パターン（OK・OK 別軸の妥当性・NG）で「OK にも複数パターンがある」を体感させる
- 評価ロジック変更は呼び出し側との結合度で実装範囲が大きく変わる。`aggregateScores` の戻り値形式を維持したことで、describe_flow / フロント / テレメトリ / 集計スクリプトすべてに変更を波及させずに済んだ。最小スコープを切る判断は今回のように観測ニーズが先かどうかで決めるとよい
- プロンプト変更の検証セット（G-5 = Issue #39）が未着手のまま緩和を入れたので、本番観測でしか効果検証できない。G-5 を後追いで作って次のプロンプト変更に備える

---

## 4.21 学習済み概念（理解度テストハーネス記録）

`~/.claude/CLAUDE.md` の理解度テストハーネスで、てつてつが理解を確認した概念を日付つきで記録する。次回以降、同じ概念に関する実装の前のテストはスキップ判定に使う。

### 2026-05-05 F-1.3b 着手前テスト

- **RAG（Retrieval-Augmented Generation）の本質**: LLM の学習データに含まれない、または不確かな事実を、外部の検索結果や参照資料で補強する仕組み。応答速度・コスト削減・出力長制限のためではなく、知識限界の補完が目的
- **system prompt と user message の責務分離**: system prompt は全リクエスト共通の固定ルール・文体・口調を定義し、user message はそのリクエスト固有の可変データ（市町村名・節気・Wikipedia 抜粋など）を載せる。文字数制限・キャッシュ・ログ保持の都合ではなく、責務分離が本質
- **データ駆動の判断**: 拡張機能の採否や優先順位を「実装コストの大小」「メンテ時間の有無」ではなく「データで効果が立証されているか」で決める。改善余地が小さい軸（24 件分析の season_fit など）に投資するのは Premature Optimization。fetch_entries.sh の集計でスコア低下が観測されてから動くのが筋
- 復活条件: 見送った機能（F-1.3c など）は、S3 集計でスコア低下が観測されたら復活、を原則とする

### 2026-05-07 G-1 着手前テスト

- **RAG over-refusal の本質**: Generator の「資料外を書くな」と Judge 軸 1 の「記載なし → 減点」が組み合わさり、Anthropic 公式デフォルト推奨の "Allow I don't know" の way out を壊して LLM のパラメトリック知識を萎縮させた。Wikipedia 抜粋の薄さや Sonnet の評価厳格さは主因ではない（4.19 章の一次ソース調査と整合）
- **AND 結合の合格率圧縮**: 独立事象の AND 結合は p^N で合格率を圧縮する。各軸 70% でも全体 24%。重み付き合計に切り替えると単軸の極端な低スコアを他軸で補える総合判断が可能になる。これが「全軸 ≥4 AND → 重み付き ≥3.5」の数学的根拠
- **緩和の副作用**: Generator のプロンプトから「資料外禁止」を外すと、Haiku の知識限界に起因するハルシネーション（4.17 の「相模川と中津川に挟まれた」型）が再増するリスクがある。Judge 軸 1 を「直接矛盾は重く減点」のままにしておく必要がある。レイテンシ・キャッシュ・コストは主要な懸念ではない

### 2026-05-21 Issue #48（陰影起伏図 3段階トグル）PR 直前テスト

- **意味と表現の分離設計**: 状態を `'off'/'weak'/'strong'` の意味的文字列で持ち、opacity 数値は map.js のテーブルに委ねる。「見た目の濃さを後で調整したい」場面で UI 名（永続化キー・ボタン状態クラス）を触らずに map.js のマッピング表だけ上下できる。「テスト容易」「シリアライズ容易」「行数削減」は副次的メリット
- **旧キー残骸の無害化原則**: localStorage に古い `hillshadeEnabled` キーが残っても、新キー `hillshadeLevel` だけを読むコードに切り替えれば旧キーは無視される。`loadState()` は `emptyState() + spread` で既知の構造に揃えるため、未知のキーが衝突を起こさない。クリーンアップ用のマイグレーションコードを書くより、新旧キーを衝突させない設計の方が安全
- **iPhone フッターの制約と循環 UX**: ボタン 1 個でタップごとに状態を回す UI は、フッターの限られた面積を増やさずに済む。3 つのボタンを横並びにすると ⚙️ や GPS ステータスと干渉する。スライダーやドロップダウンはタップ精度の問題で iPhone Safari の小さなボタン群と相性が悪い

### 2026-05-21 Issue #46（標高API + 陰影起伏図）本番反映直前テスト

- **deploy_frontend.sh の作用範囲**: Cloudflare Pages の trip-road プロジェクトに `public/` 一式が production ブランチとしてデプロイされる。Worker / S3 / DNS は触らない。コマンドの引数や順序ではなく、「何が・どこまで・誰の責任で更新されるか」を切り分けられることが理解の核
- **本番反映の安全性根拠**: Cloudflare Pages は atomic deploy で、ビルド完了後にエッジを切り替えるためダウンタイムゼロ。Worker を叩いていないので Bedrock Nova Pro 課金もこの反映では発生しない。「Pages 転送量は無料枠内」と「Bedrock コストは無関係」の両面で安全
- **最速ロールバック手段**: Cloudflare Pages のダッシュボードに過去デプロイの履歴が残っており、1 クリックで Rollback ボタンを押せる。git revert PR を作って再デプロイより速い。「コードの履歴」と「デプロイの履歴」は別の場所に残るので、ロールバックの最速経路はサービス側ダッシュボードの方を覚えておく

### 2026-05-21 Issue #46（標高API + 陰影起伏図）PR 直前テスト

- **「Generator/Judge を触らない」設計判断の本質**: Wikipedia 要約パイプラインは Phase 2-3 で合格率 100% を達成済（4.26 章）。体感品質の不満（土地の地形・地理感がない）は解説文の中身ではなく、地図 UI に立体情報が無いことが原因。Generator のコンテキストに標高を足すと in-context 原則（抜粋外を出さない）と緊張関係に入り、out_of_kb_terms 検出ロジックが再び不安定化するリスク。UI 拡張だけにスコープを絞ったのはリグレッションゼロの設計
- **国土地理院の負荷遠慮要請が API 呼出 debounce の根拠**: 公式ドキュメントが「過度な負荷を与えないでください、遮断する場合があります」と明記。watchPosition は実機で毎秒近く飛んでくるので、生で渡すと数分で公式の遠慮ラインを越える。5秒 or 100m の debounce はレイテンシ・コスト・表示スムージング目的ではなく、規約遵守が一次目的
- **coords.altitude → 標高API フォールバックの設計**: GPS 由来の altitude が取れていれば追加 API 呼出ゼロ・即時応答・オフライン耐性ありの三拍子で最良。ただし iPhone Safari は altitude が null になるケースがある（端末・条件依存）ので、null フォールバックとして標高API に逃げられるよう createElevationUpdater に分岐を組んだ。CORS リスクヘッジや GPS 精度を理由に選んだ設計ではない

### 2026-05-11 Plan I 着手前テスト

- **「未知の創作」を「既知の圧縮」に倒す原理**: プロンプトで参照すべき情報（Wikipedia 抜粋）を明示することで、LLM が抜粋外の知識を引き出す自由度を狭め、ハルシネーションを抑える。in-context にある情報を再表現するタスクは、内部記憶から事実を捻り出すタスクより誤りが起きにくい。出力長や学習データ被りが原理ではない
- **Judge 簡素化の本質**: タスクが「Wikipedia 抜粋の要約」に絞られると、生成内容の自由度が小さくなり、評価すべき軸も小さくなる。4 軸 → Faithfulness 1 軸への簡素化は、タスク変更に伴う必然。コスト削減や実装簡素化は副次的メリット
- **節気廃止に伴う軸 3 の連鎖削除**: 二十四節気のロジックを捨てれば、Judge 軸 3（季節整合）は評価対象が消えるため一緒に削除すべき。Wikipedia 取得・テレメトリ・認証は方針転換と直交するので残す
- **記事なし市町村のフォールバック設計**: Wikipedia 抜粋が取れない市町村で Generator(LLM) を呼ばずフロントで「記事なし」を返す本質は、LLM の内部知識で創作させてハルシネーションを生み出すことを防ぐため。Plan I のコア原則（in-context にない情報は出さない）を、エラー時にも例外なく適用する。コスト削減やレイテンシ短縮は副次的
- **決定論的検査（Phase 2 候補）の最大メリット**: 形態素解析で固有名詞集合を照合する決定論的 Faithfulness Judge は、Nova Pro の指示無視リスク（Plan G-1.5 で見た軸違い不当減点と同種）から解放され、同じ入力に対していつも同じ出力が返る。実装シンプル化は副次的メリット
- **テレメトリスキーマ移行の理由**: 旧 critic_* と新 faithfulness_* のスキーマが異なるデータが同じ S3 パーティションに混在すると、バッチ集計や Athena クエリでスキーマ不一致エラーが起きる。よって過去 37 件は legacy/ プレフィックスに退避する。ストレージコスト・パーティション数上限は理由ではない

### 2026-05-22 Issue #37（Wikidata QID マッピング）着手前テスト

- **データの変動頻度に応じた責務分離**: 「市町村コード → QID」は年単位でしか変動しない同定キーなので事前バッチで静的配信し、「人口・観光地など属性」は runtime SPARQL + Cache API で取る。Issue #37 と #38 を分けたのはこの原則。応用として、もし #38 で取る属性も同等の頻度でしか変わらないなら、QID と一緒に JSON に同梱して runtime クエリ自体を消した方がシンプル
- **5桁→6桁(チェックデジット付き)変換の責任の局在化**: N03_007 は5桁、Wikidata P429 はチェックデジット付き6桁。SPARQL 側で `STRSTARTS(?code6, ?code5)` で吸収する選択の本質は「チェックデジット仕様は Wikidata 側に持たせる責任の局在化」。クライアント計算するとミスで政令市区(14101/14102)を取り違える事故が起き、Generator が完全に間違った Wikipedia 抜粋で堂々と作文するハルシネーションになる。サーバ負荷は副次的論点
- **SPARQL サーバ負荷を気にする/しないの分岐**: オフラインバッチ(1 回限り、4 クエリ、各 5〜10 秒)では実質問題にならない。runtime で毎リクエスト同じクエリを叩く設計のときだけ重さを評価対象に入れる
- **Wikipedia と Wikidata の役割分担**: 自由文 Wikipedia は文脈と表現に強いが、LLM が引きにくい固有名詞・属性の在庫を補うのは構造化データの Wikidata。Generator 用の RAG コンテキストとして「自由文(Wikipedia 抜粋) + 構造化属性(Wikidata)」を並列に渡せば、両者の強みを足し合わせられる

---

## 4.22 Plan H 起案と AWS ベストプラクティス調査（2026-05-08）

### 4.22.1 起案の決め手

- 2026-05-08 の S3 テレメトリ集計（Plan E 対象 18 件、期間 2026-04-26〜2026-05-07）で合格率 0/18、accuracy 平均 2.56、specificity 平均 2.67、density 平均 2.67、season_fit のみ 4.22
- G-1（プロンプト緩和、2026-05-07 反映）後のデータがほぼゼロのため G-1 単独効果は未評価。にもかかわらずユーザー判断で「現状実用に耐えない」と判定し、Plan G の RAG 拡張投資（G-2/G-3/G-4）より先に LLM 自体の切替（Plan H）を選んだ
- ユーザーが Generator + Judge 両方を Nova Pro に切替える選択をしたのは、Anthropic API キー撤廃・AWS 認証一本化・Judge コスト削減（Sonnet 4.6 入力 $3/出力 $15 → Nova Pro 入力 $0.80/出力 $3.20、約 1/3）の運用メリットを優先した判断。self-preference bias（Nova が Nova を甘く採点）のリスクは「現状より明らかに良く見える / 悪く見える」の二値判定で割り切り、最終ゲートは人間の実走体験

### 4.22.2 AWS Bedrock ベストプラクティスから採用した方針

`aws-core:amazon-bedrock` スキルを参照して以下を採用：

- **cross-region inference profile を使う**: 単一 base model ARN（`amazon.nova-pro-v1:0`）ではなく、`us.amazon.nova-pro-v1:0`（us-east-1 / us-west-2 / us-east-2 自動分散）を採用。Bedrock スキルでは「`us.` プレフィックス profile 使用が推奨、高スループット・障害耐性、データは US 内に滞在」とされており、PoC スケールでも将来の throttle 耐性のために最初から profile を採用
- **`maxTokens` は必ず明示**: Bedrock スキルの Critical Warning に「未設定はモデル最大値（例: Claude Sonnet で 64K）を quota 予約 → ThrottlingException の主因」と明記。Nova Pro でも同様。Generator 200 / Judge 1024 を目安にコード実装で必ず設定
- **Converse API を使う（InvokeModel ではなく）**: Bedrock 全モデル統一形式、provider-specific body format の罠を回避（Anthropic ≠ Titan ≠ Llama ≠ Nova で InvokeModel body 形式が異なり Malformed input request が出やすい）
- **`bedrock:InvokeModel` の Resource を ARN で限定**: `bedrock:*` や `AmazonBedrockFullAccess` は禁止。最小権限で profile ARN + 3 リージョンの base model ARN を列挙（cross-region inference では profile が選んだリージョンで base model 呼出が発生するため両方の許可が必要、片方欠けると AccessDeniedException）
- **CloudTrail で Bedrock API 呼出を監査**: 2026-05-08 に Control Tower の `aws-controltower-BaselineCloudTrail` で multi-region・global service events 含む形で既に有効を確認、追加設定不要
- **Bedrock Model Invocation Logging（CloudWatch / S3 詳細ログ）は OFF で出発**: 既存の S3 テレメトリで運用上のニーズはカバー、必要になれば後付け

### 4.22.3 ベストプラクティスからの妥協（明示）

- AWS 公式は **IAM ロールを推奨**（IAM ユーザー長期キーは非推奨）。Cloudflare Workers のような AWS 外環境では本来 OIDC + `sts:AssumeRoleWithWebIdentity` での短期トークン化が望ましい。trip-road は PoC 個人利用なので IAM ユーザー継続、将来課題として todo に記録（既存 S3 アクセスでも同じ妥協を踏襲）
- アクセスキーローテーションも継続未着手、将来課題

### 4.22.4 Bedrock コンソールでのモデルアクセス申請が不要だった件

- 当初の Plan H では「H-2: Bedrock コンソールで Nova Pro モデルアクセス申請・有効化（手作業）」を含めていた
- 2026-05-08 に CLI 確認で `amazon.nova-pro-v1:0` および `us.amazon.nova-pro-v1:0` ともに ACTIVE、申請なしで `aws bedrock-runtime converse` が成功（admin 権限の `tetutetu` ユーザー認証で）
- Anthropic Claude や Meta Llama などサードパーティモデルは EULA 合意が必要だが、Amazon の自社モデル（Nova / Titan）は申請不要で即利用可能というのが確認できた知見
- 教訓: Bedrock のモデルアクセス申請の要否は「モデル提供者が AWS 自身か否か」で大きく違う。次に他社モデルを使うときは申請ステップを忘れない

### 4.22.5 H-1 IAM ポリシー追加のハマりどころ予防メモ

- IAM ポリシーは即時反映ではなく **eventual consistency**。put-user-policy 直後に Bedrock を叩くと AccessDeniedException が出る場合あり、数秒〜数十秒の伝播遅延を見越す
- inference profile を使うときは profile ARN 単体では足りず、profile が転送する各リージョンの base model ARN も Resource に含める必要がある（Bedrock スキルの「Cross-region model not found」関連で類似の罠が記載されている）
- IAM ポリシー JSON に Account ID が含まれるが、`~/.claude/CLAUDE.md` ルールで「AWS識別情報をdocsに書かない」のため docs/ には `${ACCOUNT_ID}` 表記で残し、コマンド実行時に `aws sts get-caller-identity` で動的取得（Account ID 自体は `~/.secrets/` 配下に保存）

### 4.22.6 H-1 完了時の動作確認結果

- 2026-05-08 に Workers IAM 認証（`trip-road-telemetry-writer`）で Bedrock Converse API 呼出に成功
- modelId: `us.amazon.nova-pro-v1:0`、入力 32 token / 出力 166 token、レイテンシ 2068 ms
- 出力: 「処暑の頃の小田原市」のテーマで日本語生成 OK、現状仕様の 120-180 字よりやや長め（200 字程度）→ プロンプト調整で吸収する余地あり、これは H-6 でやる
- 日本語生成品質の所感: 固有名詞（相模湾、小田原城、鈴廣かまぼこの里、城下町）を Wikipedia 抜粋なしでも自然に挿入できており、Plan G の RAG 拡張なしでも accuracy が改善する可能性が見えた

### 4.22.7 H-11 本番反映（2026-05-09）の所感

- PR #41（`feature/nova-migration` → main）マージ完了 (`39814b2`)
- 反映前のスクリプト整合修正（`c7826cf` / `42af720`）でハマりどころ 3 つを潰した:
  - `deploy_production.sh` が `wrangler secret put ANTHROPIC_API_KEY` を毎回上書きしていた（Plan H で撤廃したのに）
  - テストボディが旧スキーマ `season:"spring"`（Plan E で `solar_term:"07"` に変えていたが反映漏れ）
  - `curl -sv` が APP_PASSWORD ヘッダを画面に出していた（メモリ「シークレットのマスク出力禁止」違反）
  - `ALLOWED_ORIGIN_PROD` が `pages.dev` で `update_allowed_origin.sh` の独自ドメインと衝突 → 本番運用で CORS が壊れる構造 → 統一
- Worker Version `c6ed26b0-a78f-4f73-a0f4-70c3566a4aec` で本番反映、`bash workers/deploy_production.sh` のテスト 1〜3 は全て期待通り（200 / 401 / 404）
- ANTHROPIC_API_KEY を即削除（てつてつ判断）、Workers Secrets は 6 種に整理
- 削除後の千代田区テストでも /api/describe は HTTP 200 を返し、Plan H 構成だけで完全に動作することを確認
- 初期所感（2 件のみ）:
  - **accuracy 軸が劇的に改善** （相模原市緑区 5、千代田区 4）。Plan E 期は 2.56 平均だったので、Nova Pro の素の固有名詞表現が Wikipedia なしでも機能している
  - **specificity / density は依然弱い**（汎用フレーズ・情緒修飾が残る）。H-6 のプロンプト再チューン候補
  - judge の deductions 書式に違和感（accuracy 軸で「Wikipedia 抜粋なしだが地理常識として妥当」のような肯定的内容が deductions 配列に入る）→ judge プロンプト解釈の余地あり、観測続けて頻発するなら H-6 で対処
  - self-preference bias（Nova→Nova の甘採点）の有無は人間の実走体験で判定する（H-12 観測）

### 4.22.8 教訓

- Plan の整合性検証は「実装コード」だけでなく「運用スクリプト」「~/.secrets/」「Workers Secrets の登録状態」「ドキュメントの古いスキーマ」もスコープに入れる必要がある。今回 `deploy_production.sh` の旧スキーマ（season:"spring"）と ANTHROPIC_API_KEY 登録ステップは Plan E 反映時から残っていた残債で、本番反映の直前に発覚した
- 「破壊的操作（シークレット削除）」と「観測ゲート（H-12）」のトレードオフは、てつてつのリスク許容度で決まる。Plan H は「即削除」を選んだが、もし観測中にロールバックが発生した場合は ~/.secrets/trip-road.env の旧キー（過去払い出し済）から `wrangler secret put ANTHROPIC_API_KEY` で復旧可能。ロールバック手順書は `docs/plan.md` 12.2 と PR #41 の説明にあり

---

## 4.23 Judge 軸違い不当減点の発見と修正（2026-05-09、PR #42）

Plan H 本番反映直後（2026-05-09 朝）に H-12 観測フェーズに入ったが、てつてつから「自分は旅行系 YouTuber ではないので同じ場所にしか行かない、サンプルが自然に増えない」と指摘があり、実走観測モデルが破綻していることを認めた。バッチ curl 評価に切り替えたところ、軸違い不当減点が大量に観測され、当日中に修正・本番反映まで到達した。

### 4.23.1 評価モデルの転換（実走 → バッチ curl）

- trip-road はユーザ 1 人、移動範囲が固定、合格時のみキャッシュ書込のため、実走でサンプルが自然に増えない構造。todo.md 旧版は「1〜2 週間の実走で 10 件以上」を H-12 の前提にしていたが、てつてつの利用形態では永遠にサンプルが集まらない
- `docs/analysis/run_sweep.sh` を新設。神奈川県内 10 市町村（横浜市中区／鎌倉市／箱根町／三浦市／相模原市緑区／平塚市／小田原市／秦野市／真鶴町／厚木市）を地理特性ミックスで選び、`/api/describe` に curl で順次 POST、レスポンスを JSONL で保存し軸別平均と合格率を集計
- 1 回の sweep で 10 件取れる。Nova Pro なら数十円〜100円程度のコスト。プロンプト・モデル変更の効果測定のベースラインに使う
- メモリ `project_trip_road_batch_eval.md` に「実走観測ではなくバッチ評価で測る」を保存、H-12 観測の進め方を恒久的に書き換え

### 4.23.2 バッチ評価で観測された不当減点パターン（3 種類）

5/9 17:18 の 1 回目 sweep（修正前、Plan H × G-1 反映済み）で accuracy 軸の deductions ほぼ全件が不当減点だった。3 パターンに分類:

1. **軸違い（最多）**: 「Wikipedia と重複・冗長・簡潔さに欠ける」を accuracy で減点
   - 横浜市中区「冗長かつ不自然な表現」
   - 鎌倉市「Wikipedia 抜粋と重複、簡潔さに欠ける」
   - 箱根町「Wikipedia 抜粋と重複、簡潔さを欠く」
   - 秦野市「Wikipedia 抜粋と重複、簡潔さに欠ける」
   - 厚木市「Wikipedia 抜粋と重複」
   → これらは density (軸 4) または specificity (軸 2) の責任で、accuracy が触ってはいけない領域
2. **Plan G-1 違反（記載なし減点の再発）**: 「Wikipedia に記載されていないため」を理由に減点
   - 平塚市「Wikipedia には特例市であることは記載されていないため」
   - 平塚市「Wikipedia には年号が記載されていないため」
   - 秦野市「Wikipedia 抜粋に記載がなく、地理常識としても説明不足」
   → G-1（5/7 反映）で禁じたはずなのに、Nova Pro が「直接矛盾ではない」と自認した上で減点していた
3. **季節整合の軸違い**: 「立夏に春節祭は時期不一致」を accuracy で減点（横浜市中区）
   → 季節と矛盾する記述は season_fit (軸 3) の責任で、accuracy ではない（事実誤認の検出としては正当だが、軸が違う）

修正前の集計: 合格 2/9、accuracy 平均 3.38、specificity 2.63、season_fit 4.00、density 3.00

### 4.23.3 修正内容（PR #42、`fix/judge-axis1-axis-separation`）

`workers/src/judge_prompts.js` の `buildFactualityPrompt` を 2 方向で強化:

**観点ブロックの構造化**: 単一段落だった観点を「【この軸で評価する】」「【この軸で評価しない（他軸の責任）】」の 2 ブロックに明示分離。「冗長」「簡潔さ」「年号が記載されていないため」など不当減点の典型理由を文言で禁止する 1 文も追加。

**Few-shot 拡張（3 → 5 例）**:
- 例 C 新規: Wikipedia と重複だが事実は正しい → 5 点
  - 「箱根町は神奈川県西部、足柄下郡に位置する観光地。芦ノ湖や箱根温泉、箱根神社で知られる。」→ 5 点（軸 4 の評価で扱うため accuracy では触れない）
- 例 D 新規: 季節と矛盾するが accuracy では減点しない → 5 点
  - 「立夏のころ、横浜中華街では春節祭が開催される。」→ 5 点（軸 3 の責任で accuracy では減点しない）
- 既存例 A / B / 旧 C は維持（旧 C は例 E に改名）

`workers/test/judge_prompts.test.js` に Few-shot 例 C / 例 D / 軸違い分離セクションのアサーションを追加し、軸 1 関連 18 件 / worker 全体 134 件すべて pass を確認。

### 4.23.4 Before / After（神奈川 10 市町村 × 立夏、Plan H Nova Pro）

| 指標 | 修正前 17:18 | 修正後 17:29 | 変化 |
|---|---:|---:|---:|
| 合格率 | 2/9 (22%) | 8/10 (80%) | +58pt |
| accuracy 平均 | 3.38 | 4.88 | +1.50 |
| specificity 平均 | 2.63 | 2.75 | +0.12 |
| season_fit 平均 | 4.00 | 4.38 | +0.38 |
| density 平均 | 3.00 | 2.88 | -0.12 |
| accuracy 軸の不当減点 | ほぼ全件 | ゼロ | 消滅 |

修正後 accuracy 軸 deductions が空（5 点満点）の市町村: 横浜市中区／箱根町／三浦市／平塚市／小田原市／秦野市／厚木市 の 7 件。残り 1 件（真鶴町）は Judge が「直接矛盾」と判定（保守的判定の可能性、観測継続）。

NG 2 件（鎌倉市 110 字 / 相模原市緑区 113 字）は文字数下限 120 字を割って機械判定で NG → Generator の出力長問題で軸 1 修正の対象外。

### 4.23.5 残課題（本 PR の対象外）

- **Generator 出力長**: 文字数 NG が 10 件中 2 件発生。Generator プロンプトの「120〜180 字」指示の強化、または下限緩和を検討（独立 Issue 起票候補）
- **specificity / density が低め**（2.75 / 2.88）: 「初夏の気配」「新緑が鮮やか」など汎用フレーズが残る。Generator 側の強化（Wikipedia 抜粋の活用、固有名詞要求）または specificity / density 軸の Few-shot 強化
- **真鶴町の保守的判定**: 「真鶴半島とその周辺からなる」を Wikipedia「町域の半分は三方を海に囲まれる」と直接矛盾と判定。実際には同一事実を別の角度から述べているだけで矛盾ではない可能性あり。観測続けて頻発するなら例 F（地理常識として整合する別表現は減点しない）の追加検討

### 4.23.6 教訓

- **観測サイクルが回らない設計は早期に検出すべき**: Plan H 反映時の H-12 計画で「1〜2 週間の実走」と書いた段階で、ユーザ 1 人 + 移動範囲固定 + 合格時のみキャッシュ書込の3 条件が揃っているとサンプルが集まらないことに気づくべきだった。同じプロジェクトの将来計画でも、評価サイクルの実現可能性を最初に検証する
- **Few-shot は OK パターンを複数出して軸の責任範囲を体感させる**: G-1 で 3 例（OK整合 / OK記載なし / NG矛盾）に増やしたが、軸違いの OK パターン（重複だが事実は正しい / 季節矛盾だが軸違い）が抜けていた。Judge は「OK の例にないパターン」を見ると NG 寄りに倒れる。OK 側の網羅性が NG 側の防衛より重要
- **軸の責務分離は「禁止文言」と「振り分け先の明示」で伝える**: 「軸違いの問題は減点しない」だけでは弱い。「これは軸 4 の責任」「これは軸 2 の責任」と振り分け先まで明示することで Judge が「軸 1 で何を見ないか」を理解できる
- **バッチ評価ツールの存在価値**: Judge プロンプト変更の効果が 11 分（17:18 sweep → 17:29 sweep）で検証できた。今後のプロンプト・モデル変更でも `run_sweep.sh` を default の検証手段として使う。Plan G-5 の meta-eval セット作成も独立して進める価値あり

---

## 4.24 Plan I 実装と本番反映（2026-05-12、Wikipedia 要約特化）

### 4.24.1 起案の決め手

Plan H で Nova Pro 移行（2026-05-08）→ Plan G-1.5 で軸違い不当減点を修正（2026-05-09）して 80% 合格率を達成したが、てつてつが本番運用で「間違いが多すぎて読む気がしない」と判断。テレメトリ 5/10〜5/11 がゼロ件に。

Judge スコア上の合格率と、てつてつの体感品質に大きな乖離があった原因を 5/11 のサンプル 1 件（海老名市・立夏）で確認したところ、Judge プロンプトは「Wikipedia 記載なしは減点対象外」と明示しているにもかかわらず、Nova Pro が「Wikipedia と表現が重なる」「独自性に欠ける」のような禁則違反の理由で減点していた一方、本物のハルシネーション（タマネギ・メロンなど抜粋外の特産品創作）はスルーされていた。

検討の結果、Judge プロンプトをさらに強化する方向ではなく、タスクそのものを「未知の創作」から「既知の圧縮（要約）」に倒すことで、Generator の自由度を構造的に狭めてハルシネーション源（LLM 内部知識補完）を断つ方針を採用。

### 4.24.2 採用した方針

- **Wikipedia 抜粋を「事実検証用の参照」から「唯一の情報源（context）」に格上げ**
- 二十四節気は廃止（`solar_term_meta.js` / `season.js` / `cache.js` 削除）
- Judge は 4 軸 → Faithfulness 1 軸に簡素化（`out_of_kb_terms` で抜粋外固有名詞を列挙）
- Wikipedia 抜粋が取れない市町村は Generator を呼ばずに「記事なし」をフロントで表示（in-context 原則をエラー時にも適用）
- Judge NG + 再生成 NG の場合は Wikipedia 抜粋を機械的に転載するフォールバック追加（`truncateExtractForFallback`）
- 字数下限を 120 → 60 に緩和（短い記事の市町村への対応）
- テレメトリスキーマ刷新（旧 `critic_*` → 新 `faithfulness_score` / `out_of_kb_terms` / `fallback_to_extract` / `no_wikipedia` / `wikipedia_extract_length`）、過去 37 件は `s3://trip-road-telemetry-tetutetu214/legacy/` に退避

### 4.24.3 神奈川 10 市町村 sweep 結果（2026-05-12 20:44）

| 指標 | Plan G-1.5（2026-05-09） | Plan I（2026-05-12） |
|---|---:|---:|
| 件数 | 10 | 10 |
| 合格（passed=true） | 8/10 (80%) | 6/10 (60%) |
| 抜粋転載フォールバック | n/a | 2/10 (20%) |
| no_wikipedia | n/a | 2/10 (20%) |
| faithfulness_score 平均（合格者） | n/a | 5.0 |
| **out_of_kb_terms 検出（=ハルシネーション）** | n/a | **0/10** |

主な変化:
- **抜粋外の固有名詞混入が 10 件中 0 件**: Plan I の最大目標達成
- 合格率 80% → 60% への見かけ低下は内訳が違う。Plan I では `no_wikipedia` / `fallback_to_extract` も独立カウントで、いずれも「ハルシネーションを出さない」設計上の安全弁が機能した結果
- Plan G-1.5 で字数下限 120 を割って NG になっていた市町村（相模原市緑区 113 字 / 鎌倉市 110 字）は、字数下限 60 への緩和で正常合格に移行

### 4.24.4 残課題（Plan I Phase 2 候補）

- **政令指定都市の区の Wikipedia 取得失敗**: 横浜市中区・相模原市緑区が `no_wikipedia` になった。Wikipedia 側の正式記事タイトルは「中区 (横浜市)」「緑区 (相模原市)」のように都市名がカッコ内の形式で、`resolveWikipediaTitle` の attempt=0（`municipality` そのまま）/ attempt=1（`{municipality} ({prefecture})`）では到達できない。新 attempt（カッコ内に親市町名）の追加 or 公式 ID マッピングが必要
- **Faithfulness Judge の指示無視リスク**: 今回 Nova Pro Judge は機能したが、Plan G-1.5 と同種の指示無視リスクは残る。Phase 2 で形態素解析ベースの決定論的検査への置換を検討
- **抜粋転載フォールバック時の体裁**: 箱根町・秦野市は「〜町。」で 1 文転載のみで終わって体裁が悪い。`truncateExtractForFallback` の改善余地（最低字数を意識した複数文連結）

### 4.24.5 教訓

- **タスク変更はプロンプト調整より効く**: G-1.5 で Judge プロンプトを軸違い禁止で締めて 80% 合格率を達成したが、Nova Pro の指示無視リスクは残ったまま。Plan I では「Generator が抜粋外を出さない」をタスクレベルのハードルールにしたことで、Judge の精度に依存しない品質保証が可能に。プロンプト調整は局所最適、タスク選択が大域最適
- **Nova Pro でも要約タスクなら指示を守る**: Plan H 以降「Nova Pro は指示を守らない」と諦めていたが、それは creative writing タスクでの話。要約という制約の強いタスクでは Nova Pro でも安定動作する。モデル能力よりタスク設計が最大のレバー
- **「諦める判断」は前進**: てつてつから「やりたいことが現状できないことがわかったのでいいいです」という決断があり、季節感を捨てる方針に転換。LLM の「できないこと」を見極めて要件を再定義することは、プロダクトとして前進
- **集計値と体感のずれは内訳で潰す**: G-1.5 で「合格率 80% 達成」と数字上は良かったが、てつてつの体感は「間違いが多い」だった。これは Judge が見落としているハルシネーションが残っていたため。Plan I で `out_of_kb_terms`（抜粋外固有名詞）という新指標を導入したことで、Judge スコアと体感品質の乖離を観測可能に

---

## 4.25 Plan I Phase 2-1: 政令指定都市の区で Wikipedia 取得失敗を修正（2026-05-12 夜）

### 4.25.1 観測された問題

Plan I 本番反映後の sweep（2026-05-12 20:44）で、横浜市中区・相模原市緑区が `no_wikipedia: true` となり Generator を呼ばずに「この市町村の Wikipedia 記事が見つかりませんでした」表示になっていた。横浜市中区はてつてつのホーム周辺、相模原市緑区は今回のテスト対象に含まれていたため、体験上のインパクトが大きい。

### 4.25.2 原因

Wikipedia 側の正式記事タイトルは「中区 (横浜市)」「緑区 (相模原市)」のように `{区} ({親市町})` 形式。一方、N03 由来の `municipality` は「横浜市中区」「相模原市緑区」のように `{市}{区}` で連結された 1 トークン。`resolveWikipediaTitle` の既存 attempt（attempt=0:「横浜市中区」そのまま、attempt=1:「横浜市中区 (神奈川県)」）では到達できない構造だった。

### 4.25.3 修正

`workers/src/wikipedia.js` の `resolveWikipediaTitle` に attempt=2 を追加。`municipality` を正規表現 `^(.+市)(.+区)$` で分解し、マッチすれば `{区} ({市})` 形式に変換:

- 「横浜市中区」 → 「中区 (横浜市)」
- 「相模原市緑区」 → 「緑区 (相模原市)」
- 「川崎市麻生区」 → 「麻生区 (川崎市)」

`MAX_TITLE_ATTEMPTS` も 2 → 3 に拡張。東京 23 区は「中央区」のように `municipality` に「市」を含まない名前で渡るため正規表現に該当せず、attempt=0 で Wikipedia に到達可能(redirects=true 経由)。不要な fallback を走らせない設計。

### 4.25.4 結果（2026-05-12 20:59 sweep）

| 指標 | Phase 2-1 前 | Phase 2-1 後 |
|---|---:|---:|
| no_wikipedia | 2/10 (20%) | **0/10 (0%)** |
| fallback_to_extract | 2/10 | 4/10（記事なし 2 件がフォールバック転載へ移行） |
| 合格（passed=true） | 6/10 | 6/10 |
| out_of_kb_terms | 0/10 | 0/10 |

横浜市中区・相模原市緑区とも Wikipedia 抜粋取得に成功（length=32, 33）。ただし抜粋が短いため Judge NG → 再生成 NG → フォールバック転載で「中区（なかく）は、横浜市を構成する 18 行政区のうちの一つである。」のような 1 文表示に。「記事なし」よりは確実に良い体験で、Phase 2-1 のゴール「no_wikipedia 撲滅」は達成。

### 4.25.5 残課題（Phase 2 後続）

- **抜粋本文が薄い**: Wikipedia API の `exintro=true`（intro section のみ取得）により、政令市の区など intro が短い記事では `wikipedia_extract_length=32` 程度しか取れない。`exintro` を外す or `exsentences=N` で文数指定する方が豊富な抜粋を取れる可能性。Phase 2-3（抜粋転載体裁改善）と統合検討
- **形態素解析ベースの Faithfulness Judge**: Plan I 元の残課題のまま、Phase 2-2 候補で継続

### 4.25.6 教訓

- **テスト命名規則の検証**: N03 で「{市}{区}」と連結する命名規則と、Wikipedia 側の `{区} ({親市町})` 命名規則の食い違いは、両者を行き来する処理を書く時に必ずチェックすべきポイント。今後 OpenStreetMap や Wikidata と接続するときも同じパターンの問題が出る可能性が高い
- **「不要な attempt は走らせない」設計**: 東京 23 区も `区` で終わるが、attempt=2 の正規表現に意図的にマッチさせない（「市」が含まれないため）。23 区は attempt=0 の redirects=true で到達できるため、attempt=2 を走らせるとコストとレイテンシの無駄になる。「動くなら早く落とす」原則
- **小さな修正の単離価値**: Plan I 本番反映と同日に Phase 2-1 を独立 PR で出した。1 つの大きな PR にまとめるより、責任範囲を明確にして観測しやすくする方が効率が良い

---

## 4.26 Plan I Phase 2-3: Wikipedia 抜粋を intro 限定から本文全体へ（2026-05-12 夜）

### 4.26.1 観測された問題

Plan I Phase 2-1 で政令市の区での Wikipedia 取得は通ったが、`exintro=true` で intro section のみ取得していたため `wikipedia_extract_length` が 25〜33 字程度と短く、Generator がカーナビ風 3-4 文を組み立てるには情報不足。Judge NG（短すぎ・抜粋から要素が引けない等）→ 再生成 NG → フォールバック転載（1 文の機械転載）になっていた市町村が 4/10。

### 4.26.2 修正

`buildWikipediaUrl` から `exintro: 'true'` を削除し、本文全体（plaintext）を取得するように変更。`MAX_EXTRACT_LENGTH = 1500` で末尾切り詰めは `cleanExtract` が担当。

旧抜粋が Workers Cache に 30 日 TTL で残るため、`buildCacheKey` の URL prefix を `/<muni>` → `/v2/<muni>` に上げて旧キャッシュを実質無効化。デプロイ直後から新ロジックで再キャッシュさせた。

### 4.26.3 結果（2026-05-12 22:59 sweep）

| 指標 | Phase 2-1 後 | Phase 2-3 後 |
|---|---:|---:|
| 合格（passed=true） | 6/10 (60%) | **10/10 (100%)** |
| fallback_to_extract | 4/10 (40%) | **0/10 (0%)** |
| no_wikipedia | 0/10 | 0/10 |
| out_of_kb_terms 検出件数 | 0/10 | 3/10（許容範囲、全件 score ≥ 4） |
| faithfulness_score 平均 | 5.00 | 4.80 |
| wikipedia_extract_length | 25〜158 字 | 全件 1500+ |

**合格率 60% → 100%**。fallback_to_extract が 0 になり、全 10 市町村で Generator が生成した自然な 120-180 字の要約が表示されるように。

実際の生成例（横浜市中区）:
> 横浜市中区は神奈川県庁および横浜市役所が所在する行政区です。関内地区は開港以来の横浜の中心市街地であり、現在も行政の中心地です。横浜中華街や山下公園、伊勢佐木町、元町などの繁華街や観光地が集中しています。また、本牧地区はかつてアメリカ軍に接収され、現在も一部が米軍住宅地として残っています。

実際の生成例（鎌倉市）:
> 鎌倉市は神奈川県の南東部、三浦半島の西側付け根に位置する。南は相模湾に面し、北は逗子市、東は藤沢市、西は横浜市に接している。人口は約 17 万人。鎌倉市は古都保存法の「古都」に指定されている。市内には滑川、柏尾川、神戸川など二級河川が流れ、南海トラフ巨大地震の際には最大 8m の津波が予想されている。

抜粋にある事実だけを使った、カーナビ風の淡々とした要約が安定して得られるようになった。

### 4.26.4 副作用と観測

- **faithfulness_score 平均が 5.0 → 4.8 に微減**: 本文が厚くなったことで Judge が抜粋外の表現を見つけやすくなった可能性。ただし全件 score ≥ 4 で合格しているため運用には支障なし
- **横浜市中区・小田原市で `out_of_kb_terms` が検出された**: 「本牧地区はかつてアメリカ軍に接収され」「施行時特例市」「東海道小田原宿」など。これらは抜粋本文には実際に含まれているはずだが、Nova Pro Judge が照合を見落としている。Phase 2-2（形態素解析ベースの決定論的検査）で根本対策

### 4.26.5 残課題

- **Faithfulness Judge の決定論化**（Phase 2-2 候補）: 上記 `out_of_kb_terms` 誤検知のように、Nova Pro Judge は本文との照合で見落とすパターンがある。Workers 上で動く形態素解析器（kuromoji-tiny 等）を調査
- **wikipedia_extract_length が常に 1500+**: 全市町村で `MAX_EXTRACT_LENGTH` の上限ピッタリになっている。Wikipedia 記事が 1500 字を超える市町村が大半（intro が短くても全文は長い）であることが確認できた。1500 字制限を 2000-3000 字に上げる余地もあるが、Workers のレイテンシと Bedrock の input tokens 課金とのトレードオフで現状維持

### 4.26.6 教訓

- **「適切な context 量」は仮定で決めず観測で決める**: Plan I 起案時は intro section（数百字）で十分と想定していたが、政令市の区など intro が極端に短い記事の存在を見落としていた。デプロイ後の sweep でパーティション別の `wikipedia_extract_length` を観測することで、ボトルネックが「抜粋の薄さ」だと特定できた
- **キャッシュ無効化は version suffix で**: 取得ロジックを変えるたびにキャッシュ TTL の自然消滅を待つのは現実的でない。`buildCacheKey` の URL に version segment を入れて、ロジック変更時に suffix を上げる方式は軽くて効果的
- **「抜粋外」と Judge が判定したが実は抜粋内にある**ケースは、Nova Pro の照合精度限界。in-context での文字列マッチを LLM に任せるのは本質的に脆く、決定論的検査の方が安定するはず（Phase 2-2 の動機強化）

---

## 4.27 Plan G-3 / Issue #37: Wikidata QID マッピング表のオフライン生成（2026-05-22）

### 4.27.1 背景と目的

Wikipedia 単独 RAG では特別区・小規模町村など intro が薄い記事で固有名詞の在庫が不足し、Generator が萎縮するリスクが残る。Wikidata の構造化属性（観光地・特産品・隣接自治体）を併用するため、その「同定キー」になる「市町村コード → QID」のマッピング表を 1 回だけオフラインで生成する。これは Issue #38（Workers ランタイムから SPARQL を叩いて属性を取得）の前提となる。

データの変動頻度に応じた責務分離：
- 同定キー（QID）は年単位でしか変動しない → 事前バッチで静的配信（#37、本章）
- 属性（人口・観光地等）は月〜年単位で変動 → runtime SPARQL + Cache API（#38、別タスク）

### 4.27.2 設計上の罠と回避策

**N03 は 5 桁、Wikidata P429 は 6 桁（チェックデジット付き）**

スモークテスト段階で発見。Issue 本文の SPARQL 例 `?city wdt:P429 "<コード>"` を 5 桁文字列でそのまま叩くと 0 件返る。例:
- 千代田区: N03_007 = `"13101"`、Wikidata P429 = `"131016"`

**STRSTARTS による責任の局在化**

クライアント側でチェックデジット計算式（モジュラス11、ウェイト6,5,4,3,2）を実装する選択肢もあるが、計算式に端数処理のバリアントがあり、ミスると 横浜市鶴見区(14101) と神奈川区(14102) で QID を取り違えて Generator が完全に間違った Wikipedia 抜粋で堂々と作文するハルシネーション事故が起きる。

そこで `?city wdt:P429 ?code6 . FILTER(STRSTARTS(?code6, ?code5))` で WDQS 側に吸収させた。P429 を持つレコードは日本の市区町村だけ（≈2000件）なので、フィルタは Wikidata 全体ではなく 2000 件に対して走り、サーバ負荷は実用上問題なし。「責任の局在化（チェックデジット仕様は Wikidata 側が持つ）」「YAGNI（自前で計算式を書かない）」が設計原則。

### 4.27.3 結果

| 指標 | 値 |
|---|---|
| カバレッジ | **1905 / 1905 = 100%**（Issue 目標 95% を上回り） |
| 緯度経度欠損 | 0 件 |
| ja Wikipedia タイトル欠損 | 0 件 |
| ファイルサイズ | 292 KB（Issue 想定 100 KB の約 3 倍、緯度経度の小数 9 桁が主因） |
| 実行時間 | 2 分 6 秒（20 バッチ × 平均 4〜6 秒 + バッチ間 2 秒スリープ） |

政令市の区も親市と区別して取得できており、`14101 → "鶴見区_(横浜市)"` のように Wikipedia の正式記事タイトルがそのまま入る。これは workers/src/wikipedia.js の `resolveWikipediaTitle` の attempt=2（`{区} ({市})` 形式生成）と整合し、**Issue #15（政令市の区名表示精度）も Wikidata QID 経由で同時解消できる見込み**。

### 4.27.4 ハマったポイントと対処

**WDQS の 60 秒ハードタイムアウト**

初回実走で batch-size=500 + STRSTARTS のクエリが 60 秒を超えて全件 TimeoutError 発生。対処は単純に batch-size=100 に下げる + `--timeout=90` の CLI 引数追加。クエリの最適化（STRSTARTS をやめる等）よりも、バッチサイズで攻める方が安全。バッチ間 2 秒スリープと合わせて、1 回限りの実行なら全体 2 分で完結する。

教訓：**SPARQL の VALUES サイズは「サーバ側のタイムアウト」と「クエリの計算量」の両方で制限される**。WDQS は public service なので、フェアユース範囲で運用するなら batch ≤ 100 が安全圏。

### 4.27.5 残課題と観測項目

- **duplicate binding 警告（9 件程度）**: 45206 / 46208 / 47324 等で同じ N03 コードに対して複数 QID が返ってくる。Wikidata 側に合併前後の歴史的エンティティが残っていると推測。最初のエントリ採用で実用上は問題なし。Issue #38 で属性取得時に、現代の自治体（行政区分）以外を弾くフィルタを SPARQL に入れる余地あり
- **ファイルサイズが Issue 想定の 3 倍**: 緯度経度の小数 9 桁が原因。Wikidata 由来をそのまま採用したが、5 桁に丸めれば約 200 KB まで縮む。Cloudflare Pages の配信制限（25 MB）には余裕、現状維持で問題なし。サイズ最適化が必要になったら lat/lon の小数桁丸めで対処
- **重複binding を弾く SPARQL フィルタの実験**: `FILTER NOT EXISTS { ?city wdt:P576 ?dissolved }` で廃止された自治体を除外する案。Issue #38 のときに試す

### 4.27.6 教訓

- **「説明情報先を増やす」のロードマップにおいて、同定キーと属性は別タスク**: 変動頻度の違いに応じて取り方を分けるのが筋。同じ Wikidata からの取得でも、事前バッチで足りるもの（QID）と runtime で取るべきもの（属性）を切り分けることで、本番アクセスごとの SPARQL クエリ数を最小化できる
- **責任の局在化はクライアント側の計算量より大事**: チェックデジット計算をクライアント側に書く方が「サーバ負荷ゼロ」で「速い」が、計算ミスは政令市の区を取り違える致命的バグになる。STRSTARTS のサーバ負荷は 1 回限りで 2 分。「クライアント側の正しさを保証しなくて済む設計」を選ぶべき
- **WDQS は public service のためフェアユース原則を守る**: User-Agent に連絡先を含める、バッチ間スリープを入れる、batch-size を抑える。これらは「動くか動かないか」だけでなく、「コミュニティに迷惑をかけないか」の判断軸

---

## 4.28 Plan G-4 / Issue #38: Wikidata SPARQL を runtime RAG に統合（2026-05-23 実装）

### 4.28.1 背景

Plan I Phase 2-3 で Wikipedia 抜粋本文全体取得を実装し合格率 100% を達成（4.26 章）したが、`out_of_kb_terms` が 3/10 検出されていた。例: 「本牧地区はかつてアメリカ軍に接収され」「施行時特例市」「東海道小田原宿」。これらは Wikipedia 抜粋には含まれないが、Wikidata の構造化属性（P150 構成地区 等）にはエントリが残っているケース。Wikidata を並行して in-context に乗せれば、Judge が「これも素材内」と判定して `out_of_kb_terms` から除外できる。

データの変動頻度に応じた責務分離（4.27 章で確立した原則）の続編：
- 同定キー (QID) → 事前バッチ＋静的配信（#37、4.27 章）
- **属性 → runtime SPARQL ＋ Cache API 30 日**（本章）

### 4.28.2 設計上の発見と確定事項

**プローブで確定した取得プロパティ 7 個**

`curl https://query.wikidata.org/sparql` で千代田区 (Q214051) / 横浜市鶴見区 (Q1202820) / 横浜市中区 (Q1141068) / 市川市 (Q209785) を実機確認し、以下のプロパティが充実度のバランスでベスト：

| ID | 表示名 | 確認例 |
|---|---|---|
| P31 | 種別 | 「日本の特別区」「日本の市」「中核市」 |
| P138 | 名前の由来 | 「千代田」 |
| P150 | 構成地区 | 千代田区 58 件、横浜市中区 15 件（**本牧含む**）|
| P190 | 姉妹都市 | 市川市 5 件（ローゼンハイム, メダン 他）|
| P206 | 隣接水域 | 市川市「東京湾, 江戸川, 旧江戸川」|
| P706 | 位置する地形 | 市川市「関東地方, 下総台地」|
| P1376 | 上位行政体の中心 | 横浜市中区→横浜市、市川市→下総国 |

**P150 上限 20 件**: 千代田区の P150 が 58 件あるため、context 膨張防止と Generator の網羅列挙禁止指示の両面で先頭 20 件に切り詰める。`formatWikidataForPrompt` で「(...58件中20件)」サフィックスを付けて省略を明示。

**並列 fetch + null fail-open**: `describe_flow.js` で `Promise.all([wikipediaFetcher, wikidataFetcher])`。Wikidata 取得失敗時は wikidataAttributes=null として Wikipedia 単独 RAG にフォールバック。Plan I の合格率 100% を絶対に下回らない fail-open 設計。

**muniCode のリクエスト追加**: Workers 側で QID を引くため、フロントが既に持つ N03_007 (5 桁) をリクエスト body に追加。古いフロントが送ってこないケースは Workers 側でオプショナル扱い、欠落時は Wikidata 統合をスキップして従来動作（後方互換維持）。

### 4.28.3 ハマリポイントと対処

**Codex バックグラウンド委譲は Bash 承認待ちで停滞**

`run_in_background: true` で codex:codex-rescue に委譲したが、Codex CLI の `node codex-companion.mjs ...` 実行に Bash 承認が必要で、バックグラウンド agent では承認 UI が出せず詰まる。foreground で起動するか、Claude が直接書く必要がある。今回は実装ボリューム（~600 行）が手の届く範囲だったため Claude 直接実装に切り替えた。

教訓：CLAUDE.md feedback_codex_delegation_protocol の「初回 foreground 承認推奨」は **同セッション内で Codex を初めて呼ぶときは必ず foreground**、と読み替えるべき。「セッション初回」ではなく「実行コンテキスト（fg/bg）初回」が正しい。memory にも追記対象。

**parseDescribeRequest の戻り値変更で deepEqual テストが落ちる**

`{prefecture, municipality}` → `{prefecture, municipality, muniCode: string|null}` に拡張したことで、既存テストの `toEqual(body)` が落ちた（受信側に muniCode が増えるため）。フィールド個別比較に変更して対処。

### 4.28.4 観測指標と判定基準

**主指標**: `out_of_kb_terms` の件数/件
- 現状: 3/10（Plan I Phase 2-3 後、4.26.4 章）
- 目標: ≤ 1/10
- 計測: 本番反映後、`docs/analysis/fetch_entries.sh` で S3 テレメトリを集計

**副指標**:
- 合格率（現状 100% を維持）
- `wikidata_attributes_length`（属性取得成功率、初回ミス時の SPARQL 安定性チェック）
- `judge_error` ／ Workers ログの 5xx／timeout 率

### 4.28.4a 本番反映直後の curl sweep 結果（2026-05-23）

`bash workers/deploy_production.sh` + `bash deploy_frontend.sh` 実行後、Workers Version `e738c315-d0a0-469d-b2cb-c5e9074a5914` で 10 件 sweep：

| muniCode | 市町村 | out_of_kb_terms | score | passed | wikidata_len |
|---|---|---|---|---|---|
| 13101 | 千代田区 | [] | 5 | ✓ | 150 |
| 14104 | 横浜市中区 | [] | 5 | ✓ | 101 |
| 14101 | 横浜市鶴見区 | [] | 5 | ✓ | 85 |
| 12203 | 市川市 | [] | 5 | ✓ | 117 |
| 11212 | 東松山市 | ['1954年に市制施行しました'] | 4 | ✓ | 35 |
| 06203 | 鶴岡市 | [] | 5 | ✓ | 94 |
| 14151 | 相模原市緑区 | [] | 5 | ✓ | 43 |
| 13110 | 目黒区 | [] | 5 | ✓ | 150 |
| 11201 | 川越市 | [] | 5 | ✓ | 181 |
| 14201 | 横須賀市 | [] | 5 | ✓ | 162 |

| 指標 | Plan I Phase 2-3 (4.26.4) | Issue #38 反映後 | 達成 |
|---|---|---|---|
| 合格率 | 100% | **100%** | ✓ 維持 |
| `out_of_kb_terms` 件数 | 3/10 | **1/10** | ✓ 目標 ≤ 1/10 |
| Wikidata 属性取得 | n/a | **10/10**（全件成功） | ✓ |

横浜市中区の生成文に「関内地区」「日本郵船歴史博物館」、相模原市緑区に「三ケ木、名倉、寸沢嵐、川尻、橋本、牧野、相原」が自然に挿入された。これらは Wikipedia 単独時代より細かい町名で、Wikidata の P150（構成地区）が in-context として効いている確証。

東松山市の唯一の `out_of_kb_terms` は "1954年に市制施行しました" で、これは Wikipedia 抜粋にも「1954年」「市制」が含まれている可能性があり、**Nova Judge の誤検知（false positive）**の疑い。Phase 2-2 の決定論的検査（形態素解析ベース）で対処する余地が残るが、Issue #38 のスコープ外。

最初の curl sweep で「相模原市緑区」の muniCode を 14150 と書いた誤りがあり、`wikidata_attributes_length: 0` が出たが、正しいコードは 14151。実装側の問題ではなくテストデータの誤り。N03 の相模原市 3 区は 14151 / 14152 / 14153 にコード割当されている。

**ロールバック手段**:
- Workers: Cloudflare ダッシュボードで前バージョンへ 1 クリック Rollback
- Pages: 同様にダッシュボードで前デプロイへ Rollback
- git revert は Workers/Pages のキャッシュとの整合が面倒なので**最終手段**

### 4.28.5 残課題

- **Phase 2-2 (Faithfulness Judge の決定論化)**: Plan I の Phase 2-2 候補は #38 完了後に再評価。Wikidata 統合で out_of_kb_terms が十分減るなら、形態素解析実装の必要性が下がる
- **wikidata.test.js のリトライテストが 12 秒**: vi.useFakeTimers で 0 秒化可能。Phase 2-2 でテスト最適化と一緒にやる
- **wikidata_qid.json の duplicate binding 警告（45206 等 9 件）**: 4.27.5 で記録。runtime SPARQL でも `FILTER NOT EXISTS { ?city wdt:P576 ?dissolved }` を入れる余地、本番観測でハルシネーション疑いが出たら検討

---

## 4.29 Plan I Phase 2-2 / Issue #52: 決定論 Judge のシャドウ運用開始（2026-05-23）

### 4.29.1 採用方針と却下した選択肢

**採用: 正規表現ベースのライト決定論 Judge**

- 漢字 2 文字以上 / カタカナ 3 文字以上 / 数字 2 文字以上を生成文から抽出
- Wikipedia 抜粋 + Wikidata 構造化属性を結合したテキストに substring として含まれるか機械的判定
- 件数 → 5 段階スコア (0→5, 1→4, 2→3, 3→2, 4+→1)
- bundle size 影響ゼロ、CPU 数十 μs、Workers と完全相性

**却下: kuromoji.js（@patdx/kuromoji）**

- 辞書 6 ファイル合計約 19 MB（gzip 圧縮済）が Workers の bundle size 制限 1 MB を超える
- CDN 経由 runtime fetch も Cold start +数秒 + メモリ 19 MB 常駐の負荷
- 「ライト案で観測してから判断」を選択（段階的アプローチ）

### 4.29.2 シャドウ運用設計

Nova Pro Judge と並列に決定論 Judge を実行し、両方の結果をテレメトリに記録：

- `deterministic_score`: 1-5 の整数
- `deterministic_passed`: 4 以上で true（Nova の PASS_THRESHOLD と整合）
- `deterministic_out_of_kb_terms`: 抽出された候補のうち kbText に含まれなかったもの

**重要**: Generator/Nova Judge の本決定経路は完全不変。ユーザ体験への影響ゼロ。

### 4.29.3 本番反映直後の curl sweep 結果（2026-05-23）

| muniCode | 市町村 | Nova s/p/n | 決定論 s/p/n | 決定論 out_of_kb |
|---|---|---|---|---|
| 13101 | 千代田区 | 5/T/0 | 3/F/2 | 司法機関, 多数立地 |
| 14104 | 横浜市中区 | 5/T/0 | 1/F/4 | 横浜市中区, 集中, 横浜港開港以降, 発展 |
| 14101 | 横浜市鶴見区 | 5/T/0 | 4/T/1 | 横浜市鶴見区 |
| 12203 | 市川市 | 5/T/0 | 4/T/1 | 有名 |
| 11212 | 東松山市 | 4/T/1 | 3/F/2 | 通過, 記載 |
| 06203 | 鶴岡市 | 5/T/0 | 1/F/4 | 山形県庄内地方, 市内, 山々, 河川 |
| 14151 | 相模原市緑区 | 5/T/0 | 4/T/1 | 東西 |
| 13110 | 目黒区 | 5/T/0 | 3/F/2 | 特徴的, 点在 |
| 11201 | 川越市 | 5/T/0 | 2/F/3 | 埼玉県中部, 町並, 点在 |
| 14201 | 横須賀市 | 5/T/0 | 5/T/0 | （なし） |

| 集計 | 値 |
|---|---|
| 判定 (passed) 一致率 | **4/10 = 40%** |
| Nova passed | 10/10 |
| 決定論 passed | 4/10 |
| Nova out_of_kb 合計 | 1 件 |
| 決定論 out_of_kb 合計 | 20 件 |

### 4.29.4 判明したライト案の限界

**1. 一般 2-3 文字漢字の false positive**

「集中」「発展」「有名」「通過」「記載」「市内」「東西」「特徴的」「点在」「町並」など、抜粋に substring として書かれていない一般語が大量検出される。これは形態素解析の品詞情報がないライト案の構造的弱点。

**2. 複合語問題で固有名詞自体も検出される**

「横浜市中区」が抜粋では「横浜市の中区」のように助詞で分かれている／「山形県庄内地方」が「山形県の庄内地方の」と書かれている／「横浜港開港以降」のように生成文側で連結されている、というケースで substring 照合が失敗する。

**3. Nova と決定論は別の角度から誤検知している**

東松山市のケースで Nova は "1954年に市制施行しました" の長フレーズを out_of_kb_terms にしたが、決定論はこれを検出せず別の「通過」「記載」を検出した。Phase 2-2 の動機だった「Nova の誤検知を決定論で解消」は **そのままでは達成できない**。

### 4.29.5 それでも得られた価値

- **観測指標としての安定性**: 決定論 Judge の結果は同じ入力で必ず同じ。改善前後の比較が可能（Nova はブレるので比較難）
- **誤検知パターンの可視化**: false positive の語彙が明確に並ぶ → 改良の方向が決まる
- **ユーザ体験ゼロ影響でデータ収集できた**: Generator/Nova Judge は不変、シャドウ運用の設計思想が機能した

### 4.29.6 次の選択肢（Issue #52 の出口判断）

- **A. STOPWORDS リストで一般語を弾く**: 「集中」「発展」「有名」など 30-50 語の除外リストを作る。シンプルだがメンテ負荷。一致率 70-80% は狙えそう
- **B. 抽出粒度を変える（漢字 3 文字以上に上げる）**: 一般 2 文字漢字を弾けるが「皇居」「東京」のような重要 2 文字も取り逃す
- **C. kuromoji.js 進化に踏み切る**: 形態素解析で品詞情報を使った精密フィルタ。bundle size 問題は CDN 経由で迂回するが cold start コスト
- **D. ライト案を「観測指標」のまま使い、本決定切替は諦める**: 「決定論的だが Nova と一致しない」という性質を活かして、特定パターン（複合語混入等）の検出器として残す

Phase 2-2 の本実装（シャドウ運用基盤）は完了。次の方向性は本番テレメトリで 1-2 週間データを集めてから判断する。

---

## 4.30 軌跡描画の「今日縛り」と踏破履歴の保存先方針（2026-05-23）

### 4.30.1 背景

長期間の使用で localStorage `track` 配列に過去日のポイントが積み上がり、地図全面が緑線で覆われて当日の移動が判別不能になった。

### 4.30.2 構造の確認

- `public/assets/storage.js` の `track: [{lat, lon, ts}]` は **フロント localStorage のみ**に存在。`appendTrack` で append され、永続クリア手段がなかった。
- `public/assets/app.js:114` で起動時に `state.track` 全件を `setTrack` していたため、過去全部の点が緑ポリラインに乗っていた。
- **S3 テレメトリには位置点列は含まれない**。`telemetry.js:buildTelemetryEntry` のスキーマには `muni_code`/`description`/Judge 指標/暗黙シグナルしか入っていない。緯度経度は Workers にも送っていない。
- したがって track を temp で消しても **Judge 改善ループに必要なデータは欠損しない**。観測駆動の反復は影響を受けない。

### 4.30.3 採用した方針

**「localStorage は全件温存・描画だけ今日に絞る」**。

- `track_filter.js` を新設し、`isSameLocalDay`（ローカル暦日比較）と `filterTodayPoints`（純粋関数）を切り出した。純粋関数にしたことで Vitest 単体で 8 件カバーできる。
- 起動時: `filterTodayPoints(state.track, Date.now())` の結果だけを `setTrack` に渡す。`state.track` 自体には触らない。
- 走行中の日跨ぎ: モジュールスコープ `lastTrackTs` を持ち、`addTrackPoint` 直前で `isSameLocalDay(lastTrackTs, now)` が false なら `clearTrack` してから新規開始。`appendTrack` は変わらず呼び続けるので localStorage 側は追記される。
- これにより「日付が変わった瞬間に地図がリセット、データは温存」が両立する。

### 4.30.4 不採用案と理由

- **起動時に track = [] にクリア**: 実装は最小だが、Safari のリロード（電池切れ復帰など旅の途中で起きやすい）で当日の軌跡まで消える。観測駆動の前提（旅の途中で再起動はあり得る）に合わない。
- **直近 N 件で打ち切り**: ポイント数は GPS 取得頻度に依存し、てつてつの利用シーン（電車旅）では1日 1〜2 万点も普通にあり得るので、N の妥当値が決められない。日付軸で切るほうが UX の説明可能性が高い。
- **手動クリアボタン**: 押し忘れて今と同じ状態に戻る。自動の保険として将来追加してもよいが、まずは時間軸で自動化したほうが UX が安定する。

### 4.30.5 踏破履歴の保存先（今後の検討メモ）

てつてつから「踏破市町村画面を作りたい、DynamoDB がよさそう」との発言。本セッションでは設計しないが、観点だけ残す。

- **S3 JSON 上書き保存案の弱点**: 1 リクエスト = 全件再読込。「踏破済 100 件」が「踏破済 101 件」になるたびに全件 GET する設計はスケールしない。CloudFront/Workers Cache を挟んでも書込直後の整合性が不安定。
- **DynamoDB が向く理由**: PK/SK で「日付別の踏破リスト」「市町村別の訪問履歴」両方の問い合わせが効率的。容量課金で月コスト数百円規模（てつてつ 1 ユーザー）で済む。Workers から SigV4 で `PutItem`/`Query` を叩く前例は本プロジェクトの S3 PUT と同じ aws4fetch ライブラリで再利用可能。
- **設計時の論点**:
   - PK 設計: `tetutetu#YYYY-MM-DD` か `tetutetu` + SK `visit#YYYY-MM-DD#<muni_code>` か。日付クエリと市町村クエリの頻度で決める
   - 既存テレメトリとの関係: telemetry は「LLM 評価の生データ」、踏破履歴は「ユーザー向け集計」。テーブル分離が素直
   - 初回ロード時のリストア: localStorage `visited` を真実とせず、DynamoDB から取得した結果を localStorage にミラーする読み戻し設計が必要
   - 移行: 既存 localStorage の `visited` を一度だけ DynamoDB に書き戻す one-shot 移行スクリプト

実装着手前に `docs/plan.md` で plan → spec → 理解度テスト → 実装の順を踏む。todo.md にタスクを追加済。

### 4.30.6 本番観測結果（2026-05-23）

`bash deploy_frontend.sh` 実行後、独自ドメイン `https://trip-road.tetutetu214.com/` で HTTP 200 を確認（pages.dev も同様）。
てつてつが iPhone Safari で実機確認し、**「今日の部分だけが緑線で表示されている」**と報告。
過去日の緑線で地図が埋まる事象は解消。`filterTodayPoints` + `clearTrack` の組合せが想定どおり機能している。

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
