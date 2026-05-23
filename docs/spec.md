# trip-road 機能仕様書

**バージョン**: 1.0  
**作成日**: 2026-04-22  
**ステータス**: 実装着手前の詳細化版  
**原典**: `docs/plan.md` / `docs/design/trip_road_main_screen_mockup.html`

---

## 1. 本仕様書の位置づけと優先順位

memo.txt の要件定義を、ブレインストーミング決定事項とデザインカンプで詳細化した実装可能な仕様書である。矛盾があった場合は以下の優先順位で解決する。

1. `docs/design/trip_road_main_screen_mockup.html`（UI・画面仕様の原典）
2. **本ファイル `docs/spec.md`**（機能・API・データの原典）
3. `docs/plan.md`（方針・マイルストーン）
4. `memo.txt`（元の要件、参考扱い）

---

## 2. 画面仕様

### 2.1 メイン画面

モックアップ `docs/design/trip_road_main_screen_mockup.html` を原典とする。iPhone 縦画面（基準 375×812、SafeArea 考慮）を前提。

構成要素（上から）：
- **iOS システムステータスバー**（44px、iOS 描画、PWA では自前描画せず）
- **上部フロート帯**（top: 56px、z-index: 5、glassmorphism）
  - 左「いま」チップ: ティール円形ピン + ラベル「いま」（10px uppercase）+ 市町村名（15px）
  - 右「制覇」チップ: ラベル「制覇」+ 数字（17px）+ 「市町村」（11px）
- **地図エリア**（top: 44px 〜 bottom: 320px、背景 `#18181a`）
  - 地理院タイル + 軌跡ポリライン + 現在地マーカー
  - 右下に「出典：地理院タイル」固定
- **下部カード**（bottom: 44px 〜、`#0f0f10` グラデーション背景）
  - ドラッグハンドル表示（装飾、機能なし）
  - 市町村名（24px、weight: 500）+ 速度（28px、tabular-nums）を左右に
  - 「土地のたより」カード（rounded 16px、`rgba(255,255,255,0.03)` 背景、`rgba(255,255,255,0.06)` 0.5px border）
  - フッター行: 「情報は目安です」（左、10px `#6a6a70`）+ GPS 受信中（右、ティール点 + テキスト）
- **iOS ホームインジケーター領域**（44px、iOS 描画）

### 2.2 パスワード入力画面

モックアップ未作成のため本仕様で定義。メイン画面の設計言語を踏襲。

```
┌─────────────────────────┐
│                         │
│         (空白)          │
│                         │
│      trip-road          │ ← ティール `#9fe1cb`、12〜14px、uppercase、letter-spacing 0.14em
│    旅のお供、始めます     │ ← `#7a7a80`、11px
│                         │
│   [  合言葉   ] ← ■     │ ← 入力フィールド 260×44、rounded 12px
│                         │
│   [   はじめる   ]      │ ← ティール `#5dcaa5` ボタン 260×44、文字 `#0f0f10`
│                         │
│                         │
└─────────────────────────┘
    背景 `#0f0f10`
```

**入力フィールド**:
- `<input type="password" autocomplete="off" spellcheck="false">`
- 背景 `rgba(255,255,255,0.05)`、border 0.5px solid `rgba(255,255,255,0.08)`
- rounded 12px、padding `0 16px`、文字色 `#f5f5f7`、placeholder 色 `#7a7a80`
- focus 時: border-color を `#5dcaa5` に、transition 150ms

**送信ボタン**:
- `<button type="submit">はじめる</button>`
- 入力が空のとき `opacity: 0.4; pointer-events: none;`
- tap 時は `opacity: 0.8` のプレス感

**エラー表示**:
- フィールド下に 8px 空けて表示、`#e08080` 11px
- 文言: 「パスワードが違います」
- 401 受信直後に表示、次の入力タップで消去

### 2.3 エラー状態

**(a) GPS 権限拒否**:
- 上部「いま」チップ: 市町村名部分を「位置情報の許可が必要です」（14px）
- 「土地のたより」カード本文: 「iPhone の設定 → trip-road → 位置情報 を「App の使用中のみ」に設定してください」（14px line-height 1.6）
- 地図: 空、または薄暗い灰色一色（`#18181a`）

**(b) 市町村未確定**（P-in-P とGSIフォールバック両方失敗）:
- 「いま」チップ: 「位置を確認中...」（`#7a7a80`）
- 地図: 現在地ピンと軌跡は表示、追従
- 「土地のたより」カード: ラベル非表示、本文空

**(c) LLM 呼出失敗**（3回指数バックオフ後）:
- 上部フロートと地図は通常通り
- 「土地のたより」カード:
  - ラベル「土地のたより」は維持
  - 本文の代わりに注記「解説を取得できませんでした」（`#7a7a80`、12px）
  - 再試行ボタンなし（次の市町村切替で自動回復）

### 2.4 初期状態（GPS 測位前）

- 「いま」チップ: 「現在地を取得中...」（`#7a7a80`、15px）
- 「制覇」チップ: 既存 `localStorage.visited` のキー数、無ければ「0」
- 地図: 中心 `[35.5, 138]`、ズーム 5（日本全体ビュー）
- 「土地のたより」カード: ラベル・本文ともに空
- 速度: `--`
- GPS 受信中インジケーター: 脈動なし灰色点（`#6a6a70`）、文言「GPS 測位中」

### 2.5 ローディング状態（LLM 呼出中）

- 上部・地図は通常通り
- 「土地のたより」カード:
  - ラベル「土地のたより」表示
  - 本文の代わりにスケルトン 3 本（幅 100% / 100% / 60%、高さ 12px、背景 `rgba(255,255,255,0.06)`、rounded 3px、垂直 8px 間隔、シマー animation 1.5s）
- 画面は操作可能

### 2.6 免責・出典表示

常時表示：
- 下部カードフッター左: 「情報は目安です」（10px `#6a6a70`）
- 地図右下: 「出典：地理院タイル」（9px、`rgba(22,22,24,0.9)` 背景）

初回起動時のみ表示（将来検討）：
- 「国土数値情報（行政区域データ）（国土交通省）を加工して作成」
- Phase 4 で配置場所を決定（About モーダル 等）

---

## 3. 機能仕様詳細

### 3.1 GPS 取得と現在地表示

```javascript
navigator.geolocation.watchPosition(
  onPositionSuccess,
  onPositionError,
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
);
```

`onPositionSuccess(position)` の処理：
1. 速度表示更新: `coords.speed` が数値なら `Math.round(coords.speed * 3.6)`、null/負なら `--`
2. 地図マーカー移動 + `map.setView([lat, lon], 14, { animate: true, duration: 0.3 })`
3. 軌跡 `track[]` に `{ lat, lon, ts: Date.now() }` を push、localStorage 保存
4. 市町村判定（3.2）を呼出

`onPositionError(error)` の処理（`error.code`）：
- `1` PERMISSION_DENIED: 2.3(a) GPS 権限拒否画面へ遷移、watchPosition 停止
- `2` POSITION_UNAVAILABLE: 画面維持、ログに記録、次の成功を待つ
- `3` TIMEOUT: 画面維持、次の成功を待つ

### 3.2 市町村の自動判定

判定フロー（3段階）：

**ステップ1**: 現在の市町村ポリゴンに対する Turf.js 判定
```javascript
turf.booleanPointInPolygon(turf.point([lon, lat]), currentMuniPolygon)
```
- true → 状態維持、終了
- false → ステップ2

**ステップ2**: 隣接市町村（`adjacency.json`）のうちロード済みポリゴンに対する判定
```javascript
const neighbors = adjacency[currentMuniCd] ?? [];
for (const code of neighbors) {
  if (!loadedPolygons[code]) continue;
  if (turf.booleanPointInPolygon(pt, loadedPolygons[code])) {
    return code;  // 切替処理へ
  }
}
```
- ヒット → 市町村切替処理
- どれもヒットせず → ステップ3

**ステップ3**: 国土地理院逆ジオコーダ
```
GET https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={lat}&lon={lon}
```
- レスポンスから `results.muniCd` を取得
- `/municipalities/{muniCd}.geojson` を動的ロード
- `loadedPolygons[muniCd]` に登録、切替処理へ

**市町村切替処理**：
1. 新市町村コードを `currentMuniCd` にセット、localStorage 保存
2. `visited[code]` に未登録なら登録（制覇カウント +1、UI 更新）
3. `adjacency[code]` から隣接コード一覧を取得
4. 未ロード隣接を `Promise.all` で並列 fetch（fire-and-forget でもよい）
5. 二十四節気判定: `getSolarTerm(new Date())`（'01'〜'24' を返す）
6. `visited[code].descriptions[solarTerm]` 確認
   - 存在 → そのテキストを「土地のたより」にフェードイン表示、API 呼出なし
   - 未存在 → LLM 呼出フロー（3.3）

**GSI フォールバック発動の追加条件**：
- アプリ起動直後、`track[]` 末尾から現在位置が 500m 以上離れている
- P-in-P 結果が直近 3 回連続で同一市町村コードに収束しない

### 3.3 土地のたより生成（LLM）

**二十四節気判定**：

日付から二十四節気の番号文字列（'01' 立春 〜 '24' 大寒）を返す。境界日は太陽黄経で正確に計算すべきだが、年により±1日のずれがあるだけなので、固定の月日テーブルで近似する（`public/assets/season.js`）。

