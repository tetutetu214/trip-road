/**
 * F-4: 切替フロー（解説のキャッシュ確認 + 必要なら API 呼出）に入るべきかを判定する純粋関数。
 *
 * 通常は「市町村が前回と異なるとき」にだけ切替フローに入るが、
 * 初回 fix のときは「前回と同じ市町村」でもキャッシュ確認まで進む必要がある
 * （前回キャッシュなしのまま終わっていると、起動しても画面が空のままになるため）。
 *
 * @param {string} newCode - 今回 GPS で判定された市町村コード
 * @param {string|null} currentCode - 直前まで表示していた市町村コード
 * @param {boolean} wasFirstFix - この handlePosition 呼出が初回 GPS fix か
 * @returns {boolean}
 */
export function shouldEnterSwitchFlow(newCode, currentCode, wasFirstFix) {
    return newCode !== currentCode || wasFirstFix === true;
}
