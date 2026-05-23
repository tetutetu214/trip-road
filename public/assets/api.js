/**
 * Workers API `/api/describe` を呼び出す（Plan I）。3 回まで指数バックオフで再試行。
 *
 * Plan I（2026-05-11）でレスポンススキーマ刷新:
 *   - judge_scores / judge_deductions → faithfulness_score / out_of_kb_terms
 *   - no_wikipedia / fallback_to_extract / wikipedia_extract_length を追加
 *   - solar_term はリクエストから廃止
 */
import { API_BASE_URL } from './config.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 土地のたよりを取得する。
 *
 * @param {string} password - X-App-Password に送る値
 * @param {{prefecture: string, municipality: string, muniCode?: string}} req
 *   muniCode は 5 桁全国地方公共団体コード（Wikidata 統合用、Issue #38 から）
 * @param {object} [opts]
 * @param {(phase: 'judging'|'regenerating') => void} [opts.onPhaseChange]
 *   2 秒経過で 'judging'、5 秒経過で 'regenerating' を発火。
 * @returns {Promise<
 *   | {ok: true, description: string, no_wikipedia: boolean,
 *      judge_passed: boolean|null, faithfulness_score: number|null,
 *      out_of_kb_terms: string[], regenerated: boolean, fallback_to_extract: boolean,
 *      wikipedia_extract_length: number|null, judge_error: string|null,
 *      generator_model: string|null, judge_model: string|null}
 *   | {ok: false, status: number, error: string}
 * >}
 */
export async function fetchDescription(password, req, opts = {}) {
  const { onPhaseChange } = opts;
  let lastError = { ok: false, status: 0, error: 'unknown' };

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
        // Plan I: no_wikipedia=true のときは description が空文字でも成功扱い
        if (data?.no_wikipedia || data?.description) {
          clearTimers();
          return {
            ok: true,
            description: data.description ?? '',
            no_wikipedia: data.no_wikipedia ?? false,
            judge_passed: data.judge_passed ?? null,
            faithfulness_score: data.faithfulness_score ?? null,
            out_of_kb_terms: Array.isArray(data.out_of_kb_terms) ? data.out_of_kb_terms : [],
            regenerated: data.regenerated ?? false,
            fallback_to_extract: data.fallback_to_extract ?? false,
            wikipedia_extract_length: data.wikipedia_extract_length ?? null,
            judge_error: data.judge_error ?? null,
            generator_model: data.generator_model ?? null,
            judge_model: data.judge_model ?? null,
          };
        }
        lastError = { ok: false, status: res.status, error: 'empty_description' };
      } else {
        lastError = { ok: false, status: res.status, error: 'upstream_error' };
      }
    } catch (e) {
      lastError = { ok: false, status: 0, error: String(e) };
    }

    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  clearTimers();
  return lastError;
}

/**
 * テレメトリバッチを Workers `/api/telemetry` に送る。
 * 失敗時は 1 回だけリトライ（2 秒後）。
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