```javascript
// 節気開始日テーブル（mmdd = month*100+day、年内昇順）
//   23 小寒 0106, 24 大寒 0120, 01 立春 0204, 02 雨水 0219, ...
//   21 大雪 1207, 22 冬至 1222
// 1/1〜1/5 は前年の冬至期間にあたるため 22 を返す。
function getSolarTerm(date) {
  const mmdd = (date.getMonth() + 1) * 100 + date.getDate();
  let id = 22;
  for (const t of SOLAR_TERM_BOUNDARIES) {
    if (t.mmdd <= mmdd) id = t.id;
    else break;
  }
  return String(id).padStart(2, '0');
}
```

**呼出フロー**：
1. ローディング状態（2.5）に遷移
2. `POST {WORKERS_URL}/api/describe`（本仕様 5 節参照）
3. 成功 → `visited[code].descriptions[solarTerm]` にキャッシュ、カードにフェードイン（200ms opacity 0→1）
4. 失敗 → 1秒後に再試行、2秒後に再試行、4秒後に再試行。最終失敗時は 2.3(c) LLM 失敗状態

**リトライ判定**：
- 500/502/503/504 および fetch reject → リトライ対象
- 401 → パスワード画面に戻す（3.6 参照）、リトライしない
- 400/404 → エラー状態、リトライしない

### 3.4 地図表示と通過軌跡

**Leaflet 初期化**：
```javascript
const map = L.map('map', {
  center: [35.5, 138],
  zoom: 5,
  zoomControl: false,          // ズームボタン非表示（モバイル優先）
  attributionControl: false    // 出典は手動で右下に
});

L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
  maxZoom: 18,
  tileSize: 256
}).addTo(map);
```

**追従モード（常時 ON）**：
- GPS 更新ごとに `map.setView([lat, lon], currentZoom, { animate: true, duration: 0.3 })`
- ズーム 14 を基本とし、初回測位時のみズームイン animate（5 → 14）

**現在地マーカー**：
- `L.divIcon` で SVG（ティール外周 `#9fe1cb` + 内芯 `#5dcaa5`、直径 18px）
- 更新時: `marker.setLatLng([lat, lon])`

**軌跡ポリライン**：
```javascript
const trackLine = L.polyline([], {
  color: '#5dcaa5',
  weight: 3,
  opacity: 0.9,
  lineCap: 'round',
  lineJoin: 'round'
}).addTo(map);
```
- GPS 更新ごとに `trackLine.addLatLng([lat, lon])`
- localStorage 復元時は初期化時に `trackLine.setLatLngs(track.map(t => [t.lat, t.lon]))`

### 3.5 制覇カウント

- `Object.keys(visited).length` が制覇数
- 上部右フロートチップに表示（`{数字} <span>市町村</span>`）
- 新市町村切替時に自動更新

### 3.6 パスワード認証

**フロー**：
1. アプリ起動時、`localStorage.getItem('password')` 確認
2. 未設定 → パスワード画面（2.2）表示
3. ユーザ入力 + 「はじめる」タップ → localStorage に保存 → メイン画面遷移
4. 以降の Workers 呼出で `X-App-Password: {password}` ヘッダー付与
5. 401 応答 → `localStorage.removeItem('password')` → パスワード画面に戻す、エラー文言表示

**セッション寿命**: localStorage に永続。ユーザが明示的にクリアしない限り再入力不要。

### 3.7 エラーハンドリング総覧

| エラー種別 | 検出 | 対応 |
|---|---|---|
| GPS 権限拒否 | onError code 1 | 2.3(a) 画面、watchPosition 停止 |
| GPS 測位失敗（一時的） | onError code 2, 3 | 画面維持、次の成功を待つ |
| N03 GeoJSON fetch 失敗 | fetch reject / 4xx/5xx | ステップ3（GSI）へフォールバック |
| GSI 逆ジオコーダ失敗 | fetch reject / 4xx/5xx | 2.3(b) 未確定状態、60 秒後に再試行 |
| Workers 401 | fetch 401 | パスワード画面へ戻す（3.6） |
| Workers 502/503/5xx | fetch reject / 5xx | 3 回指数バックオフ、失敗時 2.3(c) |
| localStorage 容量超過 | try/catch QuotaExceededError | PoC: 古い軌跡を半数トリム（Phase 2 以降で精緻化） |

---

## 4. データ仕様

### 4.1 N03 GeoJSON

- **配置**: `/municipalities/{N03_007}.geojson`
- **形式**: GeoJSON FeatureCollection
- **Feature プロパティ**:
   - `N03_001`: 都道府県名（例: `"神奈川県"`）
   - `N03_004`: 市区町村名（例: `"相模原市緑区"`）
   - `N03_007`: 全国地方公共団体コード（例: `"14151"`）
- **Geometry**: Polygon または MultiPolygon（飛び地対応）
- **簡略化**: shapely `simplify(0.0005, preserve_topology=True)`
- **座標精度**: 小数点以下 5 桁

### 4.2 adjacency.json

- **配置**: `/adjacency.json`（ルート直下）
- **形式**:
  ```json
  {
    "14150": ["14151", "14152", "14401"],
    "14151": ["14150", "14152", "14100", "14212"]
  }
  ```
- **キー**: 市町村コード
- **値**: 隣接する市町村コードの配列
- **生成方法**: Python (geopandas + shapely) で `geometry.touches(other) or geometry.intersects(other.buffer(0.00001))` を全ペアに対して計算

### 4.3 localStorage データ構造

```json
{
  "password": "a3f9b12c8e4d6710ff293a4bc1e8d5d2",
  "visited": {
    "14151": {
      "name": "相模原市緑区",
      "prefecture": "神奈川県",
      "firstVisit": "2026-04-22T10:00:00.000Z",
      "descriptions": {
        "07": "立夏のころ、緑区の津久井湖畔は新緑がまぶしく…",
        "16": "秋分のころ、相模川の河岸段丘では稲刈りが始まり…"
      }
    }
  },
  "track": [
    { "lat": 35.5681, "lon": 139.3712, "ts": 1745000000000 }
  ],
  "currentMuniCd": "14151"
}
```

**キー説明**:
- `password`: 認証パスワード（平文保存、端末紛失時のリスクは許容）
- `visited`: 訪問済み市町村情報とLLM解説キャッシュ。`descriptions` のキーは二十四節気の番号文字列（'01'〜'24'）で、訪れた節気だけが追加される可変構造
- `track`: 通過軌跡、上限 5000 点（PoC では超過時ノーオペ、Phase 2 でトリム）
- `currentMuniCd`: 現在の市町村コード（起動時復元用）

### 4.4 地理院タイル

- **URL テンプレート**: `https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png`
- **ライセンス**: PDL1.0、申請不要、出典明示必須
- **最大ズーム**: 18

### 4.5 国土地理院逆ジオコーダ

- **URL**: `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat={lat}&lon={lon}`
- **レスポンス形式**:
  ```json
  {
    "results": {
      "muniCd": "14151",
      "lv01Nm": "中央区"
    }
  }
  ```
- **CORS**: 対応済み（ブラウザから直接 fetch 可）
- **注意**: 実験的サービス。PoC のフォールバック利用は許容、商用本番では別手段を検討

---

## 5. API 仕様（Cloudflare Workers）

### 5.1 エンドポイント

唯一のエンドポイント: `POST /api/describe`

### 5.2 認証

- ヘッダー `X-App-Password: {password}` 必須
- 未付与または `APP_PASSWORD` と不一致 → 401 Unauthorized
- Workers 側は `crypto.subtle.timingSafeEqual` 相当の定数時間比較を実装

### 5.3 リクエスト

```http
POST /api/describe
Content-Type: application/json
X-App-Password: a3f9b12c8e4d6710ff293a4bc1e8d5d2

{
  "prefecture": "神奈川県",
  "municipality": "相模原市緑区",
  "solar_term": "07"
}
```

必須フィールド: `prefecture` / `municipality` / `solar_term`  
`solar_term` の値: 二十四節気の番号文字列 `"01"`〜`"24"`（'01' 立春 〜 '24' 大寒）

### 5.4 レスポンス

**成功** (200):
```json
{ "description": "緑区は津久井湖や相模湖を抱く、山と水の町です。..." }
```

**認証失敗** (401):
```json
{ "error": "unauthorized" }
```

**リクエスト不正** (400):
```json
{ "error": "bad_request", "detail": "missing required field: solar_term" }
```

**上流エラー** (502):
```json
{ "error": "upstream_error", "detail": "Bedrock error: ..." }
```

### 5.5 CORS

- `Access-Control-Allow-Origin`: Workers Secret `ALLOWED_ORIGIN`（Cloudflare Pages ドメイン）
- `Access-Control-Allow-Methods`: `POST, OPTIONS`
- `Access-Control-Allow-Headers`: `Content-Type, X-App-Password`
- OPTIONS プリフライト対応必須

### 5.6 Workers Secrets

Plan H で `ANTHROPIC_API_KEY` は撤廃。Generator / Judge とも AWS IAM 認証（aws4fetch）で
Bedrock Runtime を呼ぶため、AWS 系キーが必須。S3 テレメトリ書込みと同居の IAM ユーザー
（`trip-road-telemetry-writer`）が `bedrock:InvokeModel` も持つ。

