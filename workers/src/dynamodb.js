/**
 * AWS DynamoDB ラッパー（SigV4 署名は aws4fetch が担当）。
 *
 * Phase 13-2: 踏破履歴 (trip-road-conquests テーブル) への
 * PutItem / BatchWriteItem / Query を提供する。
 *
 * AWS DynamoDB REST API（X-Amz-Target ベース）を直接叩く。SDK は使わない
 * （Workers 環境でのバンドルサイズを抑える狙い）。
 *
 * PK は user_id 固定値 "tetutetu"（plan.md §13.5 / spec.md §14.5 参照）。
 * 将来 Cognito 導入時には USER_ID を引数で受け取る形に拡張する。
 */
import { AwsClient } from 'aws4fetch';

const USER_ID = 'tetutetu';

/**
 * DynamoDB クライアント（aws4fetch ラップ）を作る。
 *
 * @param {object} env - Workers env（AWS_* と AWS_REGION を含む）
 * @returns {{aws: AwsClient, endpoint: string, tableName: string, region: string}}
 */
export function createDynamoClient(env) {
  const region = env.AWS_REGION;
  return {
    aws: new AwsClient({
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      service: 'dynamodb',
      region,
    }),
    endpoint: `https://dynamodb.${region}.amazonaws.com/`,
    tableName: env.DYNAMODB_CONQUESTS_TABLE,
    region,
  };
}

/**
 * 踏破履歴 1 件を PutItem で書き込む。既存レコードは ConditionExpression で skip。
 *
 * @param {ReturnType<typeof createDynamoClient>} client
 * @param {object} item - { muni_code, first_visit, prefecture_code, region_code, name, prefecture }
 * @returns {Promise<{written: boolean, skipped: boolean, error?: string}>}
 */
export async function putConquestItem(client, item) {
  const body = {
    TableName: client.tableName,
    Item: {
      user_id: { S: USER_ID },
      muni_code: { S: item.muni_code },
      first_visit: { S: item.first_visit },
      prefecture_code: { S: item.prefecture_code },
      region_code: { S: item.region_code },
      name: { S: item.name },
      prefecture: { S: item.prefecture },
      created_at: { S: new Date().toISOString() },
    },
    ConditionExpression: 'attribute_not_exists(user_id)',
  };

  const res = await client.aws.fetch(client.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.0',
      'X-Amz-Target': 'DynamoDB_20120810.PutItem',
    },
    body: JSON.stringify(body),
  });

  if (res.ok) {
    return { written: true, skipped: false };
  }

  // ConditionalCheckFailedException = 既存レコードあり、skip 扱い
  const text = await res.text();
  if (res.status === 400 && text.includes('ConditionalCheckFailedException')) {
    return { written: false, skipped: true };
  }
  return { written: false, skipped: false, error: `${res.status} ${text.slice(0, 200)}` };
}

/**
 * 全踏破履歴を Query で取得（PK=USER_ID）。LastEvaluatedKey 対応で全件を返す。
 *
 * @param {ReturnType<typeof createDynamoClient>} client
 * @returns {Promise<{ok: true, items: object[]} | {ok: false, status: number, detail: string}>}
 */
export async function queryAllConquests(client) {
  const items = [];
  let exclusiveStartKey = null;

  // ページング: LastEvaluatedKey がなくなるまで繰り返す
  // 1900 件 × 200B ≒ 380KB なので通常 1 ページで終わるが、念のため対応
  while (true) {
    const body = {
      TableName: client.tableName,
      KeyConditionExpression: 'user_id = :uid',
      ExpressionAttributeValues: { ':uid': { S: USER_ID } },
    };
    if (exclusiveStartKey) {
      body.ExclusiveStartKey = exclusiveStartKey;
    }

    const res = await client.aws.fetch(client.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-amz-json-1.0',
        'X-Amz-Target': 'DynamoDB_20120810.Query',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, status: res.status, detail: text.slice(0, 200) };
    }

    const data = await res.json();
    for (const it of data.Items || []) {
      items.push(unmarshallConquestItem(it));
    }

    if (!data.LastEvaluatedKey) break;
    exclusiveStartKey = data.LastEvaluatedKey;
  }

  return { ok: true, items };
}

/**
 * DynamoDB JSON 形式（型タグ付き）を素の JS オブジェクトに変換。
 * trip-road の踏破履歴では S 型属性のみを扱う前提。
 */
export function unmarshallConquestItem(item) {
  return {
    muni_code: item.muni_code.S,
    first_visit: item.first_visit.S,
    prefecture_code: item.prefecture_code.S,
    region_code: item.region_code.S,
    name: item.name.S,
    prefecture: item.prefecture.S,
    created_at: item.created_at.S,
  };
}
