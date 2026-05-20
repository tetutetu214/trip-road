/**
 * 現在地の標高取得と、debounce 付き更新ヘルパ。
 * - GPS の coords.altitude が取れていればそれを使う（無料・即時）
 * - 取れていなければ国土地理院 標高API をフロント直叩き
 *   https://maps.gsi.go.jp/development/elevation_s.html
 * - API 呼出は「5秒 or 100m 移動」の debounce で抑える（地理院の負荷遠慮要請）
 */
import { ELEVATION_API_URL } from './config.js';

/**
 * 緯度経度から標高(m)を取得。海上や取得失敗時は null。
 * @param {number} lat
 * @param {number} lon
 * @param {{fetchFn?: typeof fetch}} [opts]
 * @returns {Promise<number|null>}
 */
export async function fetchElevation(lat, lon, opts = {}) {
  const fetchFn = opts.fetchFn ?? fetch;
  const url = `${ELEVATION_API_URL}?lon=${lon}&lat=${lat}&outtype=JSON`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return null;
    const data = await res.json();
    // 海上などで elevation === "-----" を返す仕様
    const e = data?.elevation;
    if (typeof e === 'number' && Number.isFinite(e)) return e;
    return null;
  } catch (_) {
    return null;
  }
}

/**
 * 2点間の距離(m)。Haversine 公式。
 */
export function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * debounce 付きの標高更新関数を生成。
 * - coords.altitude が有限値なら即時 onUpdate(Math.round(altitude))
 * - 取れていなければ「前回呼出から minIntervalMs 経過」or「前回位置から minDistanceM 移動」
 *   のときだけ fetcher を呼ぶ
 * @param {(lat: number, lon: number) => Promise<number|null>} fetcher
 * @param {(m: number|null) => void} onUpdate
 * @param {{minIntervalMs?: number, minDistanceM?: number, nowFn?: () => number}} [opts]
 */
export function createElevationUpdater(fetcher, onUpdate, opts = {}) {
  const minIntervalMs = opts.minIntervalMs ?? 5000;
  const minDistanceM = opts.minDistanceM ?? 100;
  const nowFn = opts.nowFn ?? (() => Date.now());
  let lastAt = 0;
  let lastLat = null;
  let lastLon = null;
  return async function update(lat, lon, coordsAltitude) {
    if (typeof coordsAltitude === 'number' && Number.isFinite(coordsAltitude)) {
      onUpdate(Math.round(coordsAltitude));
      return;
    }
    const now = nowFn();
    if (lastLat !== null && lastLon !== null) {
      const dist = haversineMeters(lat, lon, lastLat, lastLon);
      if (now - lastAt < minIntervalMs && dist < minDistanceM) return;
    }
    lastAt = now;
    lastLat = lat;
    lastLon = lon;
    const e = await fetcher(lat, lon);
    onUpdate(e === null ? null : Math.round(e));
  };
}
