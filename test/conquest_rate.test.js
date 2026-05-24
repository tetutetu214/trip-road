import { describe, it, expect } from 'vitest';
import {
  rateForRegion,
  rateForPrefecture,
  rateForMunicipality,
  colorForRate,
  enrichWithCodes,
} from '../public/assets/conquest_rate.js';

describe('rateForRegion', () => {
  const regionTotals = { kanto: 10, kinki: 8 };

  it('該当地方の踏破数 ÷ 全市町村数を返す', () => {
    const conquests = [
      { region_code: 'kanto' },
      { region_code: 'kanto' },
      { region_code: 'kanto' },
      { region_code: 'kinki' },
    ];
    expect(rateForRegion('kanto', conquests, regionTotals)).toBeCloseTo(0.3);
  });

  it('踏破ゼロは 0', () => {
    expect(rateForRegion('kanto', [], regionTotals)).toBe(0);
  });

  it('未知の地方コードは 0', () => {
    expect(rateForRegion('unknown', [], regionTotals)).toBe(0);
  });

  it('全踏破は 1', () => {
    const ten = Array.from({ length: 10 }, () => ({ region_code: 'kanto' }));
    expect(rateForRegion('kanto', ten, regionTotals)).toBe(1);
  });
});

describe('rateForPrefecture', () => {
  const prefTotals = { '14': 33, '13': 62 };

  it('該当都道府県の踏破数 ÷ 全市町村数', () => {
    const conquests = [
      { prefecture_code: '14' },
      { prefecture_code: '14' },
      { prefecture_code: '13' },
    ];
    expect(rateForPrefecture('14', conquests, prefTotals)).toBeCloseTo(2 / 33);
  });

  it('未知の都道府県は 0', () => {
    expect(rateForPrefecture('99', [], prefTotals)).toBe(0);
  });
});

describe('rateForMunicipality', () => {
  it('Set で踏破済なら 1', () => {
    expect(rateForMunicipality('14216', new Set(['14216']))).toBe(1);
  });

  it('Set で踏破なしなら 0', () => {
    expect(rateForMunicipality('14216', new Set())).toBe(0);
  });

  it('配列でも動く', () => {
    expect(rateForMunicipality('14216', [{ muni_code: '14216' }])).toBe(1);
    expect(rateForMunicipality('14217', [{ muni_code: '14216' }])).toBe(0);
  });

  it('Map でも動く', () => {
    expect(rateForMunicipality('14216', new Map([['14216', {}]]))).toBe(1);
  });
});

describe('colorForRate', () => {
  it('0% は灰', () => {
    expect(colorForRate(0)).toBe('#2a2a2a');
  });

  it('1-10% は薄緑', () => {
    expect(colorForRate(0.01)).toBe('#1f3a32');
    expect(colorForRate(0.10)).toBe('#1f3a32');
  });

  it('11-30% は中緑', () => {
    expect(colorForRate(0.11)).toBe('#2e6651');
    expect(colorForRate(0.30)).toBe('#2e6651');
  });

  it('31-60% は濃緑', () => {
    expect(colorForRate(0.31)).toBe('#3f9876');
    expect(colorForRate(0.60)).toBe('#3f9876');
  });

  it('61-100% は最濃', () => {
    expect(colorForRate(0.61)).toBe('#5dcaa5');
    expect(colorForRate(1.00)).toBe('#5dcaa5');
  });

  it('負値や 0 でも灰', () => {
    expect(colorForRate(-0.5)).toBe('#2a2a2a');
  });
});

describe('enrichWithCodes', () => {
  it('muni_code から prefecture_code / region_code を補う', () => {
    const enriched = enrichWithCodes({ muni_code: '14216', name: '綾瀬市' });
    expect(enriched.prefecture_code).toBe('14');
    expect(enriched.region_code).toBe('kanto');
    expect(enriched.name).toBe('綾瀬市');
  });

  it('既存のフィールドは上書きしない', () => {
    const enriched = enrichWithCodes({
      muni_code: '14216',
      prefecture_code: 'X',
      region_code: 'Y',
    });
    expect(enriched.prefecture_code).toBe('X');
    expect(enriched.region_code).toBe('Y');
  });

  it('muni_code がなければそのまま返す', () => {
    const item = { name: 'no code' };
    expect(enrichWithCodes(item)).toEqual(item);
  });
});
