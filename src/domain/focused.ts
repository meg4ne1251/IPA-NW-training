import { a1Attempted, a1Coverage, a1SeenUnits, a1Unit } from './a1-coverage.ts';
import { conceptKeys, latestGroups, questionIdentityKeys, relatedProgress, reviewIndex, riskOf } from './review.ts';
import type { Outcome, Section, TrainingQuestion } from './training.ts';

export const reviewOnlyCollection = 'review-only';
export const newOnlyCollection = 'new-fields-only';
export type FocusedCollection = typeof reviewOnlyCollection | typeof newOnlyCollection;
const hour = 3600000;
const normalize = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();
const knowledgeKeys = (q: TrainingQuestion) => [...conceptKeys(q), ...(q.learning ? [q.learning.concept] : [])].map(normalize);

/** Strict pools: neither mode fills a shortage with material from the other mode. */
export function focusedPool(bank: TrainingQuestion[], history: Outcome[], section: Section, collection: FocusedCollection, now = Date.now()) {
  const held = new Set(bank.filter(q => q.heldOut).map(q => q.groupId));
  const eligible = bank.filter(q => q.section === section && q.review.status === 'verified' && !q.heldOut && !held.has(q.groupId));
  const exposure = section === 'A-1' && collection === newOnlyCollection ? history.filter(a1Attempted) : history;
  const seenIdentities = new Set(exposure.flatMap(r => questionIdentityKeys(r.question)));
  const freshQuestion = (q: TrainingQuestion) => !questionIdentityKeys(q).some(key => seenIdentities.has(key));
  let ordered: { question: TrainingQuestion; reason: string }[];
  if (collection === newOnlyCollection) {
    // Even retired/unverified historical questions count as prior exposure for new-only practice.
    const seen = exposure.filter(r => r.question.section === section);
    const seenUnits = section === 'A-1' ? a1SeenUnits(bank, seen) : new Set<string>();
    const topics = new Set(seen.map(r => normalize(r.question.topic)));
    const concepts = new Set(seen.flatMap(r => knowledgeKeys(r.question)));
    const fresh = eligible.filter(q => freshQuestion(q) && (section === 'A-1'
      ? !!a1Unit(q) && !seenUnits.has(a1Unit(q)!.id)
      : !topics.has(normalize(q.topic)) && !knowledgeKeys(q).some(k => concepts.has(k))));
    const queues = new Map<string, TrainingQuestion[]>();
    for (const q of fresh.sort((a, b) => a.id.localeCompare(b.id))) {
      const field = section === 'A-1' ? a1Unit(q)!.field : q.topic;
      const items = queues.get(field) ?? []; items.push(q); queues.set(field, items);
    }
    const breadth: TrainingQuestion[] = [];
    for (let i = 0; breadth.length < fresh.length; i++) for (const items of queues.values()) if (items[i]) breadth.push(items[i]);
    // Prefer one question per new unit before filling with other questions from those units.
    const first: TrainingQuestion[] = []; const rest: TrainingQuestion[] = []; const usedUnits = new Set<string>();
    for (const q of breadth) {
      const unit = section === 'A-1' ? a1Unit(q)!.id : q.id;
      (usedUnits.has(unit) ? rest : first).push(q); usedUnits.add(unit);
    }
    ordered = [...first, ...rest].map(question => ({ question, reason: section === 'A-1'
      ? '未着手の論点を確認（既習分野内の未着手論点も対象）' : '既習分野・概念・同題や類題を除外した未回答分野' }));
  } else {
    const latest = latestGroups(history, section); const index = reviewIndex(history, section);
    const candidates = eligible.flatMap(question => {
      const previous = latest.get(question.groupId);
      // Repeating an answered question is intentional only in this explicit review mode.
      const targets = previous ? [previous] : freshQuestion(question)
        ? relatedProgress(question, index).map(s => s.last) : [];
      const ready = targets.filter(r => riskOf(r) > 0 || Date.parse(r.at) + 72 * hour <= now)
        .sort((a, b) => riskOf(b) - riskOf(a) || a.at.localeCompare(b.at));
      const target = ready[0]; if (!target) return [];
      const risk = riskOf(target);
      const direct = previous?.question.id === question.id;
      const reason = previous ? risk > 0 ? '直近の誤答・迷い・わからないを再確認' : '確信正解から72時間以上たった問題を再確認'
        : risk > 0 ? '苦手な既習概念を別の関連問題で復習' : '復習時期に来た既習概念を別問題で確認';
      return [{ question, reason, risk, direct, at: target.at }];
    });
    ordered = candidates.sort((a, b) => b.risk - a.risk || Number(b.direct) - Number(a.direct)
      || a.at.localeCompare(b.at) || a.question.id.localeCompare(b.question.id));
  }
  const unique: typeof ordered = [];
  const usedIdentities = new Set<string>();
  for (const item of ordered) {
    const keys = questionIdentityKeys(item.question);
    if (keys.some(key => usedIdentities.has(key))) continue;
    unique.push(item); keys.forEach(key => usedIdentities.add(key));
  }
  return unique;
}

export function selectFocused(bank: TrainingQuestion[], history: Outcome[], section: Section, collection: FocusedCollection, count: number, now = Date.now()) {
  const pool = focusedPool(bank, history, section, collection, now);
  const selected = pool.slice(0, count);
  return { questions: selected.map(item => item.question), reasons: Object.fromEntries(selected.map(item => [item.question.id, item.reason])),
    available: pool.length, shortage: Math.max(0, count - selected.length) };
}

export function focusedStatus(bank: TrainingQuestion[], history: Outcome[], section: Section, now = Date.now()) {
  return { section, reviewAvailable: focusedPool(bank, history, section, reviewOnlyCollection, now).length,
    newAvailable: focusedPool(bank, history, section, newOnlyCollection, now).length,
    coverage: section === 'A-1' ? a1Coverage(bank, history) : undefined };
}
