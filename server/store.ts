import { withReviewConcepts } from './review-concepts.ts';
import { conceptKeys, isFresh, relatedProgress, reviewIndex, reviewAnalysis, reviewCollection } from '../src/domain/review.ts';
import { withOfficialExplanation } from './official-explanations.ts';
import { withLearningPriority } from './learning-priorities.ts';
import { rapidCollection, rapidStatus, selectRapid } from '../src/domain/rapid.ts';
import { focusedStatus, newOnlyCollection, reviewOnlyCollection, selectFocused } from '../src/domain/focused.ts';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assert, blankAnswer, outcomes, topicStats, selectPractice, validateAnswers, validateQuestion } from '../src/domain/training.ts';
import type { Section, Session, TrainingQuestion, PublicSession } from '../src/domain/training.ts';
import { isSupplement, supplementCollection } from '../src/domain/training.ts';
import type { PracticeScope } from '../src/domain/training.ts';

export class RevisionConflictError extends Error {}

export class TrainingStore {
  db: DatabaseSync; directory: string;
  constructor(directory = resolve('data'), seed: TrainingQuestion[] = []) {
    this.directory = resolve(directory); mkdirSync(this.directory, { recursive: true });
    this.db = new DatabaseSync(join(this.directory, 'training.sqlite'));
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version as number;
    if (version > 1) { this.db.close(); throw new Error('このDBは新しい版のアプリで作成されています。更新前のアプリでは開けません。'); }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS questions (id TEXT NOT NULL, version INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(id, version));
      CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS imports (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      PRAGMA user_version=1;`);
    this.transaction(() => { for (const q of seed) {
      validateQuestion(q);
      this.db.prepare('INSERT OR IGNORE INTO questions VALUES (?, ?, ?)').run(q.id, q.version, JSON.stringify(q));
    } });
  }
  close() { this.db.close(); }
  transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = action(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  records<T>(table: 'questions' | 'sessions' | 'requests' | 'imports'): T[] {
    return this.db.prepare(`SELECT payload FROM ${table}`).all().map(r => JSON.parse(r.payload as string) as T);
  }
  bank() {
    const latest = new Map<string, TrainingQuestion>();
    for (const q of this.records<TrainingQuestion>('questions')) if (!latest.has(q.id) || latest.get(q.id)!.version < q.version) latest.set(q.id, q);
    return [...latest.values()].map(withOfficialExplanation).map(withLearningPriority).map(withReviewConcepts);
  }
  sessions() { return this.records<Session>('sessions').sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  session(id: string) {
    const row = this.db.prepare('SELECT payload FROM sessions WHERE id=?').get(id);
    assert(row, '演習が見つかりません。'); return JSON.parse(row.payload as string) as Session;
  }
  writeSession(s: Session) { this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?)').run(s.id, JSON.stringify(s)); }
  publicSession(s: Session): PublicSession {
    return { ...s, questions: s.questions.map(original => {
      const q = withOfficialExplanation(original);
      if (s.status === 'submitted' || s.graded?.[q.id]) return q;
      const { correctIndex: _correct, explanation: _explanation, choiceExplanations: _choices, learning: _learning, reviewConcepts: _reviewConcepts, ...safe } = q;
      const { answerUrl: _answerURL, ...source } = safe.source;
      // Concept labels such as "PoE" can reveal an answer; only show them after answer confirmation.
      return { ...safe, tags: [], prompt: q.origin === 'past' ? `原本の問${q.source.number ?? ''}を解いてください` : safe.prompt,
        source, review: { ...safe.review, references: [] } };
    }) };
  }
  revision() { return this.sessions().reduce((n, s) => n + Object.keys(s.graded ?? {}).length + +(s.status === 'submitted'), 0); }
  history() {
    const versions = new Map(this.records<TrainingQuestion>('questions').map(q => [`${q.id}:${q.version}`, q]));
    return outcomes(this.sessions()).map(r => {
      const current = versions.get(`${r.question.id}:${r.question.version}`);
      return { ...r, question: withReviewConcepts(withLearningPriority(withOfficialExplanation(current ? { ...r.question, review: current.review } : r.question))) };
    });
  }
  dashboard() {
    this.expire();
    const bank = this.bank(); const history = this.history();
    const supplements = bank.filter(q => isSupplement(q) && q.review.status === 'verified' && !q.heldOut && !bank.some(x => x.groupId === q.groupId && x.heldOut));
    return {
      analysis: (['A-1', 'A-2'] as const).map(section => reviewAnalysis(bank, history, section)),
      stats: topicStats(history), revision: this.revision(),
      rapid: (['A-1', 'A-2'] as const).map(section => rapidStatus(bank, history, section)),
      focused: (['A-1', 'A-2'] as const).map(section => focusedStatus(bank, history, section)),
      supplements: [...new Set(supplements.map(q => q.topic))].sort((a, b) => a.localeCompare(b, 'ja')).map(topic => {
        const items = supplements.filter(q => q.topic === topic);
        return { topic, count: items.length, tags: [...new Set(items.flatMap(q => q.tags))].sort((a, b) => a.localeCompare(b, 'ja')).map(tag => ({ tag, count: items.filter(q => q.tags.includes(tag)).length })) };
      }),
      collections: [...new Map(bank.filter(q => q.origin === 'past' && q.review.status === 'verified' && !q.heldOut).map(q => [q.source.url, {
        url: q.source.url, section: q.section, label: q.source.label.replace(/^出典：/, '').replace(/\s*問\d+$/, ''),
        count: bank.filter(x => x.source.url === q.source.url).length,
      }])).values()].sort((a, b) => b.label.localeCompare(a.label)),
      bank: (['A-1', 'A-2'] as const).map(section => ({ section,
        verified: bank.filter(q => q.section === section && q.review.status === 'verified' && !q.heldOut).length,
        draft: bank.filter(q => q.section === section && q.review.status === 'draft').length,
        unseenTopics: [...new Set(bank.filter(q => q.section === section && q.review.status === 'verified' && !q.heldOut && !history.some(r => r.question.groupId === q.groupId)).map(q => q.topic))],
      })),
      sessions: this.sessions().map(s => ({ id: s.id, section: s.section, title: s.title, status: s.status, startedAt: s.startedAt,
        count: s.questions.length, answered: Object.values(s.answers).filter(a => a.choice !== null).length,
        correct: s.status === 'submitted' ? s.questions.filter(q => s.answers[q.id]?.choice === q.correctIndex).length : null })),
      imports: this.records<ImportRecord>('imports').map(i => ({ requestId: i.requestId, title: i.title, ...this.readyItems(i), sessionId: i.sessionId })),
      drafts: bank.filter(q => q.review.status === 'draft').map(q => ({ id: q.id, version: q.version, section: q.section, prompt: q.prompt })),
    };
  }
  create(section: Section, mode: Session['mode'], count: number, collection?: string, focus: Pick<PracticeScope, 'topic' | 'tag'> = {}) {
    assert(section === 'A-1' || section === 'A-2', '科目を指定してください。');
    assert(['diagnostic', 'practice', 'exam'].includes(mode), '演習モードが不正です。');
    assert(Number.isInteger(count) && count > 0 && count <= 30, '問題数は1～30問です。');
    assert(collection === undefined || (typeof collection === 'string' && collection.length < 2000), '出題範囲が不正です。');
    assert(focus && typeof focus === 'object' && !Array.isArray(focus), '分野・論点の指定が不正です。');
    assert([focus.topic, focus.tag].every(v => v === undefined || (typeof v === 'string' && v.length <= 100)), '分野・論点の指定が不正です。');
    const supplement = collection === supplementCollection;
    const rapid = collection === rapidCollection;
    const review = collection === reviewCollection;
    const focused = collection === reviewOnlyCollection || collection === newOnlyCollection;
    assert(!focused || mode === 'practice', '復習専用・新規分野専用は練習で利用してください。');
    assert(!focused || count === 10 || count === 30, '復習専用・新規分野専用の問題数は10問または30問です。');
    assert(!review || mode === 'practice', '類題による復習は練習で利用してください。');
    assert(!rapid || mode === 'practice', '短期集中テストは練習で利用してください。');
    assert(!supplement || (section === 'A-1' && mode === 'practice'), '補強問題はA-1の練習で利用してください。');
    assert(supplement || (!focus.topic && !focus.tag), '分野・論点の指定は補強問題で利用してください。');
    assert(!this.sessions().some(s => s.status === 'active'), '途中の演習を再開して提出または中止してください。');
    const all = this.bank();
    const heldGroups = new Set(all.filter(q => q.heldOut).map(q => q.groupId));
    const bank = all.filter(q => !heldGroups.has(q.groupId) && (supplement ? isSupplement(q) : focused || rapid || review || !collection || q.source.url === collection)
      && (!focus.topic || q.topic === focus.topic) && (!focus.tag || q.tags.includes(focus.tag)));
    const history = this.history(); const index = reviewIndex(history, section);
    const reviewBank = review ? bank.filter(q => relatedProgress(q, index).some(s => s.risk > 0 || Date.parse(s.dueAt) <= Date.now())) : bank;
    // The explicit supplement exercise is entirely AI-authored. Mixed practice keeps its 20% limit.
    const selected = focused ? selectFocused(bank, history, section, collection, count)
      : rapid ? selectRapid(bank, history, section, count)
      : selectPractice(reviewBank, history, section, count, Date.now(), supplement ? count : Math.floor(count / 5));
    assert(!focused || selected.shortage === 0, `${collection === reviewOnlyCollection ? '復習専用' : '新規分野専用'}で出題できる問題は${selected.questions.length}問です。${count}問に不足するため開始できません。対象外の問題による補充は行いません。`);
    if (mode !== 'practice') {
      const fullCount = section === 'A-1' ? 30 : 25;
      assert(count === fullCount, '診断・本番形式は本番と同じ問題数で実施します。');
      selected.questions = bank.filter(q => q.section === section && q.origin === 'past' && q.review.status === 'verified' && !q.heldOut && (collection || q.id.startsWith('ipa-2025-spring-'))).sort((a, b) => a.id.localeCompare(b.id)).slice(0, count);
      assert(selected.questions.length === count, '本番形式に必要な過去問が不足しています。');
      selected.reasons = Object.fromEntries(selected.questions.map(q => [q.id, '過去問の診断・本番形式（既出を含む場合があります）']));
    }
    assert(selected.questions.length > 0, 'この範囲で出題可能な別問題がありません。出題範囲を広げるか、AIに新しい類題の追加を依頼してください。');
    return this.newSession(section, mode, selected.questions, selected.reasons,
      mode === 'practice' ? `${collection === reviewOnlyCollection ? `${section} 復習専用` : collection === newOnlyCollection ? `${section} 新規分野専用` : rapid ? `${section} 短期集中テスト` : review ? `${section} 苦手・復習の類題` : supplement ? `A-1補強 · ${focus.tag || focus.topic || '全分野'}` : '弱点と未着手の演習'}（${selected.questions.length}問）` : `${selected.questions[0].source.label.replace(/^出典：/, '').replace(/\s*問\d+$/, '')} ${mode === 'diagnostic' ? '診断' : '本番形式'}`,
      mode === 'practice' ? { collection, ...focus } : undefined);
  }
  newSession(section: Section, mode: Session['mode'], questions: TrainingQuestion[], reasons: Record<string, string>, title: string, practiceScope?: PracticeScope) {
    const timed = mode === 'exam' || mode === 'diagnostic'; const now = Date.now();
    const session: Session = { id: randomUUID(), section, mode, title, status: 'active', revision: 0,
      startedAt: new Date(now).toISOString(), submittedAt: null,
      deadline: timed ? new Date(now + (section === 'A-1' ? 50 : 40) * 60000).toISOString() : null,
      currentIndex: 0, questions: structuredClone(questions), answers: {}, selectionReasons: reasons, practiceScope };
    this.writeSession(session); return this.publicSession(session);
  }
  private applyDraft(s: Session, input: unknown) {
    assert(input && typeof input === 'object', '保存データが不正です。');
    const body = input as { revision: number; answers: unknown; currentIndex: number };
    if (s.revision !== body.revision) throw new RevisionConflictError('別の画面で更新されています。再読込して保存済みの回答を確認してください。');
    assert(Number.isInteger(body.currentIndex) && body.currentIndex >= 0 && body.currentIndex < s.questions.length, '問題の位置が不正です。');
    const answers = validateAnswers(body.answers, s.questions);
    for (const questionId of Object.keys(s.graded ?? {})) {
      const before = s.answers[questionId]; const after = answers[questionId];
      assert(after.choice === before.choice && after.confidence === before.confidence && after.reason === before.reason,
        '採点済みの回答・自信度は変更できません。');
      // Reading explanations must not add to the original answering time.
      answers[questionId] = { ...before, flagged: after.flagged };
    }
    return { ...s, answers, currentIndex: body.currentIndex, revision: s.revision + 1 };
  }
  save(id: string, input: unknown) {
    return this.transaction(() => {
      let s = this.session(id);
      if (s.status !== 'active') return this.publicSession(s);
      // The last acknowledged answers remain authoritative when the exam has expired.
      if (s.deadline && Date.now() >= Date.parse(s.deadline)) return this.publicSession(this.finalize(s));
      s = this.applyDraft(s, input);
      this.writeSession(s); return this.publicSession(s);
    });
  }
  grade(id: string, questionId: string, revision: number, draft?: unknown) {
    return this.transaction(() => {
      let s = this.session(id);
      assert(typeof questionId === 'string' && s.questions.some(q => q.id === questionId), 'セットにない問題です。');
      if (s.status !== 'active' || s.graded?.[questionId]) return this.publicSession(s);
      if (s.deadline && Date.now() >= Date.parse(s.deadline)) return this.publicSession(this.finalize(s));
      if (revision !== s.revision) throw new RevisionConflictError('回答が更新されています。保存済みの回答を再読込してください。');
      if (draft !== undefined) s = this.applyDraft(s, draft);
      const answer = s.answers[questionId] ?? blankAnswer();
      assert(answer.choice !== null || answer.confidence === 'unknown', '解答を選ぶか、自信度の「わからない」を選んでください。');
      s.graded = { ...s.graded, [questionId]: new Date().toISOString() }; s.revision++;
      if (s.questions.every(q => s.graded?.[q.id])) return this.publicSession(this.finalize(s));
      this.writeSession(s); return this.publicSession(s);
    });
  }
  finalize(s: Session) {
    if (s.status !== 'active') return s;
    s.answers = validateAnswers(s.answers, s.questions); s.status = 'submitted';
    s.submittedAt = new Date().toISOString(); s.revision++; this.writeSession(s); return s;
  }
  submit(id: string, revision: number, draft?: unknown) {
    return this.transaction(() => {
      let s = this.session(id); if (s.status !== 'active') return s;
      if (s.deadline && Date.now() >= Date.parse(s.deadline)) return this.finalize(s);
      if (revision !== s.revision) throw new RevisionConflictError('回答が更新されています。保存済みの回答を再読込してください。');
      if (draft !== undefined) s = this.applyDraft(s, draft);
      return this.finalize(s);
    });
  }
  cancel(id: string, revision: number, draft?: unknown) {
    return this.transaction(() => {
      let s = this.session(id);
      if (s.status !== 'active') return this.publicSession(s);
      if (s.deadline && Date.now() >= Date.parse(s.deadline)) return this.publicSession(this.finalize(s));
      if (revision !== s.revision) throw new RevisionConflictError('回答が更新されています。保存済みの回答を再読込してください。');
      if (draft !== undefined) s = this.applyDraft(s, draft);
      const at = new Date().toISOString();
      s.graded = { ...s.graded };
      for (const q of s.questions) {
        const answer = s.answers[q.id];
        if (!s.graded[q.id] && (answer?.choice != null || answer?.confidence === 'unknown')) s.graded[q.id] = at;
      }
      s.status = 'cancelled'; s.submittedAt = at; s.revision++;
      this.writeSession(s); return this.publicSession(s);
    });
  }
  expire() {
    this.transaction(() => {
      for (const s of this.sessions()) if (s.status === 'active' && s.deadline && Date.now() >= Date.parse(s.deadline)) this.finalize(s);
    });
  }
  exportContext(section: Section) {
    assert(section === 'A-1' || section === 'A-2', '科目が不正です。'); this.expire();
    const history = this.history().filter(r => r.question.section === section && !r.question.heldOut);
    assert(history.length > 0, 'まず1問の回答を確定してください。');
    const requestId = randomUUID(); const revision = this.revision();
    const bank = this.bank().filter(q => q.section === section && !q.heldOut);
    const selected = selectPractice(bank, history, section, Math.min(30, bank.length));
    const context = { schemaVersion: 1, requestId, section, historyRevision: revision, exportedAt: new Date().toISOString(),
      instruction: 'confidenceのunknownは「わからない」を明示した回答です。未入力(null)や推測(guess)と区別し、正誤にかかわらず基礎から学習すべき分野・概念を特定してください。履歴と画像を読み、誤解・不安定な正解・未着手を分析してください。既出ID・excludedGroupsに属する再録は選ばず、reviewConceptsで結び付く別の問題を選んでください。新規類題は数値・条件・場面・問う方向を変え、選択肢の並べ替えや単なる言い換えで済ませないでください。利用できる別問題がない概念は不足として報告してください。既存問題の選抜と新規類題を最大6問作成し、nextSetTemplateの形式で返してください。新規問題はdraftとし、正答の一意性、各選択肢の説明、根拠URLを記載してください。画像の問題はlocalImagePathを開いて確認してください。ファイル出力先はこの依頼のimportsディレクトリです。',
      analysis: reviewAnalysis(bank, history, section),
      excludedGroups: [...new Set(history.map(r => r.question.groupId))],
      stats: topicStats(history),
      history: history.slice(-200).map(r => ({ ...r, localImagePath: r.question.source.image ? join(this.directory, r.question.source.image.slice(1)) : null })),
      availableQuestions: bank.filter(q => q.review.status === 'verified'),
      nextSetTemplate: { schemaVersion: 1, requestId, historyRevision: revision, section, title: `${section} 苦手補強セット`, newQuestions: [],
        selected: selected.questions.map(q => ({ id: q.id, version: q.version, reason: selected.reasons[q.id] })) },
    };
    const dir = join(this.directory, 'exports', requestId); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'learning-context.json'), JSON.stringify(context, null, 2));
    this.db.prepare('INSERT INTO requests VALUES (?, ?)').run(requestId, JSON.stringify({ section, historyRevision: revision }));
    return context;
  }
  importSet(input: unknown) {
    assert(input && typeof input === 'object', '取り込みデータが不正です。');
    const body = input as ImportInput;
    assert(body.schemaVersion === 1 && typeof body.requestId === 'string', 'スキーマ版・依頼IDが不正です。');
    const old = this.db.prepare('SELECT payload FROM imports WHERE id=?').get(body.requestId);
    if (old) return JSON.parse(old.payload as string) as ImportRecord;
    const request = this.db.prepare('SELECT payload FROM requests WHERE id=?').get(body.requestId);
    assert(request, 'この環境から出力した依頼IDが必要です。');
    const req = JSON.parse(request.payload as string);
    assert(body.section === req.section && body.historyRevision === req.historyRevision, '科目・履歴の基準時点が一致しません。');
    assert(body.historyRevision === this.revision(), '出力後に学習履歴が増えています。最新の結果を出力して作り直してください。');
    assert(typeof body.title === 'string' && body.title.trim().length > 0 && body.title.length <= 200, 'セット名が必要です。');
    assert(Array.isArray(body.newQuestions) && body.newQuestions.length <= 6 && Array.isArray(body.selected) && body.selected.length > 0 && body.selected.length <= 30, '新規類題は6問以内、セットは1～30問です。');
    const bank = this.bank();
    const fresh = body.newQuestions.map(q => validateQuestion(q));
    assert(new Set(fresh.map(q => q.id)).size === fresh.length, '新規問題IDが重複しています。');
    for (const q of fresh) {
      assert(q.origin === 'ai' && q.version === 1 && q.section === body.section && !q.heldOut, '新規問題は同じ科目のAI問題・版1として登録してください。');
      assert(!bank.some(oldQ => oldQ.id === q.id || oldQ.groupId === q.groupId && oldQ.heldOut), '既存ID・模試用グループは使えません。');
      assert(!q.source.image, 'AI類題は本文と選択肢で記述してください。');
      assert(q.choiceExplanations?.length === 4, 'AI類題には各選択肢の説明が必要です。');
      q.review.status = 'draft';
    }
    const combined = [...bank, ...fresh]; const used = new Set<string>();
    for (const item of body.selected) {
      assert(item && typeof item.reason === 'string' && item.reason.trim().length > 0 && item.reason.length <= 1000, '出題理由が必要です。');
      const q = combined.find(q => q.id === item.id && q.version === item.version);
      assert(q && q.section === body.section && !q.heldOut && !combined.some(x => x.groupId === q.groupId && x.heldOut), '未知の問題版・科目違い・模試用問題が含まれています。');
      assert(q.review.status === 'verified' || q.review.status === 'draft', '疑義あり・出題終了の問題は使えません。');
      assert(!used.has(q.groupId), '同じ問題・派生グループが重複しています。'); used.add(q.groupId);
    }
    assert(fresh.every(q => body.selected.some(s => s.id === q.id)), '新規問題は選抜一覧にも含めてください。');
    const record: ImportRecord = { ...body, newQuestions: fresh, importedAt: new Date().toISOString(), sessionId: null };
    this.transaction(() => {
      for (const q of fresh) this.db.prepare('INSERT INTO questions VALUES (?, ?, ?)').run(q.id, q.version, JSON.stringify(q));
      this.db.prepare('INSERT INTO imports VALUES (?, ?)').run(body.requestId, JSON.stringify(record));
    });
    const dir = join(this.directory, 'imports', body.requestId); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'next-set.json'), JSON.stringify(record, null, 2)); return record;
  }
  resolveImport(record: ImportRecord) {
    const bank = this.bank(); const history = this.history();
    const held = new Set(bank.filter(q => q.heldOut).map(q => q.groupId));
    const safe = bank.filter(q => q.section === record.section && q.review.status === 'verified' && !q.heldOut && !held.has(q.groupId));
    const used = new Set<string>(); const questions: TrainingQuestion[] = []; const reasons: Record<string, string> = {};
    const reserved = new Set(record.selected.flatMap(i => { const q = safe.find(q => q.id === i.id && q.version === i.version); return q && isFresh(q, history) ? [q.groupId] : []; }));
    for (const item of record.selected) {
      const original = safe.find(q => q.id === item.id && q.version === item.version); if (!original) continue;
      const keys = conceptKeys(original);
      const q = isFresh(original, history) ? original : safe.find(q => !used.has(q.groupId) && !reserved.has(q.groupId) && isFresh(q, history) && conceptKeys(q).some(k => keys.includes(k)));
      if (!q || used.has(q.groupId)) continue;
      used.add(q.groupId); questions.push(q); reasons[q.id] = q.id === original.id ? item.reason : '既出問題を同じ概念の別問題に置換';
    }
    return { questions, reasons };
  }
  readyItems(record: ImportRecord) {
    const readyCount = record.sessionId ? this.session(record.sessionId).questions.length : this.resolveImport(record).questions.length;
    return { readyCount, pendingCount: record.selected.length - readyCount };
  }
  startImport(requestId: string) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM imports WHERE id=?').get(requestId); assert(row, 'セットが見つかりません。');
      const record = JSON.parse(row.payload as string) as ImportRecord;
      if (record.sessionId) return this.publicSession(this.session(record.sessionId));
      assert(!this.sessions().some(s => s.status === 'active'), '途中の演習を提出または中止してください。');
      const selected = this.resolveImport(record);
      assert(selected.questions.length > 0, '出題可能な別問題がありません。検証済みの新しい類題を追加してください。');
      const session = this.newSession(record.section, 'imported', selected.questions, selected.reasons, `${record.title}（検証済み${selected.questions.length}問）`);
      record.sessionId = session.id; this.db.prepare('UPDATE imports SET payload=? WHERE id=?').run(JSON.stringify(record), requestId); return session;
    });
  }
  verify(id: string, method: string, reference: string, reviewer: string) {
    assert(method.trim().length >= 10 && /^https:\/\//.test(reference) && reviewer.trim(), '確認方法（10文字以上）、根拠URL、確認者を指定してください。');
    const q = this.bank().find(q => q.id === id); assert(q && q.review.status === 'draft', '未検証の問題が見つかりません。');
    q.review = { status: 'verified', method, reviewer, at: new Date().toISOString(), references: [...new Set([...q.review.references, reference])] };
    this.db.prepare('UPDATE questions SET payload=? WHERE id=? AND version=?').run(JSON.stringify(q), q.id, q.version); return q;
  }
  backup() {
    const directory = join(this.directory, 'backups'); mkdirSync(directory, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const base = join(directory, stamp);
    this.db.prepare('VACUUM INTO ?').run(`${base}.sqlite`);
    writeFileSync(`${base}.json`, JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(),
      questions: this.records('questions'), sessions: this.records('sessions'), requests: this.records('requests'), imports: this.records('imports') }, null, 2));
    return { sqlite: `${base}.sqlite`, json: `${base}.json` };
  }
}
interface ImportInput {
  schemaVersion: number; requestId: string; historyRevision: number; section: Section; title: string;
  newQuestions: TrainingQuestion[]; selected: { id: string; version: number; reason: string }[];
}
interface ImportRecord extends ImportInput { importedAt: string; sessionId: string | null }
export function openStore() {
  const seed = ['materials/2025-spring.json', 'materials/archive.json', 'materials/a1-supplement.json', 'materials/review-variants.json', 'materials/focused-supplement.json'].flatMap(name => {
    const path = resolve(name); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as TrainingQuestion[] : [];
  });
  const directory = process.env.TRAINING_DATA_DIR || resolve('data');
  // Do not offer image questions whose assets have not been prepared.
  const ready = seed.filter(q => !q.source.image || existsSync(join(directory, q.source.image.slice(1))));
  return new TrainingStore(directory, ready);
}
