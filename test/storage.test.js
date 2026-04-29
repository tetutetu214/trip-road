import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadState,
  savePassword,
  getPassword,
  clearPassword,
  markVisited,
  getCachedDescription,
  setCachedDescription,
  appendTrack,
  getVisitedCount,
  appendTelemetry,
  updateTelemetry,
  getTelemetryBatch,
  getTelemetryCount,
  clearTelemetryBatch,
  exportTelemetryAsJson,
} from '../public/assets/storage.js';

// localStorage のメモリモック
beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (key) => (store[key] ?? null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; },
    clear: () => { Object.keys(store).forEach(k => delete store[k]); },
    get length() { return Object.keys(store).length; },
    key: (i) => Object.keys(store)[i] ?? null,
  };
});

describe('password helpers', () => {
  it('savePassword / getPassword / clearPassword', () => {
    expect(getPassword()).toBeNull();
    savePassword('secret');
    expect(getPassword()).toBe('secret');
    clearPassword();
    expect(getPassword()).toBeNull();
  });
});

describe('visited helpers', () => {
  it('markVisited で新しい市町村が登録される', () => {
    expect(getVisitedCount()).toBe(0);
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(getVisitedCount()).toBe(1);
    const state = loadState();
    expect(state.visited['14151'].name).toBe('相模原市緑区');
    expect(state.visited['14151'].prefecture).toBe('神奈川県');
    expect(state.visited['14151'].firstVisit).toBeDefined();
  });

  it('同じ市町村を再訪問してもカウント増えない', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(getVisitedCount()).toBe(1);
  });
});

describe('description cache', () => {
  it('setCachedDescription / getCachedDescription', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(getCachedDescription('14151', 'spring')).toBeNull();
    setCachedDescription('14151', 'spring', '緑区は…');
    expect(getCachedDescription('14151', 'spring')).toBe('緑区は…');
    // 違う季節はまだ null
    expect(getCachedDescription('14151', 'summer')).toBeNull();
  });
});

describe('track', () => {
  it('appendTrack で座標が追加される', () => {
    appendTrack(35.681, 139.767);
    appendTrack(35.682, 139.768);
    const state = loadState();
    expect(state.track).toHaveLength(2);
    expect(state.track[0].lat).toBe(35.681);
    expect(state.track[1].lon).toBe(139.768);
    expect(state.track[0].ts).toBeDefined();
  });
});

describe('telemetry helpers', () => {
  it('appendTelemetry / getTelemetryCount で件数を追跡', () => {
    expect(getTelemetryCount()).toBe(0);
    appendTelemetry({ trace_id: 'a', muni_code: '11210' });
    appendTelemetry({ trace_id: 'b', muni_code: '11211' });
    expect(getTelemetryCount()).toBe(2);
  });

  it('updateTelemetry で trace_id 指定の entry を部分更新', () => {
    appendTelemetry({ trace_id: 'a', dwell_ms: null });
    updateTelemetry('a', { dwell_ms: 30000, ts_left: 1745000099000 });
    const batch = getTelemetryBatch(10);
    expect(batch[0].dwell_ms).toBe(30000);
    expect(batch[0].ts_left).toBe(1745000099000);
  });

  it('updateTelemetry で存在しない trace_id は副作用なし', () => {
    appendTelemetry({ trace_id: 'a', dwell_ms: null });
    updateTelemetry('not-exist', { dwell_ms: 99 });
    const batch = getTelemetryBatch(10);
    expect(batch[0].dwell_ms).toBeNull();
  });

  it('getTelemetryBatch で max N 件取得', () => {
    for (let i = 0; i < 5; i++) appendTelemetry({ trace_id: `t${i}` });
    const batch = getTelemetryBatch(3);
    expect(batch).toHaveLength(3);
    expect(batch[0].trace_id).toBe('t0');
    expect(batch[2].trace_id).toBe('t2');
  });

  it('clearTelemetryBatch で trace_id 配列の entry を削除', () => {
    appendTelemetry({ trace_id: 'a' });
    appendTelemetry({ trace_id: 'b' });
    appendTelemetry({ trace_id: 'c' });
    clearTelemetryBatch(['a', 'c']);
    expect(getTelemetryCount()).toBe(1);
    expect(getTelemetryBatch(10)[0].trace_id).toBe('b');
  });

  it('exportTelemetryAsJson で全 entry を JSON 文字列で取得', () => {
    appendTelemetry({ trace_id: 'a', muni_code: '11210' });
    const json = exportTelemetryAsJson();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].trace_id).toBe('a');
  });
});
