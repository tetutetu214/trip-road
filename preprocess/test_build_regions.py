"""build_regions.py の純粋関数テスト。"""

import pytest

from build_regions import (
    PREFECTURE_TO_REGION,
    REGION_NAMES,
    prefecture_code_of,
    region_code_of,
)


class TestPrefectureToRegionMapping:
    def test_全47都道府県をカバーする(self):
        # 47 都道府県すべてに地方コードが割り当てられている
        assert len(PREFECTURE_TO_REGION) == 47
        for i in range(1, 48):
            code = f"{i:02d}"
            assert code in PREFECTURE_TO_REGION

    def test_地方コードは8種類(self):
        unique_regions = set(PREFECTURE_TO_REGION.values())
        assert unique_regions == {
            "hokkaido", "tohoku", "kanto", "chubu",
            "kinki", "chugoku", "shikoku", "kyushu",
        }

    def test_REGION_NAMESは8地方すべてに対応(self):
        for region_code in set(PREFECTURE_TO_REGION.values()):
            assert region_code in REGION_NAMES

    def test_北海道は単独地方(self):
        assert PREFECTURE_TO_REGION["01"] == "hokkaido"

    def test_東北6県(self):
        for code in ["02", "03", "04", "05", "06", "07"]:
            assert PREFECTURE_TO_REGION[code] == "tohoku"

    def test_関東1都6県(self):
        for code in ["08", "09", "10", "11", "12", "13", "14"]:
            assert PREFECTURE_TO_REGION[code] == "kanto"

    def test_中部9県(self):
        for code in ["15", "16", "17", "18", "19", "20", "21", "22", "23"]:
            assert PREFECTURE_TO_REGION[code] == "chubu"

    def test_近畿2府5県(self):
        for code in ["24", "25", "26", "27", "28", "29", "30"]:
            assert PREFECTURE_TO_REGION[code] == "kinki"

    def test_中国5県(self):
        for code in ["31", "32", "33", "34", "35"]:
            assert PREFECTURE_TO_REGION[code] == "chugoku"

    def test_四国4県(self):
        for code in ["36", "37", "38", "39"]:
            assert PREFECTURE_TO_REGION[code] == "shikoku"

    def test_九州沖縄8県(self):
        for code in ["40", "41", "42", "43", "44", "45", "46", "47"]:
            assert PREFECTURE_TO_REGION[code] == "kyushu"


class TestPrefectureCodeOf:
    def test_市町村コードから都道府県コードを抽出(self):
        # 14216 = 神奈川県綾瀬市
        assert prefecture_code_of("14216") == "14"

    def test_先頭0埋め2桁(self):
        # 01234 = 北海道某市
        assert prefecture_code_of("01234") == "01"

    def test_長い文字列でも先頭2桁(self):
        # 防御的: 想定外の長さでも先頭 2 桁を取れる
        assert prefecture_code_of("142160") == "14"


class TestRegionCodeOf:
    def test_市町村コードから地方コードを抽出(self):
        # 14216 = 神奈川県綾瀬市 → kanto
        assert region_code_of("14216") == "kanto"

    def test_北海道の市町村はhokkaido(self):
        assert region_code_of("01101") == "hokkaido"  # 札幌市中央区

    def test_沖縄県の市町村はkyushu(self):
        assert region_code_of("47201") == "kyushu"  # 那覇市

    def test_存在しない都道府県コードはKeyError(self):
        with pytest.raises(KeyError):
            region_code_of("99999")
