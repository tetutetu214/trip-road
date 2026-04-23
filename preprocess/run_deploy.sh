#!/bin/bash
# Cloudflare Pages (trip-road-data) へのデプロイ + 動作確認
# 使用: bash run_deploy.sh （preprocess/ ディレクトリ内で実行）
set -euo pipefail

cd "$(dirname "$0")"

PROJECT_NAME="trip-road-data"
DEPLOY_URL="https://${PROJECT_NAME}.pages.dev"

echo "=== 1. Cloudflare Pages プロジェクト作成（既存なら skip） ==="
wrangler pages project create "${PROJECT_NAME}" --production-branch main 2>&1 \
  | tee /tmp/wrangler_create.log \
  || echo "(プロジェクトが既に存在するようです。deploy に進みます)"

echo ""
echo "=== 2. Deploy (--branch=main で production 扱いに) ==="
wrangler pages deploy out/ --project-name="${PROJECT_NAME}" --branch=main --commit-dirty=true

echo ""
echo "=== 3. エッジ反映まで 5 秒待機 ==="
sleep 5

echo ""
echo "=== 4. 動作確認: 千代田区 (13101) ==="
curl -s -o /dev/null -w "HTTP %{http_code}, size %{size_download} bytes\n" \
  "${DEPLOY_URL}/municipalities/13101.geojson"

echo ""
echo "=== 5. 動作確認: adjacency.json 先頭 ==="
curl -s "${DEPLOY_URL}/adjacency.json" | head -c 300
echo ""
echo ""

echo "=== 完了 ==="
echo "デプロイ URL: ${DEPLOY_URL}"
