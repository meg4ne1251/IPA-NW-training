import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blankAnswer } from '../src/domain/training';
import type { Outcome, TrainingQuestion } from '../src/domain/training';
import { learningArea, rapidCollection, selectRapid } from '../src/domain/rapid';
import type { LearningArea } from '../src/domain/rapid';
import { withLearningPriority } from './learning-priorities';
import { TrainingStore } from './store';

const now = Date.parse('2026-10-18T12:00:00Z');
const q = (id: string, area: LearningArea = 'technology', changes: Partial<TrainingQuestion> = {}): TrainingQuestion => ({
  id, version: 1, section: 'A-1', topic: area, tags: [id], prompt: id, choices: ['a', 'b', 'c', 'd'], correctIndex: 0,
  explanation: '確認済みの解説', origin: 'past', groupId: id, heldOut: false,
  learning: { area, concept: id, occurrences: 1 }, source: { label: 'test', url: 'https://example.com/question' },
  review: { status: 'verified', method: '確認済み', reviewer: 'test', at: new Date(now).toISOString(), references: ['https://example.com/reference'] }, ...changes,
});
const outcome = (question: TrainingQuestion, hoursAgo: number, correct = false): Outcome => ({ question, correct, at: new Date(now - hoursAgo * 3600000).toISOString(), sessionId: 'previous', answer: { ...blankAnswer(), choice: correct ? 0 : 1, confidence: 'sure' } });
const balanced = () => (['technology', 'management', 'strategy'] as const).flatMap(area => Array.from({ length: 40 }, (_, i) => q(`${area}-${i}`, area)));
const real = (): TrainingQuestion[] => ['2025-spring', 'archive', 'a1-supplement'].flatMap(name => JSON.parse(readFileSync(`materials/${name}.json`, 'utf8')) as TrainingQuestion[]);
const stores: TrainingStore[] = []; const dirs: string[] = [];
afterEach(() => { stores.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });
function make() { const dir = mkdtempSync(join(tmpdir(), 'nw-rapid-')); dirs.push(dir); const s = new TrainingStore(dir, real()); stores.push(s); return s; }

describe('短期集中の出題', () => {
  it('A-1を17:5:8で配分し、10問でも端数を正しく配る', () => {
    for (const [count, expected] of [[30, [17, 5, 8]], [10, [6, 2, 2]]] as const) {
      const selected = selectRapid(balanced(), [], 'A-1', count, now);
      expect(['technology', 'management', 'strategy'].map(a => selected.questions.filter(q => learningArea(q) === a).length)).toEqual(expected);
    }
  });
  it('未着手8問と時間を空けた復習2問を選び、直後の同内容を避ける', () => {
    const fresh = Array.from({ length: 20 }, (_, i) => q(`new-${i}`));
    const reviews = Array.from({ length: 6 }, (_, i) => q(`review-${i}`));
    const recent = q('recent');
    const selected = selectRapid([...fresh, ...reviews, recent], [...reviews.map(q => outcome(q, 8)), outcome(recent, 0)], 'A-1', 10, now);
    expect(selected.questions.filter(q => q.id.startsWith('new'))).toHaveLength(8);
    expect(selected.questions.filter(q => q.id.startsWith('review'))).toHaveLength(2);
    expect(selected.questions).not.toContain(recent);
    expect(selectRapid([recent, q('new-only')], [outcome(recent, 0)], 'A-1', 10, now).questions.map(q => q.id)).toEqual(['new-only']);
  });
  it('最新の正解を尊重し、頻出問題と解説がある問題を優先する', () => {
    const a = q('a'); const frequent = q('z', 'technology', { learning: { area: 'technology', concept: 'z', occurrences: 8 } });
    expect(selectRapid([a, frequent], [], 'A-1', 1, now).questions[0].id).toBe('z');
    const unclassified = q('a', 'technology', { explanation: '詳しい解説・分野分類は未追加' });
    expect(selectRapid([unclassified, q('b')], [], 'A-1', 1, now).questions[0].id).toBe('b');
    const failed = outcome(a, 12); const passed = outcome(a, 1, true);
    expect(selectRapid([a, q('unseen')], [passed, failed], 'A-1', 10, now).questions.map(q => q.id)).toEqual(['unseen']);
  });
  it('未検証・模試用の派生グループを除き、AIは2割以内、重複で水増ししない', () => {
    const held = q('held', 'technology', { heldOut: true });
    const bank = [...balanced(), ...Array.from({ length: 15 }, (_, i) => q(`ai-${i}`, 'strategy', { origin: 'ai' })), held,
      q('copy-held', 'technology', { groupId: held.groupId }), q('draft', 'technology', { review: { ...held.review, status: 'draft' } })];
    const selected = selectRapid(bank, [], 'A-1', 30, now).questions;
    expect(selected).toHaveLength(30); expect(new Set(selected.map(q => q.groupId)).size).toBe(30);
    expect(selected.filter(q => q.origin === 'ai').length).toBeLessThanOrEqual(6);
    expect(selected.some(q => q.id === 'held' || q.id === 'copy-held' || q.id === 'draft')).toBe(false);
    expect(selectRapid([q('one'), q('copy', 'technology', { groupId: 'one' })], [], 'A-1', 10, now).questions).toHaveLength(1);
  });
});

