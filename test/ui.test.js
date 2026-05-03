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

describe('formatDebugInfo', () => {
  it('null / undefined は空文字', () => {
    expect(formatDebugInfo(null)).toBe('');
    expect(formatDebugInfo(undefined)).toBe('');
  });

  it('cached フラグがあれば「(cached, no judge info)」', () => {
    expect(formatDebugInfo({ cached: true })).toBe('[DEBUG] (cached, no judge info)');
  });

  it('judge_passed=null（fail-open）なら error を含む 2 行', () => {
    const text = formatDebugInfo({
      judge_passed: null,
      judge_error: 'sonnet down',
    });
    expect(text).toContain('judge unavailable');
    expect(text).toContain('sonnet down');
  });

  it('judge_passed=null かつ judge_error=null なら「-」を出す', () => {
    const text = formatDebugInfo({ judge_passed: null, judge_error: null });
    expect(text).toContain('judge unavailable');
    expect(text).toContain('-');
  });

  it('judge_passed=true + 全軸スコア + 減点なし', () => {
    const text = formatDebugInfo({
      judge_passed: true,
      judge_scores: { accuracy: 5, specificity: 5, season_fit: 5, density: 5 },
      judge_deductions: { accuracy: [], specificity: [], season_fit: [], density: [] },
      regenerated: false,
    });
    expect(text).toContain('judge_passed: true');
    expect(text).toContain('regen: false');
    expect(text).toContain('accuracy: 5');
    expect(text).toContain('density: 5');
    expect(text).not.toContain('deductions:');
  });

  it('judge_passed=false + 減点ありなら deductions セクションを表示', () => {
    const text = formatDebugInfo({
      judge_passed: false,
      regenerated: true,
      judge_scores: { accuracy: 5, specificity: 2, season_fit: 5, density: 3 },
      judge_deductions: {
        accuracy: [],
        specificity: ['桜が美しい（汎用）'],
        season_fit: [],
        density: ['淡紅色に染まり（情緒）'],
      },
    });
    expect(text).toContain('judge_passed: false');
    expect(text).toContain('regen: true');
    expect(text).toContain('specificity: 2');
    expect(text).toContain('density: 3');
    expect(text).toContain('deductions:');
    expect(text).toContain('specificity: 桜が美しい');
    expect(text).toContain('density: 淡紅色に染まり');
  });
});
