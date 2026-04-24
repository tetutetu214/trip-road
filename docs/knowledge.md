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

### 4.5 GPS・判定系
- ※ Phase 3 の実装中に追記

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
