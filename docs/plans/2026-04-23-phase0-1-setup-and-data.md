# trip-road Phase 0-1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 0（開発環境準備）と Phase 1（N03 データ前処理）を完了し、Cloudflare Pages から全国の市町村 GeoJSON（`/municipalities/{code}.geojson`）と隣接マスタ（`/adjacency.json`）が配信されている状態を実現する。

**Architecture:** Anthropic API キーと 32 文字ランダムパスワードを `~/.secrets/trip-road.env` に集約。Google Cloud Shell 上で Python 3 + geopandas + shapely を使い、N03 原本を市町村コード単位に分割、Douglas-Peucker（tolerance 0.0005 度）で簡略化、座標を小数 5 桁に丸め、プロパティを `N03_001/004/007` のみに絞る。隣接関係は `touches` と `intersects(buffer)` の論理和で全ペア計算。生成物を Cloudflare Pages プロジェクト `trip-road-data` にデプロイ。

**Tech Stack:** Python 3.12 / geopandas 0.14 / shapely 2.0 / pytest 8.0 / Google Cloud Shell / Cloudflare Pages / Wrangler CLI / OpenSSL

---

## ブランチ戦略

Plan A（本ドキュメント）の全タスクは単一ブランチ `feature/phase0-1-setup-and-data` で進める。最終タスクで `main` への PR を作成してマージする。

## File Structure

**リポジトリに追加するファイル（コミット対象）**:
- `preprocess/README.md` — 前処理スクリプトの使い方
- `preprocess/requirements.txt` — Python 依存
- `preprocess/helpers.py` — 純粋関数（座標丸め・プロパティ絞り・コード抽出）
- `preprocess/test_helpers.py` — helpers.py の単体テスト
- `preprocess/split_and_simplify.py` — N03 を市町村コード別に分割・簡略化
- `preprocess/test_split.py` — 統合テスト
- `preprocess/build_adjacency.py` — 隣接マスタ生成
- `preprocess/test_adjacency.py` — 統合テスト
- `preprocess/download_n03.sh` — N03 原本ダウンロードスクリプト
- `preprocess/sample_data/mini_n03.geojson` — テスト用小サンプル
- `.env.example` — 環境変数テンプレート（値は空）

**ローカル専用（git コミットしない）**:
- `~/.secrets/trip-road.env` — 実際の API キー・パスワード

**生成物（git コミットせず Cloudflare Pages に直接デプロイ）**:
- `preprocess/out/municipalities/*.geojson`
- `preprocess/out/adjacency.json`
- `preprocess/tmp/N03-*/` — N03 原本展開場所

---

## Phase 0: 準備

### Task 1: Anthropic API 準備（手作業）

**Files:** なし（ブラウザ作業）

- [ ] **Step 1: Anthropic コンソールにアカウント作成**

ブラウザで https://console.anthropic.com を開く → 「Sign up」→ Google アカウントでログイン（または email で作成）。

- [ ] **Step 2: 支払い方法を登録**

左メニュー「Billing」→「Payment methods」→「Add payment method」でクレジットカード情報を入力。

- [ ] **Step 3: クレジットを購入**

「Billing」→「Purchase credits」で `$5` 以上を購入。Anthropic API は従量課金で、最低 $5 の前払いが必要。

- [ ] **Step 4: API キーを発行**

左メニュー「API Keys」→「Create Key」→ Name: `trip-road`、Permissions はデフォルト（Write）→「Create」をクリック。表示された `sk-ant-...` で始まる文字列を**この画面でしか見られない**のでコピーしてメモ帳に一時保存する。

- [ ] **Step 5: 次タスクへ**

このキーは次の Task 3 で `~/.secrets/trip-road.env` に転記する。メモ帳に残したまま次へ。

---

### Task 2: Wrangler CLI インストール + Cloudflare ログイン

**Files:** なし（グローバルツール導入）

- [ ] **Step 1: Node.js バージョン確認**

```bash
node --version
```

Expected: `v18.x.x` 以上。未インストールなら https://nodejs.org から LTS 版をインストール後、ターミナルを開き直す。

- [ ] **Step 2: Wrangler CLI インストール**