| キー | 内容 |
|---|---|
| `APP_PASSWORD` | 32 文字 hex パスワード |
| `AWS_ACCESS_KEY_ID` | IAM ユーザー `trip-road-telemetry-writer` のアクセスキー（S3 + Bedrock 共用） |
| `AWS_SECRET_ACCESS_KEY` | 同シークレットキー |
| `AWS_REGION` | `us-east-1`（Bedrock Runtime のエンドポイントリージョン） |
| `S3_TELEMETRY_BUCKET` | `trip-road-telemetry-tetutetu214` |
| `ALLOWED_ORIGIN` | `https://trip-road.pages.dev` 等、許可するオリジン |

---

## 6. LLM プロンプトテンプレート

### 6.1 System prompt（Workers 側に直書き）

```
あなたは日本の旅行ガイドです。指定された都道府県・市区町村・二十四節気から、旅人が通過する際に楽しめる3〜4文の観光ガイド文を書いてください。

以下のルールを守ってください：
- 文体は「です・ます調」の現代的な観光ガイド
- 120〜180字の範囲に収める
- 二十四節気の季節感（その節気特有の旬・景色・花・気候）には必ず触れる
- 以下の要素は、その土地で確信を持って書ける範囲だけ含める（無理に全部書こうとしない、書けるものだけでよい）：
  - 具体的な地名（山・川・峠・湖・旧街道・神社仏閣・港・台地など固有名詞）
  - 歴史的背景（城下町・宿場町・港町・産業の起こりなど）
  - 地形的特徴（盆地・河岸段丘・扇状地・リアス海岸・台地・カルデラなど）
  - 名物・特産品
- 確信が持てない情報は無理に書かない（情報量が減っても正確さを優先）
- 祭りやイベントの具体的な日付・回数・年号は書かない（代わりに「例年◯月頃」と表現する）
- プレーンテキストのみ、マークダウン記法や箇条書きは使わない
- 旅情を損なう過度な商業表現（「おすすめ！」など）は避ける
```

### 6.2 User prompt（Workers で組み立て）

```
都道府県: {prefecture}
市区町村: {municipality}
二十四節気: {solar_term_ja}（{solar_term}）
```

`solar_term_ja` は番号文字列（'01'〜'24'）を日本語名に変換した値。
例: '01'→立春、'07'→立夏、'16'→秋分、'22'→冬至。

### 6.3 Bedrock Converse API 呼出パラメータ（Plan H）

エンドポイント: `https://bedrock-runtime.us-east-1.amazonaws.com/model/{modelId}/converse`
（modelId は URL エンコード、認証は aws4fetch による SigV4）

リクエスト body は Converse API 形式（Anthropic Messages API とは構造が違う点に注意：
`system` と `messages[*].content` がいずれも配列、`maxTokens` は `inferenceConfig` 配下）：

```json
{
  "system": [{ "text": "[6.1 のテキスト]" }],
  "messages": [
    { "role": "user", "content": [{ "text": "[6.2 のテキスト]" }] }
  ],
  "inferenceConfig": {
    "maxTokens": 400,
    "temperature": 0.7
  }
}
```

- modelId（URL path 側）: **`us.amazon.nova-pro-v1:0`** （cross-region inference profile、us-east-1 / us-west-2 / us-east-2 に自動分散）
- `inferenceConfig.maxTokens` は必ず明示する（未設定だとモデル最大値で quota が予約され、ThrottlingException の主因になる）
- Generator は temperature=0.7、Judge は temperature=0（揺らがない採点のため）

### 6.4 出力例

**入力**: 神奈川県 / 相模原市緑区 / 立夏（07）  
**期待出力**:
> 立夏のころ、津久井湖や相模湖を抱く緑区は新緑がいっせいに芽吹く季節です。丹沢山地のすそ野に広がる起伏ある地形は、古くは津久井城を中心とした要衝で、いまも津久井やまゆりラインに往時の面影が残ります。沿道の直売所には、土地の柚子やこんにゃくが並びはじめます。

**避けたい出力**（ハルシネーション例）:
> 相模原市緑区では第45回さくら祭りが4月5日から開催されます。

具体的な回数・日付・年号を書かせないのがプロンプトの狙い。地名・歴史・地形は「確信を持って書ける範囲」とし、不明なものは無理に盛り込ませない（情報量より正確さ優先）。

---

## 7. PWA / iOS ホーム画面追加仕様

### 7.1 index.html の `<head>` メタタグ

```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0f0f10">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="trip-road">
<link rel="apple-touch-icon" sizes="180x180" href="/icon-180.png">
<link rel="manifest" href="/manifest.json">
<title>trip-road</title>
```

### 7.2 manifest.json

```json
{
  "name": "trip-road",
  "short_name": "trip-road",
  "description": "GPSで土地のたよりを届ける、旅のお供",
  "icons": [
    { "src": "/icon-180.png", "sizes": "180x180", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ],
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0f0f10",
  "theme_color": "#0f0f10",
  "orientation": "portrait"
}
```

### 7.3 アイコン仕様（PoC 仮置き）

- ファイル: `/icon-180.png`（180×180、PNG）
- デザイン: 背景 `#0f0f10`、中央に `TR`（`#5dcaa5`、太字サンセリフ、90px）
- 角丸不要（iOS が自動適用）

---

## 8. テスト戦略

### 8.1 単体テスト

対象：
- `getSolarTerm(date)` の境界条件（1/5↔1/6 冬至→小寒、1/19↔1/20 小寒→大寒、2/3↔2/4 大寒→立春、3/20↔3/21 啓蟄→春分、12/21↔12/22 大雪→冬至 ほか）
- キャッシュキー生成: `${code}_${solarTerm}`（節気番号は'01'〜'24'）
- 市町村切替判定
- localStorage 保存/復元

**ツール**: Node.js + 標準 `assert`（ビルド不要で速い）  
**配置**: `tests/unit/*.test.js`  
**実行**: `node --test tests/unit/`

### 8.2 結合テスト（Workers）

`wrangler dev` 起動下で curl シナリオを実行：

```bash
# 成功
curl -X POST http://localhost:8787/api/describe \
  -H "Content-Type: application/json" \
  -H "X-App-Password: {test_password}" \
  -d '{"prefecture":"神奈川県","municipality":"相模原市緑区","solar_term":"07"}'

# 認証失敗
curl -X POST http://localhost:8787/api/describe \
  -H "X-App-Password: wrong" \
  -d '{}'

# 必須欠落
curl -X POST http://localhost:8787/api/describe \
  -H "X-App-Password: {test_password}" \
  -d '{"prefecture":"神奈川県"}'
```

### 8.3 実機テスト（Phase 4 完了判定）

チェックリスト：
- [ ] iPhone Safari でサイトを開くとパスワード画面
- [ ] 正しいパスワードでメイン画面遷移
- [ ] GPS 許可ダイアログが出る
- [ ] 許可後、現在地マーカー表示
- [ ] 移動で速度が km/h 更新
- [ ] 市町村境界越えで土地のたよりが更新
- [ ] 再訪でキャッシュから即表示
- [ ] オフライン時、GPS 更新は継続、他は壊れない
- [ ] 「ホーム画面に追加」でアイコン出現
- [ ] アイコンから開くとスタンドアロンモード起動
- [ ] 制覇カウントが累積
- [ ] 再起動してもデータ維持

### 8.4 GPS モック（開発時）

- Chrome DevTools の Sensors パネルで座標を手動設定
- または `navigator.geolocation.watchPosition` をラップしたテストスクリプトで録画 GPX を再生

---

## 9. デプロイ仕様

### 9.1 Cloudflare Pages（フロント + データ）

- プロジェクト名: `trip-road`
- ソース: ローカル `public/` ディレクトリ
- デプロイコマンド: `wrangler pages deploy public/ --project-name=trip-road`
- ドメイン: `https://trip-road.pages.dev`（独自ドメインなし）

### 9.2 Cloudflare Workers（API）

- プロジェクト名: `trip-road-api`
- ソース: `workers/src/index.js`
- 設定: `workers/wrangler.toml`
- デプロイ: `cd workers && wrangler deploy`
- Secrets: `wrangler secret put APP_PASSWORD`, `ANTHROPIC_API_KEY`, `ALLOWED_ORIGIN`

### 9.3 ロールバック

- Pages: `wrangler pages deployment list` で旧版を `--rollback`
- Workers: 旧 script 内容で `wrangler deploy` 再実行

---

## 10. Phase 6 (Plan E) 詳細仕様: LLM as a judge

> 設計判断の背景・トレードオフは `docs/plan.md` 第 10 章、`docs/knowledge.md` 4.7 章を参照。本章は実装に必要な仕様のみを記す。

### 10.1 全体フロー

F-1.3b（2026-05-06）以降、Wikipedia 抜粋は Judge 軸 1 だけでなく Generator にも渡される（生成側 RAG）。Wikipedia 取得が生成より前に移動した。

```
[フロント]                    [Workers /api/describe]              [外部]
   │                                  │
   │── POST /api/describe ────────────▶
   │                                  │── Wikipedia 取得 ─────────▶ Wikipedia API
   │                                  │◀──────── extract ─────────
   │                                  │   （Workers Cache API、TTL 30日）
   │                                  │
   │                                  │── 生成（Wikipedia 抜粋同梱）▶ Anthropic Haiku
   │                                  │◀──────── description ────
   │                                  │
   │                                  │── Judge 4軸並列（同抜粋を再利用）▶ Anthropic Sonnet 4.6
   │                                  │◀──────── 4 scores ────────
   │                                  │
   │                                  │   if 全軸4点以上 + 文字数OK
   │                                  │   → 合格 / キャッシュへ
   │                                  │   else 1回だけ再生成（同抜粋＋校閲指摘を Generator に同梱）
   │                                  │   → 再評価 → 結果に関わらず打ち切り
   │                                  │
   │◀─ JSON (description + judge_*) ──│
   │                                  │
   │ 経過時間で段階表示                 │
```

