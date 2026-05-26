/**
 * Leaflet 初期化、現在地マーカー、軌跡ポリラインの管理。
 * Leaflet は index.html で CDN 読込の global `L` を使う。
 */
import { TILE_URL, HILLSHADE_TILE_URL } from './config.js';

let map = null;
let marker = null;
let trackLine = null;
let hillshadeLayer = null;

export function initMap(containerId) {
  map = L.map(containerId, {
    center: [35.5, 138],
    zoom: 5,
    zoomControl: false,
    attributionControl: false,
  });
  L.tileLayer(TILE_URL, { maxZoom: 18, tileSize: 256 }).addTo(map);

  // 陰影起伏図レイヤー。初期は add しない。setHillshadeEnabled で切替。
  hillshadeLayer = L.tileLayer(HILLSHADE_TILE_URL, {
    maxZoom: 18,
    maxNativeZoom: 16,
    opacity: 0.3,
  });

  // 現在地マーカー（SVG divIcon）
  const iconHtml = `<svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
    <circle cx="9" cy="9" r="7" stroke="#9fe1cb" stroke-width="1.2" fill="none"/>
    <circle cx="9" cy="9" r="2.5" fill="#9fe1cb"/>
  </svg>`;
  const icon = L.divIcon({ html: iconHtml, className: 'current-location-marker', iconSize: [18, 18], iconAnchor: [9, 9] });
  marker = L.marker([35.5, 138], { icon });
  // 初期位置では add しない（GPS 取得後に add）

  // 地理院 pale 地図の「緑色の高速道路」「灰色の地形/等高線」と
  // 軌跡が被って見にくい問題への対応で、補色のマゼンタに変更（2026-05-26）。
  // UI ブランド色のミントグリーン (#5dcaa5) は履歴画面・現在地マーカー側に残す。
  trackLine = L.polyline([], {
    color: '#ff4d8c',
    weight: 3,
    opacity: 0.9,
    lineCap: 'round',
    lineJoin: 'round',
  }).addTo(map);

  // 最小化→復帰や画面回転・リサイズ時に地図サイズを再計算する。
  // iOS Safari でバックグラウンド復帰時に viewport が一時的にずれて、
  // .map のレイアウトが崩れて上部チップが地図に隠れる現象への対策。
  const refreshSize = () => {
    if (!map) return;
    // CSS の再計算が完了してから invalidateSize を呼ぶため少し遅延
    setTimeout(() => map.invalidateSize(), 100);
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshSize();
  });
  window.addEventListener('pageshow', refreshSize);
  window.addEventListener('resize', () => {
    if (map) map.invalidateSize();
  });
  window.addEventListener('orientationchange', refreshSize);

  // 下部カードの実高を CSS 変数 --card-height に反映する。
  // 「土地のたより」本文の長さでカードが可変なので、固定 320px だと長文時に
  // 地図領域とカード不透明部が重なって地図ラベルが隠れる事象を防ぐ。
  const card = document.querySelector('.bottom-card');
  if (card && typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(() => {
      const h = card.offsetHeight;
      document.documentElement.style.setProperty('--card-height', `${h}px`);
      if (map) map.invalidateSize();
    });
    ro.observe(card);
  }

  return map;
}

/**
 * 現在地を更新（追従 ON 固定）。
 */
export function updateCurrentLocation(lat, lon, isFirst = false) {
  if (!map || !marker) return;
  marker.setLatLng([lat, lon]);
  if (!marker._map) marker.addTo(map);
  const zoom = isFirst ? 14 : map.getZoom();
  map.setView([lat, lon], zoom, { animate: true, duration: 0.3 });
}

export function addTrackPoint(lat, lon) {
  if (!trackLine) return;
  trackLine.addLatLng([lat, lon]);
}

export function setTrack(points) {
  if (!trackLine) return;
  trackLine.setLatLngs(points.map(p => [p.lat, p.lon]));
}

/**
 * 地図上の軌跡ポリラインを空にする。
 * localStorage 側の track は変更しない（履歴データは温存）。
 */
export function clearTrack() {
  if (!trackLine) return;
  trackLine.setLatLngs([]);
}

/**
 * 陰影起伏図レイヤーのレベル切替（Issue #48: off / weak / strong）。
 * off ならレイヤーを map から外し、weak/strong なら opacity を切替えて add。
 */
const HILLSHADE_OPACITY = { off: 0, weak: 0.4, strong: 0.7 };
export function setHillshadeLevel(level) {
  if (!map || !hillshadeLayer) return;
  const op = HILLSHADE_OPACITY[level] ?? 0;
  if (op === 0) {
    if (map.hasLayer(hillshadeLayer)) map.removeLayer(hillshadeLayer);
    return;
  }
  hillshadeLayer.setOpacity(op);
  if (!map.hasLayer(hillshadeLayer)) hillshadeLayer.addTo(map);
}
