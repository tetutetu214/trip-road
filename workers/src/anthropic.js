/**
 * Anthropic Messages API v1 を使った「土地のたより」生成。
 *
 * このモジュールは純粋関数 3 つ:
 *   - solarTermToJa: 二十四節気の番号文字列 → 日本語名
 *   - parseDescribeRequest: 受信 JSON body のバリデーション
 *   - buildMessagesRequest: Anthropic API 向けリクエスト JSON 組立
 * と、副作用ありの 1 関数:
 *   - callAnthropic: Anthropic API に実際に fetch
 * で構成される。
 */

// 二十四節気の番号文字列 ('01'〜'24') → 日本語名
const SOLAR_TERM_MAP = {
  '01': '立春', '02': '雨水', '03': '啓蟄', '04': '春分',
  '05': '清明', '06': '穀雨', '07': '立夏', '08': '小満',
  '09': '芒種', '10': '夏至', '11': '小暑', '12': '大暑',
  '13': '立秋', '14': '処暑', '15': '白露', '16': '秋分',
  '17': '寒露', '18': '霜降', '19': '立冬', '20': '小雪',
  '21': '大雪', '22': '冬至', '23': '小寒', '24': '大寒',
};

const SYSTEM_PROMPT = `あなたは日本の旅行ガイドです。指定された都道府県・市区町村・二十四節気から、旅人が通過する際に楽しめる3〜4文の観光ガイド文を書いてください。

以下のルールを守ってください：
- 文体は「です・ます調」の現代的な観光ガイド
- 120〜180字の範囲に収める
- 二十四節気の季節感（その節気特有の旬・景色・花・気候）には必ず触れる
- 以下の要素は、その土地で確信を持って書ける範囲だけ含める（無理に全部書こうとしない、書けるものだけでよい）：
  - 具体的な地名（山・川・峠・湖・旧街道・神社仏閣・港・台地など固有名詞）
  - 歴史的背景（城下町・宿場町・港町・産業の起こりなど）
  - 地形的特徴（盆地・河岸段丘・扇状地・リアス海岸・台地・カルデラなど）
  - 名物・特産品
- 確信が持てない情報は無理に書かない（情報量が減っても正確さを優先）
- 祭りやイベントの具体的な日付・回数・年号は書かない（代わりに「例年◯月頃」と表現する）
- プレーンテキストのみ、マークダウン記法や箇条書きは使わない
- 旅情を損なう過度な商業表現（「おすすめ！」など）は避ける`;

/**
 * 二十四節気の番号文字列（'01'〜'24'）を日本語名に変換。
 * 未知の値は undefined を返す。
 */
export function solarTermToJa(solarTerm) {
  return SOLAR_TERM_MAP[solarTerm];
}

/**
 * POST /api/describe の body をバリデーション。
 *
 * @param {any} body - JSON.parse 済みの値
 * @returns {{ok: true, value: {prefecture, municipality, solar_term}} | {ok: false, error: string}}
 */
export function parseDescribeRequest(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const { prefecture, municipality, solar_term } = body;
  if (typeof prefecture !== 'string' || prefecture.length === 0) {
    return { ok: false, error: 'missing required field: prefecture' };
  }
  if (typeof municipality !== 'string' || municipality.length === 0) {
    return { ok: false, error: 'missing required field: municipality' };
  }
  if (typeof solar_term !== 'string' || !SOLAR_TERM_MAP[solar_term]) {
    return { ok: false, error: 'invalid solar_term (must be "01"〜"24")' };
  }
  return { ok: true, value: { prefecture, municipality, solar_term } };
}

/**
 * Anthropic Messages API にそのまま POST できる JSON を組み立てる。
 *
 * @param {{prefecture: string, municipality: string, solar_term: string}} req
 * @returns {object} Messages API request body
 */
export function buildMessagesRequest(req) {
  const solarTermJa = solarTermToJa(req.solar_term);
  return {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `都道府県: ${req.prefecture}\n市区町村: ${req.municipality}\n二十四節気: ${solarTermJa}（${req.solar_term}）`,
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
