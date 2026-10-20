# 復習用の関連問題と概念の対応

2026-10-20追加。`review-variants.json` に36問の独自問題を収録し、既存の補強120問と合わせて24分野156問で利用する。公式過去問の画像・本文・正答と、保存済みの解答履歴は書き換えない。

追加範囲は平均電流と電池持続時間、論理回路、MTTRの逆算、並列構成の稼働率、固定費と目標利益、平均CPI、LRUの参照列、外部キーの削除制約、正規化、ハッシュの衝突、PPM、戦略マップ、SOA、プロビジョニング、スクラム、スコープ管理、RTO/RLO、CRYPTREC、EVM、技術の事業化、MES、工程短縮、設計レビュー、コード設計、SBOM、エッジ処理、プログラムマネジメント、分離レベル、動的計画法、マシンビジョン、二分法、投資回収期間、アクセシビリティ、SQLインジェクション、映像帯域。

## 問題の作り方と確認

用語の単なる言い換えや選択肢の並べ替えにせず、条件、数値、問う方向、適用場面を変えた。例えば待機時間を求める原題に対して電池持続時間を計算する、利益差から変動費を求める原題に対して固定費や目標売上を求める、定義を答える原題に対して具体的な処理や設計を判断する。

全36問に四つの異なる選択肢、正答理由、各選択肢の解説、根拠URL、確認方法を記録した。AIによる資料照合であり、人による監修ではない。電流・会計・CPU・稼働率は別式、LRUと論理回路は列挙・シミュレーション、外部キーと正規化はSQLiteで独立に確認した（`server/review.test.ts`）。

主な参照資料：

- [IPA 応用情報シラバス](https://www.ipa.go.jp/shiken/syllabus/omgdg50000005kq5-att/syllabus_ap_ver7_2.pdf)
- [Cornell CS3410: Pipelining & Performance](https://www.cs.cornell.edu/courses/cs3410/2026sp/notes/pipelining.html)
- [OSTEP: Beyond Physical Memory — Policies](https://pages.cs.wisc.edu/~remzi/OSTEP/vm-beyondphys-policy.pdf)
- [PostgreSQL 17: Constraints](https://www.postgresql.org/docs/17/ddl-constraints.html)
- [OpenStax: Break-Even Point](https://openstax.org/books/principles-managerial-accounting/pages/3-2-calculate-a-break-even-point-in-units-and-dollars)
- [BCG: Growth Share Matrix](https://www.bcg.com/about/overview/our-history/growth-share-matrix)
- [HBS: Mapping Your Corporate Strategy](https://www.library.hbs.edu/working-knowledge/mapping-your-corporate-strategy)
- [OASIS SOA Reference Model](https://docs.oasis-open.org/soa-rm/v1.0/soa-rm.html)
- [Scrum Guide](https://scrumguides.org/scrum-guide.html)
- [IPA 事業継続事例](https://www.ipa.go.jp/archive/files/000004636.pdf)
- [NTIA: SBOM](https://www.ntia.gov/page/software-bill-materials)
- [ISA-95](https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard)
- [NIST: Edge–Cloud Continuum](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=934390)
- [PostgreSQL 17: Transaction Isolation](https://www.postgresql.org/docs/17/transaction-iso.html)
- [OWASP: SQL Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html)
- [W3C: Accessibility Principles](https://www.w3.org/WAI/fundamentals/accessibility-principles/)
- [CRYPTREC暗号リスト](https://www.cryptrec.go.jp/list.html)

## 問題群と復習概念

`groupId` は再録などの同一問題群で、既出判定に使用する。`reviewConcepts` は異なる問題群を関連付ける学習概念である。同じ分野に属するだけでは関連問題として扱わない。

`review-concepts.json` は既存のタグと調査済みの論点名を概念へ対応させる規則。問題文・解説への全文検索で関連を推測しない。明示的な対応がない教材は元のタグ（タグがなければ論点又は問題群）に限定する。対応には保守的な範囲を使うため、同分野の全教材を網羅した意味分類ではない。新しいAI類題では `reviewConcepts` を明示する。

「別問題の候補」は現在の収録範囲で未着手・検証済み・模試用でない問題群の数。練習でのAI比率、分野フィルター、セット内の重複抑制により、実際の出題件数は少なくなる場合がある。候補がない概念はAI出力へ不足として含める。
