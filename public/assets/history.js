/**
 * 踏破履歴ビュー（階層コロプレス）。
 *
 * spec.md §14 で定めた 4 レベル UI を Leaflet 上で実現する。
 * メイン地図とは別の Leaflet インスタンスを持ち、画面を出入りするたびに
 * レイヤーを掃除して初期状態に戻す。
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
let regionTotals = {};        // {region_code: muni_count}
let prefTotals = {};          // {prefecture_code: muni_count}
let regionGeo = null;
let prefectureGeo = null;
let currentLevel = 0;
let currentRegion = null;
let currentPrefecture = null;
let dataLoaded = false;

const HISTORY_SCREEN_ID = 'history-screen';
const HISTORY_MAP_ID = 'history-map';

/**
 * 履歴画面を初期化（DOM がレンダリングされたあと 1 回だけ呼ぶ）。
 */
export function setupHistoryScreen() {
  const back = document.querySelector(`#${HISTORY_SCREEN_ID} .history-back`);
  if (back) back.addEventListener('click', handleBack);
}

/**
 * 履歴画面を表示してデータをロード・描画する。
 */
export async function openHistoryScreen() {
  showHistoryScreen();
  if (!historyMap) initHistoryMap();
  setLoading(true);
  try {
    await loadHistoryData();
    currentLevel = 0;
    currentRegion = null;
    currentPrefecture = null;
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
  });
  L.tileLayer(TILE_URL, { maxZoom: 18 }).addTo(historyMap);
  // 地図サイズの再計算（show 切替時に必要）
  setTimeout(() => historyMap.invalidateSize(), 100);
}

async function loadHistoryData() {
  if (dataLoaded) {
    // 踏破履歴は毎回再取得（visited 同期分を取り込むため）
    await refreshConquests();
    return;
  }
  // 1 度きりの静的データ読込
  const [regions, prefs] = await Promise.all([
    fetch(`${DATA_BASE_URL}/regions.geojson`).then(r => r.json()),
    fetch(`${DATA_BASE_URL}/prefectures.geojson`).then(r => r.json()),
  ]);
  regionGeo = regions;
  prefectureGeo = prefs;
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
    // DynamoDB の結果 + localStorage の未同期の当日分をマージ
    const merged = new Map();
    for (const it of result.items) merged.set(it.muni_code, it);
    for (const local of collectLocalConquests()) {
      if (!merged.has(local.muni_code)) merged.set(local.muni_code, local);
    }
    conquests = Array.from(merged.values());
  } else {
    // タイムアウト・障害時は localStorage のみで表示
    conquests = collectLocalConquests();
    console.warn('[history] /api/conquests failed, falling back to localStorage', result);
  }
}

/**
 * localStorage の visited を踏破履歴アイテム形式に変換する。
 * region_code / prefecture_code が無いエントリは muni_code から導出する。
 */
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

// === 描画 ===

function clearLayers() {
  if (!historyMap) return;
  historyMap.eachLayer((layer) => {
    // タイルレイヤー以外を削除
    if (layer instanceof L.TileLayer) return;
    historyMap.removeLayer(layer);
  });
}

function styleForRate(rate) {
  return {
    fillColor: colorForRate(rate),
    fillOpacity: 0.7,
    color: '#5dcaa5',
    weight: 1,
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

function renderLevel0() {
  if (!historyMap || !regionGeo) return;
  clearLayers();
  setTitle('日本全土');
  const totalMuni = Object.values(regionTotals).reduce((a, b) => a + b, 0);
  setStats(`8 地方 / ${conquests.length} 市町村踏破`, `全 ${totalMuni} 市町村中 ${conquests.length} 踏破`);

  L.geoJSON(regionGeo, {
    style: (feature) => {
      const rate = rateForRegion(feature.properties.region_code, conquests, regionTotals);
      return styleForRate(rate);
    },
    onEachFeature: (feature, layer) => {
      layer.on('click', () => {
        currentRegion = feature.properties.region_code;
        currentLevel = 1;
        renderLevel1();
      });
    },
  }).addTo(historyMap);
  historyMap.setView([36, 138], 5);
}

function renderLevel1() {
  if (!historyMap || !prefectureGeo || !currentRegion) return;
  clearLayers();
  setTitle(REGION_NAMES[currentRegion] ?? currentRegion);

  // この地方の都道府県だけを抽出
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
      const rate = rateForPrefecture(feature.properties.prefecture_code, conquests, prefTotals);
      return styleForRate(rate);
    },
    onEachFeature: (feature, l) => {
      l.on('click', () => {
        currentPrefecture = feature.properties.prefecture_code;
        currentLevel = 2;
        renderLevel2();
      });
    },
  }).addTo(historyMap);
  try {
    const bounds = layer.getBounds();
    if (bounds.isValid()) historyMap.fitBounds(bounds, { padding: [20, 20] });
  } catch (_) { /* noop */ }
}

async function renderLevel2() {
  if (!historyMap || !currentPrefecture) return;
  clearLayers();
  const prefFeature = prefectureGeo.features.find(
    f => f.properties.prefecture_code === currentPrefecture,
  );
  const prefName = prefFeature?.properties.name ?? currentPrefecture;
  setTitle(prefName);

  // この県の踏破済 muni を抽出
  const prefConquests = conquests.filter(c => c.prefecture_code === currentPrefecture);
  const total = prefTotals[currentPrefecture] ?? 0;
  setStats(
    `${prefName} の踏破: ${prefConquests.length} / ${total}`,
    total > 0 ? `${Math.round((prefConquests.length / total) * 100)}%` : '',
  );

  // 都道府県ポリゴンを薄く敷く（境界の見当用）
  if (prefFeature) {
    L.geoJSON(prefFeature, {
      style: { color: '#5dcaa5', weight: 1.5, fillOpacity: 0, dashArray: '4,4' },
    }).addTo(historyMap);
    try {
      const bounds = L.geoJSON(prefFeature).getBounds();
      if (bounds.isValid()) historyMap.fitBounds(bounds, { padding: [10, 10] });
    } catch (_) { /* noop */ }
  }

  // 踏破済市町村だけ個別 GeoJSON を取得して塗る（未踏は塗らない、API 負荷軽減）
  setLoading(true);
  await Promise.all(prefConquests.map(async (c) => {
    try {
      const res = await fetch(`${DATA_BASE_URL}/municipalities/${c.muni_code}.geojson`);
      if (!res.ok) return;
      const geo = await res.json();
      L.geoJSON(geo, {
        style: { ...styleForRate(1), fillOpacity: 0.65 },
        onEachFeature: (_f, layer) => {
          layer.on('click', () => {
            currentLevel = 3;
            renderLevel3(c);
          });
        },
      }).addTo(historyMap);
    } catch (e) {
      console.warn('[history] muni fetch failed', c.muni_code, e);
    }
  }));
  setLoading(false);
}

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
    renderLevel1();
    return;
  }
  if (currentLevel === 1) {
    currentLevel = 0;
    currentRegion = null;
    renderLevel0();
    return;
  }
  // currentLevel 0 → メイン画面に戻る
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
