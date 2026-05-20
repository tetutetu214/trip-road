/**
 * elevation.js のテスト。
 * - fetchElevation: 正常 / 海上 / HTTP エラー / network 例外
 * - haversineMeters: 既知の距離
 * - createElevationUpdater: altitude 優先、debounce、null 透過
 */

import { describe, it, expect } from 'vitest';
import {
  fetchElevation,
  haversineMeters,
  createElevationUpdater,
} from '../public/assets/elevation.js';

describe('fetchElevation', () => {
  it('正常応答（数値）でその値を返す', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ elevation: 25.4, hsrc: '5m（レーザ）' }),
    });
    const m = await fetchElevation(35.0, 139.0, { fetchFn });
    expect(m).toBe(25.4);
  });

  it('海上で elevation が "-----" のとき null', async () => {
    const fetchFn = async () => ({
      ok: true,
      json: async () => ({ elevation: '-----', hsrc: '---' }),
    });
    const m = await fetchElevation(35.0, 139.0, { fetchFn });
    expect(m).toBeNull();
  });

  it('HTTP 500 で null', async () => {
    const fetchFn = async () => ({ ok: false, json: async () => ({}) });
    const m = await fetchElevation(35.0, 139.0, { fetchFn });
    expect(m).toBeNull();
  });

  it('network 例外で null（CORS 失敗想定）', async () => {
    const fetchFn = async () => { throw new TypeError('NetworkError'); };
    const m = await fetchElevation(35.0, 139.0, { fetchFn });
    expect(m).toBeNull();
  });

  it('elevation が 0（海抜0m）も有効値として返す', async () => {
    const fetchFn = async () => ({ ok: true, json: async () => ({ elevation: 0 }) });
    const m = await fetchElevation(35.0, 139.0, { fetchFn });
    expect(m).toBe(0);
  });
});

describe('haversineMeters', () => {
  it('同一点は 0m', () => {
    expect(haversineMeters(35.0, 139.0, 35.0, 139.0)).toBe(0);
  });

  it('東京駅↔新宿駅は約 6km（±100m）', () => {
    // 東京駅 (35.681236, 139.767125) → 新宿駅 (35.690921, 139.700258)
    const d = haversineMeters(35.681236, 139.767125, 35.690921, 139.700258);
    expect(d).toBeGreaterThan(5900);
    expect(d).toBeLessThan(6300);
  });

  it('短距離（0.001 度緯度差≒111m）', () => {
    const d = haversineMeters(35.0, 139.0, 35.001, 139.0);
    expect(d).toBeGreaterThan(108);
    expect(d).toBeLessThan(114);
  });
});

describe('createElevationUpdater', () => {
  it('altitude が有限値なら即時 onUpdate（fetcher は呼ばれない）', async () => {
    let fetched = 0;
    const fetcher = async () => { fetched++; return 100; };
    const results = [];
    const updater = createElevationUpdater(fetcher, (m) => results.push(m));
    await updater(35.0, 139.0, 12.7);
    expect(results).toEqual([13]); // 四捨五入
    expect(fetched).toBe(0);
  });

  it('altitude null なら fetcher を呼ぶ', async () => {
    let fetched = 0;
    const fetcher = async () => { fetched++; return 88.3; };
    const results = [];
    const updater = createElevationUpdater(fetcher, (m) => results.push(m));
    await updater(35.0, 139.0, null);
    expect(fetched).toBe(1);
    expect(results).toEqual([88]);
  });

  it('5 秒以内かつ 100m 未満なら fetcher を呼ばない（debounce）', async () => {
    let fetched = 0;
    const fetcher = async () => { fetched++; return 50; };
    const results = [];
    let now = 1_000_000;
    const updater = createElevationUpdater(fetcher, (m) => results.push(m), {
      nowFn: () => now,
    });
    await updater(35.0, 139.0, null);          // 1 回目: fetched=1
    now += 1000;                                // 1 秒後
    await updater(35.00001, 139.00001, null);   // 1m 程度の移動: skip
    expect(fetched).toBe(1);
    expect(results).toEqual([50]);
  });

  it('5 秒経過していれば fetcher を呼ぶ', async () => {
    let fetched = 0;
    const fetcher = async () => { fetched++; return fetched * 10; };
    const results = [];
    let now = 1_000_000;
    const updater = createElevationUpdater(fetcher, (m) => results.push(m), {
      nowFn: () => now,
    });
    await updater(35.0, 139.0, null);
    now += 6000; // 6 秒経過
    await updater(35.00001, 139.00001, null);
    expect(fetched).toBe(2);
    expect(results).toEqual([10, 20]);
  });

  it('100m 以上移動していれば fetcher を呼ぶ', async () => {
    let fetched = 0;
    const fetcher = async () => { fetched++; return fetched * 10; };
    const results = [];
    let now = 1_000_000;
    const updater = createElevationUpdater(fetcher, (m) => results.push(m), {
      nowFn: () => now,
    });
    await updater(35.0, 139.0, null);
    now += 1000; // 1 秒のみ
    await updater(35.002, 139.0, null); // 約 222m 北
    expect(fetched).toBe(2);
    expect(results).toEqual([10, 20]);
  });

  it('fetcher が null を返したら onUpdate(null)', async () => {
    const fetcher = async () => null;
    const results = [];
    const updater = createElevationUpdater(fetcher, (m) => results.push(m));
    await updater(35.0, 139.0, null);
    expect(results).toEqual([null]);
  });

  it('altitude が NaN なら fetcher にフォールバック', async () => {
    let fetched = 0;
    const fetcher = async () => { fetched++; return 42; };
    const results = [];
    const updater = createElevationUpdater(fetcher, (m) => results.push(m));
    await updater(35.0, 139.0, NaN);
    expect(fetched).toBe(1);
    expect(results).toEqual([42]);
  });
});
