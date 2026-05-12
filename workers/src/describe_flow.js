/**
 * /api/describe のメインフロー（Plan I / Wikipedia 要約特化）
 *
 * 振る舞い:
 *   1. Wikipedia 抜粋を取得
 *   2. 抜粋なし → Generator を呼ばずに「記事なし」を返す（フロントで表示メッセージを出す）
 *   3. 抜粋あり → Generator で要約 → Faithfulness Judge
 *   4. judge passed=true → 返す
 *   5. judge passed=false → 1 回だけ再生成 → 再 judge
 *   6. 再 judge も passed=false → Wikipedia 抜粋を切り詰めてフォールバック
 *   7. judge passed=null（fail-open） → 1 回目の生成文をそのまま返す
 *
 * Plan I の核心:
 *   - LLM の内部知識で創作させない（in-context にない情報は出さない）
 *   - 抜粋なしの市町村に対して LLM で創作させるのは禁止
 *   - judge も passed しない生成は機械的に抜粋転載へフォールバック（ハルシネーション防止）
 *
 * 設計判断は docs/plans/2026-05-11-plan-i-wikipedia-summary-pivot.md 参照。
 */

import { buildGeneratorRequest, callNovaGenerator, NOVA_MODEL_ID } from './nova.js';
import { judgeAll, JUDGE_MODEL } from './judge.js';
import { getCachedWikipediaExtract } from './wikipedia.js';

const GENERATOR_MODEL = NOVA_MODEL_ID;

// フォールバック転載時の字数上限。SYSTEM_PROMPT の上限 180 と揃える。
const FALLBACK_MAX_LENGTH = 180;
// 60 字を下回る抜粋はそのまま返す（短い記事をさらに切り詰めない）
const FALLBACK_MIN_LENGTH = 60;

/**
 * Faithfulness Judge の out_of_kb_terms を再生成プロンプト用に整形（純粋関数）。
 *
 * 抜粋にない固有名詞のリストを箇条書き化し、Generator に「これらの単語は抜粋外なので
 * 使うな」というフィードバックを与える。
 *
 * 空配列・null は空文字を返す（呼び出し側 nova.js が無視）。
 *
 * @param {string[]|null|undefined} terms
 * @returns {string}
 */
export function formatOutOfKbTermsForFeedback(terms) {
  if (!Array.isArray(terms) || terms.length === 0) return '';
  const lines = ['抜粋に書かれていない固有名詞・事実（使ってはならない）:'];
  terms.forEach((t) => lines.push(`  ・${t}`));
  return lines.join('\n');
}

/**
 * Wikipedia 抜粋を 60〜180 字に収めて返す（純粋関数、フォールバック転載用）。
 *
 * - 抜粋が FALLBACK_MIN_LENGTH 未満なら、そのまま返す
 * - FALLBACK_MAX_LENGTH 以下ならそのまま返す
 * - 超える場合は最初の句点までで切る、それでも超えるなら FALLBACK_MAX_LENGTH で切り詰めて … を付ける
 *
 * @param {string} extract
 * @returns {string}
 */
export function truncateExtractForFallback(extract) {
  if (typeof extract !== 'string' || extract.length === 0) return '';
  if (extract.length <= FALLBACK_MAX_LENGTH) return extract;

  // 句点単位で取り、上限内に収まるだけ繋ぐ
  const sentences = extract.split('。');
  let acc = '';
  for (const s of sentences) {
    if (s.length === 0) continue;
    const next = acc + s + '。';
    if (next.length > FALLBACK_MAX_LENGTH) break;
    acc = next;
  }
  if (acc.length >= FALLBACK_MIN_LENGTH) return acc;

  // 1 文目で既に上限を超えるケース → 文字数で切る
  return extract.slice(0, FALLBACK_MAX_LENGTH) + '…';
}

/**
 * 生成 + Faithfulness Judge + 1 回までの再生成 + 抜粋転載フォールバック。
 *
 * 振る舞い分岐:
 *   - Wikipedia 抜粋なし → {ok: true, no_wikipedia: true}
 *   - 1 回目生成失敗 → {ok: false}
 *   - judge passed=true → そのまま返す（regenerated=false, fallback_to_extract=false）
 *   - judge passed=null（fail-open） → 1 回目生成文を返す（judge_error あり）
 *   - judge passed=false → 1 回だけ再生成
 *     - 再生成エラー → 1 回目を返す
 *     - 再生成成功 → 再 judge → passed=true なら返す
 *     - 再 judge も passed=false → Wikipedia 抜粋転載へフォールバック
 *
 * @param {object} parsed - parseDescribeRequest の value（{prefecture, municipality}）
 * @param {object} env - Workers env
 * @param {object} [deps] - 依存注入
 * @returns {Promise<
 *   | {ok: true, description: string, no_wikipedia?: boolean,
 *      judge_passed: boolean|null, faithfulness_score: number|null,
 *      out_of_kb_terms: string[], regenerated: boolean, fallback_to_extract: boolean,
 *      wikipedia_extract_length: number, judge_error: string|null,
 *      generator_model: string, judge_model: string}
 *   | {ok: false, status: number, detail: string}
 * >}
 */
