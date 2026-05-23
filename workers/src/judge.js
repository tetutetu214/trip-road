/**
 * Judge 統合（Plan I / Faithfulness 1 軸）
 *
 * Plan I（2026-05-11）で Wikipedia 要約特化に転換し、Plan E〜G の 4 軸を
 * Faithfulness 1 軸に簡素化。生成文の固有名詞・事実が Wikipedia 抜粋に
 * 裏付けられているかだけを Amazon Nova Pro に評価させる。
 *
 * 公開する関数:
 *   - parseJudgeResponse: Nova 出力文字列 → {score, out_of_kb_terms, notes} 抽出（純粋関数）
 *   - callJudge: Nova Pro に投げる（429 / 5xx リトライ + JSON パース）
 *   - judgeAll: 文字数判定 → Faithfulness 評価 → 結果集約のメインフロー
 *
 * Phase 2 で形態素解析ベースの決定論的検査に置換予定（Nova Pro 指示無視リスク回避）。
 */

import { buildFaithfulnessPrompt } from './judge_prompts.js';
import { callConverse, NOVA_MODEL_ID } from './nova.js';
import { deterministicJudge } from './deterministic_judge.js';

// ---- 定数 ----

// Plan I 以降、Judge も Generator と同じ Bedrock Nova Pro（self-preference bias 承知）
export const JUDGE_MODEL = NOVA_MODEL_ID;
export const JUDGE_MAX_TOKENS = 600;
// Judge は揺らがないように temperature=0（同じ入力なら同じスコア）
export const JUDGE_TEMPERATURE = 0.0;

// 文字数の許容範囲（Plan I で下限を 120 → 60 に緩和、抜粋が薄い市町村への対応）
const MIN_DESCRIPTION_LENGTH = 60;
const MAX_DESCRIPTION_LENGTH = 180;

// 429 / 5xx リトライ間隔
const RETRY_BACKOFF_MS = 1000;

// 合格しきい値: 4 以上で合格（要約タスクは抜粋外混入が 1 個までなら許容）
export const PASS_THRESHOLD = 4;

const JUDGE_SYSTEM_PROMPT =
  'あなたは厳格な校閲者です。生成文の固有名詞・事実が Wikipedia 抜粋に裏付けられているかだけを評価し、抜粋にない固有名詞を out_of_kb_terms に列挙してスコアを付けます。出力は { "out_of_kb_terms": [...], "notes": "...", "score": N } の JSON のみで、それ以外の説明文は加えないでください。';

// ---- 純粋関数 ----

/**
 * Nova 出力文字列から JSON ブロックを抽出して
 * {score, out_of_kb_terms, notes} を返す。
 *
 * Nova は「JSON のみ出力」と指示しても前後に説明文を付けてくる癖があるので、
 * 最初の `{...}` ブロックを正規表現で抽出してから JSON.parse する。
 * パース失敗・スキーマ不正・score 範囲外は null。
 */
export function parseJudgeResponse(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let obj;
  try {
    obj = JSON.parse(match[0]);
  } catch (_err) {
    return null;
  }

  if (!obj || typeof obj !== 'object') return null;

  const { score, out_of_kb_terms, notes } = obj;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    return null;
  }
  if (!Array.isArray(out_of_kb_terms)) return null;
  if (typeof notes !== 'string') return null;

  return { score, out_of_kb_terms, notes };
}

// ---- 副作用ありの統合関数 ----

/**
 * Faithfulness 評価を Nova Pro に投げてパース済結果を返す。
 *
 * - HTTP 429 / 5xx は 1 回だけ指数バックオフ 1 秒リトライ
 * - リトライも失敗 / JSON パース失敗なら {score: null} を返す
 *   （呼び出し側 judgeAll が fail-open に倒す）
 *
 * params は {prefecture, municipality, description, wikipediaExtract,
 *           wikidataPromptBlock} を受け付ける（最後はオプショナル、Issue #38）
 *
 * @returns {Promise<{score: number|null, out_of_kb_terms: string[], notes: string}>}
 */