```bash
npm install -g wrangler
```

Expected: `added 1 package in ...` などのインストール完了メッセージ。

- [ ] **Step 3: バージョン確認**

```bash
wrangler --version
```

Expected: `⛅️ wrangler 3.x.x` 形式の表示。

- [ ] **Step 4: Cloudflare にログイン**

```bash
wrangler login
```

ブラウザが自動で開き、Cloudflare のログインページが表示される → ログイン → 「Allow」をクリック → ターミナルに戻る。

Expected: ターミナルに `Successfully logged in!` が表示。

- [ ] **Step 5: ログイン確認**

```bash
wrangler whoami
```

Expected:

```
You are logged in with the OAuth Token, associated with the email {user}@{domain}!
...
Account ID: {32文字のhex}
```

---

### Task 3: パスワード生成と `~/.secrets/trip-road.env` 作成

**Files:**
- Create: `~/.secrets/trip-road.env`（git 管理外）

- [ ] **Step 1: シークレットディレクトリ作成**

```bash
mkdir -p ~/.secrets
chmod 700 ~/.secrets
```

Expected: エラーなし。

- [ ] **Step 2: 32 文字ランダムパスワード生成**

```bash
openssl rand -hex 16
```

Expected: 32 文字の 16 進数（例: `a3f9b12c8e4d6710ff293a4bc1e8d5d2`）。この文字列をメモ帳にコピー。

- [ ] **Step 3: env ファイルの雛形を作成**

```bash
cat > ~/.secrets/trip-road.env <<'EOF'
# Anthropic API Key (Task 1 で発行)
ANTHROPIC_API_KEY=REPLACE_WITH_ANTHROPIC_KEY

# App password (Task 3 Step 2 で生成した 32 文字 hex)
APP_PASSWORD=REPLACE_WITH_32_HEX

# CORS 許可オリジン（Phase 4 で Cloudflare Pages の URL が確定したら更新）
ALLOWED_ORIGIN=https://trip-road.pages.dev
EOF
```

Expected: エラーなし。ファイルが作成される。

- [ ] **Step 4: 実際の値に差し替え**

```bash
nano ~/.secrets/trip-road.env
```

- `REPLACE_WITH_ANTHROPIC_KEY` を Task 1 でコピーした `sk-ant-...` に置換
- `REPLACE_WITH_32_HEX` を Step 2 でコピーした 32 文字 hex に置換
- `Ctrl+O` → `Enter`（保存）→ `Ctrl+X`（終了）

- [ ] **Step 5: 権限を 600 に制限**

```bash
chmod 600 ~/.secrets/trip-road.env
```

Expected: エラーなし。

- [ ] **Step 6: 値の整合性を確認（先頭数文字のみ表示）**

```bash
source ~/.secrets/trip-road.env && \
  echo "API key prefix: ${ANTHROPIC_API_KEY:0:10}" && \
  echo "Password length: ${#APP_PASSWORD}" && \
  echo "Allowed origin: $ALLOWED_ORIGIN"
```

Expected:

```
API key prefix: sk-ant-ap-
Password length: 32
Allowed origin: https://trip-road.pages.dev
```

Password length が 32 以外なら Step 4 のコピペミス。API key prefix が `sk-ant-` で始まらなければ貼り付け間違い。

---

### Task 4: `.env.example` 作成

**Files:**
- Create: `/home/tetutetu/projects/trip-road/.env.example`

- [ ] **Step 1: `.env.example` を作成**

```bash
cat > /home/tetutetu/projects/trip-road/.env.example <<'EOF'
# trip-road 環境変数テンプレート
# 実際の値は ~/.secrets/trip-road.env に記載する（このリポジトリにはコミットしない）

# Anthropic API Key（console.anthropic.com で発行）
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxx

# App password（openssl rand -hex 16 で生成した 32 文字 hex）
APP_PASSWORD=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# CORS で許可するオリジン（Cloudflare Pages のドメイン）
ALLOWED_ORIGIN=https://trip-road.pages.dev
EOF
```

Expected: エラーなし。

- [ ] **Step 2: 内容確認**

```bash
cat /home/tetutetu/projects/trip-road/.env.example
```

