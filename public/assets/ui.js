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
  setDescriptionLoadingPhase('generating');
}
export function setDescriptionFailed() {
  $('description-skeleton').classList.add('hidden');
  const txt = $('description-loading-text');
  if (txt) txt.classList.add('hidden');
  const body = $('description');
  body.classList.add('muted');
  body.textContent = '解説を取得できませんでした';
}

/**
 * Plan E (6.5): ローディング中の文言を経過時間に応じて切り替える。
 *
 * @param {'generating'|'judging'|'regenerating'} phase
 */
export function setDescriptionLoadingPhase(phase) {
  const el = $('description-loading-text');
  if (!el) return;
  el.classList.remove('hidden');
  el.textContent = phaseToText(phase);
}

/**
 * phase 文字列 → 表示文言（純粋関数、テスト用）。
 * 不明な phase は空文字（既定値）。
 *
 * @param {string} phase
 * @returns {string}
 */
export function phaseToText(phase) {
  switch (phase) {
    case 'generating': return '📡 土地のたよりを生成中…';
    case 'judging': return '✓ 内容を確認しています…';
    case 'regenerating': return '✏️ より良い表現に書き直しています…';
    default: return '';
  }
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

// Plan E (6.5b): デバッグオーバーレイの表示制御。
// 表示内容自体の組み立ては formatDebugInfo（純粋関数）が担う。
export function setDebugInfo(judgeData, isDebugOn) {
  const el = $('debug-info');
  if (!el) return;
  if (!isDebugOn || !judgeData) {
    el.classList.add('hidden');
    el.textContent = '';
    return;
  }
  el.classList.remove('hidden');
  el.textContent = formatDebugInfo(judgeData);
}

/**
 * Judge データ → デバッグ表示用の複数行テキスト（純粋関数、テスト用）。
 *
 * 入力 judgeData の形:
 *   - キャッシュヒット: { cached: true }
 *   - 新規生成 + judge fail-open: { judge_passed: null, judge_error: string|null, ... }
 *   - 新規生成 + judge 成功: { judge_passed: bool, judge_scores: {...}, judge_deductions: {...}, regenerated: bool, judge_error: null }
 *
 * @param {object|null} data
 * @returns {string}
 */
export function formatDebugInfo(data) {
  if (!data) return '';
  if (data.cached) return '[DEBUG] (cached, no judge info)';
  if (data.judge_passed === null) {
    return `[DEBUG] judge unavailable (fail-open)\nerror: ${data.judge_error ?? '-'}`;
  }
  const s = data.judge_scores ?? {};
  const lines = [
    `[DEBUG] judge_passed: ${data.judge_passed} (regen: ${data.regenerated ?? false})`,
    `accuracy: ${s.accuracy ?? '-'}  specificity: ${s.specificity ?? '-'}  season_fit: ${s.season_fit ?? '-'}  density: ${s.density ?? '-'}`,
  ];
  const allDeductions = [];
  if (data.judge_deductions) {
    for (const [axis, items] of Object.entries(data.judge_deductions)) {
      if (Array.isArray(items) && items.length > 0) {
        items.forEach((d) => allDeductions.push(`  ${axis}: ${d}`));
      }
    }
  }
  if (allDeductions.length > 0) {
    lines.push('deductions:');
    lines.push(...allDeductions);
  }
  return lines.join('\n');
}
