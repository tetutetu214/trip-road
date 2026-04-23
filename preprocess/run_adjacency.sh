#!/bin/bash
# 隣接マスタ生成を実行するラッパースクリプト
# 使用: bash run_adjacency.sh （preprocess/ ディレクトリ内で実行）
# 前提: run_split.sh が完了して out/municipalities/ に geojson が揃っていること
set -euo pipefail

cd "$(dirname "$0")"
source .venv/bin/activate

python3 build_adjacency.py \
  --municipalities-dir out/municipalities/ \
  --output out/adjacency.json
