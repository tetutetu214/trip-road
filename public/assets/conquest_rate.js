/**
 * 踏破率の計算と色階調マッピング（純粋関数）。
 *
 * spec.md §14.4 の踏破率（踏破市町村数 ÷ 全市町村数）と
 * §13.4 の色階調閾値（0%/1-10%/11-30%/31-60%/61-100%）を実装する。
 */

import { prefectureCodeOf, regionCodeOf } from './region_mapping.js';

/**
 * 地方の踏破率を計算する。
 *
 * @param {string} regionCode - 地方コード（"kanto" など）
 * @param {Iterable<{region_code: string}>} conquests - 踏破済アイテムのリスト
 * @param {Record<string, number>} regionTotals - {region_code: 全市町村数}
 * @returns {number} 0-1 の踏破率（total=0 のときは 0）
 */
export function rateForRegion(regionCode, conquests, regionTotals) {
  const total = regionTotals[regionCode] ?? 0;
  if (total === 0) return 0;
  let count = 0;
  for (const c of conquests) {
    if (c.region_code === regionCode) count++;
  }
  return count / total;
}

/**
 * 都道府県の踏破率を計算する。
 *
 * @param {string} prefCode - 都道府県コード（"14" など）
 * @param {Iterable<{prefecture_code: string}>} conquests
 * @param {Record<string, number>} prefTotals - {prefecture_code: 全市町村数}
 * @returns {number}
 */
export function rateForPrefecture(prefCode, conquests, prefTotals) {
  const total = prefTotals[prefCode] ?? 0;
  if (total === 0) return 0;
  let count = 0;
  for (const c of conquests) {
    if (c.prefecture_code === prefCode) count++;
  }
  return count / total;
}

/**
 * 市町村の踏破率（事実上 0/1 の二値）。
 *
 * @param {string} muniCode
 * @param {Iterable<{muni_code: string}> | Set<string> | Map<string, any>} conquests
 * @returns {number} 0 または 1
 */
export function rateForMunicipality(muniCode, conquests) {
  if (conquests instanceof Set) return conquests.has(muniCode) ? 1 : 0;
  if (conquests instanceof Map) return conquests.has(muniCode) ? 1 : 0;
  for (const c of conquests) {
    if (c.muni_code === muniCode) return 1;
  }
  return 0;
}

/**
 * 踏破率を色階調バケットに変換する。
 *
 * 閾値:
 *   0%       → '#2a2a2a' (灰、未踏)
 *   1-10%    → '#1f3a32' (薄緑)
 *   11-30%   → '#2e6651' (中緑)
 *   31-60%   → '#3f9876' (濃緑)
 *   61-100%  → '#5dcaa5' (最濃、軌跡と同色)
 *
 * @param {number} rate - 0-1 の踏破率
 * @returns {string} 16 進カラーコード
 */
export function colorForRate(rate) {
  if (rate <= 0) return '#2a2a2a';
  if (rate <= 0.10) return '#1f3a32';
  if (rate <= 0.30) return '#2e6651';
  if (rate <= 0.60) return '#3f9876';
  return '#5dcaa5';
}

/**
 * 踏破履歴アイテムに region_code / prefecture_code が欠けていれば埋める。
 * localStorage の既存 visited を DynamoDB 同期可能な形に持ち上げる用途。
 *
 * @param {object} item - { muni_code, ... } を含むアイテム
 * @returns {object} prefecture_code / region_code を補った新オブジェクト
 */
export function enrichWithCodes(item) {
  if (!item || !item.muni_code) return item;
  const out = { ...item };
  if (!out.prefecture_code) {
    out.prefecture_code = prefectureCodeOf(out.muni_code);
  }
  if (!out.region_code) {
    out.region_code = regionCodeOf(out.muni_code);
  }
  return out;
}