describe('分析と実教材・保存・継続の接続', () => {
  it('全795問を分類し、再出題をまとめ、既存の正答やスナップショットを変えない', () => {
    const bank = real(); const enriched = bank.filter(q => q.origin === 'past').map(withLearningPriority);
    expect(enriched).toHaveLength(795); expect(enriched.every(q => q.learning && q.topic !== '未分類')).toBe(true);
    expect(new Set(enriched.map(q => q.groupId)).size).toBe(664);
    const first = enriched.find(q => q.id === 'ipa-2025-spring-a1-01')!;
    const repeated = enriched.find(q => q.id === 'ipa-2016h28a-koudo-am1-01')!;
    expect(first.groupId).toBe(repeated.groupId);
    expect(first.correctIndex).toBe(bank.find(q => q.id === first.id)!.correctIndex);
    const heldCopy = { ...bank.find(q => q.id === first.id)!, id: 'held-copy', groupId: first.id, heldOut: true };
    expect(withLearningPriority(heldCopy).groupId).toBe(first.groupId);
  });
  it('両科目で集中テストを保存し、再開・履歴・次の選抜で重複を抑える', () => {
    const store = make();
    for (const section of ['A-1', 'A-2'] as const) {
      const initial = store.create(section, 'practice', 10, rapidCollection);
      expect(initial.questions).toHaveLength(10); expect(initial.deadline).toBeNull();
      expect(initial.title).toContain('短期集中テスト'); expect(initial.practiceScope?.collection).toBe(rapidCollection);
      expect(initial.questions.every(q => q.learning === undefined && q.tags.length === 0 && q.correctIndex === undefined)).toBe(true);
      const groupIds = new Set(initial.questions.map(q => q.groupId));
      const reopened = new TrainingStore(store.directory); stores.push(reopened);
      expect(reopened.publicSession(reopened.session(initial.id))).toEqual(initial);
      const before = store.dashboard().rapid.find(s => s.section === section)!.unseen;
      let current = store.save(initial.id, { revision: 0, currentIndex: 0, answers: { [initial.questions[0].id]: { ...blankAnswer(), confidence: 'unknown' } } });
      current = store.grade(current.id, initial.questions[0].id, current.revision);
      expect(store.dashboard().rapid.find(s => s.section === section)!.unseen).toBe(before - 1);
      store.submit(current.id, current.revision);
      const next = store.create(section, 'practice', 10, rapidCollection);
      expect(next.questions.every(q => !groupIds.has(q.groupId))).toBe(true);
      store.submit(next.id, next.revision);
    }
    expect(() => store.create('A-1', 'exam', 30, rapidCollection)).toThrow('練習');
    expect(() => store.create('A-1', 'practice', 10, rapidCollection, { topic: 'SQL' })).toThrow('補強問題');
  });
  it('実教材の30問でも専門分野の配分と異なる論点を確保する', () => {
    const bank = real().map(withLearningPriority);
    const short = selectRapid(bank, [], 'A-1', 10, now).questions;
    expect(short.some(q => /セキュリティ/.test(q.topic))).toBe(true);
    expect(short.some(q => /ネットワーク/.test(q.topic))).toBe(true);
    expect(new Set(short.map(q => q.topic)).size).toBeGreaterThanOrEqual(8);
    const a1 = selectRapid(bank, [], 'A-1', 30, now).questions;
    expect(['technology', 'management', 'strategy'].map(a => a1.filter(q => learningArea(q) === a).length)).toEqual([17, 5, 8]);
    expect(new Set(a1.map(q => q.topic)).size).toBeGreaterThanOrEqual(12);
    const a2 = selectRapid(bank, [], 'A-2', 25, now).questions;
    expect(['network', 'security', 'other'].map(a => a2.filter(q => learningArea(q) === a).length)).toEqual([15, 6, 4]);
  });
});
