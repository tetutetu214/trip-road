/**
 * Judge 統合（Plan E / Phase 6.3）
 *
 * 4 軸（事実正確性 / 具体性 / 季節整合 / 情報密度）を Sonnet 4.6 で並列評価し、
 * 集約スコアと判定（passed: true/false/null）を返す。
 *
 * 設計判断は docs/plan.md 第 10 章、仕様詳細は docs/spec.md 10.4 章、
 * 実装上の判断は docs/knowledge.md 4.10 章を参照。
 *
 * 公開する関数:
 *   - parseJudgeResponse: Sonnet 出力文字列 → {score, deductions, notes} 抽出（純粋関数）
 *   - aggregateScores: 4 軸結果 → {passed, scores, deductions} 集約（純粋関数）
 *   - callJudge: 1 軸を Sonnet に投げる（429 リトライ + JSON パース）
 *   - judgeAll: 文字数判定 → Wikipedia → 4 軸並列 → 集約のメインフロー
 */

import {
  buildFactualityPrompt,
  buildSpecificityPrompt,
  buildSeasonalConsistencyPrompt,
  buildInformationDensityPrompt,
} from './judge_prompts.js';
import { getCachedWikipediaExtract } from './wikipedia.js';

// ---- 定数 ----

export const JUDGE_MODEL = 'claude-sonnet-4-6';
export const JUDGE_MAX_TOKENS = 600;

// 文字数の許容範囲（spec.md 4.X / 10.4）
const MIN_DESCRIPTION_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 180;

// 429 / 5xx リトライ間隔（指数バックオフの初項、ms）
const RETRY_BACKOFF_MS = 1000;

// 軸名 → プロンプト構築関数のマッピング
const AXIS_PROMPT_BUILDERS = {
  accuracy: buildFactualityPrompt,
  specificity: buildSpecificityPrompt,
  season_fit: buildSeasonalConsistencyPrompt,
  density: buildInformationDensityPrompt,
};

// 評価対象の軸（順序固定）
const ALL_AXES = ['accuracy', 'specificity', 'season_fit', 'density'];

// ---- 純粋関数 ----

/**
 * Sonnet 出力文字列から JSON ブロックを抽出して {score, deductions, notes} を返す。
 *
 * Sonnet は「JSON のみ出力」と指示しても前後に説明文を付けてくる癖があるので、
 * 最初の `{...}` ブロックを正規表現で抽出してから JSON.parse する。
 * パース失敗・スキーマ不正・score 範囲外（1〜5 の整数でない）はすべて null。
 *
 * @param {string} text
 * @returns {{score: number, deductions: string[], notes: string}|null}
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

  const { score, deductions, notes } = obj;
  if (typeof score !== 'number' || !Number.isInteger(score) || score < 1 || score > 5) {
    return null;
  }
  if (!Array.isArray(deductions)) return null;
  if (typeof notes !== 'string') return null;

  return { score, deductions, notes };
}

/**
 * 4 軸の judge 結果を集約。
 *
 * passed の決定:
 *   - いずれかの軸で score=null（パース失敗・リトライ全敗）→ null（fail-open）
 *   - 全軸 score>=4 → true
 *   - いずれかの軸で score<4 → false
 *
 * @param {Record<string, {score: number|null, deductions: string[], notes: string}>} judgments
 *        キーは accuracy / specificity / season_fit / density
 * @returns {{passed: boolean|null, scores: object|null, deductions: object}}
 */
export function aggregateScores(judgments) {
  const scores = {};
  const deductions = {};
  let hasNull = false;
  let allPassed = true;

  for (const axis of ALL_AXES) {
    const j = judgments[axis];
    scores[axis] = j?.score ?? null;
    deductions[axis] = j?.deductions ?? [];
    if (j?.score === null || j?.score === undefined) {
      hasNull = true;
    } else if (j.score < 4) {
      allPassed = false;
    }
  }

  let passed;
  if (hasNull) {
    passed = null;
  } else {
    passed = allPassed;
  }

  return { passed, scores: hasNull ? null : scores, deductions };
}

// ---- 副作用ありの統合関数 ----

/**
 * 1 軸を Sonnet に投げてパース済結果を返す。
 *
 * - HTTP 429 / 5xx は 1 回だけ指数バックオフ 1 秒リトライ
 * - リトライも失敗したら、または JSON パース失敗なら {score: null} を返す
 *   （呼び出し側 aggregateScores が fail-open に倒す）
 *
 * @param {string} axis - 'accuracy' | 'specificity' | 'season_fit' | 'density'
 * @param {object} params - {description, prefecture, municipality, solarTerm[, wikipediaExtract]}
 * @param {object} env - Workers env（ANTHROPIC_API_KEY を含む）
 * @param {typeof fetch} [fetchFn=fetch]
 * @param {(ms: number) => Promise<void>} [sleepFn] - テストで即時 resolve に差し替え可能
 * @returns {Promise<{score: number|null, deductions: string[], notes: string}>}
 */
