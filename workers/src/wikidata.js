/**
 * Wikidata SPARQL クライアント（Issue #38 / Plan G-4）
 *
 * QID を渡して Wikidata から構造化属性（種別・由来・構成地区・姉妹都市・隣接水域・
 * 位置する地形・上位行政体の中心）を取得し、Generator/Judge の in-context として
 * 同梱できる形に整形する。
 *
 * Workers Cache API で 30 日 TTL。Wikipedia 抜粋取得 (wikipedia.js) と並列に呼ぶ前提。
 *
 * 設計の前提:
 *   - 同定キー (QID) は事前バッチ (preprocess/build_wikidata_qid_map.py) で
 *     `public/wikidata_qid.json` に保存済。runtime ではここから引いた QID で SPARQL
 *   - SPARQL タイムアウト・5xx は **null 返し**で fail-open（Wikipedia 単独 RAG に
 *     フォールバック、Plan I の合格率 100% を絶対に下回らない）
 *
 * 公開関数:
 *   - WIKIDATA_PROPS / WIKIDATA_P150_MAX (定数)
 *   - buildWikidataSparqlQuery (純粋関数)
 *   - parseWikidataResponse (純粋関数)
 *   - buildWikidataCacheKey (純粋関数)
 *   - formatWikidataForPrompt (純粋関数)
 *   - fetchWikidataAttributes (副作用)
 *   - getCachedWikidataAttributes (副作用)
 */

// ---- 定数 ----

export const DEFAULT_ENDPOINT = 'https://query.wikidata.org/sparql';

// 連絡先付き User-Agent は Wikimedia 系サービス共通のポリシー。
export const USER_AGENT =
  'trip-road-worker/0.1 (https://github.com/tetutetu214/trip-road; lemoned.i.scream.art.of.noise@gmail.com)';

// Workers Cache API の TTL。属性は月〜年単位でしか変動しないため長め。
export const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

// 取得するプロパティ（合意済、出題スモークで確定）:
//   P31 種別 / P138 名前の由来 / P150 構成地区 / P190 姉妹都市 /
//   P206 隣接水域 / P706 位置する地形 / P1376 上位行政体の中心
export const WIKIDATA_PROPS = ['P31', 'P138', 'P150', 'P190', 'P206', 'P706', 'P1376'];

// 構成地区 (P150) の context 制限。千代田区で 58 件あるため、Generator の
// in-context を膨張させすぎない目的で先頭 N 件に切り詰める。
export const WIKIDATA_P150_MAX = 20;

const QID_RE = /^Q\d+$/;
const QID_LABEL_FALLBACK_RE = /^Q\d+$/;

const RETRY_DELAY_MS = 3000;

// プロパティラベル → parseWikidataResponse の出力キーの対応。
// SPARQL では `?propLabel` がプロパティの ja ラベルになるので、これでマッピング。
const PROP_TO_FIELD = {
  P31: 'instanceOf',
  P138: 'namedAfter',
  P150: 'parts',
  P190: 'twinnedWith',
  P206: 'waterBodies',
  P706: 'terrainFeatures',
  P1376: 'capitalOf',
};

// PROP_TO_FIELD の値 → 表示名。formatWikidataForPrompt が使う。
const FIELD_TO_DISPLAY_LABEL = {
  instanceOf: '種別',
  namedAfter: '名前の由来',
  capitalOf: '上位行政体の中心',
  waterBodies: '隣接水域',
  terrainFeatures: '位置する地形',
  twinnedWith: '姉妹都市',
  parts: '構成地区',
};

// formatWikidataForPrompt の出力順。読みやすさ重視で「種別 → 由来 → 上位 →
// 地形 → 水域 → 姉妹都市 → 構成地区」の順に並べる。構成地区は長くなりがちなので最後。
const FORMAT_ORDER = [
  'instanceOf',
  'namedAfter',
  'capitalOf',
  'waterBodies',
  'terrainFeatures',
  'twinnedWith',
  'parts',
];

// ---- 純粋関数 ----

