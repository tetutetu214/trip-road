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
  });
  L.tileLayer(TILE_URL, { maxZoom: 18 }).addTo(historyMap);
  setTimeout(() => historyMap.invalidateSize(), 100);
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
  return {
    fillColor: colorForRate(rate),
    fillOpacity: isSelected ? 0.9 : 0.7,
    color: isSelected ? '#ffffff' : '#5dcaa5',
    weight: isSelected ? 3 : 1,
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
      layer.on('click', () => {
        const code = feature.properties.region_code;
        if (pendingRegion === code) {
          // 2 タップ目: 遷移
          currentRegion = code;
          currentLevel = 1;
          pendingRegion = null;
          renderLevel1();
        } else {
          // 1 タップ目: ハイライト
          pendingRegion = code;
          renderLevel0();
        }
      });
    },
  }).addTo(historyMap);

  historyMap.setMaxBounds(JAPAN_BOUNDS);
  historyMap.setView([36, 138], 5);
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
      l.on('click', () => {
        const code = feature.properties.prefecture_code;
        if (pendingPrefecture === code) {
          currentPrefecture = code;
          currentLevel = 2;
          pendingPrefecture = null;
          renderLevel2();
        } else {
          pendingPrefecture = code;
          renderLevel1();
        }
      });
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
}

// === レベル 2: 都道府県 → 市町村 ===

async function renderLevel2() {
  if (!historyMap || !currentPrefecture) return;
  clearLayers();
  const prefFeature = prefectureGeo.features.find(
    f => f.properties.prefecture_code === currentPrefecture,
  );
  const prefName = prefFeature?.properties.name ?? currentPrefecture;
  setTitle(prefName);

  const prefConquests = conquests.filter(c => c.prefecture_code === currentPrefecture);
  const total = prefTotals[currentPrefecture] ?? 0;
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
  for (const item of fetched) {
    if (!item) continue;
    if (!conqueredSet.has(item.muniCode)) continue;
    const conquest = prefConquests.find(c => c.muni_code === item.muniCode);
    L.geoJSON(item.geo, {
      style: { fillColor: '#5dcaa5', fillOpacity: 0.75, color: '#9fe1cb', weight: 1 },
      onEachFeature: (_f, layer) => {
        layer.on('click', () => {
          currentLevel = 3;
          renderLevel3(conquest);
        });
      },
    }).addTo(historyMap);
  }

  setLoading(false);
}

// === レベル 3: 市町村詳細モーダル ===

function renderLevel3(item) {
  const detail = document.getElementById('history-detail');
  if (!detail) return;
  const date = new Date(item.first_visit);
  const dateStr = isNaN(date) ? '?' : date.toLocaleString('ja-JP');

  const state = loadState();
  const desc = state.visited?.[item.muni_code]?.description ?? '';

  detail.innerHTML = `
    <div class="detail-card">
      <button class="detail-close" aria-label="閉じる">×</button>
      <h3>${escapeHtml(item.prefecture)} ${escapeHtml(item.name)}</h3>
      <p class="detail-date">初回訪問: ${escapeHtml(dateStr)}</p>
      <p class="detail-desc">${escapeHtml(desc || '解説キャッシュなし')}</p>
    </div>
  `;
  detail.style.display = '';
  const close = detail.querySelector('.detail-close');
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
