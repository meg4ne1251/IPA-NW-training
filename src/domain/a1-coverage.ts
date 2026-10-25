import catalogue from '../../materials/a1-learning-units.json' with { type: 'json' };
import { conceptKeys, questionIdentityKeys, riskOf, sameQuestion } from './review.ts';
import type { Outcome, TrainingQuestion } from './training.ts';

interface LearningUnit { id: string; label: string; field: string }
export type UnitStatus = 'unseen' | 'review' | 'confirming' | 'candidate';
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const byQuestion = new Map<string, LearningUnit>(catalogue.units.flatMap(unit => unit.questionIds.map(id => [id, unit] as const)));
// Only exact, curated names may classify later imports. Prose titles are not new learning units.
const byLabel = new Map(catalogue.units.flatMap(unit => [unit.label, ...unit.aliases].map(label => [normalize(label), unit] as const)));

export function a1Unit(q: TrainingQuestion): LearningUnit | undefined {
  if (q.section !== 'A-1') return;
  const assigned = byQuestion.get(q.id) ?? byQuestion.get(q.groupId);
  if (assigned) return assigned;
  const labels = [...conceptKeys(q), q.learning?.concept ?? ''].filter(Boolean);
  for (const label of labels) {
    const unit = byLabel.get(normalize(label)); if (unit) return unit;
  }
  // Explicit concept metadata supports user-created/imported material; an ID or broad field does not.
  const label = q.reviewConcepts?.[0];
  if (label) return { id: `custom:${normalize(label)}`, label, field: q.topic };
}

/** A blank answer added by whole-set submission is not evidence of studying a concept. */
export const a1Attempted = (r: Outcome) => r.question.section === 'A-1'
  && (r.answer.choice !== null || r.answer.confidence !== null);

function historyUnitResolver(bank: TrainingQuestion[]) {
  const identities = new Map<string, LearningUnit>();
  for (const q of bank) {
    const unit = a1Unit(q); if (unit) for (const key of questionIdentityKeys(q)) identities.set(key, unit);
  }
  return (q: TrainingQuestion) => q.section !== 'A-1' ? undefined
    : byQuestion.get(q.id) ?? byQuestion.get(q.groupId)
      ?? questionIdentityKeys(q).map(k => identities.get(k)).find(Boolean) ?? a1Unit(q);
}

export function a1SeenUnits(bank: TrainingQuestion[], history: Outcome[]) {
  const seen = new Set<string>(); const resolveUnit = historyUnitResolver(bank);
  for (const r of history.filter(a1Attempted)) {
    const unit = resolveUnit(r.question); if (unit) seen.add(unit.id);
  }
  return seen;
}

export function a1Coverage(bank: TrainingQuestion[], history: Outcome[]) {
  const held = new Set(bank.filter(q => q.heldOut).map(q => q.groupId));
  const eligible = bank.filter(q => q.section === 'A-1' && q.review.status === 'verified' && !q.heldOut && !held.has(q.groupId));
  const units = new Map<string, LearningUnit>();
  const resolveUnit = historyUnitResolver(bank);
  for (const q of eligible) {
    const unit = a1Unit(q); if (!unit) continue;
    units.set(unit.id, unit);
  }
  const rows = history.filter(a1Attempted).sort((a, b) => a.at.localeCompare(b.at));
  const progress = [...units.values()].map(unit => {
    const attempts = rows.filter(r => resolveUnit(r.question)?.id === unit.id);
    const last = attempts.at(-1);
    // Exposure to retired/unverified material prevents 'unseen', but never proves mastery.
    const reliable = attempts.filter(r => r.question.review.status === 'verified' && !r.question.heldOut);
    const lastWeak = attempts.filter(r => riskOf(r) > 0).at(-1)?.at ?? '';
    const sure = reliable.filter(r => r.at > lastWeak && r.correct && r.answer.confidence === 'sure');
    const transfer = last?.question.review.status === 'verified' && !last.question.heldOut && sure.some(a => sure.some(b => !sameQuestion(a.question, b.question) && a.at.slice(0, 10) !== b.at.slice(0, 10)));
    const status: UnitStatus = !last ? 'unseen' : riskOf(last) > 0 ? 'review' : transfer ? 'candidate' : 'confirming';
    return { id: unit.id, label: unit.label, field: unit.field, status,
      attempts: attempts.length, risk: last ? riskOf(last) : 0, lastAt: last?.at ?? null };
  });
  const counts = (items: typeof progress) => ({ total: items.length,
    unseen: items.filter(u => u.status === 'unseen').length, review: items.filter(u => u.status === 'review').length,
    confirming: items.filter(u => u.status === 'confirming').length, candidate: items.filter(u => u.status === 'candidate').length });
  return { ...counts(progress), unclassified: eligible.filter(q => !a1Unit(q)).length,
    fields: [...new Set(progress.map(u => u.field))].map(field => ({ field, ...counts(progress.filter(u => u.field === field)) })),
    units: progress };
}
