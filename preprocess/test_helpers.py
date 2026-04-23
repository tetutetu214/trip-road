"""helpers.py の単体テスト。"""

import pytest

from helpers import (
    round_geojson_coords,
    filter_feature_properties,
    extract_muni_code,
)


def test_round_geojson_coords_to_5_decimals_polygon():
    """Polygon の座標が小数5桁に丸められる。"""
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "Polygon",
            "coordinates": [[
                [139.7671234, 35.6811234],
                [139.7691234, 35.6811234],
                [139.7691234, 35.6831234],
                [139.7671234, 35.6831234],
                [139.7671234, 35.6811234],
            ]],
        },
        "properties": {},
    }
    rounded = round_geojson_coords(feature, precision=5)
    coords = rounded["geometry"]["coordinates"][0]
    assert coords[0] == [139.76712, 35.68112]
    assert coords[2] == [139.76912, 35.68312]


def test_round_geojson_coords_handles_multipolygon():
    """MultiPolygon の座標も全て丸められる。"""
    feature = {
        "type": "Feature",
        "geometry": {
            "type": "MultiPolygon",
            "coordinates": [
                [[[139.7671234, 35.6811234], [139.7691234, 35.6811234],
                  [139.7691234, 35.6831234], [139.7671234, 35.6811234]]],
                [[[140.1231234, 36.1231234], [140.1251234, 36.1231234],
                  [140.1251234, 36.1251234], [140.1231234, 36.1231234]]],
            ],
        },
        "properties": {},
    }
    rounded = round_geojson_coords(feature, precision=5)
    first_poly = rounded["geometry"]["coordinates"][0][0]
    second_poly = rounded["geometry"]["coordinates"][1][0]
    assert first_poly[0] == [139.76712, 35.68112]
    assert second_poly[0] == [140.12312, 36.12312]


def test_filter_feature_properties_keeps_only_n03_fields():
    """N03_001/004/007 以外のプロパティが削除される。"""
    feature = {
        "type": "Feature",
        "geometry": {"type": "Polygon", "coordinates": []},
        "properties": {
            "N03_001": "東京都",
            "N03_002": "something",
            "N03_003": "other",
            "N03_004": "千代田区",
            "N03_005": "extra",
            "N03_007": "13101",
        },
    }
    filtered = filter_feature_properties(feature)
    assert filtered["properties"] == {
        "N03_001": "東京都",
        "N03_004": "千代田区",
        "N03_007": "13101",
    }


def test_extract_muni_code_returns_n03_007():
    """N03_007 がそのまま返される。"""
    feature = {"properties": {"N03_007": "13101"}}
    assert extract_muni_code(feature) == "13101"


def test_extract_muni_code_raises_on_missing():
    """N03_007 が無ければ KeyError。"""
    feature = {"properties": {}}
    with pytest.raises(KeyError):
        extract_muni_code(feature)
