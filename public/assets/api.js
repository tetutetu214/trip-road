/**
 * Workers API `/api/describe` を呼び出す。3 回まで指数バックオフで再試行。
 */
import { API_BASE_URL } from './config.js';

const RETRY_DELAYS_MS = [1000, 2000, 4000];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * 土地のたよりを取得する。
 *
 * @param {string} password - X-App-Password に送る値
 * @param {{prefecture: string, municipality: string, season: string}} req
 * @returns {Promise<{ok: true, description: string} | {ok: false, status: number, error: string}>}
 */
export async function fetchDescription(password, req) {
  let lastError = { ok: false, status: 0, error: 'unknown' };

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
        return { ok: false, status: 401, error: 'unauthorized' };
      }
      if (res.status === 400) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, status: 400, error: data.detail ?? 'bad_request' };
      }
      if (res.ok) {
        const data = await res.json();
        if (data?.description) return { ok: true, description: data.description };
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

  return lastError;
}
