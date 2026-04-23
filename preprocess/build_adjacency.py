"""市町村 GeoJSON 群から隣接マスタ adjacency.json を生成する。

入力: --municipalities-dir 配下の {code}.geojson 群
出力: --output に {code: [neighbor_codes...], ...} の JSON

判定: `touches` ∪ `intersects(buffer(0.00001度))` で、線接触・頂点接触・
微小ずれによる非接触を救済する。
"""

import argparse
import json
from collections import defaultdict
from pathlib import Path

import geopandas as gpd


BUFFER_FOR_INTERSECTS = 0.00001  # 度、≈1m


def build_adjacency(municipalities_dir: Path, output_path: Path) -> dict:
    """隣接マスタを生成して JSON 保存。"""
    features = []
    for geojson_file in sorted(municipalities_dir.glob("*.geojson")):
        code = geojson_file.stem
        with open(geojson_file, encoding="utf-8") as f:
            data = json.load(f)
        if not data.get("features"):
            continue
        feat = data["features"][0]
        features.append({"code": code, "feature": feat})

    print(f"Loaded {len(features)} municipalities")

    gdf = gpd.GeoDataFrame.from_features(
        [f["feature"] for f in features],
        crs="EPSG:4326",
    )
    gdf["_code"] = [f["code"] for f in features]

    print("Building spatial index...")
    sindex = gdf.sindex

    adjacency = defaultdict(set)

    print("Computing adjacencies...")
    for idx, row in gdf.iterrows():
        code_a = row["_code"]
        geom_a = row["geometry"]
        buffered_a = geom_a.buffer(BUFFER_FOR_INTERSECTS)
        candidate_idx = list(sindex.intersection(buffered_a.bounds))
        for jdx in candidate_idx:
            if jdx <= idx:
                continue
            code_b = gdf.iloc[jdx]["_code"]
            geom_b = gdf.iloc[jdx]["geometry"]
            if geom_a.touches(geom_b) or geom_a.intersects(geom_b.buffer(BUFFER_FOR_INTERSECTS)):
                adjacency[code_a].add(code_b)
                adjacency[code_b].add(code_a)

    result = {code: sorted(list(neighbors)) for code, neighbors in adjacency.items()}

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Wrote {output_path} with {len(result)} entries")
    return result


def main():
    parser = argparse.ArgumentParser(description="Build adjacency map")
    parser.add_argument("--municipalities-dir", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    build_adjacency(args.municipalities_dir, args.output)


if __name__ == "__main__":
    main()
