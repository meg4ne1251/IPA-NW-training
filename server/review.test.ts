import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { blankAnswer, selectPractice, validateQuestion } from '../src/domain/training';
import type { Outcome, TrainingQuestion } from '../src/domain/training';
import { conceptProgress, isFresh, reviewAnalysis, reviewCollection } from '../src/domain/review';
import { rapidStatus, selectRapid } from '../src/domain/rapid';
import { withLearningPriority } from './learning-priorities';
import { withReviewConcepts } from './review-concepts';
import { TrainingStore } from './store';
const now = Date.parse('2026-10-20T12:00:00Z');
const q = (id: string, changes: Partial<TrainingQuestion> = {}): TrainingQuestion => ({
  id, version: 1, section: 'A-1', topic: 'データベース', tags: ['参照整合性'], reviewConcepts: ['外部キー'],
  prompt: `${id}の異なる条件`, choices: ['a', 'b', 'c', 'd'], correctIndex: 0, explanation: '確認済み',
  origin: 'original', groupId: id, heldOut: false, source: { label: 'test', url: 'https://example.com' },
  review: { status: 'verified', method: '条件を照合', reviewer: 'test', at: new Date(now).toISOString(), references: ['https://example.com'] }, ...changes,
});
const row = (question: TrainingQuestion, at: string, correct = false, confidence: Outcome['answer']['confidence'] = 'unknown'): Outcome => ({ question, at, correct, sessionId: 'past', answer: { ...blankAnswer(), choice: correct ? 0 : null, confidence } });
const dirs: string[] = []; const stores: TrainingStore[] = [];
const make = (seed: TrainingQuestion[]) => { const dir = mkdtempSync(join(tmpdir(), 'nw-review-')); dirs.push(dir); const s = new TrainingStore(dir, seed); stores.push(s); return s; };
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
const real = () => ['2025-spring', 'archive', 'a1-supplement', 'review-variants'].flatMap(n => JSON.parse(readFileSync(`materials/${n}.json`, 'utf8')) as TrainingQuestion[]).map(withLearningPriority).map(withReviewConcepts);

