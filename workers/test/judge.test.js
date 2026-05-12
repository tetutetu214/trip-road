import { describe, it, expect } from 'vitest';
import {
  JUDGE_MODEL,
  JUDGE_MAX_TOKENS,
  JUDGE_TEMPERATURE,
  PASS_THRESHOLD,
  parseJudgeResponse,
  callJudge,
  judgeAll,
} from '../src/judge.js';
import { NOVA_MODEL_ID } from '../src/nova.js';

const SAMPLE_PARAMS = {
  // 文字数 60-180 の許容範囲内（80 字）
  description:
    '海老名市は神奈川県中部の県央地域に位置する市です。市内には小田急線と JR 相模線が交差する海老名駅があり、県央地域の交通の要所となっています。',
  prefecture: '神奈川県',
  municipality: '海老名市',
  wikipediaExtract:
    '海老名市は、神奈川県中部の県央地域に位置する市である。神奈川県の中央部に位置する。',
};

function makeCallConverseFn(sequence) {
  let i = 0;
  const calls = [];
  const fn = async (env, request) => {
    calls.push({ env, request });
    const next = typeof sequence === 'function' ? sequence(i, request) : sequence[i++];
    if (typeof next === 'function') return next();
    return next;
  };
  fn.calls = calls;
  return fn;
}

describe('JUDGE_MODEL（Plan I）', () => {
  it('Bedrock Nova Pro の inference profile が指定されている', () => {
    expect(JUDGE_MODEL).toBe(NOVA_MODEL_ID);
    expect(JUDGE_MODEL).toBe('us.amazon.nova-pro-v1:0');
  });
  it('JUDGE_MAX_TOKENS と JUDGE_TEMPERATURE が定数として export', () => {
    expect(typeof JUDGE_MAX_TOKENS).toBe('number');
    expect(JUDGE_MAX_TOKENS).toBeGreaterThan(0);
    expect(JUDGE_TEMPERATURE).toBe(0);
  });
  it('Plan I: PASS_THRESHOLD は 4', () => {
    expect(PASS_THRESHOLD).toBe(4);
  });
});

describe('parseJudgeResponse', () => {
  it('正常な JSON 文字列から {score, out_of_kb_terms, notes} を返す', () => {
    const text = '{"out_of_kb_terms": ["タマネギ", "メロン"], "score": 2, "notes": "creative"}';
    expect(parseJudgeResponse(text)).toEqual({
      out_of_kb_terms: ['タマネギ', 'メロン'],
      score: 2,
      notes: 'creative',
    });
  });

  it('前後に説明文が付いていても JSON 部分だけ抽出する', () => {
    const text =
      'はい、評価します。\n{"out_of_kb_terms": [], "score": 5, "notes": "perfect"}\n以上です。';
    expect(parseJudgeResponse(text)).toEqual({
      out_of_kb_terms: [],
      score: 5,
      notes: 'perfect',
    });
  });

  it('JSON パース失敗時は null', () => {
    expect(parseJudgeResponse('これは JSON ではない')).toBeNull();
    expect(parseJudgeResponse('{score: 5,}')).toBeNull();
  });

  it('score フィールドが欠落していたら null', () => {
    const text = '{"out_of_kb_terms": [], "notes": "x"}';
    expect(parseJudgeResponse(text)).toBeNull();
  });

  it('score が範囲外（0, 6, 文字列）だと null', () => {
    expect(
      parseJudgeResponse('{"score": 0, "out_of_kb_terms": [], "notes": ""}'),
    ).toBeNull();
    expect(
      parseJudgeResponse('{"score": 6, "out_of_kb_terms": [], "notes": ""}'),
    ).toBeNull();
    expect(
      parseJudgeResponse('{"score": "5", "out_of_kb_terms": [], "notes": ""}'),
    ).toBeNull();
  });

  it('out_of_kb_terms が配列でないと null', () => {
    const text = '{"score": 5, "out_of_kb_terms": "not-array", "notes": ""}';
    expect(parseJudgeResponse(text)).toBeNull();
  });

  it('notes が string でないと null', () => {
    const text = '{"score": 5, "out_of_kb_terms": [], "notes": null}';
    expect(parseJudgeResponse(text)).toBeNull();
  });
});

