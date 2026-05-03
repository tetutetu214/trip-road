import { describe, it, expect } from 'vitest';
import { generateAndJudge } from '../src/describe_flow.js';

const PARSED = {
  prefecture: '神奈川県',
  municipality: '相模原市緑区',
  solar_term: '05',
};

const ENV = { ANTHROPIC_API_KEY: 'sk-test' };

const SAMPLE_DESC_1 =
  '相模原市緑区は、神奈川県北部の山岳地帯に位置します。津久井湖と相模湖を抱え、蛭ヶ岳（神奈川県最高峰）が西部にそびえる丹沢山地の一部です。江戸期は甲州街道の小原宿や与瀬宿が置かれ、養蚕業や林業が栄えました。清明の頃は津久井湖でヤマザクラが見頃。';
const SAMPLE_DESC_2 =
  '相模原市緑区は丹沢山地を擁する神奈川県最大の区。津久井湖・相模湖・宮ヶ瀬湖の水源地で、蛭ヶ岳（標高1673m）は神奈川県最高峰。江戸期は甲州街道の宿場（小原宿・与瀬宿）と養蚕業で栄え、清明の頃の城山公園はヤマザクラの名所。';

const PASSING_SCORES = { accuracy: 5, specificity: 5, season_fit: 5, density: 5 };
const FAILING_SCORES = { accuracy: 5, specificity: 3, season_fit: 5, density: 5 };

function makeGenerator(sequence) {
  let i = 0;
  return async () => {
    const next = sequence[i++];
    if (typeof next === 'function') return next();
    return next;
  };
}

function makeJudger(sequence) {
  let i = 0;
  return async () => {
    const next = sequence[i++];
    if (typeof next === 'function') return next();
    return next;
  };
}

describe('generateAndJudge', () => {
  it('1 回目で合格 → regenerated=false、再生成は呼ばれない', async () => {
    let genCalls = 0;
    let judgeCalls = 0;
    const sampleDeductions = {
      accuracy: [],
      specificity: [],
      season_fit: [],
      density: [],
    };
    const generator = async () => {
      genCalls++;
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => {
      judgeCalls++;
      return {
        passed: true,
        lengthOk: true,
        scores: PASSING_SCORES,
        deductions: sampleDeductions,
        error: null,
      };
    };

    const result = await generateAndJudge(PARSED, ENV, { generator, judger });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_1);
    expect(result.judge_passed).toBe(true);
    expect(result.judge_scores).toEqual(PASSING_SCORES);
    expect(result.judge_deductions).toEqual(sampleDeductions);
    expect(result.regenerated).toBe(false);
    expect(result.judge_error).toBeNull();
    expect(genCalls).toBe(1);
    expect(judgeCalls).toBe(1);
  });

  it('1 回目 NG → 2 回目合格 → regenerated=true', async () => {
    const generator = makeGenerator([
      { ok: true, description: SAMPLE_DESC_1 },
      { ok: true, description: SAMPLE_DESC_2 },
    ]);
    const judger = makeJudger([
      { passed: false, lengthOk: true, scores: FAILING_SCORES, deductions: {}, error: null },
      { passed: true, lengthOk: true, scores: PASSING_SCORES, deductions: {}, error: null },
    ]);

    const result = await generateAndJudge(PARSED, ENV, { generator, judger });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_2); // 再生成版が返る
    expect(result.judge_passed).toBe(true);
    expect(result.judge_scores).toEqual(PASSING_SCORES);
    expect(result.regenerated).toBe(true);
    expect(result.judge_error).toBeNull();
  });

  it('1 回目 NG → 2 回目も NG → regenerated=true、判定は false で返す（採用された 2 回目の deductions が乗る）', async () => {
    const deductions2 = {
      accuracy: [],
      specificity: ['桜が美しい（汎用）'],
      season_fit: [],
      density: [],
    };
    const generator = makeGenerator([
      { ok: true, description: SAMPLE_DESC_1 },
      { ok: true, description: SAMPLE_DESC_2 },
    ]);
    const judger = makeJudger([
      { passed: false, lengthOk: true, scores: FAILING_SCORES, deductions: {}, error: null },
      { passed: false, lengthOk: true, scores: FAILING_SCORES, deductions: deductions2, error: null },
    ]);

    const result = await generateAndJudge(PARSED, ENV, { generator, judger });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_2); // NG でも 2 回目を採用（より新しい試行）
    expect(result.judge_passed).toBe(false);
    expect(result.regenerated).toBe(true);
    expect(result.judge_deductions).toEqual(deductions2); // 採用された judge2 の deductions
    expect(result.judge_error).toBeNull();
  });

  it('Sonnet 障害（fail-open）→ 再生成しない、生成出力をそのまま返す', async () => {
    let genCalls = 0;
    const generator = async () => {
      genCalls++;
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => ({
      passed: null,
      lengthOk: true,
      scores: null,
      deductions: {},
      error: 'sonnet down',
    });

    const result = await generateAndJudge(PARSED, ENV, { generator, judger });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_1);
    expect(result.judge_passed).toBeNull();
    expect(result.judge_scores).toBeNull();
    expect(result.regenerated).toBe(false);
    expect(result.judge_error).toBe('sonnet down');
    expect(genCalls).toBe(1); // 再生成しない
  });

  it('1 回目 NG → 再生成 generator がエラー → 1 回目を返す（regenerated=false）', async () => {
    const generator = makeGenerator([
      { ok: true, description: SAMPLE_DESC_1 },
      { ok: false, status: 502, detail: 'haiku error' },
    ]);
    const judger = makeJudger([
      { passed: false, lengthOk: true, scores: FAILING_SCORES, deductions: {}, error: null },
    ]);

    const result = await generateAndJudge(PARSED, ENV, { generator, judger });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_1); // 1 回目を返す
    expect(result.judge_passed).toBe(false); // 1 回目の判定を維持
    expect(result.regenerated).toBe(false); // 再生成は試したが採用していないので false
    expect(result.judge_scores).toEqual(FAILING_SCORES);
  });

  it('1 回目の生成自体がエラー → ok=false（502 系の上位応答用）', async () => {
    const generator = async () => ({ ok: false, status: 502, detail: 'haiku down' });
    const judger = async () => {
      throw new Error('should not be called');
    };

    const result = await generateAndJudge(PARSED, ENV, { generator, judger });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.detail).toContain('haiku down');
  });
});
