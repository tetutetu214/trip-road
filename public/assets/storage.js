/**
 * trip-road の localStorage スキーマを抽象化するラッパー。
 *
 * キー "trip-road-state" に単一 JSON オブジェクトを保存する形式:
 *   {
 *     password: string | null,
 *     visited: { [code]: { name, prefecture, firstVisit, description: string } },
 *     track: [{ lat, lon, ts }],
 *     currentMuniCd: string | null
 *   }
 *
 * Plan I（2026-05-11）で description は市町村ごとに 1 つの要約に簡素化。
 * 旧バージョンの descriptions（節気別マップ）は読み出されず自然消滅する。
 */

const STORAGE_KEY = 'trip-road-state';

function emptyState() {
  return { password: null, visited: {}, track: [], currentMuniCd: null };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return { ...emptyState(), ...parsed };
  } catch (e) {
    return emptyState();
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// === Password ===
export function savePassword(password) {
  const state = loadState();
  state.password = password;
  saveState(state);
}
export function getPassword() {
  return loadState().password;
}
export function clearPassword() {
  const state = loadState();
  state.password = null;
  saveState(state);
}

// === Visited ===
export function markVisited(code, name, prefecture) {
  const state = loadState();
  if (!state.visited[code]) {
    state.visited[code] = {
      name,
      prefecture,
      firstVisit: new Date().toISOString(),
      description: null,
      // Phase 13: 踏破履歴 DynamoDB 同期用フィールド（後から enrichVisitedWithCodes で埋まる）
      prefectureCode: null,
      regionCode: null,
      synced: false,
    };
  }
  state.currentMuniCd = code;
  saveState(state);
}
export function getVisitedCount() {
  return Object.keys(loadState().visited).length;
}

/**
 * 既存の visited に prefectureCode / regionCode を埋める（既に値があれば触らない）。
 * conquest_meta.json から取得した {muni_code: {prefecture_code, region_code}} で更新する。
 *
 * @param {Record<string, {prefecture_code: string, region_code: string}>} meta
 * @returns {number} 埋めたエントリ数
 */
export function enrichVisitedWithCodes(meta) {
  const state = loadState();
  let updated = 0;
  for (const [code, v] of Object.entries(state.visited)) {
    const m = meta[code];
    if (!m) continue;
    let changed = false;
    if (!v.prefectureCode) {
      v.prefectureCode = m.prefecture_code;
      changed = true;
    }
    if (!v.regionCode) {
      v.regionCode = m.region_code;
      changed = true;
    }
    if (changed) updated++;
  }
  if (updated > 0) saveState(state);
  return updated;
}

/**
 * 前日以前（ローカル暦日）の synced=false な visited エントリを返す。
 * DynamoDB へ flush するための候補。
 *
 * @param {number} nowMs - 「現在」のタイムスタンプ
 * @returns {Array<{muni_code, name, prefecture, firstVisit, prefectureCode, regionCode}>}
 */
export function getUnsyncedVisitedBefore(nowMs) {
  const state = loadState();
  const result = [];
  const now = new Date(nowMs);
  for (const [code, v] of Object.entries(state.visited)) {
    if (v.synced === true) continue;
    if (!v.prefectureCode || !v.regionCode) continue;
    const ts = Date.parse(v.firstVisit);
    if (Number.isNaN(ts)) continue;
    const visitDay = new Date(ts);
    // 同じ暦日なら除外（今日の分は未確定として保留）
    const sameDay =
      visitDay.getFullYear() === now.getFullYear() &&
      visitDay.getMonth() === now.getMonth() &&
      visitDay.getDate() === now.getDate();
    if (sameDay) continue;
    result.push({
      muni_code: code,
      name: v.name,
      prefecture: v.prefecture,
      firstVisit: v.firstVisit,
      prefectureCode: v.prefectureCode,
      regionCode: v.regionCode,
    });
  }
  return result;
}

/**
 * 指定 muni_code 群に synced=true をセット。
 * @param {string[]} muniCodes
 */
export function markVisitedSynced(muniCodes) {
  if (!Array.isArray(muniCodes) || muniCodes.length === 0) return;
  const state = loadState();
  let changed = false;
  for (const code of muniCodes) {
    const v = state.visited[code];
    if (v && v.synced !== true) {
      v.synced = true;
      changed = true;
    }
  }
  if (changed) saveState(state);
}

// === Description cache（Plan I: 市町村ごと単一の要約） ===
// プロンプトや生成仕様を変えたら DESCRIPTION_VERSION を上げる。版数が一致しない
// 古いキャッシュは無効（null 扱い）にして、次の訪問時に新仕様で再生成させる。
// visited レコード自体（名前・初訪問日・軌跡）は消さないので踏破履歴は保持される。
const DESCRIPTION_VERSION = 2;

export function getCachedDescription(code) {
  const v = loadState().visited[code];
  if (!v) return null;
  if (v.descVersion !== DESCRIPTION_VERSION) return null; // 旧版キャッシュは再生成させる
  return v.description ?? null;
}
export function setCachedDescription(code, text) {
  const state = loadState();
  if (!state.visited[code]) return; // markVisited が先行する前提
  state.visited[code].description = text;
  state.visited[code].descVersion = DESCRIPTION_VERSION;
  saveState(state);
}

// === Track ===
export function appendTrack(lat, lon) {
  const state = loadState();
  state.track.push({ lat, lon, ts: Date.now() });
  saveState(state);
}

// === Telemetry ===
// Plan D Stage 1: 暗黙シグナル（dwell_ms 等）を localStorage に蓄積し、
// Stage 2 で Workers /api/telemetry に flush する。
export function appendTelemetry(entry) {
  const state = loadState();
  state.telemetry ??= [];
  state.telemetry.push(entry);
  saveState(state);
}

export function updateTelemetry(traceId, partial) {
  const state = loadState();
  state.telemetry ??= [];
  const idx = state.telemetry.findIndex(e => e.trace_id === traceId);
  if (idx >= 0) {
    state.telemetry[idx] = { ...state.telemetry[idx], ...partial };
    saveState(state);
  }
}

export function getTelemetryBatch(maxN) {
  const t = loadState().telemetry ?? [];
  return t.slice(0, maxN);
}

export function getTelemetryCount() {
  return (loadState().telemetry ?? []).length;
}

export function clearTelemetryBatch(traceIds) {
  const state = loadState();
  state.telemetry ??= [];
  const toRemove = new Set(traceIds);
  state.telemetry = state.telemetry.filter(e => !toRemove.has(e.trace_id));
  saveState(state);
}

// === Hillshade overlay (Issue #46 → #48: OFF/弱/強の3段階) ===
const HILLSHADE_LEVELS = new Set(['off', 'weak', 'strong']);
export function getHillshadeLevel() {
  const v = loadState().hillshadeLevel;
  return HILLSHADE_LEVELS.has(v) ? v : 'off';
}
export function setHillshadeLevel(level) {
  const state = loadState();
  state.hillshadeLevel = HILLSHADE_LEVELS.has(level) ? level : 'off';
  saveState(state);
}

