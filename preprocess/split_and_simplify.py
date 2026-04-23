"""N03 を市町村コード単位の GeoJSON に分割・簡略化・プロパティ絞り込み。

入力: N03 の shapefile または GeoJSON
出力: --output-dir/{N03_007}.geojson

処理:
  1. 入力を読み込み
  2. N03_007 でグループ化
  3. 各グループの geometry を unary_union でマージ
  4. Douglas-Peucker で簡略化 (tolerance 0.0005 度 ≈ 55m)
  5. プロパティを N03_001/004/007 のみに絞る
  6. 座標を小数 5 桁に丸める
  7. FeatureCollection として書き出し
"""

import argparse
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import mapping
from shapely.ops import unary_union

from helpers import round_geojson_coords


SIMPLIFY_TOLERANCE = 0.0005  # 度、≈55m
COORD_PRECISION = 5


def split_and_simplify(input_path: Path, output_dir: Path) -> dict:
    """入力 GeoJSON/Shapefile を市町村コード別に分割・加工して書き出す。"""
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading {input_path}...")
    gdf = gpd.read_file(input_path)
    print(f"Loaded {len(gdf)} features")

    groups = gdf.groupby("N03_007")
    print(f"Grouped into {len(groups)} muni codes")

    written = {}
    for muni_code, group in groups:
        # 全ジオメトリをマージ
        merged = unary_union(list(group["geometry"]))

        # 簡略化
        simplified = merged.simplify(
            SIMPLIFY_TOLERANCE, preserve_topology=True
        )

        first_row = group.iloc[0]
        feature = {
            "type": "Feature",
            "geometry": mapping(simplified),
            "properties": {
                "N03_001": first_row["N03_001"],
                "N03_004": first_row["N03_004"],
                "N03_007": muni_code,
            },
        }

        # 座標丸め
        feature = round_geojson_coords(feature, precision=COORD_PRECISION)

        geojson = {"type": "FeatureCollection", "features": [feature]}

        out_path = output_dir / f"{muni_code}.geojson"
        with open(out_path, "w", encoding="utf-8") as f:
            json.dump(geojson, f, ensure_ascii=False, separators=(",", ":"))

        written[muni_code] = out_path

    print(f"Wrote {len(written)} files to {output_dir}")
    return written


def main():
    parser = argparse.ArgumentParser(description="Split N03 by muni code")
    parser.add_argument("--input", required=True, type=Path,
                        help="N03 shapefile or GeoJSON input")
    parser.add_argument("--output-dir", required=True, type=Path,
                        help="Output directory for per-muni GeoJSON files")
    args = parser.parse_args()

    split_and_simplify(args.input, args.output_dir)


if __name__ == "__main__":
    main()