describe('callJudge（Plan I: Faithfulness 1 軸）', () => {
  const env = { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SECRET_ACCESS_KEY: 'examplesecret' };

  it('正常レスポンスから {score, out_of_kb_terms, notes} を返す', async () => {
    const callConverseFn = makeCallConverseFn([
      { ok: true, text: '{"out_of_kb_terms": [], "score": 5, "notes": "ok"}' },
    ]);
    const result = await callJudge(SAMPLE_PARAMS, env, callConverseFn);
    expect(result.score).toBe(5);
    expect(result.out_of_kb_terms).toEqual([]);
    expect(result.notes).toBe('ok');
  });

  it('callConverse に渡す request は modelId / system / messages / inferenceConfig を持つ Converse 形式', async () => {
    const callConverseFn = makeCallConverseFn([
      { ok: true, text: '{"score":5,"out_of_kb_terms":[],"notes":""}' },
    ]);
    await callJudge(SAMPLE_PARAMS, env, callConverseFn);
    const sentRequest = callConverseFn.calls[0].request;
    expect(sentRequest.modelId).toBe(JUDGE_MODEL);
    expect(Array.isArray(sentRequest.system)).toBe(true);
    expect(sentRequest.system[0].text).toContain('校閲者');
    expect(Array.isArray(sentRequest.messages)).toBe(true);
    expect(sentRequest.messages[0].role).toBe('user');
    expect(Array.isArray(sentRequest.messages[0].content)).toBe(true);
    expect(typeof sentRequest.messages[0].content[0].text).toBe('string');
    expect(sentRequest.inferenceConfig.maxTokens).toBe(JUDGE_MAX_TOKENS);
    expect(sentRequest.inferenceConfig.temperature).toBe(0);
  });

  it('429 → 1 回リトライで成功すれば結果を返す', async () => {
    const callConverseFn = makeCallConverseFn([
      { ok: false, status: 429, detail: 'rate limit' },
      { ok: true, text: '{"out_of_kb_terms": [], "score": 4, "notes": "retried"}' },
    ]);
    const sleepFn = async () => {};
    const result = await callJudge(SAMPLE_PARAMS, env, callConverseFn, sleepFn);
    expect(callConverseFn.calls).toHaveLength(2);
    expect(result.score).toBe(4);
  });

  it('429 → リトライも失敗なら score=null（fail-open）', async () => {
    const callConverseFn = makeCallConverseFn([
      { ok: false, status: 429, detail: 'rate limit' },
      { ok: false, status: 429, detail: 'rate limit' },
    ]);
    const sleepFn = async () => {};
    const result = await callJudge(SAMPLE_PARAMS, env, callConverseFn, sleepFn);
    expect(callConverseFn.calls).toHaveLength(2);
    expect(result.score).toBeNull();
    expect(Array.isArray(result.out_of_kb_terms)).toBe(true);
  });

  it('5xx もリトライ対象', async () => {
    const callConverseFn = makeCallConverseFn([
      { ok: false, status: 503, detail: 'unavailable' },
      { ok: true, text: '{"score":5,"out_of_kb_terms":[],"notes":""}' },
    ]);
    const sleepFn = async () => {};
    const result = await callJudge(SAMPLE_PARAMS, env, callConverseFn, sleepFn);
    expect(result.score).toBe(5);
  });

  it('400（429 以外の 4xx）はリトライしない、即 fail-open', async () => {
    const callConverseFn = makeCallConverseFn([
      { ok: false, status: 400, detail: 'bad request' },
    ]);
    const sleepFn = async () => {};
    const result = await callJudge(SAMPLE_PARAMS, env, callConverseFn, sleepFn);
    expect(callConverseFn.calls).toHaveLength(1);
    expect(result.score).toBeNull();
    expect(result.notes).toContain('400');
  });

  it('JSON パース不能な text なら score=null', async () => {
    const callConverseFn = makeCallConverseFn([
      { ok: true, text: '何も JSON が含まれていない応答' },
    ]);
    const result = await callJudge(SAMPLE_PARAMS, env, callConverseFn);
    expect(result.score).toBeNull();
    expect(result.notes).toBe('parse failed');
  });
});

