#!/bin/bash
# trip-road バッチ評価（sweep）
#
# 使い方: bash docs/analysis/run_sweep.sh [solar_term]
#   solar_term: 二十四節気の番号文字列（デフォルト '07' = 立夏）
#
# 動作:
#   - ハードコードした神奈川県内の市町村セットに対して /api/describe を順次 POST
#   - 各レスポンスを JSONL で 1 ファイルに集約
#   - 軸別平均 / 合格率 / accuracy 軸の deductions を末尾に表示
#
# 実走観測がてつてつの利用形態（同じ場所への移動が多い）では困難なため、
# プロンプト・モデル変更の効果測定はこのスクリプトをベースラインに行う。
#
# コスト: 1 entry あたり Generator 1 + Judge 4 軸（+ 再生成ぶん）。
# Nova Pro で 10 件回しても数十円程度の想定（厳密試算は未実施）。

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
SOLAR_TERM="${1:-07}"
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
OUT_FILE="${OUT_DIR}/sweep-st${SOLAR_TERM}-${DATE_TAG}.jsonl"

echo "=== trip-road バッチ評価 ==="
echo "Worker URL : $WORKER_URL"
echo "節気       : $SOLAR_TERM"
echo "対象       : ${#TARGETS[@]} 市町村"
echo "出力       : $OUT_FILE"
echo ""

for muni in "${TARGETS[@]}"; do
  printf "→ %s ... " "$muni"
  REQ_BODY=$(jq -nc --arg pref "神奈川県" --arg muni "$muni" --arg st "$SOLAR_TERM" \
    '{prefecture:$pref, municipality:$muni, solar_term:$st}')

  # --max-time 60: Wikipedia + Generator + Judge 4軸 + 再生成があっても1分で見切る
  RESP=$(curl -sS --max-time 90 -X POST "${WORKER_URL}/api/describe" \
    -H "Content-Type: application/json" \
    -H "X-App-Password: $APP_PASSWORD" \
    -H "Origin: $ALLOWED_ORIGIN" \
    -d "$REQ_BODY" 2>&1) || { echo "失敗（curl エラー）"; sleep "$SLEEP_SEC"; continue; }

  # JSON でなければエラーログとして残す
  if ! echo "$RESP" | jq -e . >/dev/null 2>&1; then
    echo "失敗（JSON 不正）"
    echo "{\"municipality\":\"$muni\",\"solar_term\":\"$SOLAR_TERM\",\"error\":\"non_json\",\"raw\":$(jq -Rs . <<<"$RESP")}" >> "$OUT_FILE"
    sleep "$SLEEP_SEC"
    continue
  fi

  # municipality と solar_term をメタ情報として埋め込んで保存
  echo "$RESP" | jq -c --arg muni "$muni" --arg st "$SOLAR_TERM" \
    '. + {municipality: $muni, solar_term: $st}' >> "$OUT_FILE"

  PASS=$(echo "$RESP" | jq -r '.judge_passed // "null"')
  ACC=$(echo "$RESP" | jq -r '.judge_scores.accuracy // "null"')
  REGEN=$(echo "$RESP" | jq -r '.regenerated // "null"')
  printf "passed=%s acc=%s regen=%s\n" "$PASS" "$ACC" "$REGEN"
  sleep "$SLEEP_SEC"
done

echo ""
echo "=== サマリ ==="
TOTAL=$(wc -l < "$OUT_FILE")
echo "件数: $TOTAL"
PASS_N=$(jq -s '[.[] | select(.judge_passed == true)] | length' "$OUT_FILE")
NG_N=$(jq -s '[.[] | select(.judge_passed == false)] | length' "$OUT_FILE")
FO_N=$(jq -s '[.[] | select(.judge_passed == null and .description != null)] | length' "$OUT_FILE")
echo "合格: $PASS_N / NG: $NG_N / fail-open: $FO_N"
echo ""

echo "軸別平均（小数2桁、null除外）:"
for axis in accuracy specificity season_fit density; do
  AVG=$(jq -s --arg a "$axis" '
    [.[] | select(.judge_scores != null) | .judge_scores[$a] | select(. != null)]
    | if length>0 then (add/length*100|round/100|tostring) else "-" end
  ' "$OUT_FILE")
  printf "  %-13s %s\n" "$axis:" "$AVG"
done
echo ""

echo "accuracy 軸 deductions（不当減点パターン検出用）:"
jq -s -r '.[] | select(.judge_deductions.accuracy != null) |
  "[\(.municipality)] " +
  ( .judge_deductions.accuracy
    | if length == 0 then "(deductions なし)" else (map("- " + .) | join("\n  ")) end )
' "$OUT_FILE"
echo ""
echo "完了: $OUT_FILE"