Wikipedia 取得が null（記事なし）または例外を返した場合、Generator には抜粋セクションを渡さず（system prompt 内のルールで「セクションなし＝記事なし」として扱う指示）、Judge も該当軸を「情報なし」差し替えで保守的評価する。

### 10.2 Wikipedia API クライアント仕様

#### エンドポイント

```
GET https://ja.wikipedia.org/w/api.php
  ?action=query
  &prop=extracts
  &exintro=true
  &explaintext=true
  &redirects=true
  &titles=<URL_ENCODED_TITLE>
  &format=json
  &formatversion=2
```

- `prop=extracts`: 記事本文の抜粋
- `exintro=true`: イントロ（最初のセクション）のみ
- `explaintext=true`: HTML タグ除去、プレーンテキスト
- `redirects=true`: リダイレクトを自動追跡
- `formatversion=2`: 新しいレスポンス形式（pages が配列）

#### リクエストヘッダ

```
User-Agent: trip-road/1.0 (https://github.com/tetutetu214/trip-road; tetutetu214@github)
Accept: application/json
```

Wikipedia の Etiquette として User-Agent 必須。

#### レスポンス例（相模原市緑区）

```json
{
  "query": {
    "pages": [{
      "pageid": 1234567,
      "ns": 0,
      "title": "緑区 (相模原市)",
      "extract": "緑区（みどりく）は、神奈川県相模原市にある区。..."
    }]
  }
}
```

#### titles の決定ルール

`muni_code` から市町村名を求めて Wikipedia title に変換する。

- 通常市町村: `municipality` をそのまま title に使う（例: "相模原市"）
- 政令指定都市の区: `municipality` をそのまま使い、`redirects=true` で自動解決（例: "緑区" → "緑区 (相模原市)"）
- 同名曖昧さ回避: `redirects=true` で大半は自動解決。失敗時は `prefecture` を含めた title で再試行

#### キャッシュ仕様

- ストア: Workers Cache API（`caches.default`）
- キー: ダミー URL `https://wikipedia-cache.internal/<muni_code>` の Request オブジェクト
- TTL: 30 日（`Cache-Control: public, max-age=2592000`）
- ヒット: cached extract を返す
- ミス: Wikipedia API を叩く → 結果を put → 返す
- Wikipedia API 失敗時 / extract が空: `null` を返す（呼び出し側でフォールバック）

#### 抜粋の前処理

- extract は最大 1500 字程度に切り詰める（Sonnet コンテキスト節約）
- 改行を維持、参考文献記号 `[1]` 等の残骸があれば正規表現で除去

### 10.3 Judge プロンプト仕様

#### 共通プリアンブル（4 軸全プロンプトの先頭）

```
あなたは厳格な校閲者です。以下の旅行解説（120〜180字、iPhoneで移動中の旅人が読む）を採点します。
誤りや弱点を見逃すと、読者にとって価値の低い解説がキャッシュされ続けてしまいます。

【市町村】 {prefecture} {municipality}
【二十四節気】 {solar_term_number} {solar_term_name}（{solar_term_period}）
【解説本文】
{description}

【手順】
1. 以下の観点について、解説本文から **減点根拠となる該当箇所を引用形式で列挙** せよ。
2. 引用した減点根拠の重みを踏まえ、**最後に** 1〜5 点で採点せよ。
3. 必ず以下の JSON 形式のみで出力せよ（前後に説明文を付けない）:
   {"deductions": ["引用1", "引用2", ...], "score": <整数 1-5>, "notes": "<簡潔なまとめ 50字以内>"}

【採点基準（共通）】
- 5: 減点根拠なし、模範的
- 4: 軽微な減点根拠あり（許容範囲）
- 3: 中程度の減点根拠複数（再生成すべき）
- 2: 重大な減点根拠あり
- 1: 全面的に問題
```

#### 軸 1: 事実正確性 prompt（差分、G-1 で緩和）

G-1（Issue #35）で「Wikipedia 記載なし → 減点」を「直接矛盾のみ重く減点、記載なしは減点しない」に緩和。Few-shot を 2 → 3 パターン化（5点・整合 / 5点・記載なしだが地理常識として妥当 / 2点・直接矛盾あり）。RAG over-refusal の解消が目的。

```
【観点】 地理・歴史・地形に関する記述が、以下の Wikipedia 抜粋と直接矛盾していないか。
（Wikipedia と直接矛盾する記述は重く減点する。Wikipedia に記載がないだけの事項は減点しない。地理常識として明らかに誤り——例: 内陸の市町村に「太平洋に面した港町」、山地の市町村に「平坦な臨海工業地帯」——の場合のみ減点する。）

【Wikipedia 抜粋】
{wikipedia_extract}

【Few-shot 例】

例A（5点想定、Wikipedia と整合）:
解説:「緑区は津久井湖と相模湖を抱える山岳地帯。標高1,673mの蛭ヶ岳（神奈川県最高峰）が区西部にそびえ、江戸期は甲州街道の宿場町として賑わった。」
→ 出力: {"deductions": [], "score": 5, "notes": "Wikipediaと整合"}

例B（5点想定、Wikipedia 記載なしだが地理常識として妥当）:
解説:「世田谷区は東京都の南西部に位置し、多摩川が区の南端を流れます。住宅地が広く、農地もわずかに残ります。」
→ 出力: {"deductions": [], "score": 5, "notes": "Wikipedia 抜粋に多摩川や住宅地の言及がなくても、地理常識として整合している。記載なしは減点対象外"}

例C（2点想定、直接矛盾あり）:
解説:「相模原市緑区は江戸時代の城下町として栄え、武家屋敷の街並みが今も残る。」
→ 出力: {"deductions": ["江戸時代の城下町として栄え（Wikipedia には宿場町として記載されており直接矛盾）", "武家屋敷の街並み（同上、宿場町と矛盾）"], "score": 2, "notes": "Wikipedia の宿場町という記述と直接矛盾"}

ではこの解説本文を採点してください。
```

#### 軸 2: 具体性 prompt（差分）

```
【観点】 単語レベルで、固有名詞（地名・施設名・特産品・人物・年号・標高・距離等の具体値）がどれだけ含まれているか。「春野菜」「桜が美しい」「のんびりとした時間」のように他市町村でも通用する抽象・汎用フレーズが多いほど低スコア。

【Few-shot 例】

例A（5点想定）:
解説:「緑区には津久井湖・相模湖・城山ダム・蛭ヶ岳（標高1,673m）・津久井城址がある。江戸期は甲州街道の小原宿・与瀬宿が置かれ、養蚕業で栄えた。」
→ 出力: {"deductions": [], "score": 5, "notes": "固有名詞が高密度"}

例B（2点想定）:
解説:「緑区は山と湖が美しい町です。春には桜が咲き、自然豊かな景観が広がります。歴史も古く、地元の名物も楽しめる素敵な地域です。」
→ 出力: {"deductions": ["山と湖が美しい（汎用）", "桜が咲き（汎用）", "自然豊かな景観（汎用）", "歴史も古く（汎用）", "地元の名物（具体名なし）"], "score": 2, "notes": "固有名詞ゼロ、全文が汎用フレーズ"}

ではこの解説本文を採点してください。
```

#### 軸 3: 季節整合 prompt（差分）

```
【観点】 二十四節気（{solar_term_name}: {solar_term_period}）と矛盾する季節描写が含まれていないか。例えば「清明（4月初旬）」の時期に紅葉や雪景色を書いていれば矛盾。

【Few-shot 例】

例A（5点想定、節気=清明）:
解説:「清明の頃、緑区の津久井湖周辺ではヤマザクラが見頃。城山公園の桜並木、相模湖の遊覧船運航再開時期。」
→ 出力: {"deductions": [], "score": 5, "notes": "4月初旬と整合"}

例B（1点想定、節気=清明）:
解説:「緑区の山々は雪化粧で美しく、紅葉も色づき始めました。冬の静けさが残る湖畔は…」
→ 出力: {"deductions": ["雪化粧（清明=4月初旬と矛盾）", "紅葉も色づき始め（同）", "冬の静けさ（同）"], "score": 1, "notes": "節気と完全に矛盾"}

ではこの解説本文を採点してください。
```

#### 軸 4: 情報密度 prompt（差分）

```
【観点】 文章全体として、旅人にとって有用な情報（地名・歴史・地形・特産・ランドマーク・実用情報）が淡々と詰まっているか。情緒的修飾（「淡紅色に染まり」「心地よい春風が頬をなで」「のんびりとした時間が流れる」「優雅な〜」「美しい〜」「素敵な〜」など）に字数を取られていると低スコア。事実陳述・カーナビ的な情報案内に近いほど高スコア。

【Few-shot 例】

例A（5点想定）:
解説:「緑区の津久井湖は1965年完成の城山ダム湖、湛水面積2.6km²。湖畔の県立津久井湖城山公園に津久井城址（戦国期、北条家家臣が居城）と展望広場。蛭ヶ岳は神奈川県最高峰、丹沢山地の主峰。」
→ 出力: {"deductions": [], "score": 5, "notes": "事実陳述のみ、情緒修飾なし"}

例B（2点想定）:
解説:「緑区は山と湖が美しい町です。春の訪れとともに桜が咲き誇り、心地よい春風が頬をなでる季節となりました。湖畔を歩けば、のんびりとした時間が流れます。」
→ 出力: {"deductions": ["山と湖が美しい（情緒修飾）", "桜が咲き誇り（同）", "心地よい春風が頬をなで（同）", "のんびりとした時間が流れます（同）"], "score": 2, "notes": "情緒修飾で字数を消費、事実情報が薄い"}

ではこの解説本文を採点してください。
```

