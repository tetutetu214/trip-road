/**
 * public/assets/api.js の単体テスト（Issue #75 Phase A）。
 *
 * なぜ fetch をモックするか:
 *   api.js は最終的に本番の Cloudflare Workers API（/api/describe ほか）を叩く。
 *   本物の Workers は Bedrock Nova Pro を呼ぶため 1 リクエストごとに課金が発生し、
 *   生成・Judge・再生成を挟むと数秒のレイテンシがかかる。さらにここで検証したいのは
 *   「500 が連発したときの指数バックオフ」「401 で即時打ち切り」「タイムアウト時の AbortError」
 *   といった異常系で、これらは本物の API では意図的に再現できない（サーバ側を壊せない）。
 *   よって fetch を vi.stubGlobal で差し替え、ステータス・遅延・例外を完全に制御して
 *   api.js のリトライ/分岐ロジックそのものの振る舞いを検証する。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  fetchDescription,
  postConquests,
  getConquests,
  getMapboxToken,
  sendTelemetryBatch,
} from '../public/assets/api.js';

// 正常系の /api/describe レスポンス本体（必要なフィールドだけ持つ最小形）を作るヘルパ
function describeBody(overrides = {}) {
  return { description: '海老名市は...', ...overrides };
}

// fetch のモックレスポンスを作るヘルパ。
// jsonImpl を渡すと res.json() の挙動（成功 / parse 失敗）を差し替えられる。
function mockResponse(status, body, jsonImpl) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: jsonImpl ?? (async () => body),
  };
}

afterEach(() => {
  // fake timers / stub を毎テスト確実に元へ戻し、テスト間の汚染を防ぐ
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchDescription', () => {
  it('200 で description があれば ok:true と各フィールドのデフォルト補完を返す', async () => {
    // judge_passed 未定義→null、out_of_kb_terms が非配列→[] への補完を確認する
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        description: '海老名市は神奈川県のほぼ中央に位置する。',
        out_of_kb_terms: 'これは配列ではない',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDescription('pw', { prefecture: '神奈川県', municipality: '海老名市' });

    expect(result.ok).toBe(true);
    expect(result.description).toBe('海老名市は神奈川県のほぼ中央に位置する。');
    expect(result.judge_passed).toBeNull();
    expect(result.out_of_kb_terms).toEqual([]);
    expect(result.no_wikipedia).toBe(false);
    expect(result.regenerated).toBe(false);
  });

  it('no_wikipedia=true なら description が空文字でも成功扱いになる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, { description: '', no_wikipedia: true }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDescription('pw', { prefecture: '神奈川県', municipality: 'X市' });

    expect(result.ok).toBe(true);
    expect(result.description).toBe('');
    expect(result.no_wikipedia).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('description が空で no_wikipedia も falsy なら 4 回試行して empty_description で失敗する', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { description: '' }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchDescription('pw', { prefecture: '神奈川県', municipality: 'X市' });
    // 指数バックオフの待ち（1s + 2s + 4s）を全て進めて最終結果まで到達させる
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('empty_description');
  });

  it('401 のときは再試行せず即座に unauthorized を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDescription('pw', { prefecture: '神奈川県', municipality: 'X市' });

    expect(result).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400 で body に detail があれば detail を error に載せる', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(400, { detail: 'invalid prefecture' }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDescription('pw', { prefecture: '', municipality: 'X市' });

    expect(result).toEqual({ ok: false, status: 400, error: 'invalid prefecture' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('400 で body の JSON parse に失敗したら bad_request にフォールバックする', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(400, null, async () => {
        throw new Error('Unexpected token');
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchDescription('pw', { prefecture: '', municipality: 'X市' });

    expect(result).toEqual({ ok: false, status: 400, error: 'bad_request' });
  });

  it('500 が続くと指数バックオフ(1s/2s/4s)で計 4 回試行し upstream_error を返す', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchDescription('pw', { prefecture: '神奈川県', municipality: 'X市' });

    // 1 回目の試行直後はまだ 1 回だけ。バックオフ前は次の試行に進まないことを確認
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const result = await promise;
    expect(result).toEqual({ ok: false, status: 500, error: 'upstream_error' });
  });

  it('fetch が例外を投げ続けると status:0 で失敗する', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchDescription('pw', { prefecture: '神奈川県', municipality: 'X市' });
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
  });

  it('1 回目が 500 でも 2 回目が 200 なら途中回復して成功する', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(500, {}))
      .mockResolvedValueOnce(mockResponse(200, describeBody()));
    vi.stubGlobal('fetch', fetchMock);

    const promise = fetchDescription('pw', { prefecture: '神奈川県', municipality: '海老名市' });
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(true);
    expect(result.description).toBe('海老名市は...');
  });

  it('応答が遅いと 2 秒で judging、5 秒で regenerating を onPhaseChange に通知する', async () => {
    vi.useFakeTimers();
    // 6 秒後に解決する fetch にして、両方のフェーズ通知が先に発火するようにする
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(mockResponse(200, describeBody())), 6000);
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onPhaseChange = vi.fn();

    const promise = fetchDescription(
      'pw',
      { prefecture: '神奈川県', municipality: '海老名市' },
      { onPhaseChange },
    );

    await vi.advanceTimersByTimeAsync(2000);
    expect(onPhaseChange).toHaveBeenCalledWith('judging');
    expect(onPhaseChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(onPhaseChange).toHaveBeenCalledWith('regenerating');
    expect(onPhaseChange).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1000);
    await promise;
  });

  it('早期に成功するとタイマーがクリアされ onPhaseChange は発火しない', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, describeBody()));
    vi.stubGlobal('fetch', fetchMock);
    const onPhaseChange = vi.fn();

    const promise = fetchDescription(
      'pw',
      { prefecture: '神奈川県', municipality: '海老名市' },
      { onPhaseChange },
    );
    const result = await promise;
    // 成功後に時間を 10 秒進めても、クリア済みのタイマーは発火しない
    await vi.advanceTimersByTimeAsync(10000);

    expect(result.ok).toBe(true);
    expect(onPhaseChange).not.toHaveBeenCalled();
  });
});

describe('postConquests', () => {
  it('200 なら written/skipped を返し欠損時は 0 を補完する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { written: 3 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postConquests('pw', [{ muni_code: '14215' }]);

    expect(result).toEqual({ ok: true, written: 3, skipped: 0 });
  });

  it('401 のときは再試行せず unauthorized を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postConquests('pw', []);

    expect(result).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('非 2xx のときは再試行せず upstream_error を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(503, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postConquests('pw', []);

    expect(result).toEqual({ ok: false, status: 503, error: 'upstream_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetch が例外を投げたら再試行せず status:0 で失敗する', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const result = await postConquests('pw', []);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('getConquests', () => {
  it('200 なら items を返し、items が非配列なら空配列にする', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { items: 'not-an-array' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getConquests('pw');

    expect(result).toEqual({ ok: true, items: [] });
  });

  it('timeoutMs 経過で abort されると timeout を返す', async () => {
    vi.useFakeTimers();
    // signal の abort を監視し、aborted になったら AbortError で reject する fetch を作る
    const fetchMock = vi.fn().mockImplementation((url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = getConquests('pw', { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({ ok: false, status: 0, error: 'timeout' });
  });

  it('401 のときは unauthorized を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getConquests('pw');

    expect(result).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('非 2xx のときは upstream_error を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(500, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getConquests('pw');

    expect(result).toEqual({ ok: false, status: 500, error: 'upstream_error' });
  });
});

describe('getMapboxToken', () => {
  it('200 で token があれば ok:true と token を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, { token: 'pk.abc123' }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getMapboxToken('pw');

    expect(result).toEqual({ ok: true, token: 'pk.abc123' });
  });

  it('200 でも token が欠損していれば empty_token を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getMapboxToken('pw');

    expect(result).toEqual({ ok: false, status: 200, error: 'empty_token' });
  });

  it('timeoutMs 経過で abort されると timeout を返す', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const promise = getMapboxToken('pw', { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toEqual({ ok: false, status: 0, error: 'timeout' });
  });

  it('401 のときは unauthorized を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getMapboxToken('pw');

    expect(result).toEqual({ ok: false, status: 401, error: 'unauthorized' });
  });

  it('非 2xx のときは upstream_error を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(502, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await getMapboxToken('pw');

    expect(result).toEqual({ ok: false, status: 502, error: 'upstream_error' });
  });
});

describe('sendTelemetryBatch', () => {
  it('1 回目に失敗しても 2 秒後のリトライで成功すれば ok:true と key を返す', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockResponse(500, {}))
      .mockResolvedValueOnce(mockResponse(200, { key: 'telemetry/2026/06/10/abc.json' }));
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendTelemetryBatch('pw', [{ trace_id: 't1' }]);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true, key: 'telemetry/2026/06/10/abc.json' });
  });

  it('401 のときは再試行せず即座に unauthorized を返す', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(401, {}));
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendTelemetryBatch('pw', [{ trace_id: 't1' }]);

    expect(result).toEqual({ ok: false, status: 401, error: 'unauthorized' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('2 回とも失敗すると最後のエラーを返す', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(503, {}));
    vi.stubGlobal('fetch', fetchMock);

    const promise = sendTelemetryBatch('pw', [{ trace_id: 't1' }]);
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: false, status: 503, error: 'upstream_error' });
  });
});
