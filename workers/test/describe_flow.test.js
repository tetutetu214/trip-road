import { describe, it, expect } from 'vitest';
import { generateAndJudge, formatDeductionsForFeedback } from '../src/describe_flow.js';

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

// F-1.3b: 既存テストでは Wikipedia 取得をモックして null を返させる。
// 実 fetch を呼ばずに decribe_flow の本筋の振る舞いだけを検証するため。
const NULL_WIKIPEDIA_FETCHER = async () => null;

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

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher: NULL_WIKIPEDIA_FETCHER });

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

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher: NULL_WIKIPEDIA_FETCHER });

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

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher: NULL_WIKIPEDIA_FETCHER });

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

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher: NULL_WIKIPEDIA_FETCHER });

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

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher: NULL_WIKIPEDIA_FETCHER });

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

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher: NULL_WIKIPEDIA_FETCHER });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.detail).toContain('haiku down');
  });

  it('Plan E (6.4d): 1 回目 NG → 2 回目生成の messagesReq に judge1 deductions が feedback として含まれる', async () => {
    const judge1Deductions = {
      accuracy: [],
      specificity: ['桜が美しい（汎用）', '自然豊かな景観（汎用）'],
      season_fit: [],
      density: ['淡紅色に染まり（情緒）'],
    };
    const generatorCalls = [];
    const generator = async (messagesReq) => {
      generatorCalls.push(messagesReq);
      const idx = generatorCalls.length;
      return {
        ok: true,
        description: idx === 1 ? SAMPLE_DESC_1 : SAMPLE_DESC_2,
      };
    };
    const judger = makeJudger([
      { passed: false, lengthOk: true, scores: FAILING_SCORES, deductions: judge1Deductions, error: null },
      { passed: true, lengthOk: true, scores: PASSING_SCORES, deductions: {}, error: null },
    ]);

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher: NULL_WIKIPEDIA_FETCHER });

    expect(result.ok).toBe(true);
    expect(result.regenerated).toBe(true);
    expect(generatorCalls).toHaveLength(2);

    // 1 回目はフィードバックなし（プレーンな user content）
    expect(generatorCalls[0].messages[0].content).not.toContain('指摘');

    // 2 回目は judge1 の deductions が feedback として含まれている
    const secondUserContent = generatorCalls[1].messages[0].content;
    expect(secondUserContent).toContain('指摘');
    expect(secondUserContent).toContain('桜が美しい（汎用）');
    expect(secondUserContent).toContain('自然豊かな景観（汎用）');
    expect(secondUserContent).toContain('淡紅色に染まり（情緒）');
    expect(secondUserContent).toMatch(/書き直し|書き直/);
  });

  it('F-1.3b: Wikipedia 抜粋ありの場合、1 回目 generator の messagesReq に [Wikipedia 抜粋] セクションが入る', async () => {
    const extract = '相模原市は、神奈川県北部に位置する政令指定都市である。';
    const wikipediaFetcher = async () => extract;
    const generatorCalls = [];
    const generator = async (messagesReq) => {
      generatorCalls.push(messagesReq);
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => ({
      passed: true,
      lengthOk: true,
      scores: PASSING_SCORES,
      deductions: {},
      error: null,
    });

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher });

    expect(result.ok).toBe(true);
    expect(generatorCalls).toHaveLength(1);
    const userContent = generatorCalls[0].messages[0].content;
    expect(userContent).toContain('[Wikipedia 抜粋]');
    expect(userContent).toContain('政令指定都市');
  });

  it('F-1.3b: Wikipedia 抜粋 null の場合、generator の messagesReq に [Wikipedia 抜粋] セクションが入らない', async () => {
    const generatorCalls = [];
    const generator = async (messagesReq) => {
      generatorCalls.push(messagesReq);
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => ({
      passed: true,
      lengthOk: true,
      scores: PASSING_SCORES,
      deductions: {},
      error: null,
    });

    await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: NULL_WIKIPEDIA_FETCHER,
    });

    const userContent = generatorCalls[0].messages[0].content;
    expect(userContent).not.toContain('[Wikipedia 抜粋]');
  });

  it('F-1.3b: 再生成時も 1 回目と同じ Wikipedia 抜粋が 2 回目 generator の messagesReq に含まれる（再取得しない）', async () => {
    const extract = '海老名市は、神奈川県中部に位置する都市である。';
    let fetchCalls = 0;
    const wikipediaFetcher = async () => {
      fetchCalls++;
      return extract;
    };
    const generatorCalls = [];
    const generator = async (messagesReq) => {
      generatorCalls.push(messagesReq);
      return {
        ok: true,
        description: generatorCalls.length === 1 ? SAMPLE_DESC_1 : SAMPLE_DESC_2,
      };
    };
    const judger = makeJudger([
      {
        passed: false,
        lengthOk: true,
        scores: FAILING_SCORES,
        deductions: { accuracy: ['河川名の誤認'] },
        error: null,
      },
      { passed: true, lengthOk: true, scores: PASSING_SCORES, deductions: {}, error: null },
    ]);

    await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher });

    expect(fetchCalls).toBe(1); // 再生成時は再取得しない
    expect(generatorCalls).toHaveLength(2);
    // 1 回目に Wikipedia 抜粋
    expect(generatorCalls[0].messages[0].content).toContain('[Wikipedia 抜粋]');
    expect(generatorCalls[0].messages[0].content).toContain('神奈川県中部');
    // 2 回目にも同じ Wikipedia 抜粋 + 再生成 feedback
    expect(generatorCalls[1].messages[0].content).toContain('[Wikipedia 抜粋]');
    expect(generatorCalls[1].messages[0].content).toContain('神奈川県中部');
    expect(generatorCalls[1].messages[0].content).toContain('指摘');
  });

  it('F-1.3b: wikipediaFetcher が例外を投げた場合、null 扱いで継続する', async () => {
    const wikipediaFetcher = async () => {
      throw new Error('wikipedia API down');
    };
    let genCalls = 0;
    const generator = async (messagesReq) => {
      genCalls++;
      // 抜粋セクションが入っていないことも検証
      expect(messagesReq.messages[0].content).not.toContain('[Wikipedia 抜粋]');
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => ({
      passed: true,
      lengthOk: true,
      scores: PASSING_SCORES,
      deductions: {},
      error: null,
    });

    const result = await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher });

    expect(result.ok).toBe(true);
    expect(genCalls).toBe(1);
  });
});

