/**
 * テレメトリ entry の生成・trace_id 発行・サンプリング判定（Plan I）。
 * 純粋関数のみ。副作用（localStorage 書込）は storage.js が担当。
 *
 * Plan I（2026-05-11）でスキーマを刷新。Plan E〜H の 4 軸 critic_* と solar_term は
 * 全廃し、Faithfulness 1 軸の faithfulness_score / out_of_kb_terms に置き換えた。
 * Wikipedia 抜粋の長さや、抜粋転載フォールバックの有無も記録する。
 */

/**
 * UUID v4 を生成する。crypto.randomUUID() が使える環境を前提とする。
 *
 * @returns {string}
 */
export function generateTraceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * テレメトリ entry を組み立てる（生成直後）。Plan I 新スキーマ。
 *
 * @param {object} args
 * @param {string} args.trace_id
 * @param {string} args.muni_code
 * @param {string} args.description
 * @param {number} args.ts_generated
 * @param {number|null} [args.faithfulness_score]  Faithfulness 軸の 1-5 スコア
 * @param {string[]|null} [args.out_of_kb_terms]   抜粋にない固有名詞リスト
 * @param {boolean|null} [args.judge_passed]
 * @param {boolean} [args.regenerated]
 * @param {boolean} [args.fallback_to_extract]    抜粋転載へフォールバックしたか
 * @param {boolean} [args.no_wikipedia]            Wikipedia 抜粋が取得できず Generator を呼ばなかったか
 * @param {number|null} [args.wikipedia_extract_length]
 * @param {string|null} [args.judge_error]
 * @param {string|null} [args.generator_model]
 * @param {string|null} [args.judge_model]
 * @returns {object}
 */
export function buildTelemetryEntry(args) {
  return {
    trace_id: args.trace_id,
    muni_code: args.muni_code,
    description: args.description,
    ts_generated: args.ts_generated,

    // Plan I: Faithfulness 1 軸の評価結果（キャッシュヒット呼出は null）
    faithfulness_score: args.faithfulness_score ?? null,
    out_of_kb_terms: args.out_of_kb_terms ?? null,
    judge_passed: args.judge_passed ?? null,
    regenerated: args.regenerated ?? false,
    fallback_to_extract: args.fallback_to_extract ?? false,
    no_wikipedia: args.no_wikipedia ?? false,
    wikipedia_extract_length: args.wikipedia_extract_length ?? null,
    judge_error: args.judge_error ?? null,

    // モデル ID（Plan I も Nova Pro 維持）
    generator_model: args.generator_model ?? null,
    judge_model: args.judge_model ?? null,

    // Issue #38: Wikidata 構造化属性の取得結果サイズ
    wikidata_attributes_length: args.wikidata_attributes_length ?? null,

    // Issue #52 シャドウ運用: 決定論 Judge の並行結果（記録専用、本決定は judge_passed）
    deterministic_score: args.deterministic_score ?? null,
    deterministic_passed: args.deterministic_passed ?? null,
    deterministic_out_of_kb_terms: args.deterministic_out_of_kb_terms ?? null,

    // 暗黙シグナル
    ts_displayed: null,
    ts_left: null,
    dwell_ms: null,
    re_visited_count: 0,

    // 明示シグナル（任意）
    user_rating: null,
    user_comment: null,
  };
}

/**
 * Issue #17: 👍 / 👎 のトグル遷移を決める純粋関数。
 * 同じボタンを再タップしたら null（取り消し）に戻し、別のボタンなら切り替える。
 *
 * @param {'up'|'down'|null} current - 現在の user_rating
 * @param {'up'|'down'} clicked - 押されたボタン
 * @returns {'up'|'down'|null} 次の user_rating
 */
export function nextRating(current, clicked) {
  return current === clicked ? null : clicked;
}

/**
 * サンプリング判定。
 *
 * @param {number} sampleRate - 0.0 〜 1.0
 * @returns {boolean}
 */
export function shouldSample(sampleRate) {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0.0) return false;
  return Math.random() < sampleRate;
}

/**
 * Issue #17: 👍 / 👎 クリック時にやるべきことを決める純粋関数。
 *
 * 👍 / 👎 は明示フィードバックで貴重なため、サンプリングで間引かず常に記録する。
 * そのためサンプリング外（trace_id 未発行）でクリックされたら、新しい trace を
 * 発行してエントリを積む必要がある（needNewTrace=true）。有効な説明文が出ていない
 * （記事なし・生成失敗・切替直後）ときは記録対象が無いので無視する。
 *
 * @param {object} args
 * @param {boolean} args.hasTrace        - 現在 trace_id を保持しているか
 * @param {boolean} args.hasDescription  - 有効な説明文が表示中か（muni_code と本文が揃っているか）
 * @param {'up'|'down'|null} args.currentRating - 現在の user_rating
 * @param {'up'|'down'} args.clicked      - 押されたボタン
 * @returns {{ needNewTrace: boolean, userRating: ('up'|'down'|null) } | null}
 *   無視する場合は null。記録する場合は trace 発行要否と次の user_rating を返す。
 */
export function planRatingClick({ hasTrace, hasDescription, currentRating, clicked }) {
  if (!hasDescription) return null;
  return {
    needNewTrace: !hasTrace,
    userRating: nextRating(currentRating, clicked),
  };
}
