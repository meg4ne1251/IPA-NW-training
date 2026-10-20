import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TrainingQuestion } from '../src/domain/training.ts';
const rules = (JSON.parse(readFileSync(resolve('materials/review-concepts.json'), 'utf8')) as { concept: string; pattern: string }[])
  .map(rule => ({ concept: rule.concept, pattern: new RegExp(rule.pattern, 'i') }));
/** Match reviewed concept labels only, never broad topics or answer/explanation text. */
export function withReviewConcepts(q: TrainingQuestion): TrainingQuestion {
  if (q.reviewConcepts?.length) return q;
  const labels = [...q.tags, q.learning?.concept ?? ''];
  const matched = rules.filter(rule => labels.some(label => rule.pattern.test(label))).map(rule => rule.concept);
  return matched.length ? { ...q, reviewConcepts: matched } : q;
}
