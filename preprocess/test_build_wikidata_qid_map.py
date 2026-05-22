"""build_wikidata_qid_map.py の単体テスト。"""

import re

import pytest

from build_wikidata_qid_map import (
    build_qid_map,
    build_sparql_query,
    chunked,
    collect_municipality_codes,
    parse_coord,
    parse_sparql_response,
    parse_wikipedia_title,
)


def test_collect_municipality_codes(tmp_path):
    """5 桁数字の GeoJSON ファイル名だけがソートされて返る。"""
    (tmp_path / "13101.geojson").write_text("{}", encoding="utf-8")
    (tmp_path / "01101.geojson").write_text("{}", encoding="utf-8")
    (tmp_path / "README.md").write_text("", encoding="utf-8")
    (tmp_path / "notacode.geojson").write_text("{}", encoding="utf-8")

    assert collect_municipality_codes(tmp_path) == ["01101", "13101"]


def test_chunked():
    """7 要素を 3 件ずつに分割できる。"""
    chunks = list(chunked([1, 2, 3, 4, 5, 6, 7], 3))
    assert [len(chunk) for chunk in chunks] == [3, 3, 1]


def test_build_sparql_query_contains_expected():
    """SPARQL に必要な句とクオート済みコードが含まれる。"""
    query = build_sparql_query(["13101", "01101"])
    assert "VALUES" in query
    assert "STRSTARTS" in query
    assert "wdt:P429" in query
    assert '"13101"' in query
    assert '"01101"' in query


def test_build_sparql_query_injection():
    """数字以外のコードは拒否される。"""
    with pytest.raises(ValueError):
        build_sparql_query(["DROP TABLE"])


def test_parse_coord_normal():
    """通常の Point を lat, lon の順に変換する。"""
    assert parse_coord("Point(139.7536 35.6939)") == (35.6939, 139.7536)


def test_parse_coord_double_space():
    """座標間が複数スペースでも変換できる。"""
    assert parse_coord("Point(139.7536  35.6939)") == (35.6939, 139.7536)


def test_parse_coord_garbage():
    """Point でない文字列は None を返す。"""
    assert parse_coord("garbage") is None


def test_parse_wikipedia_title_plain():
    """日本語 Wikipedia URL からタイトルを取り出す。"""
    assert (
        parse_wikipedia_title("https://ja.wikipedia.org/wiki/千代田区")
        == "千代田区"
    )


def test_parse_wikipedia_title_encoded():
    """URL エンコード済みタイトルをデコードする。"""
    assert (
        parse_wikipedia_title(
            "https://ja.wikipedia.org/wiki/"
            "%E5%8D%83%E4%BB%A3%E7%94%B0%E5%8C%BA"
        )
        == "千代田区"
    )


def test_parse_wikipedia_title_other_lang():
    """ja.wikipedia.org 以外は None を返す。"""
    assert parse_wikipedia_title("https://en.wikipedia.org/wiki/Chiyoda") is None


def test_parse_sparql_response_normal():
    """WDQS レスポンスから 2 件の QID エントリを抽出する。"""
    response = {
        "results": {
            "bindings": [
                {
                    "code5": {"value": "13101"},
                    "city": {"value": "http://www.wikidata.org/entity/Q27406"},
                    "cityLabel": {"value": "千代田区"},
                    "coord": {"value": "Point(139.7536 35.6939)"},
                    "wpUrl": {
                        "value": "https://ja.wikipedia.org/wiki/千代田区"
                    },
                },
                {
                    "code5": {"value": "01101"},
                    "city": {"value": "http://www.wikidata.org/entity/Q1073956"},
                    "cityLabel": {"value": "札幌市中央区"},
                    "coord": {"value": "Point(141.3409 43.0553)"},
                    "wpUrl": {
                        "value": "https://ja.wikipedia.org/wiki/"
                        "%E4%B8%AD%E5%A4%AE%E5%8C%BA_(%E6%9C%AD%E5%B9%8C%E5%B8%82)"
                    },
                },
            ]
        }
    }

    result = parse_sparql_response(response, ["13101", "01101"])

    assert set(result.keys()) == {"13101", "01101"}
    assert result["13101"] == {
        "qid": "Q27406",
        "label_ja": "千代田区",
        "lat": 35.6939,
        "lon": 139.7536,
        "wikipedia_ja": "千代田区",
    }
    assert result["01101"] == {
        "qid": "Q1073956",
        "label_ja": "札幌市中央区",
        "lat": 43.0553,
        "lon": 141.3409,
        "wikipedia_ja": "中央区_(札幌市)",
    }


def test_parse_sparql_response_duplicate_binding(capsys):
    """同じ code5 の複数 binding は最初を採用し、警告を出す。"""
    response = {
        "results": {
            "bindings": [
                {
                    "code5": {"value": "13101"},
                    "city": {"value": "http://www.wikidata.org/entity/Q1"},
                    "cityLabel": {"value": "first"},
                },
                {
                    "code5": {"value": "13101"},
                    "city": {"value": "http://www.wikidata.org/entity/Q2"},
                    "cityLabel": {"value": "second"},
                },
            ]
        }
    }

    result = parse_sparql_response(response, ["13101"])
    captured = capsys.readouterr()

    assert result["13101"]["qid"] == "Q1"
    assert "duplicate Wikidata binding" in captured.err


def test_build_qid_map_batch_count():
    """100 件を 30 件ずつ処理すると 4 バッチになる。"""
    calls = []
    codes = [f"{index:05d}" for index in range(100)]

    def fetch_fn(query: str) -> dict:
        calls.append(query)
        queried_codes = re.findall(r'"(\d{5})"', query)
        return {
            "results": {
                "bindings": [
                    {
                        "code5": {"value": code},
                        "city": {
                            "value": f"http://www.wikidata.org/entity/Q{int(code)}"
                        },
                        "cityLabel": {"value": f"label-{code}"},
                    }
                    for code in queried_codes
                ]
            }
        }

    result = build_qid_map(codes, batch_size=30, sleep_sec=0, fetch_fn=fetch_fn)

    assert len(calls) == 4
    assert [len(re.findall(r'"(\d{5})"', query)) for query in calls] == [
        30,
        30,
        30,
        10,
    ]
    assert len(result) == 100
