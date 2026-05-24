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
  getHillshadeLevel,
  setHillshadeLevel,
  enrichVisitedWithCodes,
  getUnsyncedVisitedBefore,
  markVisitedSynced,
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

describe('description cache（Plan I: 市町村ごと単一の要約）', () => {
  it('setCachedDescription / getCachedDescription', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(getCachedDescription('14151')).toBeNull();
    setCachedDescription('14151', '緑区は…');
    expect(getCachedDescription('14151')).toBe('緑区は…');
  });

  it('setCachedDescription で上書きできる', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    setCachedDescription('14151', '旧テキスト');
    setCachedDescription('14151', '新テキスト');
    expect(getCachedDescription('14151')).toBe('新テキスト');
  });

  it('markVisited なしの市町村は setCachedDescription しても無視される', () => {
    setCachedDescription('99999', 'orphan');
    expect(getCachedDescription('99999')).toBeNull();
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
});

describe('hillshade overlay (Issue #48: 3段階)', () => {
  it('初期は "off"', () => {
    expect(getHillshadeLevel()).toBe('off');
  });
  it('weak / strong / off を永続化できる', () => {
    setHillshadeLevel('weak');
    expect(getHillshadeLevel()).toBe('weak');
    setHillshadeLevel('strong');
    expect(getHillshadeLevel()).toBe('strong');
    setHillshadeLevel('off');
    expect(getHillshadeLevel()).toBe('off');
  });
  it('不正な値は "off" に正規化される', () => {
    setHillshadeLevel('weak');
    setHillshadeLevel('invalid');
    expect(getHillshadeLevel()).toBe('off');
  });
  it('他の state と独立（visited に影響しない）', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    setHillshadeLevel('strong');
    expect(getVisitedCount()).toBe(1);
    expect(getHillshadeLevel()).toBe('strong');
  });
});

describe('conquest sync helpers (Phase 13)', () => {
  const META = {
    '14151': { prefecture_code: '14', region_code: 'kanto' },
    '13101': { prefecture_code: '13', region_code: 'kanto' },
    '01101': { prefecture_code: '01', region_code: 'hokkaido' },
  };

  it('enrichVisitedWithCodes は欠けている prefectureCode / regionCode を埋める', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    const before = loadState().visited['14151'];
    // markVisited 直後は null（市町村コードのマッピングはまだ）
    expect(before.prefectureCode).toBeNull();

    const updated = enrichVisitedWithCodes(META);
    expect(updated).toBe(1);
    const after = loadState().visited['14151'];
    expect(after.prefectureCode).toBe('14');
    expect(after.regionCode).toBe('kanto');
  });

  it('既に値があるエントリは触らない', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    // 一度埋める
    enrichVisitedWithCodes(META);
    // 別マッピングで上書きしようとしても、既に値があるので変化なし
    const updated = enrichVisitedWithCodes({
      '14151': { prefecture_code: 'XX', region_code: 'YY' },
    });
    expect(updated).toBe(0);
    expect(loadState().visited['14151'].prefectureCode).toBe('14');
  });

  it('getUnsyncedVisitedBefore は前日以前で synced=false のものだけ返す', () => {
    const now = new Date(2026, 4, 24, 12, 0, 0).getTime();
    // 前日訪問の市町村
    markVisited('14151', '相模原市緑区', '神奈川県');
    // 当日訪問
    markVisited('13101', '千代田区', '東京都');

    // firstVisit を上書き
    const state = loadState();
    state.visited['14151'].firstVisit = new Date(2026, 4, 23, 12, 0, 0).toISOString();
    state.visited['13101'].firstVisit = new Date(2026, 4, 24, 9, 0, 0).toISOString();
    globalThis.localStorage.setItem('trip-road-state', JSON.stringify(state));

    enrichVisitedWithCodes(META);

    const result = getUnsyncedVisitedBefore(now);
    expect(result).toHaveLength(1);
    expect(result[0].muni_code).toBe('14151');
  });

  it('getUnsyncedVisitedBefore はマッピング未補完エントリを除外', () => {
    const now = new Date(2026, 4, 24, 12, 0, 0).getTime();
    markVisited('14151', '相模原市緑区', '神奈川県');
    const state = loadState();
    state.visited['14151'].firstVisit = new Date(2026, 4, 23, 12, 0, 0).toISOString();
    globalThis.localStorage.setItem('trip-road-state', JSON.stringify(state));
    // enrich を呼ばない → prefectureCode が null のまま
    const result = getUnsyncedVisitedBefore(now);
    expect(result).toHaveLength(0);
  });

  it('markVisitedSynced で synced=true にできる', () => {
    markVisited('14151', '相模原市緑区', '神奈川県');
    expect(loadState().visited['14151'].synced).toBe(false);
    markVisitedSynced(['14151']);
    expect(loadState().visited['14151'].synced).toBe(true);
  });

  it('markVisitedSynced 後は getUnsyncedVisitedBefore から外れる', () => {
    const now = new Date(2026, 4, 24, 12, 0, 0).getTime();
    markVisited('14151', '相模原市緑区', '神奈川県');
    const state = loadState();
    state.visited['14151'].firstVisit = new Date(2026, 4, 23, 12, 0, 0).toISOString();
    globalThis.localStorage.setItem('trip-road-state', JSON.stringify(state));
    enrichVisitedWithCodes(META);

    expect(getUnsyncedVisitedBefore(now)).toHaveLength(1);
    markVisitedSynced(['14151']);
    expect(getUnsyncedVisitedBefore(now)).toHaveLength(0);
  });
});