describe('答えの記憶に頼らない復習', () => {
  it('通常・短期集中とも既出ID、版違い、同一問題群、本文と選択肢が同じ問題を出さない', () => {
    const original = q('seen'); const history = [row(original, '2026-10-19T00:00:00Z')];
    const copy = q('reprint', { groupId: original.groupId }); const reordered = q('reordered', { prompt: original.prompt, choices: ['d', 'c', 'b', 'a'] });
    const variant = q('different-task'); const bank = [original, { ...original, version: 2 }, copy, reordered, variant];
    for (const select of [selectPractice, selectRapid]) {
      const result = select(bank, history, 'A-1', 10, now);
      expect(result.questions.map(q => q.id)).toEqual([variant.id]); expect(result.shortage).toBe(9);
      expect(select(bank.slice(0, -1), history, 'A-1', 10, now).questions).toHaveLength(0);
    }
  });
  it('復習間隔と概念の関連を使い、同じ分野だけの無関係な問題を復習扱いしない', () => {
    const seen = q('seen'); const variant = q('variant'); const unrelated = q('unrelated', { reviewConcepts: ['SQL集計'] });
    const history = [row(seen, '2026-10-20T05:00:00Z', true, 'unknown')];
    expect(selectRapid([seen, variant, unrelated], history, 'A-1', 10, now).reasons.variant).toContain('別問題で復習');
    expect(selectRapid([seen, variant, unrelated], history, 'A-1', 10, now).reasons.unrelated).toContain('未着手');
    const sure = [row(seen, '2026-10-20T05:00:00Z', true, 'sure')];
    expect(rapidStatus([seen, variant], sure, 'A-1', now).reviewDue).toBe(0);
    expect(rapidStatus([seen, variant], sure, 'A-1', now + 72 * 3600000)).toMatchObject({ reviewDue: 1, reviewReady: 1 });
  });
  it('わからない正解と未入力を区別し、別日・別問題での確信正解を定着候補にする', () => {
    const a = q('a'); const b = q('b');
    const unknown = row(a, '2026-10-17T00:00:00Z', true, 'unknown');
    const passed = row(a, '2026-10-18T00:00:00Z', true, 'sure');
    const repeated = row(a, '2026-10-19T00:00:00Z', true, 'sure');
    expect(conceptProgress([unknown], 'A-1')[0]).toMatchObject({ status: '基礎から確認', risk: 4 });
    expect(conceptProgress([unknown, passed, repeated], 'A-1')[0].transfer).toBe(false);
    expect(conceptProgress([passed, row(b, passed.at, true, 'sure')], 'A-1')[0].transfer).toBe(false);
    expect(conceptProgress([unknown, passed, row(b, repeated.at, true, 'sure')], 'A-1')[0]).toMatchObject({ transfer: true, status: '定着候補' });
    expect(conceptProgress([passed, row(b, repeated.at, true, 'sure'), row(a, '2026-10-20T00:00:00Z')], 'A-1')[0].transfer).toBe(false);
    const analysis = reviewAnalysis([a, b], [unknown, passed, repeated], 'A-1', now);
    expect(analysis).toMatchObject({ attempts: 3, unique: 1, repeated: 2, unknown: 1, sureCorrect: 2, firstCorrect: 1 });
    expect(analysis.concepts[0].alternatives).toBe(1);
  });
  it('実教材の公式問と独自類題を概念で結び、模試用・未検証・同一再録を除外する', () => {
    const bank = real(); const seen = bank.find(q => q.id === 'ipa-2025-spring-a1-29')!;
    const history = [row(seen, '2026-10-19T00:00:00Z')];
    const result = selectPractice(bank, history, 'A-1', 10, now);
    expect(result.questions.every(q => isFresh(q, history))).toBe(true);
    expect(result.questions.some(q => q.reviewConcepts?.includes('損益分岐点と変動費'))).toBe(true);
    const held = q('held', { heldOut: true }); const safe = q('safe'); const s = make([seen, safe, held, q('copy-held', { groupId: held.groupId })]);
    const session = s.newSession('A-1', 'practice', [seen], {}, 'past'); s.submit(session.id, 0);
    expect(() => s.create('A-1', 'practice', 10, reviewCollection)).toThrow('別問題がありません');
    const related = bank.find(q => q.id === 'review-a1-fixed-cost')!;
    s.db.prepare('INSERT INTO questions VALUES (?, ?, ?)').run(related.id, related.version, JSON.stringify(related));
    const next = s.create('A-1', 'practice', 10, reviewCollection);
    expect(next.questions.map(q => q.id)).toEqual([related.id]);
    // The unrelated topic alone must not be mistaken for the reviewed concept.
    expect(next.questions.every(q => isFresh(q as TrainingQuestion, s.history()))).toBe(true);
    expect(next.questions.some(q => q.id.includes('held'))).toBe(false);
  });
  it('既存のAIセットも開始時に既出なら関連問題へ置換し、途中保存と履歴を保持する', () => {
    const a = q('a'); const b = q('b'); const s = make([a, b]);
    const first = s.newSession('A-1', 'practice', [a], {}, 'first'); s.submit(first.id, 0);
    const context = s.exportContext('A-1');
    s.importSet({ ...context.nextSetTemplate, selected: [{ id: a.id, version: 1, reason: '外部から過去の問題が指定された' }] });
    expect(s.dashboard().imports[0].readyCount).toBe(1);
    const next = s.startImport(context.requestId);
    expect(next.questions.map(q => q.id)).toEqual(['b']); expect(next.questions[0].reviewConcepts).toBeUndefined();
    expect(next.questions[0].correctIndex).toBeUndefined();
    expect(s.startImport(context.requestId)).toEqual(next);
    s.submit(next.id, 0);
    expect(s.history()).toHaveLength(2); expect(s.session(first.id).questions[0]).toEqual(a);
    expect(() => s.create('A-1', 'practice', 10)).toThrow('別問題がありません');
    expect(s.dashboard().analysis[0].missingAlternatives).toBe(1);
  });
});

