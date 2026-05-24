/**
 * 都道府県コード（2 桁文字列）→ 地方コードのマッピング。
 *
 * preprocess/build_regions.py の PREFECTURE_TO_REGION と同じ内容。
 * フロント側でも踏破履歴の集計に使うため複製している。マッピングが
 * 変わったときは両方を更新する必要がある（spec.md §14.11）。
 */

export const PREFECTURE_TO_REGION = {
  '01': 'hokkaido',
  '02': 'tohoku', '03': 'tohoku', '04': 'tohoku', '05': 'tohoku',
  '06': 'tohoku', '07': 'tohoku',
  '08': 'kanto', '09': 'kanto', '10': 'kanto', '11': 'kanto',
  '12': 'kanto', '13': 'kanto', '14': 'kanto',
  '15': 'chubu', '16': 'chubu', '17': 'chubu', '18': 'chubu',
  '19': 'chubu', '20': 'chubu', '21': 'chubu', '22': 'chubu',
  '23': 'chubu',
  '24': 'kinki', '25': 'kinki', '26': 'kinki', '27': 'kinki',
  '28': 'kinki', '29': 'kinki', '30': 'kinki',
  '31': 'chugoku', '32': 'chugoku', '33': 'chugoku',
  '34': 'chugoku', '35': 'chugoku',
  '36': 'shikoku', '37': 'shikoku', '38': 'shikoku', '39': 'shikoku',
  '40': 'kyushu', '41': 'kyushu', '42': 'kyushu', '43': 'kyushu',
  '44': 'kyushu', '45': 'kyushu', '46': 'kyushu', '47': 'kyushu',
};

export const REGION_NAMES = {
  hokkaido: '北海道',
  tohoku: '東北',
  kanto: '関東',
  chubu: '中部',
  kinki: '近畿',
  chugoku: '中国',
  shikoku: '四国',
  kyushu: '九州・沖縄',
};

/**
 * 5 桁の市町村コードから 2 桁の都道府県コードを抽出。
 * @param {string} muniCode
 * @returns {string}
 */
export function prefectureCodeOf(muniCode) {
  return String(muniCode).slice(0, 2);
}

/**
 * 5 桁の市町村コードから地方コードを返す。未知の都道府県コードは null。
 * @param {string} muniCode
 * @returns {string|null}
 */
export function regionCodeOf(muniCode) {
  const pref = prefectureCodeOf(muniCode);
  return PREFECTURE_TO_REGION[pref] ?? null;
}
