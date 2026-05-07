import { describe, it, expect } from 'vitest';
import {
  SOLAR_TERM_META,
  buildCommonPreamble,
  buildFactualityPrompt,
  buildSpecificityPrompt,
  buildSeasonalConsistencyPrompt,
  buildInformationDensityPrompt,
} from '../src/judge_prompts.js';

const SAMPLE_INPUT = {
  prefecture: '神奈川県',
  municipality: '相模原市緑区',
  solarTerm: '05', // 清明
  description:
    '相模原市緑区は、神奈川県北部の山岳地帯に位置します。津久井湖と相模湖を抱える地形で、蛭ヶ岳（神奈川県最高峰）が西部にそびえます。江戸期は甲州街道の宿場町として栄え、養蚕業が盛んでした。',
};

describe('SOLAR_TERM_META', () => {
  it('24 節気すべてに name と period が定義されている', () => {
    const keys = Object.keys(SOLAR_TERM_META);
    expect(keys).toHaveLength(24);
    for (let i = 1; i <= 24; i++) {
      const key = String(i).padStart(2, '0');
      expect(SOLAR_TERM_META[key]).toBeDefined();
      expect(typeof SOLAR_TERM_META[key].name).toBe('string');
      expect(typeof SOLAR_TERM_META[key].period).toBe('string');
      expect(SOLAR_TERM_META[key].name.length).toBeGreaterThan(0);
      expect(SOLAR_TERM_META[key].period.length).toBeGreaterThan(0);
    }
  });

  it('代表的な節気の name が正しい', () => {
    expect(SOLAR_TERM_META['01'].name).toBe('立春');
    expect(SOLAR_TERM_META['05'].name).toBe('清明');
    expect(SOLAR_TERM_META['10'].name).toBe('夏至');
    expect(SOLAR_TERM_META['22'].name).toBe('冬至');
  });

  it('period に「頃」を含む人間可読の文字列', () => {
    expect(SOLAR_TERM_META['05'].period).toContain('4月');
    expect(SOLAR_TERM_META['05'].period).toContain('頃');
    expect(SOLAR_TERM_META['10'].period).toContain('6月');
  });
});

describe('buildCommonPreamble', () => {
  it('4 フィールド（市町村・節気番号・節気名・本文）を埋め込む', () => {
    const text = buildCommonPreamble(SAMPLE_INPUT);
    expect(text).toContain('神奈川県');
    expect(text).toContain('相模原市緑区');
    expect(text).toContain('05');
    expect(text).toContain('清明');
    expect(text).toContain(SAMPLE_INPUT.description);
  });

  it('校閲者ロール宣言と共通採点基準（5〜1点）を含む', () => {
    const text = buildCommonPreamble(SAMPLE_INPUT);
    expect(text).toContain('校閲者');
    expect(text).toContain('120〜180字');
    expect(text).toContain('JSON');
    expect(text).toContain('5: 減点根拠なし');
    expect(text).toContain('1: 全面的に問題');
    // 「先に減点根拠を引用、点数は最後」の CoT 指示
    expect(text).toContain('引用');
    expect(text).toMatch(/最後|最終/);
  });
});