/**
 * QID に対する SPARQL を組み立てる。
 *
 * VALUES でプロパティを束ね、wikibase:directClaim で truthy statement を一発取得。
 * SERVICE wikibase:label で値の ja ラベルも同時取得。
 *
 * @param {string} qid - "Q214051" 形式
 * @returns {string}
 * @throws {Error} QID が不正形式のとき
 */
export function buildWikidataSparqlQuery(qid) {
  if (typeof qid !== 'string' || !QID_RE.test(qid)) {
    throw new Error(`invalid QID: ${qid}`);
  }
  const propsValues = WIKIDATA_PROPS.map((p) => `wd:${p}`).join(' ');
  return `SELECT ?prop ?propLabel ?value ?valueLabel WHERE {
  VALUES ?prop { ${propsValues} }
  wd:${qid} ?p ?value .
  ?prop wikibase:directClaim ?p .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
}`;
}

/**
 * Workers Cache API のキー（ダミー Request）。
 * 外部到達不能な URL を使い、本物のリクエストと衝突しないようにする。
 *
 * @param {string} qid
 * @returns {Request}
 */
export function buildWikidataCacheKey(qid) {
  return new Request(`https://wikidata-cache.internal/v1/${qid}`);
}

/**
 * SPARQL レスポンスを構造化オブジェクトに変換する。
 *
 * 各プロパティの value は重複削除、空文字スキップ。
 * 構成地区 (parts) のみ partsTotal で全件数も保持し、本体 parts は WIKIDATA_P150_MAX 件まで。
 * ラベル取得失敗（`Q\d+` のまま残った値）は弾く。
 *
 * @param {object} json - WDQS 標準レスポンス `{ head, results: { bindings: [] } }`
 * @returns {{
 *   instanceOf: string[], namedAfter: string[], parts: string[], partsTotal: number,
 *   twinnedWith: string[], waterBodies: string[], terrainFeatures: string[], capitalOf: string[]
 * }}
 */
export function parseWikidataResponse(json) {
  /** @type {{ [field: string]: string[] }} */
  const buckets = {
    instanceOf: [],
    namedAfter: [],
    parts: [],
    twinnedWith: [],
    waterBodies: [],
    terrainFeatures: [],
    capitalOf: [],
  };
  const seen = {
    instanceOf: new Set(),
    namedAfter: new Set(),
    parts: new Set(),
    twinnedWith: new Set(),
    waterBodies: new Set(),
    terrainFeatures: new Set(),
    capitalOf: new Set(),
  };

  const bindings = json?.results?.bindings;
  if (!Array.isArray(bindings)) {
    return { ...buckets, partsTotal: 0 };
  }

  for (const b of bindings) {
    const propUrl = b?.prop?.value;
    if (typeof propUrl !== 'string') continue;
    const propId = propUrl.split('/').pop();
    const field = PROP_TO_FIELD[propId];
    if (!field) continue;

    const label = b?.valueLabel?.value;
    if (typeof label !== 'string' || label.length === 0) continue;
    if (QID_LABEL_FALLBACK_RE.test(label)) continue; // ラベル化失敗の "Q12345" は弾く
    if (seen[field].has(label)) continue;
    seen[field].add(label);
    buckets[field].push(label);
  }

  const partsTotal = buckets.parts.length;
  const parts = buckets.parts.slice(0, WIKIDATA_P150_MAX);
  return {
    ...buckets,
    parts,
    partsTotal,
  };
}

/**
 * parseWikidataResponse の戻り値を Generator/Judge の in-context 用文字列に整形する。
 *
 * 空属性の行は省略。すべて空なら空文字を返す（呼出側で「Wikidata なし」と扱える）。
 * 構成地区は WIKIDATA_P150_MAX を超える場合に「(...N件中M件)」のサフィックスを付ける。
 *
 * @param {ReturnType<typeof parseWikidataResponse>} attrs
 * @returns {string}
 */
