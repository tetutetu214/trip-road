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
  getHillshadeLevel,
  setHillshadeLevel as persistHillshadeLevel,
  enrichVisitedWithCodes,
  getUnsyncedVisitedBefore,
  markVisitedSynced,
} from './storage.js';
import { fetchDescription, sendTelemetryBatch, postConquests, getMapboxToken } from './api.js';
import { setupHistoryScreen, openHistoryScreen } from './history.js';
import { DATA_BASE_URL } from './config.js';
import { identifyMunicipality, prefetchNeighbors } from './muni.js';
import { initMap, updateCurrentLocation, addTrackPoint, setTrack, clearTrack, setHillshadeLevel as applyHillshadeLayer } from './map.js';
import { filterTodayPoints, isSameLocalDay } from './track_filter.js';
import { startWatching } from './geo.js';
import { fetchElevation, createElevationUpdater } from './elevation.js';
import { generateTraceId, buildTelemetryEntry, shouldSample, planRatingClick } from './telemetry.js';
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
  setRatingState, showRating, hideRating,
} from './ui.js';

let currentMuniCd = null;
let isFirstFix = true;
let elevationUpdater = null;
// 軌跡ポリラインに最後に乗せた点のタイムスタンプ（ms）。
// 起動時の復元と、日跨ぎ時のポリライン自動リセット判定に使う。
let lastTrackTs = null;

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
// Issue #17: 表示中カードの 👍 / 👎 状態（'up' / 'down' / null）。
// 市町村切替で新しい trace_id を発行するたびに null へリセットする。
let currentRating = null;
// Issue #17: 現在表示中の有効な説明文。サンプリングの有無に関わらず保持する。
// 👍 / 👎 がサンプリング外セッションで押されたとき、この muni_code / 本文を使って
// テレメトリエントリを遅延発行し、評価を必ず記録するために使う。null のときは
// 有効な説明文が出ていない（記事なし・生成失敗・切替直後）状態を表す。
let currentDescriptionText = null;

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

  // --- フッターボタン等のイベント配線を Mapbox トークン取得（await）より前に済ませる ---
  // showMainScreen() でフッターボタンは即可視になる。一方 getMapboxToken() は
  // ネットワーク待ちを伴うため、配線を await の後に置くと「ボタンは見えるが
  // リスナ未装着」の数百ms の窓が生じ、その間のタップが無反応になる
  // （Mapbox 移行で顕在化。実機の遅い回線でも同様の UX 不具合）。配線を先に出す。

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

  // 陰影起伏図トグル（⛰️ ボタン）。Issue #48 で off → weak → strong → off の 3 段階循環に。
  // click リスナはここで装着し、地図に依存する初期レイヤ適用は initMap 後に行う。
  const hillshadeBtn = document.getElementById('hillshade-toggle');
  if (hillshadeBtn) {
    const HILLSHADE_CYCLE = ['off', 'weak', 'strong'];
    hillshadeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const cur = getHillshadeLevel();
      const idx = HILLSHADE_CYCLE.indexOf(cur);
      const next = HILLSHADE_CYCLE[(idx + 1) % HILLSHADE_CYCLE.length];
      persistHillshadeLevel(next);
      applyHillshadeLayer(next);
      setHillshadeToggleState(next);
    });
  }

  // Issue #17: 👍 / 👎 明示フィードバックボタン。
  // 表示中カードに user_rating を記録する。サンプリング外でも handleRatingClick が
  // trace を遅延発行して必ず記録する。同じボタン再タップで取り消し（null）。
  const ratingUpBtn = document.getElementById('rating-up');
  const ratingDownBtn = document.getElementById('rating-down');
  if (ratingUpBtn && ratingDownBtn) {
    ratingUpBtn.addEventListener('click', () => handleRatingClick('up'));
    ratingDownBtn.addEventListener('click', () => handleRatingClick('down'));
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

  // 踏破履歴画面（Phase 13）: 🗺️ ボタンで開く
  setupHistoryScreen();
  const historyBtn = document.getElementById('history-open');
  if (historyBtn) {
    historyBtn.addEventListener('click', (e) => {
      e.preventDefault();
      openHistoryScreen();
    });
  }

  // --- ここから地図初期化（ネットワーク待ちを含む） ---
  // Mapbox トークンを Worker から取得してから地図を初期化する。
  // 取得失敗時は地図初期化をスキップし、アプリ全体はクラッシュさせない
  // （現在地チップや土地のたよりなど地図以外の機能は引き続き動く）。
  const tokenResult = await getMapboxToken(password);
  if (tokenResult.ok) {
    initMap('map', tokenResult.token);
  } else {
    console.warn('[app] Mapbox トークン取得に失敗、地図初期化をスキップ', tokenResult);
  }

  // 地図に依存する陰影起伏図の初期レイヤ適用（initMap 後に実施）
  if (hillshadeBtn) {
    const hillshadeInitial = getHillshadeLevel();
    applyHillshadeLayer(hillshadeInitial);
    setHillshadeToggleState(hillshadeInitial);
  }

  setVisitedCount(getVisitedCount());

  // 既存軌跡を復元（今日の ts のものだけ描画。過去日分は localStorage に温存）
  const state = loadState();
  const todayPoints = filterTodayPoints(state.track, Date.now());
  if (todayPoints.length > 0) {
    setTrack(todayPoints);
    lastTrackTs = todayPoints[todayPoints.length - 1].ts;
  }

  // 既存の現在地情報を表示（キャッシュ済要約があれば）
  if (currentMuniCd && state.visited[currentMuniCd]) {
    const v = state.visited[currentMuniCd];
    setMuniName(v.name);
    const cached = getCachedDescription(currentMuniCd);
    if (cached) {
      setDescription(cached);
      currentDescriptionText = cached;
      currentJudgeData = { cached: true };
      setDebugInfo(currentJudgeData, isDebugOn());
      // Issue #17: 起動時のキャッシュ表示でも 👍 / 👎 を出す。
      // この経路は sampling 判定前なので trace は無いが、クリック時に遅延記録される。
      currentRating = null;
      setRatingState(null);
      showRating();
    }
  }

  // GPS 監視開始
  startWatching(
    (pos) => handlePosition(pos, password),
    (err) => handleGpsError(err),
  );

  // バックグラウンドで前日以前の visited を DynamoDB に flush
  tryFlushConquests(password);
}

