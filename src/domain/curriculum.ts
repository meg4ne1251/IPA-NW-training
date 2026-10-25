import { a1Attempted, a1Coverage, a1Unit } from './a1-coverage.ts';
import { questionIdentityKeys } from './review.ts';
import type { Outcome, TrainingQuestion } from './training.ts';

export const curriculumCollection = 'a1-curriculum';
const hour = 3600000;
type Stage = 'review' | 'confirming' | 'unseen' | 'candidate';
const labels: Record<Stage, string> = { review: '弱点補強', confirming: '別日の定着確認', unseen: '未着手の論点', candidate: '間隔を空けた再確認' };

/** Use the same curated units and evidence as the coverage display, rather than broad topic matches. */
export function curriculumPool(bank: TrainingQuestion[], history: Outcome[], now = Date.now()) {
  const coverage = a1Coverage(bank, history);
  const progress = new Map(coverage.units.map(u => [u.id, u]));
  const attempted = history.filter(a1Attempted);
  const seen = new Set(attempted.flatMap(r => questionIdentityKeys(r.question)));
  const held = new Set(bank.filter(q => q.heldOut).map(q => q.groupId));
  const today = new Date(now).toISOString().slice(0, 10);
  const pool = bank.flatMap(question => {
    if (question.section !== 'A-1' || question.review.status !== 'verified' || question.heldOut || held.has(question.groupId)) return [];
    const unit = progress.get(a1Unit(question)?.id ?? ''); if (!unit) return [];
    const repeated = questionIdentityKeys(question).some(k => seen.has(k));
    const age = unit.lastAt ? now - Date.parse(unit.lastAt) : Infinity;
    // Fresh weak-point tasks teach immediately. Same-question recall needs spacing.
    if (repeated && (unit.status === 'unseen' || age < (unit.status === 'review' ? 6 : 72) * hour)) return [];
    if (unit.status === 'confirming' && (age < 6 * hour || unit.lastAt!.slice(0, 10) === today)) return [];
    if (unit.status === 'candidate' && age < 72 * hour) return [];
    return [{ question, unit, stage: unit.status, repeated,
      reason: `${labels[unit.status]}：${unit.label}（${repeated ? '別問題不足のため間隔を空けて再出題' : '未回答の別問題'}）` }];
  });
  return { coverage, pool };
}

export function selectCurriculum(bank: TrainingQuestion[], history: Outcome[], count: number, now = Date.now()) {
  const { pool } = curriculumPool(bank, history, now);
  const selected: typeof pool = []; const used = new Set<string>();
  const units = new Map<string, number>(); const fields = new Map<string, number>();
  const take = (stage: Stage | undefined, limit: number, repeated: boolean, diverse: boolean) => {
    for (let i = 0; i < limit && selected.length < count; i++) {
      const candidates = pool.filter(item => item.repeated === repeated && (!stage || item.stage === stage)
        && !questionIdentityKeys(item.question).some(k => used.has(k)) && (!diverse || !units.has(item.unit.id)));
      candidates.sort((a, b) => (units.get(a.unit.id) ?? 0) - (units.get(b.unit.id) ?? 0)
        || (fields.get(a.unit.field) ?? 0) - (fields.get(b.unit.field) ?? 0)
        || b.unit.risk - a.unit.risk
        || Number(!!b.question.choiceExplanations) - Number(!!a.question.choiceExplanations)
        || (a.unit.lastAt ?? '').localeCompare(b.unit.lastAt ?? '') || a.question.id.localeCompare(b.question.id));
      const item = candidates[0]; if (!item) break;
      selected.push(item); questionIdentityKeys(item.question).forEach(k => used.add(k));
      units.set(item.unit.id, (units.get(item.unit.id) ?? 0) + 1);
      fields.set(item.unit.field, (fields.get(item.unit.field) ?? 0) + 1);
    }
  };
  // Targets are adjusted to actual eligible material; never backfill with a recently secure answer.
  for (const [stage, quota] of [['review', Math.floor(count * .6)], ['confirming', Math.floor(count * .3)], ['unseen', Math.ceil(count * .1)]] as const) take(stage, quota, false, true);
  for (const stage of ['review', 'confirming', 'unseen', 'candidate'] as const) take(stage, count, false, true);
  // Breadth comes before a second task from the same unit. Exhaust fresh tasks before recall.
  for (const stage of ['review', 'confirming', 'unseen', 'candidate'] as const) take(stage, count, false, false);
  for (const stage of ['review', 'confirming', 'candidate'] as const) take(stage, count, true, true);
  for (const stage of ['review', 'confirming', 'candidate'] as const) take(stage, count, true, false);
  return { questions: selected.map(i => i.question), reasons: Object.fromEntries(selected.map(i => [i.question.id, i.reason])),
    shortage: Math.max(0, count - selected.length),
    composition: Object.fromEntries((['review', 'confirming', 'unseen', 'candidate'] as const).map(s => [s, selected.filter(i => i.stage === s).length])) as Record<Stage, number>,
    repeated: selected.filter(i => i.repeated).length };
}

export function curriculumStatus(bank: TrainingQuestion[], history: Outcome[], now = Date.now()) {
  const { coverage, pool } = curriculumPool(bank, history, now);
  const freshUnits = new Set(pool.filter(i => !i.repeated).map(i => i.unit.id));
  const targets = coverage.units.filter(u => u.status === 'review').sort((a, b) => b.risk - a.risk || (a.lastAt ?? '').localeCompare(b.lastAt ?? ''));
  return { counts: { unseen: coverage.unseen, review: coverage.review, confirming: coverage.confirming, candidate: coverage.candidate },
    priorities: targets.slice(0, 8).map(u => ({ label: u.label, field: u.field, risk: u.risk })),
    missingAlternatives: targets.filter(u => !freshUnits.has(u.id)).map(u => ({ id: u.id, label: u.label })),
    plans: [10, 30].map(count => { const { questions, reasons: _reasons, ...plan } = selectCurriculum(bank, history, count, now); return { count, available: questions.length, ...plan }; }) };
}
