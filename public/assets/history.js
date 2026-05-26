/**
 * 踏破履歴ビュー（階層コロプレス）。
 *
 * spec.md §14 で定めた 4 レベル UI を Leaflet 上で実現する。
 * メイン地図とは別の Leaflet インスタンスを持ち、画面を出入りするたびに
 * レイヤーを掃除して初期状態に戻す。
 *
 * UI 設計（実機フィードバック反映、2026-05-24）:
 *   - 1 タップ目: そのエリアを「選択状態」にする（ボーダー強調）
 *   - 2 タップ目（同一エリア再タップ）: 下位レベルへ遷移
 *   - レベル切替時に setMaxBounds でパン範囲を制限（他エリアにスワイプで滑らない）
 *   - 県レベルでは全市町村を灰塗りし、踏破済のみ緑塗りで「行ったところ」を可視化
 *
 * データソース:
 *   - DATA_BASE_URL/regions.geojson          (8 地方ポリゴン)
 *   - DATA_BASE_URL/prefectures.geojson      (47 都道府県ポリゴン)
 *   - DATA_BASE_URL/conquest_meta.json       (muni_code → {region_code, prefecture_code})
 *   - DATA_BASE_URL/municipalities/{code}.geojson  (個別市町村)
 *   - API_BASE_URL/api/conquests (GET, 認証付き) → 踏破履歴
 */
import { DATA_BASE_URL, TILE_URL } from './config.js';
import { getConquests } from './api.js';
import { loadState, getPassword } from './storage.js';
import { colorForRate, rateForRegion, rateForPrefecture, enrichWithCodes } from './conquest_rate.js';
import { REGION_NAMES } from './region_mapping.js';

let historyMap = null;
let conquests = [];           // [{muni_code, region_code, prefecture_code, ...}]
let conquestMeta = {};        // {muni_code: {region_code, prefecture_code}}
let regionTotals = {};        // {region_code: muni_count}
let prefTotals = {};          // {prefecture_code: muni_count}
let regionGeo = null;
let prefectureGeo = null;
let currentLevel = 0;
let currentRegion = null;
let currentPrefecture = null;
// 1 タップ目で選択した（まだ遷移していない）コード。同一を 2 度タップで遷移。
let pendingRegion = null;
let pendingPrefecture = null;
let dataLoaded = false;

/**
 * E2E テスト（Playwright）から状態を観察するための最小公開。
 * 本番でも読み取れるが、機微情報は含まないので副作用なし。
 * テスト不要になったら削除可。
 */
function exposeForE2E() {
  if (typeof window === 'undefined') return;
  window.__tripRoadHistory = {
    map: historyMap,
    conquests,
    level: currentLevel,
    region: currentRegion,
    prefecture: currentPrefecture,
    pendingRegion,
    pendingPrefecture,
  };
}

const HISTORY_SCREEN_ID = 'history-screen';
const HISTORY_MAP_ID = 'history-map';
// 日本全土のおおよその bounds（北海道北端〜沖縄南端を覆う）
const JAPAN_BOUNDS = [[24, 122], [46, 146]];

/**
 * 単一 ring の符号付き面積を shoelace 公式で計算（GeoJSON 座標は [lon, lat]）。
 * 経緯度の度単位での近似面積で、相対比較にのみ使う。
 */
export function ringArea(ring) {
  let area = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return Math.abs(area / 2);
}

/**
 * GeoJSON Feature の Polygon / MultiPolygon から最大面積の外周 ring を返す。
 * Leaflet 非依存の純粋関数。離島除外のための「本土 ring」抽出に使う。
 *
 * @returns {number[][] | null} ring (= [[lon, lat], ...]), なければ null
 */
export function pickMainlandRing(feature) {
  const geom = feature?.geometry;
  if (!geom) return null;
  let rings;
  if (geom.type === 'Polygon') {
    rings = [geom.coordinates[0]];
  } else if (geom.type === 'MultiPolygon') {
    rings = geom.coordinates.map((poly) => poly[0]);
  } else {
    return null;
  }
  let bestArea = -1;
  let bestRing = null;
  for (const ring of rings) {
    const area = ringArea(ring);
    if (area > bestArea) {
      bestArea = area;
      bestRing = ring;
    }
  }
  return bestRing;
}

