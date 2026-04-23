#!/bin/bash
# N03（国土数値情報 行政区域データ）の 2024 年 1 月 1 日版をダウンロード・展開
# 使用: bash download_n03.sh
# 出力: tmp/N03-20240101_GML/ に shape ファイル群

set -euo pipefail

N03_VERSION="N03-20240101"
N03_URL="https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2024/${N03_VERSION}_GML.zip"

OUTPUT_DIR="./tmp"
mkdir -p "$OUTPUT_DIR"

echo "Downloading ${N03_URL}..."
cd "$OUTPUT_DIR"
wget -q --show-progress "${N03_URL}"

echo "Extracting..."
unzip -q -o "${N03_VERSION}_GML.zip"

echo "Done. Extracted to: ${OUTPUT_DIR}/${N03_VERSION}_GML/"
ls -la "${N03_VERSION}_GML/" | head -20
