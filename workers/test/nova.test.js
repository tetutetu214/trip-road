import { describe, it, expect, vi } from 'vitest';
import {
  BEDROCK_REGION,
  NOVA_MODEL_ID,
  GENERATOR_MAX_TOKENS,
  parseDescribeRequest,
  buildGeneratorRequest,
  parseConverseResponse,
  callConverse,
  callNovaGenerator,
} from '../src/nova.js';

// ---- 純粋関数: parseDescribeRequest ----

describe('parseDescribeRequest', () => {
  it('有効な JSON を parse（muniCode 未指定なら null）', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(true);
    expect(result.value.prefecture).toBe('神奈川県');
    expect(result.value.municipality).toBe('相模原市緑区');
    expect(result.value.muniCode).toBeNull();
  });

  it('prefecture / municipality 欠落を弾く', () => {
    expect(parseDescribeRequest({ municipality: 'a' }).ok).toBe(false);
    expect(parseDescribeRequest({ prefecture: 'a' }).ok).toBe(false);
    expect(parseDescribeRequest({}).ok).toBe(false);
  });

  it('Plan I: solar_term は無視（送られてきても通過する）', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', solar_term: '07' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(true);
    expect(result.value.solar_term).toBeUndefined(); // 取り込まない
  });

  it('null / 非オブジェクトを弾く', () => {
    expect(parseDescribeRequest(null).ok).toBe(false);
    expect(parseDescribeRequest('string').ok).toBe(false);
  });

  it('#38: 有効な muniCode (5 桁) を保持', () => {
    const result = parseDescribeRequest({
      prefecture: '東京都', municipality: '千代田区', muniCode: '13101',
    });
    expect(result.ok).toBe(true);
    expect(result.value.muniCode).toBe('13101');
  });

  it('#38: 不正な muniCode は null に丸める', () => {
    expect(parseDescribeRequest({
      prefecture: '東京都', municipality: '千代田区', muniCode: 'abc',
    }).value.muniCode).toBeNull();
    expect(parseDescribeRequest({
      prefecture: '東京都', municipality: '千代田区', muniCode: '1234',
    }).value.muniCode).toBeNull();
    expect(parseDescribeRequest({
      prefecture: '東京都', municipality: '千代田区', muniCode: 13101,
    }).value.muniCode).toBeNull();
  });
});

// ---- 純粋関数: buildGeneratorRequest（Converse API 形式） ----

const SAMPLE_EXTRACT = '相模原市は、神奈川県北部に位置する政令指定都市である。';