/**
 * ring の経緯度範囲を {minLat, maxLat, minLon, maxLon} で返す。純粋関数。
 */
export function ringExtent(ring) {
  if (!ring || ring.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  return { minLat, maxLat, minLon, maxLon };
}

/**
 * Feature の MultiPolygon / Polygon から「最大面積の polygon」の bounds を返す。
 *
 * 離島（小笠原・北方領土・八重山等）を除いた「本土の bounds」を取るための関数。
 * 単純な L.geoJSON(feature).getBounds() だと離島まで含めてしまい
 * 関東で小笠原までフィットされて縮尺が無意味になる問題への対策。
 */
export function getMainlandBounds(feature) {
  const ring = pickMainlandRing(feature);
  if (!ring) return null;
  const ext = ringExtent(ring);
  if (!ext) return null;
  return L.latLngBounds([[ext.minLat, ext.minLon], [ext.maxLat, ext.maxLon]]);
}

/**
 * Feature 配列の本土 bounds を合成する（地方レベルで複数都道府県の本土部分を覆う bounds）。
 */
export function unionMainlandBounds(features) {
  let union = null;
  for (const f of features) {
    const b = getMainlandBounds(f);
    if (!b) continue;
    union = union ? union.extend(b) : b;
  }
  return union;
}

export function setupHistoryScreen() {
  const back = document.querySelector(`#${HISTORY_SCREEN_ID} .history-back`);
  if (back) back.addEventListener('click', handleBack);
}

export async function openHistoryScreen() {
  debugMsg('history open');
  showHistoryScreen();
  if (!historyMap) initHistoryMap();
  setLoading(true);
  try {
    await loadHistoryData();
    currentLevel = 0;
    currentRegion = null;
    currentPrefecture = null;
    pendingRegion = null;
    pendingPrefecture = null;
    renderLevel0();
  } catch (e) {
    setError('履歴の読み込みに失敗しました');
    console.warn('[history] open failed', e);
  } finally {
    setLoading(false);
  }
}

function showHistoryScreen() {
  const el = document.getElementById(HISTORY_SCREEN_ID);
  if (el) el.classList.remove('hidden');
  const main = document.getElementById('main-screen');
  if (main) main.classList.add('hidden');
}

function hideHistoryScreen() {
  const el = document.getElementById(HISTORY_SCREEN_ID);
  if (el) el.classList.add('hidden');
  const main = document.getElementById('main-screen');
  if (main) main.classList.remove('hidden');
}

function initHistoryMap() {
  historyMap = L.map(HISTORY_MAP_ID, {
    center: [36, 138],
    zoom: 5,
    zoomControl: false,
    attributionControl: false,
    maxBounds: JAPAN_BOUNDS,
    maxBoundsViscosity: 1.0,  // 境界を超えるパンをはね返す
    // preferCanvas は採用しない。当初 iOS の SVG タップ問題対策として有効化したが、
    // E2E 検証で Canvas renderer + 動的 fitBounds の組合せで L1 の hit testing が
    // 壊れることを確認した（L0 は動くが L1 で polygon タップが拾われない）。
    // SVG renderer の方が安定する。iOS 実機の SVG タップ問題は、当時の真因が
    // 「点線オーバーレイの interactive: false 伝播不全」だったので、それを
    // 廃止済の現状では SVG でも問題なくタップが届く。
  });
  L.tileLayer(TILE_URL, { maxZoom: 18 }).addTo(historyMap);
  setTimeout(() => historyMap.invalidateSize(), 100);
  exposeForE2E();
}

/**
 * 内部状態を console.log にだけ出す軽量ログ。E2E が console を拾えるので
 * これで十分。実機からの画面確認は不要になった（E2E が動作を保証する）。
 */
function debugMsg(msg) {
  console.log('[history]', msg);
}

async function loadHistoryData() {
  if (dataLoaded) {
    await refreshConquests();
    return;
  }
  const [regions, prefs, meta] = await Promise.all([
    fetch(`${DATA_BASE_URL}/regions.geojson`).then(r => r.json()),
    fetch(`${DATA_BASE_URL}/prefectures.geojson`).then(r => r.json()),
    fetch(`${DATA_BASE_URL}/conquest_meta.json`).then(r => r.json()),
  ]);
  regionGeo = regions;
  prefectureGeo = prefs;
  conquestMeta = meta;
  regionTotals = Object.fromEntries(
    regions.features.map(f => [f.properties.region_code, f.properties.muni_count]),
  );
  prefTotals = Object.fromEntries(
    prefs.features.map(f => [f.properties.prefecture_code, f.properties.muni_count]),
  );
  dataLoaded = true;
  await refreshConquests();
}

async function refreshConquests() {
  const password = getPassword();
  if (!password) {
    conquests = collectLocalConquests();
    exposeForE2E();
    return;
  }
  const result = await getConquests(password, { timeoutMs: 5000 });
  if (result.ok) {
    const merged = new Map();
    for (const it of result.items) merged.set(it.muni_code, it);
    for (const local of collectLocalConquests()) {
      if (!merged.has(local.muni_code)) merged.set(local.muni_code, local);
    }
    conquests = Array.from(merged.values());
  } else {
    conquests = collectLocalConquests();
    console.warn('[history] /api/conquests failed, falling back to localStorage', result);
  }
  exposeForE2E();
}

function collectLocalConquests() {
  const state = loadState();
  const list = [];
  for (const [muni_code, v] of Object.entries(state.visited || {})) {
    const item = enrichWithCodes({
      muni_code,
      first_visit: v.firstVisit,
      prefecture_code: v.prefectureCode,
      region_code: v.regionCode,
      name: v.name,
      prefecture: v.prefecture,
    });
    if (item.region_code && item.prefecture_code) list.push(item);
  }
  return list;
}

// === 描画ヘルパー ===

function clearLayers() {
  if (!historyMap) return;
  historyMap.eachLayer((layer) => {
    if (layer instanceof L.TileLayer) return;
    historyMap.removeLayer(layer);
  });
}

/**
 * 踏破率（または踏破済か否か）に応じたコロプレス用スタイルを返す。
 * isSelected=true のときは強調ボーダー。
 */
function styleForRate(rate, isSelected = false) {
  // 縁取りは黄色 (#ffd866)。塗りつぶしのミントグリーン階調と補色関係になるので
  // 境界線がはっきり浮き出る。選択時は白に切替えて差別化。
  return {
    fillColor: colorForRate(rate),
    fillOpacity: isSelected ? 0.9 : 0.7,
    color: isSelected ? '#ffffff' : '#ffd866',
    weight: isSelected ? 3 : 1.5,
  };
}

function setTitle(text) {
  const el = document.querySelector(`#${HISTORY_SCREEN_ID} .history-title`);
  if (el) el.textContent = text;
}

function setStats(main, sub) {
  const m = document.querySelector(`#${HISTORY_SCREEN_ID} .stat-main`);
  const s = document.querySelector(`#${HISTORY_SCREEN_ID} .stat-sub`);
  if (m) m.textContent = main;
  if (s) s.textContent = sub ?? '';
}

function setLoading(isLoading) {
  const el = document.querySelector(`#${HISTORY_SCREEN_ID} .history-loading`);
  if (el) el.style.display = isLoading ? '' : 'none';
}

function setError(msg) {
  const el = document.querySelector(`#${HISTORY_SCREEN_ID} .history-error`);
  if (el) {
    el.textContent = msg;
    el.style.display = '';
    setTimeout(() => { el.style.display = 'none'; }, 4000);
  }
}

// === レベル 0: 日本全土 → 8 地方 ===

function renderLevel0() {
  if (!historyMap || !regionGeo) return;
  clearLayers();
  setTitle('日本全土');
  const totalMuni = Object.values(regionTotals).reduce((a, b) => a + b, 0);
  setStats(
    `8 地方 / ${conquests.length} 市町村踏破`,
    `全 ${totalMuni} 市町村中 ${conquests.length} 踏破`,
  );

  L.geoJSON(regionGeo, {
    style: (feature) => {
      const code = feature.properties.region_code;
      const rate = rateForRegion(code, conquests, regionTotals);
      return styleForRate(rate, code === pendingRegion);
    },
    onEachFeature: (feature, layer) => {
      // Leaflet 1.9 では iOS の double-tap zoom 防止のため `tap: true` がデフォルト。
      // `click` だけだと touch 連続タップを認識しないことがあるので `tap` も併せて listen。
      const onTap = () => {
        const code = feature.properties.region_code;
        debugMsg(`L0 click ${code} pending=${pendingRegion}`);
        if (pendingRegion === code) {
          currentRegion = code;
          currentLevel = 1;
          pendingRegion = null;
          renderLevel1();
        } else {
          pendingRegion = code;
          exposeForE2E();
          renderLevel0();
        }
      };
      layer.on('click', onTap);
      layer.on('tap', onTap);
    },
  }).addTo(historyMap);

  historyMap.setMaxBounds(JAPAN_BOUNDS);
  historyMap.setView([36, 138], 5);
  exposeForE2E();
}

/**
 * 指定 feature 配列の geometry を「穴 (hole)」として、外側を半透明の黒で覆う
 * マスクポリゴンを map に追加する。
 * 「県外/地方外を暗くする」ことで、PC ワイドビュー時に対象エリア以外の地理院
 * クリーム色背景が目立つ問題を解消する。
 *
 * Leaflet Polygon は [outer, ...holes] 形式で外周 + 穴を表現できる。
 * GeoJSON [lon, lat] → Leaflet [lat, lon] 変換も同時に行う。
 * 大きな outer ring は日本全土を覆う矩形（lat 20-50 / lon 120-150）。
 *
 * @param {Array<{geometry: object}>} features
 * @returns {L.Polygon | null}
 */
function addOutsideMask(features) {
  if (!features || features.length === 0) return null;
  const holes = [];
  for (const feature of features) {
    const geom = feature?.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      holes.push(geom.coordinates[0].map(([lon, lat]) => [lat, lon]));
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        holes.push(poly[0].map(([lon, lat]) => [lat, lon]));
      }
    }
  }
  if (holes.length === 0) return null;
  const outerRing = [[20, 120], [50, 120], [50, 150], [20, 150], [20, 120]];
  const mask = L.polygon([outerRing, ...holes], {
    fillColor: '#0a0a0c',
    fillOpacity: 0.7,
    stroke: false,
    interactive: false,  // クリックを下層 polygon に通す
  });
  mask.addTo(historyMap);
  return mask;
}

