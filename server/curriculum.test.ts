import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { a1Unit } from '../src/domain/a1-coverage';
import { curriculumCollection, curriculumPool, curriculumStatus, selectCurriculum } from '../src/domain/curriculum';
import { blankAnswer, validateQuestion } from '../src/domain/training';
import type { Outcome, TrainingQuestion } from '../src/domain/training';
import { sameQuestion } from '../src/domain/review';
import { openStore, TrainingStore } from './store';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const added: TrainingQuestion[] = JSON.parse(readFileSync('materials/curriculum-supplement.json', 'utf8'));
const at = '2026-10-25T12:00:00Z'; const now = Date.parse(at);
const result = (question: TrainingQuestion, confidence: Outcome['answer']['confidence'] = 'unknown', time = '2026-10-24T10:00:00Z', correct = false): Outcome => ({
  question, at: time, correct, sessionId: time, answer: { ...blankAnswer(), confidence, choice: confidence === 'unknown' ? null : correct ? question.correctIndex : (question.correctIndex + 1) % 4 },
});
function fixtures() {
  const base = added[0];
  return Array.from({ length: 40 }, (_, n) => ['a', 'b'].map(suffix => ({ ...base,
    id: `curriculum-${n}-${suffix}`, groupId: `curriculum-${n}-${suffix}`, prompt: `独自問題 ${n}-${suffix}`,
    tags: [], reviewConcepts: [`独自論点${n}`], topic: `分野${n % 8}` }))).flat();
}
const dirs: string[] = []; const stores: TrainingStore[] = [];
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });

