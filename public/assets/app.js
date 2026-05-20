/**
 * trip-road メインオーケストレータ。
 * DOMContentLoaded で初期化、状態遷移を管理。
 */

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
  getTelemetryCount,
  getTelemetryBatch,
  clearTelemetryBatch,
  getHillshadeEnabled,
  setHillshadeEnabled as persistHillshade,
} from './storage.js';
import { fetchDescription, sendTelemetryBatch } from './api.js';
import { identifyMunicipality, prefetchNeighbors } from './muni.js';
import { initMap, updateCurrentLocation, addTrackPoint, setTrack, setHillshadeEnabled as applyHillshadeLayer } from './map.js';
import { startWatching } from './geo.js';
import { fetchElevation, createElevationUpdater } from './elevation.js';
import { generateTraceId, buildTelemetryEntry, shouldSample } from './telemetry.js';
import { shouldEnterSwitchFlow } from './switch_flow.js';
import {
  showPasswordScreen, showMainScreen,
  showPasswordError, clearPasswordError,
  setMuniName, setMuniRomaji, setSpeed, setElevation, setVisitedCount,
  setHillshadeToggleState,
  setDescription, setDescriptionLoading, setDescriptionLoadingPhase, setDescriptionFailed,
  setDescriptionNoWikipedia, clearDescription,
  setGpsActive, setPermissionDenied,
  setDebugInfo,
} from './ui.js';

let currentMuniCd = null;
let isFirstFix = true;
let elevationUpdater = null;

