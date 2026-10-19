import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TrainingQuestion } from '../src/domain/training.ts';
import type { LearningProfile } from '../src/domain/rapid.ts';
interface Priority extends LearningProfile { topic: string; familyId: string; source: string }
const data = JSON.parse(readFileSync(resolve('materials/learning-priorities.json'), 'utf8')) as { questions: Record<string, Priority> };

/** Enrich reads, including historical outcomes; keep answer records and question snapshots intact. */
export function withLearningPriority(q: TrainingQuestion): TrainingQuestion {
  if (q.origin !== 'past') return q;
  const priority = data.questions[q.id] ?? data.questions[q.groupId];
  if (!priority) return q;
  return { ...q, topic: q.topic === '未分類' ? priority.topic : q.topic,
    tags: q.tags.length ? q.tags : [priority.concept], groupId: priority.familyId,
    learning: { area: priority.area, concept: priority.concept, occurrences: priority.occurrences } };
}
