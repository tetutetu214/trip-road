/**
 * Amazon Bedrock Nova Pro クライアント（Plan I / Wikipedia 要約特化）
 *
 * Cloudflare Workers から Bedrock Runtime Converse API を SigV4 署名つきで呼び、
 * Generator（Wikipedia 抜粋の要約）と Judge（Faithfulness 1 軸）の両方で共用する。
 *
 * モデル指定は cross-region inference profile `us.amazon.nova-pro-v1:0` を使う。
 * Bedrock 公式ベストプラクティスに従い、us-east-1 / us-west-2 / us-east-2 の
 * 3 リージョンに自動分散させる。
 *
 * Plan I（2026-05-11）でタスクを「未知の創作」から「既知の圧縮（要約）」へ転換。
 * 二十四節気は廃止、Wikipedia 抜粋を唯一の情報源とする。
 *
 * 公開関数:
 *   - parseDescribeRequest: 受信 JSON body のバリデーション（純粋関数）
 *   - buildGeneratorRequest: Generator 用 Converse API リクエスト body（純粋関数）
 *   - parseConverseResponse: Converse レスポンスから生成テキスト抽出（純粋関数）
 *   - callConverse: Bedrock Runtime に Converse を投げる低レベル関数（副作用）
 *   - callNovaGenerator: Generator 用ラッパー
 */

import { AwsClient } from 'aws4fetch';

// ---- 定数 ----

export const BEDROCK_REGION = 'us-east-1';
export const NOVA_MODEL_ID = 'us.amazon.nova-pro-v1:0';

// Generator は 120〜180 字の解説本文を出すので 400 token で十分
// （Anthropic 版の max_tokens=400 を踏襲、観測後に必要なら調整）。
export const GENERATOR_MAX_TOKENS = 400;

// 生成のばらつき。0.7 は描写の多様性とハルシネーション抑制のバランス。
export const DEFAULT_TEMPERATURE = 0.7;

const SYSTEM_PROMPT = `あなたは日本の市町村情報の要約者です。提供された Wikipedia 抜粋を素材として、カーナビの土地情報のように淡々とした、3〜4文の要約を書いてください。

# 最重要ルール（守らないと致命的）
- Wikipedia 抜粋に書かれている事実だけを使う
- 抜粋にない地名・人物・年号・特産品・施設名・歴史事実を出してはならない
- 「自分の知識で補う」「もしかしたら〜だろう」は禁止
- 抜粋が短く 120 字に満たない場合は、無理に膨らませず短いまま出力してよい

# 文体
- 「です・ます調」で、淡々と事実を並べる文体
- 季節の挨拶や情緒的・抒情的な表現は使わない
- 禁止する表現の例：「〜を迎えた」「〜に包まれて」「清々しい」「心地よい」「息吹を堪能」「〜のたたずまい」「旅情」「身を委ねる」「魅力」「楽しめる」「おすすめ」「いざ」など
- 期待する文体の例：「〇〇市は××に位置します」「△△地区には□□があります」「江戸期には◇◇として栄えました」のような事実陳述

# 出力形式
- プレーンテキストのみ。マークダウン（# 見出し、**強調**、- 箇条書き、空行 など）を一切使わない
- 冒頭にタイトル・見出し・市町村名のラベルを置かない、いきなり本文から始める
- 字数は 60〜180 字を目安。抜粋が薄い場合は 60〜119 字でもよい。180 字を超えそうなら要素を削って収める

# 抜粋の使い方
- 抜粋の文章をそのまま引用したり、文の構造を真似たりしない
- 抜粋に書かれた地名・施設・歴史事実を素材として、自分の言葉で要約する
- 抜粋と直接矛盾することは書かない
- 抜粋に複数の話題がある場合は、地理・歴史・特徴的な要素を優先する

# 出力で禁じる振る舞い
- 「これ以上の詳述は控えます」「確信を持つ情報が限定されるため」「お書きすることができません」のような自己放棄文・謝罪文は禁止
- 「準備中」「情報がありません」のような注釈は禁止（これらの表示はフロント側の責任）
- 抜粋にない事実を補ったり、季節の挨拶を付け加えてはならない

# 参考例
入力:
都道府県: 北海道
市区町村: 函館市

[Wikipedia 抜粋]
函館市は、北海道渡島地方南部に位置する中核市である。1859年に開港した国際貿易港・函館港を有し、明治期には外国人居留地が形成された。函館山からの夜景は世界三大夜景の一つとされる。

良い出力例（115字、抜粋の事実だけを再構成、自分の言葉で要約）:
函館市は北海道渡島地方の南部に位置する中核市です。1859 年に国際貿易港として開港した函館港を有し、明治期には外国人居留地が形成されました。函館山からの夜景は世界三大夜景の一つに数えられます。`;

// ---- 純粋関数 ----

/**
 * POST /api/describe の body をバリデーション。
 *
 * Plan I で solar_term フィールドを廃止。受信側で送られてきても無視する設計。
 *
 * @param {any} body - JSON.parse 済みの値
 * @returns {{ok: true, value: {prefecture, municipality}} | {ok: false, error: string}}
 */
