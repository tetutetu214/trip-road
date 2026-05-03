/**
 * Workers API `/api/describe` を呼び出す。3 回まで指数バックオフで再試行。
 */
import { API_BASE_URL } from './config.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 土地のたよりを取得する。
 *
 * Plan E (Phase 6.4) で Workers レスポンスに judge_passed / judge_scores /
 * judge_deductions / regenerated / judge_error が含まれるようになった。
 * ここではそれらをそのまま戻り値に乗せ、判定ロジックは呼び出し側（app.js）が担う。
 *
 * Plan E (Phase 6.5) で onPhaseChange コールバック対応。
 * 経過時間 2 秒 / 5 秒のタイミングで呼び出され、UI 文言の段階表示に使う。
 *
 * @param {string} password - X-App-Password に送る値
 * @param {{prefecture: string, municipality: string, solar_term: string}} req
 *   solar_term は二十四節気の番号文字列（'01'〜'24'）
 * @param {object} [opts]
 * @param {(phase: 'judging'|'regenerating') => void} [opts.onPhaseChange]
 *   2 秒経過で 'judging'、5 秒経過で 'regenerating' を発火。
 *   レスポンス到着で内部タイマーをクリア（クリア後は呼ばない）。
 * @returns {Promise<
 *   | {ok: true, description: string, judge_passed: boolean|null,
 *      judge_scores: object|null, judge_deductions: object|null,
 *      regenerated: boolean, judge_error: string|null}
 *   | {ok: false, status: number, error: string}
 * >}
 */
export async function fetchDescription(password, req, opts = {}) {
  const { onPhaseChange } = opts;
  let lastError = { ok: false, status: 0, error: 'unknown' };

  // 段階表示タイマー：fetch 開始から経過時間で文言を切り替える
  // タイマーは fetch 完了 / エラー / 全リトライ終了で必ずクリア
  const timers = [];
  const startTimers = () => {
    if (typeof onPhaseChange !== 'function') return;
    timers.push(setTimeout(() => onPhaseChange('judging'), 2000));
    timers.push(setTimeout(() => onPhaseChange('regenerating'), 5000));
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers.length = 0;
  };

  startTimers();

  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length + 1; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/describe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Password': password,
        },
        body: JSON.stringify(req),
      });

      if (res.status === 401) {
        clearTimers();
        return { ok: false, status: 401, error: 'unauthorized' };
      }
      if (res.status === 400) {
        clearTimers();
        const data = await res.json().catch(() => ({}));
        return { ok: false, status: 400, error: data.detail ?? 'bad_request' };
      }
      if (res.ok) {
        const data = await res.json();
        if (data?.description) {
          clearTimers();
          return {
            ok: true,
            description: data.description,
            judge_passed: data.judge_passed ?? null,
            judge_scores: data.judge_scores ?? null,
            judge_deductions: data.judge_deductions ?? null,
            regenerated: data.regenerated ?? false,
            judge_error: data.judge_error ?? null,
          };
        }
        lastError = { ok: false, status: res.status, error: 'empty_description' };
      } else {
        lastError = { ok: false, status: res.status, error: 'upstream_error' };
      }
    } catch (e) {
      lastError = { ok: false, status: 0, error: String(e) };
    }

    // 最後の試行でなければ待機して再試行
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  clearTimers();
  return lastError;
}

/**
 * テレメトリバッチを Workers `/api/telemetry` に送る。
 * 失敗時は 1 回だけリトライ（2 秒後）、それ以上は呼出側で諦める（次回 flush で再送）。
 *
 * @param {string} password - X-App-Password に送る値
 * @param {Array<object>} entries - 送信する entry 配列（非空）
 * @returns {Promise<{ok: true, key: string} | {ok: false, status: number, error: string}>}
 */
export async function sendTelemetryBatch(password, entries) {
  let lastError = { ok: false, status: 0, error: 'unknown' };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/telemetry`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-App-Password': password,
        },
        body: JSON.stringify({ entries }),
      });
      if (res.ok) {
        const data = await res.json();
        return { ok: true, key: data.key };
      }
      if (res.status === 401) {
        return { ok: false, status: 401, error: 'unauthorized' };
      }
      lastError = { ok: false, status: res.status, error: 'upstream_error' };
    } catch (e) {
      lastError = { ok: false, status: 0, error: String(e) };
    }
    if (attempt === 0) await sleep(2000);
  }
  return lastError;
}