export async function callJudge(
  params,
  env,
  callConverseFn = callConverse,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms))
) {
  const prompt = buildFaithfulnessPrompt(params);

  const request = {
    modelId: JUDGE_MODEL,
    system: [{ text: JUDGE_SYSTEM_PROMPT }],
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    inferenceConfig: {
      maxTokens: JUDGE_MAX_TOKENS,
      temperature: JUDGE_TEMPERATURE,
    },
  };

  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await sleepFn(RETRY_BACKOFF_MS);
    }
    const result = await callConverseFn(env, request);

    if (result.ok) {
      const parsed = parseJudgeResponse(result.text);
      if (parsed) return parsed;
      return { score: null, out_of_kb_terms: [], notes: 'parse failed' };
    }

    if (result.status === 429 || (result.status >= 500 && result.status < 600)) {
      lastError = `HTTP ${result.status}`;
      continue;
    }

    return { score: null, out_of_kb_terms: [], notes: `HTTP ${result.status}` };
  }

  return { score: null, out_of_kb_terms: [], notes: lastError ?? 'failed' };
}

/**
 * 文字数判定 → Faithfulness 評価 → 結果集約のメインフロー。
 *
 * Plan I 以降、wikipediaExtract は呼び出し側（describe_flow.js）が必ず取得済の
 * 前提で渡される（抜粋なしの市町村は Generator を呼ばずに早期リターンしているため）。
 *
 * @returns {Promise<{passed, lengthOk, score, out_of_kb_terms, error}>}
 *   - passed: true（合格） / false（不合格） / null（fail-open: Judge 自体が失敗）
 *   - lengthOk: 文字数が許容範囲内か
 *   - score: 1-5 の整数 or null
 *   - out_of_kb_terms: 抜粋にない固有名詞のリスト（パース失敗時は []）
 */
export async function judgeAll({
  description,
  prefecture,
  municipality,
  wikipediaExtract,
  wikidataPromptBlock,
  env,
  judgeRunner = callJudge,
}) {
  if (
    typeof description !== 'string' ||
    description.length < MIN_DESCRIPTION_LENGTH ||
    description.length > MAX_DESCRIPTION_LENGTH
  ) {
    return {
      passed: false,
      lengthOk: false,
      score: null,
      out_of_kb_terms: [],
      error: null,
      deterministic: null,
    };
  }

  if (typeof wikipediaExtract !== 'string' || wikipediaExtract.length === 0) {
    // Plan I では抜粋なしの市町村は Generator を呼ばないので、ここに到達することは
    // 想定外。万一来たら fail-open（呼出側で生成文をそのまま返す）。
    return {
      passed: null,
      lengthOk: true,
      score: null,
      out_of_kb_terms: [],
      error: 'wikipedia_extract_missing',
      deterministic: null,
    };
  }

  // Issue #52 シャドウ運用: Nova Judge と並列に決定論 Judge を実行する。
  // 結果は記録専用、本決定は依然として Nova Judge 側。
  const deterministicShadow = (() => {
    try {
      return deterministicJudge({ description, wikipediaExtract, wikidataPromptBlock });
    } catch (_err) {
      return null;
    }
  })();

  try {
    const result = await judgeRunner(
      { description, prefecture, municipality, wikipediaExtract, wikidataPromptBlock },
      env,
    );

    if (result.score === null) {
      return {
        passed: null,
        lengthOk: true,
        score: null,
        out_of_kb_terms: result.out_of_kb_terms ?? [],
        error: result.notes ?? null,
        deterministic: deterministicShadow,
      };
    }

    return {
      passed: result.score >= PASS_THRESHOLD,
      lengthOk: true,
      score: result.score,
      out_of_kb_terms: result.out_of_kb_terms,
      error: null,
      deterministic: deterministicShadow,
    };
  } catch (err) {
    return {
      passed: null,
      lengthOk: true,
      score: null,
      out_of_kb_terms: [],
      error: err?.message ?? String(err),
      deterministic: deterministicShadow,
    };
  }
}