Expected: Step 1 で書いた内容が表示される。

---

### Task 5: Phase 0 コミット

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/docs/todo.md`
- Add: `/home/tetutetu/projects/trip-road/.env.example`

- [ ] **Step 1: 作業ブランチを作成**

```bash
cd /home/tetutetu/projects/trip-road
git switch -c feature/phase0-1-setup-and-data
```

Expected: `Switched to a new branch 'feature/phase0-1-setup-and-data'`

- [ ] **Step 2: `docs/todo.md` の Phase 0 をチェック**

手動で `docs/todo.md` を開き、以下のチェックボックスを `[x]` に書き換える：

```markdown
## Phase 0: 準備
- [x] GitHub リポジトリ `tetutetu214/trip-road` 作成（パブリック + Secret Scanning 有効）
- [x] 初回コミット & プッシュ（docs / CLAUDE.md / memo.txt）
- [x] Cloudflare アカウント動作確認（Pages・Workers 利用可能か）
- [x] Anthropic アカウント作成 + $5 クレジット前払い + APIキー発行
- [x] 32文字ランダムパスワード生成（`openssl rand -hex 16`）し `~/.secrets/trip-road.env` に保存
- [x] Google Cloud Shell 接続確認
- [ ] `feature/phase0-setup` ブランチで PR 作成
```

（最後の PR 作成は Task 16 で行うため未チェックのまま）

- [ ] **Step 3: ステージング**

```bash
cd /home/tetutetu/projects/trip-road
git add .env.example docs/todo.md
git status
```

Expected: `.env.example`（新規）と `docs/todo.md`（更新）がステージ対象。

- [ ] **Step 4: コミット**

```bash
git commit -m "$(cat <<'EOF'
chore: Phase 0 準備完了（Anthropic・Cloudflare・ローカル環境）

- Anthropic アカウント作成・$5 クレジット・APIキー発行
- Wrangler CLI インストール・Cloudflare ログイン
- 32 文字ランダムパスワード生成し ~/.secrets/trip-road.env に格納
- .env.example をリポジトリに追加（値はテンプレート）
- docs/todo.md の Phase 0 をチェック済みに更新

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: `[feature/phase0-1-setup-and-data ...] chore: Phase 0 ...`

- [ ] **Step 5: プッシュ**

```bash
git push -u origin feature/phase0-1-setup-and-data
```

Expected: `branch 'feature/phase0-1-setup-and-data' set up to track 'origin/feature/phase0-1-setup-and-data'.`

---

## Phase 1: データ前処理

### Task 6: `preprocess/` 構造と `requirements.txt` と `README.md`

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/README.md`
- Create: `/home/tetutetu/projects/trip-road/preprocess/requirements.txt`

- [ ] **Step 1: ディレクトリ作成**

```bash
mkdir -p /home/tetutetu/projects/trip-road/preprocess/sample_data
```

Expected: エラーなし。

- [ ] **Step 2: `requirements.txt` 作成**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/requirements.txt <<'EOF'
geopandas==0.14.3
shapely==2.0.2
pytest==8.0.0
EOF
```

Expected: エラーなし。

- [ ] **Step 3: `README.md` 作成**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/README.md <<'EOF'
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
python3 split_and_simplify.py \\
  --input tmp/N03-20240101_GML/N03-20240101.shp \\
  --output-dir out/municipalities/
python3 build_adjacency.py \\
  --municipalities-dir out/municipalities/ \\
  --output out/adjacency.json
```

## 出力

- `out/municipalities/{市町村コード}.geojson` — 市町村ごとの分割 GeoJSON
- `out/adjacency.json` — 隣接マスタ（`{code: [neighbor_code, ...]}`）

## Cloudflare Pages へのデプロイ

```bash
cd out
wrangler pages deploy . --project-name=trip-road-data
```
EOF
```

Expected: エラーなし。

- [ ] **Step 4: 構造確認**

```bash
ls -la /home/tetutetu/projects/trip-road/preprocess/
```

Expected:

```
README.md
requirements.txt
sample_data/
```

---

### Task 7: `helpers.py` のテスト（TDD - failing test）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/test_helpers.py`

