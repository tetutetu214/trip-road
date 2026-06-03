import { describe, it, expect } from 'vitest';
import { lightPresetForHour } from '../public/assets/map.js';

// メイン地図の Standard スタイルの時間連動（lightPreset 自動切替）の判定ロジック。
// 端末時刻の「時」を受け取り、明け方/昼/夕暮れ/夜のどれを返すかを保証する。
describe('lightPresetForHour', () => {
  it('深夜（5時より前）は night を返す', () => {
    expect(lightPresetForHour(0)).toBe('night');
    expect(lightPresetForHour(4)).toBe('night');
  });

  it('明け方（5時〜7時）は dawn を返す', () => {
    expect(lightPresetForHour(5)).toBe('dawn');
    expect(lightPresetForHour(7)).toBe('dawn');
  });

  it('日中（8時〜16時）は day を返す', () => {
    expect(lightPresetForHour(8)).toBe('day');
    expect(lightPresetForHour(16)).toBe('day');
  });

  it('夕暮れ（17時〜18時）は dusk を返す', () => {
    expect(lightPresetForHour(17)).toBe('dusk');
    expect(lightPresetForHour(18)).toBe('dusk');
  });

  it('夜（19時以降）は night を返す', () => {
    expect(lightPresetForHour(19)).toBe('night');
    expect(lightPresetForHour(23)).toBe('night');
  });
});
