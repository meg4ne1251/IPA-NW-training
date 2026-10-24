# 目的別モードの補強教材

2026-10-24追加。`focused-supplement.json` に独自問題42問を収録する。A-1が12問、A-2が30問。既存の学習分野をそのまま使い、新規専用で既習分野を除外する条件を緩めずに教材を増やす。個人の解答記録は教材ファイルに含めない。

| 科目・学習分野 | 問数 | 内容 |
| --- | ---: | --- |
| A-1・基礎理論・数値表現 | 4 | 整数の範囲、オーバーフロー、ビットマスク、固定小数点の刻み |
| A-1・基礎理論・確率と情報 | 4 | 二項分布、非復元抽出、余事象、期待値 |
| A-1・情報デザイン | 4 | 反復領域のスキップ、見出し、フォーカス、コントラスト |
| A-2・ソフトウェア開発管理技術 | 24 | テスト設計10問、Gitによる構成管理6問、CI・リリース管理8問 |
| A-2・ネットワーク | 4 | サブネット設計・ブロードキャスト、HTTP条件付きGET・メソッド制限 |
| A-2・システム構成要素 | 2 | 単体・冗長構成の稼働率 |

作成者・確認者はCodex（AI）。人による監修ではなく、本試験の予測問題や公式問題ではない。4件の異なる選択肢、正答の一意性、正答理由、全選択肢の説明、一次資料への参照を確認して検証済み教材として登録する。既存問題の本文をコピーせず、具体例・条件・数値を独自に設定した。

## 確認根拠と方法

- 数値表現：問題で固定ビット幅・符号の解釈・丸め方を指定し、[Python公式のビット演算の定義](https://docs.python.org/3/library/stdtypes.html#bitwise-operations-on-integer-types)と照合。12ビット全パターン、8ビットの和の解釈、マスクとシフト、量子化刻みを独立に計算した。Pythonの整数自体に8ビット制限があるという意味ではない。
- 確率：問題の有限な標本空間を[直積列挙](https://docs.python.org/3/library/itertools.html#itertools.product)に相当する方法で列挙し、式による解説と照合。3回中1回の成功は64通り中27通り、非復元抽出は順序付き20通り中6通り、サイコロは36通り中11通り、期待値は確率を6分割した重みで確認した。参照URLは列挙方法の根拠であり、独自例題の公式解答ではない。
- 情報デザイン：W3Cの[反復領域のスキップ](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html)、[見出し](https://www.w3.org/WAI/tutorials/page-structure/headings/)、[フォーカス](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html)、[通常文字のコントラスト](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)を確認。AAの通常文字4.5:1を、大きな文字3:1・AAAの通常文字7:1と区別した。
- テスト技法：[ISTQB CTFL v4.0.1シラバス](https://astqb.org/assets/documents/ISTQB_CTFL_Syllabus_v4.0.1.pdf)の同値分割・境界値・デシジョンテーブル・状態遷移・命令と分岐の網羅・回帰テストを照合。独自の入力値を列挙してクラス・判定結果を追跡した。「命令100%でも判定の真偽は50%」を具体例で確認した。
- テスト代用品・安定性：Martin Fowlerの[Test Double](https://martinfowler.com/bliki/TestDouble.html)、[非決定的なテスト](https://martinfowler.com/articles/nonDeterminism.html)を確認。固定応答と相互作用の検証、共有状態の干渉を区別した。
- Git：[Git公式利用者マニュアル](https://git-scm.com/docs/user-manual)でrevert、cherry-pick、競合解消、bisect、3方向マージ、タグを照合。共有済み履歴の取消しコミットと履歴の書換えを区別した。
- リリース管理：Martin Fowlerの[CI](https://martinfowler.com/articles/continuousIntegration.html)、[継続的デリバリー](https://martinfowler.com/bliki/ContinuousDelivery.html)、[ブルーグリーン](https://martinfowler.com/bliki/BlueGreenDeployment.html)、[機能フラグ](https://martinfowler.com/articles/feature-toggles.html)で用語・手順を照合した。
- ネットワーク：[RFC 4632](https://www.rfc-editor.org/rfc/rfc4632.html)のプレフィックス表記と照合し、/26の全ホスト範囲を列挙。HTTPは[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)の304・405を確認した。
- 稼働率：[Google SREの可用性表](https://sre.google/sre-book/availability-table/)で稼働時間の比率としての意味を確認し、問題文で指定した数理モデルを独立に検算した。冗長構成は独立故障・完全な切替を仮定する。実システムの可用性保証とは区別する。

## 出題と履歴

起動時に教材だけを追加登録する。既存の問題・セッション・解答履歴は書き換えない。復習専用・新規分野専用のほか、通常演習・短期集中・関連概念の復習でも各方式の条件に従って利用する。従来のA-1「分野別の細かな補強」の156問とは別の追加教材であり、通常・短期集中では従来のAI問題20%上限が適用される。

`server/focused.test.ts`で教材検証、ID・本文・選択肢の重複、正答と選択肢説明の対応、数値・確率・入力網羅率の独立検算、選抜条件、SQLite保存・再開・問題数維持を確認する。
