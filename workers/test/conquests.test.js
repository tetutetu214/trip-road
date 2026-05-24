import { describe, it, expect, beforeEach, vi } from 'vitest';

// dynamodb モジュールをモック化（aws4fetch を介さずに振る舞いを制御）
vi.mock('../src/dynamodb.js', () => ({
  createDynamoClient: vi.fn(() => ({ tableName: 'test', endpoint: 'http://test', aws: {}, region: 'us-east-1' })),
  putConquestItem: vi.fn(),
  queryAllConquests: vi.fn(),
}));

import { validateConquestsBody, handleConquestsPost, handleConquestsGet } from '../src/conquests.js';
import { putConquestItem, queryAllConquests } from '../src/dynamodb.js';

const VALID_ITEM = {
  muni_code: '14216',
  first_visit: '2026-05-23T11:32:45.123Z',
  prefecture_code: '14',
  region_code: 'kanto',
  name: '綾瀬市',
  prefecture: '神奈川県',
};

const env = {
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  AWS_REGION: 'us-east-1',
  DYNAMODB_CONQUESTS_TABLE: 'trip-road-conquests',
};

describe('validateConquestsBody', () => {
  it('正常な items 配列を受理する', () => {
    const result = validateConquestsBody({ items: [VALID_ITEM] });
    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('body が null なら拒否', () => {
    const result = validateConquestsBody(null);
    expect(result.ok).toBe(false);
  });

  it('items が配列でなければ拒否', () => {
    const result = validateConquestsBody({ items: 'not an array' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/array/);
  });

  it('items が空配列なら拒否', () => {
    const result = validateConquestsBody({ items: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/non-empty/);
  });

  it('items が 100 件超なら拒否', () => {
    const items = Array.from({ length: 101 }, () => VALID_ITEM);
    const result = validateConquestsBody({ items });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds 100/);
  });

  it('必須フィールド欠落を検出', () => {
    const incomplete = { ...VALID_ITEM };
    delete incomplete.muni_code;
    const result = validateConquestsBody({ items: [incomplete] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/muni_code/);
  });

  it('空文字列のフィールドを拒否', () => {
    const item = { ...VALID_ITEM, region_code: '' };
    const result = validateConquestsBody({ items: [item] });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/region_code/);
  });
});

describe('handleConquestsPost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('items 配列バリデーション失敗時は 400', async () => {
    const result = await handleConquestsPost({ items: [] }, env);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toBe('invalid_request');
  });

  it('DynamoDB 書込成功時は written カウンタを増やす', async () => {
    putConquestItem.mockResolvedValue({ written: true, skipped: false });
    const result = await handleConquestsPost({ items: [VALID_ITEM] }, env);
    expect(result.ok).toBe(true);
    expect(result.written).toBe(1);
    expect(result.skipped).toBe(0);
  });

  it('ConditionalCheckFailedException は skipped 扱い', async () => {
    putConquestItem.mockResolvedValue({ written: false, skipped: true });
    const result = await handleConquestsPost({ items: [VALID_ITEM] }, env);
    expect(result.ok).toBe(true);
    expect(result.written).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it('全件 DynamoDB エラーなら 502', async () => {
    putConquestItem.mockResolvedValue({ written: false, skipped: false, error: '500 Internal' });
    const result = await handleConquestsPost({ items: [VALID_ITEM] }, env);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe('upstream_error');
  });

  it('書込・skip 混在時は ok=true で errors 配列が空でないこともある', async () => {
    putConquestItem
      .mockResolvedValueOnce({ written: true, skipped: false })
      .mockResolvedValueOnce({ written: false, skipped: false, error: 'transient' });
    const result = await handleConquestsPost(
      { items: [VALID_ITEM, { ...VALID_ITEM, muni_code: '14217' }] },
      env,
    );
    expect(result.ok).toBe(true);
    expect(result.written).toBe(1);
    expect(result.errors).toHaveLength(1);
  });

  it('1 リクエストの items は順次 putConquestItem で書込まれる', async () => {
    putConquestItem.mockResolvedValue({ written: true, skipped: false });
    await handleConquestsPost(
      { items: [VALID_ITEM, { ...VALID_ITEM, muni_code: '14217' }] },
      env,
    );
    expect(putConquestItem).toHaveBeenCalledTimes(2);
  });
});

describe('handleConquestsGet', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queryAllConquests の結果を items として返す', async () => {
    const mockItems = [
      {
        muni_code: '14216',
        first_visit: '2026-05-23T11:32:45.123Z',
        prefecture_code: '14',
        region_code: 'kanto',
        name: '綾瀬市',
        prefecture: '神奈川県',
        created_at: '2026-05-24T08:30:00.000Z',
      },
    ];
    queryAllConquests.mockResolvedValue({ ok: true, items: mockItems });
    const result = await handleConquestsGet(env);
    expect(result.ok).toBe(true);
    expect(result.items).toEqual(mockItems);
  });

  it('queryAllConquests がエラーなら 502 を返す', async () => {
    queryAllConquests.mockResolvedValue({ ok: false, status: 500, detail: 'Internal' });
    const result = await handleConquestsGet(env);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toBe('upstream_error');
  });

  it('空 items でも ok=true で空配列を返す', async () => {
    queryAllConquests.mockResolvedValue({ ok: true, items: [] });
    const result = await handleConquestsGet(env);
    expect(result.ok).toBe(true);
    expect(result.items).toEqual([]);
  });
});
