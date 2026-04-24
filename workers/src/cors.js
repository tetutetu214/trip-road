/**
 * CORS ヘッダをビルドする。
 * allowedOrigin は Workers Secrets の ALLOWED_ORIGIN から渡される。
 *
 * @param {string} allowedOrigin - 許可するオリジン URL
 * @returns {object} ヘッダ辞書
 */
export function corsHeaders(allowedOrigin) {
  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Password',
    'Access-Control-Max-Age': '86400', // 24h プリフライトキャッシュ
  };
}

/**
 * OPTIONS プリフライトを処理する。
 *
 * @param {Request} request - 受信リクエスト
 * @param {string} allowedOrigin - 許可するオリジン
 * @returns {Response|null} プリフライト該当なら 204 Response、そうでなければ null
 */
export function handlePreflight(request, allowedOrigin) {
  if (request.method !== 'OPTIONS') {
    return null;
  }
  return new Response(null, {
    status: 204,
    headers: corsHeaders(allowedOrigin),
  });
}
