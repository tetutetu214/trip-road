#!/bin/bash
# wrangler dev が localhost:8787 で起動している前提で、4 つの curl テストを実行
# 使用: bash test_api_local.sh
set -euo pipefail

SRC=~/.secrets/trip-road.env
source "$SRC"

API=http://localhost:8787/api/describe
ORIGIN=http://localhost:8788

echo "=== 1. 正常リクエスト（200 + Anthropic 生成テキスト期待、約 $0.003 課金） ==="
curl -sv -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -H "Origin: $ORIGIN" \
  -d '{"prefecture":"神奈川県","municipality":"相模原市緑区","season":"spring"}' \
  2>&1 | grep -E "^(< HTTP|<|{|>)" | head -30
echo ""

echo "=== 2. 認証失敗（401 期待） ==="
curl -si -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: wrong_password" \
  -d '{"prefecture":"神奈川県","municipality":"相模原市緑区","season":"spring"}' \
  | head -8
echo ""

echo "=== 3. バリデーション失敗（400 + missing municipality 期待） ==="
curl -si -X POST "$API" \
  -H "Content-Type: application/json" \
  -H "X-App-Password: $APP_PASSWORD" \
  -d '{"prefecture":"神奈川県"}' \
  | head -8
echo ""

echo "=== 4. CORS プリフライト（204 + Access-Control-Allow-Origin 期待） ==="
curl -si -X OPTIONS "$API" \
  -H "Origin: $ORIGIN" \
  -H "Access-Control-Request-Method: POST" \
  | head -8
echo ""

echo "=== 完了 ==="
