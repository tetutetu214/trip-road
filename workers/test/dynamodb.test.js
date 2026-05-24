import { describe, it, expect } from 'vitest';
import { unmarshallConquestItem } from '../src/dynamodb.js';

describe('unmarshallConquestItem', () => {
  it('S 型タグ付き DynamoDB JSON を素のオブジェクトに変換する', () => {
    const dynamoItem = {
      user_id: { S: 'tetutetu' },
      muni_code: { S: '14216' },
      first_visit: { S: '2026-05-23T11:32:45.123Z' },
      prefecture_code: { S: '14' },
      region_code: { S: 'kanto' },
      name: { S: '綾瀬市' },
      prefecture: { S: '神奈川県' },
      created_at: { S: '2026-05-24T08:30:00.000Z' },
    };

    const result = unmarshallConquestItem(dynamoItem);

    expect(result).toEqual({
      muni_code: '14216',
      first_visit: '2026-05-23T11:32:45.123Z',
      prefecture_code: '14',
      region_code: 'kanto',
      name: '綾瀬市',
      prefecture: '神奈川県',
      created_at: '2026-05-24T08:30:00.000Z',
    });
  });

  it('user_id を返却から除外する（フロントは PK 値を意識しない設計）', () => {
    const result = unmarshallConquestItem({
      user_id: { S: 'tetutetu' },
      muni_code: { S: '01101' },
      first_visit: { S: '2026-01-01T00:00:00.000Z' },
      prefecture_code: { S: '01' },
      region_code: { S: 'hokkaido' },
      name: { S: '札幌市中央区' },
      prefecture: { S: '北海道' },
      created_at: { S: '2026-01-02T00:00:00.000Z' },
    });
    expect(result).not.toHaveProperty('user_id');
  });

  it('日本語の都道府県名・市町村名を正しく扱う', () => {
    const result = unmarshallConquestItem({
      user_id: { S: 'tetutetu' },
      muni_code: { S: '47201' },
      first_visit: { S: '2026-03-15T09:00:00.000Z' },
      prefecture_code: { S: '47' },
      region_code: { S: 'kyushu' },
      name: { S: '那覇市' },
      prefecture: { S: '沖縄県' },
      created_at: { S: '2026-03-16T00:00:00.000Z' },
    });
    expect(result.name).toBe('那覇市');
    expect(result.prefecture).toBe('沖縄県');
  });
});
