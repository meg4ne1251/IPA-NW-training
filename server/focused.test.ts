import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankAnswer, validateQuestion } from '../src/domain/training';
import type { Outcome, TrainingQuestion } from '../src/domain/training';
import { focusedPool, focusedStatus, newOnlyCollection, reviewOnlyCollection, selectFocused } from '../src/domain/focused';
import { a1Unit } from '../src/domain/a1-coverage';
import { sameQuestion } from '../src/domain/review';
import { withLearningPriority } from './learning-priorities';
import { withReviewConcepts } from './review-concepts';
import { openStore, TrainingStore } from './store';

const now = Date.parse('2026-10-24T12:00:00Z');
const q = (id: string, changes: Partial<TrainingQuestion> = {}): TrainingQuestion => ({
  id, version: 1, section: 'A-1', topic: `分野-${id}`, tags: [id], reviewConcepts: [id],
  prompt: `${id}の問題`, choices: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '確認済みの解説',
  origin: 'original', groupId: id, heldOut: false, source: { label: 'test', url: 'https://example.com' },
  review: { status: 'verified', method: '条件を照合', reviewer: 'test', at: new Date(now).toISOString(), references: ['https://example.com'] }, ...changes,
});
const outcome = (question: TrainingQuestion, hoursAgo: number, correct = false, confidence: Outcome['answer']['confidence'] = 'sure'): Outcome => ({
  question, correct, at: new Date(now - hoursAgo * 3600000).toISOString(), sessionId: 'past',
  answer: { ...blankAnswer(), choice: correct ? 0 : 1, confidence },
});
const dirs: string[] = []; const stores: TrainingStore[] = [];
const make = (seed: TrainingQuestion[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'nw-focused-')); dirs.push(dir);
  const store = new TrainingStore(dir, seed); stores.push(store); return store;
};
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });

describe('復習専用の厳密な出題範囲', () => {
  it('直近の誤答・不安定な正解を再出題し、確信正解は72時間ちょうどで復習対象にする', () => {
    const wrong = q('wrong'); const unsure = q('unsure'); const unknown = q('unknown'); const missing = q('missing');
    const recent = q('recent'); const due = q('due'); const unrelated = q('unrelated', { topic: wrong.topic });
    const history = [outcome(wrong, 0), outcome(unsure, 0, true, 'unsure'), outcome(unknown, 0, true, 'unknown'),
      outcome(missing, 0, true, null), outcome(recent, 71.999, true), outcome(due, 72, true)];
    const bank = [wrong, unsure, unknown, missing, recent, due, unrelated];
    const selected = selectFocused(bank, history, 'A-1', reviewOnlyCollection, 10, now);
    expect(selected.questions.map(q => q.id)).toEqual(['wrong', 'unknown', 'missing', 'unsure', 'due']);
    expect(selected.shortage).toBe(5);
    expect(selected.reasons.due).toContain('72時間以上');
    expect(selectFocused(bank, history, 'A-1', reviewOnlyCollection, 10, now + 3600).questions).toContain(recent);
    expect(focusedPool(bank, [], 'A-1', reviewOnlyCollection, now)).toEqual([]);
  });

  it('最新の結果を使い、再正解直後は過去の誤答・別版を理由に再出題しない', () => {
    const a = q('a'); const reprint = q('reprint', { groupId: a.groupId });
    const failed = outcome(a, 100); const passed = outcome(a, 1, true);
    const history = [passed, failed];
    expect(focusedPool([a, reprint], history, 'A-1', reviewOnlyCollection, now)).toEqual([]);
    expect(focusedPool([a, reprint], history, 'A-1', reviewOnlyCollection, now + 71 * 3600000).map(x => x.question.id)).toEqual(['a']);
  });

  it('元の問題と既習概念の関連問題だけを選び、未学習の別概念で補充しない', () => {
    const seen = q('seen'); const variant = q('variant', { reviewConcepts: seen.reviewConcepts, origin: 'ai' });
    const unrelated = q('unrelated', { topic: seen.topic });
    const bank = [seen, variant, unrelated];
    const result = selectFocused(bank, [outcome(seen, 0)], 'A-1', reviewOnlyCollection, 10, now);
    expect(result.questions.map(q => q.id)).toEqual(['seen', 'variant']);
    expect(result.reasons.variant).toContain('関連問題');
    expect(result.shortage).toBe(8);
    expect(focusedPool(bank, [outcome(seen, 1, true)], 'A-1', reviewOnlyCollection, now)).toHaveLength(0);
    expect(focusedPool(bank, [outcome(seen, 72, true)], 'A-1', reviewOnlyCollection, now)).toHaveLength(2);
  });
});

