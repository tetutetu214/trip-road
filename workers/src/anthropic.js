/**
 * Anthropic Messages API v1 を使った「土地のたより」生成。
 *
 * このモジュールは純粋関数 3 つ:
 *   - seasonToJa: 英語季節 → 日本語季節
 *   - parseDescribeRequest: 受信 JSON body のバリデーション
 *   - buildMessagesRequest: Anthropic API 向けリクエスト JSON 組立
 * と、副作用ありの 1 関数:
 *   - callAnthropic: Anthropic API に実際に fetch
 * で構成される。
 */

const SEASON_MAP = {
  spring: '春',
  summer: '夏',
  autumn: '秋',
  winter: '冬',
};

const SYSTEM_PROMPT = `あなたは日本の旅行ガイドです。指定された都道府県・市区町村・季節から、旅人が通過する際に楽しめる3〜4文の観光ガイド文を書いてください。

以下のルールを守ってください：
- 文体は「です・ます調」の現代的な観光ガイド
- 120〜180字の範囲に収める
- 歴史・地形・名物・特産品は具体的に書いてよい
- 祭りやイベントの具体的な日付・回数・年号は書かない（代わりに「例年◯月頃」と表現する）
- その土地の「春/夏/秋/冬」の季節感（旬の食材・景色・花・魚など）に必ず触れる
- プレーンテキストのみ、マークダウン記法や箇条書きは使わない
- 確信が持てない情報は無理に書かない（情報量が減っても正確さを優先）
- 旅情を損なう過度な商業表現（「おすすめ！」など）は避ける`;

/**
 * 英語の季節キー（spring/summer/autumn/winter）を日本語に変換。
 * 未知の値は undefined を返す。
 */
export function seasonToJa(season) {
  return SEASON_MAP[season];
}

/**
 * POST /api/describe の body をバリデーション。
 *
 * @param {any} body - JSON.parse 済みの値
 * @returns {{ok: true, value: {prefecture, municipality, season}} | {ok: false, error: string}}
 */
export function parseDescribeRequest(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const { prefecture, municipality, season } = body;
  if (typeof prefecture !== 'string' || prefecture.length === 0) {
    return { ok: false, error: 'missing required field: prefecture' };
  }
  if (typeof municipality !== 'string' || municipality.length === 0) {
    return { ok: false, error: 'missing required field: municipality' };
  }
  if (typeof season !== 'string' || !SEASON_MAP[season]) {
    return { ok: false, error: 'invalid season (must be spring/summer/autumn/winter)' };
  }
  return { ok: true, value: { prefecture, municipality, season } };
}

/**
 * Anthropic Messages API にそのまま POST できる JSON を組み立てる。
 *
 * @param {{prefecture: string, municipality: string, season: string}} req
 * @returns {object} Messages API request body
 */
export function buildMessagesRequest(req) {
  const seasonJa = seasonToJa(req.season);
  return {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `都道府県: ${req.prefecture}\n市区町村: ${req.municipality}\n季節: ${seasonJa}`,
      },
    ],
  };
}

/**
 * Anthropic Messages API を実際に叩く（副作用あり）。
 *
 * @param {object} messagesRequest - buildMessagesRequest の出力
 * @param {string} apiKey - Anthropic API キー
 * @returns {Promise<{ok: true, description: string} | {ok: false, status: number, detail: string}>}
 */
export async function callAnthropic(messagesRequest, apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(messagesRequest),
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, detail: `Anthropic API error: ${text}` };
  }

  const data = await res.json();
  // Messages API の応答: { content: [{type: "text", text: "..."}] }
  const description = data?.content?.[0]?.text ?? '';
  if (!description) {
    return { ok: false, status: 502, detail: 'empty response from Anthropic' };
  }
  return { ok: true, description };
}
