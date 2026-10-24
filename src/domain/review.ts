import type { Outcome, Section, TrainingQuestion } from './training.ts';

// A family identifies interchangeable/reprinted questions; a concept connects different tasks.
export const conceptKeys = (q: TrainingQuestion): string[] => [...new Set(q.reviewConcepts?.length
  ? q.reviewConcepts : q.tags.length ? q.tags : [q.learning?.concept ?? q.groupId])];
export const reviewCollection = 'concept-review';
const hour = 3600000;
export const riskOf = (r: Outcome) => r.answer.confidence === 'unknown' ? 4
  : !r.correct ? r.answer.confidence === 'sure' ? 5 : 3 : r.answer.confidence !== 'sure' ? 1 : 0;
export function latestGroups(history: Outcome[], section: Section) {
  const latest = new Map<string, Outcome>();
  for (const r of history) if (r.question.section === section && r.question.review.status === 'verified' && !r.question.heldOut) {
    const previous = latest.get(r.question.groupId);
    if (!previous || r.at >= previous.at) latest.set(r.question.groupId, r);
  }
  return latest;
}
export function conceptProgress(history: Outcome[], section: Section) {
  const grouped = new Map<string, Outcome[]>();
  for (const r of history) if (r.question.section === section && r.question.review.status === 'verified' && !r.question.heldOut) {
    for (const key of conceptKeys(r.question)) { const rows = grouped.get(key) ?? []; rows.push(r); grouped.set(key, rows); }
  }
  return [...grouped].map(([concept, input]) => {
    const rows = [...input].sort((a, b) => a.at.localeCompare(b.at)); const last = rows.at(-1)!;
    const groups = latestGroups(rows, section);
    // Same-question corrections never establish transfer. Require distinct families on distinct UTC days,
    // after the latest error or uncertain answer. This is evidence for a candidate, not a mastery claim.
    const lastWeak = rows.filter(r => riskOf(r) > 0).at(-1)?.at ?? '';
    const sure = rows.filter(r => r.at > lastWeak && r.correct && r.answer.confidence === 'sure');
    const transfer = sure.some(a => sure.some(b => a.question.groupId !== b.question.groupId && a.at.slice(0, 10) !== b.at.slice(0, 10)));
    const risk = riskOf(last);
    const status = last.answer.confidence === 'unknown' ? '基礎から確認' : !last.correct ? '誤答の補強'
      : last.answer.confidence !== 'sure' ? '正解だが不安定' : transfer ? '定着候補' : '別問題で確認';
    return { section, concept, attempts: rows.length, unique: groups.size, correct: rows.filter(r => r.correct).length,
      unknown: rows.filter(r => r.answer.confidence === 'unknown').length, latestCorrect: last.correct,
      latestConfidence: last.answer.confidence, lastAt: last.at, lastQuestionId: last.question.id,
      status, risk, dueAt: new Date(Date.parse(last.at) + (risk ? 6 : 72) * hour).toISOString(),
      transfer, last };
  }).sort((a, b) => b.risk - a.risk || a.lastAt.localeCompare(b.lastAt) || a.concept.localeCompare(b.concept, 'ja'));
}
export function reviewIndex(history: Outcome[], section: Section) {
  return new Map(conceptProgress(history, section).map(s => [s.concept, s]));
}
export function relatedProgress(q: TrainingQuestion, index: ReturnType<typeof reviewIndex>) {
  return conceptKeys(q).flatMap(k => { const s = index.get(k); return s ? [s] : []; });
}
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const contentKey = (q: TrainingQuestion) => q.source.image ? `image:${q.source.image}`
  : JSON.stringify([normalize(q.prompt), q.choices.map(normalize).sort()]);
export const questionIdentityKeys = (q: TrainingQuestion) => [`${q.section}:id:${q.id}`, `${q.section}:group:${q.groupId}`, `${q.section}:content:${contentKey(q)}`];
export const sameQuestion = (a: TrainingQuestion, b: TrainingQuestion) => a.section === b.section
  && (a.id === b.id || a.groupId === b.groupId || contentKey(a) === contentKey(b));
export function isFresh(q: TrainingQuestion, history: Outcome[]) {
  // Exclude other versions and family reprints, including historical unverified content already seen.
  return !history.some(r => sameQuestion(r.question, q));
}
export function reviewAnalysis(bank: TrainingQuestion[], history: Outcome[], section: Section, now = Date.now()) {
  const rows = history.filter(r => r.question.section === section && r.question.review.status === 'verified' && !r.question.heldOut);
  const latest = latestGroups(rows, section);
  const held = new Set(bank.filter(q => q.heldOut).map(q => q.groupId));
  const fresh = bank.filter(q => q.section === section && q.review.status === 'verified' && !q.heldOut && !held.has(q.groupId) && isFresh(q, history));
  const concepts = conceptProgress(rows, section).map(({ last: _last, ...s }) => ({ ...s,
    due: Date.parse(s.dueAt) <= now,
    alternatives: new Set(fresh.filter(q => conceptKeys(q).includes(s.concept)).map(q => q.groupId)).size,
  }));
  const first = new Map<string, Outcome>();
  for (const r of [...rows].sort((a, b) => a.at.localeCompare(b.at))) if (!first.has(r.question.groupId)) first.set(r.question.groupId, r);
  return { section, attempts: rows.length, unique: latest.size, repeated: rows.length - latest.size,
    correct: rows.filter(r => r.correct).length, sureCorrect: rows.filter(r => r.correct && r.answer.confidence === 'sure').length,
    unknown: rows.filter(r => r.answer.confidence === 'unknown').length,
    skipped: rows.filter(r => r.answer.choice === null && r.answer.confidence === null).length,
    firstCorrect: [...first.values()].filter(r => r.correct).length,
    latestCorrect: [...latest.values()].filter(r => r.correct).length,
    concepts, missingAlternatives: concepts.filter(c => c.alternatives === 0 && c.status !== '定着候補').length };
}
