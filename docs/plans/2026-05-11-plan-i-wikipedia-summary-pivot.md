# Plan I: Wikipedia 要約特化への方針転換

策定日: 2026-05-11
策定者: てつてつ + Claude Code
ステータス: 起草中（てつてつ確認待ち）

## 1. 背景と動機

Plan H（2026-05-08）で Generator / Judge を Anthropic Claude から Amazon Bedrock Nova Pro に移行した。コスト面の判断としては妥当だったが、本番運用で次の問題が顕在化した。

- **Nova Pro が Judge プロンプトの指示を守らない**。「Wikipedia 記載なしは減点対象外」「他軸の責任で評価しない」のような禁則を破り、軸違いの不当減点を出す。
- Plan G-1.5（PR #42、2026-05-09）で Judge プロンプトを強化したが、Nova Pro の指示追従の弱さは根本解決できない。
- **生成内容の事実誤認が多い**。Wikipedia 抜粋にない事実（特産品・人物・建造物・年号）を Nova Pro が内部知識から捻り出す。Judge の事実検証も Nova Pro の能力に依存しているため検知できない。
- 結果として、使用者（てつてつ）が「間違いが多すぎて読む気が起きない」状態。テレメトリは 2026-05-10 / 2026-05-11 でゼロ件、5/8〜5/9 でも 4 件のみ。

memory「trip-road は Nova Pro 一択（戻りなし）」によりコスト面でモデル変更はできない。よって**タスクそのものを Nova Pro でも崩れない形に変える**。

## 2. 新方針サマリ

| 項目 | Before（Plan H） | After（Plan I） |
|---|---|---|
| アプリの位置づけ | GPS 連動の季節感ある旅のお供 | GPS 連動の市町村 Wikipedia 要約配信 |
| Generator のタスク | 市町村 + 節気 → 季節感ある解説 120-180字 | 市町村 Wikipedia 抜粋 → 要約 120-180字 |
| 二十四節気 | コア要素 | 廃止 |
| Wikipedia 抜粋 | 事実検証用の参照資料 | **唯一の情報源（context）** |
| LLM の内部知識 | 季節情報・地理常識で活用可 | **禁止**。Wikipedia 抜粋にない事実は出さない |
| Judge | 4 軸（事実・具体性・季節整合・密度） | Faithfulness 1 軸に簡素化 |
| 文体 | カーナビ風、淡々（情緒NG） | 同じ（維持） |

## 3. 残すもの・捨てるもの

### 残す
- GPS 判定（現在 → 隣接 → GSI フォールバック）
- 市町村 GeoJSON / N03 前処理
- Cloudflare Workers + Pages 構成
- 認証（X-App-Password）
- AWS S3 テレメトリ Sink（スキーマ変更あり）
- Wikipedia API 取得 + Workers Cache（30日 TTL → 延長検討）
- Generator の文体ルール（カーナビ風、情緒禁止）
- Judge を Faithfulness 1 軸に簡素化して残す

### 捨てる
- `workers/src/solar_term_meta.js`（二十四節気メタ）
- Judge 軸 2（具体性）/ 軸 3（季節整合）/ 軸 4（情報密度）
- `judge_prompts.js` の 4 軸構成（Faithfulness のみ残す）
- Generator プロンプトの季節記述ルール
- 再生成フィードバックの「節気との整合」項目
- フロント側の節気アイコン・節気表示 UI
- API リクエストの `solar_term` フィールド
- テレメトリの `critic_accuracy` / `critic_specificity` / `critic_season_fit` / `critic_density` フィールド

### 段階的に判断
- Wikipedia が短い市町村（過疎地、政令市の区）への対応 → Phase 2 で
- 公式HP 等の追加情報源 → Phase 2 以降で検討

## 4. 新しい Generator プロンプト方針

タスクを「未知の創作」から「既知の圧縮（要約）」に変える。

### 入力 context
- 市町村名（都道府県 + 市区町村）
- Wikipedia 抜粋（cleanExtract 適用済）

### 出力ルール
- プレーンテキスト 120-180 字
- **Wikipedia 抜粋にない事実は一切出さない（ハードルール）**
- 抜粋の文章をそのまま引用せず、自分の言葉で要約する
- 文体: です・ます調、カーナビ風、情緒・抒情禁止（既存ルール踏襲）
- 抜粋が短く 120 字に達しない場合 → 短いまま転載（無理に膨らませない）

### Wikipedia 抜粋が取れない / 著しく短い市町村への挙動
- 「Wikipedia 抜粋なし」のときは Generator を呼ばず、フロントで「この市町村の情報は準備中です」を表示
- LLM の内部知識で補完するのは禁止（Plan H 時代の挙動を逆転）

## 5. Judge の扱い

Faithfulness 1 軸に簡素化して残す。理由:

- 要約タスクとはいえ Nova Pro が抜粋外を出力するリスクはゼロにできない
- 機械的な後処理フィルタとして Judge を残し、抜粋外の固有名詞混入時は再生成 or reject
- 4 軸 → 1 軸でコード量・プロンプト量・コストが大幅に減る

### Faithfulness Judge プロンプト方針
- 入力: Wikipedia 抜粋 + 生成文
- 出力: `{"faithful": true|false, "out_of_kb_terms": ["固有名詞1", ...], "score": 1-5}`
- 評価基準: 生成文に含まれる固有名詞・事実が Wikipedia 抜粋に裏付けられているか
- 抜粋にない固有名詞があれば `out_of_kb_terms` に列挙
- score < 4 で再生成（最大 1 回）、再生成後も NG なら抜粋転載にフォールバック

