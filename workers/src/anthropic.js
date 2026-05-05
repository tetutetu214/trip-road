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
 *
 * F-1.3b で SOLAR_TERM_META を共通モジュール solar_term_meta.js に切り出し、
 * Generator と Judge が同じ節気メタを参照するようにした（DRY）。
 */

import { SOLAR_TERM_META } from './solar_term_meta.js';

const SYSTEM_PROMPT = `あなたは日本の土地情報の解説者です。指定された都道府県・市区町村・二十四節気から、カーナビの土地情報のように淡々とした、3〜4文の解説を書いてください。

# 文体（最重要）
- 「です・ます調」で、淡々と事実を並べる文体
- 季節の挨拶や情緒的・抒情的な表現は使わない
- 禁止する表現の例：「〜を迎えた」「〜に包まれて」「清々しい」「心地よい」「息吹を堪能」「〜のたたずまい」「旅情」「身を委ねる」「魅力」「楽しめる」「おすすめ」「いざ」など
- 期待する文体の例：「〇〇市は××に位置します」「△△のころに□□が旬を迎えます」「江戸期には◇◇として栄えました」のような事実陳述

# 出力形式（厳守）
- プレーンテキストのみ。マークダウン（# 見出し、**強調**、- 箇条書き、空行 など）を一切使わない
- 冒頭にタイトル・見出し・市町村名のラベルを置かない、いきなり本文から始める
- 字数は120〜180字を厳守する。180字を超えそうなら要素を削って収める

# 内容のルール
- 二十四節気の季節感（その節気の旬の食材・農作物・景色）に一言だけ触れる
- 以下の要素は、その土地で確信を持って書ける範囲だけ含める。書けるものだけでよく、無理に全部書こうとしない：
  - 具体的な地名（山・川・峠・湖・旧街道・神社仏閣・港・台地など固有名詞）
  - 歴史的背景（城下町・宿場町・港町・産業の起こりなど）
  - 地形的特徴（盆地・河岸段丘・扇状地・リアス海岸・台地・カルデラなど）
  - 名物・特産品
- 市町村名・都道府県名以外の固有名詞（具体的な地名・施設名・歴史的人物名）は、確信があるものだけ書く。曖昧な記憶で捻り出さない。情報量より正確さを優先する
- 祭りやイベントの具体的な日付・回数・年号は書かない（代わりに「例年◯月頃」と表現する）

# Wikipedia 抜粋の使い方
ユーザメッセージに「[Wikipedia 抜粋]」セクションがある場合、その内容を事実確認のための参考資料として扱ってください。
- 抜粋の文章をそのまま引用したり、文の構造を真似たりしないでください
- 抜粋に書かれた地名・施設・歴史事実を素材として、観光ガイド口調の「土地のたより」を自分の言葉で書いてください
- 抜粋に書かれていない地名・河川名・歴史的事実は、確信があるものだけ書く。曖昧なら省略してください
- 抜粋セクションがない場合、その市町村の Wikipedia 記事が見つからなかったことを意味します。固有名詞を捻り出さず、確信がある事実だけで書いてください

# 参考例
入力:
都道府県: 北海道
市区町村: 函館市
二十四節気: 処暑（14、8月23日頃〜白露前）

[Wikipedia 抜粋]
函館市は、北海道渡島地方南部に位置する中核市である。1859年に開港した国際貿易港・函館港を有し、明治期には外国人居留地が形成された。函館山からの夜景は世界三大夜景の一つとされる。

良い出力例（137字、文体は自分の言葉、抜粋の事実を素材化）:
函館市は北海道渡島地方の南部に位置します。函館山の麓に広がる港町で、1859年に国際貿易港として開港し、明治期には外国人居留地が形成されました。処暑のころ、北海道では夏の暑さが和らぎ、いか漁の最盛期を迎えます。函館港の朝市にも秋の気配が見え始める時期です。`;

/**
 * 二十四節気の番号文字列（'01'〜'24'）を日本語名に変換。
 * 未知の値は undefined を返す。
 */
export function solarTermToJa(solarTerm) {
  return SOLAR_TERM_META[solarTerm]?.name;
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
  if (typeof solar_term !== 'string' || !SOLAR_TERM_META[solar_term]) {
    return { ok: false, error: 'invalid solar_term (must be "01"〜"24")' };
  }
  return { ok: true, value: { prefecture, municipality, solar_term } };
}

/**
 * Anthropic Messages API にそのまま POST できる JSON を組み立てる。
 *
 * F-1.3b で `wikipediaExtract` 引数を追加。Generator 側に Wikipedia 抜粋を
 * 直接渡すことで、Haiku が「知らない事実」をハルシネートする問題を抑制する
 * （生成側 RAG）。null/空文字のときは抜粋セクションを丸ごと省略し、薄い
 * 市町村で固有名詞を捻り出させない。
 * 節気の期間（period）も SOLAR_TERM_META から user メッセージに含めるよう
 * 拡張。Judge と Generator で同じメタ情報を見て書く/評価する構造になる。
 *
 * Plan E (Phase 6.4d) で `regenerationFeedback` 引数を追加済。
 * 1 回目 NG で再生成するときに、judge の指摘事項を user メッセージに添えて
 * 「同じ失敗を繰り返させない」よう Haiku に文脈を渡す。
 * system prompt（generator 自身の指針）には Wikipedia 抜粋の使い方を含む
 * 共通ルールのみを置き、リクエスト固有のデータ（市町村名・節気・抜粋・
 * 再生成フィードバック）は user メッセージ側に載せる責務分離。
 *
 * @param {object} req
 * @param {string} req.prefecture
 * @param {string} req.municipality
 * @param {string} req.solar_term - '01'〜'24'
 * @param {string} [req.wikipediaExtract] - Wikipedia 記事の intro 抜粋。空文字/null/undefined はセクション省略
 * @param {string} [req.regenerationFeedback] - 整形済みの指摘テキスト。空文字/null/undefined は無視
 * @returns {object} Messages API request body
 */
export function buildMessagesRequest(req) {
  const meta = SOLAR_TERM_META[req.solar_term];
  let userContent = `都道府県: ${req.prefecture}\n市区町村: ${req.municipality}\n二十四節気: ${meta.name}（${req.solar_term}、${meta.period}）`;

  if (typeof req.wikipediaExtract === 'string' && req.wikipediaExtract.length > 0) {
    userContent += `\n\n[Wikipedia 抜粋]\n${req.wikipediaExtract}`;
  }

  if (typeof req.regenerationFeedback === 'string' && req.regenerationFeedback.length > 0) {
    userContent += `\n\n[前回の出力で校閲から指摘された箇所]\n${req.regenerationFeedback}\n\n上記の指摘を踏まえ、固有名詞を具体的にし、情緒修飾を避け、事実陳述で書き直してください。`;
  }

  return {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: userContent,
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