#### 二十四節気のメタデータ

Workers 内に `solar_term` 番号 → `{name, period}` のマッピングを持つ:

```js
const SOLAR_TERM_META = {
  "01": { name: "立春", period: "2月4日頃〜雨水前" },
  "02": { name: "雨水", period: "2月19日頃〜啓蟄前" },
  // ... 24 個
  "24": { name: "大寒", period: "1月20日頃〜立春前" },
};
```

### 10.4 Judge 統合ロジック

```js
// workers/src/judge.js（疑似コード）
async function judgeAll({ description, prefecture, municipality, solarTerm, env }) {
  // 文字数チェック（即 NG なら他軸を呼ばずに早期リターン）
  if (description.length < 120 || description.length > 180) {
    return { passed: false, scores: null, lengthOk: false, error: null };
  }

  // Wikipedia 取得
  const wikiExtract = await getWikipediaExtract(municipality, env);

  // 4 軸並列呼出（Promise.all）
  try {
    const [accuracy, specificity, seasonFit, density] = await Promise.all([
      callJudge("accuracy", { description, prefecture, municipality, solarTerm, wikiExtract }, env),
      callJudge("specificity", { description, prefecture, municipality, solarTerm }, env),
      callJudge("season_fit", { description, prefecture, municipality, solarTerm }, env),
      callJudge("density", { description, prefecture, municipality, solarTerm }, env),
    ]);

    // G-1（Issue #35）: 全軸 ≥4 AND は独立事象の AND 結合で合格率が p^N に圧縮される問題（各軸 70% でも全体 24%）があったため、重み付き合計に切替。
    const AXIS_WEIGHTS = { accuracy: 0.4, specificity: 0.2, season_fit: 0.2, density: 0.2 };
    const PASS_THRESHOLD = 3.5;
    const weighted =
      AXIS_WEIGHTS.accuracy * accuracy.score +
      AXIS_WEIGHTS.specificity * specificity.score +
      AXIS_WEIGHTS.season_fit * seasonFit.score +
      AXIS_WEIGHTS.density * density.score;
    const passed = weighted >= PASS_THRESHOLD;
    return {
      passed,
      scores: { accuracy: accuracy.score, specificity: specificity.score, season_fit: seasonFit.score, density: density.score },
      deductions: { accuracy: accuracy.deductions, specificity: specificity.deductions, season_fit: seasonFit.deductions, density: density.deductions },
      lengthOk: true,
      error: null,
    };
  } catch (e) {
    return { passed: null, scores: null, lengthOk: true, error: e.message };
  }
}
```

- `error !== null` → fail-open（呼び出し側で生成のみ表示・キャッシュなし）
- `passed === true` → キャッシュ書込
- `passed === false` → 再生成へ（上限 2 回）

**G-1 合格基準の意図**: accuracy 0.4 / specificity 0.2 / season_fit 0.2 / density 0.2 はてつてつの原点（旅人が初訪問の街を知る、土地・歴史 + 季節）に対し accuracy を最重視するための重み付け。閾値 3.5 は 5 段階の中央 3 と模範 4 の中間。weighted 値そのものは API レスポンスや S3 entry スキーマに含めず、観測には `fetch_entries.sh` 側で `AXIS_WEIGHTS` を再適用して再計算する。

#### 再生成時のフィードバック注入（Phase 6.4d 追加）

`passed === false` で 2 回目を生成するとき、判定 1 回目の `deductions` を Haiku の user メッセージに添えて「同じ失敗を繰り返さない」ようにする。何も伝えずに同じ messagesReq で再生成しても、Haiku は前回どこを指摘されたか知らないため確率論的にしか改善しない。

**フォーマット**: `workers/src/describe_flow.js` の `formatDeductionsForFeedback(deductions)` で軸ごとにラベル付きの箇条書きに整形：

```
- 事実正確性:
  ・江戸期の城下町（記載なし）
- 具体性:
  ・桜が美しい（汎用）
  ・自然豊かな景観（汎用）
- 情報密度:
  ・淡紅色に染まり（情緒）
```

これを `buildMessagesRequest({ ..., regenerationFeedback })` の引数として渡し、user メッセージの末尾に以下のセクションが追加される：

```
[前回の出力で校閲から指摘された箇所]
{整形済 deductions}

上記の指摘を踏まえ、固有名詞を具体的にし、情緒修飾を避け、事実陳述で書き直してください。
```

**設計判断**:
- system prompt（generator 自身の指針）は変更しない。再生成時の追加指示は user メッセージ側にのみ載せる
- judge1 の deductions が全軸ゼロの場合（passed=false が文字数 NG だけだったケース等）は feedback 空文字、注入されない
- 1 回目の生成では feedback なし（プレーンな messagesReq）

### 10.5 `/api/describe` の拡張

#### リクエスト

変更なし（既存仕様：5.3 節）。

#### レスポンス（成功 200）

```json
{
  "description": "緑区は津久井湖と相模湖を抱える山岳地帯。...",
  "judge_passed": true,
  "judge_scores": {
    "accuracy": 5,
    "specificity": 4,
    "season_fit": 5,
    "density": 4
  },
  "regenerated": false,
  "judge_error": null,
  "generator_model": "us.amazon.nova-pro-v1:0",
  "judge_model": "us.amazon.nova-pro-v1:0"
}
```

- `judge_passed`: G-1 以降は重み付き合計 ≥ 3.5 + 文字数 OK なら true（旧仕様の「全 LLM 軸 4 点以上」は廃止）
- `judge_scores`: 各軸スコア（fail-open 時は null）
- `regenerated`: 1 回目で合格なら false、再生成発生で true
- `judge_error`: judge 自体で例外発生時のメッセージ（fail-open 時のみ非 null）
- `generator_model` / `judge_model`（Plan H 追加）: 生成・評価に使ったモデル ID。テレメトリで Plan E 期（Anthropic）と Plan H 期（Bedrock Nova）を切り分けて軸別平均を比較するために導入

#### キャッシュ条件

キャッシュ層はフロント側 localStorage（`public/assets/storage.js` の `setCachedDescription`）が単一の真実。Workers 側にキャッシュ層は持たない（毎回 Anthropic + Judge を呼ぶ設計、ただし呼ばれるのはフロントでキャッシュミスした時だけ）。

フロント `app.js` は Workers のレスポンス `judge_passed` を見て以下の通り判断する：

- `judge_passed === true` のときのみ `{muni_code}_{solar_term}` をキーに `setCachedDescription` で localStorage に書く
- `judge_passed === false`（NG）または `null`（fail-open）のときは表示はするが localStorage には書かない（次回同じ市町村に来たら再度 Workers を呼ぶ）

これにより、誤情報が一度入ると同じキーが来るたびに半永久的に表示し続けるキャッシュ汚染（plan.md 10.1 で挙げた致命的問題）を防ぐ。

#### エラー応答

既存の 400 / 401 / 502 は変更なし。Judge 内部の例外は 200 + `judge_error` で返す（生成自体は成功しているため）。

### 10.6 S3 entry スキーマ更新

`buildTelemetryEntry` および S3 PUT JSON のフィールドを以下に変更：

```json
{
  "trace_id": "uuid-v4",
  "muni_code": "14153",
  "solar_term": "07",
  "description": "...",
  "ts_generated": 1234567890,

  "critic_accuracy": 5,
  "critic_specificity": 4,
  "critic_season_fit": 5,
  "critic_density": 4,
  "critic_deductions": {
    "accuracy": [],
    "specificity": ["引用1"],
    "season_fit": [],
    "density": ["引用2", "引用3"]
  },
  "judge_passed": true,
  "regenerated": false,
  "judge_error": null,

  "generator_model": "us.amazon.nova-pro-v1:0",
  "judge_model": "us.amazon.nova-pro-v1:0",

  "ts_displayed": null,
  "ts_left": null,
  "dwell_ms": null,
  "re_visited_count": 0,
  "user_rating": null,
  "user_comment": null
}
```

#### 廃止フィールド

- `critic_meaningfulness`（Plan D 構想時の枠、Plan E では使わない）→ `buildTelemetryEntry` から削除

#### 後方互換

過去 entry（4.29 までの 8 件）には Plan E の Judge 系フィールドが存在しない。
Plan H 反映前の entry には `generator_model` / `judge_model` フィールドが存在しない。
集計（`fetch_entries.sh`）は `has("generator_model")` でフィルタしてから Plan H 期の集計を出す。

### 10.7 フロント UI 段階表示

経過時間ベースで文言を切り替える（Workers のレスポンスは 1 回で完結するため、ストリーミングは使わない）。

| 経過時間 | 文言 | 補足 |
|---|---|---|
| 0〜2 秒 | 📡 土地のたよりを生成中… | 既存ロード状態 |
| 2〜5 秒 | ✓ 内容を確認しています… | judge にいる想定 |
| 5 秒〜 | ✏️ より良い表現に書き直しています… | 再生成にいる想定 |

