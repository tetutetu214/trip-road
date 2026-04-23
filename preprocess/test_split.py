"""split_and_simplify.py の統合テスト。"""

import json
import re
import subprocess
from pathlib import Path


HERE = Path(__file__).parent
SAMPLE = HERE / "sample_data" / "mini_n03.geojson"


def _run_split(output_dir: Path) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["python3", "split_and_simplify.py",
         "--input", str(SAMPLE),
         "--output-dir", str(output_dir)],
        cwd=HERE,
        capture_output=True,
        text=True,
    )


def test_split_produces_one_file_per_muni_code(tmp_path):
    """同一市町村コードは 1 ファイルに集約される。"""
    output_dir = tmp_path / "municipalities"
    result = _run_split(output_dir)
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"

    files = sorted(output_dir.glob("*.geojson"))
    names = [f.name for f in files]
    assert names == ["13101.geojson", "13102.geojson"]


def test_split_merges_same_code_geometries(tmp_path):
    """同じコードの 2 Feature が 1 つの geometry にマージされる。"""
    output_dir = tmp_path / "municipalities"
    _run_split(output_dir)

    with open(output_dir / "13101.geojson", encoding="utf-8") as f:
        data = json.load(f)
    assert len(data["features"]) == 1
    feat = data["features"][0]
    assert feat["geometry"]["type"] in ("Polygon", "MultiPolygon")
    assert feat["properties"]["N03_007"] == "13101"


def test_split_filters_properties(tmp_path):
    """N03_002 などの余計なプロパティが削除される。"""
    output_dir = tmp_path / "municipalities"
    _run_split(output_dir)

    with open(output_dir / "13102.geojson", encoding="utf-8") as f:
        data = json.load(f)
    props = data["features"][0]["properties"]
    assert set(props.keys()) == {"N03_001", "N03_004", "N03_007"}
    assert props["N03_001"] == "東京都"
    assert props["N03_004"] == "中央区B"


def test_split_rounds_coords_to_5_decimals(tmp_path):
    """出力 JSON に 6 桁以上の小数座標が含まれない。"""
    output_dir = tmp_path / "municipalities"
    _run_split(output_dir)

    text = (output_dir / "13102.geojson").read_text(encoding="utf-8")
    long_decimals = re.findall(r"\d+\.\d{7,}", text)
    assert long_decimals == []
