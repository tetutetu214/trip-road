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

## Wikidata QID マッピング生成（Plan G-3 / Issue #37）

`out/municipalities/` の全 1905 ファイルから市町村コードを抽出し、Wikidata SPARQL で QID + 緯度経度 + ja Wikipedia 記事タイトルを取得して `public/wikidata_qid.json` を生成する。再生成は市町村合併等があったときのみ、平常時は不要。

```bash
# 単体テスト
PYTHONPATH=. pytest test_build_wikidata_qid_map.py -v

# 実走（リポジトリルートから）
python3 preprocess/build_wikidata_qid_map.py
# デフォルト: --batch-size 100 --timeout 90 --sleep 2.0
# 約 2 分かかる。User-Agent 必須・バッチ間 2 秒スリープで WDQS にフェア
```

仕様詳細は `../docs/spec.md` 12 章、設計記録は `../docs/knowledge.md` 4.27 章。

## Cloudflare Pages へのデプロイ

```bash
cd out
wrangler pages deploy . --project-name=trip-road-data
```
