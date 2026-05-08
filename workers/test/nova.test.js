import { describe, it, expect, vi } from 'vitest';
import {
  BEDROCK_REGION,
  NOVA_MODEL_ID,
  GENERATOR_MAX_TOKENS,
  solarTermToJa,
  parseDescribeRequest,
  buildGeneratorRequest,
  parseConverseResponse,
  callConverse,
  callNovaGenerator,
} from '../src/nova.js';

// ---- 純粋関数: solarTermToJa / parseDescribeRequest ----

describe('solarTermToJa', () => {
  it('"01" を 立春 に変換', () => {
    expect(solarTermToJa('01')).toBe('立春');
  });
  it('"22" を 冬至 に変換', () => {
    expect(solarTermToJa('22')).toBe('冬至');
  });
  it('未知の値は undefined', () => {
    expect(solarTermToJa('25')).toBeUndefined();
    expect(solarTermToJa('1')).toBeUndefined(); // ゼロ詰めなし
    expect(solarTermToJa('spring')).toBeUndefined();
  });
});

describe('parseDescribeRequest', () => {
  it('有効な JSON を parse', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', solar_term: '07' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(body);
  });

  it('prefecture / municipality / solar_term 欠落を弾く', () => {
    expect(parseDescribeRequest({ municipality: 'a', solar_term: '07' }).ok).toBe(false);
    expect(parseDescribeRequest({ prefecture: 'a', solar_term: '07' }).ok).toBe(false);
    expect(parseDescribeRequest({ prefecture: 'a', municipality: 'b' }).ok).toBe(false);
  });

  it('無効な solar_term を弾く', () => {
    const body = { prefecture: 'a', municipality: 'b', solar_term: '25' };
    expect(parseDescribeRequest(body).ok).toBe(false);
  });

  it('null / 非オブジェクトを弾く', () => {
    expect(parseDescribeRequest(null).ok).toBe(false);
    expect(parseDescribeRequest('string').ok).toBe(false);
  });
});

// ---- 純粋関数: buildGeneratorRequest（Converse API 形式） ----

