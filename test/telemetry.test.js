import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  buildTelemetryEntry,
  shouldSample,
} from '../public/assets/telemetry.js';

describe('generateTraceId', () => {
  it('UUID v4 形式の文字列を返す', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('複数回呼んでも一意', () => {
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add(generateTraceId());
    expect(ids.size).toBe(100);
  });
});

describe('buildTelemetryEntry', () => {
  it('必須フィールドが揃った entry を返す（solar_term は二十四節気番号）', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '11210',
      solar_term: '04',  // 春分
      description: '埼玉県久喜市…',
      ts_generated: 1745000000000,
    });
    expect(entry.trace_id).toBe('test-id');
    expect(entry.muni_code).toBe('11210');
    expect(entry.solar_term).toBe('04');
    expect(entry.description).toBe('埼玉県久喜市…');
    expect(entry.ts_generated).toBe(1745000000000);
    expect(entry.ts_displayed).toBeNull();
    expect(entry.ts_left).toBeNull();
    expect(entry.dwell_ms).toBeNull();
    expect(entry.re_visited_count).toBe(0);
    expect(entry.user_rating).toBeNull();
  });

  it('Plan E: Judge スコアフィールドが既定 null で初期化される（キャッシュヒット呼出想定）', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '14153',
      solar_term: '05',
      description: '相模原市緑区...',
      ts_generated: 1745000000000,
    });
    expect(entry.critic_accuracy).toBeNull();
    expect(entry.critic_specificity).toBeNull();
    expect(entry.critic_season_fit).toBeNull();
    expect(entry.critic_density).toBeNull();
    expect(entry.critic_deductions).toBeNull();
    expect(entry.judge_passed).toBeNull();
    expect(entry.regenerated).toBe(false);
    expect(entry.judge_error).toBeNull();
    // 廃止フィールドは含まれない
    expect(entry).not.toHaveProperty('critic_meaningfulness');
  });

  it('Plan E: Judge 結果を渡すと entry に反映される（新規生成時想定）', () => {
    const deductions = {
      accuracy: [],
      specificity: ['桜が美しい（汎用）'],
      season_fit: [],
      density: ['淡紅色に染まり（情緒）'],
    };
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '14153',
      solar_term: '05',
      description: '相模原市緑区...',
      ts_generated: 1745000000000,
      critic_accuracy: 5,
      critic_specificity: 3,
      critic_season_fit: 5,
      critic_density: 2,
      critic_deductions: deductions,
      judge_passed: false,
      regenerated: true,
      judge_error: null,
    });
    expect(entry.critic_accuracy).toBe(5);
    expect(entry.critic_specificity).toBe(3);
    expect(entry.critic_season_fit).toBe(5);
    expect(entry.critic_density).toBe(2);
    expect(entry.critic_deductions).toEqual(deductions);
    expect(entry.judge_passed).toBe(false);
    expect(entry.regenerated).toBe(true);
    expect(entry.judge_error).toBeNull();
  });
});

describe('shouldSample', () => {
  it('sample_rate=1.0 で常に true', () => {
    for (let i = 0; i < 10; i++) expect(shouldSample(1.0)).toBe(true);
  });
  it('sample_rate=0.0 で常に false', () => {
    for (let i = 0; i < 10; i++) expect(shouldSample(0.0)).toBe(false);
  });
  it('sample_rate=0.5 で確率的に true/false が混じる', () => {
    let trues = 0;
    for (let i = 0; i < 1000; i++) if (shouldSample(0.5)) trues++;
    // 統計的に 350-650 の範囲（3σ 程度の許容）
    expect(trues).toBeGreaterThan(350);
    expect(trues).toBeLessThan(650);
  });
});
