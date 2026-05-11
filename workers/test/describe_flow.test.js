import { describe, it, expect } from 'vitest';
import {
  generateAndJudge,
  formatOutOfKbTermsForFeedback,
  truncateExtractForFallback,
} from '../src/describe_flow.js';
import { NOVA_MODEL_ID } from '../src/nova.js';
import { JUDGE_MODEL } from '../src/judge.js';

const PARSED = {
  prefecture: '神奈川県',
  municipality: '海老名市',
};

const ENV = { AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE', AWS_SECRET_ACCESS_KEY: 'examplesecret' };

const SAMPLE_EXTRACT =
  '海老名市は、神奈川県中部の県央地域に位置する市である。神奈川県の中央部に位置する。';
const SAMPLE_DESC_1 =
  '海老名市は神奈川県中部の県央地域に位置する市です。市内には小田急線と JR 相模線が交差する海老名駅があります。';
const SAMPLE_DESC_2 =
  '海老名市は神奈川県中部の県央地域に位置する市で、神奈川県の中央部に位置します。県央地域の中心都市の一つです。';

const PASSING = { passed: true, lengthOk: true, score: 5, out_of_kb_terms: [], error: null };
const FAILING = {
  passed: false,
  lengthOk: true,
  score: 3,
  out_of_kb_terms: ['小田急線', 'JR 相模線', '海老名駅'],
  error: null,
};

const EXTRACT_FETCHER = async () => SAMPLE_EXTRACT;
const NULL_FETCHER = async () => null;

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
  it('Wikipedia 抜粋なし → Generator を呼ばずに no_wikipedia=true で早期リターン', async () => {
    let genCalls = 0;
    let judgeCalls = 0;
    const generator = async () => {
      genCalls++;
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => {
      judgeCalls++;
      return PASSING;
    };

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: NULL_FETCHER,
    });

    expect(result.ok).toBe(true);
    expect(result.no_wikipedia).toBe(true);
    expect(result.description).toBe('');
    expect(result.judge_passed).toBeNull();
    expect(result.faithfulness_score).toBeNull();
    expect(result.out_of_kb_terms).toEqual([]);
    expect(result.fallback_to_extract).toBe(false);
    expect(result.wikipedia_extract_length).toBe(0);
    expect(result.generator_model).toBe(NOVA_MODEL_ID);
    expect(result.judge_model).toBe(JUDGE_MODEL);
    expect(genCalls).toBe(0); // Generator は呼ばれない
    expect(judgeCalls).toBe(0);
  });

  it('1 回目で合格 → regenerated=false、fallback_to_extract=false', async () => {
    let genCalls = 0;
    let judgeCalls = 0;
    const generator = async () => {
      genCalls++;
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => {
      judgeCalls++;
      return PASSING;
    };

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: EXTRACT_FETCHER,
    });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_1);
    expect(result.no_wikipedia).toBeUndefined();
    expect(result.judge_passed).toBe(true);
    expect(result.faithfulness_score).toBe(5);
    expect(result.out_of_kb_terms).toEqual([]);
    expect(result.regenerated).toBe(false);
    expect(result.fallback_to_extract).toBe(false);
    expect(result.wikipedia_extract_length).toBe(SAMPLE_EXTRACT.length);
    expect(result.judge_error).toBeNull();
    expect(result.generator_model).toBe(NOVA_MODEL_ID);
    expect(result.judge_model).toBe(JUDGE_MODEL);
    expect(genCalls).toBe(1);
    expect(judgeCalls).toBe(1);
  });

  it('1 回目 NG → 2 回目合格 → regenerated=true', async () => {
    const generator = makeGenerator([
      { ok: true, description: SAMPLE_DESC_1 },
      { ok: true, description: SAMPLE_DESC_2 },
    ]);
    const judger = makeJudger([FAILING, PASSING]);

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: EXTRACT_FETCHER,
    });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_2);
    expect(result.judge_passed).toBe(true);
    expect(result.regenerated).toBe(true);
    expect(result.fallback_to_extract).toBe(false);
  });

  it('1 回目 NG → 2 回目も NG → Wikipedia 抜粋転載へフォールバック', async () => {
    const generator = makeGenerator([
      { ok: true, description: SAMPLE_DESC_1 },
      { ok: true, description: SAMPLE_DESC_2 },
    ]);
    const judger = makeJudger([FAILING, FAILING]);

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: EXTRACT_FETCHER,
    });

    expect(result.ok).toBe(true);
    expect(result.fallback_to_extract).toBe(true);
    // 抜粋がそのまま description として返る（180 字以下のため）
    expect(result.description).toBe(SAMPLE_EXTRACT);
    expect(result.regenerated).toBe(true);
    expect(result.judge_passed).toBe(false);
  });

  it('Judge 障害（fail-open）→ 再生成しない、1 回目の生成出力をそのまま返す', async () => {
    let genCalls = 0;
    const generator = async () => {
      genCalls++;
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => ({
      passed: null,
      lengthOk: true,
      score: null,
      out_of_kb_terms: [],
      error: 'nova down',
    });

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: EXTRACT_FETCHER,
    });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_1);
    expect(result.judge_passed).toBeNull();
    expect(result.regenerated).toBe(false);
    expect(result.fallback_to_extract).toBe(false);
    expect(result.judge_error).toBe('nova down');
    expect(genCalls).toBe(1);
  });

  it('1 回目 NG → 再生成 generator がエラー → 1 回目を返す（regenerated=false）', async () => {
    const generator = makeGenerator([
      { ok: true, description: SAMPLE_DESC_1 },
      { ok: false, status: 502, detail: 'nova error' },
    ]);
    const judger = makeJudger([FAILING]);

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: EXTRACT_FETCHER,
    });

    expect(result.ok).toBe(true);
    expect(result.description).toBe(SAMPLE_DESC_1);
    expect(result.judge_passed).toBe(false);
    expect(result.regenerated).toBe(false);
    expect(result.fallback_to_extract).toBe(false);
  });

  it('1 回目の生成自体がエラー → ok=false', async () => {
    const generator = async () => ({ ok: false, status: 502, detail: 'nova down' });
    const judger = async () => {
      throw new Error('should not be called');
    };

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: EXTRACT_FETCHER,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.detail).toContain('nova down');
  });

  it('再生成プロンプトに 1 回目 judge の out_of_kb_terms が feedback として入る', async () => {
    const generatorCalls = [];
    const generator = async (messagesReq) => {
      generatorCalls.push(messagesReq);
      return {
        ok: true,
        description: generatorCalls.length === 1 ? SAMPLE_DESC_1 : SAMPLE_DESC_2,
      };
    };
    const judger = makeJudger([FAILING, PASSING]);

    await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher: EXTRACT_FETCHER,
    });

    expect(generatorCalls).toHaveLength(2);
    expect(generatorCalls[0].messages[0].content[0].text).not.toContain('前回');
    const secondUserContent = generatorCalls[1].messages[0].content[0].text;
    expect(secondUserContent).toContain('前回');
    expect(secondUserContent).toContain('小田急線');
    expect(secondUserContent).toContain('JR 相模線');
    expect(secondUserContent).toContain('海老名駅');
    expect(secondUserContent).toMatch(/書き直し|書き直/);
  });

  it('再生成時も同じ Wikipedia 抜粋を再利用（再取得しない）', async () => {
    let fetchCalls = 0;
    const wikipediaFetcher = async () => {
      fetchCalls++;
      return SAMPLE_EXTRACT;
    };
    const generator = makeGenerator([
      { ok: true, description: SAMPLE_DESC_1 },
      { ok: true, description: SAMPLE_DESC_2 },
    ]);
    const judger = makeJudger([FAILING, PASSING]);

    await generateAndJudge(PARSED, ENV, { generator, judger, wikipediaFetcher });
    expect(fetchCalls).toBe(1);
  });

  it('wikipediaFetcher が例外を投げた場合、no_wikipedia=true で早期リターン', async () => {
    const wikipediaFetcher = async () => {
      throw new Error('wikipedia API down');
    };
    let genCalls = 0;
    const generator = async () => {
      genCalls++;
      return { ok: true, description: SAMPLE_DESC_1 };
    };
    const judger = async () => PASSING;

    const result = await generateAndJudge(PARSED, ENV, {
      generator,
      judger,
      wikipediaFetcher,
    });

    expect(result.ok).toBe(true);
    expect(result.no_wikipedia).toBe(true);
    expect(genCalls).toBe(0);
  });
});

