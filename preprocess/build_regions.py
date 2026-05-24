"""N03 から地方・都道府県の集約 GeoJSON と市町村→地方マッピングを生成。

入力: N03 の shapefile または GeoJSON
出力:
  - --output-dir/regions.geojson       (8 features, 地方ポリゴン)
  - --output-dir/prefectures.geojson   (47 features, 都道府県ポリゴン)
  - --output-dir/conquest_meta.json    ({muni_code: {region_code, prefecture_code}})

処理:
  1. 入力を読み込み
  2. N03_007 (5 桁市町村コード) の先頭 2 桁で都道府県を、PREFECTURE_TO_REGION で地方を判定
  3. 都道府県・地方それぞれで unary_union 集約
  4. tolerance 別に simplify（地方 0.05 度、都道府県 0.02 度）
  5. 座標を 5 桁に丸めて書き出し

plan.md §13 / spec.md §14 に対応。
"""

import argparse
import json
from pathlib import Path

import geopandas as gpd
from shapely.geometry import MultiPolygon, Polygon, mapping
from shapely.ops import unary_union

from helpers import round_geojson_coords


REGION_TOLERANCE = 0.05      # 地方ポリゴンの簡略化 tolerance（度、約 5.5km）
PREFECTURE_TOLERANCE = 0.02  # 都道府県ポリゴンの簡略化 tolerance（度、約 2.2km）
COORD_PRECISION = 3          # 座標精度（小数 3 桁、約 110m）。コロプレスには十分
# 「離島・小さな突起」を切り捨てる面積閾値（度²）。0.001 度² ≈ 約 12km²
MIN_POLYGON_AREA = 0.001


def drop_small_polygons(geom, min_area):
    """MultiPolygon から min_area 未満の小ポリゴンを除外する。

    Polygon は単純に閾値判定、MultiPolygon は再構築する。
    すべて閾値未満なら最大の 1 つだけは残す（None になるのを防ぐ）。
    """
    if isinstance(geom, Polygon):
        return geom
    if isinstance(geom, MultiPolygon):
        polys = [p for p in geom.geoms if p.area >= min_area]
        if not polys:
            # 全部小さい場合は面積最大の 1 つだけ残す
            polys = [max(geom.geoms, key=lambda p: p.area)]
        if len(polys) == 1:
            return polys[0]
        return MultiPolygon(polys)
    return geom


# 都道府県コード（2 桁）→ 地方コード
PREFECTURE_TO_REGION = {
    "01": "hokkaido",
    "02": "tohoku", "03": "tohoku", "04": "tohoku", "05": "tohoku",
    "06": "tohoku", "07": "tohoku",
    "08": "kanto", "09": "kanto", "10": "kanto", "11": "kanto",
    "12": "kanto", "13": "kanto", "14": "kanto",
    "15": "chubu", "16": "chubu", "17": "chubu", "18": "chubu",
    "19": "chubu", "20": "chubu", "21": "chubu", "22": "chubu",
    "23": "chubu",
    "24": "kinki", "25": "kinki", "26": "kinki", "27": "kinki",
    "28": "kinki", "29": "kinki", "30": "kinki",
    "31": "chugoku", "32": "chugoku", "33": "chugoku",
    "34": "chugoku", "35": "chugoku",
    "36": "shikoku", "37": "shikoku", "38": "shikoku", "39": "shikoku",
    "40": "kyushu", "41": "kyushu", "42": "kyushu", "43": "kyushu",
    "44": "kyushu", "45": "kyushu", "46": "kyushu", "47": "kyushu",
}

REGION_NAMES = {
    "hokkaido": "北海道",
    "tohoku": "東北",
    "kanto": "関東",
    "chubu": "中部",
    "kinki": "近畿",
    "chugoku": "中国",
    "shikoku": "四国",
    "kyushu": "九州・沖縄",
}


def prefecture_code_of(muni_code: str) -> str:
    """5 桁の市町村コードから 2 桁の都道府県コードを返す。先頭 2 桁を抜き出すだけ。"""
    return muni_code[:2]


def region_code_of(muni_code: str) -> str:
    """5 桁の市町村コードから地方コードを返す。"""
    return PREFECTURE_TO_REGION[prefecture_code_of(muni_code)]


def build_meta(gdf: gpd.GeoDataFrame) -> dict:
    """conquest_meta.json の中身を作る。

    Returns:
        {muni_code: {"region_code": ..., "prefecture_code": ...}}
    """
    meta = {}
    for muni_code in gdf["N03_007"].unique():
        pref_code = prefecture_code_of(muni_code)
        meta[muni_code] = {
            "region_code": PREFECTURE_TO_REGION[pref_code],
            "prefecture_code": pref_code,
        }
    return meta


