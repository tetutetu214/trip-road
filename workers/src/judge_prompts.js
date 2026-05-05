/**
 * Judge プロンプトテンプレート（Plan E / Phase 6.2）
 *
 * Sonnet 4.6 を 4 軸並列で叩くためのプロンプト構築関数群。
 * 仕様詳細は docs/spec.md 10.3 章、設計判断は docs/plan.md 第 10 章を参照。
 *
 * すべて純粋関数。副作用なし、外部 fetch なし。
 *
 * 軸の構成:
 *   軸 1: 事実正確性 (Wikipedia RAG)
 *   軸 2: 具体性 (固有名詞 vs 汎用フレーズ)
 *   軸 3: 季節整合 (二十四節気との矛盾)
 *   軸 4: 情報密度 (情緒修飾 vs 事実陳述)
 *
 * 二十四節気のメタ情報は F-1.3b で共通モジュール solar_term_meta.js に切り出した
 * （Generator も Judge も同じ META を使うようになったため）。
 */

import { SOLAR_TERM_META } from './solar_term_meta.js';

// 互換性のため re-export（既存テストや将来の参照のため）
export { SOLAR_TERM_META };

/**
 * 共通プリアンブル。4 軸全プロンプトの先頭に置く。
 * 校閲者ロール、市町村・節気・本文の埋込、共通採点基準、出力フォーマットを宣言する。
 *
 * @param {object} params
 * @param {string} params.prefecture
 * @param {string} params.municipality
 * @param {string} params.solarTerm - '01'〜'24'
 * @param {string} params.description - 採点対象の解説本文
 * @returns {string}
 */
export function buildCommonPreamble({ prefecture, municipality, solarTerm, description }) {
  const meta = SOLAR_TERM_META[solarTerm];
  const name = meta?.name ?? '';
  const period = meta?.period ?? '';
  return `あなたは厳格な校閲者です。以下の旅行解説（120〜180字、iPhoneで移動中の旅人が読む）を採点します。
誤りや弱点を見逃すと、読者にとって価値の低い解説がキャッシュされ続けてしまいます。

【市町村】 ${prefecture} ${municipality}
【二十四節気】 ${solarTerm} ${name}（${period}）
【解説本文】
${description}

【手順】
1. 以下の観点について、解説本文から **減点根拠となる該当箇所を引用形式で列挙** せよ。
2. 引用した減点根拠の重みを踏まえ、**最後に** 1〜5 点で採点せよ。
3. 必ず以下の JSON 形式のみで出力せよ（前後に説明文を付けない）:
   {"deductions": ["引用1", "引用2", ...], "score": <整数 1-5>, "notes": "<簡潔なまとめ 50字以内>"}

【採点基準（共通）】
- 5: 減点根拠なし、模範的
- 4: 軽微な減点根拠あり（許容範囲）
- 3: 中程度の減点根拠複数（再生成すべき）
- 2: 重大な減点根拠あり
- 1: 全面的に問題`;
}

/**
 * 軸 1: 事実正確性 prompt。
 *
 * Wikipedia 抜粋を埋め込み、地理・歴史・地形に関する記述の根拠を照合させる。
 * Wikipedia が取れない（null）場合は「情報なし」差し替え + 保守的評価指示
 * （明確な誤りが見当たらなければ減点しない）に切り替える。
 *
 * @param {object} params
 * @param {string} params.prefecture
 * @param {string} params.municipality
 * @param {string} params.solarTerm
 * @param {string} params.description
 * @param {string|null} params.wikipediaExtract - cleanExtract 適用済 or null
 * @returns {string}
 */
export function buildFactualityPrompt({
  prefecture,
  municipality,
  solarTerm,
  description,
  wikipediaExtract,
}) {
  const preamble = buildCommonPreamble({ prefecture, municipality, solarTerm, description });

  const wikiBlock =
    wikipediaExtract === null || wikipediaExtract === undefined || wikipediaExtract === ''
      ? `【Wikipedia 抜粋】
（情報なし。Wikipedia 抜粋が取得できなかったため、明確な事実誤認が見当たらない場合は減点しないこと。Wikipedia 由来の根拠を欠く記述があっても、地理常識として明らかな矛盾がない限り保守的に評価する。）`
      : `【Wikipedia 抜粋】
${wikipediaExtract}`;

  return `${preamble}

【観点】 地理・歴史・地形に関する記述が、以下の Wikipedia 抜粋と照合して事実誤認や根拠なき記述になっていないか。
（Wikipedia に明記されていない事項は「根拠なし」とみなし減点。Wikipedia と直接矛盾する記述はより重く減点。）

${wikiBlock}

【Few-shot 例】

例A（5点想定）:
解説:「緑区は津久井湖と相模湖を抱える山岳地帯。標高1,673mの蛭ヶ岳（神奈川県最高峰）が区西部にそびえ、江戸期は甲州街道の宿場町として賑わった。」
→ 出力: {"deductions": [], "score": 5, "notes": "Wikipediaと整合"}

例B（2点想定）:
解説:「相模原市緑区は江戸時代の城下町として栄え、武家屋敷の街並みが今も残る。」
→ 出力: {"deductions": ["江戸時代の城下町として栄え（Wikipediaに記載なし、緑区は城下町ではない）", "武家屋敷の街並み（同上、根拠なし）"], "score": 2, "notes": "城下町という根拠不明な前提が複数文にわたる"}

ではこの解説本文を採点してください。`;
}

