import { describe, it, expect } from 'vitest';
import { buildMessagesRequest, solarTermToJa, parseDescribeRequest } from '../src/anthropic.js';

describe('solarTermToJa', () => {
  it('"01" を 立春 に変換', () => {
    expect(solarTermToJa('01')).toBe('立春');
  });
  it('"07" を 立夏 に変換', () => {
    expect(solarTermToJa('07')).toBe('立夏');
  });
  it('"16" を 秋分 に変換', () => {
    expect(solarTermToJa('16')).toBe('秋分');
  });
  it('"22" を 冬至 に変換', () => {
    expect(solarTermToJa('22')).toBe('冬至');
  });
  it('"24" を 大寒 に変換', () => {
    expect(solarTermToJa('24')).toBe('大寒');
  });
  it('未知の値は undefined', () => {
    expect(solarTermToJa('25')).toBeUndefined();
    expect(solarTermToJa('00')).toBeUndefined();
    expect(solarTermToJa('1')).toBeUndefined();   // ゼロ詰めなし
    expect(solarTermToJa('spring')).toBeUndefined();  // 旧キー
  });
});

describe('parseDescribeRequest', () => {
  it('有効な JSON を parse して 3 フィールドを返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', solar_term: '07' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(body);
  });

  it('prefecture が欠落したら error を返す', () => {
    const body = { municipality: '相模原市緑区', solar_term: '07' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('prefecture');
  });

  it('municipality が欠落したら error を返す', () => {
    const body = { prefecture: '神奈川県', solar_term: '07' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('municipality');
  });

  it('solar_term が欠落したら error を返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('solar_term');
  });

  it('solar_term が無効な値なら error を返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', solar_term: '25' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('solar_term');
  });

  it('旧 season キー（spring 等）は受け付けない', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', season: 'spring' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('solar_term');
  });
});

describe('buildMessagesRequest', () => {
  it('Anthropic Messages API 互換 JSON をビルドする（立夏）', () => {
    const req = buildMessagesRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      solar_term: '07',
    });
    expect(req.model).toBe('claude-haiku-4-5-20251001');
    expect(req.max_tokens).toBe(400);
    expect(req.system).toContain('観光ガイド');
    expect(req.system).toContain('120〜180字');
    expect(req.system).toContain('二十四節気');
    expect(req.system).toContain('地名');
    expect(req.system).toContain('歴史');
    expect(req.system).toContain('地形');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content).toContain('神奈川県');
    expect(req.messages[0].content).toContain('相模原市緑区');
    expect(req.messages[0].content).toContain('立夏');
    expect(req.messages[0].content).toContain('07');
  });

  it('user content に節気名と番号の両方を含める', () => {
    const req = buildMessagesRequest({
      prefecture: '北海道',
      municipality: '函館市',
      solar_term: '22',
    });
    expect(req.messages[0].content).toContain('冬至');
    expect(req.messages[0].content).toContain('22');
  });
});
