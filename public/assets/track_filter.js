/**
 * 軌跡ポイント列を「今日の分」だけに絞る純粋関数群。
 *
 * 「今日」はローカルタイムでの暦日（年/月/日が一致するか）で判定する。
 * UTC ではなく端末ローカルにするのは、日本国内のユーザーが
 * 「日付が変わったら新しい軌跡」と感覚的に揃えるため。
 */

/**
 * 2 つの UNIX ms タイムスタンプが同一ローカル暦日に属するかを判定する。
 *
 * @param {number} tsA
 * @param {number} tsB
 * @returns {boolean}
 */
export function isSameLocalDay(tsA, tsB) {
  const a = new Date(tsA);
  const b = new Date(tsB);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 軌跡ポイント列のうち、ローカル暦日が `nowMs` と同じものだけを返す。
 * ts を持たない古いエントリは「日付不明＝今日ではない」として除外する。
 *
 * @param {Array<{lat:number, lon:number, ts?:number}>} points
 * @param {number} nowMs
 * @returns {Array<{lat:number, lon:number, ts:number}>}
 */
export function filterTodayPoints(points, nowMs) {
  if (!Array.isArray(points)) return [];
  return points.filter((p) => typeof p?.ts === 'number' && isSameLocalDay(p.ts, nowMs));
}