describe('formatOutOfKbTermsForFeedback', () => {
  it('null / undefined / 空配列は空文字', () => {
    expect(formatOutOfKbTermsForFeedback(null)).toBe('');
    expect(formatOutOfKbTermsForFeedback(undefined)).toBe('');
    expect(formatOutOfKbTermsForFeedback([])).toBe('');
  });

  it('1 個でも入っていればヘッダ + 箇条書きで返す', () => {
    const text = formatOutOfKbTermsForFeedback(['タマネギ']);
    expect(text).toContain('抜粋に書かれていない');
    expect(text).toContain('・タマネギ');
  });

  it('複数項目を箇条書きで列挙', () => {
    const text = formatOutOfKbTermsForFeedback(['タマネギ', 'メロン', '小田急線']);
    expect(text).toContain('・タマネギ');
    expect(text).toContain('・メロン');
    expect(text).toContain('・小田急線');
  });
});

describe('truncateExtractForFallback', () => {
  it('空文字 / null / undefined は空文字', () => {
    expect(truncateExtractForFallback('')).toBe('');
    expect(truncateExtractForFallback(null)).toBe('');
    expect(truncateExtractForFallback(undefined)).toBe('');
  });

  it('180 字以下ならそのまま返す', () => {
    const short = 'あ'.repeat(150);
    expect(truncateExtractForFallback(short)).toBe(short);
  });

  it('60 字未満の抜粋もそのまま返す（無理に膨らませない）', () => {
    const veryShort = 'あ'.repeat(30);
    expect(truncateExtractForFallback(veryShort)).toBe(veryShort);
  });

  it('180 字超なら句点単位で切って 60-180 字に収める', () => {
    const text =
      '海老名市は神奈川県中部に位置する市です。' + // 19 字 + 1 句点 = 20 字
      '小田急線と JR 相模線が交差する海老名駅があります。' + // 約 28 字
      '人口は約 14 万人で、県央地域の中心都市の一つです。' + // 約 26 字
      '商業施設が集積し、ショッピングモールや劇場があります。' + // 約 25 字
      '近年は再開発が進み、駅周辺の景観が一新されました。' + // 約 26 字
      'これらにより市の魅力が高まっています。' + // 約 19 字
      '今後の発展が期待される地域です。' + // 約 16 字
      '住みやすさのランキングでも上位に入っています。'; // 約 22 字
    const result = truncateExtractForFallback(text);
    expect(result.length).toBeLessThanOrEqual(180);
    expect(result.endsWith('。')).toBe(true);
  });

  it('1 文目がすでに 180 字超なら強制的に文字数で切り詰める', () => {
    const oneLong = 'あ'.repeat(300) + '。';
    const result = truncateExtractForFallback(oneLong);
    expect(result.length).toBeLessThanOrEqual(181); // 180 + …
    expect(result.endsWith('…')).toBe(true);
  });
});
