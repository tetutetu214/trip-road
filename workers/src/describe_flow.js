/**
 * /api/describe のメインフロー（Plan E / Phase 6.4b）
 *
 * 生成 → judge → NG なら 1 回だけ再生成 → 再 judge → 打ち切り
 * のループを担う。`workers/src/index.js` のハンドラから呼び出される。
 *
 * 設計判断・障害ハンドリング方針は docs/plan.md 第 10 章 / docs/spec.md 10.4-10.5
 * を参照。実装上の判断は docs/knowledge.md 4.11 章を参照。
 */

import { buildMessagesRequest, callAnthropic } from './anthropic.js';
import { judgeAll } from './judge.js';

// 軸キー → 日本語ラベル（feedback テキスト用）
const AXIS_LABELS = {
  accuracy: '事実正確性',
  specificity: '具体性',
  season_fit: '季節整合',
  density: '情報密度',
};

/**
 * judge の deductions オブジェクトを Haiku 用のフィードバックテキストに整形（純粋関数）。
 *
 * 入力: { accuracy: [...], specificity: ['桜が美しい（汎用）', ...], season_fit: [], density: [...] }
 * 出力（例）:
 *   - 具体性:
 *     ・桜が美しい（汎用）
 *   - 情報密度:
 *     ・淡紅色に染まり（情緒）
 *
 * 全軸の deductions が空 / 入力が null のときは空文字を返す（呼び出し側 anthropic.js が無視）。
 *
 * @param {object|null|undefined} deductions
 * @returns {string}
 */
export function formatDeductionsForFeedback(deductions) {
  if (!deductions || typeof deductions !== 'object') return '';
  const lines = [];
  for (const [axis, items] of Object.entries(deductions)) {
    if (Array.isArray(items) && items.length > 0) {
      lines.push(`- ${AXIS_LABELS[axis] ?? axis}:`);
      items.forEach((d) => lines.push(`  ・${d}`));
    }
  }
  return lines.join('\n');
}

/**
 * 生成 + Judge + 1 回までの再生成 を実行し、レスポンス用の集約結果を返す。
 *
 * 振る舞いの分岐:
 *   - 1 回目生成失敗 → ok=false（呼び出し側が 502 を返す）
 *   - 1 回目 judge passed=true → そのまま返す（regenerated=false）
 *   - 1 回目 judge passed=null（fail-open）→ 再生成しない、生成出力を返す
 *   - 1 回目 judge passed=false → 1 回だけ再生成
 *     - 再生成失敗 → 1 回目を返す（regenerated=false、judge_passed は 1 回目の値）
 *     - 再生成成功 → 2 回目の判定結果で返す（regenerated=true）
 *
 * @param {object} parsed - parseDescribeRequest の value（{prefecture, municipality, solar_term}）
 * @param {object} env - Workers env
 * @param {object} [deps] - 依存注入
 * @param {Function} [deps.generator=callAnthropic]
 * @param {Function} [deps.judger=judgeAll]
 * @param {typeof fetch} [deps.fetchFn=fetch]
 * @returns {Promise<
 *   | {ok: true, description: string, judge_passed: boolean|null,
 *      judge_scores: object|null, regenerated: boolean, judge_error: string|null}
 *   | {ok: false, status: number, detail: string}
 * >}
 */
export async function generateAndJudge(parsed, env, deps = {}) {
  const generator = deps.generator ?? callAnthropic;
  const judger = deps.judger ?? judgeAll;
  const fetchFn = deps.fetchFn ?? fetch;

  const messagesReq = buildMessagesRequest(parsed);

  // 1 回目生成
  const gen1 = await generator(messagesReq, env.ANTHROPIC_API_KEY);
  if (!gen1.ok) {
    return { ok: false, status: gen1.status, detail: gen1.detail };
  }

  // 1 回目 judge
  const judge1 = await judger({
    description: gen1.description,
    prefecture: parsed.prefecture,
    municipality: parsed.municipality,
    solarTerm: parsed.solar_term,
    env,
    fetchFn,
  });

  // passed=true: そのまま返す
  if (judge1.passed === true) {
    return {
      ok: true,
      description: gen1.description,
      judge_passed: true,
      judge_scores: judge1.scores,
      judge_deductions: judge1.deductions,
      regenerated: false,
      judge_error: null,
    };
  }

  // passed=null: fail-open（再生成しない）
  if (judge1.passed === null) {
    return {
      ok: true,
      description: gen1.description,
      judge_passed: null,
      judge_scores: null,
      judge_deductions: judge1.deductions ?? {},
      regenerated: false,
      judge_error: judge1.error,
    };
  }

  // passed=false: 1 回だけ再生成。
  // Plan E (6.4d): judge1 の deductions を整形して generator に渡し、
  // 「同じ失敗を繰り返さない」よう Haiku に文脈を伝える。
  const feedback = formatDeductionsForFeedback(judge1.deductions);
  const messagesReq2 = buildMessagesRequest({ ...parsed, regenerationFeedback: feedback });
  const gen2 = await generator(messagesReq2, env.ANTHROPIC_API_KEY);
  if (!gen2.ok) {
    // 再生成エラー → 1 回目を返す（採用試行は 1 回のままなので regenerated=false）
    return {
      ok: true,
      description: gen1.description,
      judge_passed: false,
      judge_scores: judge1.scores,
      judge_deductions: judge1.deductions,
      regenerated: false,
      judge_error: null,
    };
  }

  const judge2 = await judger({
    description: gen2.description,
    prefecture: parsed.prefecture,
    municipality: parsed.municipality,
    solarTerm: parsed.solar_term,
    env,
    fetchFn,
  });

  return {
    ok: true,
    description: gen2.description,
    judge_passed: judge2.passed,
    judge_scores: judge2.scores,
    judge_deductions: judge2.deductions,
    regenerated: true,
    judge_error: judge2.error,
  };
}
