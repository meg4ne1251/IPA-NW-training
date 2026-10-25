import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TrainingStore, openStore } from './store';
import { blankAnswer, selectPractice, supplementCollection, validateQuestion } from '../src/domain/training';
import type { TrainingQuestion, Outcome } from '../src/domain/training';

const load = (name: string): TrainingQuestion[] => JSON.parse(readFileSync(`materials/${name}.json`, 'utf8'));
const bank = load('a1-supplement');
const answer = (suffix: string) => { const q = bank.find(q => q.id === `supplement-a1-${suffix}`)!; return q.choices[q.correctIndex]; };
const dirs: string[] = []; const stores: TrainingStore[] = [];
function make(seed = bank) {
  const dir = mkdtempSync(join(tmpdir(), 'nw-supplement-')); dirs.push(dir);
  const store = new TrainingStore(dir, seed); stores.push(store); return store;
}
afterEach(() => { for (const store of stores.splice(0)) store.close(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('A-1補強教材の品質', () => {
  it('24分野120問の全問を検証し、既存教材とのID・本文重複を防ぐ', () => {
    expect(bank).toHaveLength(120);
    const topics = new Map<string, number>();
    for (const q of bank) {
      expect(validateQuestion(q)).toBe(q);
      expect(q.section).toBe('A-1'); expect(q.origin).toBe('ai'); expect(q.review.status).toBe('verified');
      expect(q.choiceExplanations).toHaveLength(4); expect(q.source.image).toBeUndefined();
      expect(q.review.reviewer).toContain('AI'); expect(q.review.method).toContain('人による監修ではありません');
      for (const url of q.review.references) expect(new URL(url).protocol).toBe('https:');
      topics.set(q.topic, (topics.get(q.topic) ?? 0) + 1);
    }
    expect(topics.size).toBe(24); expect([...topics.values()].every(n => n === 5)).toBe(true);
    const all = [...load('2025-spring'), ...load('archive'), ...bank];
    expect(new Set(all.map(q => q.id)).size).toBe(all.length);
    expect(new Set(bank.map(q => q.groupId)).size).toBe(120);
    expect(new Set(bank.map(q => q.prompt)).size).toBe(120);
    expect([0, 1, 2, 3].map(i => bank.filter(q => q.correctIndex === i).length)).toEqual([30, 30, 30, 30]);
  });
  it('数値表現・確率・CPU・記憶容量・会計の正答を独立に再計算する', () => {
    const bits = [...'11110110'].map(Number);
    expect(answer('numeric-01')).toBe(String(parseInt('2D', 16)));
    expect(answer('numeric-02')).toBe(String(bits.reduce((sum, bit, i) => sum + bit * (i === 0 ? -128 : 2 ** (7 - i)), 0)).replace('-', '−'));
    expect(answer('numeric-03')).toBe(String(parseInt('101', 2) + parseInt('011', 2) / 8));
    expect(answer('numeric-04')).toBe(((parseInt('00101100', 2) * 4) % 256).toString(2).padStart(8, '0'));
    const rolls = Array.from({ length: 8 }, (_, i) => i.toString(2).padStart(3, '0'));
    expect(answer('probability-01')).toBe(`${rolls.filter(s => [...s].filter(x => x === '1').length === 2).length}/${rolls.length}`);
    const even = [1, 2, 3, 4, 5, 6].filter(n => n % 2 === 0);
    expect(answer('probability-02')).toBe(`${even.filter(n => n >= 4).length}/${even.length}`);
    expect(answer('probability-03')).toBe(`${[...Array(6).fill(100), ...Array(4).fill(-50)].reduce((a, b) => a + b, 0) / 10}円`);
    expect(answer('probability-04')).toBe(`${Math.log2(8)}ビット`);
    expect(answer('probability-05')).toBe(`${1 / (5 - 4)}秒`);
    expect(answer('algorithm-03')).toBe(String([1, 2, 3, 4].reduce((a, b) => a * b, 1)));
    expect(answer('architecture-01')).toBe(`${1e9 / (2e9 / 4)}秒`);
    expect(answer('architecture-02')).toBe(`${Array(9).fill(10).concat(110).reduce((a, b) => a + b, 0) / 10}ns`);
    expect(answer('architecture-05')).toBe(`${100 / (20 + 80 / 4)}倍`);
    const combinations = [false, true].flatMap(a => [false, true].map(b => ({ a, b })));
    expect(answer('reliability-01')).toBe(String(81 / 100));
    expect(answer('reliability-02')).toBe(String((81 + 9 + 9) / 100));
    expect(answer('reliability-03')).toBe(`${100 - 10 / 1000 * 100}%`);
    expect(answer('reliability-04')).toBe(`${4 * 2 - 2}TB`);
    expect(combinations.every(({ a, b }) => !(a && b) === (!a || !b))).toBe(true);
    expect(answer('hardware-02')).toBe('(NOT A) OR (NOT B)');
    expect(answer('hardware-03')).toBe(`S=${(1 + 1) % 2}、C=${Math.floor((1 + 1) / 2)}`);
    expect(2 ** 20 / 1024 / 1024).toBe(1); expect(answer('hardware-04')).toBe('1MiB');
    expect(answer('hardware-05')).toBe(`5/${2 ** 10} V`);
    expect(answer('media-01')).toBe(`${640 * 480 * 3}バイト`);
    expect(answer('media-02')).toBe(`${48000 * 10 * 2 * 2}バイト`);
    expect(answer('media-05')).toBe(String(2 ** 8));
    expect(answer('ip-01')).toBe(String(2 ** (32 - 26) - 2));
    expect(answer('ip-02')).toBe(`192.0.2.${141 & 224}`);
    expect(answer('protocol-05')).toBe(`${10e6 / (100e6 / 8)}秒`);
    expect(answer('project-02')).toBe(`${Math.max(3 + 4 + 2, 3 + 6 + 2)}日`);
    expect(answer('project-03')).toBe(`${[2, 5, 5, 5, 5, 8].reduce((a, b) => a + b, 0) / 6}日`);
    expect(answer('project-04')).toBe(`SPI=${80 / 100}、計画より遅れている`);
    expect(answer('service-01')).toBe(`${720 * 0.5 / 100}時間`);
    const profitableAt = Array.from({ length: 1201 }, (_, n) => n).find(n => n * 3000 - n * 1800 - 1200000 >= 0);
    expect(answer('accounting-01')).toBe(`${profitableAt}個`);
    expect(answer('accounting-02')).toBe(`${(1000 - 600) / 1000 * 100}%`);
    expect(answer('accounting-03')).toBe(`${75 / 500 * 100}%`);
    expect(answer('accounting-04')).toBe(`${110 * 100 / 110}万円`);
    expect(answer('accounting-05')).toBe(`年${2400 / 400}回`);
  });
  it('スタック・キュー・LRUの手順とSQLのNULLの扱いを実行で照合する', () => {
    const stack = ['A', 'B', 'C']; stack.pop(); stack.pop(); stack.push('D');
    expect(answer('structure-01')).toBe(stack.pop());
    const queue = ['A', 'B']; queue.shift(); queue.push('C'); expect(answer('structure-02')).toBe(queue.shift());
    const last = new Map<string, number>(); let evicted = '';
    for (const [i, page] of [...'ABCAD'].entries()) {
      if (!last.has(page) && last.size === 3) { evicted = [...last].sort((a, b) => a[1] - b[1])[0][0]; last.delete(evicted); }
      last.set(page, i);
    }
    expect(answer('os-05')).toBe(evicted);
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE t(v INTEGER); INSERT INTO t VALUES (10), (NULL), (20)');
      const row = db.prepare('SELECT COUNT(*) AS all_count, COUNT(v) AS value_count FROM t').get()!;
      expect(answer('sql-01')).toBe(`${row.all_count}, ${row.value_count}`);
    } finally { db.close(); }
  });
});

describe('補強演習の選抜・保存・登録', () => {
  it('全分野からの初回30問を幅広く選び、細かな論点は該当問題だけ出題する', () => {
    const store = make();
    const broad = store.create('A-1', 'practice', 30, supplementCollection);
    expect(broad.questions).toHaveLength(30); expect(new Set(broad.questions.map(q => q.topic)).size).toBe(24);
    expect(broad.questions.every(q => q.correctIndex === undefined && q.choiceExplanations === undefined && q.review.references.length === 0)).toBe(true);
    store.submit(broad.id, broad.revision);
    const focused = store.create('A-1', 'practice', 10, supplementCollection, { topic: 'ネットワーク・アドレス', tag: 'ネットワークアドレス' });
    expect(focused.questions).toHaveLength(1); expect(focused.questions[0].id).toBe('supplement-a1-ip-02');
    expect(focused.practiceScope).toEqual({ collection: supplementCollection, topic: 'ネットワーク・アドレス', tag: 'ネットワークアドレス' });
    const result = store.submit(focused.id, focused.revision);
    expect(result.questions[0].choiceExplanations).toHaveLength(4);
    expect(store.dashboard().supplements).toHaveLength(24);
    expect(store.dashboard().stats.some(t => t.topic === 'ネットワーク・アドレス')).toBe(true);
  });
  it('通常演習のAI上限を守り、未検証・模試用グループを補強範囲へ混ぜない', () => {
    const past = Array.from({ length: 30 }, (_, n) => ({ ...bank[0], id: `past-${n}`, groupId: `past-${n}`, origin: 'past' as const }));
    const store = make([...past, ...bank]);
    const mixed = store.create('A-1', 'practice', 10);
    expect(mixed.questions.filter(q => q.origin === 'ai').length).toBeLessThanOrEqual(2);
    store.submit(mixed.id, mixed.revision);
    const draft = { ...bank[0], review: { ...bank[0].review, status: 'draft' as const } };
    const held = { ...bank[1], id: 'held-sibling', heldOut: true };
    const second = make([draft, bank[1], held, bank[2]]);
    const safe = second.create('A-1', 'practice', 30, supplementCollection);
    expect(safe.questions.map(q => q.id)).toEqual([bank[2].id]);
  });
  it('科目やモードの混同・存在しない範囲・不正なフィルターを拒否する', () => {
    const store = make();
    expect(() => store.create('A-2', 'practice', 10, supplementCollection)).toThrow('A-1');
    expect(() => store.create('A-1', 'diagnostic', 30, supplementCollection)).toThrow('練習');
    expect(() => store.create('A-1', 'exam', 30, supplementCollection)).toThrow('練習');
    expect(() => store.create('A-1', 'practice', 10, '', { topic: 'SQL' })).toThrow('補強問題');
    expect(() => store.create('A-1', 'practice', 10, supplementCollection, { topic: '存在しない分野' })).toThrow('出題可能');
    expect(() => store.create('A-1', 'practice', 10, supplementCollection, { tag: [] as unknown as string })).toThrow('不正');
    expect(store.sessions()).toHaveLength(0);
  });
  it('自信のある誤答は同じ概念の別問題で復習する', () => {
    const weak = bank[10];
    const history: Outcome[] = [{ question: weak, answer: { ...blankAnswer(), choice: (weak.correctIndex + 1) % 4, confidence: 'sure' }, correct: false, at: new Date().toISOString(), sessionId: 'before' }];
    const alternative = { ...weak, id: 'different-task', groupId: 'different-task', prompt: '条件を変えた別の課題' };
    const selected = selectPractice([...bank, alternative], history, 'A-1', 10, Date.now(), 10);
    expect(selected.questions[0].id).toBe(alternative.id); expect(selected.reasons[alternative.id]).toBe('苦手な概念を類題・関連問題で補強');
    expect(selected.questions.some(q => q.id === weak.id)).toBe(false);
  });
  it('既存DBへ起動時に教材を追加し、再起動で重複せず、履歴と補強範囲を保持する', () => {
    const first = make(bank.slice(0, 1));
    const s = first.create('A-1', 'practice', 1, supplementCollection, { topic: bank[0].topic });
    first.submit(s.id, s.revision);
    const previous = process.env.TRAINING_DATA_DIR; process.env.TRAINING_DATA_DIR = first.directory;
    try {
      const updated = openStore(); stores.push(updated);
      expect(updated.bank()).toHaveLength(237); expect(updated.session(s.id).practiceScope?.topic).toBe(bank[0].topic);
      const again = openStore(); stores.push(again);
      expect(again.bank()).toHaveLength(237); expect(again.revision()).toBe(1);
      expect(again.session(s.id).questions).toHaveLength(1);
    } finally { if (previous === undefined) delete process.env.TRAINING_DATA_DIR; else process.env.TRAINING_DATA_DIR = previous; }
  });
});