// === レベル 1: 地方 → 都道府県 ===

function renderLevel1() {
  if (!historyMap || !prefectureGeo || !currentRegion) return;
  clearLayers();
  setTitle(REGION_NAMES[currentRegion] ?? currentRegion);

  const filtered = {
    type: 'FeatureCollection',
    features: prefectureGeo.features.filter(
      f => f.properties.region_code === currentRegion,
    ),
  };

  // 地方外を暗くマスク（PC ワイド表示で他地方のクリーム色背景が目立つ問題対策）
  addOutsideMask(filtered.features);
  const conquered = conquests.filter(c => c.region_code === currentRegion).length;
  const total = filtered.features.reduce(
    (sum, f) => sum + (f.properties.muni_count ?? 0), 0,
  );
  setStats(
    `${filtered.features.length} 都道府県`,
    `全 ${total} 市町村中 ${conquered} 踏破`,
  );

  const layer = L.geoJSON(filtered, {
    style: (feature) => {
      const code = feature.properties.prefecture_code;
      const rate = rateForPrefecture(code, conquests, prefTotals);
      return styleForRate(rate, code === pendingPrefecture);
    },
    onEachFeature: (feature, l) => {
      const onTap = () => {
        const code = feature.properties.prefecture_code;
        debugMsg(`L1 click ${code} pending=${pendingPrefecture}`);
        if (pendingPrefecture === code) {
          currentPrefecture = code;
          currentLevel = 2;
          pendingPrefecture = null;
          renderLevel2();
        } else {
          pendingPrefecture = code;
          exposeForE2E();
          renderLevel1();
        }
      };
      l.on('click', onTap);
      l.on('tap', onTap);
    },
  }).addTo(historyMap);

  try {
    // 離島を含む getBounds() ではなく、本土だけの bounds を計算してフィット
    const main = unionMainlandBounds(filtered.features);
    const full = layer.getBounds();
    if (main && main.isValid()) {
      historyMap.fitBounds(main, { padding: [20, 20] });
      // パン制限は離島も含めた full bounds に少し余裕を持たせて設定
      // （離島の踏破済が将来描画される場合に備える）
      if (full && full.isValid()) {
        historyMap.setMaxBounds(full.pad(0.1));
      } else {
        historyMap.setMaxBounds(main.pad(0.3));
      }
    } else if (full && full.isValid()) {
      historyMap.setMaxBounds(full.pad(0.05));
      historyMap.fitBounds(full, { padding: [20, 20] });
    }
  } catch (_) { /* noop */ }
  exposeForE2E();
}