describe('解答履歴に基づくA-1カリキュラム', () => {
  it('弱点6・別日確認3・未着手1を選び、別問題・論点・分野を広げる', () => {
    const bank = fixtures();
    const history = bank.filter((_, n) => n % 2 === 0).slice(0, 30).map((q, n) => result(q, n < 20 ? 'unknown' : 'sure', undefined, n >= 20));
    const plan = selectCurriculum(bank, history, 10, now);
    expect(plan.composition).toEqual({ review: 6, confirming: 3, unseen: 1, candidate: 0 });
    expect(plan.shortage).toBe(0); expect(plan.repeated).toBe(0);
    expect(new Set(plan.questions.map(q => a1Unit(q)?.id)).size).toBe(10);
    expect(new Set(plan.questions.map(q => q.topic)).size).toBeGreaterThanOrEqual(6);
    expect(plan.questions.every(q => !history.some(r => sameQuestion(q, r.question)))).toBe(true);
    expect(selectCurriculum(bank, history, 30, now).questions).toHaveLength(30);
  });

  it('未着手が3論点しか残らなくても30問を作り、履歴に応じて配分を変える', () => {
    const bank = fixtures(); const history = bank.filter((_, i) => i % 2 === 0).slice(0, 37).map(q => result(q));
    const plan = selectCurriculum(bank, history, 30, now);
    expect(plan.questions).toHaveLength(30); expect(plan.composition.unseen).toBe(3); expect(plan.composition.review).toBe(27);
    expect(plan.questions.every(q => q.id.endsWith('-b') || Number(q.id.split('-')[1]) >= 37)).toBe(true);
  });

  it('確信正解の当日確認を避け、別日6時間後から別問題を使い、定着候補は72時間空ける', () => {
    const bank = fixtures().slice(0, 2); const [a, b] = bank;
    expect(selectCurriculum(bank, [result(a, 'sure', at, true)], 10, now).questions).toEqual([]);
    expect(selectCurriculum(bank, [result(a, 'sure', '2026-10-24T23:00:00Z', true)], 10, now).questions).toEqual([b]);
    const history = [result(a, 'sure', '2026-10-23T10:00:00Z', true), result(b, 'sure', '2026-10-24T10:00:00Z', true)];
    expect(curriculumPool(bank, history, now).coverage.candidate).toBe(1);
    expect(selectCurriculum(bank, history, 10, now).questions).toEqual([]);
    expect(selectCurriculum(bank, history, 10, Date.parse('2026-10-27T10:00:00Z')).composition.candidate).toBeGreaterThan(0);
  });

  it('未知・誤答の別問題はすぐ使い、既出は6時間空け、再出題理由を明示する', () => {
    const [a, b] = fixtures(); const history = [result(a, 'unknown', at)];
    expect(selectCurriculum([a, b], history, 10, now).questions).toEqual([b]);
    expect(selectCurriculum([a], history, 10, now).questions).toEqual([]);
    const later = selectCurriculum([a], history, 10, now + 6 * 3600000);
    expect(later.repeated).toBe(1); expect(later.reasons[a.id]).toContain('間隔を空けて再出題');
    const repaired = [...history, result(b, 'sure', at, true)];
    expect(selectCurriculum([a, b], repaired, 10, now + 3600000).questions).toEqual([]);
  });

  it('同題・版違い・本文一致を1セット内で除き、保留・未検証・別科目を出題しない', () => {
    const [a, b, c] = fixtures();
    const bank = [a, { ...a, version: 2 }, { ...a, id: 'reprint' }, { ...a, id: 'same-content', groupId: 'same-content' },
      { ...b, review: { ...b.review, status: 'draft' as const } }, { ...c, heldOut: true },
      { ...c, id: 'held-reprint' }, { ...b, section: 'A-2' as const }];
    expect(selectCurriculum(bank, [], 30, now).questions).toEqual([a]);
    const retiredHistory = [result({ ...a, review: { ...a.review, status: 'retired' as const } }, 'unknown', at)];
    expect(selectCurriculum(bank, retiredHistory, 10, now).questions).toEqual([]);
  });

  it('未回答一括提出を弱点や既出にせず、「わからない」は着手済みにする', () => {
    const [a] = fixtures(); const blank = { ...result(a), answer: blankAnswer() };
    expect(curriculumPool([a], [blank], now).coverage.unseen).toBe(1);
    expect(selectCurriculum([a], [blank], 10, now).questions).toEqual([a]);
    expect(curriculumStatus([a], [result(a, 'unknown', at)], now).missingAlternatives).toHaveLength(1);
  });

  it('件数・科目をAPI保存層でも検証し、再開・再起動で履歴を保持する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nw-curriculum-')); dirs.push(dir);
    const store = new TrainingStore(dir, fixtures()); stores.push(store);
    expect(() => store.create('A-2', 'practice', 10, curriculumCollection)).toThrow('A-1');
    expect(() => store.create('A-1', 'exam', 30, curriculumCollection)).toThrow('練習');
    expect(() => store.create('A-1', 'practice', 9, curriculumCollection)).toThrow('10問');
    for (const count of [10, 30]) {
      const session = store.create('A-1', 'practice', count, curriculumCollection);
      expect(session.questions).toHaveLength(count); expect(session.practiceScope?.collection).toBe(curriculumCollection);
      for (const q of session.questions) expect(session.selectionReasons[q.id]).not.toContain(a1Unit(store.bank().find(x => x.id === q.id)!)!.label);
      store.submit(session.id, session.revision, { revision: session.revision, currentIndex: 0,
        answers: Object.fromEntries(session.questions.map(q => [q.id, { ...blankAnswer(), confidence: 'unknown' }])) });
      const reopened = new TrainingStore(dir); stores.push(reopened);
      expect(reopened.session(session.id)).toEqual(store.session(session.id));
    }
    expect(store.history()).toHaveLength(40);
    expect(store.dashboard().curriculum.counts.review).toBeGreaterThan(0);
    const small = new TrainingStore(mkdtempSync(join(tmpdir(), 'nw-curriculum-small-')), [fixtures()[0]]);
    stores.push(small); dirs.push(small.directory);
    expect(() => small.create('A-1', 'practice', 10, curriculumCollection)).toThrow('不足');
    expect(small.sessions()).toHaveLength(0);
  });
});

