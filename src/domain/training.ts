export type Section = 'A-1' | 'A-2';
export type Confidence = 'sure' | 'unsure' | 'guess' | 'unknown' | null;
export type ReviewStatus = 'draft' | 'verified' | 'disputed' | 'retired';
export interface TrainingQuestion {
  id: string; version: number; section: Section; topic: string; tags: string[];
  prompt: string; choices: [string, string, string, string]; correctIndex: number;
  explanation: string; choiceExplanations?: string[];
  origin: 'past' | 'ai' | 'original'; groupId: string; heldOut: boolean;
  source: { label: string; url: string; answerUrl?: string; image?: string; page?: number; number?: number };
  review: { status: ReviewStatus; method: string; reviewer: string; at: string; references: string[] };
}
export type PublicQuestion = Omit<TrainingQuestion, 'correctIndex' | 'explanation' | 'choiceExplanations'> &
  Partial<Pick<TrainingQuestion, 'correctIndex' | 'explanation' | 'choiceExplanations'>>;
export interface Answer { choice: number | null; confidence: Confidence; reason: string; seconds: number; flagged: boolean }
export interface Session {
  id: string; section: Section; mode: 'diagnostic' | 'practice' | 'exam' | 'imported'; title: string;
  status: 'active' | 'submitted'; revision: number; startedAt: string; submittedAt: string | null;
  deadline: string | null; currentIndex: number; questions: TrainingQuestion[]; answers: Record<string, Answer>;
  selectionReasons: Record<string, string>;
}
export type PublicSession = Omit<Session, 'questions'> & { questions: PublicQuestion[] };
export interface Outcome { question: TrainingQuestion; answer: Answer; correct: boolean; at: string; sessionId: string }
export interface TopicStat { section: Section; topic: string; attempts: number; unique: number; correct: number; uncertain: number; firstCorrect: number; firstCount: number }
export const labels = ['ア', 'イ', 'ウ', 'エ'];
export const blankAnswer = (): Answer => ({ choice: null, confidence: null, reason: '', seconds: 0, flagged: false });
export function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const text = (x: unknown, max = 12000): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
export function validateQuestion(input: unknown): TrainingQuestion {
  assert(input && typeof input === 'object', '問題の形式が不正です。');
  const q = input as TrainingQuestion;
  assert(text(q.id, 100) && /^[a-zA-Z0-9_-]+$/.test(q.id), '問題IDは英数字・ハイフン・下線で指定してください。');
  assert(Number.isInteger(q.version) && q.version > 0, '問題版が不正です。');
  assert(q.section === 'A-1' || q.section === 'A-2', '科目が不正です。');
  assert(text(q.topic, 100) && Array.isArray(q.tags) && q.tags.length <= 20 && q.tags.every(t => text(t, 100)), '分野・タグが不正です。');
  assert(text(q.prompt) && Array.isArray(q.choices) && q.choices.length === 4 && q.choices.every(c => text(c, 4000)) && new Set(q.choices.map(c => c.trim())).size === 4, '問題には異なる四つの選択肢が必要です。');
  assert(Number.isInteger(q.correctIndex) && q.correctIndex >= 0 && q.correctIndex < 4 && text(q.explanation), '正答・解説が不正です。');
  assert(q.choiceExplanations === undefined || (Array.isArray(q.choiceExplanations) && q.choiceExplanations.length === 4 && q.choiceExplanations.every(c => text(c))), '各選択肢の解説は4件必要です。');
  assert(['past', 'ai', 'original'].includes(q.origin) && text(q.groupId, 100) && typeof q.heldOut === 'boolean', '出自・グループが不正です。');
  const safeURL = (s: unknown) => typeof s === 'string' && /^https?:\/\//.test(s) && s.length < 2000;
  assert(q.source && text(q.source.label, 500) && safeURL(q.source.url), '出典URLが必要です。');
  assert(!q.source.answerUrl || safeURL(q.source.answerUrl), '解答URLが不正です。');
  assert(!q.source.image || /^\/assets\/[a-zA-Z0-9/_-]+\.png$/.test(q.source.image), '画像パスが不正です。');
  assert(q.review && ['draft', 'verified', 'disputed', 'retired'].includes(q.review.status), '検証状態が不正です。');
  assert(text(q.review.method, 3000) && text(q.review.reviewer, 100) && Number.isFinite(Date.parse(q.review.at)), '検証方法・確認者・日時が必要です。');
  assert(Array.isArray(q.review.references) && q.review.references.length > 0 && q.review.references.every(safeURL), '検証の根拠URLが必要です。');
  return q;
}
export function validateAnswers(input: unknown, questions: TrainingQuestion[]): Record<string, Answer> {
  assert(input && typeof input === 'object' && !Array.isArray(input), '回答の形式が不正です。');
  const source = input as Record<string, Answer>;
  assert(Object.keys(source).every(id => questions.some(q => q.id === id)), 'セットにない問題への回答です。');
  return Object.fromEntries(questions.map(q => {
    const a = source[q.id] ?? blankAnswer();
    assert(a && (a.choice === null || (Number.isInteger(a.choice) && a.choice >= 0 && a.choice < 4)), '選択した回答が不正です。');
    assert([null, 'sure', 'unsure', 'guess', 'unknown'].includes(a.confidence), '自信度が不正です。');
    assert(typeof a.reason === 'string' && a.reason.length <= 1000 && typeof a.flagged === 'boolean', '誤答理由・見直し状態が不正です。');
    assert(Number.isFinite(a.seconds) && a.seconds >= 0 && a.seconds <= 86400, '回答時間が不正です。');
    return [q.id, { choice: a.choice, confidence: a.confidence, reason: a.reason, seconds: a.seconds, flagged: a.flagged }];
  }));
}
export function outcomes(sessions: Session[]): Outcome[] {
  return sessions.filter(s => s.status === 'submitted').sort((a, b) => a.submittedAt!.localeCompare(b.submittedAt!))
    .flatMap(s => s.questions.map(question => {
      const answer = s.answers[question.id] ?? blankAnswer();
      return { question, answer, correct: answer.choice === question.correctIndex, at: s.submittedAt!, sessionId: s.id };
    }));
}
export function topicStats(rows: Outcome[]): TopicStat[] {
  const map = new Map<string, TopicStat>(); const seen = new Set<string>();
  for (const row of rows) {
    const q = row.question; if (q.review.status !== 'verified') continue;
    const key = `${q.section}:${q.topic}`; const first = !seen.has(`${q.section}:${q.groupId}`);
    const stat = map.get(key) ?? { section: q.section, topic: q.topic, attempts: 0, unique: 0, correct: 0, uncertain: 0, firstCorrect: 0, firstCount: 0 };
    stat.attempts++; stat.correct += +row.correct; stat.uncertain += +(row.correct && row.answer.confidence !== 'sure');
    if (first) { stat.unique++; stat.firstCount++; stat.firstCorrect += +row.correct; }
    seen.add(`${q.section}:${q.groupId}`); map.set(key, stat);
  }
  return [...map.values()].sort((a, b) => a.section.localeCompare(b.section) || a.correct / a.attempts - b.correct / b.attempts);
}
export function selectPractice(bank: TrainingQuestion[], history: Outcome[], section: Section, count: number, now = Date.now()) {
  const heldGroups = new Set(bank.filter(q => q.heldOut).map(q => q.groupId));
  const candidates = bank.filter(q => q.section === section && q.review.status === 'verified' && !q.heldOut && !heldGroups.has(q.groupId));
  const latest = new Map<string, Outcome>(); const concepts = new Map<string, number>();
  for (const row of history.filter(r => r.question.section === section && r.question.review.status === 'verified')) {
    latest.set(row.question.groupId, row);
  }
  for (const row of latest.values()) {
    const weight = !row.correct ? (row.answer.confidence === 'sure' ? 5 : 3) : row.answer.confidence !== 'sure' ? 1 : 0;
    for (const tag of row.question.tags) concepts.set(tag, Math.max(concepts.get(tag) ?? 0, weight));
  }
  const risk = (q: TrainingQuestion) => {
    const r = latest.get(q.groupId);
    const direct = r ? (!r.correct ? (r.answer.confidence === 'sure' ? 5 : 3) : r.answer.confidence !== 'sure' ? 1 : 0) : 0;
    return Math.max(direct, ...q.tags.map(t => concepts.get(t) ?? 0));
  };
  const due = (q: TrainingQuestion) => {
    const r = latest.get(q.groupId); return r && now - Date.parse(r.at) >= (r.correct && r.answer.confidence === 'sure' ? 3 : 1) * 86400000;
  };
  const sorted = [...candidates].sort((a, b) => risk(b) - risk(a) || b.id.localeCompare(a.id));
  const selected: TrainingQuestion[] = []; const reasons: Record<string, string> = {}; const groups = new Set<string>();
  const take = (items: TrainingQuestion[], n: number, reason: string) => {
    let taken = 0;
    for (const q of items) if (taken < n && selected.length < count && !groups.has(q.groupId) && (q.origin !== 'ai' || selected.filter(x => x.origin === 'ai').length < Math.floor(count / 5))) {
      selected.push(q); reasons[q.id] = reason; groups.add(q.groupId); taken++;
    }
  };
  take(sorted.filter(due), Math.round(count * 8 / 30), '復習期限');
  take(sorted.filter(q => risk(q) > 0), Math.round(count * 12 / 30), '苦手な概念の補強');
  take(sorted.filter(q => !latest.has(q.groupId)), Math.round(count * 6 / 30), '未着手の確認');
  take(sorted.filter(q => latest.get(q.groupId)?.correct), count - selected.length, '定着の確認');
  take(sorted.filter(q => !latest.has(q.groupId)), count - selected.length, '未着手から補充');
  take(sorted, count - selected.length, '検証済み問題から補充');
  return { questions: selected, reasons, shortage: Math.max(0, count - selected.length) };
}