// === レベル 2: 都道府県 → 市町村 ===

async function renderLevel2() {
  if (!historyMap || !currentPrefecture) return;
  clearLayers();
  const prefFeature = prefectureGeo.features.find(
    f => f.properties.prefecture_code === currentPrefecture,
  );
  // 県外を暗くマスク（暫定: 粗い prefFeature で fetch 中の暗転を入れる）。
  // 市町村 polygon の fetch 完了後に詳細マスクに置き換える。
  let tempMask = null;
  if (prefFeature) tempMask = addOutsideMask([prefFeature]);
  const prefName = prefFeature?.properties.name ?? currentPrefecture;
  setTitle(prefName);

  const prefConquests = conquests.filter(c => c.prefecture_code === currentPrefecture);
  const total = prefTotals[currentPrefecture] ?? 0;
  debugMsg(`L2 ${prefName} 踏破=${prefConquests.length}`);
  setStats(
    `${prefName} の踏破: ${prefConquests.length} / ${total}`,
    total > 0 ? `${Math.round((prefConquests.length / total) * 100)}%` : '',
  );

  // 県境ライン用の overlay は描画しない。
  // 以前は点線ポリゴンを市町村レイヤーの上に被せていたが、interactive: false が
  // Leaflet で完全には効かず、市町村タップが吸われて詳細モーダルが開かない
  // 不具合が起きていた。市町村ポリゴンの輪郭が事実上の県境表示を兼ねる。
  if (prefFeature) {
    try {
      // 本土だけの bounds と離島含む full bounds を、map に add せずに算出する
      const main = getMainlandBounds(prefFeature);
      const tmpLayer = L.geoJSON(prefFeature);
      const full = tmpLayer.getBounds();
      if (main && main.isValid()) {
        historyMap.fitBounds(main, { padding: [10, 10] });
        if (full && full.isValid()) {
          historyMap.setMaxBounds(full.pad(0.1));
        } else {
          historyMap.setMaxBounds(main.pad(0.3));
        }
      } else if (full && full.isValid()) {
        historyMap.setMaxBounds(full.pad(0.05));
        historyMap.fitBounds(full, { padding: [10, 10] });
      }
    } catch (_) { /* noop */ }
  }

  // 県内の全市町村を抽出（conquest_meta が真実）
  const muniCodesInPref = Object.keys(conquestMeta).filter(
    c => conquestMeta[c].prefecture_code === currentPrefecture,
  );
  const conqueredSet = new Set(prefConquests.map(c => c.muni_code));

  setLoading(true);
  // 全市町村ポリゴンを並列 fetch（add は後で順序を制御する）
  const fetched = await Promise.all(muniCodesInPref.map(async (muniCode) => {
    try {
      const res = await fetch(`${DATA_BASE_URL}/municipalities/${muniCode}.geojson`);
      if (!res.ok) return null;
      const geo = await res.json();
      return { muniCode, geo };
    } catch (e) {
      console.warn('[history] muni fetch failed', muniCode, e);
      return null;
    }
  }));

  // 暫定の粗マスクを削除し、市町村 polygon の集約で詳細マスクに置き換える。
  // 県境のジャギ（preprocess の tolerance 0.05 度起因の粗形）が消える。
  if (tempMask) historyMap.removeLayer(tempMask);
  const muniFeaturesForMask = fetched
    .filter((item) => item && item.geo?.features?.[0]?.geometry)
    .map((item) => ({ geometry: item.geo.features[0].geometry }));
  addOutsideMask(muniFeaturesForMask);

  // Leaflet の同レイヤー内では「後から add した path が DOM 上で前面」になり、
  // タップ判定はその前面要素が優先される。並列 fetch で add 順がランダムだと
  // 未踏（灰）の上に踏破済（緑）が乗ったり逆になったりして、踏破済タップが
  // 灰塗りに吸われて renderLevel3 が呼ばれない不具合があった。
  // 確実に「踏破済タップが拾われる」順序にするため、まず未踏を全部 add、
  // そのあと踏破済を add する 2 パス構造にする。

  // 1) 未踏（灰）を先に add（クリックハンドラなし）
  for (const item of fetched) {
    if (!item) continue;
    if (conqueredSet.has(item.muniCode)) continue;
    L.geoJSON(item.geo, {
      style: { fillColor: '#2a2a2a', fillOpacity: 0.55, color: '#3a3a3e', weight: 0.4 },
    }).addTo(historyMap);
  }

  // 2) 踏破済（緑）を後に add（クリックハンドラあり、上に乗ってタップを受ける）
  let conqueredAdded = 0;
  for (const item of fetched) {
    if (!item) continue;
    if (!conqueredSet.has(item.muniCode)) continue;
    const conquest = prefConquests.find(c => c.muni_code === item.muniCode);
    const geoLayer = L.geoJSON(item.geo, {
      style: { fillColor: '#5dcaa5', fillOpacity: 0.75, color: '#ffd866', weight: 1.5 },
      onEachFeature: (_f, layer) => {
        layer.on('click', (e) => {
          debugMsg(`tap ${item.muniCode} ${conquest?.name ?? '?'}`);
          L.DomEvent.stopPropagation(e);
          currentLevel = 3;
          renderLevel3(conquest);
        });
      },
    });
    geoLayer.addTo(historyMap);
    conqueredAdded++;
  }
  debugMsg(`L2 緑 add=${conqueredAdded}`);

  // 念のため: map レベル click（path クリックが効かない場合の検知）
  historyMap.off('click.historyDebug');
  historyMap.on('click.historyDebug', (e) => {
    debugMsg(`map tap ${e.latlng.lat.toFixed(3)},${e.latlng.lng.toFixed(3)}`);
  });

  setLoading(false);
  exposeForE2E();
}