describe('formatDeductionsForFeedback', () => {
  it('null / undefined / 空オブジェクトは空文字', () => {
    expect(formatDeductionsForFeedback(null)).toBe('');
    expect(formatDeductionsForFeedback(undefined)).toBe('');
    expect(formatDeductionsForFeedback({})).toBe('');
  });

  it('全軸の配列が空でも空文字（注入しない）', () => {
    expect(
      formatDeductionsForFeedback({
        accuracy: [],
        specificity: [],
        season_fit: [],
        density: [],
      }),
    ).toBe('');
  });

  it('1 軸だけ減点ありなら、その軸のラベルと項目が出る', () => {
    const text = formatDeductionsForFeedback({
      accuracy: [],
      specificity: ['桜が美しい（汎用）'],
      season_fit: [],
      density: [],
    });
    expect(text).toContain('具体性');
    expect(text).toContain('・桜が美しい（汎用）');
    expect(text).not.toContain('事実正確性');
    expect(text).not.toContain('情報密度');
  });

  it('複数軸 + 複数項目を箇条書きで列挙', () => {
    const text = formatDeductionsForFeedback({
      accuracy: ['江戸期の城下町（記載なし）'],
      specificity: ['桜が美しい（汎用）', '自然豊かな景観（汎用）'],
      season_fit: [],
      density: ['淡紅色に染まり（情緒）'],
    });
    expect(text).toContain('事実正確性');
    expect(text).toContain('・江戸期の城下町（記載なし）');
    expect(text).toContain('具体性');
    expect(text).toContain('・桜が美しい（汎用）');
    expect(text).toContain('・自然豊かな景観（汎用）');
    expect(text).toContain('情報密度');
    expect(text).toContain('・淡紅色に染まり（情緒）');
    // 季節整合は減点ゼロなのでラベルが出ない
    expect(text).not.toContain('季節整合');
  });

  it('未知のキーが混入しても落ちない（生キーをラベルとして使う）', () => {
    const text = formatDeductionsForFeedback({
      mystery_axis: ['unknown deduction'],
    });
    expect(text).toContain('mystery_axis');
    expect(text).toContain('・unknown deduction');
  });
});
