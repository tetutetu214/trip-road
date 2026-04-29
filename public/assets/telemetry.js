/**
 * テレメトリ entry の生成・trace_id 発行・サンプリング判定。
 * 純粋関数のみ。副作用（localStorage 書込）は storage.js が担当。
 */

/**
 * UUID v4 を生成する。crypto.randomUUID() が使える環境（モダンブラウザ・Node 19+）
 * を前提とする。fallback は Math.random ベースで衝突確率を妥協（PoC 用途）。
 *
 * @returns {string}
 */
export function generateTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 古い環境用の fallback
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * テレメトリ entry を組み立てる（生成直後）。
 * その後 storage.js に appendTelemetry で追加し、表示・離脱時に updateTelemetry で更新。
 *
 * @param {{trace_id: string, muni_code: string, solar_term: string, description: string, ts_generated: number}} args
 *   solar_term は二十四節気の番号文字列（'01'〜'24'）
 * @returns {object}
 */
export function buildTelemetryEntry(args) {
  return {
    trace_id: args.trace_id,
    muni_code: args.muni_code,
    solar_term: args.solar_term,
    description: args.description,
    ts_generated: args.ts_generated,

    // Critic スコア（生成と同期で評価する場合、Stage 2 以降）
    critic_accuracy: null,
    critic_meaningfulness: null,
    critic_density: null,

    // 暗黙シグナル
    ts_displayed: null,
    ts_left: null,
    dwell_ms: null,
    re_visited_count: 0,

    // 明示シグナル（任意）
    user_rating: null,    // null | 'up' | 'down'
    user_comment: null,
  };
}

/**
 * サンプリング判定。Math.random で確率的に true/false。
 *
 * @param {number} sampleRate - 0.0 〜 1.0
 * @returns {boolean}
 */
export function shouldSample(sampleRate) {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0.0) return false;
  return Math.random() < sampleRate;
}