// === レベル 3: 市町村詳細モーダル ===

function renderLevel3(item) {
  debugMsg(`L3 ${item?.name ?? '?'}`);
  exposeForE2E();
  const date = new Date(item?.first_visit);
  const dateStr = isNaN(date) ? '?' : date.toLocaleString('ja-JP');
  const state = loadState();
  const desc = state.visited?.[item?.muni_code]?.description ?? '';

  // index.html のキャッシュに依存しないよう、モーダル DOM もここで動的生成する。
  // 既存要素があればそれを使い、無ければ body に追加する。
  let detail = document.getElementById('history-detail');
  if (!detail) {
    debugMsg('L3 detail 動的生成');
    detail = document.createElement('div');
    detail.id = 'history-detail';
    Object.assign(detail.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.6)',
      zIndex: '100000',
    });
    document.body.appendChild(detail);
  }

  detail.innerHTML = `
    <div style="background:#16161a;border:1px solid #2e6651;border-radius:12px;padding:18px 18px 22px;width:min(86vw,360px);position:relative;color:#e6e6ea;font-family:sans-serif;">
      <button id="history-detail-close" aria-label="閉じる" style="position:absolute;top:8px;right:8px;background:transparent;color:#8a8a92;border:none;font-size:22px;line-height:1;padding:4px 8px;">×</button>
      <h3 style="margin:0 0 8px 0;font-size:18px;color:#9fe1cb;">${escapeHtml(item?.prefecture ?? '')} ${escapeHtml(item?.name ?? '')}</h3>
      <p style="margin:6px 0;font-size:12px;color:#8a8a92;">初回訪問: ${escapeHtml(dateStr)}</p>
      <p style="margin:8px 0 0;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(desc || '解説キャッシュなし')}</p>
    </div>
  `;
  detail.style.display = 'flex';
  debugMsg('L3 表示済み');

  const close = document.getElementById('history-detail-close');
  if (close) close.addEventListener('click', () => {
    detail.style.display = 'none';
    currentLevel = 2;
  });
}

function handleBack() {
  if (currentLevel === 3) {
    const detail = document.getElementById('history-detail');
    if (detail) detail.style.display = 'none';
    currentLevel = 2;
    return;
  }
  if (currentLevel === 2) {
    currentLevel = 1;
    pendingPrefecture = null;
    renderLevel1();
    return;
  }
  if (currentLevel === 1) {
    currentLevel = 0;
    currentRegion = null;
    pendingRegion = null;
    renderLevel0();
    return;
  }
  hideHistoryScreen();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
