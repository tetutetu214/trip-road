#!/bin/bash
# 独自ドメイン (tetutetu214.com) 経由の Pages/Workers 動作確認
# 使用: bash verify_custom_domains.sh （workers/ ディレクトリ内で実行）
# 前提:
#   - Cloudflare Dashboard で trip-road-data と trip-road-api に独自ドメイン紐付け済
#   - ALLOWED_ORIGIN を https://trip-road.tetutetu214.com に更新済（update_allowed_origin.sh）
set -euo pipefail

cd "$(dirname "$0")"

source ~/.secrets/trip-road.env

DATA_URL="https://trip-road-data.tetutetu214.com"
API_URL="https://trip-road-api.tetutetu214.com"
FRONT_ORIGIN="https://trip-road.tetutetu214.com"

echo "=== 1. データ Pages 独自ドメイン（千代田区 GeoJSON 取得） ==="
curl -s -o /dev/null -w "HTTP %{http_code}, size %{size_download} bytes\n" \
  "${DATA_URL}/municipalities/13101.geojson"
echo ""

echo "=== 2. データ Pages 独自ドメイン（adjacency.json 取得） ==="
curl -s -o /dev/null -w "HTTP %{http_code}, size %{size_download} bytes\n" \
  "${DATA_URL}/adjacency.json"
echo ""

echo "=== 3. Workers API 独自ドメイン（正常リクエスト、200 期待、約 \$0.003 課金） ==="
# status code と body を順に表示
HTTP_CODE=$(curl -s -o /tmp/api_resp.json -w '%{http_code}' -X POST "${API_URL}/api/describe" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -H "Origin: $FRONT_ORIGIN" \
  -d '{"prefecture":"神奈川県","municipality":"相模原市緑区","season":"spring"}')
echo "HTTP Status: $HTTP_CODE"
echo "Response body:"
cat /tmp/api_resp.json
echo ""
echo ""

echo "=== 4. Workers API 独自ドメイン（認証失敗、401 期待） ==="
curl -si -X POST "${API_URL}/api/describe" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: wrong_password" \
  -d '{}' \
  | head -3
echo ""

echo "=== 5. Workers API CORS プリフライト（204 期待、Origin 許可確認） ==="
curl -si -X OPTIONS "${API_URL}/api/describe" \
  -H "Origin: $FRONT_ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  | head -8
echo ""

echo "=== 完了 ==="
echo "  Data Pages:   ${DATA_URL}"
echo "  Workers API:  ${API_URL}"
echo "  Frontend:     ${FRONT_ORIGIN}（Plan C で作成予定）"
