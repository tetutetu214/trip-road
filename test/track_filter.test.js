import { describe, it, expect } from 'vitest';
import { isSameLocalDay, filterTodayPoints } from '../public/assets/track_filter.js';

describe('isSameLocalDay', () => {
  it('同じ日のミリ秒タイムスタンプは true', () => {
    const a = new Date(2026, 4, 23, 9, 0, 0).getTime();
    const b = new Date(2026, 4, 23, 18, 30, 0).getTime();
    expect(isSameLocalDay(a, b)).toBe(true);
  });

  it('日付が異なれば false（前日との比較）', () => {
    const today = new Date(2026, 4, 23, 0, 30, 0).getTime();
    const yesterday = new Date(2026, 4, 22, 23, 59, 59).getTime();
    expect(isSameLocalDay(today, yesterday)).toBe(false);
  });

  it('1 年違い同日付でも false', () => {
    const a = new Date(2026, 4, 23, 12, 0, 0).getTime();
    const b = new Date(2025, 4, 23, 12, 0, 0).getTime();
    expect(isSameLocalDay(a, b)).toBe(false);
  });
});

describe('filterTodayPoints', () => {
  const now = new Date(2026, 4, 23, 12, 0, 0).getTime();

  it('今日のポイントだけを返す（順序を保つ）', () => {
    const yesterday = new Date(2026, 4, 22, 8, 0, 0).getTime();
    const todayMorning = new Date(2026, 4, 23, 7, 0, 0).getTime();
    const todayNoon = new Date(2026, 4, 23, 12, 0, 0).getTime();

    const points = [
      { lat: 1, lon: 1, ts: yesterday },
      { lat: 2, lon: 2, ts: todayMorning },
      { lat: 3, lon: 3, ts: todayNoon },
    ];

    expect(filterTodayPoints(points, now)).toEqual([
      { lat: 2, lon: 2, ts: todayMorning },
      { lat: 3, lon: 3, ts: todayNoon },
    ]);
  });

  it('全部過去日なら空配列', () => {
    const yesterday = new Date(2026, 4, 22, 8, 0, 0).getTime();
    const points = [{ lat: 1, lon: 1, ts: yesterday }];
    expect(filterTodayPoints(points, now)).toEqual([]);
  });

  it('ts を持たない古いエントリは除外', () => {
    const todayNoon = new Date(2026, 4, 23, 12, 0, 0).getTime();
    const points = [
      { lat: 1, lon: 1 },
      { lat: 2, lon: 2, ts: todayNoon },
    ];
    expect(filterTodayPoints(points, now)).toEqual([
      { lat: 2, lon: 2, ts: todayNoon },
    ]);
  });

  it('points が配列でなければ空配列を返す', () => {
    expect(filterTodayPoints(undefined, now)).toEqual([]);
    expect(filterTodayPoints(null, now)).toEqual([]);
  });

  it('日跨ぎ境界: 23:59:59 と翌 00:00:00 は別日扱い', () => {
    const lateNight = new Date(2026, 4, 22, 23, 59, 59, 999).getTime();
    const justAfterMidnight = new Date(2026, 4, 23, 0, 0, 0, 0).getTime();
    const points = [
      { lat: 1, lon: 1, ts: lateNight },
      { lat: 2, lon: 2, ts: justAfterMidnight },
    ];
    expect(filterTodayPoints(points, now)).toEqual([
      { lat: 2, lon: 2, ts: justAfterMidnight },
    ]);
  });
});
