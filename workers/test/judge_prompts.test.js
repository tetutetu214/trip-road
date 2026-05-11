import { describe, it, expect } from 'vitest';
import { buildFaithfulnessPrompt } from '../src/judge_prompts.js';

const SAMPLE_INPUT = {
  prefecture: '神奈川県',
  municipality: '海老名市',
  description:
    '海老名市は神奈川県中部の県央地域に位置する市です。市内には小田急線と JR 相模線が交差する海老名駅があります。',
  wikipediaExtract:
    '海老名市は、神奈川県中部の県央地域に位置する市である。神奈川県の中央部に位置する。',
};

describe('buildFaithfulnessPrompt', () => {
  it('市町村名・要約・Wikipedia 抜粋・採点手順・JSON フォーマット指示を含む', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text).toContain('海老名市');
    expect(text).toContain('神奈川県');
    expect(text).toContain('Wikipedia 抜粋');
    expect(text).toContain('海老名市は、神奈川県中部'); // 抜粋本文
    expect(text).toContain('海老名駅'); // 要約本文
    expect(text).toContain('out_of_kb_terms');
    expect(text).toContain('score');
    expect(text).toContain('JSON');
  });

  it('採点基準 5/4/3/2/1 のそれぞれを含む', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text).toContain('5:');
    expect(text).toContain('4:');
    expect(text).toContain('3:');
    expect(text).toContain('2:');
    expect(text).toContain('1:');
    expect(text).toContain('忠実');
  });

  it('「評価しないこと」セクションで文体・字数・包括性を除外している', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text).toContain('評価しないこと');
    expect(text).toContain('文体');
    expect(text).toContain('字数');
    expect(text).toMatch(/包括性|どの部分を選んだ/);
  });

  it('Few-shot 例 A（5 点想定、完全に忠実）が含まれる', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text).toMatch(/例 A[(（]5 点想定/);
    expect(text).toContain('out_of_kb_terms": []');
    expect(text).toContain('"score": 5');
  });

  it('Few-shot 例 B（2 点想定、抜粋にない事実）が含まれる', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text).toMatch(/例 B[(（]2 点想定/);
    expect(text).toContain('"score": 2');
    expect(text).toContain('タマネギ');
    expect(text).toContain('メロン');
  });

  it('「採点してください」で実質的に終わる', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text.endsWith('採点してください。') || text.endsWith('採点してください')).toBe(true);
  });

  it('「校閲者」ロール宣言を冒頭で行う', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text.startsWith('あなたは厳格な校閲者です')).toBe(true);
  });

  it('Plan I で削除した 4 軸関連の文言が含まれていない', () => {
    const text = buildFaithfulnessPrompt(SAMPLE_INPUT);
    expect(text).not.toContain('二十四節気');
    expect(text).not.toContain('軸 1');
    expect(text).not.toContain('軸 2');
    expect(text).not.toContain('軸 3');
    expect(text).not.toContain('軸 4');
    expect(text).not.toContain('情緒');
    expect(text).not.toContain('情報密度');
    expect(text).not.toContain('具体性');
  });
});
