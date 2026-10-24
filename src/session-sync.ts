import type { PublicSession } from './domain/training';

export type SessionDraft = Pick<PublicSession, 'answers' | 'currentIndex' | 'revision'>;
type Command = 'draft' | 'grade' | 'submit' | 'cancel';
type Transport = (command: Command, draft: SessionDraft, questionId?: string) => Promise<PublicSession>;

export const sessionDraft = ({ answers, currentIndex, revision }: PublicSession): SessionDraft => ({ answers, currentIndex, revision });

// Only one request may write a session at a time. Edits made during a request
// replace the pending snapshot; an old response must never replace those edits.
export class SessionSync {
  current: PublicSession;
  dirty = false;
  saving = false;
  private version = 0;
  private inFlight: Promise<PublicSession | null> | null = null;
  private held = false;

  constructor(initial: PublicSession, private send: Transport,
    private changed: (session: PublicSession, dirty: boolean, saving: boolean) => void,
    private failed: (error: unknown, draft: SessionDraft) => void) {
    this.current = initial;
  }

  private notify() { this.changed(this.current, this.dirty, this.saving); }

  edit(next: PublicSession) {
    this.current = { ...next, revision: this.current.revision };
    this.version++;
    this.dirty = true;
    this.notify();
  }

  accept(saved: PublicSession, version = this.version) {
    if (saved.revision < this.current.revision || (this.current.status !== 'active' && saved.status === 'active')) return;
    this.dirty = saved.status === 'active' && version !== this.version;
    this.current = this.dirty ? { ...saved, answers: this.current.answers, currentIndex: this.current.currentIndex } : saved;
    this.notify();
  }

  flush(): Promise<PublicSession | null> {
    if (this.inFlight) return this.inFlight;
    if (this.held) return Promise.resolve(null);
    this.inFlight = this.drain().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async drain() {
    this.saving = true; this.notify();
    try {
      while (this.dirty && !this.held && this.current.status === 'active') {
        const version = this.version; const draft = sessionDraft(this.current);
        try { this.accept(await this.send('draft', draft), version); }
        catch (error) {
          if (!this.dirty) return this.current;
          this.failed(error, sessionDraft(this.current)); return null;
        }
      }
      return this.current;
    } finally { this.saving = false; this.notify(); }
  }

  async commit(command: 'grade' | 'submit' | 'cancel', questionId?: string) {
    if (this.held) return null;
    this.held = true;
    try {
      // Stop the drain after its current request. Include all remaining edits in
      // the confirmation request instead of waiting for a second draft request.
      if (this.inFlight && !await this.inFlight) return null;
      if (this.current.status !== 'active') return this.current;
      this.saving = true; this.notify();
      const draft = sessionDraft(this.current);
      try {
        const saved = await this.send(command, draft, questionId);
        this.accept(saved); return saved;
      } catch (error) { this.failed(error, draft); throw error; }
    } finally { this.held = false; this.saving = false; this.notify(); }
  }
}
