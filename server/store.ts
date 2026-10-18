import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { assert, blankAnswer, outcomes, topicStats, selectPractice, validateAnswers, validateQuestion } from '../src/domain/training.ts';
import type { Section, Session, TrainingQuestion, PublicSession } from '../src/domain/training.ts';

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
    return [...latest.values()];
  }
  sessions() { return this.records<Session>('sessions').sort((a, b) => b.startedAt.localeCompare(a.startedAt)); }
  session(id: string) {
    const row = this.db.prepare('SELECT payload FROM sessions WHERE id=?').get(id);
    assert(row, '演習が見つかりません。'); return JSON.parse(row.payload as string) as Session;
  }
  writeSession(s: Session) { this.db.prepare('INSERT OR REPLACE INTO sessions VALUES (?, ?)').run(s.id, JSON.stringify(s)); }
  publicSession(s: Session): PublicSession {
    if (s.status === 'submitted') return s;
    return { ...s, questions: s.questions.map(q => {
      const { correctIndex: _correct, explanation: _explanation, choiceExplanations: _choices, ...safe } = q;
      const { answerUrl: _answerURL, ...source } = safe.source;
      // Concept labels such as "PoE" can reveal an answer; only show them after submission.
      return { ...safe, tags: [], prompt: q.origin === 'past' ? `原本の問${q.source.number ?? ''}を解いてください` : safe.prompt,
        source, review: { ...safe.review, references: [] } };
    }) };
  }
  revision() { return this.sessions().filter(s => s.status === 'submitted').length; }
  history() {
    const versions = new Map(this.records<TrainingQuestion>('questions').map(q => [`${q.id}:${q.version}`, q]));
    return outcomes(this.sessions()).map(r => {
      const current = versions.get(`${r.question.id}:${r.question.version}`);
      return current ? { ...r, question: { ...r.question, review: current.review } } : r;
    });
  }
  dashboard() {
    this.expire();
    const bank = this.bank(); const history = this.history();
    return {
      stats: topicStats(history), revision: this.revision(),
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
  create(section: Section, mode: Session['mode'], count: number, collection?: string) {
    assert(section === 'A-1' || section === 'A-2', '科目を指定してください。');
    assert(['diagnostic', 'practice', 'exam'].includes(mode), '演習モードが不正です。');
    assert(Number.isInteger(count) && count > 0 && count <= 30, '問題数は1～30問です。');
    assert(!this.sessions().some(s => s.status === 'active'), '途中の演習を再開して提出してください。');
    const bank = this.bank().filter(q => !collection || q.source.url === collection);
    const selected = selectPractice(bank, this.history(), section, count);
    if (mode !== 'practice') {
      const fullCount = section === 'A-1' ? 30 : 25;
      assert(count === fullCount, '診断・本番形式は本番と同じ問題数で実施します。');
      selected.questions = bank.filter(q => q.section === section && q.origin === 'past' && q.review.status === 'verified' && !q.heldOut && (collection || q.id.startsWith('ipa-2025-spring-'))).sort((a, b) => a.id.localeCompare(b.id)).slice(0, count);
      assert(selected.questions.length === count, '本番形式に必要な過去問が不足しています。');
      selected.reasons = Object.fromEntries(selected.questions.map(q => [q.id, '過去問の診断・本番形式（既出を含む場合があります）']));
    }
    assert(selected.questions.length > 0, '出題可能な問題がありません。教材の準備を確認してください。');
    return this.newSession(section, mode, selected.questions, selected.reasons,
      mode === 'practice' ? `弱点と未着手の演習（${selected.questions.length}問）` : `${selected.questions[0].source.label.replace(/^出典：/, '').replace(/\s*問\d+$/, '')} ${mode === 'diagnostic' ? '診断' : '本番形式'}`);
  }
  newSession(section: Section, mode: Session['mode'], questions: TrainingQuestion[], reasons: Record<string, string>, title: string) {
    const timed = mode === 'exam' || mode === 'diagnostic'; const now = Date.now();
    const session: Session = { id: randomUUID(), section, mode, title, status: 'active', revision: 0,
      startedAt: new Date(now).toISOString(), submittedAt: null,
      deadline: timed ? new Date(now + (section === 'A-1' ? 50 : 40) * 60000).toISOString() : null,
      currentIndex: 0, questions: structuredClone(questions), answers: {}, selectionReasons: reasons };
    this.writeSession(session); return this.publicSession(session);
  }
  save(id: string, input: unknown) {
    assert(input && typeof input === 'object', '保存データが不正です。');
    const body = input as { revision: number; answers: unknown; currentIndex: number };
    return this.transaction(() => {
      let s = this.session(id);
      if (s.status === 'submitted') return this.publicSession(s);
      // The last acknowledged answers remain authoritative when the exam has expired.
      if (s.deadline && Date.now() >= Date.parse(s.deadline)) return this.publicSession(this.finalize(s));
      if (s.revision !== body.revision) throw new RevisionConflictError('別の画面で更新されています。再読込して保存済みの回答を確認してください。');
      assert(Number.isInteger(body.currentIndex) && body.currentIndex >= 0 && body.currentIndex < s.questions.length, '問題の位置が不正です。');
      s = { ...s, answers: validateAnswers(body.answers, s.questions), currentIndex: body.currentIndex, revision: s.revision + 1 };
      this.writeSession(s); return this.publicSession(s);
    });
  }
  finalize(s: Session) {
    if (s.status === 'submitted') return s;
    s.answers = validateAnswers(s.answers, s.questions); s.status = 'submitted';
    s.submittedAt = new Date().toISOString(); s.revision++; this.writeSession(s); return s;
  }
  submit(id: string, revision: number) {
    return this.transaction(() => {
      const s = this.session(id); if (s.status === 'submitted') return s;
      if (revision !== s.revision) throw new RevisionConflictError('回答が更新されています。保存済みの回答を再読込してください。');
      return this.finalize(s);
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
    assert(history.length > 0, 'まず演習を提出してください。');
    const requestId = randomUUID(); const revision = this.revision();
    const bank = this.bank().filter(q => q.section === section && !q.heldOut);
    const selected = selectPractice(bank, history, section, Math.min(30, bank.length));
    const context = { schemaVersion: 1, requestId, section, historyRevision: revision, exportedAt: new Date().toISOString(),
      instruction: 'confidenceのunknownは「わからない」を明示した回答です。未入力(null)や推測(guess)と区別し、正誤にかかわらず基礎から学習すべき分野・概念を特定してください。履歴と画像を読み、誤解・不安定な正解・未着手を分析してください。既存問題の選抜と新規類題を最大6問作成し、nextSetTemplateの形式で返してください。新規問題はdraftとし、正答の一意性、各選択肢の説明、根拠URLを記載してください。画像の問題はlocalImagePathを開いて確認してください。ファイル出力先はこの依頼のimportsディレクトリです。',
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
  readyItems(record: ImportRecord) {
    const bank = this.bank();
    const ready = record.selected.filter(i => bank.some(q => q.id === i.id && q.version === i.version && q.review.status === 'verified' && !q.heldOut));
    return { readyCount: ready.length, pendingCount: record.selected.length - ready.length };
  }
  startImport(requestId: string) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT payload FROM imports WHERE id=?').get(requestId); assert(row, 'セットが見つかりません。');
      const record = JSON.parse(row.payload as string) as ImportRecord;
      if (record.sessionId) return this.publicSession(this.session(record.sessionId));
      assert(!this.sessions().some(s => s.status === 'active'), '途中の演習を提出してください。');
      const bank = this.bank();
      const selected = record.selected.flatMap(item => {
        const q = bank.find(q => q.id === item.id && q.version === item.version && q.review.status === 'verified' && !q.heldOut);
        return q && !bank.some(x => x.groupId === q.groupId && x.heldOut) ? [q] : [];
      });
      assert(selected.length > 0, '検証済みの問題がありません。内容の確認が必要です。');
      const session = this.newSession(record.section, 'imported', selected, Object.fromEntries(record.selected.map(i => [i.id, i.reason])), `${record.title}（検証済み${selected.length}問）`);
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
  const seed = ['materials/2025-spring.json', 'materials/archive.json'].flatMap(name => {
    const path = resolve(name); return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as TrainingQuestion[] : [];
  });
  const directory = process.env.TRAINING_DATA_DIR || resolve('data');
  // Do not offer image questions whose assets have not been prepared.
  const ready = seed.filter(q => !q.source.image || existsSync(join(directory, q.source.image.slice(1))));
  return new TrainingStore(directory, ready);
}
