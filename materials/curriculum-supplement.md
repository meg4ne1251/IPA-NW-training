# 解答履歴に基づくA-1の追加補強教材

2026-10-25に、既存の別問題の不足を補う39問を追加した。既存27主論点へ対応付け、論点総数181は維持する。収録数はA-1が777問、A-2が255問、合計1032問。個人の解答履歴・論点別集計はGit管理外の`data/analysis/`へ保存する。

| 主論点 | 確認する内容 | 確認に使った資料・方法 |
| --- | --- | --- |
| 省電力と平均電流 | 時間加重平均、電池容量から動作比率の逆算 | [BIPMのSI単位](https://www.bipm.org/en/measurement-units/si-base-units)。問題の理想化した条件で、1秒単位の和と動作時間比率の整数列挙により独立検算 |
| 工程短縮 | 短縮後の最長経路の変化、共通作業と複数経路の費用比較 | [PMIの工程短縮の解説](https://www.pmi.org/learning/library/generating-crash-analysis-calculating-costs-6224)。短縮する／しないの全8組合せを列挙 |
| ストアドプロシージャ | 保存場所・明示呼出しとトリガーの違い、CALL | PostgreSQL公式の[CREATE PROCEDURE](https://www.postgresql.org/docs/current/sql-createprocedure.html)・[CALL](https://www.postgresql.org/docs/current/sql-call.html) |
| 暗号学的ハッシュ | ビット／16進桁数、照合値の真正性と鍵なしハッシュの限界 | [Python hashlib](https://docs.python.org/3/library/hashlib.html)、[FIPS 180-4](https://csrc.nist.gov/pubs/fips/180-4/upd1/final)、[RFC 2104](https://www.rfc-editor.org/rfc/rfc2104.html)。1バイトと1MiBのSHA-256を実計算 |
| キュー | enqueue/dequeueの追跡、幅優先探索 | [Python deque](https://docs.python.org/3/library/collections.html#collections.deque)。キュー操作と木の探索を実行 |
| RAID | RAID 5の容量、RAID 10の故障位置依存性 | [LinuxカーネルのRAID資料](https://docs.kernel.org/admin-guide/md.html)。明示したミラー構成の故障組合せを列挙 |
| SQLの結合 | 左外部結合の複数一致、結合後のWHEREとNULL | [PostgreSQLの表式](https://www.postgresql.org/docs/current/queries-table-expressions.html)。独自データをSQLiteへ投入し、行数・抽出結果を実行確認 |
| セッションの保護 | セッション固定攻撃とID更新、Cookie属性の役割 | [OWASP Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)。認証時のID更新とHttpOnly・Secure・SameSiteの機能を照合 |
| DNSキャッシュポイズニング | ID・ポートの予測困難化、応答の問合せ名等の一致確認 | [RFC 5452](https://www.rfc-editor.org/rfc/rfc5452.html)の応答照合・ポート選択と照合 |
| シングルサインオン | IdP/SPの役割、署名に加え対象・期限の検証 | [OWASP SAML Security](https://cheatsheetseries.owasp.org/cheatsheets/SAML_Security_Cheat_Sheet.html) |
| デジタルフォレンジックス | 原本保護・取扱記録、許可された収集時の揮発性の順序 | [RFC 3227](https://www.rfc-editor.org/rfc/rfc3227.html)、[NIST SP 800-86](https://csrc.nist.gov/pubs/sp/800/86/final)。安全・封じ込めと収集許可を設問条件で明示 |
| スタックと後置記法 | 二項演算の左右、括弧の入れ子の照合 | [Pythonのスタック](https://docs.python.org/3/tutorial/datastructures.html#using-lists-as-stacks)。後置式を実行し全選択肢の括弧列を検査 |

| 追加の主論点 | 確認する内容・資料 |
| --- | --- |
| コンカレントエンジニアリング | 初期からの部門横断・並行検討。[ESAの定義](https://www.esa.int/Enabling_Support/Space_Engineering_Technology/CDF/What_is_concurrent_engineering) |
| RPA | ルールのある画面操作の自動化。[Microsoftの公式資料](https://learn.microsoft.com/en-us/power-automate/desktop-flows/introduction) |
| リーダーシップ | 自己管理を支える目標共有と障害除去。[Scrum Guide](https://scrumguides.org/scrum-guide.html)。設問でチームの経験・自律性を支える方針を明示 |
| モバイル通信 | 用途に応じた論理ネットワーク。[ITU-T Y.3159](https://www.itu.int/epublications/es/publication/itu-t-y-3159-2023-10-framework-for-classifying-network-slice-level-in-future-networks-including-imt-2020/en) |
| アグリゲーションサービス | 複数提供元の情報集約。[Plaidの公式API資料](https://plaid.com/docs/)における金融口座情報連携の例 |
| UMLアクティビティ図 | フォーク・ジョインによる並行と同期。[Enterprise Architectの公式資料](https://sparxsystems.com/enterprise_architect_user_guide/17.0/model_simulation/bpmn_simulation_comparison.html) |
| BIと情報活用 | 分析による意思決定の支援。[IBMの解説](https://www.ibm.com/think/topics/business-intelligence) |
| ベンチマーキング | 優れた他組織のプロセス等と比較し改善。[ASQ](https://asq.org/quality-resources/benchmarking) |
| SoE | 利用者との接点とSoRとの連携。[IBM Redbooks](https://www.redbooks.ibm.com/abstracts/tips1218.html) |
| 労働法 | 特例等を除く法定時間の原則。[厚生労働省のQ&A](https://www.check-roudou.mhlw.go.jp/qa/roudousya/roudoujikan/q4.html)を2026-10-25に照合 |
| 量子コンピュータ | 計算基底での1回の測定結果。[IBM Quantum](https://quantum.cloud.ibm.com/docs/en/guides/measure-qubits) |
| 電子署名法 | 成立の真正の推定と内容の真実性の違い。[デジタル庁の法概要](https://www.digital.go.jp/policies/digitalsign/digitalsign_law)と[推定効の説明](https://www.digital.go.jp/assets/contents/node/basic_page/field_ref_resources/35c2afb2-01d8-49b4-b0a8-2cc656d1733e/20211213_meeting_trust_dx_06.pdf)を2026-10-25に照合 |
| TCO | 導入・運用・保守・廃棄費。[USPSの調達指針](https://about.usps.com/manuals/spp102019/html/spp1_026.htm)。36か月分の費用加算でも検算 |
| リーンスタートアップ | 最小限の実験と構築・計測・学習。[Eric Riesの方法論](https://theleanstartup.com/principles) |
| XBRL | 財務・事業報告の意味付けと機械処理。[XBRL Indiaの説明](https://in.xbrl.org/about-us/what-is-xbrl/) |

全問が独自の設問で、公式過去問の本文・選択肢を転記していない。正答の一意性、異なる4選択肢、正答理由、各選択肢の説明を確認し、正答位置を各9～10問に分散した。確認者はCodex（AIによる資料照合・独立検算）であり、人による監修ではない。単なる同じ設問の数値変更に偏らないよう、各論点で問う方向を変えた。

起動時に新IDの教材だけを追加登録する。既存セッション・解答・途中位置は変更しない。おすすめ演習と分野別補強ではAI問題の割合を制限せず、通常演習・短期集中の従来の20%上限は維持する。新規の補強問題があるだけでは、論点の状態は未着手に戻らない。

検証は`server/curriculum.test.ts`と`server/a1-coverage.test.ts`。資料URLは用語・仕組みの根拠であり、独自の例題の公式解答を意味しない。