- [ ] **Step 1: 単体テストを書く**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/test_helpers.py <<'EOF'
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
EOF
```

Expected: エラーなし。

- [ ] **Step 2: テスト実行（失敗を確認）**

```bash
cd /home/tetutetu/projects/trip-road/preprocess
pip install -r requirements.txt
pytest test_helpers.py -v
```

Expected: `ModuleNotFoundError: No module named 'helpers'`（helpers.py 未作成のため全て失敗）。

---

### Task 8: `helpers.py` 実装 + コミット

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/helpers.py`

- [ ] **Step 1: `helpers.py` 実装**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/helpers.py <<'EOF'
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
EOF
```

Expected: エラーなし。

- [ ] **Step 2: テスト実行（成功を確認）**

```bash
cd /home/tetutetu/projects/trip-road/preprocess
pytest test_helpers.py -v
```

Expected: `5 passed`

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add preprocess/README.md preprocess/requirements.txt preprocess/helpers.py preprocess/test_helpers.py
git commit -m "$(cat <<'EOF'
feat(preprocess): helpers.py と単体テストを TDD で追加

- round_geojson_coords: GeoJSON 座標を再帰的に丸める（Polygon/MultiPolygon）
- filter_feature_properties: N03_001/004/007 のみ残す
- extract_muni_code: N03_007 を取り出す

5 テスト、すべて pass。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

Expected: push 成功。

---

### Task 9: `download_n03.sh`

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/download_n03.sh`

- [ ] **Step 1: スクリプト作成**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/download_n03.sh <<'EOF'
#!/bin/bash
# N03（国土数値情報 行政区域データ）の 2024 年 1 月 1 日版をダウンロード・展開
# 使用: bash download_n03.sh
# 出力: tmp/N03-20240101_GML/ に shape ファイル群

set -euo pipefail

N03_VERSION="N03-20240101"
N03_URL="https://nlftp.mlit.go.jp/ksj/gml/data/N03/N03-2024/${N03_VERSION}_GML.zip"

OUTPUT_DIR="./tmp"
mkdir -p "$OUTPUT_DIR"

echo "Downloading ${N03_URL}..."
cd "$OUTPUT_DIR"
wget -q --show-progress "${N03_URL}"

echo "Extracting..."
unzip -q -o "${N03_VERSION}_GML.zip"

echo "Done. Extracted to: ${OUTPUT_DIR}/${N03_VERSION}_GML/"
ls -la "${N03_VERSION}_GML/" | head -20
EOF
chmod +x /home/tetutetu/projects/trip-road/preprocess/download_n03.sh
```

Expected: エラーなし、`download_n03.sh` が実行可能になる。

- [ ] **Step 2: 構文チェック**

```bash
bash -n /home/tetutetu/projects/trip-road/preprocess/download_n03.sh
```

Expected: 出力なし（構文 OK）。

**注意**: このスクリプトの実際の実行は Task 14（Google Cloud Shell）で行う。ローカルではダウンロードサイズ（数十 MB）と処理時間の都合で回さない。

---

### Task 10: `split_and_simplify.py` の統合テスト（TDD - failing test）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/sample_data/mini_n03.geojson`
- Create: `/home/tetutetu/projects/trip-road/preprocess/test_split.py`

- [ ] **Step 1: サンプル GeoJSON 作成**

`13101` コードに属する 2 枚のポリゴン（縦に隣接）と、`13102` コードに属する 1 枚のポリゴン（13101 の右隣）を配置する。

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/sample_data/mini_n03.geojson <<'EOF'
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[139.76, 35.68], [139.77, 35.68], [139.77, 35.69], [139.76, 35.69], [139.76, 35.68]]]
      },
      "properties": {"N03_001": "東京都", "N03_002": null, "N03_004": "千代田区A", "N03_007": "13101"}
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[139.76, 35.69], [139.77, 35.69], [139.77, 35.70], [139.76, 35.70], [139.76, 35.69]]]
      },
      "properties": {"N03_001": "東京都", "N03_002": null, "N03_004": "千代田区A", "N03_007": "13101"}
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "Polygon",
        "coordinates": [[[139.77, 35.68], [139.78, 35.68], [139.78, 35.69], [139.77, 35.69], [139.77, 35.68]]]
      },
      "properties": {"N03_001": "東京都", "N03_002": null, "N03_004": "中央区B", "N03_007": "13102"}
    }
  ]
}
EOF
```

Expected: エラーなし。

- [ ] **Step 2: 統合テスト作成**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/test_split.py <<'EOF'
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
EOF
```

