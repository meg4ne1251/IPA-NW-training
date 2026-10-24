import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { a1Coverage, a1SeenUnits, a1Unit } from '../src/domain/a1-coverage';
import { focusedPool, newOnlyCollection, selectFocused } from '../src/domain/focused';
import { blankAnswer } from '../src/domain/training';
import type { Outcome, TrainingQuestion } from '../src/domain/training';
import { withLearningPriority } from './learning-priorities';
import { withReviewConcepts } from './review-concepts';
import catalogue from '../materials/a1-learning-units.json';

const bank: TrainingQuestion[] = ['2025-spring', 'archive', 'a1-supplement', 'review-variants', 'focused-supplement']
  .flatMap(name => JSON.parse(readFileSync(`materials/${name}.json`, 'utf8')) as TrainingQuestion[])
  .map(withLearningPriority).map(withReviewConcepts);
const get = (id: string) => bank.find(q => q.id === id)!;
const result = (question: TrainingQuestion, at = '2026-10-20T12:00:00Z', correct = true, confidence: Outcome['answer']['confidence'] = 'sure'): Outcome => ({
  question, at, correct, sessionId: at, answer: { ...blankAnswer(), choice: correct ? question.correctIndex : (question.correctIndex + 1) % 4, confidence },
});

describe('A-1の共通論点分類', () => {
  it('全738問を1つずつ分類し、同じ問題群が別論点へ分裂しない', () => {
    const a1 = bank.filter(q => q.section === 'A-1');
    const assigned = catalogue.units.flatMap(u => u.questionIds);
    expect(assigned).toHaveLength(738); expect(new Set(assigned)).toEqual(new Set(a1.map(q => q.id)));
    expect(new Set(catalogue.units.map(u => u.id)).size).toBe(catalogue.units.length);
    const families = new Map<string, string>();
    for (const q of a1) {
      const unit = a1Unit(q)!; expect(unit).toBeDefined();
      if (families.has(q.groupId)) expect(unit.id).toBe(families.get(q.groupId));
      families.set(q.groupId, unit.id);
    }
    expect(a1Coverage(bank, []).unclassified).toBe(0);
  });

  it('公式過去問・補強・復習問題で正規化を統一し、同じDB分野の外部キーやSQLを残す', () => {
    const normal = get('ipa-2025-spring-a1-09');
    expect(a1Unit(normal)?.id).toBe('db-normalization');
    const history = [result(normal)];
    const pool = focusedPool(bank, history, 'A-1', newOnlyCollection);
    const ids = new Set(pool.map(x => x.question.id));
    expect(ids.has('review-a1-normalization')).toBe(false);
    expect(ids.has('supplement-a1-db-design-03')).toBe(false);
    expect(ids.has('supplement-a1-db-design-04')).toBe(false);
    expect(ids.has('supplement-a1-db-design-02')).toBe(true);
    expect(ids.has('supplement-a1-sql-01')).toBe(true);
    expect(pool.some(x => x.question.topic === normal.topic)).toBe(true);
  });

  it('ラベルの部分一致によるDNSとCPU、汎化と継承、リストとリストアの混同を防ぐ', () => {
    expect(a1Unit(get('supplement-a1-protocol-03'))?.id).toBe('net-dns');
    const findLabel = (text: string) => bank.find(q => q.section === 'A-1' && q.tags.includes(text))!;
    expect(a1Unit(findLabel('DNSキャッシュポイズニング対策'))?.id).toBe('sec-dns-attack');
    expect(a1Unit(findLabel('汎化の適切な例はどれか'))?.id).toBe('dev-object');
    expect(a1Unit(findLabel('リストア後にログを用いて行う操作'))?.id).toBe('db-recovery');
    expect(a1Unit(findLabel('二分探索木'))?.id).toBe('recursion-tree');
  });

  it('古い分類・退役済みの履歴でもIDで論点を照合し、別科目の履歴を使わない', () => {
    const q = get('supplement-a1-db-design-03');
    const old = { ...q, topic: '古い分野', tags: [], reviewConcepts: undefined, review: { ...q.review, status: 'retired' as const } };
    const history = [result(old)];
    expect(a1SeenUnits(bank, history).has('db-normalization')).toBe(true);
    expect(a1Coverage(bank, history).units.find(u => u.id === 'db-normalization')?.status).toBe('confirming');
    expect(a1SeenUnits(bank, [result({ ...old, section: 'A-2' })]).size).toBe(0);
  });

  it('IDが変わった履歴でも同じ問題群なら現在の分類を優先し、集計と選抜を一致させる', () => {
    const current = get('supplement-a1-db-design-03');
    const historical = { ...current, id: 'old-import', tags: ['旧分類'], reviewConcepts: ['旧分類'] };
    const history = [result(historical)];
    expect(a1SeenUnits([current], history).has('db-normalization')).toBe(true);
    expect(a1Coverage([current], history).unseen).toBe(0);
    expect(focusedPool([current], history, 'A-1', newOnlyCollection)).toEqual([]);
  });

  it('不明な問題文由来のタグを勝手に論点へせず、同じ論点の正規名・別名は照合する', () => {
    const base = get('supplement-a1-db-design-03');
    const imported = { ...base, id: 'imported', groupId: 'imported', reviewConcepts: undefined };
    expect(a1Unit(imported)?.id).toBe('db-normalization');
    const unknown = { ...imported, tags: ['値は何になるか'], learning: undefined };
    expect(a1Unit(unknown)).toBeUndefined();
    expect(a1Coverage([unknown], []).unclassified).toBe(1);
    expect(focusedPool([unknown], [], 'A-1', newOnlyCollection)).toEqual([]);
  });
});

