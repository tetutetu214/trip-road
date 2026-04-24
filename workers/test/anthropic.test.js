import { describe, it, expect } from 'vitest';
import { buildMessagesRequest, seasonToJa, parseDescribeRequest } from '../src/anthropic.js';

describe('seasonToJa', () => {
  it('spring を 春 に変換', () => {
    expect(seasonToJa('spring')).toBe('春');
  });
  it('summer を 夏 に変換', () => {
    expect(seasonToJa('summer')).toBe('夏');
  });
  it('autumn を 秋 に変換', () => {
    expect(seasonToJa('autumn')).toBe('秋');
  });
  it('winter を 冬 に変換', () => {
    expect(seasonToJa('winter')).toBe('冬');
  });
  it('未知の季節は undefined', () => {
    expect(seasonToJa('unknown')).toBeUndefined();
  });
});

describe('parseDescribeRequest', () => {
  it('有効な JSON を parse して 3 フィールドを返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', season: 'spring' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(body);
  });

  it('prefecture が欠落したら error を返す', () => {
    const body = { municipality: '相模原市緑区', season: 'spring' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('prefecture');
  });

  it('municipality が欠落したら error を返す', () => {
    const body = { prefecture: '神奈川県', season: 'spring' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('municipality');
  });

  it('season が欠落したら error を返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('season');
  });

  it('season が無効な値なら error を返す', () => {
    const body = { prefecture: '神奈川県', municipality: '相模原市緑区', season: 'autumn2' };
    const result = parseDescribeRequest(body);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('season');
  });
});

describe('buildMessagesRequest', () => {
  it('Anthropic Messages API 互換 JSON をビルドする', () => {
    const req = buildMessagesRequest({
      prefecture: '神奈川県',
      municipality: '相模原市緑区',
      season: 'spring',
    });
    expect(req.model).toBe('claude-haiku-4-5-20251001');
    expect(req.max_tokens).toBe(400);
    expect(req.system).toContain('観光ガイド');
    expect(req.system).toContain('120〜180字');
    expect(req.messages).toHaveLength(1);
    expect(req.messages[0].role).toBe('user');
    expect(req.messages[0].content).toContain('神奈川県');
    expect(req.messages[0].content).toContain('相模原市緑区');
    expect(req.messages[0].content).toContain('春');
  });
});
