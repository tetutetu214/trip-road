/**
 * 市町村コードと二十四節気からキャッシュキーを生成する。
 * 形式: "{code}_{solarTerm}" （例: "14151_07" は相模原市緑区・立夏）
 *
 * @param {string} code - 市町村コード
 * @param {string} solarTerm - 二十四節気の番号文字列（'01'〜'24'）
 * @returns {string}
 */
export function makeCacheKey(code, solarTerm) {
  return `${code}_${solarTerm}`;
}
