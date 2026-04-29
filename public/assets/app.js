/**
 * trip-road メインオーケストレータ。
 * DOMContentLoaded で初期化、状態遷移を管理。
 */

import { getSolarTerm } from './season.js';
import {
  loadState,
  savePassword,
  getPassword,
  clearPassword,
  markVisited,
  getCachedDescription,
  setCachedDescription,
  appendTrack,
  getVisitedCount,
  appendTelemetry,
  updateTelemetry,
  exportTelemetryAsJson,
  getTelemetryCount,
  getTelemetryBatch,
  clearTelemetryBatch,
} from './storage.js';
import { fetchDescription, sendTelemetryBatch } from './api.js';
import { identifyMunicipality, prefetchNeighbors } from './muni.js';
import { initMap, updateCurrentLocation, addTrackPoint, setTrack } from './map.js';
import { startWatching } from './geo.js';
import { generateTraceId, buildTelemetryEntry, shouldSample } from './telemetry.js';
import {
  showPasswordScreen, showMainScreen,
  showPasswordError, clearPasswordError,
  setMuniName, setMuniRomaji, setSpeed, setVisitedCount,
  setDescription, setDescriptionLoading, setDescriptionFailed, clearDescription,
  setGpsActive, setPermissionDenied,
  downloadJson,
} from './ui.js';

let currentMuniCd = null;
let isFirstFix = true;

// === テレメトリ状態 ===
// Plan D Stage 1: 表示中 entry の trace_id と表示開始 ms を保持し、
// 切替/離脱時に dwell_ms を確定する。
const TELEMETRY_SAMPLE_RATE = 1.0;  // 初期 100%、運用で 0.1〜0.2 に下げる
let currentTraceId = null;
let currentDisplayStartMs = null;

// === テレメトリ自動 flush 設定 ===
// 市町村切替のたびに、確定した直前 entry を即 S3 へ送信する。
// localStorage は「送信失敗時の再送のために残す保険」として機能する。
// 60 秒タイマーは未送信が残っている場合のリトライ。
const TELEMETRY_FLUSH_THRESHOLD = 1;         // 1 件でも溜まれば送る（リアルタイム送信）
const TELEMETRY_FLUSH_INTERVAL_MS = 60000;   // リトライ間隔: 60 秒
const TELEMETRY_FLUSH_BATCH_MAX = 50;        // 1 回の送信で扱う最大件数
let isFlushing = false;                       // 多重送信防止のロック

// === 初期化 ===
window.addEventListener('DOMContentLoaded', () => {
  const state = loadState();
  currentMuniCd = state.currentMuniCd;

  if (state.password) {
    enterMainApp(state.password);
  } else {
    setupPasswordScreen();
  }
});

// === パスワード入力フロー ===
function setupPasswordScreen() {
  showPasswordScreen();
  const input = document.getElementById('password-input');
  const submit = document.getElementById('password-submit');

  input.addEventListener('input', () => {
    submit.disabled = input.value.trim().length === 0;
    clearPasswordError();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !submit.disabled) submit.click();
  });
  submit.addEventListener('click', () => {
    const pw = input.value.trim();
    savePassword(pw);
    enterMainApp(pw);
  });
}

// === メイン画面初期化 ===
async function enterMainApp(password) {
  showMainScreen();
  initMap('map');
  setVisitedCount(getVisitedCount());

  // 既存軌跡を復元
  const state = loadState();
  if (state.track.length > 0) setTrack(state.track);

  // 既存の現在地情報を表示（キャッシュ済解説があれば）
  if (currentMuniCd && state.visited[currentMuniCd]) {
    const v = state.visited[currentMuniCd];
    setMuniName(v.name);
    const cached = getCachedDescription(currentMuniCd, getSolarTerm());
    if (cached) setDescription(cached);
  }

  // GPS 監視開始
  startWatching(
    (pos) => handlePosition(pos, password),
    (err) => handleGpsError(err),
  );

  // 画面離脱時（タブ閉じ・最小化）に dwell_ms を確定
  window.addEventListener('beforeunload', finalizeCurrentTelemetry);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) finalizeCurrentTelemetry();
  });

  // テレメトリ手動エクスポート（フッター 📤 アイコン）
  const exportLink = document.getElementById('export-link');
  if (exportLink) {
    exportLink.addEventListener('click', (e) => {
      e.preventDefault();
      finalizeCurrentTelemetry();  // 表示中 entry も含めて確定してから書出
      const count = getTelemetryCount();
      if (count === 0) {
        alert('テレメトリはまだ蓄積されていません');
        return;
      }
      const json = exportTelemetryAsJson();
      const filename = `trip-road-telemetry-${new Date().toISOString().slice(0, 10)}.json`;
      downloadJson(filename, json);
    });
  }

  // テレメトリ自動 flush: 閾値超えていれば 60 秒ごとに Workers 経由で S3 へ送信
  setInterval(() => {
    if (getTelemetryCount() >= TELEMETRY_FLUSH_THRESHOLD) {
      tryFlushTelemetry(password);
    }
  }, TELEMETRY_FLUSH_INTERVAL_MS);
}

