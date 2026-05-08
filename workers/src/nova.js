/**
 * Amazon Bedrock Nova Pro クライアント（Plan H / Phase 8）
 *
 * Cloudflare Workers から Bedrock Runtime Converse API を SigV4 署名つきで呼び、
 * Generator（土地のたより生成）と Judge（4 軸評価）の両方で共用する。
 *
 * モデル指定は cross-region inference profile `us.amazon.nova-pro-v1:0` を使う。
 * Bedrock 公式ベストプラクティスに従い、us-east-1 / us-west-2 / us-east-2 の
 * 3 リージョンに自動分散させる。Workers Secrets の AWS_ACCESS_KEY_ID /
 * AWS_SECRET_ACCESS_KEY を流用、IAM ユーザーは trip-road-telemetry-writer。
 *
 * 設計判断は docs/plan.md 第 12 章、`maxTokens` を必ず明示する理由は
 * docs/knowledge.md 4.22.2 章を参照。
 *
 * 公開関数:
 *   - solarTermToJa: 二十四節気の番号文字列 → 日本語名（純粋関数）
 *   - parseDescribeRequest: 受信 JSON body のバリデーション（純粋関数）
 *   - buildGeneratorRequest: Generator 用 Converse API リクエスト body（純粋関数）
 *   - parseConverseResponse: Converse レスポンスから生成テキスト抽出（純粋関数）
 *   - callConverse: Bedrock Runtime に Converse を投げる低レベル関数（副作用）
 *   - callNovaGenerator: Generator 用ラッパー（既存 callAnthropic 互換 API）
 */

import { AwsClient } from 'aws4fetch';
import { SOLAR_TERM_META } from './solar_term_meta.js';

// ---- 定数 ----

export const BEDROCK_REGION = 'us-east-1';
export const NOVA_MODEL_ID = 'us.amazon.nova-pro-v1:0';

// Generator は 120〜180 字の解説本文を出すので 400 token で十分
// （Anthropic 版の max_tokens=400 を踏襲、観測後に必要なら調整）。
export const GENERATOR_MAX_TOKENS = 400;

// 生成のばらつき。0.7 は描写の多様性とハルシネーション抑制のバランス。
export const DEFAULT_TEMPERATURE = 0.7;

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
- 二十四節気の季節感（その節気の旬の食材・農作物・景色）に一言だけ触れる。季節情報は LLM の一般知識で書いてよい
- 以下の要素は、その土地で確信を持って書ける範囲だけ含める。書けるものだけでよく、無理に全部書こうとしない：
  - 具体的な地名（山・川・峠・湖・旧街道・神社仏閣・港・台地など固有名詞）
  - 歴史的背景（城下町・宿場町・港町・産業の起こりなど）
  - 地形的特徴（盆地・河岸段丘・扇状地・リアス海岸・台地・カルデラなど）
  - 名物・特産品
- 検証必須の固有名詞（具体的な人物名・年代・寺社名・建造物名など、誤りが致命的なもの）は、確信があるものだけ書く。曖昧な記憶で捻り出さない
- 地理常識（〇〇川が南を流れる、台地の上にある、海に面する、住宅地が広がる等）は、Wikipedia 抜粋に直接矛盾しない範囲で LLM の地理知識を活用してよい
- 祭りやイベントの具体的な日付・回数・年号は書かない（代わりに「例年◯月頃」と表現する）

# Wikipedia 抜粋の使い方
ユーザメッセージに「[Wikipedia 抜粋]」セクションがある場合、その内容を事実確認のための参考資料として扱ってください。
- 抜粋の文章をそのまま引用したり、文の構造を真似たりしないでください
- 抜粋に書かれた地名・施設・歴史事実を素材として、観光ガイド口調の「土地のたより」を自分の言葉で書いてください
- 抜粋と直接矛盾しない範囲で、LLM が持つ地理・歴史・季節の一般知識を活用して書いてよい。Wikipedia に記載がないだけの事項を省略する必要はない
- 抜粋セクションがない場合、その市町村の Wikipedia 記事が見つからなかったことを意味します。検証必須の固有名詞（人物名・年代・寺社名）は捻り出さず、地理常識と季節情報の範囲で書いてください

# 出力で禁じる振る舞い
- 「これ以上の詳述は控えます」「確信を持つ情報が限定されるため」「お書きすることができません」のような自己放棄文・謝罪文は禁止。あくまで 120〜180 字の解説本文だけを出力する

# 参考例
入力:
都道府県: 北海道
市区町村: 函館市
二十四節気: 処暑（14、8月23日頃〜白露前）

[Wikipedia 抜粋]
函館市は、北海道渡島地方南部に位置する中核市である。1859年に開港した国際貿易港・函館港を有し、明治期には外国人居留地が形成された。函館山からの夜景は世界三大夜景の一つとされる。

良い出力例（137字、文体は自分の言葉、抜粋の事実を素材化）:
函館市は北海道渡島地方の南部に位置します。函館山の麓に広がる港町で、1859年に国際貿易港として開港し、明治期には外国人居留地が形成されました。処暑のころ、北海道では夏の暑さが和らぎ、いか漁の最盛期を迎えます。函館港の朝市にも秋の気配が見え始める時期です。`;

// ---- 純粋関数 ----

/**
 * 二十四節気の番号文字列（'01'〜'24'）を日本語名に変換。
 * 未知の値は undefined を返す。
 */
export function solarTermToJa(solarTerm) {
  return SOLAR_TERM_META[solarTerm]?.name;
}

/**
 * POST /api/describe の body をバリデーション（既存 anthropic.js と同等）。
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
 * Generator 用の Bedrock Converse API リクエスト body を組み立てる。
 *
 * Converse 形式の特徴（Anthropic Messages API との差異）:
 *   - `system` は配列、要素は `{text: '...'}`
 *   - `messages[*].content` は配列、要素は `{text: '...'}`（マルチモーダル拡張のため）
 *   - `max_tokens` は `inferenceConfig.maxTokens`
 *   - モデルは `modelId`、URL path に入る（body には残しておき呼出側で抽出）
 *
 * 入力契約は既存 buildMessagesRequest と同じ:
 *   - {prefecture, municipality, solar_term}（必須）
 *   - {wikipediaExtract}（任意、空文字 / null / undefined はセクション省略）
 *   - {regenerationFeedback}（任意、再生成時に judge の指摘を埋め込む）
 */
export function buildGeneratorRequest(req) {
  const meta = SOLAR_TERM_META[req.solar_term];
  let userText = `都道府県: ${req.prefecture}\n市区町村: ${req.municipality}\n二十四節気: ${meta.name}（${req.solar_term}、${meta.period}）`;

  if (typeof req.wikipediaExtract === 'string' && req.wikipediaExtract.length > 0) {
    userText += `\n\n[Wikipedia 抜粋]\n${req.wikipediaExtract}`;
  }

  if (typeof req.regenerationFeedback === 'string' && req.regenerationFeedback.length > 0) {
    userText += `\n\n[前回の出力で校閲から指摘された箇所]\n${req.regenerationFeedback}\n\n上記の指摘を踏まえ、固有名詞を具体的にし、情緒修飾を避け、事実陳述で書き直してください。`;
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