// === 踏破履歴: 前日以前の未同期 visited を DynamoDB へ flush ===
// Phase 13-4 / spec.md §14.8。失敗は遅延扱い、次回起動でリトライ。
async function tryFlushConquests(password) {
  try {
    // 1. conquest_meta.json を取得して既存 visited に code を埋める
    const metaRes = await fetch(`${DATA_BASE_URL}/conquest_meta.json`);
    if (!metaRes.ok) return;
    const meta = await metaRes.json();
    enrichVisitedWithCodes(meta);

    // 2. 前日以前の未同期エントリを抽出
    const unsynced = getUnsyncedVisitedBefore(Date.now());
    if (unsynced.length === 0) return;

    // 3. 25 件ずつ POST して synced=true マーク
    const CHUNK = 25;
    for (let i = 0; i < unsynced.length; i += CHUNK) {
      const chunk = unsynced.slice(i, i + CHUNK);
      const payload = chunk.map(u => ({
        muni_code: u.muni_code,
        first_visit: u.firstVisit,
        prefecture_code: u.prefectureCode,
        region_code: u.regionCode,
        name: u.name,
        prefecture: u.prefecture,
      }));
      const result = await postConquests(password, payload);
      if (result.ok) {
        markVisitedSynced(chunk.map(u => u.muni_code));
        console.log(`[conquests] flushed ${chunk.length} (written=${result.written}, skipped=${result.skipped})`);
      } else {
        console.warn('[conquests] flush failed', result);
        break;
      }
    }
  } catch (e) {
    console.warn('[conquests] flush error', e);
  }
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

  // 日跨ぎが起きていたらポリラインを一旦クリアして「今日」を新規開始する。
  // localStorage 側の track は appendTrack で従来どおり追記され続けるので、
  // 過去日の軌跡データはそのまま温存される（将来の踏破履歴ビュー用）。
  const nowMs = Date.now();
  if (lastTrackTs !== null && !isSameLocalDay(lastTrackTs, nowMs)) {
    clearTrack();
  }
  addTrackPoint(lat, lon);
  appendTrack(lat, lon);
  lastTrackTs = nowMs;

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

    // Issue #17: 新カードに切り替わったので 👍 / 👎 をリセットして一旦隠す。
    // 解説が確定した時点（キャッシュ/生成成功）で showRating() する。
    // currentDescriptionText も一旦 null にし、有効な説明文が出るまで評価記録の
    // 対象が無い状態にする（記事なし・生成失敗のまま rating が押せないように）。
    currentRating = null;
    currentDescriptionText = null;
    setRatingState(null);
    hideRating();

    tryFlushTelemetry(password);

    if (cached) {
      setDescription(cached);
      currentDescriptionText = cached;
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
      // Issue #17: 有効な解説が出たので sampling の有無に関わらず 👍 / 👎 を表示する。
      // サンプリング外でクリックされた場合は handleRatingClick が trace を遅延発行して記録する。
      showRating();
    } else {
      setDescriptionLoading();
      const result = await fetchDescription(
        password,
        {
          prefecture: muni.prefecture,
          municipality: muni.name,
          muniCode: muni.code,
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
          currentDescriptionText = result.description;
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
              wikidata_attributes_length: result.wikidata_attributes_length,
              judge_error: result.judge_error,
              generator_model: result.generator_model,
              judge_model: result.judge_model,
              deterministic_score: result.deterministic_score,
              deterministic_passed: result.deterministic_passed,
              deterministic_out_of_kb_terms: result.deterministic_out_of_kb_terms,
            }));
            currentDisplayStartMs = Date.now();
            updateTelemetry(currentTraceId, { ts_displayed: currentDisplayStartMs });
          }
          // Issue #17: 有効な解説が出たので sampling の有無に関わらず 👍 / 👎 を表示する。
          showRating();
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