### Judge を LLM 以外で実装する選択肢（要検討）
- Wikipedia 抜粋を分かち書きして固有名詞集合を作成
- 生成文を分かち書きして、固有名詞が抜粋集合に含まれるかチェック
- LLM を介さない決定論的な検査 → コスト 0、判定揺らぎなし
- 形態素解析ライブラリは Workers 上で動く軽量なものを探す必要あり
- Phase 1 は LLM Judge で始め、Phase 2 で決定論的検査への置換を検討

## 6. テレメトリスキーマ変更

### 旧スキーマ（37 件、〜2026-05-09）
```json
{
  "trace_id": "...",
  "muni_code": "...",
  "solar_term": "...",
  "description": "...",
  "critic_accuracy": 1-5,
  "critic_specificity": 1-5,
  "critic_season_fit": 1-5,
  "critic_density": 1-5,
  "critic_deductions": {...},
  "judge_passed": bool,
  "regenerated": bool,
  ...
}
```

### 新スキーマ（Plan I 以降）
```json
{
  "trace_id": "...",
  "muni_code": "...",
  "description": "...",
  "wikipedia_extract_length": <int>,
  "faithfulness_score": 1-5,
  "out_of_kb_terms": ["..."],
  "judge_passed": bool,
  "regenerated": bool,
  "fallback_to_extract": bool,
  ...
}
```

### 過去ログの扱い
- 旧 37 件は `legacy/year=2026/month=05/...` に移動
- 新スキーマと混ざらないように S3 パーティションを分離

## 7. フロントエンド変更

- `public/index.html` から節気アイコン・節気表示 UI を削除
- `public/assets/` の節気関連 JS / CSS を削除
- API リクエストから `solar_term` フィールド削除
- localStorage キャッシュキー `{市町村コード}_{季節}` → `{市町村コード}` に変更
- 既存 localStorage 値は破棄して再キャッシュ（移行コストは小さい、使用者は本人のみ）

## 8. 移行手順（段階）

### Phase 1: Wikipedia 一本で再出発（MVP）
1. ブランチ `feature/plan-i-wikipedia-summary-pivot` を切る
2. Workers Generator プロンプトを「Wikipedia 抜粋の要約」に書き換え（`nova.js`）
3. Judge を Faithfulness 1 軸に簡素化（`judge.js` / `judge_prompts.js`）
4. `solar_term_meta.js` 削除、`describe_flow.js` から solar_term 配線除去
5. テレメトリスキーマ更新（旧フィールド削除、新フィールド追加）
6. フロント UI から節気要素削除
7. 過去 37 件を S3 `legacy/` に move
8. ローカル wrangler dev で動作確認
9. `workers/deploy_production.sh` で本番デプロイ
10. `deploy_frontend.sh` でフロント本番反映
11. 神奈川 10 市町村でバッチ評価（`analysis/run_sweep.sh` の流用）

### Phase 2: Wikipedia が薄い市町村への対応（必要なら）
- Phase 1 のバッチ評価で品質ばらつきを観測
- Wikipedia 抜粋が短い市町村を特定
- 対象市町村だけ公式HP / Wikidata を事前収集 → S3 KB として補完
- ハードルール: KB に入った情報のみ context として LLM に渡す。LLM の内部知識補完は禁止のまま

### Phase 3: リアルタイム多源取得（任意）
- レイテンシ・安定性・コストの観点で必要なら検討
- 現時点では Phase 1 でしばらく回して判断保留

## 9. リスク・気をつけること

- **Wikipedia 記事が極端に短い市町村への挙動**: 120 字未満なら抜粋を転載、抜粋なしならフロントで「情報準備中」を表示。LLM 内部知識での補完は禁止（ハルシネーション逆戻り防止）
- **政令指定都市の区**: Wikipedia が独立記事として弱い場合がある。Phase 2 で補強候補
- **要約の機械感**: 120 字に圧縮するとカーナビ以下の無味乾燥になる可能性。文体ルールを緩める可能性も視野に入れる（情緒は禁止のまま、淡々さの度合い調整）
- **Wikipedia の鮮度**: 30 日キャッシュ TTL は維持で問題ないが、削除された記事への対応を確認
- **Faithfulness Judge も Nova Pro で動く**: 軸違い不当減点と同種の指示無視リスクは残る。決定論的検査（Phase 2 候補）への置換で根本対策
- **過去ログの分析価値**: 旧スキーマの 37 件は今後の改善には使えなくなる。分析が必要なら Phase 1 着手前にスナップショット取得

## 10. 想定スケジュール

- 2026-05-11（今日）: Plan I 起草、てつてつ確認、ブランチ作成
- 2026-05-12〜13: Workers / Judge / フロント実装
- 2026-05-14: バッチ評価、本番デプロイ
- 以降: Phase 2 / 3 はバッチ評価結果次第で判断

## 11. 関連ドキュメント

- 前提となる方針: memory `project_trip_road_nova_pro_locked.md`
- 評価フロー: memory `project_trip_road_batch_eval.md`
- デプロイ手順: memory `reference_trip_road_deploy_scripts.md`
- 直前の Plan H（Nova Pro 移行）: `docs/knowledge.md` 4.22 章
- Judge 軸違い修正（Plan G-1.5）: `docs/knowledge.md` 4.23 章