レスポンス受信後、`regenerated === true` の場合は表示直前に 0.3 秒だけ「✏️」を残す（演出）。`judge_error !== null` の場合は通常表示（ユーザには judge 失敗を伝えない）。

実装場所: `public/assets/api.js` のフェッチラッパに `setTimeout` で文言変更コールバックを仕込む。

### 10.8 障害ハンドリング

| 障害 | 挙動 |
|---|---|
| Wikipedia API タイムアウト / 5xx | extract = null、軸 1 は「Wikipedia 情報なし」前提で評価（保守的に高得点傾向） |
| Wikipedia API 404（記事なし） | 同上 |
| Bedrock Nova judge レート制限（429） | 1 回だけリトライ（指数バックオフ 1 秒）→ なお失敗なら fail-open |
| Bedrock Nova judge 5xx | 同上（リトライ対象） |
| Bedrock Nova judge 4xx（429 以外） | 即 fail-open（その軸 score=null） |
| Bedrock Nova judge JSON パース失敗 | その軸は score=null として fail-open フラグを立てる |
| 再生成（Generator）も失敗 | 1 回目の出力を採用（regenerated=false で返す） |
| 文字数 NG が 2 連続 | 通常通り表示・キャッシュなし（length 違反は generator プロンプト調整で潰す範疇） |

---

## 11. 次のステップ

1. この第 10 章をてつてつがレビュー（このステップ）
2. OK なら Plan E 実装開始（todo.md 6.1 〜 6.7 の順、TDD）
3. 各 Phase 完了ごとにコミット + プッシュ + 進捗報告

---

## 12. Wikidata QID マッピング (Plan G-3 / Issue #37)

### 12.1 目的

1905 市町村について「5 桁の全国地方公共団体コード → Wikidata QID + 基本属性」のマッピング表を 1 回だけオフラインで生成し、`public/wikidata_qid.json` として静的配信する。Issue #38（Workers ランタイムからの SPARQL 属性取得）の同定キーとして使う。

### 12.2 生成スクリプト

- パス: `preprocess/build_wikidata_qid_map.py`
- 実行例: `python3 preprocess/build_wikidata_qid_map.py` （`--batch-size 100 --timeout 90 --sleep 2.0` がデフォルト）
- SPARQL: `wdt:P429`（全国地方公共団体コード、6 桁・チェックデジット付き）に対して `STRSTARTS(?code6, ?code5)` で前方一致。クライアント側でチェックデジット計算を持たないことで、計算ミスによる政令市区の取り違えリスクを回避
- レート制限: User-Agent 必須、バッチ間 2 秒スリープ、5xx は 1 回リトライ

### 12.3 出力ファイル

- パス: `public/wikidata_qid.json`
- サイズ: 約 292 KB、1905 エントリ
- 構造:

```json
{
  "13101": {
    "qid": "Q214051",
    "label_ja": "千代田区",
    "lat": 35.693944444,
    "lon": 139.753611111,
    "wikipedia_ja": "千代田区"
  },
  "14101": {
    "qid": "Q1202820",
    "label_ja": "鶴見区",
    "lat": 35.508333333,
    "lon": 139.6825,
    "wikipedia_ja": "鶴見区_(横浜市)"
  }
}
```

| フィールド | 型 | 用途 |
|---|---|---|
| `qid` | `Q` + 数字の文字列 | Issue #38 で属性取得の同定キーとして使う |
| `label_ja` | 日本語ラベル | 表示用フォールバック |
| `lat` / `lon` | 度、Wikidata 由来 | 地図キャプション・距離計算の参考値（小数 9 桁） |
| `wikipedia_ja` | ja Wikipedia 記事タイトル | `workers/src/wikipedia.js` の `resolveWikipediaTitle` 第一候補として使える（特に「鶴見区_(横浜市)」のようにカッコ付きタイトル） |

### 12.4 Workers からの参照

- フェッチ: `https://trip-road.tetutetu214.com/wikidata_qid.json` から起動時 1 回 fetch、Cache API で 30 日 TTL
- 未解決キー: JSON にエントリが存在しない場合は `undefined` を fallback トリガとして扱う（QID なしと QID null の二重表現を避けるため、未解決キーは省略する設計）

### 12.5 再生成タイミング

- 平常時は再生成不要（同定キーは年単位でしか変動しない）
- 市町村合併や政令市区の新設があった場合のみ手動で再実行
- 再実行時の所要時間は約 2 分 6 秒（20 バッチ × 平均 4〜6 秒 + バッチ間 2 秒スリープ）

---

## 13. Wikidata SPARQL を runtime RAG に統合 (Plan G-4 / Issue #38)

### 13.1 目的

`public/wikidata_qid.json`（第 12 章）を同定キーとして使い、Workers ランタイムで Wikidata SPARQL から構造化属性を取り、Generator/Judge の in-context として併用する。Plan I Phase 2-3 で残課題だった `out_of_kb_terms` の検出（Wikipedia 抜粋外の表現を Nova が出す）を、Wikidata 属性も「in-context」として認めることで削減する。

### 13.2 取得プロパティ

`workers/src/wikidata.js` の `WIKIDATA_PROPS`:

| ID | 表示名 | 役割 |
|---|---|---|
| P31 | 種別 | 「日本の特別区」「日本の市」「中核市」等の自己定義 |
| P138 | 名前の由来 | 地名の語源 |
| P150 | 構成地区 | 当該市町村の下位行政区分 (本牧, 元町 など)。out_of_kb_terms 削減の主役。**上限 20 件** |
| P190 | 姉妹都市 | カルチャー要素 |
| P206 | 隣接水域 | 海・川・湖 |
| P706 | 位置する地形 | 関東地方, 下総台地 など |
| P1376 | 上位行政体の中心 | 区→市、市→国 の従属関係 |

### 13.3 Workers モジュール

- `workers/src/wikidata.js`: SPARQL 取得 + Cache API 30 日 TTL。失敗は **null fail-open**（Wikipedia 単独 RAG にフォールバック、Plan I の合格率 100% を保つ）
- `workers/src/qid_map.js`: `public/wikidata_qid.json` を Worker 起動時に 1 回 fetch + in-memory cache + Cache API 30 日 TTL

### 13.4 リクエスト・レスポンス変更

リクエスト (`/api/describe`) に `muniCode` (5 桁) を追加。古いフロントは送ってこないので Workers 側はオプショナル扱い、欠落時は Wikidata 統合をスキップして Wikipedia 単独 RAG で動作。

レスポンスに `wikidata_attributes_length: number` を追加。`formatWikidataForPrompt` の出力文字長で、0 のときは「Wikidata 統合スキップ／取得失敗／属性ゼロ」のいずれか。

### 13.5 Generator/Judge プロンプト拡張

- Generator (`nova.js` の SYSTEM_PROMPT): 「Wikipedia 抜粋および Wikidata 構造化属性に書かれている事実だけを使う」に拡張。「構成地区」は網羅列挙禁止、代表 1〜3 個まで
- Judge (`judge_prompts.js` の buildFaithfulnessPrompt): 採点基準を「Wikipedia 抜粋または Wikidata 構造化属性のいずれかに裏付けられているか」に拡張。out_of_kb_terms は両素材のどちらにもないものだけ

### 13.6 並列取得とフォールバック

`describe_flow.js` で Wikipedia と Wikidata を `Promise.all` で並列取得。

- Wikipedia なし → 従来通り「記事なし」を返す（Plan I のコア原則を維持）
- Wikipedia あり / Wikidata なし → Wikipedia 単独 RAG（Plan I と同等）
- Wikipedia あり / Wikidata あり → 両方を context として Generator/Judge へ渡す

### 13.7 観測指標

主指標：**`out_of_kb_terms` の件数/件**（現状 3/10 → 目標 ≤1/10）

副指標：
- 合格率（現状 100%、これを維持）
- `wikidata_attributes_length`（属性取得の成功率）
- `judge_error` ／ Workers ログの fetch エラー率（WDQS の安定性）

---

## 14. 踏破履歴ビュー詳細仕様（plan.md §13 に対応）

plan.md §13 で合意した「階層コロプレス + DynamoDB」を、実装で迷わないレベルまで仕様化する。

### 14.1 画面遷移

既存メイン画面に「履歴」ボタン（🗺️ アイコン）を追加。タップで履歴画面に遷移。

```
[メイン画面]
   ├─ ⛰️ (陰影起伏図トグル)
   ├─ 🗺️ (履歴ボタン)  ← 新設
   └─ ⚙️ (デバッグトグル)
       │
       │ 🗺️ タップ
       ▼
[履歴画面 / レベル0: 日本全土]
   ├─ ← 戻る (メイン画面へ)
   ├─ 統計バー: 「47都道府県中 N 制覇 / 全1900市町村中 M 踏破」
   └─ 日本地図 + 8地方ポリゴンの色塗り
       │
       │ 地方ポリゴンをタップ
       ▼
[履歴画面 / レベル1: 地方詳細]
   ├─ ← 戻る (レベル0 へ)
   ├─ 「関東地方」のタイトル
   ├─ 統計バー: 「7都県中 X 制覇 / 全290市町村中 Y 踏破 (Y%)」
   └─ 地方ズーム地図 + 都道府県ポリゴンの色塗り
       │
       │ 都道府県ポリゴンをタップ
       ▼
[履歴画面 / レベル2: 都道府県詳細]
   ├─ ← 戻る (レベル1 へ)
   ├─ 「神奈川県」のタイトル
   ├─ 統計バー: 「33市町村中 Z 踏破 (Z%)」
   └─ 都道府県ズーム地図 + 市町村ポリゴンの色塗り
       │
       │ 踏破済市町村をタップ
       ▼
[履歴画面 / レベル3: 市町村詳細]
   ├─ ← 戻る (レベル2 へ)
   ├─ 「神奈川県 綾瀬市」のタイトル
   ├─ 初回訪問日 (例: 2026-04-15 14:32)
   └─ Wikipedia 要約キャッシュがあれば表示
```