describe('着手と定着の区別', () => {
  const a = get('supplement-a1-db-design-03'); const b = get('supplement-a1-db-design-04');
  const status = (history: Outcome[]) => a1Coverage([a, b], history).units[0].status;
  it('未回答の一括提出は未着手に保ち、選択肢なしの「わからない」は要復習にする', () => {
    const blank = { ...result(a), correct: false, answer: blankAnswer() };
    expect(status([blank])).toBe('unseen');
    expect(a1SeenUnits(bank, [blank]).size).toBe(0);
    expect(focusedPool([a, b], [blank], 'A-1', newOnlyCollection)).toHaveLength(2);
    const unknown = { ...blank, answer: { ...blankAnswer(), confidence: 'unknown' as const } };
    expect(status([unknown])).toBe('review');
    expect(focusedPool([a, b], [unknown], 'A-1', newOnlyCollection)).toEqual([]);
  });

  it('確信正解1回は確認中、別日に異なる問題で確信正解すると定着候補にする', () => {
    const first = result(a);
    expect(status([first])).toBe('confirming');
    expect(status([first, result(a, '2026-10-21T12:00:00Z')])).toBe('confirming');
    expect(status([first, result(b, '2026-10-20T13:00:00Z')])).toBe('confirming');
    expect(status([first, result(b, '2026-10-21T12:00:00Z')])).toBe('candidate');
    const reprint = { ...b, groupId: a.groupId };
    expect(status([first, result(reprint, '2026-10-21T12:00:00Z')])).toBe('confirming');
  });

  it('誤答・迷いで候補を取り消し、その後の別日・別問題で再確認する', () => {
    const history = [result(a), result(b, '2026-10-21T12:00:00Z')];
    history.push(result(a, '2026-10-22T12:00:00Z', false)); expect(status(history)).toBe('review');
    history.push(result(a, '2026-10-23T12:00:00Z')); expect(status(history)).toBe('confirming');
    history.push(result(b, '2026-10-24T12:00:00Z', true, 'guess')); expect(status(history)).toBe('review');
    history.push(result(a, '2026-10-25T12:00:00Z')); expect(status(history)).toBe('confirming');
    history.push(result(b, '2026-10-26T12:00:00Z')); expect(status(history)).toBe('candidate');
  });

  it('未検証の別問題での正解だけでは定着候補にしない', () => {
    const draft = { ...b, review: { ...b.review, status: 'draft' as const } };
    expect(status([result(a), result(draft, '2026-10-21T12:00:00Z')])).toBe('confirming');
  });

  it('表示の4状態の合計が論点総数と一致し、最初の30問は異なる論点を広く選ぶ', () => {
    const history = [result(a, undefined, false), result(get('supplement-a1-crypto-01'))];
    const coverage = a1Coverage(bank, history);
    expect(coverage.unseen + coverage.review + coverage.confirming + coverage.candidate).toBe(coverage.total);
    expect(coverage.fields.reduce((n, f) => n + f.total, 0)).toBe(coverage.total);
    const selected = selectFocused(bank, history, 'A-1', newOnlyCollection, 30);
    expect(new Set(selected.questions.map(q => a1Unit(q)?.id)).size).toBe(30);
    expect(new Set(selected.questions.map(q => a1Unit(q)?.field)).size).toBeGreaterThan(10);
    expect(selected.questions.every(q => !a1SeenUnits(bank, history).has(a1Unit(q)!.id))).toBe(true);
  });
});