// Plan E (6.5b): デバッグオーバーレイの状態管理
// currentJudgeData は最後に表示した解説の判定情報を保持し、
// ⚙️ トグル時に即時表示更新できるようにする。
const DEBUG_LS_KEY = 'tripRoad.debug';
const isDebugOn = () => {
  try { return localStorage.getItem(DEBUG_LS_KEY) === '1'; } catch (_) { return false; }
};
const setDebugOn = (on) => {
  try { localStorage.setItem(DEBUG_LS_KEY, on ? '1' : '0'); } catch (_) {}
};
let currentJudgeData = null;

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

  // 既存の現在地情報を表示（キャッシュ済要約があれば）
  if (currentMuniCd && state.visited[currentMuniCd]) {
    const v = state.visited[currentMuniCd];
    setMuniName(v.name);
    const cached = getCachedDescription(currentMuniCd);
    if (cached) {
      setDescription(cached);
      currentJudgeData = { cached: true };
      setDebugInfo(currentJudgeData, isDebugOn());
    }
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

  // Plan E (6.5b): デバッグオーバーレイ表示トグル（フッター ⚙️ アイコン）
  const debugBtn = document.getElementById('debug-toggle');
  if (debugBtn) {
    if (isDebugOn()) debugBtn.classList.add('debug-on');
    debugBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const next = !isDebugOn();
      setDebugOn(next);
      debugBtn.classList.toggle('debug-on', next);
      // 表示も即時更新（現在の judgeData を使う）
      setDebugInfo(currentJudgeData, next);
    });
  }

  // 陰影起伏図トグル（⛰️ ボタン）。永続化値を反映し、クリックで ON/OFF。
  const hillshadeBtn = document.getElementById('hillshade-toggle');
  if (hillshadeBtn) {
    const initial = getHillshadeEnabled();
    applyHillshadeLayer(initial);
    setHillshadeToggleState(initial);
    hillshadeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const next = !getHillshadeEnabled();
      persistHillshade(next);
      applyHillshadeLayer(next);
      setHillshadeToggleState(next);
    });
  }

  // 標高更新（Issue #46）。GPS coords.altitude が取れればそれを使い、
  // 取れなければ国土地理院 標高APIに 5s/100m debounce でフォールバック。
  elevationUpdater = createElevationUpdater(
    (lat, lon) => fetchElevation(lat, lon),
    (m) => setElevation(m),
  );

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
async function handlePosition({ lat, lon, speed, altitude }, password) {
  setGpsActive(true);

  // 速度表示
  setSpeed(speed !== null && speed >= 0 ? Math.round(speed * 3.6) : null);

  // 標高更新（Issue #46）
  if (elevationUpdater) elevationUpdater(lat, lon, altitude);

  // 地図更新 + 軌跡追加
  // F-4: wasFirstFix を保存してから isFirstFix を倒す。
  // 初回 fix のときは「前回と同じ市町村」でも下の切替フローに入って
  // キャッシュ確認 → 無ければ API、という流れにしないと、
  // 自宅（前回と同じ市町村）で起動したときに解説が出ない。
  const wasFirstFix = isFirstFix;
  updateCurrentLocation(lat, lon, isFirstFix);
  isFirstFix = false;
  addTrackPoint(lat, lon);
  appendTrack(lat, lon);

  // 市町村判定
  const muni = await identifyMunicipality(lat, lon, currentMuniCd);
  if (!muni) return;

  if (shouldEnterSwitchFlow(muni.code, currentMuniCd, wasFirstFix)) {
    // 切替
    currentMuniCd = muni.code;
    markVisited(muni.code, muni.name, muni.prefecture);
    setVisitedCount(getVisitedCount());
    setMuniName(muni.name);
    setMuniRomaji(romajiOf(muni));

    // プリフェッチ
    prefetchNeighbors(muni.code);

    // Plan I: キャッシュは市町村コード単一キー
    const cached = getCachedDescription(muni.code);

    // 直前 entry の離脱情報を確定（市町村が切り替わるタイミング）
    finalizeCurrentTelemetry();

    // 新しい trace_id を発行（サンプリング判定）
    const sampled = shouldSample(TELEMETRY_SAMPLE_RATE);
    currentTraceId = sampled ? generateTraceId() : null;
    currentDisplayStartMs = null;

    tryFlushTelemetry(password);

    if (cached) {
      setDescription(cached);
      currentJudgeData = { cached: true };
      setDebugInfo(currentJudgeData, isDebugOn());
      if (currentTraceId) {
        appendTelemetry(buildTelemetryEntry({
          trace_id: currentTraceId,
          muni_code: muni.code,
          description: cached,
          ts_generated: Date.now(),
        }));
        currentDisplayStartMs = Date.now();
        updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
      }
    } else {
      setDescriptionLoading();
      const result = await fetchDescription(
        password,
        {
          prefecture: muni.prefecture,
          municipality: muni.name,
        },
        {
          onPhaseChange: (phase) => setDescriptionLoadingPhase(phase),
        },
      );
      if (result.ok) {
        // Plan I: Wikipedia 抜粋なし → 「記事なし」を表示、キャッシュには書かない
        if (result.no_wikipedia) {
          setDescriptionNoWikipedia();
          currentJudgeData = { no_wikipedia: true };
          setDebugInfo(currentJudgeData, isDebugOn());
          if (currentTraceId) {
            appendTelemetry(buildTelemetryEntry({
              trace_id: currentTraceId,
              muni_code: muni.code,
              description: '',
              ts_generated: Date.now(),
              no_wikipedia: true,
              wikipedia_extract_length: 0,
              generator_model: result.generator_model,
              judge_model: result.judge_model,
            }));
            currentDisplayStartMs = Date.now();
            updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
          }
        } else {
          // Plan I: judge_passed===true のときだけキャッシュに書く
          if (result.judge_passed === true) {
            setCachedDescription(muni.code, result.description);
          }
          if (result.regenerated === true) {
            setDescriptionLoadingPhase('regenerating');
            await new Promise((r) => setTimeout(r, 300));
          }
          setDescription(result.description);
          currentJudgeData = {
            judge_passed: result.judge_passed,
            faithfulness_score: result.faithfulness_score,
            out_of_kb_terms: result.out_of_kb_terms,
            regenerated: result.regenerated,
            fallback_to_extract: result.fallback_to_extract,
            judge_error: result.judge_error,
          };
          setDebugInfo(currentJudgeData, isDebugOn());
          if (currentTraceId) {
            appendTelemetry(buildTelemetryEntry({
              trace_id: currentTraceId,
              muni_code: muni.code,
              description: result.description,
              ts_generated: Date.now(),
              faithfulness_score: result.faithfulness_score,
              out_of_kb_terms: result.out_of_kb_terms,
              judge_passed: result.judge_passed,
              regenerated: result.regenerated,
              fallback_to_extract: result.fallback_to_extract,
              wikipedia_extract_length: result.wikipedia_extract_length,
              judge_error: result.judge_error,
              generator_model: result.generator_model,
              judge_model: result.judge_model,
            }));
            currentDisplayStartMs = Date.now();
            updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
          }
        }
      } else if (result.status === 401) {
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
