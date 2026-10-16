import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { blankAnswer, labels } from './domain/training';
import type { Answer, PublicSession, Section } from './domain/training';
import type { TrainingStore } from '../server/store';
import './style.css';

type Dashboard = ReturnType<TrainingStore['dashboard']>;
type Draft = Pick<PublicSession, 'answers' | 'currentIndex' | 'revision'>;
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new ApiError(data.error || '処理に失敗しました。', response.status); return data;
}
function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const date = (s: string) => new Date(s).toLocaleString('ja-JP');
function App() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [section, setSection] = useState<Section>('A-1');
  const [collection, setCollection] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [importText, setImportText] = useState('');
  const [tab, setTab] = useState<'learn' | 'history' | 'ai'>('learn');
  async function refresh() { setDashboard(await api<Dashboard>('/dashboard')); }
  async function open(id: string) { const s = await api<PublicSession>(`/sessions/${id}`); setSession(s); location.hash = `session/${id}`; window.scrollTo(0, 0); }
  async function task(action: () => Promise<void>) {
    setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました。'); } finally { setBusy(false); }
  }
  useEffect(() => {
    void task(async () => { await refresh(); const match = location.hash.match(/^#session\/([a-zA-Z0-9-]+)$/); if (match) await open(match[1]); });
  }, []);
  async function start(mode: 'diagnostic' | 'practice' | 'exam', count: number, targetSection: Section = section) {
    await task(async () => { const s = await api<PublicSession>('/sessions', 'POST', { section: targetSection, mode, count, collection: targetSection === section ? collection : '' }); setSession(s); location.hash = `session/${s.id}`; await refresh(); window.scrollTo(0, 0); });
  }
  const active = dashboard?.sessions.find(s => s.status === 'active');
  const completed = dashboard?.sessions.filter(s => s.status === 'submitted') ?? [];
  return <main>
    <header><a className="brand" href="#" onClick={e => { e.preventDefault(); if (!session || session.status === 'submitted') void task(async () => { setSession(null); location.hash = ''; await refresh(); }); }}>NW <span>/ TRAINING</span></a><span className="pill">A-1を中心に、1日2時間</span></header>
    {error && <div className="message error" role="alert">{error}<button className="text-button" onClick={() => setError('')}>閉じる</button></div>}
    {notice && <div className="message" role="status">{notice}</div>}
    {!dashboard && !error && <p role="status">学習データを読み込んでいます…</p>}
    {!dashboard && error && <button onClick={() => void task(refresh)}>再接続する</button>}
    {session ? <Exercise key={session.id} initial={session} onHome={() => void task(async () => { setSession(null); location.hash = ''; await refresh(); })} onChange={setSession} onNext={() => void start('practice', 30, session.section)} /> : dashboard && <>
      <nav className="tabs" aria-label="メインメニュー">{([['learn', '今日の学習'], ['history', '履歴と苦手分野'], ['ai', 'AIとの受け渡し']] as const).map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
      {tab === 'learn' && <>
        <section className="hero"><p className="eyebrow">PAST QUESTIONS → UNDERSTANDING</p><h1>一問ずつ解いて、<br />苦手を減らしていく。</h1><p>過去問で確かめ、迷った理由を記録。<br />あなたの結果から、次に取り組む問題へ。</p><p className="muted">受験日：2026年10月26日 · 学習配分の目安 A-1 80% / A-2 20%</p></section>
        <section className="metrics" aria-label="学習状況"><article><span>収録済みの過去問・検証済み問題</span><strong>{dashboard.bank.reduce((n, b) => n + b.verified, 0)}<small>問</small></strong></article><article><span>解き終えたセット</span><strong>{completed.length}<small>回</small></strong></article><article><span>これまでの解答</span><strong>{completed.reduce((n, s) => n + s.count, 0)}<small>問</small></strong></article></section>
        {active && <section className="resume"><div><p className="eyebrow">CONTINUE</p><h2>{active.title}</h2><p>{active.count}問中 {active.answered}問に回答済み。途中から再開できます。</p></div><button disabled={busy} onClick={() => void task(() => open(active.id))}>演習を再開する →</button></section>}
        <section><div className="section-heading"><h2>問題を解く</h2><div className="segmented" aria-label="科目">{(['A-1', 'A-2'] as const).map(s => <button key={s} aria-pressed={section === s} onClick={() => { setSection(s); setCollection(''); }}>{s}</button>)}</div></div><p>{section === 'A-1' ? '高度共通の知識を、テクノロジ・マネジメント・ストラテジまで確認します。' : 'ネットワークとセキュリティを中心に、NWの専門知識を確認します。'}</p>
          <label className="collection-select">出題範囲<select aria-label="出題範囲" value={collection} onChange={e => setCollection(e.target.value)}><option value="">すべての年度（診断・本番形式は2025年春期）</option>{dashboard.collections.filter(c => c.section === section).map(c => <option value={c.url} key={c.url}>{c.label} · {c.count}問</option>)}</select></label><div className="practice-grid"><article><p className="eyebrow">START HERE</p><h3>過去問で診断</h3><p>本番と同じ{section === 'A-1' ? '30問・50分' : '25問・40分'}。提出後に正答と解説を確認します。</p><button disabled={busy || !!active} onClick={() => void start('diagnostic', section === 'A-1' ? 30 : 25)}>{section}の診断を始める</button></article><article><p className="eyebrow">DAILY PRACTICE</p><h3>短く解く・続けて解く</h3><p>苦手な概念と未着手問題を選抜。10問ずつでも、30問ずつ何セットでも。</p><div className="actions"><button disabled={busy || !!active} onClick={() => void start('practice', 10)}>10問を解く</button><button className="secondary" disabled={busy || !!active} onClick={() => void start('practice', 30)}>30問を解く</button></div></article><article><p className="eyebrow">EXAM PRACTICE</p><h3>時間を計って確認</h3><p>時間切れで提出します。既出問題を含むため、初見の実力とは区別してください。</p><button className="secondary" disabled={busy || !!active} onClick={() => void start('exam', section === 'A-1' ? 30 : 25)}>本番形式で解く</button></article></div>
          {dashboard.bank.every(b => b.verified === 0) && <p className="message error">教材がまだありません。READMEの教材準備手順を実行してください。</p>}
        </section>
        <section className="hint"><h2>正解しても、迷ったら記録。</h2><p>「確信あり」「迷った」「推測」で理解の状態を残します。解説直後の正解に加えて、翌日以降に別の問題でも解けるかを確かめましょう。</p></section>
      </>}
      {tab === 'history' && <>
        <section><p className="eyebrow">YOUR PROGRESS</p><h1 className="compact-title">履歴と苦手分野</h1><p>正答率は解答回数による集計です。本試験の得点予測ではありません。</p><div className="table-wrap"><table><thead><tr><th>科目・分野</th><th>正解 / 解答</th><th>異なる問題</th><th>初回正解</th><th>迷った正解等</th></tr></thead><tbody>{dashboard.stats.map(s => <tr key={`${s.section}-${s.topic}`}><th>{s.section} · {s.topic}</th><td>{s.correct} / {s.attempts}</td><td>{s.unique}問</td><td>{s.firstCorrect} / {s.firstCount}</td><td>{s.uncertain}問</td></tr>)}</tbody></table></div>{!dashboard.stats.length && <p className="empty">まだ提出済みの演習はありません。</p>}<p className="muted">同じ問題の反復は「異なる問題」の件数に加算しません。自信度未入力の正解も不安定な正解に含みます。</p></section>
        {dashboard.bank.map(b => <article className="topic-card" key={b.section}><h3>{b.section} · 収録問題で未着手の分野</h3><p>{b.unseenTopics.join(' / ') || '収録分野は一度ずつ取り組み済みです。'}</p><small>収録教材内の集計です。試験範囲全体の習得を意味しません。</small></article>)}
        <section><h2>これまでの演習</h2><div className="history-list">{dashboard.sessions.map(s => <article key={s.id}><div><h3>{s.title}</h3><small>{date(s.startedAt)} · {s.status === 'submitted' ? `${s.correct} / ${s.count}問正解` : `${s.answered} / ${s.count}問回答済み`}</small></div><button className="secondary" disabled={busy} onClick={() => void task(() => open(s.id))}>{s.status === 'submitted' ? '結果を見る' : '再開する'}</button></article>)}</div></section>
      </>}
      {tab === 'ai' && <>
        <section><p className="eyebrow">NEXT LEARNING SET</p><h1 className="compact-title">結果をAIに渡して、次の問題へ。</h1><p>演習を提出したら結果を出力し、この環境のAIに次セットの作成を依頼します。新しく作った問題は内容を検証してから出題します。</p><article><h2>1. 結果を出力する</h2><p>この環境にもJSONが保存されます。出力したファイルを読むようにAIへ依頼してください。</p><div className="actions">{(['A-1', 'A-2'] as const).map(s => <button disabled={busy} key={s} onClick={() => void task(async () => { const data = await api<{ requestId: string }>('/export', 'POST', { section: s }); download(`learning-context-${s}-${data.requestId}.json`, data); setNotice(`結果を data/exports/${data.requestId}/learning-context.json に保存しました。このファイルをAIに読み込ませてください。`); })}>{s}の結果を出力</button>)}</div></article></section>
        <section><article><h2>2. 次の問題セットを取り込む</h2><p>AIが作成した next-set.json を選ぶか、JSONを貼り付けてください。</p><label className="file-label">JSONファイル<input type="file" accept=".json,application/json" onChange={e => void task(async () => { const file = e.target.files?.[0]; if (file) { if (file.size > 2_000_000) throw new Error('ファイルは2MB以内にしてください。'); setImportText(await file.text()); } })} /></label><label>問題セットのJSON<textarea rows={9} value={importText} onChange={e => setImportText(e.target.value)} placeholder="next-set.json の内容" /></label><button disabled={busy || !importText.trim()} onClick={() => void task(async () => { await api('/import', 'POST', JSON.parse(importText)); setImportText(''); setNotice('セットを取り込みました。検証済みの問題から演習を始められます。AIの新規問題は未検証で保存します。'); await refresh(); })}>内容を検証して取り込む</button></article></section>
        <section><h2>3. 取り込んだセットを解く</h2>{!dashboard.imports.length && <p className="empty">取り込んだセットはここに表示されます。</p>}{dashboard.imports.map(i => <article className="import-card" key={i.requestId}><h3>{i.title}</h3><p>出題可能 {i.readyCount}問 / 確認待ち等 {i.pendingCount}問</p><button disabled={busy || !i.readyCount || (!!active && active.id !== i.sessionId)} onClick={() => void task(async () => { const s = await api<PublicSession>(`/imports/${i.requestId}/start`, 'POST', {}); setSession(s); location.hash = `session/${s.id}`; await refresh(); })}>{i.sessionId ? 'このセットを開く' : `検証済み${i.readyCount}問で始める`}</button></article>)}</section>
        {dashboard.drafts.length > 0 && <section><h2>内容確認待ちのAI問題</h2><p>AIに正答の一意性・計算・根拠の照合を依頼してください。確認内容はCLIで記録します。手順はREADMEにあります。</p><ul>{dashboard.drafts.map(q => <li key={q.id}>{q.id} · {q.prompt}</li>)}</ul></section>}
        <section><button className="secondary" disabled={busy} onClick={() => void task(async () => { const paths = await api<{ sqlite: string; json: string }>('/backup', 'POST', {}); setNotice(`バックアップを保存しました：${paths.sqlite} / ${paths.json}`); })}>履歴をバックアップする</button></section>
      </>}
    </>}
    <footer>IPA非公式の個人学習アプリ · <a href="https://www.ipa.go.jp/shiken/kubun/nw.html" target="_blank" rel="noreferrer">公式試験情報</a><p>過去問の出典は各問題に表示しています。解説は本アプリ独自作成です。</p></footer>
  </main>;
}
function Exercise({ initial, onHome, onChange, onNext }: { initial: PublicSession; onHome: () => void; onChange: (s: PublicSession) => void; onNext: () => void }) {
  const [session, setSession] = useState(initial); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [unsaved, setUnsaved] = useState(false);
  const [conflicts, setConflicts] = useState<Draft[]>([]); const [timeoutError, setTimeoutError] = useState('');
  const [confirm, setConfirm] = useState(false); const [paused, setPaused] = useState(false); const [now, setNow] = useState(Date.now());
  const started = useRef(Date.now()); const visibleSeconds = useRef(0);
  const key = `nw-draft:${session.id}`;
  const conflictKey = `nw-conflicts:${session.id}`;
  function preserveDraft(draft: Draft) {
    const append = (items: Draft[]) => items.some(item => JSON.stringify(item) === JSON.stringify(draft)) ? items : [...items, draft];
    try {
      const items = append(JSON.parse(localStorage.getItem(conflictKey) || '[]') as Draft[]);
      localStorage.setItem(conflictKey, JSON.stringify(items)); setConflicts(items); return true;
    } catch { setConflicts(append); return false; }
  }
  useEffect(() => {
    try {
      setConflicts(JSON.parse(localStorage.getItem(conflictKey) || '[]') as Draft[]);
      const pending = localStorage.getItem(key);
      if (pending) {
        const draft = JSON.parse(pending) as Draft;
        if (initial.status === 'active' && draft.revision === initial.revision) {
          setSession({ ...initial, ...draft }); setUnsaved(true);
          setError('前回の未保存回答を復元しました。「保存を再試行」で保存してください。');
        } else if (preserveDraft(draft)) {
          if (localStorage.getItem(key) === pending) localStorage.removeItem(key);
        }
      }
    } catch { setError('このブラウザーの一時保存を読み取れませんでした。'); }
  }, [key]);
  useEffect(() => {
    const tick = setInterval(() => {
      setNow(Date.now());
      if (!document.hidden && !paused) visibleSeconds.current += (Date.now() - started.current) / 1000;
      started.current = Date.now();
    }, 1000);
    const visibility = () => { started.current = Date.now(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(tick); document.removeEventListener('visibilitychange', visibility); };
  }, [paused]);
  const q = session.questions[session.currentIndex]; const a = session.answers[q.id] ?? blankAnswer();
  const submitted = session.status === 'submitted';
  const remaining = session.deadline ? Math.max(0, Math.ceil((Date.parse(session.deadline) - now) / 1000)) : null;
  const expired = remaining === 0 && !submitted;
  useEffect(() => {
    if (!expired || busy) return;
    let cancelled = false; let retry: ReturnType<typeof setTimeout>;
    async function checkSubmission() {
      try {
        const result = await api<PublicSession>(`/sessions/${session.id}`);
        if (cancelled) return;
        if (result.status === 'submitted') {
          setSession(result); onChange(result); setTimeoutError(''); return;
        }
      } catch {
        if (cancelled) return;
        setTimeoutError('提出結果を取得できませんでした。接続が戻ると自動で再試行します。');
      }
      if (!cancelled) retry = setTimeout(() => void checkSubmission(), 1000);
    }
    void checkSubmission();
    return () => { cancelled = true; clearTimeout(retry); };
  }, [expired, busy, session.id]);
  async function save(next: PublicSession) {
    if (submitted) { setSession(next); return next; }
    if (busy || expired) return null;
    // Keep a stale tab's answers separate before replacing the shared pending draft.
    try {
      const pending = localStorage.getItem(key);
      if (pending) {
        const previous = JSON.parse(pending) as Draft;
        if (previous.revision !== session.revision && !preserveDraft(previous)) {
          setError('未保存回答の控えを保管できませんでした。控えをダウンロードしてから再試行してください。'); return null;
        }
      }
    } catch { /* Server storage still works if browser storage is unavailable. */ }
    setBusy(true); setError('');
    const elapsed = visibleSeconds.current + (!document.hidden && !paused ? (Date.now() - started.current) / 1000 : 0);
    const answer = next.answers[q.id] ?? blankAnswer();
    const optimistic = { ...next, revision: session.revision,
      answers: { ...next.answers, [q.id]: { ...answer, seconds: Math.round((answer.seconds + elapsed) * 10) / 10 } } };
    // The optimistic answers now include this time, even if the request fails.
    visibleSeconds.current = 0; started.current = Date.now();
    const draft: Draft = { answers: optimistic.answers, currentIndex: optimistic.currentIndex, revision: optimistic.revision };
    const serialized = JSON.stringify(draft);
    setSession(optimistic); setUnsaved(true);
    try { localStorage.setItem(key, serialized); } catch { /* Optional temporary cache. */ }
    try {
      const saved = await api<PublicSession>(`/sessions/${session.id}/draft`, 'PUT', draft);
      setSession(saved); onChange(saved); setUnsaved(false);
      try { if (localStorage.getItem(key) === serialized) localStorage.removeItem(key); } catch { /* Optional temporary cache. */ }
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) preserveDraft(draft);
      setError(`${e instanceof Error ? e.message : '保存に失敗しました。'} 回答は未保存です。再試行してください。`); return null;
    } finally { setBusy(false); }
  }
  async function update(patch: Partial<Answer>) { await save({ ...session, answers: { ...session.answers, [q.id]: { ...a, ...patch } } }); }
  async function move(index: number) { if (submitted) setSession({ ...session, currentIndex: index }); else await save({ ...session, currentIndex: index }); setConfirm(false); }
  const unanswered = session.questions.filter(x => session.answers[x.id]?.choice == null).length;
  const score = session.questions.filter(x => session.answers[x.id]?.choice === x.correctIndex).length;
  const uncertain = session.questions.filter(x => session.answers[x.id]?.choice === x.correctIndex && session.answers[x.id]?.confidence !== 'sure').length;
  return <>
    <div className="exercise-top"><button className="text-button" disabled={busy} onClick={() => void (async () => { if (submitted || await save(session)) onHome(); })()}>← 学習画面へ</button><span className="save-status" role="status">{submitted ? '提出済み・保存済み' : expired ? '提出結果を確認しています…' : busy ? '保存しています…' : unsaved ? '未保存の回答あり' : 'この環境に保存済み'}</span></div>
    {error && <div className="message error" role="alert">{error}{unsaved && <button disabled={busy} onClick={() => void save(session)}>保存を再試行</button>}<button className="secondary" onClick={() => download(`unsaved-${session.id}.json`, session)}>回答の控えを保存</button></div>}
    {conflicts.length > 0 && <div className="message" role="alert">別の画面との競合などで未保存になった回答の控えを保持しています。現在の回答とは別にダウンロードできます。<button className="secondary" onClick={() => download(`conflicting-answers-${session.id}.json`, { sessionId: session.id, drafts: conflicts })}>競合した回答の控えを保存</button></div>}
    {timeoutError && !submitted && <div className="message error" role="alert">{timeoutError}</div>}
    {submitted && <section className="result"><p className="eyebrow">RESULT</p><h1 className="compact-title">{score}<span> / {session.questions.length}問正解</span></h1><p>迷った・推測・自信度未入力の正解：{uncertain}問 · 未回答：{unanswered}問</p><div className="actions"><button onClick={onNext}>次の30問を解く →</button><button className="secondary" onClick={onHome}>履歴・AI連携へ</button></div></section>}
    <section className="exercise-heading"><div><p className="eyebrow">{session.section} / {submitted ? 'REVIEW' : 'PRACTICE'}</p><h2>{session.title}</h2></div>{remaining !== null && !submitted && <p className={`timer ${remaining < 300 ? 'urgent' : ''}`} aria-label="残り時間">残り {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>}</section>
    <div className="question-layout"><aside><p>{session.currentIndex + 1} / {session.questions.length}問</p><div className="question-map">{session.questions.map((x, i) => <button key={x.id} disabled={busy || expired || paused} aria-label={`問${i + 1}${session.answers[x.id]?.choice != null ? ' 回答済み' : ' 未回答'}${session.answers[x.id]?.flagged ? ' 見直し' : ''}`} aria-current={i === session.currentIndex ? 'step' : undefined} className={`${session.answers[x.id]?.choice != null ? 'answered' : ''} ${session.answers[x.id]?.flagged ? 'flagged' : ''}`} onClick={() => void move(i)}>{i + 1}</button>)}</div><p className="muted">色付き：回答済み<br />●：見直し</p>{!session.deadline && !submitted && <button className="secondary" onClick={() => { started.current = Date.now(); setPaused(!paused); }}>{paused ? '学習を再開' : '一時停止'}</button>}</aside>
      <article className="question-card"><div className="section-heading"><p className="topic">{q.topic}{q.tags.length > 0 ? ` · ${q.tags.join(' / ')}` : ''}</p><span className="pill">{q.origin === 'past' ? '公式過去問' : q.origin === 'ai' ? 'AI類題・内容確認済み' : '独自問題'}</span></div><h2>{q.prompt}</h2>{session.selectionReasons[q.id] && <small>出題理由：{session.selectionReasons[q.id]}</small>}
        {paused ? <div className="empty">一時停止中です。再開すると問題が表示されます。</div> : <>
          {q.source.image && <><a className="question-image-link" href={q.source.image} target="_blank" rel="noreferrer"><img className="question-image" src={q.source.image} alt={`${q.source.label}の問題文・図表・選択肢。クリックで拡大できます。`} onError={() => setError('問題画像を読み込めません。原本PDFで該当ページを確認してください。')} /></a><small>問題部分を切り抜いて表示しています。問題文の変更はありません。画像を押すと拡大します。</small></>}
          <fieldset disabled={submitted || busy || expired}><legend>解答を選んでください</legend><div className={q.source.image ? 'answer-grid' : 'answer-list'}>{q.choices.map((choice, i) => <label key={i} className={`${submitted && i === q.correctIndex ? 'correct-choice' : ''}`}><input type="radio" name="choice" checked={a.choice === i} onChange={() => void update({ choice: i })} />{choice === labels[i] ? choice : `${labels[i]}　${choice}`}</label>)}</div><div className="actions"><button className="text-button" type="button" disabled={submitted || busy || expired || a.choice === null} onClick={() => void update({ choice: null })}>回答を取り消す</button></div></fieldset>
          <fieldset disabled={submitted || busy || expired}><legend>自信度</legend><div className="confidence">{([['sure', '確信あり'], ['unsure', '迷った'], ['guess', '推測']] as const).map(([value, label]) => <label key={value}><input type="radio" name="confidence" checked={a.confidence === value} onChange={() => void update({ confidence: value })} />{label}</label>)}</div></fieldset>
          {!submitted && <label><input type="checkbox" checked={a.flagged} disabled={busy || expired} onChange={e => void update({ flagged: e.target.checked })} />後で見直す</label>}
          {submitted && <div className={`explanation ${a.choice === q.correctIndex ? '' : 'incorrect'}`}><h3>{a.choice === q.correctIndex ? '正解' : a.choice === null ? '未回答' : '不正解'} · 正答 {labels[q.correctIndex!]}</h3><p>あなたの回答：{a.choice === null ? '未回答' : labels[a.choice]}</p><p>{q.explanation}</p>{q.choiceExplanations && <ul>{q.choiceExplanations.map((explanation, i) => <li key={i}>{labels[i]}：{explanation}</li>)}</ul>}<small>解説は本アプリ独自作成。公式解答は出典リンクで確認できます。</small></div>}
        </>}
        <p className="source">{q.source.label}<br /><a href={`${q.source.url}#page=${q.source.page || 1}`} target="_blank" rel="noreferrer">原本PDF {q.source.page ? `（${q.source.page}ページ）` : ''}</a>{submitted && q.source.answerUrl && <> · <a href={q.source.answerUrl} target="_blank" rel="noreferrer">公式解答PDF</a></>}</p>
        <div className="question-nav"><button className="secondary" disabled={busy || expired || paused || session.currentIndex === 0} onClick={() => void move(session.currentIndex - 1)}>← 前の問題</button><button disabled={busy || expired || paused || session.currentIndex === session.questions.length - 1} onClick={() => void move(session.currentIndex + 1)}>次の問題 →</button></div>
      </article></div>
    {!submitted && <section className="submit-panel"><p>{session.questions.length}問中 {session.questions.length - unanswered}問に回答 · 未回答 {unanswered}問</p>{confirm ? <><p>提出すると回答が確定します。未回答は不正解になります。</p><div className="actions"><button disabled={busy || expired || paused} onClick={() => void (async () => { const saved = await save(session); if (!saved || saved.status === 'submitted') return; setBusy(true); try { const result = await api<PublicSession>(`/sessions/${session.id}/submit`, 'POST', { revision: saved.revision }); setSession(result); onChange(result); window.scrollTo(0, 0); } catch (e) { setError(e instanceof Error ? e.message : '提出に失敗しました。再試行できます。'); } finally { setBusy(false); setConfirm(false); } })()}>この回答で提出する</button><button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>見直しに戻る</button></div></> : <button disabled={busy || expired || paused || unsaved} onClick={() => setConfirm(true)}>採点・解説へ進む</button>}</section>}
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
