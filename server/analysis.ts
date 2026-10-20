import type { reviewAnalysis } from '../src/domain/review.ts';
type Analysis = ReturnType<typeof reviewAnalysis>;
export function analysisMarkdown(a: Analysis, at: string) {
  const percent = a.attempts ? (a.correct / a.attempts * 100).toFixed(1) : '0.0';
  return `# ${a.section} 学習履歴の分析\n\n集計時点：${at}\n\n` +
    `採点済み${a.attempts}解答・${a.unique}問題群、正解${a.correct}（${percent}%）。同じ問題群への反復は${a.repeated}解答。` +
    `初回正解は${a.firstCorrect}/${a.unique}、各問題群の直近正解は${a.latestCorrect}/${a.unique}。\n\n` +
    `自信のある正解${a.sureCorrect}解答、「わからない」${a.unknown}解答、未回答かつ自信度未入力${a.skipped}解答。` +
    `正解した「わからない」も基礎確認に含めます。未回答は採点上の不正解として件数に含みますが、知識不足とは断定しません。\n\n` +
    `| 概念 | 現在の確認点 | 解答数 / 問題群数 | 別問題の候補（問題群） |\n| --- | --- | --- | --- |\n` +
    a.concepts.map(c => `| ${c.concept} | ${c.status} | ${c.attempts} / ${c.unique} | ${c.alternatives} |`).join('\n') +
    `\n\n同一問題の再録と版違いは新しい演習から除外します。復習は6時間（誤答・迷い・わからない）または72時間（確信正解）を目安に別問題で確認します。` +
    `別日・異なる問題群で、最後の誤答・不安定な解答より後に確信正解を2回確認した場合のみ定着候補とします。` +
    `別問題がない概念は追加教材の対象です。少数の回答から分野全体の弱点や本試験得点を断定しません。\n`;
}
