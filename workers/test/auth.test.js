import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '../src/auth.js';

describe('timingSafeEqual', () => {
  it('同じ文字列に対して true を返す', async () => {
    const expected = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    const received = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    expect(await timingSafeEqual(received, expected)).toBe(true);
  });

  it('異なる文字列に対して false を返す', async () => {
    const expected = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    const received = 'a3f9b12c8e4d6710ff293a4bc1e8d5d3'; // 最終1文字違い
    expect(await timingSafeEqual(received, expected)).toBe(false);
  });

  it('長さが異なる文字列に対して false を返す', async () => {
    const expected = 'a3f9b12c8e4d6710ff293a4bc1e8d5d2';
    const received = 'a3f9b12c';
    expect(await timingSafeEqual(received, expected)).toBe(false);
  });

  it('空文字列 vs 非空に対して false を返す', async () => {
    expect(await timingSafeEqual('', 'nonempty')).toBe(false);
    expect(await timingSafeEqual('nonempty', '')).toBe(false);
  });

  it('両方空文字列に対して true を返す', async () => {
    expect(await timingSafeEqual('', '')).toBe(true);
  });

  it('null/undefined 入力に対して false を返す（安全側）', async () => {
    expect(await timingSafeEqual(null, 'expected')).toBe(false);
    expect(await timingSafeEqual(undefined, 'expected')).toBe(false);
  });
});
