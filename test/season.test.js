import { describe, it, expect } from 'vitest';
import { getSolarTerm } from '../public/assets/season.js';

describe('getSolarTerm', () => {
  it('1/1〜1/5 は前年の冬至期間で 22 を返す', () => {
    expect(getSolarTerm(new Date(2026, 0, 1))).toBe('22');   // 1/1
    expect(getSolarTerm(new Date(2026, 0, 5))).toBe('22');   // 1/5
  });
  it('1/6 から小寒(23)に切り替わる', () => {
    expect(getSolarTerm(new Date(2026, 0, 6))).toBe('23');
    expect(getSolarTerm(new Date(2026, 0, 19))).toBe('23');
  });
  it('1/20 から大寒(24)に切り替わる', () => {
    expect(getSolarTerm(new Date(2026, 0, 20))).toBe('24');
    expect(getSolarTerm(new Date(2026, 1, 3))).toBe('24');   // 2/3
  });
  it('2/4 から立春(01)に切り替わる', () => {
    expect(getSolarTerm(new Date(2026, 1, 4))).toBe('01');
    expect(getSolarTerm(new Date(2026, 1, 18))).toBe('01');  // 2/18
  });
  it('春分(04)・夏至(10)・秋分(16)・冬至(22)の境界判定', () => {
    expect(getSolarTerm(new Date(2026, 2, 21))).toBe('04');  // 3/21 春分
    expect(getSolarTerm(new Date(2026, 5, 21))).toBe('10');  // 6/21 夏至
    expect(getSolarTerm(new Date(2026, 8, 23))).toBe('16');  // 9/23 秋分
    expect(getSolarTerm(new Date(2026, 11, 22))).toBe('22'); // 12/22 冬至
  });
  it('立夏(07)・立秋(13)・立冬(19)の境界判定', () => {
    expect(getSolarTerm(new Date(2026, 4, 6))).toBe('07');   // 5/6 立夏
    expect(getSolarTerm(new Date(2026, 7, 8))).toBe('13');   // 8/8 立秋
    expect(getSolarTerm(new Date(2026, 10, 7))).toBe('19');  // 11/7 立冬
  });
  it('境界1日前は前の節気', () => {
    expect(getSolarTerm(new Date(2026, 1, 3))).toBe('24');   // 2/3 → 大寒
    expect(getSolarTerm(new Date(2026, 4, 5))).toBe('06');   // 5/5 → 穀雨
  });
  it('返り値は2桁ゼロ詰め文字列', () => {
    const v = getSolarTerm(new Date(2026, 1, 10));  // 立春期間
    expect(v).toBe('01');
    expect(typeof v).toBe('string');
    expect(v).toHaveLength(2);
  });
});
