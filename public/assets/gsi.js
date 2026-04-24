/**
 * 国土地理院 逆ジオコーダへの呼出。緯度経度→市町村コード。
 */
import { GSI_REVERSE_GEOCODER } from './config.js';

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {Promise<string|null>} 市町村コード、取得失敗なら null
 */
export async function reverseGeocode(lat, lon) {
  try {
    const url = `${GSI_REVERSE_GEOCODER}?lat=${lat}&lon=${lon}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.muniCd ?? null;
  } catch (e) {
    return null;
  }
}
