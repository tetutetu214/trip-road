import { describe, it, expect } from 'vitest';
import {
  DETERMINISTIC_PASS_THRESHOLD,
  extractProperNounLikeStrings,
  findOutOfKbTerms,
  scoreFromOutOfKbCount,
  deterministicJudge,
} from '../src/deterministic_judge.js';

describe('定数', () => {
  it('合格しきい値は 4（judge.js の PASS_THRESHOLD と整合）', () => {
    expect(DETERMINISTIC_PASS_THRESHOLD).toBe(4);
  });
});

describe('extractProperNounLikeStrings', () => {
  it('漢字 2 文字以上を抽出', () => {
    const out = extractProperNounLikeStrings('千代田区は東京都の特別区です');
    expect(out).toContain('千代田区');
    expect(out).toContain('東京都');
    expect(out).toContain('特別区');
  });

  it('単漢字「区」「都」「市」のような 1 文字は除外', () => {
    const out = extractProperNounLikeStrings('区 都 市');
    expect(out).not.toContain('区');
    expect(out).not.toContain('都');
    expect(out).not.toContain('市');
  });

  it('カタカナ 3 文字以上を抽出（長音符号含む）', () => {
    const out = extractProperNounLikeStrings('バンクーバーと姉妹都市');
    expect(out).toContain('バンクーバー');
  });

  it('カタカナ 2 文字以下は除外（短すぎる）', () => {
    const out = extractProperNounLikeStrings('バー');
    expect(out).not.toContain('バー');
  });

  it('数字 2 文字以上を抽出', () => {
    const out = extractProperNounLikeStrings('1947 年と 180 度');
    expect(out).toContain('1947');
    expect(out).toContain('180');
  });

  it('1 桁数字は除外', () => {
    const out = extractProperNounLikeStrings('1 と 2 と 3');
    expect(out).not.toContain('1');
  });

  it('ひらがなは抽出しない', () => {
    const out = extractProperNounLikeStrings('あいうえお かきくけこ');
    expect(out).toEqual([]);
  });

  it('重複を排除する', () => {
    const out = extractProperNounLikeStrings('東京都の東京都の東京都');
    const count = out.filter((t) => t === '東京都').length;
    expect(count).toBe(1);
  });

  it('空文字 / null は空配列', () => {
    expect(extractProperNounLikeStrings('')).toEqual([]);
    expect(extractProperNounLikeStrings(null)).toEqual([]);
    expect(extractProperNounLikeStrings(undefined)).toEqual([]);
  });

  it('複合的な実例（千代田区の解説）', () => {
    const text = '千代田区は東京都の特別区で、1947 年に旧麹町区と旧神田区が合併。皇居を中心とする。';
    const out = extractProperNounLikeStrings(text);
    expect(out).toEqual(
      expect.arrayContaining(['千代田区', '東京都', '特別区', '1947', '旧麹町区', '旧神田区', '皇居'])
    );
  });
});

describe('findOutOfKbTerms', () => {
  const KB = '千代田区は東京都の特別区である。1947 年に旧麹町区と旧神田区が合併。皇居や霞が関を擁する。';

  it('抜粋の語彙だけで構成された生成文は空配列', () => {
    // 「中心」「誕生」のような一般 2 文字漢字は避ける（既知の弱点を回避する書き方）
    const desc = '千代田区は東京都の特別区です。1947 年に旧麹町区と旧神田区が合併し皇居を擁します。';
    expect(findOutOfKbTerms(desc, KB)).toEqual([]);
  });

  it('抜粋外の固有名詞を検出', () => {
    const desc = '千代田区は東京都の特別区で、秋葉原や新宿があります。';
    const out = findOutOfKbTerms(desc, KB);
    expect(out).toContain('秋葉原');
    expect(out).toContain('新宿');
  });

  it('抜粋に含まれる substring としての一致を許容', () => {
    // KB には "旧麹町区" がある → "麹町" も substring として含まれる
    const desc = '麹町';
    const out = findOutOfKbTerms(desc, KB);
    expect(out).not.toContain('麹町');
  });

  it('kbText が空でも候補が出れば全部 out_of_kb_terms 入り', () => {
    const out = findOutOfKbTerms('千代田区は東京都にある', '');
    expect(out).toContain('千代田区');
    expect(out).toContain('東京都');
  });

  // ---- ライト案の既知の限界（シャドウ運用で観測対象） ----

  it('既知の限界 1: 一般 2 文字漢字（中心・誕生）は false positive で out_of_kb 入り', () => {
    const desc = '皇居を中心として 1947 年に誕生した千代田区です。';
    const out = findOutOfKbTerms(desc, KB);
    expect(out).toContain('中心'); // KB に「中心」という substring がない
    expect(out).toContain('誕生'); // KB に「誕生」という substring がない
  });

  it('既知の限界 2: 複合語問題（抜粋「市制が施行」と生成文「市制施行」がマッチしない）', () => {
    // Nova Pro Judge も同じ誤検知パターンを示すので、ライト案でも改善はしないが、
    // 別の理由（substring 完全一致）で同じ結果になることをテストで明示
    const kb = '東松山市は埼玉県の中部に位置する。1954 年に市制が施行された。';
    const desc = '1954 年に市制施行した東松山市です。';
    const out = findOutOfKbTerms(desc, kb);
    // "市制施行" は連続 4 文字漢字として抽出され、KB の "市制が施行"（間に「が」）に
    // substring 一致しない。これは形態素解析を入れないと解消しない既知の制約
    expect(out).toContain('市制施行');
  });
});

