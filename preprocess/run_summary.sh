#!/bin/bash
# 生成物サマリを表示するラッパースクリプト
set -euo pipefail

cd "$(dirname "$0")"

echo "ファイル数: $(ls out/municipalities/ 2>/dev/null | wc -l)"
echo "合計サイズ: $(du -sh out/municipalities/ 2>/dev/null | cut -f1)"
echo "adjacency.json: $(du -sh out/adjacency.json 2>/dev/null | cut -f1)"
echo ""
echo "adjacency.json 先頭 300 文字:"
head -c 300 out/adjacency.json 2>/dev/null && echo ""