Expected: エラーなし。

- [ ] **Step 3: テスト実行（失敗を確認）**

```bash
cd /home/tetutetu/projects/trip-road/preprocess
pytest test_split.py -v
```

Expected: 4 テストが失敗（`split_and_simplify.py` 未作成のため）。

---

### Task 11: `split_and_simplify.py` 実装 + コミット

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/split_and_simplify.py`

- [ ] **Step 1: スクリプト実装**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/split_and_simplify.py <<'EOF'
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
EOF
```

Expected: エラーなし。

- [ ] **Step 2: テスト実行（成功を確認）**

```bash
cd /home/tetutetu/projects/trip-road/preprocess
pytest test_split.py -v
```

Expected: `4 passed`

- [ ] **Step 3: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add preprocess/download_n03.sh preprocess/sample_data/mini_n03.geojson preprocess/test_split.py preprocess/split_and_simplify.py
git commit -m "$(cat <<'EOF'
feat(preprocess): split_and_simplify.py を TDD で実装

N03 を市町村コード単位に分割し、Douglas-Peucker で簡略化
(tolerance 0.0005 度 ≈ 55m)、プロパティを N03_001/004/007 に絞り、
座標を小数 5 桁に丸める。同一コードの複数ポリゴンは unary_union で
MultiPolygon 化。

- サンプルデータ sample_data/mini_n03.geojson
- 統合テスト test_split.py 4 本（全 pass）
- download_n03.sh で N03 原本取得スクリプトも追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

Expected: push 成功。

---

### Task 12: `build_adjacency.py` のテスト（TDD - failing test）

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/test_adjacency.py`

- [ ] **Step 1: 統合テスト作成**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/test_adjacency.py <<'EOF'
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
EOF
```

Expected: エラーなし。

- [ ] **Step 2: テスト実行（失敗を確認）**

```bash
cd /home/tetutetu/projects/trip-road/preprocess
pytest test_adjacency.py -v
```

Expected: 失敗（`build_adjacency.py` 未作成）。

---

### Task 13: `build_adjacency.py` 実装 + コミット

**Files:**
- Create: `/home/tetutetu/projects/trip-road/preprocess/build_adjacency.py`

- [ ] **Step 1: スクリプト実装**

```bash
cat > /home/tetutetu/projects/trip-road/preprocess/build_adjacency.py <<'EOF'
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
EOF
```

Expected: エラーなし。

- [ ] **Step 2: テスト実行（成功を確認）**

```bash
cd /home/tetutetu/projects/trip-road/preprocess
pytest test_adjacency.py -v
```

Expected: `2 passed`

- [ ] **Step 3: 全テストがグリーンであることを再確認**

```bash
cd /home/tetutetu/projects/trip-road/preprocess
pytest -v
```

Expected: `11 passed`（helpers 5 + split 4 + adjacency 2）。

- [ ] **Step 4: コミット**

