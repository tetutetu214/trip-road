/**
 * 市町村コード → Wikidata QID マッピング表のローダ（Issue #38 / Plan G-4）
 *
 * `public/wikidata_qid.json`（事前バッチで生成、Cloudflare Pages 配信、約 300 KB、
 * 1905 エントリ）を Worker から fetch して引けるようにする薄いラッパー。
 *
 * 設計判断:
 *   - **ビルド時バンドルしない**: 292 KB を Worker bundle に含めると bundle size 制限
 *     （gzip 後 1 MB）を圧迫し、JSON 更新時に Worker 再デプロイが必要になり運用が硬くなる
 *   - **Workers Cache API + in-memory cache 二段**: Cache API で 30 日 TTL、さらに
 *     Module-level の in-memory 参照に乗せて同じ isolate なら再 fetch しない
 *   - **未解決キーは null 返し**: QID なしと QID null の二重表現を避ける
 *
 * 公開関数:
 *   - DEFAULT_QID_MAP_URL / USER_AGENT / CACHE_TTL_SECONDS (定数)
 *   - buildQidMapCacheKey (純粋関数)
 *   - lookupQid (純粋関数)
 *   - fetchQidMap (副作用)
 *   - getCachedQidMap (副作用)
 */

// ---- 定数 ----

// Cloudflare Pages 配信オリジン。CLAUDE.md の本番ドメインと整合。
export const DEFAULT_QID_MAP_URL = 'https://trip-road.tetutetu214.com/wikidata_qid.json';

export const USER_AGENT =
  'trip-road-worker/0.1 (https://github.com/tetutetu214/trip-road; lemoned.i.scream.art.of.noise@gmail.com)';

export const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Module-level の in-memory cache 参照。
 * オブジェクトとして export することで、テスト側で `{ value: null }` を初期化して
 * 渡せるようにする（参照型でないと再代入が観測できないため）。
 */
export const MODULE_REF = { value: null };

// ---- 純粋関数 ----

/**
 * Workers Cache API のキー（ダミー Request）。
 * 個別市町村単位ではなく全体 JSON を 1 つの Response として保存するため、固定 URL。
 *
 * @returns {Request}
 */
export function buildQidMapCacheKey() {
  return new Request('https://wikidata-qid-cache.internal/v1/all');
}

/**
 * QID マップから 5 桁市町村コードでルックアップ。
 *
 * @param {object | null} qidMap - getCachedQidMap の戻り値
 * @param {string} muniCode - 5 桁の文字列
 * @returns {{ qid: string, label_ja: string, lat: number | null, lon: number | null, wikipedia_ja: string | null } | null}
 */
export function lookupQid(qidMap, muniCode) {
  if (!qidMap || typeof qidMap !== 'object') return null;
  if (typeof muniCode !== 'string') return null;
  const entry = qidMap[muniCode];
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.qid !== 'string' || entry.qid.length === 0) return null;
  return entry;
}

// ---- 副作用ありの関数 ----

/**
 * `public/wikidata_qid.json` を fetch して JSON を返す。
 *
 * - User-Agent ヘッダ必須
 * - 4xx/5xx は throw（呼出側で吸収）
 * - JSON パース失敗も throw
 *
 * @param {object} params
 * @param {string} [params.url=DEFAULT_QID_MAP_URL]
 * @param {typeof fetch} [params.fetchFn=fetch]
 * @param {string} [params.userAgent=USER_AGENT]
 * @returns {Promise<object>}
 */
export async function fetchQidMap({
  url = DEFAULT_QID_MAP_URL,
  fetchFn = fetch,
  userAgent = USER_AGENT,
}) {
  const res = await fetchFn(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'application/json',
    },
  });
  if (!res.ok) {
    throw new Error(`fetchQidMap: HTTP ${res.status}`);
  }
  return await res.json();
}

/**
 * QID マップを取得する。in-memory → Cache API → fetch の三段。
 *
 * - in-memory にあれば即返す（同じ isolate での再リクエストはゼロレイテンシ）
 * - Cache hit → in-memory に転記して返す
 * - Cache miss → fetch → Cache に put → in-memory に転記して返す
 *
 * 失敗時は throw せず null を返し、呼出側で「Wikidata 統合スキップ」と扱える。
 *
 * @param {object} params
 * @param {string} [params.url=DEFAULT_QID_MAP_URL]
 * @param {typeof fetch} [params.fetchFn=fetch]
 * @param {Cache} [params.cacheStore]
 * @param {{value: object | null}} [params.inMemoryRef=MODULE_REF] - テストで差し替え可
 * @param {string} [params.userAgent=USER_AGENT]
 * @returns {Promise<object | null>}
 */
export async function getCachedQidMap({
  url = DEFAULT_QID_MAP_URL,
  fetchFn = fetch,
  cacheStore,
  inMemoryRef = MODULE_REF,
  userAgent = USER_AGENT,
} = {}) {
  if (inMemoryRef.value) return inMemoryRef.value;

  const cache = cacheStore ?? (typeof caches !== 'undefined' ? caches.default : null);
  const cacheKey = buildQidMapCacheKey();

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      try {
        const data = await hit.json();
        inMemoryRef.value = data;
        return data;
      } catch (_err) {
        // 壊れたキャッシュは無視して再取得
      }
    }
  }

  let data;
  try {
    data = await fetchQidMap({ url, fetchFn, userAgent });
  } catch (_err) {
    return null;
  }

  if (cache) {
    const cached = new Response(JSON.stringify(data), {
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
  inMemoryRef.value = data;
  return data;
}
