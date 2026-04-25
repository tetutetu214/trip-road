import { timingSafeEqual } from './auth.js';
import { corsHeaders, handlePreflight } from './cors.js';
import {
  parseDescribeRequest,
  buildMessagesRequest,
  callAnthropic,
} from './anthropic.js';
import { putToS3, generateS3Key } from './aws.js';

/**
 * レスポンスを JSON 形式で組み立てる（CORS ヘッダ付き）。
 */
function jsonResponse(body, status, allowedOrigin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(allowedOrigin),
    },
  });
}

/**
 * X-App-Password を Workers Secret と定数時間比較。
 * 通れば true、通らなければエラーレスポンス（呼び出し側で return すれば良い形）。
 */
async function authenticate(request, env, allowedOrigin) {
  const received = request.headers.get('X-App-Password') || '';
  const expected = env.APP_PASSWORD || '';
  if (!expected) {
    return { ok: false, response: jsonResponse({ error: 'server_misconfigured' }, 500, allowedOrigin) };
  }
  const authed = await timingSafeEqual(received, expected);
  if (!authed) {
    return { ok: false, response: jsonResponse({ error: 'unauthorized' }, 401, allowedOrigin) };
  }
  return { ok: true };
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';

    // 1. CORS プリフライト
    const preflight = handlePreflight(request, allowedOrigin);
    if (preflight) return preflight;

    const url = new URL(request.url);

    // 2. /api/telemetry: テレメトリを S3 に永続化
    if (url.pathname === '/api/telemetry') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed' }, 405, allowedOrigin);
      }
      const auth = await authenticate(request, env, allowedOrigin);
      if (!auth.ok) return auth.response;

      let entries;
      try {
        const body = await request.json();
        entries = body.entries;
        if (!Array.isArray(entries) || entries.length === 0) {
          return jsonResponse({ error: 'bad_request', detail: 'entries must be non-empty array' }, 400, allowedOrigin);
        }
      } catch (e) {
        return jsonResponse({ error: 'bad_request', detail: 'invalid JSON' }, 400, allowedOrigin);
      }

      const key = generateS3Key();
      const result = await putToS3(env, key, JSON.stringify(entries));
      if (!result.ok) {
        return jsonResponse({ error: 'upstream_error', detail: result.detail }, 502, allowedOrigin);
      }
      return jsonResponse({ ok: true, key, count: entries.length }, 200, allowedOrigin);
    }

    // 3. /api/describe: Anthropic で土地のたよりを生成
    if (url.pathname === '/api/describe') {
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'method_not_allowed' }, 405, allowedOrigin);
      }
      const auth = await authenticate(request, env, allowedOrigin);
      if (!auth.ok) return auth.response;

      let body;
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ error: 'bad_request', detail: 'invalid JSON' }, 400, allowedOrigin);
      }
      const parsed = parseDescribeRequest(body);
      if (!parsed.ok) {
        return jsonResponse({ error: 'bad_request', detail: parsed.error }, 400, allowedOrigin);
      }

      const messagesRequest = buildMessagesRequest(parsed.value);
      const result = await callAnthropic(messagesRequest, env.ANTHROPIC_API_KEY);
      if (!result.ok) {
        return jsonResponse(
          { error: 'upstream_error', detail: result.detail },
          result.status >= 500 && result.status < 600 ? 502 : result.status,
          allowedOrigin,
        );
      }
      return jsonResponse({ description: result.description }, 200, allowedOrigin);
    }

    // 4. それ以外は 404
    return jsonResponse({ error: 'not_found' }, 404, allowedOrigin);
  },
};
