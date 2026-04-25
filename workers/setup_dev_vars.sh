#!/bin/bash
# ローカル開発用の .dev.vars を ~/.secrets/trip-road.env から生成する
# 使用: bash setup_dev_vars.sh （workers/ ディレクトリ内で実行）
# 結果: workers/.dev.vars（gitignore 済、コミットされない）
set -euo pipefail

cd "$(dirname "$0")"

SRC=~/.secrets/trip-road.env
if [ ! -f "$SRC" ]; then
  echo "エラー: $SRC が見つかりません。Plan A Phase 0 Task 3 で作成したはずです。"
  exit 1
fi

# 各値を抽出
APP_PASSWORD=$(grep '^APP_PASSWORD=' "$SRC" | cut -d= -f2)
ANTHROPIC_API_KEY=$(grep '^ANTHROPIC_API_KEY=' "$SRC" | cut -d= -f2)
# Plan D Stage 2: AWS Telemetry Sink 用変数（未設定なら空のまま）
AWS_ACCESS_KEY_ID=$(grep '^AWS_ACCESS_KEY_ID=' "$SRC" | cut -d= -f2 || true)
AWS_SECRET_ACCESS_KEY=$(grep '^AWS_SECRET_ACCESS_KEY=' "$SRC" | cut -d= -f2 || true)
AWS_REGION=$(grep '^AWS_REGION=' "$SRC" | cut -d= -f2 || true)
S3_TELEMETRY_BUCKET=$(grep '^S3_TELEMETRY_BUCKET=' "$SRC" | cut -d= -f2 || true)

# ローカル動作確認用のオリジンは localhost
cat > .dev.vars <<EOF
APP_PASSWORD=${APP_PASSWORD}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ALLOWED_ORIGIN=http://localhost:8788
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:-}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY:-}
AWS_REGION=${AWS_REGION:-us-east-1}
S3_TELEMETRY_BUCKET=${S3_TELEMETRY_BUCKET:-}
EOF

chmod 600 .dev.vars

echo "=== .dev.vars 作成完了 ==="
echo "場所: $(pwd)/.dev.vars"
echo "権限: $(stat -c '%a' .dev.vars)"
echo "中身（値はマスク）:"
echo "  APP_PASSWORD=${APP_PASSWORD:0:4}...（32 文字）"
echo "  ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:0:10}...（sk-ant-...）"
echo "  ALLOWED_ORIGIN=http://localhost:8788"
if [ -n "${AWS_ACCESS_KEY_ID:-}" ]; then
  echo "  AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID:0:8}..."
  echo "  AWS_REGION=${AWS_REGION:-us-east-1}"
  echo "  S3_TELEMETRY_BUCKET=${S3_TELEMETRY_BUCKET:-}"
else
  echo "  AWS_*: 未設定（Plan D Task 5 完了後に再実行）"
fi