describe('buildGeneratorRequest', () => {
  it('modelId は cross-region inference profile を使う', () => {
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      wikipediaExtract: SAMPLE_EXTRACT,
    });
    expect(req.modelId).toBe(NOVA_MODEL_ID);
    expect(req.modelId).toBe('us.amazon.nova-pro-v1:0');
  });

  it('Converse API の system / messages 配列形式に従う', () => {
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      wikipediaExtract: SAMPLE_EXTRACT,
    });
    expect(Array.isArray(req.system)).toBe(true);
    expect(req.system).toHaveLength(1);
    expect(typeof req.system[0].text).toBe('string');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(Array.isArray(req.messages[0].content)).toBe(true);
    expect(req.messages[0].content).toHaveLength(1);
    expect(typeof req.messages[0].content[0].text).toBe('string');
  });

  it('inferenceConfig.maxTokens を必ず明示する（ThrottlingException 対策）', () => {
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      wikipediaExtract: SAMPLE_EXTRACT,
    });
    expect(req.inferenceConfig).toBeDefined();
    expect(req.inferenceConfig.maxTokens).toBe(GENERATOR_MAX_TOKENS);
    expect(req.inferenceConfig.maxTokens).toBe(400);
    expect(typeof req.inferenceConfig.temperature).toBe('number');
  });

  it('Plan I + #38: SYSTEM_PROMPT に Wikipedia 抜粋と Wikidata 属性両方を素材とする旨が含まれる', () => {
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      wikipediaExtract: SAMPLE_EXTRACT,
    });
    const sys = req.system[0].text;
    expect(sys).toContain('要約者');
    expect(sys).toContain('カーナビ');
    // Issue #38: Wikipedia と Wikidata 両方を素材として扱う
    expect(sys).toContain('Wikipedia 抜粋および Wikidata 構造化属性に書かれている事実だけを使う');
    expect(sys).toContain('構成地区');
    expect(sys).toMatch(/自己放棄|謝罪/);
    // Plan I で削除した節気関連が復活していないこと
    expect(sys).not.toContain('二十四節気');
    expect(sys).not.toContain('節気');
    // 字数下限が 60 まで緩和されていること
    expect(sys).toContain('60');
  });

  it('user content に都道府県・市区町村・Wikipedia 抜粋が入る（節気は入らない）', () => {
    const req = buildGeneratorRequest({
      prefecture: '北海道',
      municipality: '函館市',
      wikipediaExtract: '函館市は、北海道渡島地方南部に位置する中核市である。',
    });
    const text = req.messages[0].content[0].text;
    expect(text).toContain('北海道');
    expect(text).toContain('函館市');
    expect(text).toContain('[Wikipedia 抜粋]');
    expect(text).toContain('北海道渡島地方南部');
    expect(text).not.toContain('二十四節気');
  });

  it('regenerationFeedback ありで「使ってはならない」指示が user content に入る', () => {
    const feedback = '抜粋に書かれていない固有名詞・事実（使ってはならない）:\n  ・タマネギ\n  ・メロン';
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '海老名市',
      wikipediaExtract: '海老名市は、神奈川県中部に位置する都市である。',
      regenerationFeedback: feedback,
    });
    const text = req.messages[0].content[0].text;
    expect(text).toContain('前回');
    expect(text).toContain('タマネギ');
    expect(text).toContain('メロン');
    expect(text).toMatch(/書き直し|書き直/);
  });

  it('regenerationFeedback が空文字 / null / undefined では指摘を入れない', () => {
    for (const fb of ['', null, undefined]) {
      const req = buildGeneratorRequest({
        prefecture: '神奈川県',
        municipality: '相模原市緑区',
        wikipediaExtract: SAMPLE_EXTRACT,
        regenerationFeedback: fb,
      });
      const text = req.messages[0].content[0].text;
      expect(text).not.toContain('前回');
    }
  });
});

// ---- 純粋関数: parseConverseResponse ----

describe('parseConverseResponse', () => {
  it('正常な Converse レスポンスから text を抽出', () => {
    const data = {
      output: { message: { role: 'assistant', content: [{ text: 'こんにちは' }] } },
      stopReason: 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    };
    expect(parseConverseResponse(data)).toBe('こんにちは');
  });

  it('content[0].text が空文字なら null', () => {
    const data = { output: { message: { content: [{ text: '' }] } } };
    expect(parseConverseResponse(data)).toBeNull();
  });

  it('output が無いと null', () => {
    expect(parseConverseResponse({})).toBeNull();
    expect(parseConverseResponse({ output: null })).toBeNull();
  });

  it('null / 非オブジェクトは null', () => {
    expect(parseConverseResponse(null)).toBeNull();
    expect(parseConverseResponse(undefined)).toBeNull();
    expect(parseConverseResponse('text')).toBeNull();
  });

  it('content 配列が空でも null', () => {
    const data = { output: { message: { content: [] } } };
    expect(parseConverseResponse(data)).toBeNull();
  });
});

// ---- 副作用関数: callConverse / callNovaGenerator ----

function makeAwsClientMock(responseFactory) {
  const calls = [];
  return {
    calls,
    awsClient: {
      fetch: vi.fn(async (url, init) => {
        calls.push({ url, init });
        return responseFactory();
      }),
    },
  };
}

