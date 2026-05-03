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
  # ts_generated は ms 単位の epoch。bash の算術展開で /1000 してから date に渡す
  oldest_ms=$(jq -s 'min_by(.ts_generated) | .ts_generated' "$OUT_FILE")
  newest_ms=$(jq -s 'max_by(.ts_generated) | .ts_generated' "$OUT_FILE")
  echo "最古 ts_generated: $(date -d "@$((oldest_ms / 1000))" '+%Y-%m-%d %H:%M:%S')"
  echo "最新 ts_generated: $(date -d "@$((newest_ms / 1000))" '+%Y-%m-%d %H:%M:%S')"
  echo "市町村数: $(jq -r '.muni_code' "$OUT_FILE" | sort -u | wc -l)"

  # === Plan E (Phase 6.4 以降) Judge 集計 ===
  # Plan E より前の entry には judge_passed フィールド自体が存在しない。
  # has("judge_passed") でフィルタしてから集計する。
  PLAN_E_COUNT=$(jq -s '[.[] | select(has("judge_passed"))] | length' "$OUT_FILE")

  if [ "$PLAN_E_COUNT" -gt 0 ]; then
    echo ""
    echo "=== Plan E Judge 集計（対象: ${PLAN_E_COUNT} 件、6.4 以降の entry のみ）==="

    PASSED_TRUE=$(jq -s '[.[] | select(.judge_passed == true)] | length' "$OUT_FILE")
    PASSED_FALSE=$(jq -s '[.[] | select(.judge_passed == false)] | length' "$OUT_FILE")
    PASSED_NULL=$(jq -s '[.[] | select(has("judge_passed") and .judge_passed == null)] | length' "$OUT_FILE")
    REGENERATED=$(jq -s '[.[] | select(.regenerated == true)] | length' "$OUT_FILE")

    pct() { echo "$(( $1 * 100 / $2 ))"; }
    echo "  合格 (passed=true):    ${PASSED_TRUE}/${PLAN_E_COUNT} ($(pct $PASSED_TRUE $PLAN_E_COUNT)%)"
    echo "  NG 確定 (false):        ${PASSED_FALSE}/${PLAN_E_COUNT} ($(pct $PASSED_FALSE $PLAN_E_COUNT)%)"
    echo "  fail-open (null):       ${PASSED_NULL}/${PLAN_E_COUNT} ($(pct $PASSED_NULL $PLAN_E_COUNT)%)"
    echo "  再生成発生 (regen=true): ${REGENERATED}/${PLAN_E_COUNT} ($(pct $REGENERATED $PLAN_E_COUNT)%)"

    echo ""
    echo "  軸別平均スコア（null 除外、小数2桁）:"
    for axis in accuracy specificity season_fit density; do
      AVG=$(jq -s "[.[] | select(.critic_${axis} != null) | .critic_${axis}] | if length > 0 then ((add / length) * 100 | round / 100) else \"-\" end" "$OUT_FILE")
      echo "    ${axis}: ${AVG}"
    done

    # NG 確定 entry の一覧（再生成が発生しても結局合格しなかった entry）
    NG_COUNT=$(jq -s '[.[] | select(.judge_passed == false)] | length' "$OUT_FILE")
    if [ "$NG_COUNT" -gt 0 ]; then
      echo ""
      echo "  NG 確定 entry 一覧（要 prompts.md で要因分析）:"
      jq -r 'select(.judge_passed == false) | "    \(.muni_code) [\(.solar_term)] acc=\(.critic_accuracy) spec=\(.critic_specificity) season=\(.critic_season_fit) dens=\(.critic_density) regen=\(.regenerated)"' "$OUT_FILE"
    fi
  fi

  echo ""
  echo "次のステップ: ${OUT_FILE} の中身を Claude に貼って、"
  echo "             docs/analysis/prompts.md のテンプレートと組み合わせて分析する。"
fi