describe('新規分野専用の厳密な除外', () => {
  it('A-2は既習分野・概念・版違い・再録・同内容を引き続きすべて除外する', () => {
    const seen = q('seen', { topic: 'ネットワーク', reviewConcepts: ['認証'], learning: { area: 'technology', concept: '認証方式', occurrences: 1 } });
    const excluded = [seen, q('same-topic', { topic: seen.topic }), q('related', { reviewConcepts: seen.reviewConcepts }),
      q('alias', { learning: seen.learning }), q('same-family', { groupId: seen.groupId }),
      q('same-content', { prompt: seen.prompt, choices: ['d', 'c', 'b', 'a'] }),
      q('seen', { version: 2, topic: '別の分野', reviewConcepts: ['別の概念'] })];
    const fresh = q('fresh');
    for (const item of [...excluded, fresh]) item.section = 'A-2';
    const history = [outcome(seen, 100, true)];
    expect(focusedPool([...excluded, fresh], history, 'A-2', newOnlyCollection, now).map(x => x.question.id)).toEqual(['fresh']);
    // Exposure still excludes a field after the old question is retired.
    const retired = { ...seen, review: { ...seen.review, status: 'retired' as const } };
    expect(focusedPool([...excluded, fresh], [outcome(retired, 100)], 'A-2', newOnlyCollection, now).map(x => x.question.id)).toEqual(['fresh']);
  });

  it('別科目の履歴は除外に使わず、新規分野内では複数の分野を広く出す', () => {
    const bank = Array.from({ length: 40 }, (_, i) => q(`new-${i}`, { topic: `分野${i % 4}` }));
    const other = q('a2', { section: 'A-2', topic: bank[0].topic, reviewConcepts: bank[0].reviewConcepts });
    const result = selectFocused(bank, [outcome(other, 100)], 'A-1', newOnlyCollection, 10, now);
    expect(result.questions).toHaveLength(10); expect(new Set(result.questions.slice(0, 4).map(q => q.topic)).size).toBe(4);
    expect(result.available).toBe(40);
    const history = [outcome(bank[0], 1)];
    expect(focusedPool(bank, history, 'A-1', newOnlyCollection, now)).toHaveLength(39);
    expect(focusedPool(bank, history, 'A-1', newOnlyCollection, now).some(x => x.question.topic === bank[0].topic)).toBe(true);
  });
});

it.each([reviewOnlyCollection, newOnlyCollection] as const)('%sは未検証・模試用の問題群を除外し、同一問題群・本文重複で水増ししない', collection => {
  const a = q('a'); const b = q('b'); const held = q('held', { heldOut: true });
  const draft = q('draft', { review: { ...a.review, status: 'draft' } });
  const bank = [a, q('reprint', { groupId: a.groupId, prompt: a.prompt }), q('duplicate', { prompt: a.prompt }), b,
    held, q('held-copy', { groupId: held.groupId }), draft, q('a2', { section: 'A-2' })];
  const history = collection === reviewOnlyCollection ? bank.map(q => outcome(q, 100)) : [];
  const result = selectFocused(bank, history, 'A-1', collection, 10, now);
  expect(result.questions).toContain(b); expect(result.questions.some(q => sameQuestion(q, a))).toBe(true);
  expect(result.available).toBe(2); expect(result.shortage).toBe(8);
});