// === Issue #17: 👍 / 👎 クリック処理 ===
// 👍 / 👎 は明示フィードバックで貴重なので、サンプリングで間引かず常に記録する。
// サンプリング外で trace_id が無いときは、その場で trace を遅延発行し、表示中の
// 市町村に対するテレメトリエントリを積んでから user_rating を更新する。これにより
// SAMPLE_RATE を下げても評価だけは必ず残る（受動シグナル dwell_ms 等のみ間引く）。
// 同じボタン再タップで null（取り消し）に戻す。flush は既存の自動経路に任せる。
function handleRatingClick(clicked) {
  const plan = planRatingClick({
    hasTrace: !!currentTraceId,
    hasDescription: !!currentDescriptionText && !!currentMuniCd,
    currentRating,
    clicked,
  });
  // 有効な説明文が表示されていなければ無視（ボタンは hidden のはずだが防御的に）。
  if (!plan) return;

  // サンプリング外で trace が無ければ、評価を確実に残すため遅延発行してエントリを積む。
  if (plan.needNewTrace) {
    currentTraceId = generateTraceId();
    const now = Date.now();
    appendTelemetry(buildTelemetryEntry({
      trace_id: currentTraceId,
      muni_code: currentMuniCd,
      description: currentDescriptionText,
      ts_generated: now,
    }));
    currentDisplayStartMs = now;
    updateTelemetry(currentTraceId, { ts_displayed: now });
  }

  currentRating = plan.userRating;
  updateTelemetry(currentTraceId, { user_rating: currentRating });
  setRatingState(currentRating);
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
