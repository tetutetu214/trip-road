import { describe, it, expect } from 'vitest';
import {
  WIKIDATA_PROPS,
  WIKIDATA_P150_MAX,
  CACHE_TTL_SECONDS,
  USER_AGENT,
  DEFAULT_ENDPOINT,
  buildWikidataSparqlQuery,
  parseWikidataResponse,
  buildWikidataCacheKey,
  formatWikidataForPrompt,
  fetchWikidataAttributes,
  getCachedWikidataAttributes,
} from '../src/wikidata.js';

describe('定数', () => {
  it('取得プロパティは 7 個（合意済）', () => {
    expect(WIKIDATA_PROPS).toEqual(['P31', 'P138', 'P150', 'P190', 'P206', 'P706', 'P1376']);
  });
  it('構成地区の上限は 20 件', () => {
    expect(WIKIDATA_P150_MAX).toBe(20);
  });
  it('Cache TTL は 30 日（秒）', () => {
    expect(CACHE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
  it('User-Agent は trip-road を含む', () => {
    expect(USER_AGENT).toContain('trip-road');
  });
  it('Endpoint は WDQS', () => {
    expect(DEFAULT_ENDPOINT).toBe('https://query.wikidata.org/sparql');
  });
});

describe('buildWikidataSparqlQuery', () => {
  it('SELECT / VALUES / wd:<QID> を含む', () => {
    const q = buildWikidataSparqlQuery('Q214051');
    expect(q).toContain('SELECT');
    expect(q).toContain('VALUES');
    expect(q).toContain('wd:Q214051');
    expect(q).toContain('wd:P31');
    expect(q).toContain('wd:P150');
  });
  it('不正 QID は throw', () => {
    expect(() => buildWikidataSparqlQuery('DROP')).toThrow();
    expect(() => buildWikidataSparqlQuery('Q')).toThrow();
    expect(() => buildWikidataSparqlQuery('123')).toThrow();
    expect(() => buildWikidataSparqlQuery('')).toThrow();
    expect(() => buildWikidataSparqlQuery(null)).toThrow();
  });
});

describe('buildWikidataCacheKey', () => {
  it('QID が URL path に含まれるダミー Request を返す', () => {
    const req = buildWikidataCacheKey('Q214051');
    expect(req).toBeInstanceOf(Request);
    expect(req.url).toBe('https://wikidata-cache.internal/v1/Q214051');
  });
});

describe('parseWikidataResponse', () => {
  function binding(propId, propLabel, value, valueLabel) {
    return {
      prop: { value: `http://www.wikidata.org/entity/${propId}` },
      propLabel: { value: propLabel },
      value: { value },
      valueLabel: { value: valueLabel },
    };
  }

  it('千代田区風のレスポンスを構造化（P150 25 件を 20 件に切り詰め）', () => {
    const parts25 = Array.from({ length: 25 }, (_, i) => `地区${i + 1}`);
    const bindings = [
      binding('P31', '分類', 'Q1', '日本の特別区'),
      binding('P138', '名前の由来', 'Q2', '千代田'),
      ...parts25.map((label, i) => binding('P150', '直下の行政区画', `Q${100 + i}`, label)),
    ];
    const out = parseWikidataResponse({ results: { bindings } });
    expect(out.instanceOf).toEqual(['日本の特別区']);
    expect(out.namedAfter).toEqual(['千代田']);
    expect(out.partsTotal).toBe(25);
    expect(out.parts.length).toBe(20);
    expect(out.parts[0]).toBe('地区1');
    expect(out.parts[19]).toBe('地区20');
  });

  it('空レスポンスはすべて空配列 + partsTotal=0', () => {
    const out = parseWikidataResponse({ results: { bindings: [] } });
    expect(out.instanceOf).toEqual([]);
    expect(out.parts).toEqual([]);
    expect(out.partsTotal).toBe(0);
    expect(out.twinnedWith).toEqual([]);
  });

  it('Q\\d+ ラベル（label サービス失敗）の値は弾く', () => {
    const bindings = [
      binding('P31', '分類', 'Q1', '日本の市'),
      binding('P31', '分類', 'Q13220204', 'Q13220204'), // ラベル化失敗
    ];
    const out = parseWikidataResponse({ results: { bindings } });
    expect(out.instanceOf).toEqual(['日本の市']);
  });

  it('未知のプロパティは無視', () => {
    const bindings = [
      binding('P9999', '未知', 'Q1', 'unknown'),
      binding('P31', '分類', 'Q2', '日本の市'),
    ];
    const out = parseWikidataResponse({ results: { bindings } });
    expect(out.instanceOf).toEqual(['日本の市']);
  });

  it('壊れたレスポンスは安全に空を返す', () => {
    const out = parseWikidataResponse({ });
    expect(out.partsTotal).toBe(0);
    expect(out.parts).toEqual([]);
  });
});

describe('formatWikidataForPrompt', () => {
  it('全属性ありの整形', () => {
    const attrs = {
      instanceOf: ['日本の特別区'],
      namedAfter: ['千代田'],
      capitalOf: [],
      waterBodies: ['東京湾'],
      terrainFeatures: ['関東地方'],
      twinnedWith: ['ローゼンハイム'],
      parts: ['西神田', '皇居外苑'],
      partsTotal: 2,
    };
    const out = formatWikidataForPrompt(attrs);
    expect(out).toContain('種別: 日本の特別区');
    expect(out).toContain('名前の由来: 千代田');
    expect(out).toContain('隣接水域: 東京湾');
    expect(out).toContain('構成地区: 西神田, 皇居外苑');
    expect(out).not.toContain('上位行政体の中心'); // capitalOf 空なので省略
    expect(out).not.toContain('(...');
  });

  it('全属性 0 → 空文字', () => {
    const attrs = {
      instanceOf: [], namedAfter: [], capitalOf: [], waterBodies: [],
      terrainFeatures: [], twinnedWith: [], parts: [], partsTotal: 0,
    };
    expect(formatWikidataForPrompt(attrs)).toBe('');
  });

  it('parts が partsTotal より少なければ件数サフィックス', () => {
    const attrs = {
      instanceOf: [], namedAfter: [], capitalOf: [], waterBodies: [],
      terrainFeatures: [], twinnedWith: [],
      parts: ['a', 'b'], partsTotal: 25,
    };
    const out = formatWikidataForPrompt(attrs);
    expect(out).toContain('構成地区: a, b (...25件中2件)');
  });

  it('parts が全部入っていればサフィックスなし', () => {
    const attrs = {
      instanceOf: [], namedAfter: [], capitalOf: [], waterBodies: [],
      terrainFeatures: [], twinnedWith: [],
      parts: ['a', 'b'], partsTotal: 2,
    };
    const out = formatWikidataForPrompt(attrs);
    expect(out).toContain('構成地区: a, b');
    expect(out).not.toContain('(...');
  });

  it('null/undefined は空文字', () => {
    expect(formatWikidataForPrompt(null)).toBe('');
    expect(formatWikidataForPrompt(undefined)).toBe('');
  });
});

describe('fetchWikidataAttributes', () => {
  function mockResponse(status, jsonData) {
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => jsonData,
    };
  }

  it('200 OK でパース済みオブジェクトを返す', async () => {
    const fetchFn = async () => mockResponse(200, {
      results: {
        bindings: [
          {
            prop: { value: 'http://www.wikidata.org/entity/P31' },
            value: { value: 'Q1' },
            valueLabel: { value: '日本の特別区' },
          },
        ],
      },
    });
    const out = await fetchWikidataAttributes({ qid: 'Q214051', fetchFn });
    expect(out.instanceOf).toEqual(['日本の特別区']);
  });

  it('5xx 1 回 + 200 1 回 でリトライ後成功', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      if (calls === 1) return mockResponse(500, null);
      return mockResponse(200, { results: { bindings: [] } });
    };
    const out = await fetchWikidataAttributes({ qid: 'Q214051', fetchFn });
    expect(calls).toBe(2);
    expect(out).not.toBeNull();
  });

  it('5xx 連発で null（throw しない）', async () => {
    const fetchFn = async () => mockResponse(500, null);
    const out = await fetchWikidataAttributes({ qid: 'Q214051', fetchFn });
    expect(out).toBeNull();
  });

  it('4xx 即 null', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      return mockResponse(400, null);
    };
    const out = await fetchWikidataAttributes({ qid: 'Q214051', fetchFn });
    expect(out).toBeNull();
    expect(calls).toBe(1); // リトライしない
  });

  it('network error は 1 回リトライしてダメなら null', async () => {
    let calls = 0;
    const fetchFn = async () => {
      calls++;
      throw new Error('net down');
    };
    const out = await fetchWikidataAttributes({ qid: 'Q214051', fetchFn });
    expect(out).toBeNull();
    expect(calls).toBe(2);
  });

  it('不正 QID は null（throw しない）', async () => {
    const fetchFn = async () => { throw new Error('should not be called'); };
    const out = await fetchWikidataAttributes({ qid: 'INVALID', fetchFn });
    expect(out).toBeNull();
  });
});

