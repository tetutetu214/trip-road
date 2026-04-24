import { timingSafeEqual } from './auth.js';
import { corsHeaders, handlePreflight } from './cors.js';
import {
  parseDescribeRequest,
  buildMessagesRequest,
  callAnthropic,
} from './anthropic.js';

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

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';

    // 1. CORS プリフライト
    const preflight = handlePreflight(request, allowedOrigin);
    if (preflight) return preflight;

    // 2. /api/describe 以外は 404
    const url = new URL(request.url);
    if (url.pathname !== '/api/describe') {
      return jsonResponse({ error: 'not_found' }, 404, allowedOrigin);
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'method_not_allowed' }, 405, allowedOrigin);
    }

    // 3. 認証（X-App-Password を Secrets と定数時間比較）
    const received = request.headers.get('X-App-Password') || '';
    const expected = env.APP_PASSWORD || '';
    if (!expected) {
      // Secrets 未設定は 500（運用ミス）
      return jsonResponse({ error: 'server_misconfigured' }, 500, allowedOrigin);
    }
    const authed = await timingSafeEqual(received, expected);
    if (!authed) {
      return jsonResponse({ error: 'unauthorized' }, 401, allowedOrigin);
    }

    // 4. リクエストボディ読み込み・バリデーション
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

    // 5. Anthropic 呼出
    const messagesRequest = buildMessagesRequest(parsed.value);
    const result = await callAnthropic(messagesRequest, env.ANTHROPIC_API_KEY);
    if (!result.ok) {
      return jsonResponse(
        { error: 'upstream_error', detail: result.detail },
        result.status >= 500 && result.status < 600 ? 502 : result.status,
        allowedOrigin,
      );
    }

    // 6. 成功
    return jsonResponse({ description: result.description }, 200, allowedOrigin);
  },
};