export async function generateAndJudge(parsed, env, deps = {}) {
  const generator = deps.generator ?? callNovaGenerator;
  const judger = deps.judger ?? judgeAll;
  const fetchFn = deps.fetchFn ?? fetch;
  const wikipediaFetcher = deps.wikipediaFetcher ?? getCachedWikipediaExtract;

  // 1. Wikipedia 抜粋を取得
  let wikipediaExtract = null;
  try {
    wikipediaExtract = await wikipediaFetcher({
      muniCode: parsed.municipality,
      municipality: parsed.municipality,
      prefecture: parsed.prefecture,
      fetchFn,
    });
  } catch (_err) {
    wikipediaExtract = null;
  }

  // 2. 抜粋なし → Generator を呼ばずに早期リターン（Plan I のコア原則）
  if (typeof wikipediaExtract !== 'string' || wikipediaExtract.length === 0) {
    return {
      ok: true,
      description: '',
      no_wikipedia: true,
      judge_passed: null,
      faithfulness_score: null,
      out_of_kb_terms: [],
      regenerated: false,
      fallback_to_extract: false,
      wikipedia_extract_length: 0,
      judge_error: null,
      generator_model: GENERATOR_MODEL,
      judge_model: JUDGE_MODEL,
    };
  }

  // 3. 1 回目生成
  const messagesReq = buildGeneratorRequest({ ...parsed, wikipediaExtract });
  const gen1 = await generator(messagesReq, env);
  if (!gen1.ok) {
    return { ok: false, status: gen1.status, detail: gen1.detail };
  }

  // 4. 1 回目 Judge
  const judge1 = await judger({
    description: gen1.description,
    prefecture: parsed.prefecture,
    municipality: parsed.municipality,
    wikipediaExtract,
    env,
  });

  // 4a. passed=true: そのまま返す
  if (judge1.passed === true) {
    return {
      ok: true,
      description: gen1.description,
      judge_passed: true,
      faithfulness_score: judge1.score,
      out_of_kb_terms: judge1.out_of_kb_terms,
      regenerated: false,
      fallback_to_extract: false,
      wikipedia_extract_length: wikipediaExtract.length,
      judge_error: null,
      generator_model: GENERATOR_MODEL,
      judge_model: JUDGE_MODEL,
    };
  }

  // 4b. passed=null: fail-open（再生成しない、1 回目をそのまま返す）
  if (judge1.passed === null) {
    return {
      ok: true,
      description: gen1.description,
      judge_passed: null,
      faithfulness_score: judge1.score,
      out_of_kb_terms: judge1.out_of_kb_terms ?? [],
      regenerated: false,
      fallback_to_extract: false,
      wikipedia_extract_length: wikipediaExtract.length,
      judge_error: judge1.error,
      generator_model: GENERATOR_MODEL,
      judge_model: JUDGE_MODEL,
    };
  }

  // 5. passed=false: 1 回だけ再生成（judge1 の out_of_kb_terms を Generator に渡す）
  const feedback = formatOutOfKbTermsForFeedback(judge1.out_of_kb_terms);
  const messagesReq2 = buildGeneratorRequest({
    ...parsed,
    wikipediaExtract,
    regenerationFeedback: feedback,
  });
  const gen2 = await generator(messagesReq2, env);
  if (!gen2.ok) {
    // 再生成エラー → 1 回目を返す
    return {
      ok: true,
      description: gen1.description,
      judge_passed: false,
      faithfulness_score: judge1.score,
      out_of_kb_terms: judge1.out_of_kb_terms,
      regenerated: false,
      fallback_to_extract: false,
      wikipedia_extract_length: wikipediaExtract.length,
      judge_error: null,
      generator_model: GENERATOR_MODEL,
      judge_model: JUDGE_MODEL,
    };
  }

  // 6. 再 Judge
  const judge2 = await judger({
    description: gen2.description,
    prefecture: parsed.prefecture,
    municipality: parsed.municipality,
    wikipediaExtract,
    env,
  });

  // 7. 再 judge passed=true: 2 回目を返す
  if (judge2.passed === true) {
    return {
      ok: true,
      description: gen2.description,
      judge_passed: true,
      faithfulness_score: judge2.score,
      out_of_kb_terms: judge2.out_of_kb_terms,
      regenerated: true,
      fallback_to_extract: false,
      wikipedia_extract_length: wikipediaExtract.length,
      judge_error: null,
      generator_model: GENERATOR_MODEL,
      judge_model: JUDGE_MODEL,
    };
  }

  // 8. 再 judge も passed=false / null: Wikipedia 抜粋転載へフォールバック
  return {
    ok: true,
    description: truncateExtractForFallback(wikipediaExtract),
    judge_passed: judge2.passed,
    faithfulness_score: judge2.score,
    out_of_kb_terms: judge2.out_of_kb_terms ?? [],
    regenerated: true,
    fallback_to_extract: true,
    wikipedia_extract_length: wikipediaExtract.length,
    judge_error: judge2.error,
    generator_model: GENERATOR_MODEL,
    judge_model: JUDGE_MODEL,
  };
}