export function formatWikidataForPrompt(attrs) {
  if (!attrs || typeof attrs !== 'object') return '';

  const lines = [];
  for (const field of FORMAT_ORDER) {
    const values = attrs[field];
    if (!Array.isArray(values) || values.length === 0) continue;
    const label = FIELD_TO_DISPLAY_LABEL[field];
    let line = `${label}: ${values.join(', ')}`;
    if (field === 'parts' && typeof attrs.partsTotal === 'number' && attrs.partsTotal > values.length) {
      line += ` (...${attrs.partsTotal}件中${values.length}件)`;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

// ---- 副作用ありの関数 ----

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SPARQL クエリを WDQS に POST し、JSON レスポンスを返す。
 *
 * - User-Agent 必須（Wikimedia ポリシー）
 * - 5xx は 1 回だけリトライ（3 秒待ち）
 * - 4xx 即 null
 * - 例外（network error 等）は捕捉して null
 *
 * 失敗は null で返す（**throw しない**）ことで Wikipedia 単独 RAG への
 * フォールバックを保証する。
 *
 * @param {object} params
 * @param {string} params.qid
 * @param {typeof fetch} [params.fetchFn=fetch]
 * @param {string} [params.endpoint=DEFAULT_ENDPOINT]
 * @param {string} [params.userAgent=USER_AGENT]
 * @returns {Promise<ReturnType<typeof parseWikidataResponse> | null>}
 */
export async function fetchWikidataAttributes({
  qid,
  fetchFn = fetch,
  endpoint = DEFAULT_ENDPOINT,
  userAgent = USER_AGENT,
}) {
  let query;
  try {
    query = buildWikidataSparqlQuery(qid);
  } catch (_err) {
    return null;
  }

  const body = `query=${encodeURIComponent(query)}`;
  const init = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/sparql-results+json',
      'User-Agent': userAgent,
    },
    body,
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await fetchFn(endpoint, init);
    } catch (_err) {
      // network error はリトライ対象
      if (attempt === 0) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return null;
    }
    if (res.ok) {
      try {
        const json = await res.json();
        return parseWikidataResponse(json);
      } catch (_err) {
        return null;
      }
    }
    if (res.status >= 500 && res.status < 600 && attempt === 0) {
      await sleep(RETRY_DELAY_MS);
      continue;
    }
    return null; // 4xx 即 null、5xx リトライ後も失敗
  }
  return null;
}

/**
 * Workers Cache API を介して Wikidata 属性を取得する。
 *
 * - Cache hit: そのまま返す
 * - Cache miss → fetch 成功: Cache put（30 日 TTL）してから返す
 * - Cache miss → fetch null: Cache に入れない（汚染防止）、null を返す
 *
 * @param {object} params
 * @param {string} params.qid
 * @param {typeof fetch} [params.fetchFn=fetch]
 * @param {Cache} [params.cacheStore] - 既定は caches.default
 * @param {string} [params.endpoint=DEFAULT_ENDPOINT]
 * @param {string} [params.userAgent=USER_AGENT]
 * @returns {Promise<ReturnType<typeof parseWikidataResponse> | null>}
 */
export async function getCachedWikidataAttributes({
  qid,
  fetchFn = fetch,
  cacheStore,
  endpoint = DEFAULT_ENDPOINT,
  userAgent = USER_AGENT,
}) {
  const cache = cacheStore ?? (typeof caches !== 'undefined' ? caches.default : null);
  if (typeof qid !== 'string' || !QID_RE.test(qid)) return null;

  const cacheKey = buildWikidataCacheKey(qid);

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      try {
        return await hit.json();
      } catch (_err) {
        // 壊れたキャッシュは無視して再取得
      }
    }
  }

  const attrs = await fetchWikidataAttributes({ qid, fetchFn, endpoint, userAgent });
  if (attrs === null) return null;

  if (cache) {
    const cached = new Response(JSON.stringify(attrs), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    try {
      await cache.put(cacheKey, cached);
    } catch (_err) {
      // Cache put 失敗は呼出側に影響させない
    }
  }
  return attrs;
}