DOM 上はシングルページのまま、`display: none` 切替で画面を出し入れする（既存の `showMainScreen` / `showPasswordScreen` と同様のパターン）。

### 14.2 履歴画面の DOM 構造

`public/index.html` に追加する DOM スケッチ（class 名は仮）:

```html
<div id="history-screen" class="screen" style="display:none;">
  <header class="history-header">
    <button class="history-back" aria-label="戻る">←</button>
    <h2 class="history-title">日本全土</h2>
  </header>
  <div class="history-stats">
    <span class="stat-main">47 都道府県中 3 制覇</span>
    <span class="stat-sub">全 1900 市町村中 25 踏破</span>
  </div>
  <div id="history-map" class="history-map"></div>
  <div id="history-detail" class="history-detail" style="display:none;">
    <!-- レベル3 用、最初は非表示 -->
  </div>
</div>
```

CSS は新規ファイル `public/assets/history.css` に分離（既存 `app.css` は触らない）。

### 14.3 階層レベル別の地図描画

既存 Leaflet 地図を再利用せず、`history-map` に専用 Leaflet インスタンスを作る（メイン地図とライフサイクルを分離して、メイン画面に戻ったときに状態が壊れないようにする）。

```js
// public/assets/history.js
let historyMap = null;
let currentLevel = 0;
let currentRegion = null;
let currentPrefecture = null;

function initHistoryMap() {
  historyMap = L.map('history-map', {
    center: [36, 138],
    zoom: 5,
    zoomControl: false,
  });
  L.tileLayer(TILE_URL, { maxZoom: 18 }).addTo(historyMap);
}

function renderLevel0(conquests) {
  // regions.geojson を読み、地方ごとに色塗り
  const geojson = await fetch('/regions.geojson').then(r => r.json());
  L.geoJSON(geojson, {
    style: (feature) => ({
      fillColor: colorForRate(rateFor.region(feature.properties.region_code, conquests)),
      fillOpacity: 0.7,
      color: '#5dcaa5',
      weight: 1,
    }),
    onEachFeature: (feature, layer) => {
      layer.on('click', () => transitionToLevel1(feature.properties.region_code));
    },
  }).addTo(historyMap);
}
```

レベル1 / レベル2 も同様。レベル切替時は `historyMap.eachLayer(l => historyMap.removeLayer(l))` で既存レイヤーを掃除し、タイルレイヤーは再 add。

### 14.4 踏破率の計算（純粋関数として切出）

新ファイル `public/assets/conquest_rate.js`:

```js
/**
 * 地方の踏破率を返す。
 * @param {string} regionCode - "kanto" など
 * @param {Map<string,object>} conquests - muni_code → {region_code, prefecture_code, ...}
 * @param {object} regionTotals - regions.geojson properties から得る {region_code: muni_count}
 * @returns {number} 0-1 の踏破率
 */
export function rateForRegion(regionCode, conquests, regionTotals) {
  const total = regionTotals[regionCode];
  if (!total) return 0;
  let count = 0;
  for (const c of conquests.values()) {
    if (c.region_code === regionCode) count++;
  }
  return count / total;
}

/** 都道府県の踏破率 */
export function rateForPrefecture(prefCode, conquests, prefTotals) { ... }

/** 市町村は 0/1 だが、共通 API にするため同じ shape を返す */
export function rateForMunicipality(muniCode, conquests) {
  return conquests.has(muniCode) ? 1 : 0;
}

/**
 * 0-1 の率を色階調バケットにマッピング。
 * @returns {string} 16進カラーコード
 */
export function colorForRate(rate) {
  if (rate === 0) return '#2a2a2a';
  if (rate <= 0.10) return '#1f3a32';
  if (rate <= 0.30) return '#2e6651';
  if (rate <= 0.60) return '#3f9876';
  return '#5dcaa5';
}
```

これらはすべて副作用なしの純粋関数で、Vitest で `test/conquest_rate.test.js` を作って網羅テストする。

### 14.5 DynamoDB スキーマ（実装詳細）

#### テーブル定義

```
TableName: trip-road-conquests
Region: us-east-1
BillingMode: PAY_PER_REQUEST  (オンデマンド)
AttributeDefinitions:
  - AttributeName: user_id   AttributeType: S
  - AttributeName: muni_code AttributeType: S
KeySchema:
  - AttributeName: user_id   KeyType: HASH    (PK)
  - AttributeName: muni_code KeyType: RANGE   (SK)
PointInTimeRecoverySpecification:
  PointInTimeRecoveryEnabled: true  (誤書き戻し時の復旧用)
```

GSI（Global Secondary Index）は当面不要。1 ユーザー全件 Query で十分なため。

#### アイテム例

```json
{
  "user_id": { "S": "tetutetu" },
  "muni_code": { "S": "14216" },
  "first_visit": { "S": "2026-04-15T14:32:45.123Z" },
  "prefecture_code": { "S": "14" },
  "region_code": { "S": "kanto" },
  "name": { "S": "綾瀬市" },
  "prefecture": { "S": "神奈川県" },
  "created_at": { "S": "2026-05-24T08:30:00.000Z" }
}
```

DynamoDB の JSON 形式（属性に型タグが付くやつ）で書く。Workers から aws4fetch で REST 直叩きするためこの形式が必要。

### 14.6 Workers API 詳細

#### POST `/api/conquests`

リクエスト:
```http
POST /api/conquests HTTP/1.1
X-App-Password: <password>
Content-Type: application/json

{
  "items": [
    {
      "muni_code": "14216",
      "first_visit": "2026-04-15T14:32:45.123Z",
      "prefecture_code": "14",
      "region_code": "kanto",
      "name": "綾瀬市",
      "prefecture": "神奈川県"
    }
  ]
}
```

- `items` は 1 件以上、上限 100 件（25 件ずつ BatchWriteItem で内部分割）
- 既存レコードがあるエントリは ConditionExpression で skip

レスポンス（成功）:
```json
{
  "ok": true,
  "written": 1,
  "skipped": 0
}
```

エラーレスポンス:

| HTTP | Body |
|---|---|
| 401 | `{"error": "unauthorized"}` |
| 400 | `{"error": "invalid_request", "detail": "items required"}` |
| 500 | `{"error": "internal_error"}` |

#### GET `/api/conquests`

リクエスト:
```http
GET /api/conquests HTTP/1.1
X-App-Password: <password>
```

レスポンス（成功）:
```json
{
  "items": [
    {
      "muni_code": "14216",
      "first_visit": "2026-04-15T14:32:45.123Z",
      "prefecture_code": "14",
      "region_code": "kanto",
      "name": "綾瀬市",
      "prefecture": "神奈川県",
      "created_at": "2026-05-24T08:30:00.000Z"
    }
  ]
}
```

- 全件返却。1900 件 × 200B ≒ 380KB、1 リクエストで収まる
- LastEvaluatedKey が返ってきたら継続クエリして全件まとめる

エラーレスポンスは POST と同形式。

#### DynamoDB API 呼び出し（Workers 側）

aws4fetch を使って SigV4 署名し、`https://dynamodb.us-east-1.amazonaws.com/` に POST する。

```js
// workers/src/dynamodb.js (新規)
import { AwsClient } from 'aws4fetch';

export function createDynamoClient(env) {
  return new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    region: env.AWS_REGION,
    service: 'dynamodb',
  });
}

export async function batchWriteConquests(client, items) {
  const requestItems = items.map(item => ({
    PutRequest: {
      Item: {
        user_id: { S: 'tetutetu' },
        muni_code: { S: item.muni_code },
        first_visit: { S: item.first_visit },
        prefecture_code: { S: item.prefecture_code },
        region_code: { S: item.region_code },
        name: { S: item.name },
        prefecture: { S: item.prefecture },
        created_at: { S: new Date().toISOString() },
      },
      // ConditionExpression は BatchWriteItem では使えないため、
      // 「初回のみ書く」は個別 PutItem ループで実現する
    },
  }));

  const res = await client.fetch('https://dynamodb.us-east-1.amazonaws.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': 'DynamoDB_20120810.BatchWriteItem',
    },
    body: JSON.stringify({
      RequestItems: { 'trip-road-conquests': requestItems },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DynamoDB BatchWriteItem failed: ${res.status} ${errText}`);
  }
  return res.json();
}

export async function queryConquests(client) {
  const res = await client.fetch('https://dynamodb.us-east-1.amazonaws.com/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': 'DynamoDB_20120810.Query',
    },
    body: JSON.stringify({
      TableName: 'trip-road-conquests',
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: { ':uid': { S: 'tetutetu' } },
    }),
  });
  // LastEvaluatedKey 対応は省略（1900 件なら 1 ページで返る想定）
  const data = await res.json();
  return data.Items.map(unmarshallItem);
}

