import { describe, it, expect } from 'vitest';
import {
  DEFAULT_QID_MAP_URL,
  USER_AGENT,
  CACHE_TTL_SECONDS,
  buildQidMapCacheKey,
  lookupQid,
  fetchQidMap,
  getCachedQidMap,
} from '../src/qid_map.js';

describe('定数', () => {
  it('デフォルト URL は Cloudflare Pages 配信オリジン', () => {
    expect(DEFAULT_QID_MAP_URL).toBe('https://trip-road.tetutetu214.com/wikidata_qid.json');
  });
  it('User-Agent は trip-road を含む', () => {
    expect(USER_AGENT).toContain('trip-road');
  });
  it('Cache TTL は 30 日（秒）', () => {
    expect(CACHE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});

describe('buildQidMapCacheKey', () => {
  it('全体取得用の固定 URL を返す', () => {
    const req = buildQidMapCacheKey();
    expect(req).toBeInstanceOf(Request);
    expect(req.url).toBe('https://wikidata-qid-cache.internal/v1/all');
  });
});

describe('lookupQid', () => {
  const map = {
    '13101': {
      qid: 'Q214051',
      label_ja: '千代田区',
      lat: 35.6939,
      lon: 139.7536,
      wikipedia_ja: '千代田区',
    },
  };

  it('存在するコードはエントリ返す', () => {
    expect(lookupQid(map, '13101').qid).toBe('Q214051');
  });
  it('存在しないコードは null', () => {
    expect(lookupQid(map, '99999')).toBeNull();
  });
  it('null map は null', () => {
    expect(lookupQid(null, '13101')).toBeNull();
  });
  it('qid フィールド欠落のエントリは null', () => {
    const broken = { '13101': { label_ja: 'x' } };
    expect(lookupQid(broken, '13101')).toBeNull();
  });
});

describe('fetchQidMap', () => {
  it('200 OK で JSON を返す', async () => {
    const data = { '13101': { qid: 'Q214051' } };
    const fetchFn = async () => ({
      ok: true,
      status: 200,
      json: async () => data,
    });
    const out = await fetchQidMap({ fetchFn });
    expect(out).toEqual(data);
  });

  it('4xx で throw', async () => {
    const fetchFn = async () => ({ ok: false, status: 404, json: async () => null });
    await expect(fetchQidMap({ fetchFn })).rejects.toThrow(/404/);
  });

  it('User-Agent ヘッダが送られる', async () => {
    let captured;
    const fetchFn = async (_url, init) => {
      captured = init;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    await fetchQidMap({ fetchFn });
    expect(captured.headers['User-Agent']).toContain('trip-road');
  });
});

describe('getCachedQidMap', () => {
  function makeCacheStore() {
    const store = new Map();
    return {
      match: async (req) => store.get(req.url),
      put: async (req, res) => { store.set(req.url, res); },
      _store: store,
    };
  }

  it('in-memory cache にあれば fetch を呼ばずに返す', async () => {
    const ref = { value: { '13101': { qid: 'Q214051' } } };
    let fetchCalled = false;
    const fetchFn = async () => { fetchCalled = true; throw new Error('should not call'); };
    const out = await getCachedQidMap({ fetchFn, inMemoryRef: ref, cacheStore: makeCacheStore() });
    expect(fetchCalled).toBe(false);
    expect(out['13101'].qid).toBe('Q214051');
  });

  it('Cache API hit → in-memory に転記される', async () => {
    const cacheStore = makeCacheStore();
    const data = { '13101': { qid: 'Q214051' } };
    await cacheStore.put(
      buildQidMapCacheKey(),
      new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const ref = { value: null };
    const fetchFn = async () => { throw new Error('should not call'); };
    const out = await getCachedQidMap({ fetchFn, cacheStore, inMemoryRef: ref });
    expect(out['13101'].qid).toBe('Q214051');
    expect(ref.value['13101'].qid).toBe('Q214051');
  });

  it('Cache miss → fetch + Cache put + in-memory 転記', async () => {
    const cacheStore = makeCacheStore();
    const ref = { value: null };
    const data = { '13101': { qid: 'Q214051' } };
    const fetchFn = async () => ({ ok: true, status: 200, json: async () => data });
    const out = await getCachedQidMap({ fetchFn, cacheStore, inMemoryRef: ref });
    expect(out['13101'].qid).toBe('Q214051');
    expect(cacheStore._store.size).toBe(1);
    expect(ref.value['13101'].qid).toBe('Q214051');
  });

  it('fetch 失敗時は null（throw しない、in-memory にも乗らない）', async () => {
    const ref = { value: null };
    const fetchFn = async () => ({ ok: false, status: 500, json: async () => null });
    const out = await getCachedQidMap({ fetchFn, cacheStore: makeCacheStore(), inMemoryRef: ref });
    expect(out).toBeNull();
    expect(ref.value).toBeNull();
  });
});
