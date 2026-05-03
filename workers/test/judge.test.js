import { describe, it, expect } from 'vitest';
import {
  JUDGE_MODEL,
  parseJudgeResponse,
  aggregateScores,
  callJudge,
  judgeAll,
} from '../src/judge.js';

const SAMPLE_PARAMS = {
  // 121 字（120〜180 の範囲内）
  description:
    '相模原市緑区は、神奈川県北部の山岳地帯に位置します。津久井湖と相模湖を抱え、蛭ヶ岳（神奈川県最高峰）が西部にそびえる丹沢山地の一部です。江戸期は甲州街道の小原宿や与瀬宿が置かれ、養蚕業や林業が栄えました。清明の頃は津久井湖でヤマザクラが見頃。',
  prefecture: '神奈川県',
  municipality: '相模原市緑区',
  solarTerm: '05',
  wikipediaExtract: '相模原市緑区は、相模原市を構成する3行政区のうちの一つである。',
};

// テスト用に内容に依らず Sonnet 風の応答を返すヘルパ
function makeFetchFn(responder) {
  return async (url, options) => responder(url, options);
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

describe('JUDGE_MODEL', () => {
  it('Sonnet 4.6 が指定されている', () => {
    expect(JUDGE_MODEL).toContain('sonnet');
    expect(JUDGE_MODEL).toContain('4-6');
  });
});

describe('parseJudgeResponse', () => {
  it('正常な JSON 文字列から {score, deductions, notes} を返す', () => {
    const text = '{"deductions": ["a", "b"], "score": 4, "notes": "ok"}';
    expect(parseJudgeResponse(text)).toEqual({
      deductions: ['a', 'b'],
      score: 4,
      notes: 'ok',
    });
  });

  it('前後に説明文が付いていても JSON 部分だけ抽出する', () => {
    const text =
      'はい、評価します。\n{"deductions": [], "score": 5, "notes": "perfect"}\n以上です。';
    expect(parseJudgeResponse(text)).toEqual({
      deductions: [],
      score: 5,
      notes: 'perfect',
    });
  });

  it('JSON パース失敗時は null', () => {
    expect(parseJudgeResponse('これは JSON ではない')).toBeNull();
    expect(parseJudgeResponse('{score: 5,}')).toBeNull(); // 不正 JSON
  });

  it('score フィールドが欠落していたら null', () => {
    const text = '{"deductions": [], "notes": "x"}';
    expect(parseJudgeResponse(text)).toBeNull();
  });

  it('score が範囲外（0, 6, 文字列）だと null', () => {
    expect(parseJudgeResponse('{"score": 0, "deductions": [], "notes": ""}')).toBeNull();
    expect(parseJudgeResponse('{"score": 6, "deductions": [], "notes": ""}')).toBeNull();
    expect(parseJudgeResponse('{"score": "5", "deductions": [], "notes": ""}')).toBeNull();
  });

  it('deductions が配列でないと null', () => {
    const text = '{"score": 5, "deductions": "not-array", "notes": ""}';
    expect(parseJudgeResponse(text)).toBeNull();
  });
});

describe('aggregateScores', () => {
  const ds = (s) => ({ score: s, deductions: [], notes: '' });

  it('全軸 score>=4 なら passed=true', () => {
    const result = aggregateScores({
      accuracy: ds(5),
      specificity: ds(4),
      season_fit: ds(5),
      density: ds(4),
    });
    expect(result.passed).toBe(true);
    expect(result.scores).toEqual({ accuracy: 5, specificity: 4, season_fit: 5, density: 4 });
  });

  it('1 軸が 3 点だと passed=false', () => {
    const result = aggregateScores({
      accuracy: ds(5),
      specificity: ds(3),
      season_fit: ds(5),
      density: ds(5),
    });
    expect(result.passed).toBe(false);
    expect(result.scores.specificity).toBe(3);
  });

  it('1 軸が score=null（パース失敗）だと passed=null（fail-open）', () => {
    const result = aggregateScores({
      accuracy: ds(5),
      specificity: { score: null, deductions: [], notes: '' },
      season_fit: ds(5),
      density: ds(5),
    });
    expect(result.passed).toBeNull();
  });

  it('全軸 score=4 ぴったりでも passed=true', () => {
    const result = aggregateScores({
      accuracy: ds(4),
      specificity: ds(4),
      season_fit: ds(4),
      density: ds(4),
    });
    expect(result.passed).toBe(true);
  });
});

describe('callJudge', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-test' };

  it('正常レスポンスから {score, deductions, notes} を返す', async () => {
    const fetchFn = makeFetchFn(async (_url, _options) => {
      return jsonResponse({
        content: [{ type: 'text', text: '{"deductions": [], "score": 5, "notes": "ok"}' }],
      });
    });
    const result = await callJudge('accuracy', SAMPLE_PARAMS, env, fetchFn);
    expect(result.score).toBe(5);
    expect(result.deductions).toEqual([]);
    expect(result.notes).toBe('ok');
  });

  it('429 → 1 回リトライで成功すれば結果を返す', async () => {
    let calls = 0;
    const fetchFn = makeFetchFn(async () => {
      calls++;
      if (calls === 1) {
        return new Response('rate limit', { status: 429 });
      }
      return jsonResponse({
        content: [{ type: 'text', text: '{"deductions": [], "score": 4, "notes": "retried"}' }],
      });
    });
    const sleepFn = async () => {}; // 即時 resolve（テスト高速化）
    const result = await callJudge('accuracy', SAMPLE_PARAMS, env, fetchFn, sleepFn);
    expect(calls).toBe(2);
    expect(result.score).toBe(4);
  });

  it('429 → リトライも失敗なら score=null（fail-open フラグ）', async () => {
    let calls = 0;
    const fetchFn = makeFetchFn(async () => {
      calls++;
      return new Response('rate limit', { status: 429 });
    });
    const sleepFn = async () => {};
    const result = await callJudge('accuracy', SAMPLE_PARAMS, env, fetchFn, sleepFn);
    expect(calls).toBe(2);
    expect(result.score).toBeNull();
    expect(Array.isArray(result.deductions)).toBe(true);
  });
});