def build_prefecture_geojson(gdf: gpd.GeoDataFrame) -> dict:
    """都道府県単位で geometry を集約した FeatureCollection を返す。

    `unary_union` で polygon を集約後、まず小polygonを切り捨て、
    続いて `simplify(preserve_topology=False)` で頂点を大幅減らす。
    座標は COORD_PRECISION 桁に丸める。
    """
    features = []
    for pref_code, pref_group in gdf.groupby(gdf["N03_007"].str[:2]):
        merged = unary_union(list(pref_group["geometry"]))
        cleaned = drop_small_polygons(merged, MIN_POLYGON_AREA)
        simplified = cleaned.simplify(PREFECTURE_TOLERANCE, preserve_topology=False)
        pref_name = pref_group.iloc[0]["N03_001"]
        muni_count = pref_group["N03_007"].nunique()
        feature = {
            "type": "Feature",
            "geometry": mapping(simplified),
            "properties": {
                "prefecture_code": pref_code,
                "name": pref_name,
                "region_code": PREFECTURE_TO_REGION[pref_code],
                "muni_count": muni_count,
            },
        }
        features.append(round_geojson_coords(feature, precision=COORD_PRECISION))
    return {"type": "FeatureCollection", "features": features}


def build_region_geojson(gdf: gpd.GeoDataFrame) -> dict:
    """地方単位で geometry を集約した FeatureCollection を返す。"""
    region_series = gdf["N03_007"].str[:2].map(PREFECTURE_TO_REGION)
    features = []
    for region_code, region_group in gdf.groupby(region_series):
        merged = unary_union(list(region_group["geometry"]))
        cleaned = drop_small_polygons(merged, MIN_POLYGON_AREA)
        simplified = cleaned.simplify(REGION_TOLERANCE, preserve_topology=False)
        muni_count = region_group["N03_007"].nunique()
        feature = {
            "type": "Feature",
            "geometry": mapping(simplified),
            "properties": {
                "region_code": region_code,
                "name": REGION_NAMES[region_code],
                "muni_count": muni_count,
            },
        }
        features.append(round_geojson_coords(feature, precision=COORD_PRECISION))
    return {"type": "FeatureCollection", "features": features}


def build_regions(input_path: Path, output_dir: Path) -> None:
    """3 ファイルを output_dir 配下に書き出す。"""
    output_dir.mkdir(parents=True, exist_ok=True)

    print(f"Reading {input_path}...")
    gdf = gpd.read_file(input_path)
    # N03_007 を文字列に正規化（一部データセットでは int で読まれる）
    # N03_007 は 5 桁の市町村コード（先頭 2 桁が都道府県コード）
    gdf["N03_007"] = gdf["N03_007"].astype(str).str.zfill(5)
    print(f"Loaded {len(gdf)} features (before filtering)")

    # N03 には「所属未定地」など PREFECTURE_TO_REGION で解決できない
    # 先頭2桁を持つレコードが含まれる（例: "00xxxx"）。これらは除外する。
    valid_prefs = set(PREFECTURE_TO_REGION.keys())
    before = len(gdf)
    gdf = gdf[gdf["N03_007"].str[:2].isin(valid_prefs)].copy()
    skipped = before - len(gdf)
    print(f"Filtered to {len(gdf)} features (skipped {skipped} unassigned)")

    print("Building conquest_meta.json...")
    meta = build_meta(gdf)
    meta_path = output_dir / "conquest_meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  Wrote {len(meta)} muni entries → {meta_path}")

    print("Building prefectures.geojson...")
    pref_geojson = build_prefecture_geojson(gdf)
    pref_path = output_dir / "prefectures.geojson"
    with open(pref_path, "w", encoding="utf-8") as f:
        json.dump(pref_geojson, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  Wrote {len(pref_geojson['features'])} prefecture features → {pref_path}")

    print("Building regions.geojson...")
    region_geojson = build_region_geojson(gdf)
    region_path = output_dir / "regions.geojson"
    with open(region_path, "w", encoding="utf-8") as f:
        json.dump(region_geojson, f, ensure_ascii=False, separators=(",", ":"))
    print(f"  Wrote {len(region_geojson['features'])} region features → {region_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Build region / prefecture geojson + conquest meta from N03"
    )
    parser.add_argument("--input", required=True, type=Path,
                        help="N03 shapefile or GeoJSON input")
    parser.add_argument("--output-dir", required=True, type=Path,
                        help="Output directory")
    args = parser.parse_args()

    build_regions(args.input, args.output_dir)


if __name__ == "__main__":
    main()