```bash
cd /home/tetutetu/projects/trip-road
git add preprocess/test_adjacency.py preprocess/build_adjacency.py
git commit -m "$(cat <<'EOF'
feat(preprocess): build_adjacency.py を TDD で実装

Shapely の geometry.touches ∪ intersects(buffer) の論理和で隣接判定。
空間インデックスで計算量を削減。出力は {code: [neighbor_code,...]} 形式。

- 統合テスト test_adjacency.py 2 本（全 pass）
- 全 pytest 11 テスト pass 確認

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

Expected: push 成功。

---

### Task 14: Google Cloud Shell で全国実行

**Files:** なし（Google Cloud Shell 上での実行のみ）

- [ ] **Step 1: Google Cloud Shell を開く**

ブラウザで https://console.cloud.google.com/ にログイン → 画面右上のターミナルアイコン（">_"）をクリック → Cloud Shell が起動（初回はプロビジョニングで 1 分程度かかる）。

- [ ] **Step 2: リポジトリをクローン**

```bash
cd ~
git clone https://github.com/tetutetu214/trip-road.git
cd trip-road/preprocess
git switch feature/phase0-1-setup-and-data
```

Expected: ブランチ切り替え成功。

- [ ] **Step 3: Python 依存インストール**

```bash
python3 --version   # 3.10 以上であること
pip install --user -r requirements.txt
```

Expected: インストール完了。`geopandas`, `shapely`, `pytest` が入る。

- [ ] **Step 4: 単体/統合テスト実行（cloud shell でもグリーン確認）**

```bash
python3 -m pytest -v
```

Expected: `11 passed`

- [ ] **Step 5: N03 原本ダウンロード**

```bash
bash download_n03.sh
```

Expected: `tmp/N03-20240101_GML/` に `.shp`, `.dbf`, `.shx`, `.prj` が展開される。

- [ ] **Step 6: 分割・簡略化の全国実行**

```bash
python3 split_and_simplify.py \
  --input tmp/N03-20240101_GML/N03-20240101.shp \
  --output-dir out/municipalities/
```

Expected: 15〜30 分で完了。標準出力に `Wrote {N} files to out/municipalities/` と表示。N は約 1900（区単位込み）。

- [ ] **Step 7: 隣接マスタ生成**

```bash
python3 build_adjacency.py \
  --municipalities-dir out/municipalities/ \
  --output out/adjacency.json
```

Expected: 3〜5 分で完了。

- [ ] **Step 8: 結果サマリを確認**

```bash
echo "ファイル数:"
ls out/municipalities/ | wc -l

echo "合計サイズ:"
du -sh out/municipalities/

echo "adjacency.json サイズ:"
du -sh out/adjacency.json

echo "adjacency.json 冒頭サンプル:"
head -c 500 out/adjacency.json
echo ""
```

Expected: ファイル数 1500〜1900、合計サイズ 30〜60MB、`adjacency.json` 50〜150KB。

---

### Task 15: Cloudflare Pages にデータをデプロイ

**Files:** なし（Cloud Shell 上の操作）

- [ ] **Step 1: Wrangler インストール（Cloud Shell 内）**

```bash
npm install -g wrangler
wrangler --version
```

Expected: `⛅️ wrangler 3.x.x`

- [ ] **Step 2: Wrangler で Cloudflare にログイン**

```bash
wrangler login
```

ブラウザタブが開く → 許可 → ターミナルに戻り `Successfully logged in!` を確認。

（Cloud Shell の場合は、ブラウザとの OAuth 連携が動作することを確認。もし失敗したら `--browser=false` オプションで API Token ベースの認証に切り替え、https://dash.cloudflare.com/profile/api-tokens で Token 発行 → `wrangler config` に入力。）

- [ ] **Step 3: Pages プロジェクト作成**

```bash
cd ~/trip-road/preprocess/out
wrangler pages project create trip-road-data --production-branch main
```

Expected: プロジェクトが作成され、URL `https://trip-road-data.pages.dev` が予約される。

- [ ] **Step 4: デプロイ**

```bash
wrangler pages deploy . --project-name=trip-road-data
```

Expected: アップロード完了、デプロイ URL が表示される（例: `https://abcd1234.trip-road-data.pages.dev`）。

- [ ] **Step 5: 動作確認（curl）**

```bash
# 千代田区のファイル取得
curl -s -o /dev/null -w "HTTP %{http_code}, size %{size_download}\n" \
  https://trip-road-data.pages.dev/municipalities/13101.geojson

# adjacency.json 取得と先頭確認
curl -s https://trip-road-data.pages.dev/adjacency.json | head -c 300
echo ""
```

Expected: HTTP 200、ファイルサイズが数十〜数百 KB、adjacency.json の先頭が `{"01100":["01101",...],...}` 形式。

---

### Task 16: 最終検証 + knowledge/todo 更新 + PR 作成

**Files:**
- Modify: `/home/tetutetu/projects/trip-road/docs/todo.md`
- Modify: `/home/tetutetu/projects/trip-road/docs/knowledge.md`

