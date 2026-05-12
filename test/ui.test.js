import { describe, it, expect } from 'vitest';
import { phaseToText, formatDebugInfo } from '../public/assets/ui.js';

describe('phaseToText', () => {
  it('generating → 📡 土地のたよりを生成中…', () => {
    expect(phaseToText('generating')).toBe('📡 土地のたよりを生成中…');
  });

  it('judging → ✓ 内容を確認しています…', () => {
    expect(phaseToText('judging')).toBe('✓ 内容を確認しています…');
  });

  it('regenerating → ✏️ より良い表現に書き直しています…', () => {
    expect(phaseToText('regenerating')).toBe('✏️ より良い表現に書き直しています…');
  });

  it('未知の phase は空文字', () => {
    expect(phaseToText('unknown')).toBe('');
    expect(phaseToText('')).toBe('');
    expect(phaseToText(null)).toBe('');
    expect(phaseToText(undefined)).toBe('');
  });
});

describe('formatDebugInfo (Plan I)', () => {
  it('null / undefined は空文字', () => {
    expect(formatDebugInfo(null)).toBe('');
    expect(formatDebugInfo(undefined)).toBe('');
  });

  it('cached フラグがあれば「(cached, no judge info)」', () => {
    expect(formatDebugInfo({ cached: true })).toBe('[DEBUG] (cached, no judge info)');
  });

  it('no_wikipedia=true は専用の表示', () => {
    expect(formatDebugInfo({ no_wikipedia: true })).toBe(
      '[DEBUG] no_wikipedia (Generator was not called)'
    );
  });

  it('judge_passed=null（fail-open）なら error を含む 2 行', () => {
    const text = formatDebugInfo({
      judge_passed: null,
      judge_error: 'nova down',
    });
    expect(text).toContain('judge unavailable');
    expect(text).toContain('nova down');
  });

  it('judge_passed=null かつ judge_error=null なら「-」を出す', () => {
    const text = formatDebugInfo({ judge_passed: null, judge_error: null });
    expect(text).toContain('judge unavailable');
    expect(text).toContain('-');
  });

  it('judge_passed=true + faithfulness_score + out_of_kb_terms 空', () => {
    const text = formatDebugInfo({
      judge_passed: true,
      faithfulness_score: 5,
      out_of_kb_terms: [],
      regenerated: false,
      fallback_to_extract: false,
    });
    expect(text).toContain('judge_passed: true');
    expect(text).toContain('regen: false');
    expect(text).toContain('fallback: false');
    expect(text).toContain('faithfulness_score: 5');
    expect(text).not.toContain('out_of_kb_terms:');
  });

  it('judge_passed=false + out_of_kb_terms ありなら一覧を表示', () => {
    const text = formatDebugInfo({
      judge_passed: false,
      faithfulness_score: 3,
      out_of_kb_terms: ['タマネギ', 'メロン'],
      regenerated: true,
      fallback_to_extract: false,
    });
    expect(text).toContain('judge_passed: false');
    expect(text).toContain('regen: true');
    expect(text).toContain('faithfulness_score: 3');
    expect(text).toContain('out_of_kb_terms:');
    expect(text).toContain('・タマネギ');
    expect(text).toContain('・メロン');
  });

  it('fallback_to_extract=true も表示される', () => {
    const text = formatDebugInfo({
      judge_passed: false,
      faithfulness_score: 2,
      out_of_kb_terms: [],
      regenerated: true,
      fallback_to_extract: true,
    });
    expect(text).toContain('fallback: true');
  });
});
