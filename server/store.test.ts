import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TrainingStore } from './store';
import { blankAnswer, selectPractice, topicStats, validateQuestion } from '../src/domain/training';
import type { TrainingQuestion, Outcome } from '../src/domain/training';
const q = (id: string, overrides: Partial<TrainingQuestion> = {}): TrainingQuestion => ({ id, version: 1, section: 'A-1', topic: 'ネットワーク', tags: ['CIDR'], prompt: `${id} /27のホスト数は？`, choices: ['14', '30', '32', '62'], correctIndex: 1, explanation: '2の5乗から2を引き30。', origin: 'original', groupId: id, heldOut: false, source: { label: '独自問題', url: 'https://example.com/source' }, review: { status: 'verified', method: '検算済み', reviewer: 'test', at: '2026-10-16T00:00:00Z', references: ['https://example.com/source'] }, ...overrides });
const directories: string[] = []; const stores: TrainingStore[] = [];
const make = () => { const directory = mkdtempSync(join(tmpdir(), 'nw-store-')); directories.push(directory); const store = new TrainingStore(directory, Array.from({ length: 35 }, (_, i) => q(`q-${String(i).padStart(2, '0')}`))); stores.push(store); return store; };
afterEach(() => { for (const store of stores.splice(0)) { try { store.close(); } catch {} } for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function completed(store: TrainingStore) { const s = store.create('A-1', 'practice', 3); const saved = store.save(s.id, { revision: 0, currentIndex: 1, answers: { [s.questions[0].id]: { ...blankAnswer(), choice: 1, confidence: 'unsure' } } }); return store.submit(s.id, saved.revision); }

describe('SQLiteでの学習とAI受け渡し', () => {
  it('最新回答の保存と採点を同じトランザクションで確定し、再送で変更しない', () => {
    const store = make(); const s = store.create('A-1', 'practice', 2); const id = s.questions[0].id;
    const draft = { revision: 0, currentIndex: 0, answers: { [id]: { ...blankAnswer(), choice: 1, confidence: 'unsure', seconds: 12 } } };
    const result = store.grade(s.id, id, 0, draft);
    expect(result.answers[id]).toMatchObject({ choice: 1, confidence: 'unsure', seconds: 12 });
    expect(result.questions[0].correctIndex).toBe(1);
    expect(result.questions[1].correctIndex).toBeUndefined();
    expect(store.history()).toHaveLength(1);
    expect(store.grade(s.id, id, 0, { ...draft, answers: {} })).toEqual(result);
  });
  it('保存を伴う採点の検証失敗・版番号競合では途中回答も書き換えない', () => {
    const store = make(); const s = store.create('A-1', 'practice', 2); const id = s.questions[0].id;
    expect(() => store.grade(s.id, id, 0, { revision: 0, currentIndex: 1, answers: {} })).toThrow('解答を選ぶか');
    expect(store.session(s.id).currentIndex).toBe(0); expect(store.session(s.id).revision).toBe(0);
    const saved = store.save(s.id, { revision: 0, currentIndex: 0, answers: { [id]: { ...blankAnswer(), choice: 1 } } });
    expect(() => store.grade(s.id, id, 0, { revision: 0, currentIndex: 1, answers: {} })).toThrow('回答が更新');
    expect(() => store.grade(s.id, id, saved.revision, { revision: 0, currentIndex: 1, answers: {} })).toThrow('別の画面');
    expect(store.session(s.id).answers[id].choice).toBe(1); expect(store.session(s.id).graded).toBeUndefined();
  });
  it('最新回答を含む一括提出を1回で保存し、二重提出でも結果を保持する', () => {
    const store = make(); const s = store.create('A-1', 'practice', 2); const id = s.questions[0].id;
    const draft = { revision: 0, currentIndex: 1, answers: { [id]: { ...blankAnswer(), choice: 1 } } };
    const result = store.submit(s.id, 0, draft);
    expect(result.status).toBe('submitted'); expect(result.answers[id].choice).toBe(1);
    expect(store.submit(s.id, 0, { ...draft, answers: {} })).toEqual(result);
    expect(store.history()).toHaveLength(2);
  });
  it.each(['grade', 'submit'] as const)('期限切れの%sでは同梱した未保存回答を取り込まない', command => {
    const store = make(); const s = store.create('A-1', 'practice', 2); const id = s.questions[0].id;
    const internal = store.session(s.id); internal.deadline = new Date(Date.now() - 1000).toISOString(); store.writeSession(internal);
    const draft = { revision: 0, currentIndex: 0, answers: { [id]: { ...blankAnswer(), choice: 1 } } };
    const result = command === 'grade' ? store.grade(s.id, id, 0, draft) : store.submit(s.id, 0, draft);
    expect(result.status).toBe('submitted'); expect(result.answers[id].choice).toBeNull();
  });
  it('1問ずつ正答を公開し、再開・履歴・AI出力で途中の採点を保持する', () => {
    const store = make(); const s = store.create('A-1', 'practice', 2); const id = s.questions[0].id;
    expect(() => store.grade(s.id, id, 0)).toThrow('解答を選ぶか');
    const saved = store.save(s.id, { revision: s.revision, currentIndex: 0, answers: { [id]: { ...blankAnswer(), choice: 1, confidence: 'sure', seconds: 12 } } });
    expect(() => store.grade(s.id, 'unknown', saved.revision)).toThrow('セットにない');
    expect(() => store.grade(s.id, id, 0)).toThrow('回答が更新');
    const graded = store.grade(s.id, id, saved.revision);
    expect(graded.status).toBe('active');
    expect(graded.questions[0].correctIndex).toBe(1);
    expect(graded.questions[0].explanation).toBeTruthy();
    expect(graded.questions[1].correctIndex).toBeUndefined();
    expect(graded.questions[1].explanation).toBeUndefined();
    expect(store.grade(s.id, id, saved.revision)).toEqual(graded);
    expect(store.history()).toHaveLength(1);
    expect(store.dashboard().stats[0].attempts).toBe(1);
    const context = store.exportContext('A-1');
    expect(context.history).toHaveLength(1);
    expect(context.history[0].answer.seconds).toBe(12);
    const reopened = new TrainingStore(store.directory); stores.push(reopened);
    expect(reopened.publicSession(reopened.session(s.id))).toEqual(graded);
    const next = reopened.save(s.id, { revision: graded.revision, currentIndex: 1, answers: { ...graded.answers, [s.questions[1].id]: { ...blankAnswer(), confidence: 'unknown' } } });
    const result = reopened.grade(s.id, s.questions[1].id, next.revision);
    expect(result.status).toBe('submitted');
    expect(reopened.history()).toHaveLength(2);
    expect(reopened.history().filter(r => r.correct)).toHaveLength(1);
    expect(reopened.history()[1].answer.confidence).toBe('unknown');
    expect(reopened.history()[0].at).toBe(graded.graded![id]);
    expect(reopened.grade(s.id, id, 0)).toEqual(result);
    expect(reopened.revision()).toBeGreaterThan(context.historyRevision);
  });
  it('採点後の解答・自信度を変更できず、解説を読む時間を解答時間に加算しない', () => {
    const store = make(); const s = store.create('A-1', 'practice', 2); const id = s.questions[0].id;
    const saved = store.save(s.id, { revision: 0, currentIndex: 0, answers: { [id]: { ...blankAnswer(), choice: 0, confidence: 'guess', seconds: 4 } } });
    const graded = store.grade(s.id, id, saved.revision);
    for (const patch of [{ choice: 1 }, { confidence: 'sure' }, { reason: 'changed' }]) {
      expect(() => store.save(s.id, { revision: graded.revision, currentIndex: 0, answers: { ...graded.answers, [id]: { ...graded.answers[id], ...patch } } })).toThrow('採点済み');
    }
    const moved = store.save(s.id, { revision: graded.revision, currentIndex: 1, answers: { ...graded.answers, [id]: { ...graded.answers[id], seconds: 99, flagged: true } } });
    expect(moved.answers[id]).toMatchObject({ choice: 0, confidence: 'guess', seconds: 4, flagged: true });
    expect(store.history()[0].correct).toBe(false);
  });
  it('1問ずつの採点でも時間切れ時は保存済み回答で終了する', () => {
    const store = make(); const s = store.create('A-1', 'practice', 2);
    const internal = store.session(s.id); internal.deadline = new Date(Date.now() - 1000).toISOString(); store.writeSession(internal);
    const result = store.grade(s.id, s.questions[0].id, 0);
    expect(result.status).toBe('submitted');
    expect(result.graded).toBeUndefined();
    expect(store.history()).toHaveLength(2);
  });

  it('わからないを再接続・提出・AI出力まで保持し、未入力や推測と区別する', () => {
    const store = make(); const s = store.create('A-1', 'practice', 3);
    const answers = Object.fromEntries(s.questions.map((q, i) => [q.id, { ...blankAnswer(), choice: i === 0 ? 1 : null, confidence: (['unknown', 'guess', null] as const)[i] }]));
    const saved = store.save(s.id, { revision: 0, currentIndex: 0, answers });
    const reopened = new TrainingStore(store.directory); stores.push(reopened);
    expect(reopened.session(s.id).answers[s.questions[0].id].confidence).toBe('unknown');
    reopened.submit(s.id, saved.revision);
    const context = reopened.exportContext('A-1');
    expect(context.history.map(r => r.answer.confidence)).toEqual(['unknown', 'guess', null]);
    expect(context.history[0].correct).toBe(true);
    expect(context.instruction).toContain('基礎から学習');
  });
  it('回答の保存・再開・未回答採点・二重提出・教材版の保持', () => {
    const store = make(); const s = store.create('A-1', 'practice', 3);
    expect(s.questions[0].correctIndex).toBeUndefined();
    const answers = { [s.questions[0].id]: { ...blankAnswer(), choice: 1, confidence: 'unsure' as const } };
    const saved = store.save(s.id, { revision: 0, currentIndex: 1, answers });
    expect(() => store.save(s.id, { revision: 0, currentIndex: 0, answers })).toThrow('別の画面');
    const second = new TrainingStore(store.directory); stores.push(second);
    expect(second.session(s.id).currentIndex).toBe(1);
    expect(second.session(s.id).answers[s.questions[0].id].choice).toBe(1);
    const result = second.submit(s.id, saved.revision);
    expect(second.submit(s.id, saved.revision)).toEqual(result);
    expect(second.history()).toHaveLength(3);
    expect(second.history().filter(r => r.correct)).toHaveLength(1);
    expect(second.history().filter(r => r.answer.choice === null)).toHaveLength(2);
    expect(topicStats(second.history())[0].uncertain).toBe(1);
    expect(result.questions[0].version).toBe(1);
  });
  it('不正な回答や位置を保存せず、途中状態を保つ', () => {
    const store = make(); const s = store.create('A-1', 'practice', 1);
    for (const answers of [{ unknown: blankAnswer() }, { [s.questions[0].id]: { ...blankAnswer(), choice: 9 } }, { [s.questions[0].id]: { ...blankAnswer(), seconds: -1 } }]) {
      expect(() => store.save(s.id, { revision: 0, currentIndex: 0, answers })).toThrow();
    }
    expect(store.session(s.id).revision).toBe(0);
  });
  it('提出前は正答を示す概念タグや教材用の見出しを隠す', () => {
    const store = make();
    const internal = { ...store.session(store.create('A-1', 'practice', 1).id) };
    internal.questions[0] = q('past', { origin: 'past', prompt: '正答名を含む教材用見出し', tags: ['正答名'], source: { label: '出典', url: 'https://example.com/source', number: 11 } });
    const safe = store.publicSession(internal);
    expect(safe.questions[0].prompt).toBe('原本の問11を解いてください');
    expect(safe.questions[0].tags).toEqual([]);
    expect(safe.questions[0].correctIndex).toBeUndefined();
  });
  it('時間切れには最後に保存した回答だけを確定し、再読込で延長しない', () => {
    const store = make(); const s = store.create('A-1', 'practice', 2);
    const internal = store.session(s.id); internal.deadline = new Date(Date.now() - 1000).toISOString(); store.writeSession(internal);
    const expired = store.save(s.id, { revision: 0, currentIndex: 0, answers: { [s.questions[0].id]: { ...blankAnswer(), choice: 1 } } });
    expect(expired.status).toBe('submitted'); expect(expired.answers[s.questions[0].id].choice).toBeNull();
    store.expire(); expect(store.revision()).toBe(1);
  });
  it('結果出力→AIセット取り込み→次の演習を一巡できる', () => {
    const store = make(); completed(store); const context = store.exportContext('A-1');
    expect(existsSync(join(store.directory, 'exports', context.requestId, 'learning-context.json'))).toBe(true);
    const record = store.importSet({ ...context.nextSetTemplate, selected: context.nextSetTemplate.selected.slice(0, 5) });
    expect(store.importSet(context.nextSetTemplate).requestId).toBe(record.requestId);
    const next = store.startImport(record.requestId);
    expect(next.questions).toHaveLength(5); expect(next.mode).toBe('imported');
    expect(store.startImport(record.requestId).id).toBe(next.id);
  });
  it('AI自己申告のverifiedを信用せず、内容検証後にだけ出題する', () => {
    const store = make(); completed(store); const context = store.exportContext('A-1');
    const fresh = q('new-ai', { origin: 'ai', choiceExplanations: ['小さ過ぎる', '正答', '予約分を除く', '大き過ぎる'] });
    store.importSet({ ...context.nextSetTemplate, newQuestions: [fresh], selected: [{ id: fresh.id, version: 1, reason: '弱点の数値変更' }] });
    expect(store.bank().find(q => q.id === fresh.id)?.review.status).toBe('draft');
    expect(() => store.startImport(context.requestId)).toThrow('検証済み');
    store.verify(fresh.id, '2の5乗から予約2個を引き独立に検算した', 'https://example.com/verified', 'tester');
    expect(store.startImport(context.requestId).questions[0].id).toBe(fresh.id);
  });
  it('不正なセットを一部だけ取り込まず、古い履歴による依頼も拒否する', () => {
    const store = make(); completed(store); const context = store.exportContext('A-1'); const before = store.bank().length;
    const fresh = q('bad-ai', { origin: 'ai', choiceExplanations: ['a', 'b', 'c', 'd'] });
    expect(() => store.importSet({ ...context.nextSetTemplate, newQuestions: [fresh], selected: [{ id: fresh.id, version: 1, reason: '補強' }, { id: 'unknown', version: 1, reason: '不正' }] })).toThrow();
    expect(store.bank()).toHaveLength(before); expect(store.records('imports')).toHaveLength(0);
    completed(store); expect(() => store.importSet(context.nextSetTemplate)).toThrow('履歴が増え');
  });
  it.each(['disputed', 'retired'] as const)('新版の追加後も旧版の%sを集計へ反映し、当時の教材と採点を保持する', status => {
    const store = make(); const submitted = completed(store); const original = submitted.questions[0];
    const flagged = { ...original, review: { ...original.review, status } };
    store.db.prepare('UPDATE questions SET payload=? WHERE id=? AND version=?').run(JSON.stringify(flagged), original.id, original.version);
    const revised = { ...original, version: original.version + 1, correctIndex: 0, explanation: '新版で修正した解説' };
    store.db.prepare('INSERT INTO questions VALUES (?, ?, ?)').run(revised.id, revised.version, JSON.stringify(revised));
    expect(store.bank().find(q => q.id === original.id)?.version).toBe(2);
    const old = store.history().find(r => r.question.id === original.id)!;
    expect(old.question.version).toBe(1); expect(old.question.review.status).toBe(status);
    expect(old.question.correctIndex).toBe(original.correctIndex); expect(old.question.explanation).toBe(original.explanation);
    expect(old.correct).toBe(true);
    expect(store.dashboard().stats[0].attempts).toBe(2); expect(store.dashboard().stats[0].correct).toBe(0);
    const snapshot = store.session(submitted.id).questions[0];
    expect(snapshot).toEqual(original);
  });
  it('整合性のあるバックアップから履歴を復元できる', () => {
    const store = make(); completed(store); const backup = store.backup();
    const restored = new DatabaseSync(backup.sqlite);
    expect(restored.prepare('SELECT COUNT(*) as n FROM sessions').get()!.n).toBe(1); restored.close();
  });
});
describe('選抜と入力検証', () => {
  it('未検証・模試用・同じグループを出題せず、件数不足を返す', () => {
    const bank = [q('safe'), q('copy', { groupId: 'safe' }), q('held', { heldOut: true }), q('held-copy', { groupId: 'held' }), q('draft', { review: { ...q('x').review, status: 'draft' } })];
    const result = selectPractice(bank, [], 'A-1', 30);
    expect(result.questions).toHaveLength(1); expect(result.shortage).toBe(29);
  });
  it('分類が未追加の既出問題も再出題せず、未着手を選ぶ', () => {
    const weak = q('weak', { tags: [] }); const row: Outcome = { question: weak, answer: { ...blankAnswer(), choice: 0, confidence: 'sure' }, correct: false, at: '2026-10-16T00:00:00Z', sessionId: 'test' };
    const result = selectPractice([weak, ...Array.from({ length: 30 }, (_, i) => q(`new-${i}`, { tags: [] }))], [row], 'A-1', 10);
    expect(result.questions.some(q => q.id === 'weak')).toBe(false); expect(result.questions.filter(q => q.id.startsWith('new'))).toHaveLength(10);
  });
  it('未回答・正答・選択肢・根拠の不正を拒否する', () => {
    expect(() => validateQuestion(q('x', { correctIndex: 4 }))).toThrow();
    expect(() => validateQuestion(q('x', { choices: ['a', 'a', 'b', 'c'] }))).toThrow();
    expect(() => validateQuestion(q('x', { source: { label: 'unsafe', url: 'javascript:alert(1)' } }))).toThrow();
  });
  it('同じ問題を理解して再正解したら、古い誤答だけで苦手扱いし続けない', () => {
    const question = q('weak');
    const failed: Outcome = { question, answer: { ...blankAnswer(), choice: 0, confidence: 'sure' }, correct: false, at: '2026-10-15T00:00:00Z', sessionId: 'first' };
    const passed: Outcome = { question, answer: { ...blankAnswer(), choice: 1, confidence: 'sure' }, correct: true, at: '2026-10-16T00:00:00Z', sessionId: 'second' };
    const next = selectPractice([question, q('new')], [failed, passed], 'A-1', 2, Date.parse(passed.at));
    expect(Object.values(next.reasons)).not.toContain('苦手な概念を類題・関連問題で補強');
  });
});
