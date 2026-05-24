/**
 * /api/conquests エンドポイントの POST/GET ハンドラ。
 *
 * - POST: フロントから受け取った踏破履歴 items を 1 件ずつ PutItem で書込む
 *   既存レコード（同じ muni_code）は ConditionExpression で skip し、written/skipped を集計
 * - GET:  踏破履歴全件を Query で取得して JSON 配列で返す
 *
 * Phase 13-2 / plan.md §13 / spec.md §14 参照。
 */
import { createDynamoClient, putConquestItem, queryAllConquests } from './dynamodb.js';

const MAX_ITEMS_PER_REQUEST = 100;
const REQUIRED_FIELDS = [
  'muni_code',
  'first_visit',
  'prefecture_code',
  'region_code',
  'name',
  'prefecture',
];

/**
 * フロントから受け取った body を検証する。
 *
 * @returns {{ok: true, items: object[]} | {ok: false, error: string}}
 */
export function validateConquestsBody(body) {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'body must be a JSON object' };
  }
  const items = body.items;
  if (!Array.isArray(items)) {
    return { ok: false, error: 'items must be an array' };
  }
  if (items.length === 0) {
    return { ok: false, error: 'items must be non-empty' };
  }
  if (items.length > MAX_ITEMS_PER_REQUEST) {
    return { ok: false, error: `items exceeds ${MAX_ITEMS_PER_REQUEST}` };
  }
  for (const [idx, item] of items.entries()) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: `items[${idx}] must be an object` };
    }
    for (const field of REQUIRED_FIELDS) {
      if (typeof item[field] !== 'string' || item[field].length === 0) {
        return { ok: false, error: `items[${idx}].${field} must be a non-empty string` };
      }
    }
  }
  return { ok: true, items };
}

/**
 * POST /api/conquests を処理する。
 *
 * @param {object} body - リクエスト Body（パース済）
 * @param {object} env - Workers env
 * @returns {Promise<{ok: true, written: number, skipped: number, errors: string[]} | {ok: false, status: number, error: string, detail?: string}>}
 */
export async function handleConquestsPost(body, env) {
  const validated = validateConquestsBody(body);
  if (!validated.ok) {
    return { ok: false, status: 400, error: 'invalid_request', detail: validated.error };
  }

  const client = createDynamoClient(env);
  let written = 0;
  let skipped = 0;
  const errors = [];

  for (const item of validated.items) {
    const result = await putConquestItem(client, item);
    if (result.written) {
      written++;
    } else if (result.skipped) {
      skipped++;
    } else {
      errors.push(`${item.muni_code}: ${result.error}`);
    }
  }

  if (errors.length > 0 && written === 0 && skipped === 0) {
    // 全件失敗 → サーバ側エラー扱い
    return { ok: false, status: 502, error: 'upstream_error', detail: errors.slice(0, 3).join('; ') };
  }

  return { ok: true, written, skipped, errors };
}

/**
 * GET /api/conquests を処理する。
 *
 * @param {object} env - Workers env
 * @returns {Promise<{ok: true, items: object[]} | {ok: false, status: number, error: string, detail?: string}>}
 */
export async function handleConquestsGet(env) {
  const client = createDynamoClient(env);
  const result = await queryAllConquests(client);
  if (!result.ok) {
    return { ok: false, status: 502, error: 'upstream_error', detail: result.detail };
  }
  return { ok: true, items: result.items };
}
