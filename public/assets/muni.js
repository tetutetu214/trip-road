/**
 * 市町村ポリゴンの読込・P-in-P 判定・adjacency プリフェッチ。
 * Turf.js（global `turf`）と config.js の DATA_BASE_URL を使用する。
 */
import { DATA_BASE_URL } from './config.js';
import { reverseGeocode } from './gsi.js';

/** @type {Map<string, object>} */
const loadedPolygons = new Map();

/** @type {object|null} */
let adjacencyMap = null;

/**
 * adjacency.json を 1 回だけロード（キャッシュ）。
 */
async function loadAdjacency() {
  if (adjacencyMap) return adjacencyMap;
  try {
    const res = await fetch(`${DATA_BASE_URL}/adjacency.json`);
    adjacencyMap = await res.json();
  } catch (e) {
    adjacencyMap = {};
  }
  return adjacencyMap;
}

/**
 * 指定コードの GeoJSON を fetch してキャッシュに登録。
 */
async function loadMunicipality(code) {
  if (loadedPolygons.has(code)) return loadedPolygons.get(code);
  try {
    const res = await fetch(`${DATA_BASE_URL}/municipalities/${code}.geojson`);
    if (!res.ok) return null;
    const geojson = await res.json();
    const feature = geojson?.features?.[0];
    if (feature) {
      loadedPolygons.set(code, feature);
      return feature;
    }
  } catch (e) {}
  return null;
}

/**
 * 判定: 現在→隣接→GSI の順に市町村コードを確定させる。
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string|null} currentCode - 直近の市町村コード
 * @returns {Promise<{code: string, name: string, prefecture: string}|null>}
 */
export async function identifyMunicipality(lat, lon, currentCode) {
  const pt = turf.point([lon, lat]);

  // Step 1: 現在の市町村
  if (currentCode) {
    const f = await loadMunicipality(currentCode);
    if (f && turf.booleanPointInPolygon(pt, f)) {
      return extractProps(f);
    }
  }

  // Step 2: 隣接
  const adjacency = await loadAdjacency();
  const neighbors = currentCode ? (adjacency[currentCode] ?? []) : [];
  for (const code of neighbors) {
    const f = await loadMunicipality(code);
    if (f && turf.booleanPointInPolygon(pt, f)) {
      return extractProps(f);
    }
  }

  // Step 3: GSI フォールバック
  const gsiCode = await reverseGeocode(lat, lon);
  if (gsiCode) {
    const f = await loadMunicipality(gsiCode);
    if (f) return extractProps(f);
  }

  return null;
}

function extractProps(feature) {
  const p = feature.properties;
  return {
    code: p.N03_007,
    name: p.N03_004,
    prefecture: p.N03_001,
  };
}

/**
 * 市町村切替後、隣接市町村の GeoJSON を背景 fetch（fire-and-forget）。
 *
 * @param {string} code
 */
export async function prefetchNeighbors(code) {
  const adjacency = await loadAdjacency();
  const neighbors = adjacency[code] ?? [];
  for (const n of neighbors) {
    if (!loadedPolygons.has(n)) {
      loadMunicipality(n); // await しない（背景）
    }
  }
}