- [ ] **Step 1: ローカルに戻って `docs/todo.md` を更新**

（Cloud Shell から出て、ローカルマシンで作業）

```bash
cd /home/tetutetu/projects/trip-road
git switch feature/phase0-1-setup-and-data
git pull   # Cloud Shell 上のコミットがあれば同期
```

`docs/todo.md` を開き、Phase 1 の全チェックボックスを `[x]` に変更。

- [ ] **Step 2: `docs/knowledge.md` に実測値を追記**

`docs/knowledge.md` の「4. ハマリポイント・注意事項」セクションに以下のような実測値を追記（Task 14 Step 8 の結果を反映）：

```markdown
### 4.1 Phase 1 実測値（2026-04-23 Google Cloud Shell 実行）

- N03-20240101 原本: {実測 MB}
- 出力ファイル数: {実測} 個
- 合計サイズ: {実測 MB}
- 最大単ファイル: {実測 KB、どの市町村か}
- adjacency.json: {実測 KB}、エントリ数 {実測}
- split_and_simplify 実行時間: {実測 分}
- build_adjacency 実行時間: {実測 分}
```

- [ ] **Step 3: コミット**

```bash
git add docs/todo.md docs/knowledge.md
git commit -m "$(cat <<'EOF'
docs: Phase 1 完了、データ前処理の実測値を追記

Google Cloud Shell での全国実行結果を knowledge.md に記録。
- 出力ファイル数・合計サイズ・adjacency エントリ数
- split_and_simplify / build_adjacency の実行時間

docs/todo.md の Phase 1 項目を完了マーク。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
git push
```

Expected: push 成功。

- [ ] **Step 4: PR 作成（GitHub MCP 経由）**

Claude が `mcp__github__create_pull_request` で PR を作成する：

- owner: `tetutetu214`
- repo: `trip-road`
- base: `main`
- head: `feature/phase0-1-setup-and-data`
- title: `Phase 0-1: 準備とデータ前処理の完了`
- body: Phase 0 と Phase 1 の変更内容サマリ、テスト結果、デプロイ URL を含める

- [ ] **Step 5: ブラウザで PR レビュー → マージ**

ユーザが PR URL にアクセスし、Files changed タブで全差分を確認。問題なければ「Squash and merge」を実行。

- [ ] **Step 6: ローカル同期とブランチ削除**

```bash
cd /home/tetutetu/projects/trip-road
git switch main
git pull origin main
git branch -d feature/phase0-1-setup-and-data
```

Expected: main が最新、feature ブランチ削除完了。

- [ ] **Step 7: 動作確認（最終チェック）**

ブラウザで以下を開いて JSON が返ることを確認：

- https://trip-road-data.pages.dev/municipalities/13101.geojson
- https://trip-road-data.pages.dev/adjacency.json

Expected: 両方とも JSON がブラウザに表示される。

---

## 完了条件（Plan A 全体）

以下がすべて満たされれば Plan A 完了とする：

1. `~/.secrets/trip-road.env` に `ANTHROPIC_API_KEY` / `APP_PASSWORD` / `ALLOWED_ORIGIN` が設定されている
2. `preprocess/` 配下の全スクリプトが作成され、全 pytest（11 テスト）が pass
3. Cloudflare Pages `trip-road-data` プロジェクトが作成され、`/municipalities/{code}.geojson` と `/adjacency.json` が配信されている
4. `main` ブランチに Plan A の全変更がマージされている
5. `docs/todo.md` の Phase 0 と Phase 1 がすべてチェック済
6. `docs/knowledge.md` に Phase 1 実測値が記録されている

## 次のステップ

Plan A 完了後、**Plan B（Phase 2: Cloudflare Workers 実装）** の作成に移る。writing-plans スキルを再度呼び出し、`docs/plans/2026-04-23-phase2-workers.md` を書き出す。

Plan B で実装する主要機能:
- 認証プロキシ Worker（`X-App-Password` 定数時間比較）
- Anthropic Messages API へのフォワード
- CORS 設定
- Workers Secrets 登録
- ローカル `wrangler dev` 動作確認
- 本番デプロイと curl による E2E 確認
