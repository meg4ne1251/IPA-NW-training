import { describe, expect, it, vi } from 'vitest';
import type { PublicSession } from './domain/training';
import { blankAnswer } from './domain/training';
import { SessionSync } from './session-sync';

const initial = (): PublicSession => ({ id: 'session', status: 'active', revision: 0, currentIndex: 0, answers: {} } as PublicSession);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('通信中の連続操作', () => {
  it('古い応答で編集を巻き戻さず、保留中の編集を最新の版番号で1回にまとめる', async () => {
    const first = deferred<PublicSession>(); const changed = vi.fn();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockImplementationOnce(async (_command, draft) => ({ ...initial(), ...draft, revision: 2 }));
    const sync = new SessionSync(initial(), send, changed, vi.fn());
    sync.edit({ ...sync.current, answers: { q: { ...blankAnswer(), choice: 1 } } });
    const saving = sync.flush();
    sync.edit({ ...sync.current, answers: { q: { ...blankAnswer(), choice: 2, confidence: 'sure' } } });
    sync.edit({ ...sync.current, currentIndex: 2 });
    expect(sync.flush()).toBe(saving); expect(send).toHaveBeenCalledTimes(1);
    first.resolve({ ...initial(), revision: 1, answers: { q: { ...blankAnswer(), choice: 1 } } });
    await saving;
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).toMatchObject({ revision: 1, currentIndex: 2, answers: { q: { choice: 2, confidence: 'sure' } } });
    expect(changed.mock.calls.slice(2).every(([s]) => s.answers.q.choice === 2)).toBe(true);
    expect(sync.current).toMatchObject({ revision: 2, currentIndex: 2, answers: { q: { choice: 2 } } });
    expect(sync.dirty).toBe(false); expect(sync.saving).toBe(false);
  });

  it('回答確定は実行中の保存だけを待ち、残りの編集を採点リクエストに含める', async () => {
    const first = deferred<PublicSession>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockImplementationOnce(async (_command, draft) => ({ ...initial(), ...draft, revision: 3, graded: { q: 'now' } }));
    const sync = new SessionSync(initial(), send, vi.fn(), vi.fn());
    sync.edit({ ...sync.current, answers: { q: { ...blankAnswer(), choice: 1 } } });
    void sync.flush();
    sync.edit({ ...sync.current, answers: { q: { ...blankAnswer(), choice: 1, confidence: 'unsure' } } });
    const grading = sync.commit('grade', 'q');
    first.resolve({ ...initial(), revision: 1, answers: { q: { ...blankAnswer(), choice: 1 } } });
    await grading;
    expect(send.mock.calls.map(args => args[0])).toEqual(['draft', 'grade']);
    expect(send.mock.calls[1][1]).toMatchObject({ revision: 1, answers: { q: { confidence: 'unsure' } } });
    expect(sync.dirty).toBe(false);
  });

  it('通信失敗では最新の回答を保持し、明示的な再試行で保存する', async () => {
    const first = deferred<PublicSession>(); const failed = vi.fn();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockImplementationOnce(async (_command, draft) => ({ ...initial(), ...draft, revision: 1 }));
    const sync = new SessionSync(initial(), send, vi.fn(), failed);
    sync.edit({ ...sync.current, currentIndex: 1 }); const saving = sync.flush();
    sync.edit({ ...sync.current, currentIndex: 2 });
    first.reject(new Error('network')); expect(await saving).toBeNull();
    expect(failed.mock.calls[0][1].currentIndex).toBe(2);
    expect(sync.dirty).toBe(true); expect(send).toHaveBeenCalledTimes(1);
    await sync.flush(); expect(sync.current.currentIndex).toBe(2); expect(sync.dirty).toBe(false);
  });

  it('時間切れで確定した結果を、遅れて到着した保存応答で巻き戻さない', async () => {
    const first = deferred<PublicSession>();
    const sync = new SessionSync(initial(), () => first.promise, vi.fn(), vi.fn());
    sync.edit({ ...sync.current, currentIndex: 1 }); const saving = sync.flush();
    sync.accept({ ...initial(), status: 'submitted', revision: 2 });
    first.resolve({ ...initial(), revision: 1, currentIndex: 1 }); await saving;
    expect(sync.current.status).toBe('submitted'); expect(sync.current.revision).toBe(2); expect(sync.dirty).toBe(false);
  });
});
