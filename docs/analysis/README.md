# trip-road テレメトリ分析

S3 に蓄積された土地のたよりテレメトリを LLM で分析するためのファイル群。

## 構成

```
docs/analysis/
├── README.md           # このファイル
├── fetch_entries.sh    # S3 → ローカル JSONL 集約スクリプト
├── prompts.md          # 分析プロンプトテンプレ（3 種）
└── data/               # 取得した JSONL 出力先（.gitignore 済）
```

## 使い方

### 1. データを取ってくる

```bash
bash docs/analysis/fetch_entries.sh
```

`~/.secrets/trip-road.env` から AWS 認証情報を読み、S3 バケット
`trip-road-telemetry-tetutetu214` の全オブジェクトをローカルに同期。
`jq` で 1 行 1 entry の JSONL に変換して `docs/analysis/data/entries-YYYYMMDD-HHMMSS.jsonl`
に保存する。

末尾に件数・最古/最新の生成時刻・市町村数のサマリが出る。

### 2. Claude に分析させる

`prompts.md` から目的に合うプロンプトを選び、JSONL ファイルの中身と一緒に
claude.ai or Anthropic API に渡す。プロンプトは 3 種：

| 番号 | 目的 |
|---|---|
| 1 | 「春野菜が美味しい」のような汎用表現を検出する（最重要） |
| 2 | system prompt の改善案を出してもらう（コードに反映する用） |
| 3 | 再生成すべき低品質キャッシュの優先度付きリスト |

### 3. 改善を反映する

プロンプト 2 の出力を見て、`workers/src/anthropic.js` の system prompt を直接編集 →
`wrangler deploy` で反映。しばらく実走したあと、再度 fetch して改善前後を比較する。

## fetch_entries.sh のサマリ出力（Plan E 以降）

スクリプト末尾で以下を表示する。Plan E 以降の entry（`judge_passed` フィールドを
持つもの）が 1 件でもあれば「Plan E Judge 集計」セクションが出る。

```
=== サマリ ===
最古 ts_generated: 2026-04-26 09:00:27
最新 ts_generated: 2026-05-04 18:30:11
市町村数: 12

=== Plan E Judge 集計（対象: N 件、6.4 以降の entry のみ）===
  合格 (passed=true):     X/N (XX%)
  NG 確定 (false):         X/N (XX%)
  fail-open (null):        X/N (XX%)
  再生成発生 (regen=true): X/N (XX%)

  軸別平均スコア（null 除外、小数2桁）:
    accuracy: 4.83
    specificity: 3.67
    season_fit: 4.92
    density: 3.50

  NG 確定 entry 一覧（要 prompts.md で要因分析）:
    14215 [05] acc=5 spec=2 season=5 dens=3 regen=true
    14216 [05] acc=4 spec=3 season=5 dens=2 regen=true
```

これだけ見れば「prompt 修正が効いているか」「どの軸が弱いか」が一目で分かる。
詳細な要因分析（汎用フレーズの具体例、prompt 改善案）はそのまま `prompts.md` の
テンプレで Claude に投げる従来フローを継続。

## 設計判断のメモ

- 当初は Athena で SQL 集計する設計だったが、月 100 件規模の個人 PoC では
  LLM 単独分析の方が学習効果も実装コストも有利なので方針変更（詳細は
  `docs/knowledge.md` 4.7 セクション）
- IAM ユーザ `trip-road-telemetry-writer` は当初 `s3:PutObject` のみだったが、
  `s3:ListBucket` / `s3:GetObject` / `s3:DeleteObject` を追加して analysis
  にも使えるようにした
- `data/` 配下の JSONL は個人の移動ログそのものなのでコミットしない
  （`.gitignore` で除外済）

## 制限事項

- 件数が少ないうちは「サンプル不足で結論保留」が正しい場面が多い
- `dwell_ms`（画面表示時間）は外的要因の影響が大きく、品質指標として弱い。
  プロンプトの「重要な前提」で LLM に明示してから使う
- Critic（生成と同時の自己評価）は未導入。Plan E 以降で検討
