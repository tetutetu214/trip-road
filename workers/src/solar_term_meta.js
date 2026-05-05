/**
 * 二十四節気の番号 → {name, period} を提供する共通モジュール。
 *
 * Generator (anthropic.js) と Judge (judge_prompts.js) の両方から import される。
 * 24 節気のリストという同じ知識を 1 箇所に集約することで、片方を直して
 * もう片方が古いままという食い違いを防ぐ（DRY 原則）。
 *
 * F-1.3b で Generator にも period を渡すようになり、当初の「Generator は
 * 名前だけ・Judge は名前+期間」という非対称な設計を統合した経緯は
 * docs/knowledge.md 4.18 章を参照。
 *
 * period は人間可読の概算（実際の節気は太陽黄経で決まり毎年 ±1 日程度ずれる）。
 */

export const SOLAR_TERM_META = {
    '01': { name: '立春', period: '2月4日頃〜雨水前' },
    '02': { name: '雨水', period: '2月19日頃〜啓蟄前' },
    '03': { name: '啓蟄', period: '3月6日頃〜春分前' },
    '04': { name: '春分', period: '3月21日頃〜清明前' },
    '05': { name: '清明', period: '4月5日頃〜穀雨前' },
    '06': { name: '穀雨', period: '4月20日頃〜立夏前' },
    '07': { name: '立夏', period: '5月6日頃〜小満前' },
    '08': { name: '小満', period: '5月21日頃〜芒種前' },
    '09': { name: '芒種', period: '6月6日頃〜夏至前' },
    '10': { name: '夏至', period: '6月21日頃〜小暑前' },
    '11': { name: '小暑', period: '7月7日頃〜大暑前' },
    '12': { name: '大暑', period: '7月23日頃〜立秋前' },
    '13': { name: '立秋', period: '8月8日頃〜処暑前' },
    '14': { name: '処暑', period: '8月23日頃〜白露前' },
    '15': { name: '白露', period: '9月8日頃〜秋分前' },
    '16': { name: '秋分', period: '9月23日頃〜寒露前' },
    '17': { name: '寒露', period: '10月8日頃〜霜降前' },
    '18': { name: '霜降', period: '10月23日頃〜立冬前' },
    '19': { name: '立冬', period: '11月7日頃〜小雪前' },
    '20': { name: '小雪', period: '11月22日頃〜大雪前' },
    '21': { name: '大雪', period: '12月7日頃〜冬至前' },
    '22': { name: '冬至', period: '12月22日頃〜小寒前' },
    '23': { name: '小寒', period: '1月6日頃〜大寒前' },
    '24': { name: '大寒', period: '1月20日頃〜立春前' },
};
