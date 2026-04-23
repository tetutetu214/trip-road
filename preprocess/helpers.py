"""N03 データ前処理のヘルパー関数群。

純粋関数のみを格納し、単体テスト可能な形に保つ。
"""

from typing import Any


ALLOWED_PROPERTIES = ("N03_001", "N03_004", "N03_007")


def _round_coords_recursive(coords: Any, precision: int) -> Any:
    """座標配列を再帰的に丸める。GeoJSON 座標構造全般に対応。"""
    if isinstance(coords, (int, float)):
        return round(coords, precision)
    if isinstance(coords, list):
        return [_round_coords_recursive(c, precision) for c in coords]
    return coords


def round_geojson_coords(feature: dict, precision: int = 5) -> dict:
    """GeoJSON Feature の geometry 座標を指定精度に丸める。

    Polygon / MultiPolygon いずれにも対応。入力は変更せず新しい dict を返す。
    """
    new_feature = dict(feature)
    new_geometry = dict(feature["geometry"])
    new_geometry["coordinates"] = _round_coords_recursive(
        feature["geometry"]["coordinates"], precision
    )
    new_feature["geometry"] = new_geometry
    return new_feature


def filter_feature_properties(feature: dict) -> dict:
    """Feature の properties を N03_001 / N03_004 / N03_007 のみに絞る。"""
    new_feature = dict(feature)
    new_feature["properties"] = {
        k: v for k, v in feature["properties"].items() if k in ALLOWED_PROPERTIES
    }
    return new_feature


def extract_muni_code(feature: dict) -> str:
    """Feature の市町村コード (N03_007) を取得。無ければ KeyError。"""
    return feature["properties"]["N03_007"]
