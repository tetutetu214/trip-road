import { describe, it, expect } from 'vitest';
import { generateS3Key } from '../src/aws.js';

describe('generateS3Key', () => {
  it('日付ベースのパーティションキーを生成', () => {
    const date = new Date('2026-04-25T10:00:00Z');
    const key = generateS3Key(date, 'test-batch-id');
    expect(key).toBe('year=2026/month=04/day=25/test-batch-id.json');
  });

  it('batchId 省略時は UUID 自動生成', () => {
    const date = new Date('2026-04-25T10:00:00Z');
    const key = generateS3Key(date);
    expect(key).toMatch(/^year=2026\/month=04\/day=25\/[0-9a-f-]+\.json$/);
  });

  it('月日が 1 桁でも 0 パディング', () => {
    const date = new Date('2026-01-05T10:00:00Z');
    const key = generateS3Key(date, 'x');
    expect(key).toBe('year=2026/month=01/day=05/x.json');
  });
});
