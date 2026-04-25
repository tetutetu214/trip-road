/**
 * trip-road の localStorage スキーマを抽象化するラッパー。
 *
 * キー "trip-road-state" に単一 JSON オブジェクトを保存する形式:
 *   {
 *     password: string | null,
 *     visited: { [code]: { name, prefecture, firstVisit, descriptions: {spring, summer, autumn, winter} } },
 *     track: [{ lat, lon, ts }],
 *     currentMuniCd: string | null
 *   }
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
      descriptions: { spring: null, summer: null, autumn: null, winter: null },
    };
  }
  state.currentMuniCd = code;
  saveState(state);
}
export function getVisitedCount() {
  return Object.keys(loadState().visited).length;
}

// === Description cache ===
export function getCachedDescription(code, season) {
  const v = loadState().visited[code];
  if (!v) return null;
  return v.descriptions?.[season] ?? null;
}
export function setCachedDescription(code, season, text) {
  const state = loadState();
  if (!state.visited[code]) return; // markVisited が先行する前提
  state.visited[code].descriptions ??= {};
  state.visited[code].descriptions[season] = text;
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

export function exportTelemetryAsJson() {
  const t = loadState().telemetry ?? [];
  return JSON.stringify(t, null, 2);
}
