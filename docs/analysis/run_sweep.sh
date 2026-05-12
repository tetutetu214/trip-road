#!/bin/bash
# trip-road バッチ評価（sweep）— Plan I 版
#
# 使い方: bash docs/analysis/run_sweep.sh
#
# 動作:
#   - ハードコードした神奈川県内の市町村セットに対して /api/describe を順次 POST
#   - 各レスポンスを JSONL で 1 ファイルに集約
#   - Faithfulness 1 軸の平均 / 合格率 / no_wikipedia 件数 / fallback_to_extract 件数 /
#     out_of_kb_terms の頻度を末尾に表示
#
# Plan I（2026-05-11）でリクエスト body から solar_term を廃止、
# レスポンスは新スキーマ（faithfulness_score / out_of_kb_terms / no_wikipedia /
# fallback_to_extract / wikipedia_extract_length）に対応。
#
# memory「trip-road は実走観測ではなくバッチ評価」「Judge 改善は curl sweep で測る」と整合。

set -euo pipefail

SECRETS_PATH="${HOME}/.secrets/trip-road.env"
if [ ! -f "$SECRETS_PATH" ]; then
  echo "エラー: $SECRETS_PATH が見つかりません" >&2
  exit 1
fi
set -a
source "$SECRETS_PATH"
set +a

if [ -z "${APP_PASSWORD:-}" ] || [ -z "${ALLOWED_ORIGIN:-}" ]; then
  echo "エラー: APP_PASSWORD または ALLOWED_ORIGIN が ~/.secrets/trip-road.env にありません" >&2
  exit 1
fi

WORKER_URL="${WORKER_URL:-https://trip-road-api.tetutetu214.com}"
SLEEP_SEC="${SLEEP_SEC:-3}"

# 神奈川県内の地理特性ミックス（都市・観光・山・海・農村を散らす）
TARGETS=(
  "横浜市中区"
  "鎌倉市"
  "箱根町"
  "三浦市"
  "相模原市緑区"
  "平塚市"
  "小田原市"
  "秦野市"
  "真鶴町"
  "厚木市"
)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${SCRIPT_DIR}/data"
mkdir -p "$OUT_DIR"
DATE_TAG=$(date +%Y%m%d-%H%M%S)
OUT_FILE="${OUT_DIR}/sweep-plan-i-${DATE_TAG}.jsonl"

echo "=== trip-road バッチ評価（Plan I） ==="
echo "Worker URL : $WORKER_URL"
echo "対象       : ${#TARGETS[@]} 市町村"
echo "出力       : $OUT_FILE"
echo ""

for muni in "${TARGETS[@]}"; do
  printf "→ %s ... " "$muni"
  REQ_BODY=$(jq -nc --arg pref "神奈川県" --arg muni "$muni" \
    '{prefecture:$pref, municipality:$muni}')

  RESP=$(curl -sS --max-time 90 -X POST "${WORKER_URL}/api/describe" \
    -H "Content-Type: application/json" \
    -H "X-App-Password: $APP_PASSWORD" \
    -H "Origin: $ALLOWED_ORIGIN" \
    -d "$REQ_BODY" 2>&1) || { echo "失敗（curl エラー）"; sleep "$SLEEP_SEC"; continue; }

  if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
    echo "失敗（JSON 不正）"
    echo "{\"municipality\":\"$muni\",\"error\":\"non_json\",\"raw\":$(jq -Rs . <<<"$RESP")}" >> "$OUT_FILE"
    sleep "$SLEEP_SEC"
    continue
  fi

  echo "$RESP" | jq -c --arg muni "$muni" \
    '. + {municipality: $muni}' >> "$OUT_FILE"

  PASS=$(echo "$RESP" | jq -r '.judge_passed // "null"')
  SCORE=$(echo "$RESP" | jq -r '.faithfulness_score // "null"')
  REGEN=$(echo "$RESP" | jq -r '.regenerated // "null"')
  NOWIKI=$(echo "$RESP" | jq -r '.no_wikipedia // false')
  FALLBACK=$(echo "$RESP" | jq -r '.fallback_to_extract // false')
  printf "passed=%s score=%s regen=%s no_wiki=%s fallback=%s\n" "$PASS" "$SCORE" "$REGEN" "$NOWIKI" "$FALLBACK"
  sleep "$SLEEP_SEC"
done

echo ""
echo "=== サマリ ==="
TOTAL=$(wc -l < "$OUT_FILE")
echo "件数: $TOTAL"
PASS_N=$(jq -s '[.[] | select(.judge_passed == true)] | length' "$OUT_FILE")
NG_N=$(jq -s '[.[] | select(.judge_passed == false)] | length' "$OUT_FILE")
FO_N=$(jq -s '[.[] | select(.judge_passed == null and .no_wikipedia != true)] | length' "$OUT_FILE")
NOWIKI_N=$(jq -s '[.[] | select(.no_wikipedia == true)] | length' "$OUT_FILE")
FALLBACK_N=$(jq -s '[.[] | select(.fallback_to_extract == true)] | length' "$OUT_FILE")
echo "合格: $PASS_N / NG: $NG_N / fail-open: $FO_N / no_wikipedia: $NOWIKI_N / fallback_to_extract: $FALLBACK_N"
echo ""

echo "Faithfulness score 平均（null 除外、小数2桁）:"
AVG=$(jq -s '
  [.[] | .faithfulness_score | select(. != null)]
  | if length>0 then (add/length*100|round/100|tostring) else "-" end
' "$OUT_FILE")
printf "  faithfulness_score: %s\n" "$AVG"
echo ""

echo "out_of_kb_terms（市町村別、頻出固有名詞検出用）:"
jq -s -r '.[] | select(.out_of_kb_terms != null and (.out_of_kb_terms | length > 0)) |
  "[\(.municipality)] " +
  ( .out_of_kb_terms | map("- " + .) | join("\n  ") )
' "$OUT_FILE"
echo ""

echo "wikipedia_extract_length 分布:"
jq -s -r '.[] | "  \(.municipality): \(.wikipedia_extract_length // "null")"' "$OUT_FILE"
echo ""

echo "完了: $OUT_FILE"
