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

# ローカル動作確認用のオリジンは localhost
cat > .dev.vars <<EOF
APP_PASSWORD=${APP_PASSWORD}
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
ALLOWED_ORIGIN=http://localhost:8788
EOF

chmod 600 .dev.vars

echo "=== .dev.vars 作成完了 ==="
echo "場所: $(pwd)/.dev.vars"
echo "権限: $(stat -c '%a' .dev.vars)"
echo "中身（値はマスク）:"
echo "  APP_PASSWORD=${APP_PASSWORD:0:4}...（32 文字）"
echo "  ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:0:10}...（sk-ant-...）"
echo "  ALLOWED_ORIGIN=http://localhost:8788"
