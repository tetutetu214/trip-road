#!/bin/bash
# N03 分割・簡略化を実行するラッパースクリプト
# 使用: bash run_split.sh （preprocess/ ディレクトリ内で実行）
# 所要: 15〜30 分
set -euo pipefail

cd "$(dirname "$0")"
source .venv/bin/activate

python3 split_and_simplify.py \
  --input tmp/N03-20240101.shp \
  --output-dir out/municipalities/
