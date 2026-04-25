/**
 * DOM 要素への書き込みを一元化するユーティリティ。
 */

const $ = (id) => document.getElementById(id);

export function showPasswordScreen() {
  $('password-screen').classList.remove('hidden');
  $('main-screen').classList.add('hidden');
}
export function showMainScreen() {
  $('password-screen').classList.add('hidden');
  $('main-screen').classList.remove('hidden');
}
export function showPasswordError(msg) {
  const el = $('password-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
export function clearPasswordError() {
  $('password-error').classList.add('hidden');
}

export function setMuniName(name) {
  $('muni-name').textContent = name;
  $('muni-name-big').textContent = name;
}
export function setMuniRomaji(romaji) {
  $('muni-romaji').textContent = romaji;
}
export function setSpeed(kmh) {
  $('speed').textContent = kmh === null ? '--' : String(kmh);
}
export function setVisitedCount(n) {
  $('visited-count').textContent = String(n);
}

export function setDescription(text) {
  const body = $('description');
  const skel = $('description-skeleton');
  skel.classList.add('hidden');
  body.classList.remove('muted');
  body.textContent = text;
  body.style.opacity = 0;
  requestAnimationFrame(() => {
    body.style.transition = 'opacity 200ms';
    body.style.opacity = 1;
  });
}
export function setDescriptionLoading() {
  $('description').textContent = '';
  $('description-skeleton').classList.remove('hidden');
}
export function setDescriptionFailed() {
  $('description-skeleton').classList.add('hidden');
  const body = $('description');
  body.classList.add('muted');
  body.textContent = '解説を取得できませんでした';
}
export function clearDescription() {
  $('description').textContent = '';
  $('description-skeleton').classList.add('hidden');
}

export function setGpsActive(active) {
  const dot = $('gps-dot');
  const status = $('gps-status');
  const text = $('gps-text');
  if (active) {
    dot.classList.remove('dot-inactive');
    dot.classList.add('dot-active');
    status.classList.remove('inactive');
    text.textContent = 'GPS 受信中';
  } else {
    dot.classList.add('dot-inactive');
    dot.classList.remove('dot-active');
    status.classList.add('inactive');
    text.textContent = 'GPS 測位中';
  }
}

export function setPermissionDenied() {
  setMuniName('位置情報の許可が必要です');
  const body = $('description');
  body.classList.add('muted');
  body.textContent = 'iPhone の設定 → trip-road → 位置情報 を「App の使用中のみ」に設定してください';
  $('description-skeleton').classList.add('hidden');
}

// Plan D Stage 1: テレメトリ JSON のダウンロード（手動エクスポート）
export function downloadJson(filename, jsonString) {
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
