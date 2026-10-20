import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TrainingQuestion } from '../src/domain/training.ts';

interface OfficialExplanation {
  version: number; correctIndex: number; sourceUrl: string; sourceNumber: number;
  explanation: string; choiceExplanations: string[]; references: string[];
}
const data = JSON.parse(readFileSync(resolve('materials/official-explanations.json'), 'utf8')) as {
  authoredAt: string; questions: Record<string, OfficialExplanation>;
};
const method = '原本画像・公式正答を照合し、正答理由、全選択肢、関連知識をAIが独自に解説。人による監修ではありません。';

/** Match the exact original, never a related family; enrich reads without rewriting learning records. */
export function withOfficialExplanation(q: TrainingQuestion): TrainingQuestion {
  if (q.origin !== 'past') return q;
  const entry = data.questions[q.id];
  if (!entry || q.version !== entry.version || q.correctIndex !== entry.correctIndex
    || q.source.url !== entry.sourceUrl || q.source.number !== entry.sourceNumber) return q;
  return { ...q, explanation: entry.explanation, choiceExplanations: entry.choiceExplanations,
    review: { ...q.review, method, reviewer: 'AIによる解説追加', at: `${data.authoredAt}T00:00:00Z`,
      references: [...new Set([q.source.url, q.source.answerUrl, ...q.review.references, ...entry.references].filter((url): url is string => !!url))] } };
}
