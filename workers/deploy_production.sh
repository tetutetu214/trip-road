#!/bin/bash
# Workers Secrets 登録 + 本番デプロイ + E2E curl 検証
# 使用: bash deploy_production.sh （workers/ ディレクトリ内で実行）
# 前提: ~/.secrets/trip-road.env に APP_PASSWORD / AWS_* / S3_* 設定済
#       Plan H 以降、ANTHROPIC_API_KEY は不要（撤廃）
set -euo pipefail

cd "$(dirname "$0")"

SRC=~/.secrets/trip-road.env
if [ ! -f "$SRC" ]; then
  echo "エラー: $SRC が見つかりません。"
  exit 1
fi
source "$SRC"

# 本番フロントは独自ドメイン（update_allowed_origin.sh と整合）
ALLOWED_ORIGIN_PROD="https://trip-road.tetutetu214.com"

echo "=== 1. Workers Secrets 登録（既存なら上書き） ==="
echo ""

echo "--- APP_PASSWORD を登録 ---"
printf '%s' "$APP_PASSWORD" | wrangler secret put APP_PASSWORD
echo ""

# Plan H: Generator / Judge とも Bedrock Nova Pro 経由になり、ANTHROPIC_API_KEY は不要。
# 既に登録済みのキーは本デプロイ後に `wrangler secret delete ANTHROPIC_API_KEY` で削除する。

echo "--- ALLOWED_ORIGIN を登録（Plan C のフロント URL 想定） ---"
printf '%s' "$ALLOWED_ORIGIN_PROD" | wrangler secret put ALLOWED_ORIGIN
echo ""

echo "=== 2. 登録済 Secrets 一覧 ==="
wrangler secret list
echo ""

echo "=== 3. 本番デプロイ ==="
# 初回デプロイの場合、workers.dev subdomain 設定を聞かれる可能性あり
DEPLOY_OUTPUT=$(wrangler deploy 2>&1)
echo "$DEPLOY_OUTPUT"
echo ""

# デプロイ URL を抽出
WORKER_URL=$(echo "$DEPLOY_OUTPUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
if [ -z "$WORKER_URL" ]; then
  echo "警告: デプロイ URL の自動抽出に失敗しました。上の出力から手動で確認してください。"
  echo "その後、以下を実行:"
  echo "  WORKER_URL=<実 URL> bash test_api_prod.sh"
  exit 0
fi

echo "=== 4. デプロイ URL ==="
echo "$WORKER_URL"
echo ""

echo "=== 5. エッジ反映まで 5 秒待機 ==="
sleep 5

echo "=== 6. 本番 E2E テスト ==="
echo ""

echo "--- テスト1: 正常リクエスト（200 + Bedrock Nova Pro 出力期待、約 \$0.001〜0.005 課金） ---"
# -si で APP_PASSWORD を含む request ヘッダを画面に出さない（-sv は禁止）
# Plan I 以降は solar_term 廃止、リクエスト body は prefecture / municipality のみ
curl -si -X POST "${WORKER_URL}/api/describe" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -H "Origin: $ALLOWED_ORIGIN_PROD" \
  -d '{"prefecture":"神奈川県","municipality":"鎌倉市"}' \
  | head -40
echo ""

echo "--- テスト2: 認証失敗（401 期待） ---"
curl -si -X POST "${WORKER_URL}/api/describe" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: wrong_password" \
  -d '{}' \
  | head -8
echo ""

echo "--- テスト3: 404 (別パス) ---"
curl -si -X POST "${WORKER_URL}/api/unknown" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -d '{}' \
  | head -5
echo ""

echo "=== 完了 ==="
echo "本番 Worker URL: $WORKER_URL"
echo "Plan C のフロントはこの URL を fetch 対象とします"
