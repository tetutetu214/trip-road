/**
 * trip-road メインオーケストレータ。
 * DOMContentLoaded で初期化、状態遷移を管理。
 */

import { getSeason } from './season.js';
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
} from './storage.js';
import { fetchDescription } from './api.js';
import { identifyMunicipality, prefetchNeighbors } from './muni.js';
import { initMap, updateCurrentLocation, addTrackPoint, setTrack } from './map.js';
import { startWatching } from './geo.js';
import {
  showPasswordScreen, showMainScreen,
  showPasswordError, clearPasswordError,
  setMuniName, setMuniRomaji, setSpeed, setVisitedCount,
  setDescription, setDescriptionLoading, setDescriptionFailed, clearDescription,
  setGpsActive, setPermissionDenied,
} from './ui.js';

let currentMuniCd = null;
let isFirstFix = true;

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
    const cached = getCachedDescription(currentMuniCd, getSeason());
    if (cached) setDescription(cached);
  }

  // GPS 監視開始
  startWatching(
    (pos) => handlePosition(pos, password),
    (err) => handleGpsError(err),
  );
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
    const season = getSeason();
    const cached = getCachedDescription(muni.code, season);
    if (cached) {
      setDescription(cached);
    } else {
      setDescriptionLoading();
      const result = await fetchDescription(password, {
        prefecture: muni.prefecture,
        municipality: muni.name,
        season,
      });
      if (result.ok) {
        setCachedDescription(muni.code, season, result.description);
        setDescription(result.description);
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