describe('buildGeneratorRequest', () => {
  it('modelId は cross-region inference profile を使う', () => {
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      solar_term: '07',
    });
    expect(req.modelId).toBe(NOVA_MODEL_ID);
    expect(req.modelId).toBe('us.amazon.nova-pro-v1:0');
  });

  it('Converse API の system / messages 配列形式に従う', () => {
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      solar_term: '07',
    });
    // system は配列、要素は { text }
    expect(Array.isArray(req.system)).toBe(true);
    expect(req.system).toHaveLength(1);
    expect(typeof req.system[0].text).toBe('string');
    // messages も配列、content も配列
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
      solar_term: '07',
    });
    expect(req.inferenceConfig).toBeDefined();
    expect(req.inferenceConfig.maxTokens).toBe(GENERATOR_MAX_TOKENS);
    expect(req.inferenceConfig.maxTokens).toBe(400);
    expect(typeof req.inferenceConfig.temperature).toBe('number');
  });

  it('system prompt に G-1 の緩和方針が引き継がれている', () => {
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      solar_term: '05',
    });
    const sys = req.system[0].text;
    expect(sys).toContain('カーナビ');
    expect(sys).toContain('120〜180字');
    expect(sys).toContain('直接矛盾しない範囲');
    expect(sys).toContain('地理常識');
    // G-1 で削除した over-refusal フレーズが復活していないこと
    expect(sys).not.toContain('確信があるものだけ書く。曖昧な記憶で捻り出さない。情報量より正確さ');
    // 自己放棄禁止
    expect(sys).toContain('これ以上の詳述は控えます');
    expect(sys).toMatch(/自己放棄|謝罪/);
  });

  it('user content に節気名・番号・期間（period）を含める', () => {
    const req = buildGeneratorRequest({
      prefecture: '北海道',
      municipality: '函館市',
      solar_term: '22',
    });
    const text = req.messages[0].content[0].text;
    expect(text).toContain('北海道');
    expect(text).toContain('函館市');
    expect(text).toContain('冬至');
    expect(text).toContain('22');
    expect(text).toContain('12月22日頃');
    expect(text).toContain('小寒前');
  });

  it('wikipediaExtract ありで [Wikipedia 抜粋] セクションが入る', () => {
    const extract = '相模原市は、神奈川県北部に位置する政令指定都市である。';
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      solar_term: '05',
      wikipediaExtract: extract,
    });
    const text = req.messages[0].content[0].text;
    expect(text).toContain('[Wikipedia 抜粋]');
    expect(text).toContain('政令指定都市');
  });

  it('wikipediaExtract が空文字 / null / undefined のときはセクションを入れない', () => {
    for (const ext of ['', null, undefined]) {
      const req = buildGeneratorRequest({
        prefecture: '神奈川県',
        municipality: '相模原市緑区',
        solar_term: '05',
        wikipediaExtract: ext,
      });
      const text = req.messages[0].content[0].text;
      expect(text).not.toContain('[Wikipedia 抜粋]');
    }
  });

  it('regenerationFeedback ありで前回指摘 + 書き直し指示が入る', () => {
    const feedback = '- 具体性:\n  ・桜が美しい（汎用）';
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      solar_term: '05',
      regenerationFeedback: feedback,
    });
    const text = req.messages[0].content[0].text;
    expect(text).toContain('前回');
    expect(text).toContain('指摘');
    expect(text).toContain('桜が美しい（汎用）');
    expect(text).toMatch(/書き直し|書き直/);
  });

  it('regenerationFeedback が空文字 / null / undefined では指摘を入れない', () => {
    for (const fb of ['', null, undefined]) {
      const req = buildGeneratorRequest({
        prefecture: '神奈川県',
        municipality: '相模原市緑区',
        solar_term: '05',
        regenerationFeedback: fb,
      });
      const text = req.messages[0].content[0].text;
      expect(text).not.toContain('指摘');
    }
  });

  it('wikipediaExtract と regenerationFeedback の両方ありで両方とも入る', () => {
    const extract = '海老名市は、神奈川県中部に位置する都市である。';
    const feedback = '- 事実正確性:\n  ・相模川と中津川に挟まれた（誤認）';
    const req = buildGeneratorRequest({
      prefecture: '神奈川県',
      municipality: '海老名市',
      solar_term: '06',
      wikipediaExtract: extract,
      regenerationFeedback: feedback,
    });
    const text = req.messages[0].content[0].text;
    expect(text).toContain('[Wikipedia 抜粋]');
    expect(text).toContain('神奈川県中部');
    expect(text).toContain('相模川と中津川に挟まれた（誤認）');
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

/**
 * aws4fetch をバイパスする AwsClient モック。
 * fetch の URL / init を記録して assertion に使えるようにする。
 */
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

describe('callConverse', () => {
  it('200 OK レスポンスから text を返す', async () => {
    const { awsClient, calls } = makeAwsClientMock(
      () =>
        new Response(
          JSON.stringify({
            output: { message: { content: [{ text: '横浜市中区の解説' }] } },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    );

    const result = await callConverse(
      dummyEnv,
      buildGeneratorRequest({
        prefecture: '神奈川県',
        municipality: '横浜市中区',
        solar_term: '07',
      }),
      { awsClient }
    );

    expect(result.ok).toBe(true);
    expect(result.text).toBe('横浜市中区の解説');
    expect(calls).toHaveLength(1);
    // URL に modelId が URL エンコードされて入る（":" → "%3A"）
    expect(calls[0].url).toContain('bedrock-runtime.us-east-1.amazonaws.com');
    expect(calls[0].url).toContain(`/model/${encodeURIComponent(NOVA_MODEL_ID)}/converse`);
    expect(calls[0].init.method).toBe('POST');
    // body から modelId は除外されている（URL path に転記したので）
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
    const result = await callConverse(
      dummyEnv,
      buildGeneratorRequest({
        prefecture: 'a',
        municipality: 'b',
        solar_term: '07',
      }),
      { awsClient }
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.detail).toContain('Bedrock error');
    expect(result.detail).toContain('AccessDenied');
  });

  it('5xx も ok=false で返す', async () => {
    const { awsClient } = makeAwsClientMock(
      () => new Response('upstream timeout', { status: 503 })
    );
    const result = await callConverse(
      dummyEnv,
      buildGeneratorRequest({
        prefecture: 'a',
        municipality: 'b',
        solar_term: '07',
      }),
      { awsClient }
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it('JSON が壊れていれば 502', async () => {
    const { awsClient } = makeAwsClientMock(
      () => new Response('not a json', { status: 200, headers: { 'Content-Type': 'application/json' } })
    );
    const result = await callConverse(
      dummyEnv,
      buildGeneratorRequest({
        prefecture: 'a',
        municipality: 'b',
        solar_term: '07',
      }),
      { awsClient }
    );
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
    const result = await callConverse(
      dummyEnv,
      buildGeneratorRequest({
        prefecture: 'a',
        municipality: 'b',
        solar_term: '07',
      }),
      { awsClient }
    );
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
    const result = await callConverse(
      dummyEnv,
      buildGeneratorRequest({
        prefecture: 'a',
        municipality: 'b',
        solar_term: '07',
      }),
      { awsClient }
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.detail).toContain('connection refused');
  });

  it('BEDROCK_REGION が us-east-1', () => {
    // ベストプラクティス確認用、リージョン固定
    expect(BEDROCK_REGION).toBe('us-east-1');
  });
});

describe('callNovaGenerator', () => {
  it('成功時は callConverse の text を description にマップ', async () => {
    const { awsClient } = makeAwsClientMock(
      () =>
        new Response(JSON.stringify({ output: { message: { content: [{ text: '小田原市の解説' }] } } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );

    const result = await callNovaGenerator(
      buildGeneratorRequest({
        prefecture: '神奈川県',
        municipality: '小田原市',
        solar_term: '14',
      }),
      dummyEnv,
      { awsClient }
    );

    expect(result.ok).toBe(true);
    expect(result.description).toBe('小田原市の解説');
  });

  it('失敗時はエラー情報をそのまま伝播', async () => {
    const { awsClient } = makeAwsClientMock(
      () => new Response('throttled', { status: 429 })
    );
    const result = await callNovaGenerator(
      buildGeneratorRequest({
        prefecture: 'a',
        municipality: 'b',
        solar_term: '07',
      }),
      dummyEnv,
      { awsClient }
    );
    expect(result.ok).toBe(false);
    expect(result.status).toBe(429);
    expect(result.description).toBeUndefined();
  });
});