describe('buildFactualityPrompt（軸 1）', () => {
  it('共通プリアンブル + 観点 + Wikipedia 抜粋 + Few-shot 3 パターンを含む（G-1）', () => {
    const text = buildFactualityPrompt({
      ...SAMPLE_INPUT,
      wikipediaExtract: '相模原市緑区は、相模原市を構成する3行政区のうちの一つである。',
    });
    expect(text).toContain('相模原市緑区'); // プリアンブル経由
    expect(text).toContain('Wikipedia');
    expect(text).toContain('相模原市を構成する3行政区'); // 抜粋本文
    expect(text).toContain('蛭ヶ岳'); // Few-shot 例 A（5点・整合）
    expect(text).toContain('多摩川'); // Few-shot 例 B（5点・記載なしだが地理常識として妥当）
    expect(text).toContain('武家屋敷'); // Few-shot 例 C（2点・直接矛盾）
    expect(text).toMatch(/採点|採点してください/);
  });

  it('観点が「直接矛盾のみ重く減点、記載なしは減点しない」に緩和されている（G-1）', () => {
    const text = buildFactualityPrompt({
      ...SAMPLE_INPUT,
      wikipediaExtract: '相模原市緑区は、相模原市を構成する3行政区のうちの一つである。',
    });
    expect(text).toContain('直接矛盾');
    expect(text).toContain('記載がないだけの事項は減点しない');
    // 旧 over-refusal ルール（G-1 で削除）が消えていること
    expect(text).not.toContain('明記されていない事項は「根拠なし」とみなし減点');
  });

  it('Few-shot 例 B（記載なしだが地理常識として妥当）が 5 点想定で含まれる（G-1）', () => {
    const text = buildFactualityPrompt({
      ...SAMPLE_INPUT,
      wikipediaExtract: '相模原市緑区は、相模原市を構成する3行政区のうちの一つである。',
    });
    expect(text).toMatch(/例B[(（]5点想定/);
    expect(text).toContain('地理常識として整合');
    expect(text).toContain('減点対象外');
  });

  it('wikipediaExtract が null のときは「情報なし」差し替え + 保守的評価指示', () => {
    const text = buildFactualityPrompt({
      ...SAMPLE_INPUT,
      wikipediaExtract: null,
    });
    expect(text).toContain('Wikipedia');
    expect(text).toContain('情報なし');
    expect(text).toMatch(/明確な誤り|減点しない/);
    // null のときも Few-shot は残す（評価軸の理解には必要）
    expect(text).toContain('蛭ヶ岳');
  });
});

describe('buildSpecificityPrompt（軸 2）', () => {
  it('共通プリアンブル + 観点 + Few-shot を含み Wikipedia は使わない', () => {
    const text = buildSpecificityPrompt(SAMPLE_INPUT);
    expect(text).toContain('相模原市緑区');
    expect(text).toContain('固有名詞');
    expect(text).toContain('汎用'); // 汎用フレーズ
    expect(text).toContain('津久井湖'); // Few-shot 例 A の固有名詞
    expect(text).toContain('桜が咲き'); // Few-shot 例 B の汎用フレーズ
    expect(text).not.toContain('Wikipedia');
  });
});

describe('buildSeasonalConsistencyPrompt（軸 3）', () => {
  it('節気名と period を観点に埋め込み、Few-shot を含む', () => {
    const text = buildSeasonalConsistencyPrompt(SAMPLE_INPUT);
    expect(text).toContain('清明');
    expect(text).toContain('4月'); // period の月
    expect(text).toContain('二十四節気');
    expect(text).toContain('雪化粧'); // Few-shot 例 B の矛盾例
    expect(text).toContain('紅葉'); // Few-shot 例 B
    expect(text).not.toContain('Wikipedia');
  });

  it('別の節気でも period と name が動的に切り替わる', () => {
    const text = buildSeasonalConsistencyPrompt({
      ...SAMPLE_INPUT,
      solarTerm: '22', // 冬至
    });
    expect(text).toContain('冬至');
    expect(text).toContain('12月'); // 冬至の period
  });
});

describe('buildInformationDensityPrompt（軸 4）', () => {
  it('情緒修飾と事実陳述の対比を観点に含み、Few-shot を含む', () => {
    const text = buildInformationDensityPrompt(SAMPLE_INPUT);
    expect(text).toContain('情緒');
    expect(text).toMatch(/事実陳述|カーナビ/);
    expect(text).toContain('津久井湖'); // Few-shot 例 A の事実情報
    expect(text).toContain('心地よい春風'); // Few-shot 例 B の情緒フレーズ
    expect(text).not.toContain('Wikipedia');
  });
});

describe('共通動作: 全プロンプトに共通の構造', () => {
  it('全 4 軸プロンプトが「採点してください」で実質的に終わる', () => {
    const wikipediaExtract = '相模原市緑区は、相模原市を構成する3行政区のうちの一つである。';
    const prompts = [
      buildFactualityPrompt({ ...SAMPLE_INPUT, wikipediaExtract }),
      buildSpecificityPrompt(SAMPLE_INPUT),
      buildSeasonalConsistencyPrompt(SAMPLE_INPUT),
      buildInformationDensityPrompt(SAMPLE_INPUT),
    ];
    for (const p of prompts) {
      expect(p.endsWith('採点してください。') || p.endsWith('採点してください')).toBe(true);
    }
  });

  it('全 4 軸プロンプトが共通プリアンブルから始まる', () => {
    const wikipediaExtract = '相模原市緑区は、相模原市を構成する3行政区のうちの一つである。';
    const preamble = buildCommonPreamble(SAMPLE_INPUT);
    const prompts = [
      buildFactualityPrompt({ ...SAMPLE_INPUT, wikipediaExtract }),
      buildSpecificityPrompt(SAMPLE_INPUT),
      buildSeasonalConsistencyPrompt(SAMPLE_INPUT),
      buildInformationDensityPrompt(SAMPLE_INPUT),
    ];
    for (const p of prompts) {
      expect(p.startsWith(preamble)).toBe(true);
    }
  });
});