export async function callJudge(
  axis,
  params,
  env,
  fetchFn = fetch,
  sleepFn = (ms) => new Promise((r) => setTimeout(r, ms))
) {
  const builder = AXIS_PROMPT_BUILDERS[axis];
  if (!builder) {
    return { score: null, deductions: [], notes: `unknown axis: ${axis}` };
  }
  const prompt = builder(params);

  const body = {
    model: JUDGE_MODEL,
    max_tokens: JUDGE_MAX_TOKENS,
    messages: [{ role: 'user', content: prompt }],
  };

  // 1 回目 + 1 回リトライ
  let lastError = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      await sleepFn(RETRY_BACKOFF_MS);
    }
    try {
      const res = await fetchFn('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });

      // リトライ対象：429 / 5xx
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        lastError = `HTTP ${res.status}`;
        continue;
      }

      if (!res.ok) {
        // 4xx（429 以外）はリトライしても無駄なので即 fail-open
        return { score: null, deductions: [], notes: `HTTP ${res.status}` };
      }

      const data = await res.json();
      const text = data?.content?.[0]?.text ?? '';
      const parsed = parseJudgeResponse(text);
      if (parsed) return parsed;
      return { score: null, deductions: [], notes: 'parse failed' };
    } catch (err) {
      lastError = err?.message ?? String(err);
    }
  }

  return { score: null, deductions: [], notes: lastError ?? 'failed' };
}

/**
 * 文字数判定 → Wikipedia 取得 → 4 軸並列 judge → 集約 のメインフロー。
 *
 * @param {object} args
 * @param {string} args.description
 * @param {string} args.prefecture
 * @param {string} args.municipality
 * @param {string} args.solarTerm
 * @param {string} [args.muniCode] - Wikipedia キャッシュ用キー。未指定なら municipality を使う
 * @param {object} args.env
 * @param {typeof fetch} [args.fetchFn=fetch]
 * @param {Function} [args.wikipediaFetcher] - 既定: getCachedWikipediaExtract
 * @param {Function} [args.judgeRunner] - 既定: callJudge（テストでモック可能）
 * @returns {Promise<{
 *   passed: boolean|null,
 *   lengthOk: boolean,
 *   scores: object|null,
 *   deductions: object,
 *   error: string|null,
 * }>}
 */
export async function judgeAll({
  description,
  prefecture,
  municipality,
  solarTerm,
  muniCode,
  env,
  fetchFn = fetch,
  wikipediaFetcher = getCachedWikipediaExtract,
  judgeRunner = callJudge,
}) {
  // 1. 文字数チェック（即 NG なら他軸を呼ばずに早期リターン）
  if (
    typeof description !== 'string' ||
    description.length < MIN_DESCRIPTION_LENGTH ||
    description.length > MAX_DESCRIPTION_LENGTH
  ) {
    return {
      passed: false,
      lengthOk: false,
      scores: null,
      deductions: {},
      error: null,
    };
  }

  try {
    // 2. Wikipedia 取得（軸 1 にだけ渡す）
    const wikipediaExtract = await wikipediaFetcher({
      muniCode: muniCode ?? municipality,
      municipality,
      prefecture,
      fetchFn,
    });

    // 3. 4 軸並列呼出
    const baseParams = { description, prefecture, municipality, solarTerm };
    const factualityParams = { ...baseParams, wikipediaExtract };

    const [accuracy, specificity, season_fit, density] = await Promise.all([
      judgeRunner('accuracy', factualityParams, env, fetchFn),
      judgeRunner('specificity', baseParams, env, fetchFn),
      judgeRunner('season_fit', baseParams, env, fetchFn),
      judgeRunner('density', baseParams, env, fetchFn),
    ]);

    // 4. 集約
    const aggregated = aggregateScores({ accuracy, specificity, season_fit, density });

    return {
      passed: aggregated.passed,
      lengthOk: true,
      scores: aggregated.scores,
      deductions: aggregated.deductions,
      error: null,
    };
  } catch (err) {
    // judge 自体のエラーは fail-open（spec.md 10.8）
    return {
      passed: null,
      lengthOk: true,
      scores: null,
      deductions: {},
      error: err?.message ?? String(err),
    };
  }
}