describe('judgeAll', () => {
  const env = { ANTHROPIC_API_KEY: 'sk-test' };

  function makeJudgeRunner(scoreByAxis) {
    return async (axis, _params, _env) => ({
      score: scoreByAxis[axis] ?? null,
      deductions: [],
      notes: '',
    });
  }

  it('description が 119 字（120 未満）なら早期リターン passed=false, lengthOk=false', async () => {
    const result = await judgeAll({
      description: 'あ'.repeat(119),
      prefecture: SAMPLE_PARAMS.prefecture,
      municipality: SAMPLE_PARAMS.municipality,
      solarTerm: SAMPLE_PARAMS.solarTerm,
      env,
      wikipediaFetcher: async () => null,
      judgeRunner: makeJudgeRunner({ accuracy: 5, specificity: 5, season_fit: 5, density: 5 }),
    });
    expect(result.passed).toBe(false);
    expect(result.lengthOk).toBe(false);
    expect(result.scores).toBeNull();
  });

  it('description が 181 字（180 超）なら早期リターン passed=false, lengthOk=false', async () => {
    const result = await judgeAll({
      description: 'あ'.repeat(181),
      prefecture: SAMPLE_PARAMS.prefecture,
      municipality: SAMPLE_PARAMS.municipality,
      solarTerm: SAMPLE_PARAMS.solarTerm,
      env,
      wikipediaFetcher: async () => null,
      judgeRunner: makeJudgeRunner({ accuracy: 5, specificity: 5, season_fit: 5, density: 5 }),
    });
    expect(result.passed).toBe(false);
    expect(result.lengthOk).toBe(false);
  });

  it('全軸合格 + 文字数 OK → passed=true、Wikipedia は軸 1 にだけ渡る', async () => {
    let factualityWikiSeen = null;
    const judgeRunner = async (axis, params) => {
      if (axis === 'accuracy') factualityWikiSeen = params.wikipediaExtract;
      return { score: 5, deductions: [], notes: '' };
    };
    const result = await judgeAll({
      description: SAMPLE_PARAMS.description, // 100字超 200字未満
      prefecture: SAMPLE_PARAMS.prefecture,
      municipality: SAMPLE_PARAMS.municipality,
      solarTerm: SAMPLE_PARAMS.solarTerm,
      env,
      wikipediaFetcher: async () => '相模原市緑区は、相模原市を構成する3行政区のうちの一つである。',
      judgeRunner,
    });
    expect(result.passed).toBe(true);
    expect(result.lengthOk).toBe(true);
    expect(result.scores).toEqual({ accuracy: 5, specificity: 5, season_fit: 5, density: 5 });
    expect(factualityWikiSeen).toContain('相模原市を構成する3行政区');
  });

  it('1 軸 NG → passed=false、scores と deductions は返る', async () => {
    const result = await judgeAll({
      description: SAMPLE_PARAMS.description,
      prefecture: SAMPLE_PARAMS.prefecture,
      municipality: SAMPLE_PARAMS.municipality,
      solarTerm: SAMPLE_PARAMS.solarTerm,
      env,
      wikipediaFetcher: async () => null,
      judgeRunner: makeJudgeRunner({ accuracy: 2, specificity: 5, season_fit: 5, density: 5 }),
    });
    expect(result.passed).toBe(false);
    expect(result.lengthOk).toBe(true);
    expect(result.scores.accuracy).toBe(2);
    expect(result.error).toBeNull();
  });

  it('judgeRunner 例外なら fail-open（passed=null, error 設定）', async () => {
    const result = await judgeAll({
      description: SAMPLE_PARAMS.description,
      prefecture: SAMPLE_PARAMS.prefecture,
      municipality: SAMPLE_PARAMS.municipality,
      solarTerm: SAMPLE_PARAMS.solarTerm,
      env,
      wikipediaFetcher: async () => null,
      judgeRunner: async () => {
        throw new Error('sonnet down');
      },
    });
    expect(result.passed).toBeNull();
    expect(result.lengthOk).toBe(true);
    expect(result.error).toContain('sonnet down');
  });
});