export function parseDescribeRequest(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be an object' };
  }
  const { prefecture, municipality } = body;
  if (typeof prefecture !== 'string' || prefecture.length === 0) {
    return { ok: false, error: 'missing required field: prefecture' };
  }
  if (typeof municipality !== 'string' || municipality.length === 0) {
    return { ok: false, error: 'missing required field: municipality' };
  }
  return { ok: true, value: { prefecture, municipality } };
}

/**
 * Generator 用の Bedrock Converse API リクエスト body を組み立てる。
 *
 * Plan I 以降、Wikipedia 抜粋が必須。抜粋なしの場合は呼び出し側（describe_flow.js）が
 * Generator を呼ばずに「記事なし」を返す設計なので、ここでは抜粋ありを前提とする。
 *
 * @param {object} req
 * @param {string} req.prefecture
 * @param {string} req.municipality
 * @param {string} req.wikipediaExtract - cleanExtract 適用済（呼び出し側で保証）
 * @param {string} [req.regenerationFeedback] - 再生成時の Faithfulness Judge 指摘
 */
export function buildGeneratorRequest(req) {
  let userText = `都道府県: ${req.prefecture}\n市区町村: ${req.municipality}\n\n[Wikipedia 抜粋]\n${req.wikipediaExtract}`;

  if (typeof req.regenerationFeedback === 'string' && req.regenerationFeedback.length > 0) {
    userText += `\n\n[前回の出力で校閲から指摘された箇所]\n${req.regenerationFeedback}\n\n上記の指摘を踏まえ、抜粋にない事実を出さずに書き直してください。`;
  }

  return {
    modelId: NOVA_MODEL_ID,
    system: [{ text: SYSTEM_PROMPT }],
    messages: [
      {
        role: 'user',
        content: [{ text: userText }],
      },
    ],
    inferenceConfig: {
      maxTokens: GENERATOR_MAX_TOKENS,
      temperature: DEFAULT_TEMPERATURE,
    },
  };
}

/**
 * Bedrock Converse レスポンスから生成テキストを抽出。
 * 形式: `{ output: { message: { role, content: [{ text }] } }, stopReason, usage, metrics }`
 *
 * 取り出せない・空文字のときは null を返す（呼出側でエラー化）。
 */
export function parseConverseResponse(data) {
  if (!data || typeof data !== 'object') return null;
  const text = data?.output?.message?.content?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) return null;
  return text;
}

// ---- 副作用ありの関数 ----

/**
 * Bedrock Runtime Converse API を呼ぶ低レベル関数（Generator / Judge 共用）。
 *
 * SigV4 署名は aws4fetch (`AwsClient`) が担当。modelId は body 直下に持っているが
 * Bedrock の REST API では URL path に入る形式なので、ここで抽出して URL を組む。
 *
 * - HTTP 4xx/5xx は ok=false で返す（リトライは呼出側の責務）
 * - レスポンス JSON が壊れている / 空 → ok=false, status=502
 *
 * テストでは `opts.awsClient` に `{fetch: モック関数}` を渡すと aws4fetch を
 * バイパスでき、署名動作はライブラリ側のテストに任せられる。
 *
 * @param {object} env - Workers env（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY 必須）
 * @param {object} request - Converse body。`modelId` を含む（URL に転記する）
 * @param {object} [opts]
 * @param {{fetch: Function}} [opts.awsClient] - テスト用注入
 * @returns {Promise<{ok: true, text: string} | {ok: false, status: number, detail: string}>}
 */
export async function callConverse(env, request, opts = {}) {
  if (!request || typeof request.modelId !== 'string' || request.modelId.length === 0) {
    return { ok: false, status: 400, detail: 'modelId is required' };
  }
  const { modelId, ...body } = request;

  const aws =
    opts.awsClient ??
    new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      service: 'bedrock',
      region: BEDROCK_REGION,
    });

  const url = `https://bedrock-runtime.${BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`;

  let res;
  try {
    res = await aws.fetch(url, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      detail: `network error: ${err?.message ?? String(err)}`,
    };
  }

  if (!res.ok) {
    const text = await res.text();
    return {
      ok: false,
      status: res.status,
      detail: `Bedrock error: ${text.slice(0, 300)}`,
    };
  }

  let data;
  try {
    data = await res.json();
  } catch (_err) {
    return { ok: false, status: 502, detail: 'invalid JSON from Bedrock' };
  }

  const result = parseConverseResponse(data);
  if (!result) {
    return { ok: false, status: 502, detail: 'empty response from Bedrock Nova' };
  }
  return { ok: true, text: result };
}

/**
 * Generator 専用ラッパー。
 * describe_flow.js は既存 callAnthropic と同じく `{ok, description}` を期待する
 * のでマッピングして互換性を保つ。
 *
 * @param {object} request - buildGeneratorRequest の戻り値
 * @param {object} env - Workers env
 * @param {object} [opts] - callConverse に転送
 * @returns {Promise<{ok: true, description: string} | {ok: false, status: number, detail: string}>}
 */
export async function callNovaGenerator(request, env, opts = {}) {
  const result = await callConverse(env, request, opts);
  if (!result.ok) return result;
  return { ok: true, description: result.text };
}