describe('scoreFromOutOfKbCount', () => {
  it('0 件 → 5（完全合格）', () => {
    expect(scoreFromOutOfKbCount(0)).toBe(5);
  });
  it('1 件 → 4（許容、合格圏内）', () => {
    expect(scoreFromOutOfKbCount(1)).toBe(4);
  });
  it('2 件 → 3（不合格）', () => {
    expect(scoreFromOutOfKbCount(2)).toBe(3);
  });
  it('3 件 → 2', () => {
    expect(scoreFromOutOfKbCount(3)).toBe(2);
  });
  it('4 件以上 → 1', () => {
    expect(scoreFromOutOfKbCount(4)).toBe(1);
    expect(scoreFromOutOfKbCount(10)).toBe(1);
  });
  it('不正値は 1 にフォールバック', () => {
    expect(scoreFromOutOfKbCount(-1)).toBe(1);
    expect(scoreFromOutOfKbCount(NaN)).toBe(1);
    expect(scoreFromOutOfKbCount('a')).toBe(1);
  });
});

describe('deterministicJudge', () => {
  const WIKIPEDIA =
    '千代田区は東京都の特別区である。1947 年に旧麹町区と旧神田区が合併。皇居を擁する。';
  const WIKIDATA =
    '種別: 日本の特別区\n名前の由来: 千代田\n構成地区: 西神田, 麹町, 丸の内, 永田町, 霞が関';

  it('Wikipedia + Wikidata に裏付けられた生成文 → score 5 / passed', () => {
    // 生成文は抜粋の語彙だけで構成する（「有名」「誕生」のような一般 2 文字漢字は避ける）
    const desc =
      '千代田区は東京都の特別区です。1947 年に旧麹町区と旧神田区が合併し、皇居を擁します。';
    const result = deterministicJudge({
      description: desc,
      wikipediaExtract: WIKIPEDIA,
      wikidataPromptBlock: WIKIDATA,
    });
    expect(result.score).toBe(5);
    expect(result.passed).toBe(true);
    expect(result.out_of_kb_terms).toEqual([]);
  });

  it('Wikidata で補強される地名（西神田・丸の内）は素材内扱い', () => {
    const desc = '千代田区は東京都の特別区で、西神田や丸の内を含みます。';
    const result = deterministicJudge({
      description: desc,
      wikipediaExtract: WIKIPEDIA,
      wikidataPromptBlock: WIKIDATA,
    });
    expect(result.out_of_kb_terms).toEqual([]);
    expect(result.score).toBe(5);
  });

  it('Wikipedia / Wikidata どちらにもない地名 → out_of_kb_terms 入り', () => {
    const desc = '千代田区は東京都の特別区で、秋葉原や新宿があります。';
    const result = deterministicJudge({
      description: desc,
      wikipediaExtract: WIKIPEDIA,
      wikidataPromptBlock: WIKIDATA,
    });
    expect(result.out_of_kb_terms).toContain('秋葉原');
    expect(result.out_of_kb_terms).toContain('新宿');
    expect(result.score).toBeLessThanOrEqual(3);
    expect(result.passed).toBe(false);
  });

  it('Wikidata 未指定（Wikipedia 単独）でも動作', () => {
    const desc = '千代田区は東京都の特別区です。';
    const result = deterministicJudge({
      description: desc,
      wikipediaExtract: WIKIPEDIA,
    });
    expect(result.score).toBe(5);
    expect(result.passed).toBe(true);
  });

  it('空の description は score=1 / passed=false', () => {
    const result = deterministicJudge({
      description: '',
      wikipediaExtract: WIKIPEDIA,
    });
    expect(result.score).toBe(1);
    expect(result.passed).toBe(false);
  });

  it('既知の弱点: 一般 2 文字漢字（有名・誕生 等）は false positive で out_of_kb_terms 入りする', () => {
    // 形態素解析を使わないライト案の宿命。シャドウ運用で誤検知率を観測した上で、
    // 必要なら STOPWORDS リストの追加で段階的に対処する（Phase 2-2 の出口判断）。
    const desc = '千代田区は東京都の特別区で、秋葉原が有名です。';
    const result = deterministicJudge({
      description: desc,
      wikipediaExtract: WIKIPEDIA,
      wikidataPromptBlock: WIKIDATA,
    });
    expect(result.out_of_kb_terms).toContain('秋葉原'); // true positive
    expect(result.out_of_kb_terms).toContain('有名');    // false positive（既知の弱点）
  });
});
