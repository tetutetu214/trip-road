#!/bin/bash
# Workers Secret の ALLOWED_ORIGIN を独自ドメインに更新する
# 使用: bash update_allowed_origin.sh （workers/ ディレクトリ内で実行）
set -euo pipefail

cd "$(dirname "$0")"

NEW_ORIGIN="https://trip-road.tetutetu214.com"

echo "=== ALLOWED_ORIGIN を ${NEW_ORIGIN} に更新 ==="
printf '%s' "$NEW_ORIGIN" | wrangler secret put ALLOWED_ORIGIN

echo ""
echo "=== 現在の Secrets 一覧 ==="
wrangler secret list

echo ""
echo "=== 確認 ==="
echo "ALLOWED_ORIGIN is now set to: ${NEW_ORIGIN}"
echo ""
echo "この変更後、API は以下のオリジンから呼ばれた時のみ CORS で許可します:"
echo "  - https://trip-road.tetutetu214.com"
echo ""
echo "curl での動作確認（-H \"Origin: https://trip-road.tetutetu214.com\" を付ける）:"
echo "  curl -sv -X POST https://trip-road-api.tetutetu214.com/api/describe \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -H \"X-App-Password: \$APP_PASSWORD\" \\"
echo "    -H 'Origin: https://trip-road.tetutetu214.com' \\"
echo "    -d '{\"prefecture\":\"神奈川県\",\"municipality\":\"相模原市緑区\",\"season\":\"spring\"}'"
