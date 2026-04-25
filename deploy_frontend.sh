#!/bin/bash
# trip-road フロントエンドを Cloudflare Pages にデプロイ + 動作確認
# 使用: bash deploy_frontend.sh （ルートディレクトリで実行）
# 前提:
#   - public/ にフロント資産がある
#   - trip-road.tetutetu214.com の Custom domain は Dashboard で別途紐付ける
set -euo pipefail

# 非対話シェル（自動化や CI 経由）でも wrangler を見つけられるよう PATH 補強
# ~/.npm-global/bin は npm config set prefix '~/.npm-global' で設定された
# ユーザ配下のグローバル install 先（Plan A Phase 0 Task 2 で構築）
export PATH="$HOME/.npm-global/bin:$PATH"

cd "$(dirname "$0")"

PROJECT_NAME="trip-road"
DEPLOY_URL_DEFAULT="https://trip-road.pages.dev"
CUSTOM_DOMAIN="https://trip-road.tetutetu214.com"

echo "=== 1. Cloudflare Pages プロジェクト作成（既存なら skip） ==="
wrangler pages project create "${PROJECT_NAME}" --production-branch main 2>&1 \
  | tee /tmp/wrangler_create.log \
  || echo "(プロジェクトが既に存在するようです。deploy に進みます)"
echo ""

echo "=== 2. Deploy（main ブランチ扱いで production URL に反映） ==="
# 非対話シェル + 日本語コミットメッセージで wrangler が
# "Invalid commit message" エラーを出す問題を回避するため、
# 明示的に ASCII コミットメッセージを指定する
wrangler pages deploy public \
  --project-name="${PROJECT_NAME}" \
  --branch=main \
  --commit-dirty=true \
  --commit-message="trip-road frontend deploy"
echo ""

echo "=== 3. エッジ反映まで 5 秒待機 ==="
sleep 5

echo "=== 4. 動作確認: pages.dev URL（フォールバック） ==="
curl -s -o /dev/null -w "HTTP %{http_code}, size %{size_download} bytes\n" \
  "${DEPLOY_URL_DEFAULT}/"
echo ""

echo "=== 5. 動作確認: 独自ドメイン（Custom domain 紐付け済の場合のみ動く） ==="
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "${CUSTOM_DOMAIN}/" || echo "000")
echo "${CUSTOM_DOMAIN}/ -> HTTP ${HTTP_CODE}"
if [ "${HTTP_CODE}" != "200" ]; then
  echo ""
  echo "⚠️  独自ドメインがまだ紐付けされていません。"
  echo "   Cloudflare Dashboard で以下の手順を実施してください:"
  echo "   1. https://dash.cloudflare.com/ → Workers & Pages → ${PROJECT_NAME}"
  echo "   2. Custom domains → Set up a custom domain"
  echo "   3. trip-road.tetutetu214.com を入力 → Continue → Activate domain"
  echo "   4. ステータス Active になるまで待機（1 分程度）"
  echo "   5. 再度このスクリプトを実行 or curl で確認"
fi
echo ""

echo "=== 完了 ==="
echo "  pages.dev: ${DEPLOY_URL_DEFAULT}"
echo "  独自ドメイン: ${CUSTOM_DOMAIN}（Dashboard 紐付け後に有効）"