// === テレメトリ自動 flush 本体 ===
// 多重起動防止 + 表示中 entry は flush 対象から外す（dwell_ms が未確定のため）。
async function tryFlushTelemetry(password) {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const batch = getTelemetryBatch(TELEMETRY_FLUSH_BATCH_MAX)
      .filter(e => e.trace_id !== currentTraceId);
    if (batch.length === 0) return;
    const traceIds = batch.map(e => e.trace_id);
    const result = await sendTelemetryBatch(password, batch);
    if (result.ok) {
      clearTelemetryBatch(traceIds);
      console.log(`[telemetry] flushed ${batch.length} entries → ${result.key}`);
    } else {
      console.warn(`[telemetry] flush failed (${result.status}): ${result.error}`);
    }
  } finally {
    isFlushing = false;
  }
}

// === GPS 位置更新時の処理 ===
async function handlePosition({ lat, lon, speed }, password) {
  setGpsActive(true);

  // 速度表示
  setSpeed(speed !== null && speed >= 0 ? Math.round(speed * 3.6) : null);

  // 地図更新 + 軌跡追加
  updateCurrentLocation(lat, lon, isFirstFix);
  isFirstFix = false;
  addTrackPoint(lat, lon);
  appendTrack(lat, lon);

  // 市町村判定
  const muni = await identifyMunicipality(lat, lon, currentMuniCd);
  if (!muni) return;

  if (muni.code !== currentMuniCd) {
    // 切替
    currentMuniCd = muni.code;
    markVisited(muni.code, muni.name, muni.prefecture);
    setVisitedCount(getVisitedCount());
    setMuniName(muni.name);
    setMuniRomaji(romajiOf(muni));

    // プリフェッチ
    prefetchNeighbors(muni.code);

    // LLM 呼出 or キャッシュ
    const solarTerm = getSolarTerm();
    const cached = getCachedDescription(muni.code, solarTerm);

    // 直前 entry の離脱情報を確定（市町村が切り替わるタイミング）
    finalizeCurrentTelemetry();

    // 新しい trace_id を発行（サンプリング判定）
    const sampled = shouldSample(TELEMETRY_SAMPLE_RATE);
    currentTraceId = sampled ? generateTraceId() : null;
    currentDisplayStartMs = null;

    // 確定した直前 entry を即 S3 へ送信（currentTraceId は新しい id なので、
    // フィルタで現在表示中のものは送られず、確定済みの entry だけが対象になる）
    tryFlushTelemetry(password);

    if (cached) {
      setDescription(cached);
      // キャッシュヒットも記録（読まれた事実は同じ）
      if (currentTraceId) {
        appendTelemetry(buildTelemetryEntry({
          trace_id: currentTraceId,
          muni_code: muni.code,
          solar_term: solarTerm,
          description: cached,
          ts_generated: Date.now(),
        }));
        currentDisplayStartMs = Date.now();
        updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
      }
    } else {
      setDescriptionLoading();
      const result = await fetchDescription(password, {
        prefecture: muni.prefecture,
        municipality: muni.name,
        solar_term: solarTerm,
      });
      if (result.ok) {
        setCachedDescription(muni.code, solarTerm, result.description);
        setDescription(result.description);
        // 新規生成を記録
        if (currentTraceId) {
          appendTelemetry(buildTelemetryEntry({
            trace_id: currentTraceId,
            muni_code: muni.code,
            solar_term: solarTerm,
            description: result.description,
            ts_generated: Date.now(),
          }));
          currentDisplayStartMs = Date.now();
          updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
        }
      } else if (result.status === 401) {
        // パスワード誤り
        clearPassword();
        clearDescription();
        setupPasswordScreen();
        showPasswordError('パスワードが違います');
      } else {
        setDescriptionFailed();
      }
    }
  }
}

// === テレメトリ: 表示中 entry の dwell_ms を確定 ===
// 市町村切替・画面離脱・タブ非表示で呼ばれる。trace_id が生きてる時のみ更新。
function finalizeCurrentTelemetry() {
  if (currentTraceId && currentDisplayStartMs) {
    const ts_left = Date.now();
    updateTelemetry(currentTraceId, {
      ts_left,
      dwell_ms: ts_left - currentDisplayStartMs,
    });
  }
}

// === GPS エラー処理 ===
function handleGpsError(err) {
  if (err.code === 1) {
    setPermissionDenied();
    setGpsActive(false);
  }
  // code 2/3 は次の成功を待つ（何もしない）
}

// === 英字ローマ字（簡易版、ヘボン式でなく固有名詞はそのまま） ===
function romajiOf(muni) {
  // PoC: 都道府県 + 市町村のアルファベット入力がない場合は空文字
  // Phase 2 以降で辞書 or 外部ライブラリ検討
  return '';
}
