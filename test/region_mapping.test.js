import { describe, it, expect } from 'vitest';
import {
  PREFECTURE_TO_REGION,
  REGION_NAMES,
  prefectureCodeOf,
  regionCodeOf,
} from '../public/assets/region_mapping.js';

describe('PREFECTURE_TO_REGION', () => {
  it('47 都道府県すべてを含む', () => {
    expect(Object.keys(PREFECTURE_TO_REGION)).toHaveLength(47);
    for (let i = 1; i <= 47; i++) {
      const code = String(i).padStart(2, '0');
      expect(PREFECTURE_TO_REGION).toHaveProperty(code);
    }
  });

  it('地方コードは 8 種類', () => {
    const unique = new Set(Object.values(PREFECTURE_TO_REGION));
    expect(unique).toEqual(new Set([
      'hokkaido', 'tohoku', 'kanto', 'chubu',
      'kinki', 'chugoku', 'shikoku', 'kyushu',
    ]));
  });

  it('REGION_NAMES は全 8 地方を網羅', () => {
    for (const region of new Set(Object.values(PREFECTURE_TO_REGION))) {
      expect(REGION_NAMES).toHaveProperty(region);
    }
  });
});

describe('prefectureCodeOf', () => {
  it('5 桁から先頭 2 桁を抽出', () => {
    expect(prefectureCodeOf('14216')).toBe('14');
    expect(prefectureCodeOf('01101')).toBe('01');
    expect(prefectureCodeOf('47201')).toBe('47');
  });

  it('数値を渡しても文字列化して抽出', () => {
    expect(prefectureCodeOf(14216)).toBe('14');
  });
});

describe('regionCodeOf', () => {
  it('神奈川県の市町村は kanto', () => {
    expect(regionCodeOf('14216')).toBe('kanto');
  });

  it('北海道の市町村は hokkaido', () => {
    expect(regionCodeOf('01101')).toBe('hokkaido');
  });

  it('沖縄県の市町村は kyushu', () => {
    expect(regionCodeOf('47201')).toBe('kyushu');
  });

  it('未知の都道府県コードは null', () => {
    expect(regionCodeOf('99999')).toBe(null);
  });
});