/**
 * 軸 2: 具体性 prompt。
 *
 * 固有名詞（地名・施設名・特産品・人物・年号・標高・距離等の具体値）の含有度合いを評価。
 * 「春野菜」「桜が美しい」のような他市町村でも通用する汎用フレーズが多いほど低スコア。
 *
 * @param {object} params
 * @param {string} params.prefecture
 * @param {string} params.municipality
 * @param {string} params.solarTerm
 * @param {string} params.description
 * @returns {string}
 */
export function buildSpecificityPrompt({ prefecture, municipality, solarTerm, description }) {
  const preamble = buildCommonPreamble({ prefecture, municipality, solarTerm, description });

  return `${preamble}

【観点】 単語レベルで、固有名詞（地名・施設名・特産品・人物・年号・標高・距離等の具体値）がどれだけ含まれているか。「春野菜」「桜が美しい」「のんびりとした時間」のように他市町村でも通用する抽象・汎用フレーズが多いほど低スコア。

【Few-shot 例】

例A（5点想定）:
解説:「緑区には津久井湖・相模湖・城山ダム・蛭ヶ岳（標高1,673m）・津久井城址がある。江戸期は甲州街道の小原宿・与瀬宿が置かれ、養蚕業で栄えた。」
→ 出力: {"deductions": [], "score": 5, "notes": "固有名詞が高密度"}

例B（2点想定）:
解説:「緑区は山と湖が美しい町です。春には桜が咲き、自然豊かな景観が広がります。歴史も古く、地元の名物も楽しめる素敵な地域です。」
→ 出力: {"deductions": ["山と湖が美しい（汎用）", "桜が咲き（汎用）", "自然豊かな景観（汎用）", "歴史も古く（汎用）", "地元の名物（具体名なし）"], "score": 2, "notes": "固有名詞ゼロ、全文が汎用フレーズ"}

ではこの解説本文を採点してください。`;
}

/**
 * 軸 3: 季節整合 prompt。
 *
 * 二十四節気（name と period）と矛盾する季節描写の有無を評価。
 *
 * @param {object} params
 * @param {string} params.prefecture
 * @param {string} params.municipality
 * @param {string} params.solarTerm
 * @param {string} params.description
 * @returns {string}
 */
export function buildSeasonalConsistencyPrompt({
  prefecture,
  municipality,
  solarTerm,
  description,
}) {
  const preamble = buildCommonPreamble({ prefecture, municipality, solarTerm, description });
  const meta = SOLAR_TERM_META[solarTerm];
  const name = meta?.name ?? '';
  const period = meta?.period ?? '';

  return `${preamble}

【観点】 二十四節気（${name}: ${period}）と矛盾する季節描写が含まれていないか。例えば「清明（4月初旬）」の時期に紅葉や雪景色を書いていれば矛盾。

【Few-shot 例】

例A（5点想定、節気=清明）:
解説:「清明の頃、緑区の津久井湖周辺ではヤマザクラが見頃。城山公園の桜並木、相模湖の遊覧船運航再開時期。」
→ 出力: {"deductions": [], "score": 5, "notes": "4月初旬と整合"}

例B（1点想定、節気=清明）:
解説:「緑区の山々は雪化粧で美しく、紅葉も色づき始めました。冬の静けさが残る湖畔は…」
→ 出力: {"deductions": ["雪化粧（清明=4月初旬と矛盾）", "紅葉も色づき始め（同）", "冬の静けさ（同）"], "score": 1, "notes": "節気と完全に矛盾"}

ではこの解説本文を採点してください。`;
}

/**
 * 軸 4: 情報密度 prompt。
 *
 * 情緒的修飾（「淡紅色に染まり」「心地よい春風」等）に字数を取られていないか、
 * 事実陳述・カーナビ的な情報案内に近いほど高スコア。
 *
 * @param {object} params
 * @param {string} params.prefecture
 * @param {string} params.municipality
 * @param {string} params.solarTerm
 * @param {string} params.description
 * @returns {string}
 */
export function buildInformationDensityPrompt({
  prefecture,
  municipality,
  solarTerm,
  description,
}) {
  const preamble = buildCommonPreamble({ prefecture, municipality, solarTerm, description });

  return `${preamble}

【観点】 文章全体として、旅人にとって有用な情報（地名・歴史・地形・特産・ランドマーク・実用情報）が淡々と詰まっているか。情緒的修飾（「淡紅色に染まり」「心地よい春風が頬をなで」「のんびりとした時間が流れる」「優雅な〜」「美しい〜」「素敵な〜」など）に字数を取られていると低スコア。事実陳述・カーナビ的な情報案内に近いほど高スコア。

【Few-shot 例】

例A（5点想定）:
解説:「緑区の津久井湖は1965年完成の城山ダム湖、湛水面積2.6km²。湖畔の県立津久井湖城山公園に津久井城址（戦国期、北条家家臣が居城）と展望広場。蛭ヶ岳は神奈川県最高峰、丹沢山地の主峰。」
→ 出力: {"deductions": [], "score": 5, "notes": "事実陳述のみ、情緒修飾なし"}

例B（2点想定）:
解説:「緑区は山と湖が美しい町です。春の訪れとともに桜が咲き誇り、心地よい春風が頬をなでる季節となりました。湖畔を歩けば、のんびりとした時間が流れます。」
→ 出力: {"deductions": ["山と湖が美しい（情緒修飾）", "桜が咲き誇り（同）", "心地よい春風が頬をなで（同）", "のんびりとした時間が流れます（同）"], "score": 2, "notes": "情緒修飾で字数を消費、事実情報が薄い"}

ではこの解説本文を採点してください。`;
}