describe('追加した関連問題の確認', () => {
  const variants: TrainingQuestion[] = JSON.parse(readFileSync('materials/review-variants.json', 'utf8'));
  const answer = (id: string) => { const q = variants.find(q => q.id === `review-a1-${id}`)!; return q.choices[q.correctIndex]; };
  it('36問の出典・検証記録・各選択肢の解説があり、既存問題と本文・IDが重複しない', () => {
    expect(variants).toHaveLength(36);
    const bank = real(); expect(new Set(bank.map(q => q.id)).size).toBe(bank.length);
    expect(new Set(variants.map(q => q.prompt)).size).toBe(36);
    for (const q of variants) { validateQuestion(q); expect(q.choiceExplanations).toHaveLength(4); expect(q.review.status).toBe('verified'); expect(q.reviewConcepts?.length).toBeGreaterThan(0); }
  });
  it('電流・稼働率・会計・CPU・LRU・ハッシュ・論理を別手順で検算する', () => {
    const average = Array.from({ length: 100 }, (_, i) => i < 2 ? 10 : 0.02).reduce((a, b) => a + b, 0) / 100;
    expect(219.6 / average).toBeCloseTo(1000); expect(answer('power')).toBe('1,000時間');
    expect(198 / (198 + 2)).toBe(0.99); expect(answer('mttr')).toBe('2時間');
    const states = [[true, true, 0.72], [true, false, 0.18], [false, true, 0.08], [false, false, 0.02]] as const;
    expect(states.filter(([a, b]) => a || b).reduce((n, [, , p]) => n + p, 0)).toBeCloseTo(0.98); expect(answer('parallel')).toBe('0.98');
    const costAt1000 = 1000 - 100; const costAt1500 = 1500 - 300;
    const rate = (costAt1500 - costAt1000) / 500;
    expect(costAt1000 - rate * 1000).toBe(300); expect(answer('fixed-cost')).toBe('300万円');
    expect(1200 - 1200 * 0.6 - 250).toBe(230); expect(answer('target-sales')).toBe('1,200万円');
    expect((1e8 + 3e8) / 1e9).toBe(0.4); expect(answer('cpu-mix')).toBe('0.4秒');
    let misses = 0; const frames: number[] = [];
    for (const page of [1, 2, 3, 1, 4, 2, 5]) {
      const i = frames.indexOf(page); if (i < 0) { misses++; if (frames.length === 3) frames.shift(); } else frames.splice(i, 1);
      frames.push(page);
    }
    expect(misses).toBe(6); expect(answer('lru-trace')).toBe('6回'); expect(frames).toEqual([4, 2, 5]);
    expect([20, 31, 42].map(n => n % 11)).toEqual([9, 9, 9]); expect(answer('hash')).toBe('31と42');
    const logic = [false, true].flatMap(p => [false, true].map(q => ((p && !q) || (!p && q)) === (p !== q)));
    expect(logic.every(Boolean)).toBe(true);
    expect(answer('logic')).toContain('(P AND (NOT Q))');
    expect(answer('evm')).toContain(`SPI=${90 / 120}`); expect(answer('evm')).toContain(`CPI=${90 / 100}`);
  });
  it('追加補強のコード数・漸化式・区間更新・回収期間・帯域を独立に確認する', () => {
    expect(36 ** 3).toBeLessThan(200000); expect(36 ** 4).toBeGreaterThanOrEqual(200000); expect(answer('code-design')).toBe('4桁');
    const best = [0]; for (let n = 1; n <= 6; n++) best[n] = 1 + Math.min(...[1, 3, 4].filter(c => c <= n).map(c => best[n - c]));
    expect(best[6]).toBe(2); expect(answer('dynamic-programming')).toBe('動的計画法、2枚');
    let low = 1; let high = 2;
    for (let i = 0; i < 2; i++) { const mid = (low + high) / 2; if (mid ** 2 < 2) low = mid; else high = mid; }
    expect([low, high]).toEqual([1.25, 1.5]); expect(answer('bisection')).toBe('[1.25,1.5]');
    expect(Array.from({ length: 4 }, (_, years) => years).find(years => years * 300 >= 900)).toBe(3); expect(answer('payback')).toBe('3年');
    expect(640 * 480 * (24 / 8) * 30 / 1e6 * 8).toBe(221.184); expect(answer('bandwidth')).toBe('221.184Mbit/s');
    const missing = ['技術の事業化', 'MESと生産管理', '工程短縮の方法', '開発レビュー', 'コード設計と符号数', 'SBOM', 'エッジコンピューティング', 'プログラムマネジメント', 'SQLと分離レベル', '動的計画法', 'マシンビジョン', '二分法', '投資回収期間', 'アクセシビリティ', 'SQLインジェクション', '通信帯域と転送量'];
    for (const concept of missing) expect(variants.some(q => q.reviewConcepts?.includes(concept))).toBe(true);
  });
  it('外部キーの削除拒否と正規化の情報保存を実行で照合する', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec('CREATE TABLE products_search(name TEXT); INSERT INTO products_search VALUES (\'safe\')');
      expect(db.prepare('SELECT name FROM products_search WHERE name=?').all("x\' OR 1=1 --")).toHaveLength(0);
      db.exec('PRAGMA foreign_keys=ON; CREATE TABLE dept(id INTEGER PRIMARY KEY); CREATE TABLE employee(id INTEGER PRIMARY KEY, dept_id INTEGER NOT NULL REFERENCES dept(id) ON DELETE RESTRICT); INSERT INTO dept VALUES(10); INSERT INTO employee VALUES(1,10)');
      expect(() => db.exec('DELETE FROM dept WHERE id=10')).toThrow(); expect(answer('foreign-key')).toBe('部署の削除が拒否される');
      db.exec("CREATE TABLE orders(id INTEGER PRIMARY KEY, date TEXT); CREATE TABLE products(id INTEGER PRIMARY KEY, name TEXT); CREATE TABLE lines(oid INTEGER, pid INTEGER, qty INTEGER, PRIMARY KEY(oid,pid)); INSERT INTO orders VALUES(1,'2026-10-20'); INSERT INTO products VALUES(10,'A'),(20,'B'); INSERT INTO lines VALUES(1,10,2),(1,20,3)");
      const restored = db.prepare('SELECT o.id,p.id,o.date,p.name,l.qty FROM orders o JOIN lines l ON l.oid=o.id JOIN products p ON p.id=l.pid ORDER BY p.id').all();
      expect(restored.map(r => [r.date, r.name, r.qty])).toEqual([['2026-10-20', 'A', 2], ['2026-10-20', 'B', 3]]);
    } finally { db.close(); }
  });
});
