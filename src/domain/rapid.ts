import { isFresh, latestGroups, relatedProgress, reviewIndex } from './review.ts';
import type { Outcome, Section, TrainingQuestion } from './training.ts';

export const rapidCollection = 'rapid-knowledge';
export type LearningArea = 'technology' | 'management' | 'strategy' | 'network' | 'security' | 'other';
export interface LearningProfile { area: LearningArea; concept: string; occurrences: number }
const hour = 3600000;

export function learningArea(q: TrainingQuestion): LearningArea {
  if (q.learning) return q.learning.area;
  if (q.section === 'A-2') return /セキュリティ|暗号|認証/.test(q.topic) ? 'security' : /ネットワーク|プロトコル|通信/.test(q.topic) ? 'network' : 'other';
  if (/プロジェクト|サービス|監査/.test(q.topic)) return 'management';
  return /戦略|企業|会計|法務|調達|ビジネス/.test(q.topic) ? 'strategy' : 'technology';
}
const eligibleBank = (bank: TrainingQuestion[], section: Section) => {
  const held = new Set(bank.filter(q => q.heldOut).map(q => q.groupId));
  return bank.filter(q => q.section === section && q.review.status === 'verified' && !q.heldOut && !held.has(q.groupId));
};
export function rapidStatus(bank: TrainingQuestion[], history: Outcome[], section: Section, now = Date.now()) {
  const candidates = eligibleBank(bank, section); const index = reviewIndex(history, section);
  const fresh = candidates.filter(q => isFresh(q, history));
  const due = [...index.values()].filter(s => Date.parse(s.dueAt) <= now);
  return { section, available: new Set(candidates.map(q => q.groupId)).size,
    unseen: new Set(fresh.map(q => q.groupId)).size, reviewDue: due.length,
    reviewReady: due.filter(s => fresh.some(q => relatedProgress(q, index).some(p => p.concept === s.concept))).length };
}

/** A learning exercise: mostly new material, spaced review, weighted breadth and family deduplication. */
export function selectRapid(bank: TrainingQuestion[], history: Outcome[], section: Section, count: number, now = Date.now()) {
  const latest = latestGroups(history, section); const index = reviewIndex(history, section);
  const pool = eligibleBank(bank, section).filter(q => isFresh(q, history));
  const related = (q: TrainingQuestion) => relatedProgress(q, index);
  const due = (q: TrainingQuestion) => related(q).some(s => Date.parse(s.dueAt) <= now);
  const weights: Partial<Record<LearningArea, number>> = section === 'A-1'
    ? { technology: 17, management: 5, strategy: 8 } : { network: 15, security: 6, other: 4 };
  const total = section === 'A-1' ? 30 : 25;
  const areas = Object.keys(weights) as LearningArea[];
  const quotas = Object.fromEntries(areas.map(a => [a, Math.floor(count * weights[a]! / total)])) as Record<LearningArea, number>;
  const remainderOrder = [...areas].sort((a, b) => (count * weights[b]! / total) % 1 - (count * weights[a]! / total) % 1);
  const remaining = count - areas.reduce((n, a) => n + quotas[a], 0);
  for (let i = 0; i < remaining; i++) quotas[remainderOrder[i]]++;
  const selected: TrainingQuestion[] = []; const reasons: Record<string, string> = {};
  const used = new Set<string>(); const areaCounts = new Map<LearningArea, number>();
  const topicCounts = new Map<string, number>(); const concepts = new Set<string>();
  const topicAttempts = new Map<string, number>();
  for (const r of latest.values()) topicAttempts.set(r.question.topic, (topicAttempts.get(r.question.topic) ?? 0) + 1);
  const aiLimit = Math.floor(count / 5);
  const concept = (q: TrainingQuestion) => q.learning?.concept ?? q.tags[0] ?? q.groupId;
  const score = (q: TrainingQuestion) => {
    const previous = related(q); const r = previous[0]?.last; const area = learningArea(q);
    const gap = (quotas[area] ?? 0) - (areaCounts.get(area) ?? 0);
    const risk = Math.max(0, ...previous.map(s => s.risk));
    const explained = !q.explanation.includes('詳しい解説・分野分類は未追加');
    // A-1 security is the largest individual field in the analysis; retain it in short sets too.
    const focus = (item: TrainingQuestion) => /セキュリティ/.test(item.topic) ? 'security' : /ネットワーク/.test(item.topic) ? 'network' : '';
    const focusWeight = section === 'A-1' ? focus(q) === 'security' ? 25 : focus(q) === 'network' ? 12 : 0 : 0;
    const focusBonus = selected.some(item => focus(item) === focus(q)) ? 0 : focusWeight;
    return gap * 1000 + 100 / (1 + (topicCounts.get(q.topic) ?? 0)) + 30 / (1 + (topicAttempts.get(q.topic) ?? 0))
      + risk * 8 + Math.min(12, Math.log2(Math.max(1, q.learning?.occurrences ?? 1)) * 4)
      + focusBonus + (explained ? 15 : 0) - (concepts.has(concept(q)) ? 100 : 0)
      + (r ? Math.min(10, Math.max(0, (now - Date.parse(r.at)) / (72 * hour))) : 0);
  };
  const take = (items: TrainingQuestion[], limit: number, reason: string) => {
    for (let n = 0; n < limit && selected.length < count; n++) {
      const allowed = items.filter(q => !used.has(q.groupId) && (q.origin !== 'ai' || selected.filter(x => x.origin === 'ai').length < aiLimit));
      allowed.sort((a, b) => score(b) - score(a) || a.id.localeCompare(b.id));
      const q = allowed[0]; if (!q) break;
      selected.push(q); used.add(q.groupId); concepts.add(concept(q));
      const area = learningArea(q); areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);
      topicCounts.set(q.topic, (topicCounts.get(q.topic) ?? 0) + 1); reasons[q.id] = reason;
    }
  };
  const reviews = pool.filter(due);
  take(reviews.filter(q => related(q).some(s => s.risk > 0)), Math.floor(count / 5), '間隔を空けた誤答・迷いを別問題で復習');
  take(pool.filter(q => related(q).length === 0), count - selected.length, '未着手の知識を優先・頻出分野を広く確認');
  take(reviews, count - selected.length, '間隔を空けて別問題で定着を確認');
  take(pool, count - selected.length, '学習済み概念を新しい関連問題で確認');
  return { questions: selected, reasons, shortage: Math.max(0, count - selected.length) };
}
