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
