#!/bin/bash
# trip-road テレメトリ S3 → ローカル JSONL 集約スクリプト
#
# 使い方: bash docs/analysis/fetch_entries.sh
#
# 動作:
#   1. ~/.secrets/trip-road.env から AWS_REGION / S3_TELEMETRY_BUCKET を読込
#   2. S3バケットの全オブジェクト（JSON配列）を一時ディレクトリに同期
#   3. jq で各 JSON 配列を 1行1 entry の JSONL 形式に変換し連結
#   4. docs/analysis/data/entries-YYYYMMDD-HHMMSS.jsonl に出力
#   5. 件数と最古/最新の ts_generated を表示
#
# 出力ファイルを Claude（claude.ai または API）に貼り付け、
# docs/analysis/prompts.md のテンプレートと組み合わせて分析する。

set -euo pipefail

# シークレット読込（writer認証で読み取り可能。IAMポリシーに s3:ListBucket / s3:GetObject 付与済み）
SECRETS_PATH="${HOME}/.secrets/trip-road.env"
if [ ! -f "$SECRETS_PATH" ]; then
  echo "エラー: $SECRETS_PATH が見つかりません" >&2
  exit 1
fi
set -a
source "$SECRETS_PATH"
set +a

if ! command -v jq >/dev/null 2>&1; then
  echo "エラー: jq が必要です（apt install jq）" >&2
  exit 1
fi

# 出力先・一時ディレクトリ
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/data"
mkdir -p "$OUT_DIR"

DATE_TAG=$(date +%Y%m%d-%H%M%S)
TMP_DIR=$(mktemp -d)
OUT_FILE="${OUT_DIR}/entries-${DATE_TAG}.jsonl"

trap 'rm -rf "$TMP_DIR"' EXIT

echo "=== S3 → ローカル同期 ==="
aws s3 sync "s3://${S3_TELEMETRY_BUCKET}/" "$TMP_DIR/" \
  --region "$AWS_REGION" \
  --no-progress

JSON_COUNT=$(find "$TMP_DIR" -name "*.json" | wc -l)
if [ "$JSON_COUNT" -eq 0 ]; then
  echo ""
  echo "S3にオブジェクトがまだありません。"
  echo "iPhoneでtrip-roadを使い、entryが10件溜まると60秒ごとに自動flushされます。"
  exit 0
fi

echo "S3オブジェクト: ${JSON_COUNT}個"

echo ""
echo "=== JSONL に変換・連結 ==="
# 各 JSON ファイルは entries 配列が直接入っている形式。
# jq -c '.[]' で配列を展開し、1行1 entry の JSONL にする。
find "$TMP_DIR" -name "*.json" -exec jq -c '.[]' {} \; > "$OUT_FILE"

ENTRY_COUNT=$(wc -l < "$OUT_FILE")
echo "出力: $OUT_FILE"
echo "件数: $ENTRY_COUNT"

if [ "$ENTRY_COUNT" -gt 0 ]; then
  echo ""
  echo "=== サマリ ==="
  echo "最古 ts_generated: $(jq -s 'min_by(.ts_generated) | .ts_generated' "$OUT_FILE" | xargs -I{} date -d @$(echo "{} / 1000" | bc) '+%Y-%m-%d %H:%M:%S')"
  echo "最新 ts_generated: $(jq -s 'max_by(.ts_generated) | .ts_generated' "$OUT_FILE" | xargs -I{} date -d @$(echo "{} / 1000" | bc) '+%Y-%m-%d %H:%M:%S')"
  echo "市町村数: $(jq -r '.muni_code' "$OUT_FILE" | sort -u | wc -l)"
  echo ""
  echo "次のステップ: ${OUT_FILE} の中身を Claude に貼って、"
  echo "             docs/analysis/prompts.md のテンプレートと組み合わせて分析する。"
fi
