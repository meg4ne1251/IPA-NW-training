import type { WrittenDraft, WrittenSession } from './domain/written';
export class WrittenApiError extends Error { constructor(message: string, public status: number) { super(message); } }
export async function writtenApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/written${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await response.json(); if (!response.ok) throw new WrittenApiError(data.error || '処理に失敗しました。', response.status); return data;
}
export function writtenDraft(s: WrittenSession): WrittenDraft { return { revision: s.revision, answers: s.answers, assessments: s.assessments, notes: s.notes, page: s.page }; }
export class WrittenSync {
  session: WrittenSession; state: 'saved' | 'saving' | 'unsaved' | 'conflict' = 'saved'; error = ''; recovered = false;
  private version = 0; private savedVersion = 0; private timer?: ReturnType<typeof setTimeout>; private queue: Promise<unknown> = Promise.resolve();
  private key: string; private disposed = false;
  constructor(initial: WrittenSession, private notify: () => void, private storage: Storage | undefined = undefined) {
    this.session = initial; this.key = `nw-written-draft:${initial.id}`;
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw) {
        const backup = JSON.parse(raw);
        const d = backup.draft as WrittenDraft;
        const keys = initial.question.slots.map(s => s.id);
        if (d && typeof d.notes === 'string' && keys.every(k => typeof d.answers?.[k] === 'string') && d.assessments && initial.question.pages.includes(d.page)) {
          this.session = { ...initial, ...d, revision: initial.revision }; this.version = 1; this.recovered = true;
          if (d.revision !== initial.revision || backup.status !== initial.status) { this.state = 'conflict'; this.error = '未保存の控えとサーバーの内容が異なります。控えをダウンロードしてから、保存済みの内容を読み込んでください。'; }
          else { this.state = 'unsaved'; this.timer = setTimeout(() => { void this.save().catch(() => {}); }, 650); }
        }
      }
    } catch { /* The server remains usable when browser storage is unavailable. */ }
  }
  get dirty() { return this.version > this.savedVersion || this.state === 'conflict'; }
  private emit() { if (!this.disposed) this.notify(); }
  private backup() {
    try {
      if (this.dirty) this.storage?.setItem(this.key, JSON.stringify({ status: this.session.status, draft: writtenDraft(this.session) }));
      else this.storage?.removeItem(this.key);
    } catch { /* A failed server save is still reported and can be downloaded. */ }
  }
  edit(patch: Partial<Pick<WrittenDraft, 'answers' | 'assessments' | 'notes' | 'page'>>) {
    this.session = { ...this.session, ...patch }; this.version++; if (this.state !== 'conflict') this.state = 'unsaved'; this.backup(); this.emit();
    clearTimeout(this.timer); if (this.state !== 'conflict') this.timer = setTimeout(() => { void this.save().catch(() => {}); }, 650);
  }
  save(action: 'draft' | 'reveal' | 'complete' = 'draft'): Promise<void> {
    clearTimeout(this.timer);
    const run = async () => {
      if (this.state === 'conflict') throw new Error(this.error);
      if (action === 'draft' && !this.dirty) return;
      try {
        do {
          const version = this.version; const sent = this.session;
          this.state = 'saving'; this.error = ''; this.emit();
          const result = await writtenApi<WrittenSession>(`/sessions/${sent.id}/${action}`, action === 'draft' ? 'PUT' : 'POST', writtenDraft(sent));
          const newer = this.version !== version;
          this.session = newer ? { ...result, ...writtenDraft(this.session), revision: result.revision } : result;
          this.savedVersion = version; this.state = newer ? 'unsaved' : 'saved'; this.backup(); this.emit();
          if (action !== 'draft') break;
        } while (this.dirty);
      } catch (error) {
        this.state = error instanceof WrittenApiError && error.status === 409 ? 'conflict' : 'unsaved';
        this.error = error instanceof Error ? error.message : '保存に失敗しました。'; this.backup(); this.emit(); throw error;
      }
    };
    const pending = this.queue.catch(() => {}).then(run); this.queue = pending; return pending;
  }
  discardBackup() { try { this.storage?.removeItem(this.key); } catch {} }
  dispose() { this.disposed = true; clearTimeout(this.timer); }
}
