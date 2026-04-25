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
  it('必須フィールドが揃った entry を返す', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '11210',
      season: 'spring',
      description: '埼玉県久喜市…',
      ts_generated: 1745000000000,
    });
    expect(entry.trace_id).toBe('test-id');
    expect(entry.muni_code).toBe('11210');
    expect(entry.season).toBe('spring');
    expect(entry.description).toBe('埼玉県久喜市…');
    expect(entry.ts_generated).toBe(1745000000000);
    expect(entry.ts_displayed).toBeNull();
    expect(entry.ts_left).toBeNull();
    expect(entry.dwell_ms).toBeNull();
    expect(entry.re_visited_count).toBe(0);
    expect(entry.user_rating).toBeNull();
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