describe('judgeAll', () => {
  const env = { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SECRET_ACCESS_KEY: 'examplesecret' };

  it('description が 59 字（60 未満）なら早期リターン passed=false, lengthOk=false', async () => {
    const result = await judgeAll({
      description: 'あ'.repeat(59),
      prefecture: SAMPLE_PARAMS.prefecture,
      municipality: SAMPLE_PARAMS.municipality,
      wikipediaExtract: SAMPLE_PARAMS.wikipediaExtract,
      env,
      judgeRunner: async () => ({ score: 5, out_of_kb_terms: [], notes: '' }),
    });
    expect(result.passed).toBe(false);
    expect(result.lengthOk).toBe(false);
    expect(result.score).toBeNull();
  });

  it('description が 181 字（180 超）なら早期リターン passed=false, lengthOk=false', async () => {
    const result = await judgeAll({
      description: 'あ'.repeat(181),
      prefecture: SAMPLE_PARAMS.prefecture,
      municipality: SAMPLE_PARAMS.municipality,
      wikipediaExtract: SAMPLE_PARAMS.wikipediaExtract,
      env,
      judgeRunner: async () => ({ score: 5, out_of_kb_terms: [], notes: '' }),
    });
    expect(result.passed).toBe(false);
    expect(result.lengthOk).toBe(false);
  });

  it('score=5 + 文字数 OK → passed=true', async () => {
    const result = await judgeAll({
      ...SAMPLE_PARAMS,
      env,
      judgeRunner: async () => ({ score: 5, out_of_kb_terms: [], notes: '' }),
    });
    expect(result.passed).toBe(true);
    expect(result.lengthOk).toBe(true);
    expect(result.score).toBe(5);
    expect(result.out_of_kb_terms).toEqual([]);
  });

  it('score=4 → passed=true（境界、抜粋外 1 個までは許容）', async () => {
    const result = await judgeAll({
      ...SAMPLE_PARAMS,
      env,
      judgeRunner: async () => ({ score: 4, out_of_kb_terms: ['x'], notes: '' }),
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBe(4);
  });

  it('score=3 → passed=false', async () => {
    const result = await judgeAll({
      ...SAMPLE_PARAMS,
      env,
      judgeRunner: async () => ({ score: 3, out_of_kb_terms: ['a', 'b'], notes: '' }),
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBe(3);
    expect(result.out_of_kb_terms).toEqual(['a', 'b']);
  });

  it('score=null → passed=null（fail-open）', async () => {
    const result = await judgeAll({
      ...SAMPLE_PARAMS,
      env,
      judgeRunner: async () => ({ score: null, out_of_kb_terms: [], notes: 'parse failed' }),
    });
    expect(result.passed).toBeNull();
    expect(result.score).toBeNull();
    expect(result.error).toBe('parse failed');
  });

  it('wikipediaExtract が空文字 → passed=null（想定外、fail-open）', async () => {
    const result = await judgeAll({
      ...SAMPLE_PARAMS,
      wikipediaExtract: '',
      env,
      judgeRunner: async () => ({ score: 5, out_of_kb_terms: [], notes: '' }),
    });
    expect(result.passed).toBeNull();
    expect(result.error).toBe('wikipedia_extract_missing');
  });

  it('judgeRunner 例外なら fail-open（passed=null, error 設定）', async () => {
    const result = await judgeAll({
      ...SAMPLE_PARAMS,
      env,
      judgeRunner: async () => {
        throw new Error('nova down');
      },
    });
    expect(result.passed).toBeNull();
    expect(result.lengthOk).toBe(true);
    expect(result.error).toContain('nova down');
  });
});
