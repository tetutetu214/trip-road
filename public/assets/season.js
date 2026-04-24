/**
 * 日付から日本の季節（spring/summer/autumn/winter）を返す。
 * 3-5月=春、6-8月=夏、9-11月=秋、12-2月=冬。
 *
 * @param {Date} [date=new Date()] - 判定する日付
 * @returns {'spring'|'summer'|'autumn'|'winter'}
 */
export function getSeason(date = new Date()) {
  const m = date.getMonth() + 1;
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}
