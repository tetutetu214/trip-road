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
{ "error": "upstream_error", "detail": "Anthropic API error: ..." }
```

### 5.5 CORS

- `Access-Control-Allow-Origin`: Workers Secret `ALLOWED_ORIGIN`（Cloudflare Pages ドメイン）
- `Access-Control-Allow-Methods`: `POST, OPTIONS`
- `Access-Control-Allow-Headers`: `Content-Type, X-App-Password`
- OPTIONS プリフライト対応必須

### 5.6 Workers Secrets

| キー | 内容 |
|---|---|
| `APP_PASSWORD` | 32 文字 hex パスワード |
| `ANTHROPIC_API_KEY` | Anthropic API キー |
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

### 6.3 Anthropic Messages API 呼出パラメータ

```json
{
  "model": "claude-haiku-4-5-20251001",
  "max_tokens": 400,
  "system": "[6.1 のテキスト]",
  "messages": [
    { "role": "user", "content": "[6.2 のテキスト]" }
  ]
}
```

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

```
[フロント]                    [Workers /api/describe]              [外部]
   │                                  │
   │── POST /api/describe ────────────▶
   │                                  │── 生成 ──────────────────▶ Anthropic Haiku
   │                                  │◀──────── description ────
   │                                  │
   │                                  │── Wikipedia 取得（軸1用）─▶ Wikipedia API
   │                                  │◀──────── extract ─────────
   │                                  │   （Workers Cache API、TTL 30日）
   │                                  │
   │                                  │── Judge 4軸並列 ──────────▶ Anthropic Sonnet 4.6
   │                                  │◀──────── 4 scores ────────
   │                                  │
   │                                  │   if 全軸4点以上 + 文字数OK
   │                                  │   → 合格 / キャッシュへ
   │                                  │   else 1回だけ再生成
   │                                  │   → 再評価 → 結果に関わらず打ち切り
   │                                  │
   │◀─ JSON (description + judge_*) ──│
   │                                  │
   │ 経過時間で段階表示                 │
```

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

#### 軸 1: 事実正確性 prompt（差分）

```
【観点】 地理・歴史・地形に関する記述が、以下の Wikipedia 抜粋と照合して事実誤認や根拠なき記述になっていないか。
（Wikipedia に明記されていない事項は「根拠なし」とみなし減点。Wikipedia と直接矛盾する記述はより重く減点。）

【Wikipedia 抜粋】
{wikipedia_extract}

【Few-shot 例】

例A（5点想定）:
解説:「緑区は津久井湖と相模湖を抱える山岳地帯。標高1,673mの蛭ヶ岳（神奈川県最高峰）が区西部にそびえ、江戸期は甲州街道の宿場町として賑わった。」
→ 出力: {"deductions": [], "score": 5, "notes": "Wikipediaと整合"}

例B（2点想定）:
解説:「相模原市緑区は江戸時代の城下町として栄え、武家屋敷の街並みが今も残る。」
→ 出力: {"deductions": ["江戸時代の城下町として栄え（Wikipediaに記載なし、緑区は城下町ではない）", "武家屋敷の街並み（同上、根拠なし）"], "score": 2, "notes": "城下町という根拠不明な前提が複数文にわたる"}

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

    const passed = [accuracy, specificity, seasonFit, density].every(j => j.score >= 4);
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
  "judge_error": null
}
```

- `judge_passed`: 全 LLM 軸 4 点以上 + 文字数 OK なら true
- `judge_scores`: 各軸スコア（fail-open 時は null）
- `regenerated`: 1 回目で合格なら false、再生成発生で true
- `judge_error`: judge 自体で例外発生時のメッセージ（fail-open 時のみ非 null）

#### キャッシュ条件

Workers 側で `judge_passed === true` のときのみ `{muni_code}_{solar_term}` をキーにキャッシュ書込。それ以外（`false` または fail-open `null`）はキャッシュしない。

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

過去 entry（4.29 までの 8 件）には新規フィールドが存在しない。分析時は欠損を許容する。

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
| Sonnet judge レート制限 | 1 回だけリトライ（指数バックオフ 1秒）→ なお失敗なら fail-open |
| Sonnet judge JSON パース失敗 | その軸は score=null として fail-open フラグを立てる |
| 再生成（Haiku）も失敗 | 既存の 502 エラー応答に倣う |
| 文字数 NG が 2 連続 | 通常通り表示・キャッシュなし（length 違反は generator プロンプト調整で潰す範疇） |

---

## 11. 次のステップ

1. この第 10 章をてつてつがレビュー（このステップ）
2. OK なら Plan E 実装開始（todo.md 6.1 〜 6.7 の順、TDD）
3. 各 Phase 完了ごとにコミット + プッシュ + 進捗報告
