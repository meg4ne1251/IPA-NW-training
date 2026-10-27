import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Assessment, WrittenDraft, WrittenQuestion, WrittenSession, WrittenDashboard } from '../src/domain/written.ts';

export class WrittenConflictError extends Error {}
const bank = [2025, 2024, 2023].flatMap(year =>
  JSON.parse(readFileSync(new URL(`../materials/written-${year}.json`, import.meta.url), 'utf8')) as WrittenQuestion[]);
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }

export class WrittenStore {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
    db.exec('CREATE TABLE IF NOT EXISTS written_sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL)');
  }
  records(): WrittenSession[] {
    return this.db.prepare('SELECT payload FROM written_sessions').all().map(row => JSON.parse(row.payload as string) as WrittenSession)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  dashboard(): WrittenDashboard {
    return { questions: bank.map(({ id, year, season, section, number, title, tags, minutes, slots }) => ({ id, year, season, section, number, title, tags, minutes, slotCount: slots.length })),
      sessions: this.records().map(s => ({ id: s.id, questionId: s.question.id, title: s.question.title, section: s.question.section, number: s.question.number, year: s.question.year,
        status: s.status, startedAt: s.startedAt, updatedAt: s.updatedAt, answered: Object.values(s.answers).filter(a => a.trim()).length, total: s.question.slots.length,
        good: Object.values(s.assessments).filter(v => v === 'good').length, partial: Object.values(s.assessments).filter(v => v === 'partial').length, review: Object.values(s.assessments).filter(v => v === 'review').length })) };
  }
  get(id: string): WrittenSession {
    const row = this.db.prepare('SELECT payload FROM written_sessions WHERE id=?').get(id);
    check(row, '記述演習が見つかりません。'); return JSON.parse(row.payload as string);
  }
  public(s: WrittenSession): WrittenSession {
    if (s.status !== 'writing') return s;
    const { guide: _guide, source, slots, ...question } = s.question;
    const { answerUrl: _a, commentUrl: _c, localAnswer: _la, localComment: _lc, ...safeSource } = source;
    return { ...s, question: { ...question, source: safeSource, slots: slots.map(({ example: _e, ...slot }) => slot) } };
  }
  write(s: WrittenSession) { this.db.prepare('INSERT OR REPLACE INTO written_sessions VALUES (?, ?)').run(s.id, JSON.stringify(s)); return this.public(s); }
  create(questionId: unknown) {
    const question = bank.find(q => q.id === questionId); check(question, '収録された問題を選んでください。');
    // Retry starts a new attempt; an in-progress attempt of the same question is resumed.
    const active = this.records().find(s => s.question.id === questionId && s.status !== 'completed');
    if (active) return this.public(active);
    const now = new Date().toISOString();
    return this.write({ id: randomUUID(), question: structuredClone(question), status: 'writing', revision: 0,
      startedAt: now, updatedAt: now, answers: Object.fromEntries(question.slots.map(s => [s.id, ''])), assessments: {}, notes: '', page: question.pages[0] });
  }
  update(id: string, body: unknown, action: 'draft' | 'reveal' | 'complete') {
    check(record(body), '保存する回答の形式が不正です。');
    const s = this.get(id);
    if (body.revision !== s.revision) throw new WrittenConflictError('別の画面で更新されています。回答の控えをダウンロードしてから最新の保存内容を読み込んでください。');
    check(s.status !== 'completed', '完了済みの回答は変更できません。解き直しで新しい演習を始めてください。');
    const { answers, assessments, notes, page } = body;
    const keys = s.question.slots.map(slot => slot.id);
    check(record(answers) && Object.keys(answers).length === keys.length && keys.every(k => typeof answers[k] === 'string' && (answers[k] as string).length <= 4000), '各回答は4000文字以内で入力してください。');
    check(record(assessments) && Object.entries(assessments).every(([k, v]) => keys.includes(k) && ['good', 'partial', 'review'].includes(v as string)), '振り返りの評価が不正です。');
    check(typeof notes === 'string' && notes.length <= 10000, 'メモは10000文字以内で入力してください。');
    check(typeof page === 'number' && s.question.pages.includes(page), '問題ページの指定が不正です。');
    if (s.status !== 'writing') check(keys.every(k => answers[k] === s.answers[k]), '解答例を確認した後の回答は変更できません。');
    if (s.status === 'writing') check(Object.keys(assessments).length === 0, '解答例を確認してから振り返りを記録してください。');
    if (action === 'reveal') { check(s.status === 'writing', '解答例は既に表示しています。'); s.status = 'reviewing'; s.revealedAt = new Date().toISOString(); }
    if (action === 'complete') {
      check(s.status === 'reviewing', '先に公式解答例を確認してください。');
      check(keys.every(k => assessments[k]), 'すべての回答欄の振り返りを選んでください。');
      s.status = 'completed'; s.completedAt = new Date().toISOString();
    }
    s.answers = answers as Record<string, string>; s.assessments = assessments as Record<string, Assessment>;
    s.notes = notes; s.page = page; s.revision++; s.updatedAt = new Date().toISOString(); return this.write(s);
  }
}
