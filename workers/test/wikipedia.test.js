import { describe, it, expect } from 'vitest';
import {
  WIKIPEDIA_API_BASE,
  USER_AGENT,
  MAX_EXTRACT_LENGTH,
  CACHE_TTL_SECONDS,
  buildWikipediaUrl,
  parseWikipediaExtract,
  cleanExtract,
  resolveWikipediaTitle,
  buildCacheKey,
} from '../src/wikipedia.js';

describe('定数', () => {
  it('Wikipedia API ベース URL は ja.wikipedia.org', () => {
    expect(WIKIPEDIA_API_BASE).toBe('https://ja.wikipedia.org/w/api.php');
  });

  it('User-Agent は trip-road を含む', () => {
    expect(USER_AGENT).toContain('trip-road');
  });

  it('extract 最大長は 1500 字', () => {
    expect(MAX_EXTRACT_LENGTH).toBe(1500);
  });

  it('Cache TTL は 30 日（秒）', () => {
    expect(CACHE_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });
});

describe('buildWikipediaUrl', () => {
  // ヘルパ: URL からクエリパラメータを取り出してデコード後の値で検証する
  // （URLSearchParams のエンコードは encodeURIComponent と差があるため文字列直接比較は脆い）
  function paramsOf(url) {
    return new URLSearchParams(url.split('?')[1]);
  }

  it('日本語タイトルを URL エンコードして返す', () => {
    const url = buildWikipediaUrl('相模原市');
    expect(url.startsWith('https://ja.wikipedia.org/w/api.php?')).toBe(true);
    expect(paramsOf(url).get('titles')).toBe('相模原市');
  });

  it('Plan E 仕様の固定パラメータをすべて含む', () => {
    const params = paramsOf(buildWikipediaUrl('新宿区'));
    expect(params.get('action')).toBe('query');
    expect(params.get('prop')).toBe('extracts');
    expect(params.get('exintro')).toBe('true');
    expect(params.get('explaintext')).toBe('true');
    expect(params.get('redirects')).toBe('true');
    expect(params.get('format')).toBe('json');
    expect(params.get('formatversion')).toBe('2');
  });

  it('カッコ付き・スペース入りタイトルもデコード時に元に戻る', () => {
    const url = buildWikipediaUrl('緑区 (相模原市)');
    expect(paramsOf(url).get('titles')).toBe('緑区 (相模原市)');
  });
});

describe('parseWikipediaExtract', () => {
  it('正常レスポンスから extract を返す', () => {
    const json = {
      query: {
        pages: [{
          pageid: 1234,
          title: '相模原市',
          extract: '相模原市（さがみはらし）は、神奈川県の北部に位置する政令指定都市。',
        }],
      },
    };
    expect(parseWikipediaExtract(json)).toBe(
      '相模原市（さがみはらし）は、神奈川県の北部に位置する政令指定都市。'
    );
  });

  it('pages が空配列なら null', () => {
    expect(parseWikipediaExtract({ query: { pages: [] } })).toBeNull();
  });

  it('extract フィールドが欠落していたら null', () => {
    const json = { query: { pages: [{ pageid: 1, title: 'x' }] } };
    expect(parseWikipediaExtract(json)).toBeNull();
  });

  it('missing フラグがあるページは null', () => {
    const json = {
      query: { pages: [{ title: '存在しない記事', missing: true }] },
    };
    expect(parseWikipediaExtract(json)).toBeNull();
  });

  it('query 自体が無いレスポンスは null', () => {
    expect(parseWikipediaExtract({})).toBeNull();
    expect(parseWikipediaExtract(null)).toBeNull();
  });

  it('extract が空文字なら null', () => {
    const json = { query: { pages: [{ extract: '' }] } };
    expect(parseWikipediaExtract(json)).toBeNull();
  });

  it('「。」を含まない短い extract は曖昧さ回避ページとみなして null', () => {
    // 例: 「緑区」だけで検索した時に返ってくる曖昧さ回避ページの本文
    const json = { query: { pages: [{ extract: '緑区（みどりく）' }] } };
    expect(parseWikipediaExtract(json)).toBeNull();
  });
});

describe('cleanExtract', () => {
  it('1500 字を超えたら切り詰めて末尾に … を付ける', () => {
    const longText = 'あ'.repeat(1600);
    const result = cleanExtract(longText);
    expect(result.length).toBe(1500 + 1); // 1500 字 + …
    expect(result.endsWith('…')).toBe(true);
  });

  it('1500 字以内ならそのまま返す', () => {
    const text = '相模原市は神奈川県の市である。';
    expect(cleanExtract(text)).toBe(text);
  });

  it('参考文献記号 [1] [12] [123] を除去する', () => {
    const text = '相模原市[1]は神奈川県[12]の市[123]である。';
    expect(cleanExtract(text)).toBe('相模原市は神奈川県の市である。');
  });

  it('改行を維持する', () => {
    const text = '一行目\n二行目\n三行目';
    expect(cleanExtract(text)).toBe(text);
  });

  it('null / undefined / 空文字は空文字を返す', () => {
    expect(cleanExtract(null)).toBe('');
    expect(cleanExtract(undefined)).toBe('');
    expect(cleanExtract('')).toBe('');
  });
});

describe('resolveWikipediaTitle', () => {
  it('attempt=0 は municipality をそのまま返す', () => {
    expect(resolveWikipediaTitle('相模原市', '神奈川県', 0)).toBe('相模原市');
    expect(resolveWikipediaTitle('緑区', '神奈川県', 0)).toBe('緑区');
  });

  it('attempt=1 は "{municipality} ({prefecture})" 形式でフォールバック', () => {
    expect(resolveWikipediaTitle('緑区', '神奈川県', 1)).toBe('緑区 (神奈川県)');
    expect(resolveWikipediaTitle('府中市', '東京都', 1)).toBe('府中市 (東京都)');
  });

  it('attempt が範囲外（>=2）なら null', () => {
    expect(resolveWikipediaTitle('相模原市', '神奈川県', 2)).toBeNull();
  });
});

describe('buildCacheKey', () => {
  it('muni_code を含むダミー URL の Request を返す', () => {
    const req = buildCacheKey('14153');
    expect(req).toBeInstanceOf(Request);
    expect(req.url).toBe('https://wikipedia-cache.internal/14153');
  });

  it('別の muni_code は別のキーになる', () => {
    const a = buildCacheKey('13104');
    const b = buildCacheKey('14153');
    expect(a.url).not.toBe(b.url);
  });
});