describe('保存・件数制限・実教材との接続', () => {
  it.each([10, 30])('%i問を両科目で開始・再開し、復習専用でも同じ問題数を保持する', count => {
    const store = make((['A-1', 'A-2'] as const).flatMap(section => Array.from({ length: 70 }, (_, i) => q(`${section}-${i}`, { section }))));
    for (const section of ['A-1', 'A-2'] as const) {
      const first = store.create(section, 'practice', count, newOnlyCollection);
      expect(first.questions).toHaveLength(count); expect(first.deadline).toBeNull();
      expect(first.title).toBe(`${section} ${section === 'A-1' ? '未着手の論点' : '新規分野専用'}（${count}問）`);
      expect(first.questions.every(q => q.correctIndex === undefined && q.reviewConcepts === undefined)).toBe(true);
      const reopened = new TrainingStore(store.directory); stores.push(reopened);
      expect(reopened.publicSession(reopened.session(first.id))).toEqual(first);
      store.submit(first.id, first.revision, { revision: first.revision, answers: Object.fromEntries(first.questions.map(q => [q.id, { ...blankAnswer(), confidence: 'unknown' }])), currentIndex: 0 });
      const status = store.dashboard().focused.find(s => s.section === section)!;
      expect(status).toMatchObject({ reviewAvailable: count, newAvailable: 70 - count });
      const review = store.create(section, 'practice', count, reviewOnlyCollection);
      expect(review.questions).toHaveLength(count); expect(review.practiceScope?.collection).toBe(reviewOnlyCollection);
      expect(new Set(review.questions.map(q => q.id))).toEqual(new Set(first.questions.map(q => q.id)));
      expect(review.questions.every(q => q.correctIndex === undefined)).toBe(true);
      store.submit(review.id, review.revision);
      const next = store.create(section, 'practice', count, newOnlyCollection);
      expect(next.questions).toHaveLength(count); expect(next.practiceScope?.collection).toBe(newOnlyCollection);
      expect(next.questions.every(q => !first.questions.some(old => old.topic === q.topic))).toBe(true);
      store.submit(next.id, next.revision);
    }
  });

  it('不足時に短いセットを作らず、件数・モードを検証して履歴を保持する', () => {
    const store = make(Array.from({ length: 12 }, (_, i) => q(`q-${i}`)));
    expect(() => store.create('A-1', 'practice', 10, reviewOnlyCollection)).toThrow('出題できる問題は0問');
    expect(() => store.create('A-1', 'practice', 30, newOnlyCollection)).toThrow('出題できる問題は12問');
    for (const collection of [reviewOnlyCollection, newOnlyCollection]) {
      expect(() => store.create('A-1', 'practice', 5, collection)).toThrow('10問または30問');
      expect(() => store.create('A-1', 'exam', 30, collection)).toThrow('練習');
      expect(() => store.create('A-1', 'practice', 10, collection, { topic: 'test' })).toThrow('補強問題');
    }
    expect(store.sessions()).toHaveLength(0);
    const first = store.create('A-1', 'practice', 10, newOnlyCollection); store.submit(first.id, first.revision, { revision: first.revision, answers: Object.fromEntries(first.questions.map(q => [q.id, { ...blankAnswer(), confidence: 'unknown' }])), currentIndex: 0 });
    const original = store.session(first.id);
    expect(() => store.create('A-1', 'practice', 10, newOnlyCollection)).toThrow('出題できる問題は2問');
    expect(store.session(first.id)).toEqual(original);
    expect(store.sessions()).toHaveLength(1);
  });

  it('実教材でもA-1は既習論点を、A-2は既習分野を除外し、選抜数と画面用件数が一致する', () => {
    const bank: TrainingQuestion[] = ['2025-spring', 'archive', 'a1-supplement', 'review-variants', 'focused-supplement']
      .flatMap(name => JSON.parse(readFileSync(`materials/${name}.json`, 'utf8')) as TrainingQuestion[]).map(withLearningPriority).map(withReviewConcepts);
    for (const section of ['A-1', 'A-2'] as const) {
      const seen = bank.filter(q => q.section === section).slice(0, 5);
      const history = seen.map(q => outcome(q, 100)); const topics = new Set(seen.map(q => q.topic));
      const concepts = new Set(seen.flatMap(q => q.reviewConcepts ?? q.tags));
      const status = focusedStatus(bank, history, section, now);
      for (const count of [10, 30]) {
        const fresh = selectFocused(bank, history, section, newOnlyCollection, count, now);
        expect(fresh.available).toBe(status.newAvailable); expect(fresh.questions).toHaveLength(count);
        expect(fresh.questions.every(q => section === 'A-1'
          ? !seen.some(old => a1Unit(old)?.id === a1Unit(q)?.id) && !seen.some(old => sameQuestion(old, q))
          : !topics.has(q.topic) && !(q.reviewConcepts ?? q.tags).some(c => concepts.has(c)))).toBe(true);
        const review = selectFocused(bank, history, section, reviewOnlyCollection, count, now);
        expect(review.available).toBe(status.reviewAvailable);
        expect(review.questions.every(q => history.some(r => r.question.groupId === q.groupId) || (q.reviewConcepts ?? q.tags).some(c => concepts.has(c)))).toBe(true);
      }
    }
  });
});

