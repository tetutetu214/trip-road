/**
 * 定数時間で 2 つの文字列を比較する。
 *
 * 通常の === 比較は「最初の不一致文字でショートサーキット」するため、
 * 処理時間の差から文字列内容を推測できる攻撃（タイミング攻撃）を許す。
 * Web Crypto API の crypto.subtle.digest を使って両者を同じ長さの
 * バイト列（ハッシュ）に変換し、バイト単位の XOR で比較することで、
 * 処理時間を入力内容に依存させない。
 *
 * @param {string} received - クライアントから受け取った値
 * @param {string} expected - Workers Secrets に登録されている値
 * @returns {Promise<boolean>} 一致なら true
 */
export async function timingSafeEqual(received, expected) {
  // null/undefined の早期 return（安全側に false）
  if (typeof received !== 'string' || typeof expected !== 'string') {
    return false;
  }

  // 長さが違えば即 false。ただしこの判定自体が長さで分岐するため、
  // ハッシュに通して固定長バイト列にしてから比較する。
  const encoder = new TextEncoder();
  const receivedBuf = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(received)
  );
  const expectedBuf = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(expected)
  );

  // ハッシュは常に 32 バイト。XOR で差分ビットを OR し、0 なら一致
  const receivedArr = new Uint8Array(receivedBuf);
  const expectedArr = new Uint8Array(expectedBuf);
  let diff = 0;
  for (let i = 0; i < receivedArr.length; i++) {
    diff |= receivedArr[i] ^ expectedArr[i];
  }

  // 更に元の長さも一致することを確認（ハッシュ衝突の可能性はほぼ無いが念のため）
  return diff === 0 && received.length === expected.length;
}
