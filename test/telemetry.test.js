import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  buildTelemetryEntry,
  shouldSample,
  nextRating,
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

describe('buildTelemetryEntry (Plan I)', () => {
  it('必須フィールドが揃った entry を返す（Plan I: solar_term は廃止）', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '11210',
      description: '埼玉県久喜市…',
      ts_generated: 1745000000000,
    });
    expect(entry.trace_id).toBe('test-id');
    expect(entry.muni_code).toBe('11210');
    expect(entry.description).toBe('埼玉県久喜市…');
    expect(entry.ts_generated).toBe(1745000000000);
    expect(entry.ts_displayed).toBeNull();
    expect(entry.ts_left).toBeNull();
    expect(entry.dwell_ms).toBeNull();
    expect(entry.re_visited_count).toBe(0);
    expect(entry.user_rating).toBeNull();
    // 旧スキーマのフィールドは含まれない
    expect(entry).not.toHaveProperty('solar_term');
    expect(entry).not.toHaveProperty('critic_accuracy');
    expect(entry).not.toHaveProperty('critic_specificity');
    expect(entry).not.toHaveProperty('critic_season_fit');
    expect(entry).not.toHaveProperty('critic_density');
    expect(entry).not.toHaveProperty('critic_deductions');
  });

  it('Plan I: Faithfulness フィールドが既定値で初期化される（キャッシュヒット呼出想定）', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '14153',
      description: '海老名市は...',
      ts_generated: 1745000000000,
    });
    expect(entry.faithfulness_score).toBeNull();
    expect(entry.out_of_kb_terms).toBeNull();
    expect(entry.judge_passed).toBeNull();
    expect(entry.regenerated).toBe(false);
    expect(entry.fallback_to_extract).toBe(false);
    expect(entry.no_wikipedia).toBe(false);
    expect(entry.wikipedia_extract_length).toBeNull();
    expect(entry.judge_error).toBeNull();
    expect(entry.generator_model).toBeNull();
    expect(entry.judge_model).toBeNull();
  });

  it('Plan I: 新規生成の Faithfulness 結果を渡すと entry に反映される', () => {
    const terms = ['タマネギ', 'メロン'];
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '14215',
      description: '海老名市は...',
      ts_generated: 1745000000000,
      faithfulness_score: 3,
      out_of_kb_terms: terms,
      judge_passed: false,
      regenerated: true,
      fallback_to_extract: false,
      wikipedia_extract_length: 187,
      judge_error: null,
      generator_model: 'us.amazon.nova-pro-v1:0',
      judge_model: 'us.amazon.nova-pro-v1:0',
    });
    expect(entry.faithfulness_score).toBe(3);
    expect(entry.out_of_kb_terms).toEqual(terms);
    expect(entry.judge_passed).toBe(false);
    expect(entry.regenerated).toBe(true);
    expect(entry.fallback_to_extract).toBe(false);
    expect(entry.wikipedia_extract_length).toBe(187);
    expect(entry.judge_error).toBeNull();
    expect(entry.generator_model).toBe('us.amazon.nova-pro-v1:0');
    expect(entry.judge_model).toBe('us.amazon.nova-pro-v1:0');
  });

  it('Plan I: no_wikipedia=true を渡すと entry に反映される', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '14215',
      description: '',
      ts_generated: 1745000000000,
      no_wikipedia: true,
      wikipedia_extract_length: 0,
    });
    expect(entry.no_wikipedia).toBe(true);
    expect(entry.wikipedia_extract_length).toBe(0);
    expect(entry.description).toBe('');
  });

  it('Plan I: fallback_to_extract=true を渡すと entry に反映される', () => {
    const entry = buildTelemetryEntry({
      trace_id: 'test-id',
      muni_code: '14215',
      description: '海老名市は…（抜粋転載）',
      ts_generated: 1745000000000,
      faithfulness_score: 2,
      fallback_to_extract: true,
      regenerated: true,
    });
    expect(entry.fallback_to_extract).toBe(true);
    expect(entry.regenerated).toBe(true);
    expect(entry.faithfulness_score).toBe(2);
  });
});

describe('nextRating (Issue #17 トグル)', () => {
  it('未評価のカードで 👍 を押すと up になる', () => {
    expect(nextRating(null, 'up')).toBe('up');
  });
  it('未評価のカードで 👎 を押すと down になる', () => {
    expect(nextRating(null, 'down')).toBe('down');
  });
  it('既に up のカードで同じ 👍 を押すと取り消されて null に戻る', () => {
    expect(nextRating('up', 'up')).toBeNull();
  });
  it('既に down のカードで同じ 👎 を押すと取り消されて null に戻る', () => {
    expect(nextRating('down', 'down')).toBeNull();
  });
  it('up のカードで 👎 を押すと down に切り替わる', () => {
    expect(nextRating('up', 'down')).toBe('down');
  });
  it('down のカードで 👍 を押すと up に切り替わる', () => {
    expect(nextRating('down', 'up')).toBe('up');
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
    expect(trues).toBeGreaterThan(350);
    expect(trues).toBeLessThan(650);
  });
});
