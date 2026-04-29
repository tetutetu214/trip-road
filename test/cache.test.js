import { describe, it, expect } from 'vitest';
import { makeCacheKey } from '../public/assets/cache.js';

describe('makeCacheKey', () => {
  it('市町村コードと二十四節気番号を "_" で繋ぐ', () => {
    expect(makeCacheKey('14151', '07')).toBe('14151_07');  // 相模原市緑区・立夏
    expect(makeCacheKey('13101', '22')).toBe('13101_22');  // 千代田区・冬至
  });
});