describe('追加した目的別教材42問の確認', () => {
  const added: TrainingQuestion[] = JSON.parse(readFileSync('materials/focused-supplement.json', 'utf8'));
  const answer = (id: string) => { const q = added.find(q => q.id.endsWith(`-${id}`))!; return q.choices[q.correctIndex]; };

  it('正答・全選択肢の説明・根拠がそろい、既存教材とID・本文が重複しない', () => {
    const existing: TrainingQuestion[] = ['2025-spring', 'archive', 'a1-supplement', 'review-variants']
      .flatMap(name => JSON.parse(readFileSync(`materials/${name}.json`, 'utf8')) as TrainingQuestion[]);
    expect(added).toHaveLength(42); expect(added.filter(q => q.section === 'A-1')).toHaveLength(12);
    expect(added.filter(q => q.section === 'A-2')).toHaveLength(30);
    const all = [...existing, ...added];
    expect(new Set(all.map(q => q.id)).size).toBe(all.length);
    expect(new Set(added.map(q => q.prompt)).size).toBe(added.length);
    expect(added.every(q => !existing.some(old => old.prompt === q.prompt))).toBe(true);
    for (const q of added) {
      validateQuestion(q); expect(q.review.status).toBe('verified'); expect(q.origin).toBe('ai');
      expect(q.choiceExplanations).toHaveLength(4); expect(q.reviewConcepts?.length).toBeGreaterThan(0);
      expect(q.explanation).toContain(q.choiceExplanations![q.correctIndex]);
    }
    for (let position = 0; position < 4; position++) expect(added.filter(q => q.correctIndex === position).length).toBeGreaterThanOrEqual(10);
  });

  it('整数・固定小数点・確率を別手順で列挙して検算する', () => {
    expect(Math.max(...Array.from({ length: 4096 }, (_, n) => n))).toBe(Number(answer('unsigned-range')));
    const bits = (120 + 15).toString(2).padStart(8, '0');
    const signed = -Number(bits[0]) * 128 + [...bits.slice(1)].reduce((n, bit) => n * 2 + Number(bit), 0);
    expect(signed).toBe(-121); expect(answer('signed-overflow')).toBe('−121');
    expect((0x3a85 & 0x00f0) >>> 4).toBe(Number(answer('mask')));
    const values = Array.from({ length: 8 }, (_, n) => n / 8);
    expect(values[5] - values[4]).toBe(Number(answer('quantization')));
    let oneSuccess = 0;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) for (let c = 0; c < 4; c++) if ([a, b, c].filter(n => n === 0).length === 1) oneSuccess++;
    expect(oneSuccess).toBe(27); expect(answer('binomial')).toBe(`${oneSuccess}/64`);
    let bothRed = 0; let pairs = 0;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 5; b++) if (a !== b) { pairs++; if (a < 3 && b < 3) bothRed++; }
    expect(bothRed / pairs).toBe(0.3); expect(answer('without-replacement')).toBe('3/10');
    let six = 0; for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a === 6 || b === 6) six++;
    expect(answer('complement')).toBe(`${six}/36`);
    expect([2, 2, 2, 5, 5, 8].reduce((a, b) => a + b) / 6).toBe(4); expect(answer('expectation')).toBe('4ms');
  });

  it('テスト値の同値クラス・分岐・命令の実行を追跡する', () => {
    const partition = (age: number) => age < 0 ? 'error' : age < 18 ? 'A' : 'B';
    expect(new Set([-1, 10, 25].map(partition)).size).toBe(3); expect(answer('partition')).toBe('−1、10、25');
    expect(answer('boundary')).toBe('9、10、50、51');
    expect([9, 10, 50, 51].map(n => n >= 10 && n <= 50)).toEqual([false, true, true, false]);
    expect([false, true].flatMap(a => [false, true].map(b => [a, b]))).toHaveLength(4); expect(answer('decision-table')).toBe('4通り');
    expect(new Set([1, 0].map(x => x > 0)).size).toBe(2); expect(answer('branch')).toBe('x=1 と x=0');
    const executed = new Set<string>(); const decisions = new Set<boolean>();
    const run = (x: number) => { executed.add('y=0'); let y = 0; decisions.add(x > 0); if (x > 0) { executed.add('y=1'); y = 1; } executed.add('return'); return y; };
    expect(run(1)).toBe(1); expect(executed.size / 3).toBe(1); expect(decisions.size / 2).toBe(0.5);
    expect(answer('statement')).toBe('命令100%、判定結果50%');
  });

  it('サブネットと稼働率を列挙し、弱点に結び付く関連問題も30問の候補へ増やせる', () => {
    const sizes = [25, 26, 27, 28].map(prefix => ({ prefix, hosts: Array.from({ length: 2 ** (32 - prefix) }, (_, n) => n).slice(1, -1).length }));
    expect(Math.max(...sizes.filter(s => s.hosts >= 50).map(s => s.prefix))).toBe(26); expect(answer('subnet-allocation')).toBe('/26');
    const block = Array.from({ length: 64 }, (_, n) => n + 64); expect(block).toContain(77);
    expect(answer('subnet-broadcast')).toBe(`198.51.100.${block.at(-1)}`);
    expect(Array.from({ length: 300 }, (_, n) => n < 297).filter(Boolean).length / 300).toBe(0.99); expect(answer('availability')).toBe('99%');
    let available = 0; for (let a = 0; a < 100; a++) for (let b = 0; b < 100; b++) if (a < 95 || b < 90) available++;
    expect(available / 10000).toBe(Number(answer('redundant-availability')));
    const history = [outcome(q('old-ip', { section: 'A-2', topic: 'ネットワーク', reviewConcepts: ['IPアドレスとサブネット'] }), 1),
      outcome(q('old-http', { section: 'A-2', topic: 'ネットワーク', reviewConcepts: ['HTTP'] }), 1),
      outcome(q('old-availability', { section: 'A-2', topic: 'システム構成要素', reviewConcepts: ['稼働率と信頼性'] }), 1)];
    expect(focusedPool(added, history, 'A-2', reviewOnlyCollection, now)).toHaveLength(6);
    expect(focusedPool(added, history, 'A-2', newOnlyCollection, now)).toHaveLength(24);
  });

  it('通常の起動でも追加教材を登録し、再起動で問題や既存履歴を重複させない', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nw-focused-seed-')); dirs.push(dir);
    const previous = process.env.TRAINING_DATA_DIR; process.env.TRAINING_DATA_DIR = dir;
    try {
      const store = openStore(); stores.push(store);
      expect(store.bank().filter(q => q.id.startsWith('focused-'))).toHaveLength(42);
      const first = store.create('A-1', 'practice', 10, newOnlyCollection); store.submit(first.id, first.revision, { revision: first.revision, answers: Object.fromEntries(first.questions.map(q => [q.id, { ...blankAnswer(), confidence: 'unknown' }])), currentIndex: 0 });
      const saved = store.session(first.id);
      const reopened = openStore(); stores.push(reopened);
      expect(reopened.bank().filter(q => q.id.startsWith('focused-'))).toHaveLength(42);
      expect(reopened.session(first.id)).toEqual(saved); expect(reopened.history()).toHaveLength(10);
    } finally {
      if (previous === undefined) delete process.env.TRAINING_DATA_DIR; else process.env.TRAINING_DATA_DIR = previous;
    }
  });
});
