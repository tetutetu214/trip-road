import { describe, it, expect } from 'vitest';
import { makeCacheKey } from '../public/assets/cache.js';

describe('makeCacheKey', () => {
  it('市町村コードと季節を "_" で繋ぐ', () => {
    expect(makeCacheKey('14151', 'spring')).toBe('14151_spring');
    expect(makeCacheKey('13101', 'winter')).toBe('13101_winter');
  });
});
