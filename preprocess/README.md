# trip-road データ前処理

国土数値情報 N03（行政区域データ）を市町村コード単位の GeoJSON に分割し、
簡略化・プロパティ絞り込み・座標丸めを行って Cloudflare Pages 配信用の
データを生成する。

## 実行環境

- Python 3.10 以上（推奨: 3.12）
- Google Cloud Shell 推奨（CPU / メモリ / 帯域が十分で、環境構築不要）

## 依存パッケージ

```
pip install -r requirements.txt
```

## 使い方

```bash
bash download_n03.sh                      # N03 zip を DL・展開
pytest test_helpers.py test_split.py test_adjacency.py  # 単体・統合テスト
python3 split_and_simplify.py \
  --input tmp/N03-20240101_GML/N03-20240101.shp \
  --output-dir out/municipalities/
python3 build_adjacency.py \
  --municipalities-dir out/municipalities/ \
  --output out/adjacency.json
```

## 出力

- `out/municipalities/{市町村コード}.geojson` — 市町村ごとの分割 GeoJSON
- `out/adjacency.json` — 隣接マスタ（`{code: [neighbor_code, ...]}`）

## Cloudflare Pages へのデプロイ

```bash
cd out
wrangler pages deploy . --project-name=trip-road-data
```
