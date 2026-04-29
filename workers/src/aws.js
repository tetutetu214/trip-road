/**
 * AWS S3 PUT ラッパー（SigV4 署名は aws4fetch が担当）。
 *
 * Plan D Stage 2: フロントから受け取ったテレメトリ entry 配列を
 * year=YYYY/month=MM/day=DD/<uuid>.json の形で S3 に永続化する。
 */
import { AwsClient } from 'aws4fetch';

/**
 * S3 にオブジェクトを PUT する。
 *
 * @param {object} env - Workers env（AWS_* と S3_TELEMETRY_BUCKET を含む）
 * @param {string} key - S3 キー（パス）
 * @param {string} body - JSON 文字列
 * @returns {Promise<{ok: true} | {ok: false, status: number, detail: string}>}
 */
export async function putToS3(env, key, body) {
  const aws = new AwsClient({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    service: 's3',
    region: env.AWS_REGION,
  });

  const url = `https://${env.S3_TELEMETRY_BUCKET}.s3.${env.AWS_REGION}.amazonaws.com/${key}`;
  const res = await aws.fetch(url, {
    method: 'PUT',
    body,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, status: res.status, detail: text.slice(0, 200) };
  }
  return { ok: true };
}

/**
 * 日付ベースのプレフィックス + バッチ ID で S3 キーを生成。
 *
 * Athena の partition projection が WHERE year/month/day で
 * prefix scan するための形式。UTC ベースで揃える。
 *
 * @param {Date} [date] - 既定は現在時刻（UTC）
 * @param {string} [batchId] - 既定は crypto.randomUUID()
 * @returns {string} 例: "year=2026/month=04/day=25/<uuid>.json"
 */
export function generateS3Key(date = new Date(), batchId = null) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const id = batchId || crypto.randomUUID();
  return `year=${y}/month=${m}/day=${d}/${id}.json`;
}
