/**
 * Faithfulness 軽量決定論 Judge（Issue #52 / Plan I Phase 2-2）
 *
 * 生成文から「漢字 2 文字以上」「カタカナ 3 文字以上」「数字 2 文字以上」を抽出し、
 * Wikipedia 抜粋 + Wikidata 構造化属性に substring として含まれるかを機械的に判定する。
 * LLM judge と違い、同じ入力に対して必ず同じ結果を返す。
 *
 * 形態素解析（kuromoji.js）を採用しない理由:
 *   - 辞書 19 MB が Workers の bundle size 制限（1 MB）に収まらない
 *   - CDN から runtime fetch する案は cold start で数秒のレイテンシ
 *   - 正規表現ベースの「固有名詞っぽい列」抽出で大半のハルシネーション検出はカバー可能
 *
 * シャドウ運用設計:
 *   Nova Pro Judge と並列に走らせ、結果をテレメトリに記録して一致率を観測する。
 *   Nova → 決定論への切り替えは観測後の独立タスク。
 *
 * すべて純粋関数。副作用なし、外部 fetch なし。
 */

// 漢字 2 文字以上（CJK 統合漢字 + 々）
const KANJI_RE = /[一-鿿々]{2,}/g;
// カタカナ 3 文字以上（長音符号 ー を含む）
const KATAKANA_RE = /[゠-ヿー]{3,}/g;
// 数字 2 文字以上（半角アラビア数字）
const DIGIT_RE = /\d{2,}/g;

// PASS_THRESHOLD と整合する合格しきい値（judge.js の PASS_THRESHOLD=4 と一致）
export const DETERMINISTIC_PASS_THRESHOLD = 4;

/**
 * 文字列から「固有名詞っぽい列」を抽出する。重複削除済みの配列を返す。
 *
 * 抽出対象:
 *   - 漢字 2 文字以上: "千代田", "東京都", "皇居" 等
 *   - カタカナ 3 文字以上: "バンクーバー", "ローゼンハイム" 等（"区" のような単漢字は対象外）
 *   - 数字 2 文字以上: "1947", "14", "180" 等
 *
 * ひらがなは助詞・接続詞・活用語尾が多く意味の薄い一致を生むため対象外。
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractProperNounLikeStrings(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const tokens = new Set();
  for (const re of [KANJI_RE, KATAKANA_RE, DIGIT_RE]) {
    for (const m of text.matchAll(re)) {
      tokens.add(m[0]);
    }
  }
  return Array.from(tokens);
}

/**
 * 生成文から抽出した候補のうち、kbText に substring として含まれないものを返す。
 *
 * substring 照合の意義:
 *   - "1947" が抜粋本文 "...1947 年に..." に含まれる → OK
 *   - "皇居" が抜粋 "...皇居外苑..." に含まれる → OK
 *   - "秋葉原" が抜粋に出てこなければ → out_of_kb_terms 入り
 *
 * @param {string} description - 採点対象の生成文
 * @param {string} kbText - Wikipedia 抜粋 + Wikidata 属性ブロックを結合したテキスト
 * @returns {string[]}
 */
export function findOutOfKbTerms(description, kbText) {
  const candidates = extractProperNounLikeStrings(description);
  const kb = typeof kbText === 'string' ? kbText : '';
  return candidates.filter((token) => !kb.includes(token));
}

/**
 * out_of_kb_terms の件数からスコアを決定する。
 *
 * Nova Pro Judge の 5 段階採点と整合させる:
 *   - 0 件 → 5（完全合格）
 *   - 1 件 → 4（許容範囲、PASS_THRESHOLD=4 の最下限）
 *   - 2 件 → 3（不合格、再生成対象）
 *   - 3 件 → 2
 *   - 4 件以上 → 1（直接矛盾相当）
 *
 * @param {number} count
 * @returns {number}
 */
export function scoreFromOutOfKbCount(count) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    return 1;
  }
  if (count === 0) return 5;
  if (count === 1) return 4;
  if (count === 2) return 3;
  if (count === 3) return 2;
  return 1;
}

/**
 * Faithfulness 決定論 Judge のメイン関数。
 *
 * params.wikidataPromptBlock が空文字 / 未指定なら Wikipedia 単独で評価
 * （Wikidata 取得スキップ時のフォールバック）。
 *
 * @param {object} params
 * @param {string} params.description - 採点対象の生成文
 * @param {string} params.wikipediaExtract - cleanExtract 適用済の Wikipedia 抜粋
 * @param {string} [params.wikidataPromptBlock] - formatWikidataForPrompt の出力
 * @returns {{
 *   score: number,
 *   passed: boolean,
 *   out_of_kb_terms: string[],
 *   notes: string,
 * }}
 */
export function deterministicJudge({
  description,
  wikipediaExtract,
  wikidataPromptBlock,
}) {
  if (typeof description !== 'string' || description.length === 0) {
    return {
      score: 1,
      passed: false,
      out_of_kb_terms: [],
      notes: 'empty description',
    };
  }
  const wp = typeof wikipediaExtract === 'string' ? wikipediaExtract : '';
  const wd = typeof wikidataPromptBlock === 'string' ? wikidataPromptBlock : '';
  // Wikipedia 抜粋と Wikidata 属性を改行で連結（substring 照合には影響しない）
  const kbText = wp + '\n' + wd;

  const outOfKb = findOutOfKbTerms(description, kbText);
  const score = scoreFromOutOfKbCount(outOfKb.length);
  return {
    score,
    passed: score >= DETERMINISTIC_PASS_THRESHOLD,
    out_of_kb_terms: outOfKb,
    notes: `deterministic: ${outOfKb.length} out-of-kb terms`,
  };
}
