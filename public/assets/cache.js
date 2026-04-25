/**
 * 市町村コードと季節からキャッシュキーを生成する。
 * 形式: "{code}_{season}" （例: "14151_spring"）
 *
 * @param {string} code - 市町村コード
 * @param {'spring'|'summer'|'autumn'|'winter'} season
 * @returns {string}
 */
export function makeCacheKey(code, season) {
  return `${code}_${season}`;
}
