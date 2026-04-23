"""build_adjacency.py の統合テスト。"""

import json
import subprocess
from pathlib import Path


HERE = Path(__file__).parent
SAMPLE = HERE / "sample_data" / "mini_n03.geojson"


def _prepare_municipalities(tmp_path: Path) -> Path:
    """サンプルデータから municipalities/*.geojson を生成する。"""
    muni_dir = tmp_path / "municipalities"
    subprocess.run(
        ["python3", "split_and_simplify.py",
         "--input", str(SAMPLE),
         "--output-dir", str(muni_dir)],
        cwd=HERE,
        check=True,
    )
    return muni_dir


def test_adjacency_detects_touching_munis(tmp_path):
    """隣接する 13101 と 13102 が相互にリンクされる。"""
    muni_dir = _prepare_municipalities(tmp_path)
    adjacency_path = tmp_path / "adjacency.json"

    result = subprocess.run(
        ["python3", "build_adjacency.py",
         "--municipalities-dir", str(muni_dir),
         "--output", str(adjacency_path)],
        cwd=HERE,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, f"stdout={result.stdout}\nstderr={result.stderr}"

    with open(adjacency_path, encoding="utf-8") as f:
        adjacency = json.load(f)

    assert "13101" in adjacency
    assert "13102" in adjacency
    assert "13102" in adjacency["13101"]
    assert "13101" in adjacency["13102"]


def test_adjacency_output_is_valid_json(tmp_path):
    """出力が valid な JSON で、値は list。"""
    muni_dir = _prepare_municipalities(tmp_path)
    adjacency_path = tmp_path / "adjacency.json"

    subprocess.run(
        ["python3", "build_adjacency.py",
         "--municipalities-dir", str(muni_dir),
         "--output", str(adjacency_path)],
        cwd=HERE,
        check=True,
    )

    with open(adjacency_path, encoding="utf-8") as f:
        adjacency = json.load(f)
    for code, neighbors in adjacency.items():
        assert isinstance(code, str)
        assert isinstance(neighbors, list)
        assert all(isinstance(n, str) for n in neighbors)
