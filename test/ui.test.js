import { describe, it, expect } from 'vitest';
import { phaseToText } from '../public/assets/ui.js';

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
