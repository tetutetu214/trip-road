#!/bin/bash
# trip-road Worker 用 AWS アクセスキーのローテーションスクリプト（Issue #76）
#
# 使い方: bash workers/rotate_aws_key.sh
#
# 前提:
#   - aws login 済み（IAM 操作はローカルの短期トークンで行う）
#   - ~/.secrets/trip-road.env に APP_PASSWORD / IAM_USER_NAME がある
#
# 手順（途中で失敗したら旧キーは残るので安全側に倒れる）:
#   1. 既存キーが 1 本であることを確認（IAM は 1 ユーザー最大 2 本）
#   2. 新キーを作成（値は画面に出さない）
#   3. Workers Secrets（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY）を更新
#   4. 本番 curl で検証（/api/describe = Bedrock 経路、/api/conquests = DynamoDB 経路）
#   5. ~/.secrets/trip-road.env のキー値を新キーに書き換え（バックアップ作成）
#   6. 旧キーを無効化 → 再検証 → 削除

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SECRETS_PATH="${HOME}/.secrets/trip-road.env"
API_BASE="https://trip-road-api.tetutetu214.com"

die() { echo "エラー: $1" >&2; exit 1; }

[ -f "$SECRETS_PATH" ] || die "$SECRETS_PATH が見つかりません"
command -v jq >/dev/null || die "jq が必要です"
aws sts get-caller-identity >/dev/null 2>&1 || die "AWS 認証がありません。先に aws login を実行してください"

# IAM ユーザー名はリポジトリにベタ書きしない（env から読む）
IAM_USER=$(grep -E '^IAM_USER_NAME=' "$SECRETS_PATH" | head -1 | cut -d= -f2-)
APP_PASSWORD=$(grep -E '^APP_PASSWORD=' "$SECRETS_PATH" | head -1 | cut -d= -f2-)
[ -n "$IAM_USER" ] || die "$SECRETS_PATH に IAM_USER_NAME がありません（Worker 用 IAM ユーザー名を追記してください）"
[ -n "$APP_PASSWORD" ] || die "$SECRETS_PATH に APP_PASSWORD がありません"

# 本番 API の疎通検証（Bedrock + DynamoDB の両経路を新旧キーの確認に使う）
verify_prod() {
  local code1 code2
  code1=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/api/describe" \
    -H 'Content-Type: application/json' -H "X-App-Password: $APP_PASSWORD" \
    -d '{"prefecture":"神奈川県","municipality":"鎌倉市","muniCode":"14204"}')
  code2=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/api/conquests" \
    -H "X-App-Password: $APP_PASSWORD")
  echo "  /api/describe: $code1 / /api/conquests: $code2"
  [ "$code1" = "200" ] && [ "$code2" = "200" ]
}

echo "=== 1. 既存キーの確認 ==="
KEY_COUNT=$(aws iam list-access-keys --user-name "$IAM_USER" --query 'length(AccessKeyMetadata)' --output text)
[ "$KEY_COUNT" = "1" ] || die "キーが ${KEY_COUNT} 本あります。1 本の状態で実行してください（前回のローテーションが中断した可能性）"
OLD_KEY_ID=$(aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[0].AccessKeyId' --output text)
echo "  旧キー: ...${OLD_KEY_ID: -4}（末尾4文字のみ表示）"

echo "=== 2. 新キーの作成 ==="
NEW_KEY_JSON=$(aws iam create-access-key --user-name "$IAM_USER")
NEW_KEY_ID=$(echo "$NEW_KEY_JSON" | jq -r '.AccessKey.AccessKeyId')
NEW_SECRET=$(echo "$NEW_KEY_JSON" | jq -r '.AccessKey.SecretAccessKey')
unset NEW_KEY_JSON
echo "  新キー: ...${NEW_KEY_ID: -4}（末尾4文字のみ表示）"
echo "  IAM の伝播待ち（10 秒）..."
sleep 10

echo "=== 3. Workers Secrets の更新 ==="
cd "$SCRIPT_DIR"
printf '%s' "$NEW_KEY_ID" | wrangler secret put AWS_ACCESS_KEY_ID
printf '%s' "$NEW_SECRET" | wrangler secret put AWS_SECRET_ACCESS_KEY

echo "=== 4. 本番検証（新キー）==="
sleep 5
if ! verify_prod; then
  echo "検証失敗。旧キーは無傷なので、Workers Secrets を旧キーに戻すか調査してください" >&2
  echo "新キー ...${NEW_KEY_ID: -4} を削除する場合: aws iam delete-access-key --user-name $IAM_USER --access-key-id <新キーID>" >&2
  exit 1
fi

echo "=== 5. ローカル env の書き換え ==="
cp "$SECRETS_PATH" "${SECRETS_PATH}.bak" && chmod 600 "${SECRETS_PATH}.bak"
sed -i "s|^AWS_ACCESS_KEY_ID=.*|AWS_ACCESS_KEY_ID=${NEW_KEY_ID}|" "$SECRETS_PATH"
sed -i "s|^AWS_SECRET_ACCESS_KEY=.*|AWS_SECRET_ACCESS_KEY=${NEW_SECRET}|" "$SECRETS_PATH"
unset NEW_SECRET
echo "  ${SECRETS_PATH} を更新（バックアップ: .bak）"

echo "=== 6. 旧キーの無効化 → 再検証 → 削除 ==="
aws iam update-access-key --user-name "$IAM_USER" --access-key-id "$OLD_KEY_ID" --status Inactive
sleep 5
if ! verify_prod; then
  echo "旧キー無効化後に検証失敗。旧キーを再有効化します" >&2
  aws iam update-access-key --user-name "$IAM_USER" --access-key-id "$OLD_KEY_ID" --status Active
  exit 1
fi
aws iam delete-access-key --user-name "$IAM_USER" --access-key-id "$OLD_KEY_ID"
echo "  旧キー ...${OLD_KEY_ID: -4} を削除しました"

echo ""
echo "=== ローテーション完了 ==="
aws iam list-access-keys --user-name "$IAM_USER" --query 'AccessKeyMetadata[].{Status:Status,Created:CreateDate}' --output table