const dummyEnv = {
  AWS_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  AWS_SECRET_ACCESS_KEY: 'examplesecret',
};

const sampleRequest = () =>
  buildGeneratorRequest({
    prefecture: '神奈川県',
    municipality: '横浜市中区',
    wikipediaExtract: SAMPLE_EXTRACT,
  });

describe('callConverse', () => {
  it('200 OK レスポンスから text を返す', async () => {
    const { awsClient, calls } = makeAwsClientMock(
      () =>
        new Response(
          JSON.stringify({
            output: { message: { content: [{ text: '横浜市中区の要約' }] } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const result = await callConverse(dummyEnv, sampleRequest(), { awsClient });

    expect(result.ok).toBe(true);
    expect(result.text).toBe('横浜市中区の要約');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('bedrock-runtime.us-east-1.amazonaws.com');
    expect(calls[0].url).toContain(`/model/${encodeURIComponent(NOVA_MODEL_ID)}/converse`);
    expect(calls[0].init.method).toBe('POST');
    const sentBody = JSON.parse(calls[0].init.body);
    expect(sentBody.modelId).toBeUndefined();
    expect(sentBody.system).toBeDefined();
    expect(sentBody.messages).toBeDefined();
    expect(sentBody.inferenceConfig.maxTokens).toBe(GENERATOR_MAX_TOKENS);
  });

  it('modelId が無い request を弾く', async () => {
    const result = await callConverse(dummyEnv, { system: [], messages: [] }, {});
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it('4xx は ok=false でステータスと detail を返す', async () => {
    const { awsClient } = makeAwsClientMock(
      () => new Response('AccessDenied: missing bedrock:InvokeModel', { status: 403 })
    );
    const result = await callConverse(dummyEnv, sampleRequest(), { awsClient });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.detail).toContain('Bedrock error');
    expect(result.detail).toContain('AccessDenied');
  });

  it('5xx も ok=false で返す', async () => {
    const { awsClient } = makeAwsClientMock(
      () => new Response('upstream timeout', { status: 503 })
    );
    const result = await callConverse(dummyEnv, sampleRequest(), { awsClient });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it('JSON が壊れていれば 502', async () => {
    const { awsClient } = makeAwsClientMock(
      () =>
        new Response('not a json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const result = await callConverse(dummyEnv, sampleRequest(), { awsClient });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
  });

  it('text が空ならコンテンツなしとして 502', async () => {
    const { awsClient } = makeAwsClientMock(
      () =>
        new Response(JSON.stringify({ output: { message: { content: [{ text: '' }] } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    const result = await callConverse(dummyEnv, sampleRequest(), { awsClient });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.detail).toContain('empty');
  });

  it('ネットワーク例外を捕まえて status 0 で返す', async () => {
    const awsClient = {
      fetch: vi.fn(async () => {
        throw new Error('connection refused');
      }),
    };
    const result = await callConverse(dummyEnv, sampleRequest(), { awsClient });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.detail).toContain('connection refused');
  });

  it('BEDROCK_REGION が us-east-1', () => {
    expect(BEDROCK_REGION).toBe('us-east-1');
  });
});

describe('callNovaGenerator', () => {
  it('成功時は callConverse の text を description にマップ', async () => {
    const { awsClient } = makeAwsClientMock(
      () =>
        new Response(JSON.stringify({ output: { message: { content: [{ text: '小田原市の要約' }] } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const result = await callNovaGenerator(sampleRequest(), dummyEnv, { awsClient });

    expect(result.ok).toBe(true);
    expect(result.description).toBe('小田原市の要約');
  });

  it('失敗時はエラー情報をそのまま伝播', async () => {
    const { awsClient } = makeAwsClientMock(() => new Response('throttled', { status: 429 }));
    const result = await callNovaGenerator(sampleRequest(), dummyEnv, { awsClient });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.description).toBeUndefined();
  });
});
