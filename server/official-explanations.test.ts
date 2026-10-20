import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withOfficialExplanation } from './official-explanations.ts';
import { withLearningPriority } from './learning-priorities.ts';
import { TrainingStore } from './store.ts';
import { createApp } from './index.ts';
import { blankAnswer, validateQuestion } from '../src/domain/training.ts';
import type { TrainingQuestion } from '../src/domain/training.ts';

const archive = JSON.parse(readFileSync('materials/archive.json', 'utf8')) as TrainingQuestion[];
const data = JSON.parse(readFileSync('materials/official-explanations.json', 'utf8'));
const dirs: string[] = []; const stores: TrainingStore[] = [];
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const make = (questions: TrainingQuestion[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'nw-explanations-')); dirs.push(dir);
  const store = new TrainingStore(dir, questions); stores.push(store); return store;
};
const originals = archive.filter(q => q.id.startsWith('ipa-2025r07a-'));

describe('公式問題への独自解説の追加', () => {
  it('2022～2025年度の追加解説対象を漏れなく収録し、元の正答・出典・版に一致する', () => {
    const scope = archive.filter(q => /^ipa-(2025r07a|2024r06[ha]|2023r05[ha]|2022r04[ha])-/.test(q.id));
    expect(scope).toHaveLength(285);
    expect(Object.keys(data.questions).sort()).toEqual(scope.map(q => q.id).sort());
    for (const q of scope) {
      const result = withOfficialExplanation(q);
      expect(result).not.toBe(q);
      expect(result).toMatchObject({ id: q.id, version: q.version, correctIndex: q.correctIndex, source: q.source, choices: q.choices });
      expect(result.explanation.startsWith(`正答は「${'アイウエ'[q.correctIndex]}」です。`)).toBe(true);
      expect(result.explanation).not.toContain('未追加');
      expect(result.explanation).toContain('\n\n');
      expect(result.choiceExplanations).toHaveLength(4);
      expect(result.review.references).toContain(q.source.answerUrl);
      expect(result.review.method).toContain('人による監修ではありません');
      expect(() => validateQuestion(result)).not.toThrow();
      expect(withOfficialExplanation(result)).toEqual(result);
      // A related family may include revised wording or reordered choices; never inherit by group.
      expect(withOfficialExplanation({ ...q, id: `related-${q.id}`, groupId: q.id }).explanation).toBe(q.explanation);
    }
    expect(archive.filter(q => withOfficialExplanation(q) === q)).toHaveLength(455);
    // The book manifest must cover the same originals without a duplicated or missing booklet.
    expect(new Set(data.books.map((b: { sourceUrl: string }) => b.sourceUrl)).size).toBe(10);
    expect(data.books).toHaveLength(10);
    for (const book of data.books) {
      const questions = scope.filter(q => q.source.url === book.sourceUrl).sort((a, b) => a.source.number! - b.source.number!);
      expect(questions).toHaveLength(book.questions);
      expect(questions.every(q => q.source.answerUrl === book.answerUrl)).toBe(true);
      expect(book.questionSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(book.answerSha256).toMatch(/^[a-f0-9]{64}$/);
      if (book.answerVerification) {
        // Independently captured from the official answer PDFs, not from archive.correctIndex.
        expect(questions.map(q => 'アイウエ'[q.correctIndex]).join('')).toBe(book.answerVerification.key);
      }
    }
  });
  it('版・正答・原本・原問番号が違うもの、AI問題には適用しない', () => {
    const q = originals[0];
    for (const patch of [ { version: 2 }, { correctIndex: (q.correctIndex + 1) % 4 },
      { source: { ...q.source, url: 'https://example.com/different.pdf' } },
      { source: { ...q.source, number: 2 } }, { origin: 'ai' as const } ]) {
      const altered = { ...q, ...patch };
      expect(withOfficialExplanation(altered)).toBe(altered);
    }
  });
  it('既存DBと採点済み・未採点の旧スナップショットへ表示時に反映し、回答と原記録を保持する', () => {
    const store = make(originals.slice(0, 2));
    // Simulate sessions written by the old application, before explanations existed.
    const visible = store.newSession('A-1', 'practice', originals.slice(0, 2), {}, '更新前の演習');
    const initialPayload = store.db.prepare('SELECT payload FROM sessions WHERE id=?').get(visible.id)!.payload;
    const originalBank = store.records<TrainingQuestion>('questions');
    expect(visible.questions.every(q => q.explanation === undefined && q.choiceExplanations === undefined
      && q.source.answerUrl === undefined && q.review.references.length === 0)).toBe(true);
    expect(store.bank()[0].explanation).not.toContain('未追加');
    expect(store.publicSession(store.session(visible.id))).toEqual(visible);
    expect(store.db.prepare('SELECT payload FROM sessions WHERE id=?').get(visible.id)!.payload).toBe(initialPayload);
    const answer = { ...blankAnswer(), choice: originals[0].correctIndex, confidence: 'sure' as const, seconds: 21 };
    const graded = store.grade(visible.id, originals[0].id, 0, { revision: 0, currentIndex: 0, answers: { [originals[0].id]: answer } });
    expect(graded.questions[0].explanation).toContain('M/M/1');
    expect(graded.questions[0].choiceExplanations).toHaveLength(4);
    expect(graded.questions[1].explanation).toBeUndefined();
    expect(graded.questions[1].choiceExplanations).toBeUndefined();
    const stored = store.session(visible.id);
    const storedPayload = JSON.stringify(stored);
    expect(stored.questions[0].explanation).toContain('未追加');
    const reopened = new TrainingStore(store.directory); stores.push(reopened);
    expect(reopened.publicSession(reopened.session(visible.id))).toEqual(graded);
    const history = reopened.history();
    expect(history).toHaveLength(1);
    expect(history[0].answer).toEqual(answer);
    expect(history[0].correct).toBe(true);
    expect(history[0].at).toBe(stored.graded![originals[0].id]);
    expect(history[0].question.explanation).toContain('M/M/1');
    const exported = reopened.exportContext('A-1');
    expect(exported.history[0].question.choiceExplanations).toHaveLength(4);
    expect(exported.availableQuestions.find(q => q.id === originals[0].id)!.explanation).toContain('M/M/1');
    expect(JSON.stringify(reopened.session(visible.id))).toBe(storedPayload);
    expect(reopened.records<TrainingQuestion>('questions')).toEqual(originalBank);
    expect(reopened.bank()[0].groupId).toBe(withLearningPriority(originals[0]).groupId);
    // Grading the last question must expose the new explanation on that same response.
    const last = reopened.grade(visible.id, originals[1].id, graded.revision, { revision: graded.revision, currentIndex: 1,
      answers: { ...graded.answers, [originals[1].id]: { ...blankAnswer(), confidence: 'unknown' } } });
    expect(last.status).toBe('submitted');
    expect(last.questions.every(q => q.choiceExplanations?.length === 4)).toBe(true);
    expect(reopened.session(visible.id).questions.every(q => q.explanation.includes('未追加'))).toBe(true);
  });
  it('旧演習の一括提出、提出の再送、履歴再読込でも更新された解説をAPIで返す', async () => {
    const store = make(originals.slice(0, 1));
    const session = store.newSession('A-1', 'practice', originals.slice(0, 1), {}, '旧演習');
    const server = createApp(store);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number }; const url = `http://127.0.0.1:${address.port}/api/sessions/${session.id}`;
    try {
      const submitted = await (await fetch(`${url}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0 }) })).json();
      expect(submitted.status).toBe('submitted');
      expect(submitted.questions[0].explanation).toContain('M/M/1');
      const repeated = await (await fetch(`${url}/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: 0 }) })).json();
      expect(repeated).toEqual(submitted);
      expect(await (await fetch(url)).json()).toEqual(submitted);
      expect(store.session(session.id).questions[0].explanation).toContain('未追加');
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});
