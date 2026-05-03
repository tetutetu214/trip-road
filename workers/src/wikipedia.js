/**
 * Wikipedia API helper（Plan E / Phase 6.1）
 *
 * 用途: Judge 軸 1（事実正確性）の根拠資料を Wikipedia から取得する。
 * 仕様詳細は docs/spec.md 10.2 章を参照。
 *
 * 公開する純粋関数（テスト容易）と、副作用ありの統合関数を両方エクスポートする。
 */

// ---- 定数 ----

export const WIKIPEDIA_API_BASE = 'https://ja.wikipedia.org/w/api.php';

// Wikipedia の Etiquette（https://meta.wikimedia.org/wiki/User-Agent_policy）に従い識別可能な User-Agent を送る
export const USER_AGENT =
  'trip-road/1.0 (https://github.com/tetutetu214/trip-road; tetutetu214@github)';

// 抜粋を切り詰める閾値。Sonnet judge のコンテキスト節約用
export const MAX_EXTRACT_LENGTH = 1500;

// Workers Cache の TTL（30日）
export const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

// 1 タイトルあたりの試行上限（attempt=0 / attempt=1 の 2 回）
const MAX_TITLE_ATTEMPTS = 2;

// ---- 純粋関数 ----

/**
 * Wikipedia API URL を組み立てる。
 *
 * @param {string} title - 記事タイトル（日本語可、URL エンコード前）
 * @returns {string}
 */
export function buildWikipediaUrl(title) {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts',
    exintro: 'true',
    explaintext: 'true',
    redirects: 'true',
    titles: title,
    format: 'json',
    formatversion: '2',
  });
  return `${WIKIPEDIA_API_BASE}?${params.toString()}`;
}

/**
 * Wikipedia API レスポンス JSON から extract 文字列を取り出す。
 * 取れなければ null。
 *
 * @param {object} json
 * @returns {string|null}
 */
export function parseWikipediaExtract(json) {
  if (!json || typeof json !== 'object') return null;
  const pages = json?.query?.pages;
  if (!Array.isArray(pages) || pages.length === 0) return null;
  const page = pages[0];
  if (page?.missing) return null;
  const extract = page?.extract;
  if (typeof extract !== 'string' || extract.length === 0) return null;
  // 曖昧さ回避ページ（例: 「緑区」だけで検索した場合の「緑区（みどりく）」）は
  // 句点を含まないことがほとんど。事実情報がないので null に倒し、上位で fallback させる。
  if (!extract.includes('。')) return null;
  return extract;
}

/**
 * extract を Sonnet judge に渡す前の前処理。
 * - 参考文献記号 [1] [12] [123] を除去
 * - 1500 字を超える場合は切り詰めて末尾に … を付与
 * - null/undefined/空文字は空文字に正規化
 *
 * @param {string|null|undefined} text
 * @param {number} [maxLen=MAX_EXTRACT_LENGTH]
 * @returns {string}
 */
export function cleanExtract(text, maxLen = MAX_EXTRACT_LENGTH) {
  if (text == null || text === '') return '';
  // 半角・全角どちらの数字括弧も対象にする（Wikipedia 出力は半角）
  const stripped = text.replace(/\[\d+\]/g, '');
  if (stripped.length <= maxLen) return stripped;
  return stripped.slice(0, maxLen) + '…';
}

/**
 * Wikipedia 検索タイトルを段階的に決定する。
 *
 * - attempt=0: municipality をそのまま使う（redirects=true で大半は解決）
 * - attempt=1: "{municipality} ({prefecture})" 形式で曖昧さ回避
 * - attempt>=2: null（打ち切り）
 *
 * @param {string} municipality
 * @param {string} prefecture
 * @param {number} attempt
 * @returns {string|null}
 */
export function resolveWikipediaTitle(municipality, prefecture, attempt) {
  if (attempt === 0) return municipality;
  if (attempt === 1) return `${municipality} (${prefecture})`;
  return null;
}

/**
 * Workers Cache API のキー（ダミー Request）。
 *
 * Cache API はオリジンサーバとは独立した内部ストアとして使う想定。
 * `https://wikipedia-cache.internal/<muni_code>` という外部到達不能な URL を
 * キーにすることで、本物のリクエストとは衝突しない。
 *
 * @param {string} muniCode
 * @returns {Request}
 */
export function buildCacheKey(muniCode) {
  return new Request(`https://wikipedia-cache.internal/${muniCode}`);
}

// ---- 副作用ありの統合関数 ----

/**
 * Wikipedia API を叩いて extract を取る。失敗時は次の attempt にフォールバック。
 *
 * @param {object} params
 * @param {string} params.municipality
 * @param {string} params.prefecture
 * @param {typeof fetch} [params.fetchFn=fetch] - テスト用に差し替え可能
 * @returns {Promise<string|null>} cleanExtract 適用済の文字列、最終的に取れなければ null
 */
export async function fetchWikipediaExtract({ municipality, prefecture, fetchFn = fetch }) {
  for (let attempt = 0; attempt < MAX_TITLE_ATTEMPTS; attempt++) {
    const title = resolveWikipediaTitle(municipality, prefecture, attempt);
    if (title === null) break;
    const url = buildWikipediaUrl(title);
    let json;
    try {
      const res = await fetchFn(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'application/json',
        },
      });
      if (!res.ok) continue;
      json = await res.json();
    } catch (_err) {
      continue;
    }
    const extract = parseWikipediaExtract(json);
    if (extract !== null) {
      return cleanExtract(extract);
    }
  }
  return null;
}

/**
 * Workers Cache API を介して Wikipedia extract を取得する。
 * Cache ヒットなら fetch せず返す。ミスなら fetch → put → 返す。
 * fetch 結果が null の場合はキャッシュ汚染を避けるため put しない。
 *
 * @param {object} params
 * @param {string} params.muniCode
 * @param {string} params.municipality
 * @param {string} params.prefecture
 * @param {typeof fetch} [params.fetchFn=fetch]
 * @param {Cache} [params.cacheStore] - 既定は caches.default（Workers ランタイム）
 * @returns {Promise<string|null>}
 */
export async function getCachedWikipediaExtract({
  muniCode,
  municipality,
  prefecture,
  fetchFn = fetch,
  cacheStore,
}) {
  const cache = cacheStore ?? (typeof caches !== 'undefined' ? caches.default : null);
  const cacheKey = buildCacheKey(muniCode);

  if (cache) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      return await hit.text();
    }
  }

  const extract = await fetchWikipediaExtract({ municipality, prefecture, fetchFn });
  if (extract === null) return null;

  if (cache) {
    const cachedResponse = new Response(extract, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
      },
    });
    // put は失敗しても致命的ではないので await はしつつ例外は握る
    try {
      await cache.put(cacheKey, cachedResponse);
    } catch (_err) {
      // ignore
    }
  }

  return extract;
}