function unmarshallItem(item) {
  return {
    muni_code: item.muni_code.S,
    first_visit: item.first_visit.S,
    prefecture_code: item.prefecture_code.S,
    region_code: item.region_code.S,
    name: item.name.S,
    prefecture: item.prefecture.S,
    created_at: item.created_at.S,
  };
}
```

「同じ muni_code は first_visit を保持して上書きしない」は **BatchWriteItem では ConditionExpression が使えない**ため、個別 PutItem ループで `ConditionExpression: 'attribute_not_exists(user_id)'` を付けて回す方法に切り替える。条件失敗時の `ConditionalCheckFailedException` は「既存スキップ」として扱い、`written` カウンタを増やさず `skipped` を増やす。

### 14.7 localStorage スキーマ拡張

既存の `storage.js` で `visited` 構造を以下に拡張する（下位互換あり）:

```js
state.visited[muniCode] = {
  name: string,
  prefecture: string,
  firstVisit: string,        // ISO 8601、既存
  description: string|null,  // 既存

  // 新規追加（既存データには undefined。マイグレーションで埋める）
  prefectureCode: string,    // "14" など
  regionCode: string,        // "kanto" など
  synced: boolean,           // DynamoDB 反映済か（既存データは false 扱い）
};
```

新規追加 storage.js 関数:
- `getUnsyncedVisitedBefore(today: number): Array<...>` — 前日以前 (`!isSameLocalDay(firstVisit, today)`) で `synced !== true` のエントリを返す
- `markVisitedSynced(muniCodes: string[]): void` — 渡された code 群の `synced = true` をセット
- `enrichVisitedWithCodes(meta: {muni_code → {region_code, prefecture_code}}): void` — 既存 visited に prefectureCode / regionCode が欠けていれば埋める

### 14.8 起動時の同期フロー

```
enterMainApp の最後 (既存処理の後):
  1. fetch('/conquest_meta.json') で muni_code → {region_code, prefecture_code} ロード
  2. enrichVisitedWithCodes(meta)  — 既存 visited に code を埋める
  3. getUnsyncedVisitedBefore(Date.now()) で対象抽出
  4. 対象 0 件なら何もしない
  5. 対象 ≥1 件なら POST /api/conquests へ 25 件ずつ送る
  6. 成功した code 群を markVisitedSynced で同期済マーク
  7. 失敗時は localStorage を変更せず次回起動時に再試行
```

非同期で実行し、UI ブロックしない。エラーは console.warn のみ。

### 14.9 履歴画面の読み込みフロー

```
🗺️ ボタンタップ:
  1. showHistoryScreen()
  2. キャッシュ確認: localStorage.conquestsCache に 60 秒以内のデータがあればそれを使う
  3. なければ GET /api/conquests を呼ぶ
  4. 結果を conquestsCache に保存
  5. localStorage.visited とマージ (DynamoDB 未反映の当日分も塗りたい)
  6. レベル0 描画
```

タイムアウト 5 秒で諦め、localStorage の visited のみで描画する（DynamoDB 未到達でも当日分は見える）。

### 14.10 preprocess: regions.geojson / prefectures.geojson 生成

新スクリプト `preprocess/build_regions.py`:

入力: 既存 N03 ベクタ（県・市町村レベル）
処理:
1. 都道府県コード単位で市町村ポリゴンを `shapely.ops.unary_union` で集約 → 都道府県ポリゴン
2. 地方コード（spec 14.11 のマッピング）単位でさらに集約 → 地方ポリゴン
3. それぞれを tolerance を変えて簡略化 (`Polygon.simplify(tolerance)`)
   - 地方: tolerance 0.01 度（粗くてOK、目視で見えるサイズ）
   - 都道府県: tolerance 0.005 度

出力:
- `public/regions.geojson`: 8 features
   ```json
   {
     "type": "FeatureCollection",
     "features": [
       {
         "type": "Feature",
         "geometry": {...},
         "properties": {
           "region_code": "kanto",
           "name": "関東",
           "muni_count": 290
         }
       }
     ]
   }
   ```
- `public/prefectures.geojson`: 47 features、properties に `prefecture_code` / `name` / `region_code` / `muni_count`
- `public/conquest_meta.json`: `{ "14216": {"region_code": "kanto", "prefecture_code": "14"}, ... }` 全市町村分

### 14.11 都道府県 → 地方コードのマッピング（実装で使う定数）

```js
// public/assets/region_mapping.js
export const PREFECTURE_TO_REGION = {
  '01': 'hokkaido',
  '02': 'tohoku', '03': 'tohoku', '04': 'tohoku', '05': 'tohoku', '06': 'tohoku', '07': 'tohoku',
  '08': 'kanto', '09': 'kanto', '10': 'kanto', '11': 'kanto', '12': 'kanto', '13': 'kanto', '14': 'kanto',
  '15': 'chubu', '16': 'chubu', '17': 'chubu', '18': 'chubu', '19': 'chubu', '20': 'chubu', '21': 'chubu', '22': 'chubu', '23': 'chubu',
  '24': 'kinki', '25': 'kinki', '26': 'kinki', '27': 'kinki', '28': 'kinki', '29': 'kinki', '30': 'kinki',
  '31': 'chugoku', '32': 'chugoku', '33': 'chugoku', '34': 'chugoku', '35': 'chugoku',
  '36': 'shikoku', '37': 'shikoku', '38': 'shikoku', '39': 'shikoku',
  '40': 'kyushu', '41': 'kyushu', '42': 'kyushu', '43': 'kyushu', '44': 'kyushu', '45': 'kyushu', '46': 'kyushu', '47': 'kyushu',
};

export const REGION_NAMES = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東',
  chubu: '中部',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州・沖縄',
};
```

Workers でも同マップが必要なら `workers/src/region_mapping.js` にコピーする（小さいので重複を許容）。

### 14.12 IAM ポリシー JSON（コピペ可能形式）

既存 IAM ユーザー `trip-road-telemetry-writer` のインラインポリシーに以下を追加:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "TripRoadDynamoDBConquests",
      "Effect": "Allow",
      "Action": [
        "dynamodb:PutItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:Query"
      ],
      "Resource": "arn:aws:dynamodb:us-east-1:<ACCOUNT_ID>:table/trip-road-conquests"
    }
  ]
}
```

ACCOUNT_ID は `aws sts get-caller-identity` で動的取得（plan.md §12 と同じ流儀）。CLI コマンドは Phase 13-0 で別途記載。

### 14.13 テスト戦略

#### 単体テスト（Vitest）

新規ファイル:
- `test/conquest_rate.test.js`: rateForRegion / rateForPrefecture / rateForMunicipality / colorForRate
- `test/conquests_sync.test.js`: getUnsyncedVisitedBefore / markVisitedSynced / enrichVisitedWithCodes
- `test/region_mapping.test.js`: PREFECTURE_TO_REGION の全 47 件カバレッジ

各 8-15 件、合計 +40 件を見込む。

#### 結合テスト（Workers）

- `workers/test/conquests.test.js`: POST/GET ハンドラのモックテスト
- DynamoDB クライアントは fetch モックで偽装（aws4fetch を mock）
- ConditionalCheckFailedException ハンドリングを必ずテスト

#### 実機テスト（Phase 13-6 完了判定）

- [ ] 初回起動で localStorage 既存 visited が DynamoDB に転送される
- [ ] 履歴画面を開くと地方単位の色濃度が表示される
- [ ] 関東タップで都道府県レベルへ遷移
- [ ] 神奈川タップで市町村レベルへ遷移、踏破済（綾瀬市など）が緑、未踏が灰
- [ ] 綾瀬市タップで詳細（初回訪問日 + 解説）が見える
- [ ] DevTools / curl で DynamoDB に意図したアイテムだけが書かれていることを確認

### 14.14 エラーハンドリング

| 発生箇所 | エラー | 動作 |
|---|---|---|
| 同期書込 (POST) | ネットワーク失敗 / 500 | localStorage 変更せず、次回起動でリトライ |
| 同期書込 (POST) | 401 | パスワード期限切れと判断、メイン画面と同じく `setupPasswordScreen` を呼ぶ |
| 履歴読込 (GET) | 5 秒タイムアウト | localStorage の visited のみで描画、画面下にトースト「サーバー応答なし、ローカル分のみ表示」 |
| 履歴読込 (GET) | 401 | 同上 |
| 階層 GeoJSON 読込 | 404 / パースエラー | エラーモーダル「履歴画面を準備中、もう一度お試しください」、戻るボタンのみ表示 |
| `conquest_meta.json` 読込失敗 | 同期処理スキップ（既存 visited のままで履歴は描画可能だが、新規 visited に code が埋まらないため次回同期時に再試行） |

### 14.15 不採用案の実装影響

plan.md §13.14 で挙げた不採用案について、もし将来必要になった時の差分メモ:

- **同じ市町村の複数回訪問記録を取りたい**: 現スキーマは SK=`muni_code` で 1 市町村 1 アイテム。日付別ログが必要になったら、別テーブル `trip-road-visits` を作って SK=`visit#YYYYMMDD#muni_code` で複数行持つ。既存テーブルは無傷で読込キャッシュとして残る
- **複数ユーザー対応**: §13.5 で説明済。PK 値を Cognito sub に差し替える 1-shot 移行スクリプトのみで対応可
- **書込即時化**: 履歴ビューのリアルタイム性が問われるようになったら、市町村切替時に追加で POST する。バッチ flush は維持してリトライ層として残す
