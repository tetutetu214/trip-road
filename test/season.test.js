import { describe, it, expect } from 'vitest';
import { getSeason } from '../public/assets/season.js';

describe('getSeason', () => {
  it('3-5月はspring', () => {
    expect(getSeason(new Date(2026, 2, 1))).toBe('spring');   // 3/1
    expect(getSeason(new Date(2026, 3, 15))).toBe('spring');  // 4/15
    expect(getSeason(new Date(2026, 4, 31))).toBe('spring');  // 5/31
  });
  it('6-8月はsummer', () => {
    expect(getSeason(new Date(2026, 5, 1))).toBe('summer');   // 6/1
    expect(getSeason(new Date(2026, 7, 31))).toBe('summer');  // 8/31
  });
  it('9-11月はautumn', () => {
    expect(getSeason(new Date(2026, 8, 1))).toBe('autumn');
    expect(getSeason(new Date(2026, 10, 30))).toBe('autumn');
  });
  it('12-2月はwinter', () => {
    expect(getSeason(new Date(2026, 11, 1))).toBe('winter');  // 12/1
    expect(getSeason(new Date(2026, 0, 15))).toBe('winter');  // 1/15
    expect(getSeason(new Date(2026, 1, 28))).toBe('winter');  // 2/28
  });
});
