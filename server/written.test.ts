import { afterEach, expect, test } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TrainingStore } from './store';
import { WrittenConflictError } from './written';
import type { WrittenSession } from '../src/domain/written';
const directories: string[] = []; const stores: TrainingStore[] = [];
function make(directory = mkdtempSync(join(tmpdir(), 'nw-written-'))) {
  if (!directories.includes(directory)) directories.push(directory);
  const store = new TrainingStore(directory); stores.push(store); return store;
}
const draft = (s: WrittenSession) => ({ revision: s.revision, answers: s.answers, assessments: s.assessments, notes: s.notes, page: s.page });
afterEach(() => { stores.splice(0).forEach(s => s.close()); directories.splice(0).forEach(d => rmSync(d, { recursive: true, force: true })); });

test('公式3年分15大問の319回答欄と原本・図表がそろっていて解答前に答えを返さない', () => {
  const store = make(); const dashboard = store.written.dashboard();
  expect(dashboard.questions).toHaveLength(15);
  expect(new Set(dashboard.questions.map(q => q.id)).size).toBe(15);
  expect(dashboard.questions.reduce((n,q) => n+q.slotCount,0)).toBe(319);
  for (const [year, slots] of [[2025, 108], [2024, 104], [2023, 107]]) {
    const questions = dashboard.questions.filter(q => q.year === year);
    expect(questions.filter(q => q.section === 'B-1')).toHaveLength(3);
    expect(questions.filter(q => q.section === 'B-2')).toHaveLength(2);
    expect(questions.reduce((n, q) => n + q.slotCount, 0)).toBe(slots);
  }
  for (const q of dashboard.questions) {
    let s = store.written.create(q.id);
    expect(s.question.guide).toBeUndefined(); expect(s.question.source.answerUrl).toBeUndefined();
    expect(s.question.source.localAnswer).toBeUndefined(); expect(s.question.source.localComment).toBeUndefined();
    expect(s.question.slots.every(slot => slot.example === undefined)).toBe(true);
    expect(existsSync(resolve('public'+s.question.source.localPdf))).toBe(true);
    expect(s.question.questionPages.length).toBeGreaterThan(0);
    expect(s.question.questionPages.every(p => s.question.pages.includes(p))).toBe(true);
    for (const p of s.question.pages) expect(existsSync(resolve(`public/written/${q.year}/pm${q.section === 'B-1' ? 1 : 2}-p${p}.png`))).toBe(true);
    s = store.written.update(s.id, draft(s), 'reveal');
    expect(new Set(s.question.slots.map(slot => slot.id)).size).toBe(q.slotCount);
    expect(new Set(s.question.slots.map(slot => slot.label)).size).toBe(q.slotCount);
    expect(s.question.slots.every(slot => !!slot.example?.trim())).toBe(true);
    for (const path of [s.question.source.localAnswer, s.question.source.localComment]) {
      expect(path).toBeTruthy(); expect(existsSync(resolve('public'+path))).toBe(true);
    }
  }
  expect(JSON.stringify(dashboard)).not.toContain('バックボーン');
});
test('同梱した全18原本PDFが公式出典マニフェストのハッシュと一致する', () => {
  const manifest = JSON.parse(readFileSync('materials/written-sources.json', 'utf8')) as { sources: { file: string; url: string; sha256: string }[] };
  expect(manifest.sources).toHaveLength(18);
  expect(new Set(manifest.sources.map(s => s.file)).size).toBe(18);
  for (const source of manifest.sources) {
    expect(new URL(source.url).hostname).toBe('www.ipa.go.jp');
    const content = readFileSync(`public/written/${source.file.slice(0,4)}/${source.file}`);
    expect(createHash('sha256').update(content).digest('hex')).toBe(source.sha256);
  }
});
test.each(['2024-b2-q2', '2023-b1-q1'])('追加年度の%sで保存・再起動・自己評価・解き直しができる', questionId => {
  const store = make(); let s = store.written.create(questionId);
  if (questionId === '2024-b2-q2') {
    expect(s.question.notice?.url).toBe('https://www.ipa.go.jp/news/2024/shiken_20240607.html');
    expect(s.question.notice?.text).toContain('対象から除外');
    expect(s.question.slots.some(slot => slot.label.startsWith('設問5'))).toBe(false);
  }
  s = store.written.update(s.id, { ...draft(s), answers: { ...s.answers, s1: '追加年度の回答' }, page: s.question.questionPages[0], notes: '年度ごとの記録' }, 'draft');
  const reopened = make(store.directory);
  expect(reopened.written.public(reopened.written.get(s.id))).toEqual(s);
  s = reopened.written.update(s.id, draft(s), 'reveal');
  expect(s.question.slots[0].example).toBe(questionId === '2024-b2-q2' ? 'mail.y-sha.lan' : 'リバース');
  s = reopened.written.update(s.id, { ...draft(s), assessments: Object.fromEntries(s.question.slots.map(slot => [slot.id, 'good'])) }, 'complete');
  expect(reopened.written.dashboard().sessions[0]).toMatchObject({ questionId, good: s.question.slots.length });
  const retry = reopened.written.create(questionId);
  expect(retry.id).not.toBe(s.id); expect(retry.answers.s1).toBe('');
  expect(reopened.written.get(s.id).answers.s1).toBe('追加年度の回答');
});
test('途中保存・再起動・公式解答確認・全欄の自己評価・解き直しで回答と履歴を維持する', () => {
  const store = make(); let s = store.written.create('2025-b1-q1');
  expect(store.written.create('2025-b1-q1').id).toBe(s.id);
  const original = s; s = store.written.update(s.id, { ...draft(s), answers: { ...s.answers, s1: 'バックボーン' }, notes: '経路の変化を確認', page: 7 }, 'draft');
  expect(() => store.written.update(s.id, draft(original), 'draft')).toThrow(WrittenConflictError);
  const reopened = make(store.directory); const restored = reopened.written.public(reopened.written.get(s.id));
  expect(restored).toEqual(s); expect(restored.question.slots[0].example).toBeUndefined();
  s = reopened.written.update(s.id, draft(s), 'reveal');
  expect(s.question.slots[0].example).toBe('バックボーン'); expect(s.revealedAt).toBeTruthy();
  expect(s.answers.s2).toBe(''); expect(s.question.guide?.length).toBeGreaterThan(0);
  expect(() => reopened.written.update(s.id, { ...draft(s), answers: { ...s.answers, s2: 'ルータ' } }, 'draft')).toThrow('変更できません');
  expect(() => reopened.written.update(s.id, draft(s), 'complete')).toThrow('すべて');
  s = reopened.written.update(s.id, { ...draft(s), assessments: Object.fromEntries(s.question.slots.map(slot => [slot.id, slot.id==='s1' ? 'good' : 'review'])) }, 'complete');
  expect(s.status).toBe('completed'); expect(s.notes).toBe('経路の変化を確認');
  expect(reopened.written.dashboard().sessions[0]).toMatchObject({good:1, review:11, answered:1});
  expect(() => reopened.written.update(s.id,draft(s),'draft')).toThrow('完了済み');
  const retry = reopened.written.create('2025-b1-q1'); expect(retry.id).not.toBe(s.id);
  expect(retry.answers.s1).toBe(''); expect(reopened.written.records()).toHaveLength(2);
  const backup = reopened.backup(); const json=JSON.parse(readFileSync(backup.json,'utf8')); expect(json.writtenSessions).toHaveLength(2);
  expect(reopened.sessions()).toHaveLength(0);
});
test('不正な問題・ページ・回答・評価を保存しない', () => {
  const store = make(); const s = store.written.create('2025-b2-q2');
  expect(() => store.written.create('invalid')).toThrow();
  for (const patch of [{page:1}, {answers:null}, {answers:{s1:123}}, {notes:'x'.repeat(10001)}, {assessments:{unknown:'good'}}, {assessments:{s1:'good'}}]) {
    expect(() => store.written.update(s.id,{...draft(s),...patch},'draft')).toThrow();
  }
  expect(store.written.get(s.id).revision).toBe(0);
  expect(() => store.written.update(s.id,draft(s),'complete')).toThrow('先に');
});
