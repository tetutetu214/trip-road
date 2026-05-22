"""Wikidata QID マッピング表をオフライン生成する。

入力: --municipalities-dir 配下の {code}.geojson 群
出力: --output に {code: Wikidata entry} の JSON
"""

import argparse
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Callable, Iterator, TypeVar
from urllib.error import HTTPError


DEFAULT_MUNICIPALITIES_DIR = Path("preprocess/out/municipalities")
DEFAULT_OUTPUT = Path("public/wikidata_qid.json")
DEFAULT_USER_AGENT = (
    "trip-road-qid-build/0.1 "
    "(https://github.com/tetutetu214/trip-road; "
    "lemoned.i.scream.art.of.noise@gmail.com)"
)
DEFAULT_ENDPOINT = "https://query.wikidata.org/sparql"
CODE5_RE = re.compile(r"^\d{5}$")
POINT_RE = re.compile(
    r"^Point\(\s*([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)\s*\)$"
)

T = TypeVar("T")


def collect_municipality_codes(dir_path: Path) -> list[str]:
    """*.geojson のファイル名から 5 桁コードだけを収集する。"""
    codes = {
        geojson_path.stem
        for geojson_path in dir_path.glob("*.geojson")
        if CODE5_RE.fullmatch(geojson_path.stem)
    }
    return sorted(codes)


def chunked(items: list[T], size: int) -> Iterator[list[T]]:
    """list を指定サイズごとに分割する。"""
    if size <= 0:
        raise ValueError("size must be greater than 0")
    for index in range(0, len(items), size):
        yield items[index:index + size]


def build_sparql_query(codes5: list[str]) -> str:
    """5 桁コードから WDQS 用 SPARQL を組み立てる。"""
    invalid_codes = [code for code in codes5 if not CODE5_RE.fullmatch(code)]
    if invalid_codes:
        raise ValueError(f"Invalid municipality code: {invalid_codes[0]}")

    values = " ".join(f'"{code}"' for code in codes5)
    return f"""SELECT ?code5 ?city ?cityLabel ?coord ?wpUrl WHERE {{
  VALUES ?code5 {{ {values} }}
  ?city wdt:P429 ?code6 .
  FILTER(STRSTARTS(?code6, ?code5))
  OPTIONAL {{ ?city wdt:P625 ?coord . }}
  OPTIONAL {{
    ?wpUrl schema:about ?city ;
            schema:isPartOf <https://ja.wikipedia.org/> .
  }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "ja". }}
}}"""


def parse_coord(wkt: str) -> tuple[float, float] | None:
    """WKT Point を (lat, lon) に変換する。"""
    match = POINT_RE.fullmatch(wkt)
    if not match:
        return None
    lon = float(match.group(1))
    lat = float(match.group(2))
    return lat, lon


def parse_wikipedia_title(url: str) -> str | None:
    """ja.wikipedia.org の記事 URL からタイトルを取り出す。"""
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        return None
    if parsed.netloc != "ja.wikipedia.org":
        return None
    prefix = "/wiki/"
    if not parsed.path.startswith(prefix):
        return None
    title = parsed.path[len(prefix):]
    if not title:
        return None
    return urllib.parse.unquote(title)


def parse_sparql_response(
    json_data: dict,
    queried_codes: list[str],
) -> dict[str, dict]:
    """WDQS の標準レスポンスから QID マッピングを抽出する。"""
    queried_code_set = set(queried_codes)
    result: dict[str, dict] = {}
    bindings = json_data.get("results", {}).get("bindings", [])

    for binding in bindings:
        code5 = binding.get("code5", {}).get("value")
        if code5 not in queried_code_set:
            continue
        if code5 in result:
            print(
                f"Warning: duplicate Wikidata binding for code {code5}; "
                "using first entry",
                file=sys.stderr,
            )
            continue

        city_url = binding.get("city", {}).get("value", "")
        qid = city_url.rstrip("/").rsplit("/", 1)[-1]
        label_ja = binding.get("cityLabel", {}).get("value")
        coord_wkt = binding.get("coord", {}).get("value")
        parsed_coord = parse_coord(coord_wkt) if coord_wkt else None
        lat = parsed_coord[0] if parsed_coord else None
        lon = parsed_coord[1] if parsed_coord else None
        wp_url = binding.get("wpUrl", {}).get("value")

        result[code5] = {
            "qid": qid,
            "label_ja": label_ja,
            "lat": lat,
            "lon": lon,
            "wikipedia_ja": parse_wikipedia_title(wp_url) if wp_url else None,
        }

    return result


def fetch_sparql(
    endpoint: str,
    query: str,
    user_agent: str,
    timeout: float = 60.0,
) -> dict:
    """WDQS に POST し、JSON レスポンスを返す。"""
    body = urllib.parse.urlencode({"query": query}).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=body,
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Accept": "application/sparql-results+json",
            "User-Agent": user_agent,
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.load(response)
    except HTTPError as error:
        if 500 <= error.code < 600:
            time.sleep(5)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        raise


def build_qid_map(
    codes: list[str],
    batch_size: int,
    sleep_sec: float,
    fetch_fn: Callable[[str], dict],
) -> dict[str, dict]:
    """コード一覧をバッチ処理し、QID マッピングを生成する。"""
    result: dict[str, dict] = {}
    batches = list(chunked(codes, batch_size))
    for index, batch_codes in enumerate(batches):
        query = build_sparql_query(batch_codes)
        response = fetch_fn(query)
        result.update(parse_sparql_response(response, batch_codes))
        if sleep_sec > 0 and index < len(batches) - 1:
            time.sleep(sleep_sec)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Wikidata QID map")
    parser.add_argument(
        "--municipalities-dir",
        default=DEFAULT_MUNICIPALITIES_DIR,
        type=Path,
    )
    parser.add_argument("--output", default=DEFAULT_OUTPUT, type=Path)
    parser.add_argument("--batch-size", default=100, type=int)
    parser.add_argument("--sleep", default=2.0, type=float)
    parser.add_argument("--timeout", default=90.0, type=float)
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT)
    parser.add_argument("--endpoint", default=DEFAULT_ENDPOINT)
    args = parser.parse_args()

    codes = collect_municipality_codes(args.municipalities_dir)
    qid_map = build_qid_map(
        codes,
        args.batch_size,
        args.sleep,
        lambda query: fetch_sparql(
            args.endpoint, query, args.user_agent, timeout=args.timeout
        ),
    )

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as output_file:
        json.dump(qid_map, output_file, ensure_ascii=False, indent=2)

    print(f"Wrote {args.output} with {len(qid_map)} entries", file=sys.stderr)


if __name__ == "__main__":
    main()