describe('getCachedWikidataAttributes', () => {
  function makeCacheStore() {
    const store = new Map();
    return {
      match: async (req) => store.get(req.url),
      put: async (req, res) => { store.set(req.url, res); },
      _store: store,
    };
  }

  it('Cache hit なら fetch を呼ばずに返す', async () => {
    const cacheStore = makeCacheStore();
    const expected = { instanceOf: ['日本の市'] };
    await cacheStore.put(
      buildWikidataCacheKey('Q123'),
      new Response(JSON.stringify(expected), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    let fetchCalled = false;
    const fetchFn = async () => { fetchCalled = true; throw new Error('should not call'); };
    const out = await getCachedWikidataAttributes({ qid: 'Q123', fetchFn, cacheStore });
    expect(fetchCalled).toBe(false);
    expect(out.instanceOf).toEqual(['日本の市']);
  });

  it('Cache miss → fetch 成功 → Cache put される', async () => {
    const cacheStore = makeCacheStore();
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: { bindings: [
          { prop: { value: 'http://www.wikidata.org/entity/P31' },
            value: { value: 'Q1' }, valueLabel: { value: '日本の市' } },
        ] },
      }),
    });
    const out = await getCachedWikidataAttributes({ qid: 'Q123', fetchFn, cacheStore });
    expect(out.instanceOf).toEqual(['日本の市']);
    expect(cacheStore._store.size).toBe(1);
  });

  it('Cache miss → fetch null → Cache に入れない', async () => {
    const cacheStore = makeCacheStore();
    const fetchFn = async () => ({ ok: false, status: 500, json: async () => null });
    const out = await getCachedWikidataAttributes({ qid: 'Q123', fetchFn, cacheStore });
    expect(out).toBeNull();
    expect(cacheStore._store.size).toBe(0);
  });

  it('不正 QID は即 null', async () => {
    const fetchFn = async () => { throw new Error('should not call'); };
    const out = await getCachedWikidataAttributes({ qid: 'BAD', fetchFn, cacheStore: makeCacheStore() });
    expect(out).toBeNull();
  });
});