describe('履歴の不足論点を補う教材', () => {
  const get = (slug: string) => added.find(q => q.id === `supplement-a1-adaptive-${slug}`)!;
  const answer = (slug: string) => { const q = get(slug); return q.choices[q.correctIndex]; };
  it('39問を既存27論点へ分類し、全選択肢の説明と根拠を持ち、正答位置を分散する', () => {
    const existing: TrainingQuestion[] = ['2025-spring', 'archive', 'a1-supplement', 'review-variants', 'focused-supplement'].flatMap(n => JSON.parse(readFileSync(`materials/${n}.json`, 'utf8')));
    expect(added).toHaveLength(39); expect(new Set(added.map(q => a1Unit(q)?.id)).size).toBe(27);
    expect(new Set(added.map(q => q.id)).size).toBe(39);
    for (const q of added) {
      expect(() => validateQuestion(q)).not.toThrow(); expect(q.review.status).toBe('verified'); expect(a1Unit(q)).toBeDefined();
      expect(q.choiceExplanations).toHaveLength(4); expect(q.explanation).toContain(q.choiceExplanations![q.correctIndex]);
      expect(existing.some(other => sameQuestion(q, other))).toBe(false);
    }
    for (const index of [0, 1, 2, 3]) expect(added.filter(q => q.correctIndex === index).length).toBeGreaterThanOrEqual(9);
  });

  it('平均電流・最大動作比率・クリティカルパス短縮を独立列挙で検算する', () => {
    const samples = [40, 40, ...Array(8).fill(2)]; expect(samples.reduce((a, b) => a + b) / samples.length).toBe(9.6);
    expect(answer('power-average')).toBe('9.6mA');
    const duty = Array.from({ length: 28 }, (_, i) => i).filter(i => (30 * i + 3 * (27 - i)) / 27 <= 540 / 60);
    expect(Math.max(...duty)).toBe(6); expect(answer('power-duty')).toBe('2/9');
    const finishes = [12 - 3, 11]; expect(Math.max(...finishes)).toBe(11); expect(answer('crash-bottleneck')).toBe('11日');
    const costs: number[] = [];
    for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) if (Math.max(6 - a + 4 - c, 6 - b + 4 - c) <= 9) costs.push(3 * a + 4 * b + 5 * c);
    expect(Math.min(...costs)).toBe(5); expect(answer('crash-cost')).toBe('5万円');
    const monthly = [120, ...Array(36).fill(40 / 12), 6];
    expect(Math.round(monthly.reduce((a, b) => a + b))).toBe(246); expect(answer('tco')).toBe('246万円');
  });

  it('SQLを実行して外部結合の行数とNULL比較を検算し、SHA-256を実計算する', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE customer(id); CREATE TABLE orders(id, customer_id, amount); INSERT INTO customer VALUES (1),(2); INSERT INTO orders VALUES (10,1,200),(11,1,50),(12,3,300);');
      expect(db.prepare('SELECT * FROM customer LEFT JOIN orders ON customer.id=orders.customer_id').all()).toHaveLength(3);
      expect(answer('join-cardinality')).toBe('3行');
      expect(db.prepare('SELECT customer.id FROM customer LEFT JOIN orders ON customer.id=orders.customer_id WHERE amount>100').all()).toEqual([{ id: 1 }]);
      expect(answer('join-where')).toBe('顧客1だけ残る');
    } finally { db.close(); }
    for (const bytes of [Buffer.from('a'), Buffer.alloc(1024 * 1024)]) expect(createHash('sha256').update(bytes).digest('hex')).toHaveLength(64);
    expect(answer('hash-size')).toBe('どちらも64桁');
  });

  it('キュー・スタックを実行し、RAID故障組合せを列挙して検算する', () => {
    const queue: string[] = []; queue.push('A', 'B'); expect(queue.shift()).toBe('A'); queue.push('C');
    expect(queue.shift()).toBe('B'); expect(queue).toEqual(['C']); expect(answer('queue-operations')).toBe('取り出しB、残りC');
    const tree: Record<string, string[]> = { R: ['A', 'B'], A: ['C', 'D'], B: ['E'] };
    const visits: string[] = []; const waiting = ['R']; while (waiting.length) { const node = waiting.shift()!; visits.push(node); waiting.push(...(tree[node] ?? [])); }
    expect(answer('queue-bfs')).toBe(visits.join(','));
    const stack: number[] = [];
    for (const token of ['8', '3', '2', '*', '-', '4', '+']) {
      if (/^\d+$/.test(token)) stack.push(Number(token)); else { const r = stack.pop()!; const l = stack.pop()!; stack.push(token === '*' ? l * r : token === '-' ? l - r : l + r); }
    }
    expect(answer('stack-postfix')).toBe(String(stack[0]));
    const valid = (text: string) => { const stack: string[] = []; for (const ch of text) if ('([{'.includes(ch)) stack.push(ch); else if (stack.pop() !== ({ ')': '(', ']': '[', '}': '{' } as Record<string, string>)[ch]) return false; return !stack.length; };
    expect(get('stack-parentheses').choices.filter(valid)).toEqual([answer('stack-parentheses')]);
    expect(answer('raid-capacity')).toBe('8TB');
    const mirror = [['A', 'B'], ['C', 'D']]; const choices = [['A', 'B'], ['A', 'C'], ['A', 'D'], ['B', 'C']];
    expect(choices.filter(failed => mirror.some(pair => pair.every(disk => failed.includes(disk))))).toEqual([['A', 'B']]);
    expect(answer('raid-mirror-failure')).toBe('AとB');
  });

  it('起動時に教材を追加し、再起動でも二重登録しない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nw-curriculum-seed-')); dirs.push(dir);
    const previous = process.env.TRAINING_DATA_DIR; process.env.TRAINING_DATA_DIR = dir;
    try {
      const first = openStore(); stores.push(first); const second = openStore(); stores.push(second);
      expect(first.bank().filter(q => q.id.startsWith('supplement-a1-adaptive-'))).toHaveLength(39);
      expect(second.bank()).toHaveLength(first.bank().length);
    } finally { if (previous === undefined) delete process.env.TRAINING_DATA_DIR; else process.env.TRAINING_DATA_DIR = previous; }
  });
});
