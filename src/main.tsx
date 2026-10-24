import { reviewCollection } from './domain/review';
import { rapidCollection } from './domain/rapid';
import { newOnlyCollection, reviewOnlyCollection } from './domain/focused';
import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { blankAnswer, labels, supplementCollection } from './domain/training';
import type { Answer, PracticeScope, PublicSession, Section } from './domain/training';
import type { TrainingStore } from '../server/store';
import './style.css';
import { KeyboardShortcuts } from './shortcuts';
import { SessionSync, sessionDraft } from './session-sync';
import { copyQuestionScreenshot } from './screenshot';

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
  const [focusTopic, setFocusTopic] = useState('');
  const [focusTag, setFocusTag] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false); const [importText, setImportText] = useState('');
  const [tab, setTab] = useState<'learn' | 'history' | 'ai'>('learn');
  async function refresh() { setDashboard(await api<Dashboard>('/dashboard')); }
  async function open(id: string) { const s = await api<PublicSession>(`/sessions/${id}`); setSession(s); location.hash = `session/${id}`; window.scrollTo(0, 0); }
  async function task(action: () => Promise<void>) {
    setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '処理に失敗しました。'); } finally { setBusy(false); }
  }
  useEffect(() => {
    void task(async () => { const match = location.hash.match(/^#session\/([a-zA-Z0-9-]+)$/); await Promise.all([refresh(), match ? open(match[1]) : Promise.resolve()]); });
  }, []);
  async function start(mode: 'diagnostic' | 'practice' | 'exam', count: number, targetSection: Section = section, scope: PracticeScope = { collection: targetSection === section ? collection : '' }) {
    await task(async () => { const s = await api<PublicSession>('/sessions', 'POST', { section: targetSection, mode, count, ...scope }); setSession(s); location.hash = `session/${s.id}`; await refresh(); window.scrollTo(0, 0); });
  }
  const rapid = dashboard?.rapid.find(r => r.section === section);
  const focused = dashboard?.focused.find(r => r.section === section);
  const analysis = dashboard?.analysis.find(a => a.section === section);
  const active = dashboard?.sessions.find(s => s.status === 'active');
  const completed = dashboard?.sessions.filter(s => s.status === 'submitted') ?? [];
  const supplementTopics = dashboard?.supplements ?? [];
  const focusedTopic = supplementTopics.find(t => t.topic === focusTopic);
  const supplementCount = focusTag ? focusedTopic?.tags.find(t => t.tag === focusTag)?.count ?? 0 : focusedTopic?.count ?? supplementTopics.reduce((sum, t) => sum + t.count, 0);
  return <main>
    <KeyboardShortcuts />
    <header><a className="brand" href="#" onClick={e => { e.preventDefault(); if (!session || session.status !== 'active') void task(async () => { setSession(null); location.hash = ''; await refresh(); }); }}>NW <span>/ TRAINING</span></a><span className="pill">A-1を中心に、1日2時間</span></header>
    {error && <div className="message error" role="alert">{error}<button className="text-button" onClick={() => setError('')}>閉じる</button></div>}
    {notice && <div className="message" role="status">{notice}</div>}
    {!dashboard && !session && !error && <p role="status">学習データを読み込んでいます…</p>}
    {!dashboard && !session && error && <button onClick={() => void task(refresh)}>再接続する</button>}
    {session ? <Exercise key={session.id} initial={session} onHome={() => void task(async () => { setSession(null); location.hash = ''; await refresh(); })} onChange={setSession} onNext={() => void start('practice', [rapidCollection, reviewCollection, reviewOnlyCollection, newOnlyCollection].includes(session.practiceScope?.collection ?? '') ? session.questions.length : 30, session.section, session.practiceScope ?? {})} /> : dashboard && <>
      <nav className="tabs" aria-label="メインメニュー">{([['learn', '今日の学習'], ['history', '履歴と苦手分野'], ['ai', 'AIとの受け渡し']] as const).map(([id, label]) => <button key={id} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
      {tab === 'learn' && <>
        <section className="hero"><p className="eyebrow">PAST QUESTIONS → UNDERSTANDING</p><h1>一問ずつ解いて、<br />苦手を減らしていく。</h1><p>過去問で確かめ、迷った理由を記録。<br />あなたの結果から、次に取り組む問題へ。</p><p className="muted">受験日：2026年10月26日 · 学習配分の目安 A-1 80% / A-2 20%</p></section>
        <section className="metrics" aria-label="学習状況"><article><span>収録済みの過去問・検証済み問題</span><strong>{dashboard.bank.reduce((n, b) => n + b.verified, 0)}<small>問</small></strong></article><article><span>解き終えたセット</span><strong>{completed.length}<small>回</small></strong></article><article><span>これまでの解答</span><strong>{completed.reduce((n, s) => n + s.count, 0)}<small>問</small></strong></article></section>
        {active && <section className="resume"><div><p className="eyebrow">CONTINUE</p><h2>{active.title}</h2><p>{active.count}問中 {active.answered}問に回答済み。途中から再開できます。</p></div><button disabled={busy} onClick={() => void task(() => open(active.id))}>演習を再開する →</button></section>}
        <section><div className="section-heading"><h2>問題を解く</h2><div className="segmented" aria-label="科目">{(['A-1', 'A-2'] as const).map(s => <button key={s} aria-pressed={section === s} onClick={() => { setSection(s); setCollection(''); }}>{s}</button>)}</div></div><p>{section === 'A-1' ? '高度共通の知識を、テクノロジ・マネジメント・ストラテジまで確認します。' : 'ネットワークとセキュリティを中心に、NWの専門知識を確認します。'}</p>
          <label className="collection-select">出題範囲<select aria-label="出題範囲" value={collection} onChange={e => setCollection(e.target.value)}><option value="">すべての年度（診断・本番形式は2025年春期）</option>{dashboard.collections.filter(c => c.section === section).map(c => <option value={c.url} key={c.url}>{c.label} · {c.count}問</option>)}</select></label><div className="practice-grid"><article><p className="eyebrow">START HERE</p><h3>過去問で診断</h3><p>制限時間は{section === 'A-1' ? '30問・50分' : '25問・40分'}。1問ずつ正答と解説を確認します。</p><button disabled={busy || !!active} onClick={() => void start('diagnostic', section === 'A-1' ? 30 : 25)}>{section}の診断を始める</button></article><article><p className="eyebrow">DAILY PRACTICE</p><h3>1問ずつ解く・続けて学ぶ</h3><p>苦手な概念と未着手問題を選抜。回答を確定するたびに解説を確認し、次へ進めます。</p><div className="actions"><button disabled={busy || !!active} onClick={() => void start('practice', 10)}>10問を解く</button><button className="secondary" disabled={busy || !!active} onClick={() => void start('practice', 30)}>30問を解く</button></div></article><article><p className="eyebrow">EXAM PRACTICE</p><h3>時間を計って確認</h3><p>1問ずつ正誤を確認します。時間切れで終了するため、時間配分の練習にも使えます。</p><button className="secondary" disabled={busy || !!active} onClick={() => void start('exam', section === 'A-1' ? 30 : 25)}>本番形式で解く</button></article></div>
          {dashboard.bank.every(b => b.verified === 0) && <p className="message error">教材がまだありません。READMEの教材準備手順を実行してください。</p>}
        </section>
        <section className="rapid-section" aria-labelledby="rapid-heading"><article>
          <p className="eyebrow">{section} · RAPID LEARNING</p><h2 id="rapid-heading">短期集中で知識を増やす</h2>
          <p>全年度から未着手8割・復習2割を基本に選び、残りの問題に合わせて調整します。既出の同一問題群を除き、復習は別の類題・関連問題で確認します。</p>
          <p>{section === 'A-1' ? '技術・管理・戦略をバランスよく。検証済みの分野別補強問題も最大2割含めます。' : 'ネットワーク6割・セキュリティ約2割を目安に、構成・開発の知識も確認します。'}</p>
          <p className="rapid-progress">未着手 <strong>{rapid?.unseen ?? 0}</strong> / {rapid?.available ?? 0}問題群 · 復習の時期 {rapid?.reviewDue ?? 0}概念（別問題あり {rapid?.reviewReady ?? 0}概念）</p>
          <div className="actions"><button disabled={busy || !!active || !rapid?.available} onClick={() => void start('practice', 10, section, { collection: rapidCollection })}>短期集中テストを10問</button><button className="secondary" disabled={busy || !!active || !rapid?.available} onClick={() => void start('practice', 30, section, { collection: rapidCollection })}>短期集中テストを30問</button></div>
          <small>1問ずつ解説を確認する学習用テストです。年度指定に関係なく全教材から選び、出題できる問題が少ないときはその件数で始めます。</small>
        </article></section>
        <section aria-labelledby="focused-heading">
          <h2 id="focused-heading">目的を絞って10問・30問</h2>
          <div className="focused-grid">
            <article aria-labelledby="review-only-heading">
              <p className="eyebrow">{section} · REVIEW ONLY</p><h3 id="review-only-heading">復習専用</h3>
              <p>直近の誤答・迷った正解・わからないと、確信正解から72時間以上たった問題を再確認。苦手な既習概念の関連問題も対象です。</p>
              <p>出題可能：<strong>{focused?.reviewAvailable ?? 0}問</strong></p>
              <div className="actions">{([10, 30] as const).map(count => <button key={count} className={count === 30 ? 'secondary' : undefined} disabled={busy || !!active || (focused?.reviewAvailable ?? 0) < count} onClick={() => void start('practice', count, section, { collection: reviewOnlyCollection })}>復習専用を{count}問</button>)}</div>
              <small>このモードでは既出問題も出題します。履歴がない場合や対象が10問未満の場合は開始できません。</small>
            </article>
            <article aria-labelledby="new-only-heading">
              <p className="eyebrow">{section} · NEW FIELDS ONLY</p><h3 id="new-only-heading">新規分野専用</h3>
              <p>過去に取り組んだ分野・復習概念を除外し、未回答分野だけを出題。同じ問題、版違い、同題や類題も除外します。</p>
              <p>出題可能：<strong>{focused?.newAvailable ?? 0}問</strong></p>
              <div className="actions">{([10, 30] as const).map(count => <button key={count} className={count === 30 ? 'secondary' : undefined} disabled={busy || !!active || (focused?.newAvailable ?? 0) < count} onClick={() => void start('practice', count, section, { collection: newOnlyCollection })}>新規分野専用を{count}問</button>)}</div>
              <small>1問でも取り組んだ分野は、分野全体を対象外にします。未回答の問題でも、既習分野・概念に重なれば出題しません。</small>
            </article>
          </div>
          <p className="muted">どちらも年度指定に関係なく、検証済みの全教材から選びます。指定数に足りない場合は開始できません。10問・30問を完了した後も、同じモード・問題数で続けられます。</p>
        </section>
        {section === 'A-1' && supplementTopics.length > 0 && <section aria-labelledby="supplement-heading"><article>
          <p className="eyebrow">A-1 · TOPIC PRACTICE</p><h2 id="supplement-heading">分野別の細かな補強</h2>
          <p>{supplementTopics.length}分野・{supplementTopics.reduce((sum, t) => sum + t.count, 0)}問。用語の区別、計算、具体的な場面での判断を練習します。全問に正答の理由・各選択肢の説明・根拠資料があります。</p>
          <p className="muted">AI作成・資料照合済みの独自問題です。分野別補強では補強問題だけを出題します。</p>
          <div className="focus-filters"><label className="collection-select">補強する分野<select value={focusTopic} onChange={e => { setFocusTopic(e.target.value); setFocusTag(''); }}><option value="">全分野から幅広く</option>{supplementTopics.map(t => <option key={t.topic} value={t.topic}>{t.topic} · {t.count}問</option>)}</select></label>
          <label className="collection-select">細かな論点<select value={focusTag} disabled={!focusedTopic} onChange={e => setFocusTag(e.target.value)}><option value="">{focusedTopic ? 'この分野の全論点' : '先に分野を選択'}</option>{focusedTopic?.tags.map(t => <option key={t.tag} value={t.tag}>{t.tag} · {t.count}問</option>)}</select></label></div>
          <p>選択中の範囲：{supplementCount}問。未着手と苦手を優先し、問題数が少ない範囲は収録数で始めます。</p>
          <div className="actions">{(supplementCount <= 10 ? [10] : [10, 30]).map(count => <button key={count} className={count === 30 ? 'secondary' : undefined} disabled={busy || !!active || !supplementCount} onClick={() => void start('practice', count, 'A-1', { collection: supplementCollection, topic: focusTopic, tag: focusTag })}>補強問題を{Math.min(count, supplementCount)}問解く</button>)}</div>
        </article></section>}
        {analysis && analysis.attempts > 0 && <section aria-labelledby="review-heading"><article>
          <p className="eyebrow">{section} · PERSONAL REVIEW</p><h2 id="review-heading">苦手な概念を、別の問題で確かめる</h2>
          <p>{analysis.attempts}解答・{analysis.unique}問題群。自信のある正解は{analysis.sureCorrect}解答、「わからない」は{analysis.unknown}解答です。</p>
          <p>優先する概念：{analysis.concepts.filter(c => c.risk > 0).slice(0, 5).map(c => c.concept).join(' / ') || '間隔を空けた定着確認'}。</p>
          <p className="muted">既出の同一問題群は除き、条件・場面の異なる類題や関連問題で確認します。別問題が不足する範囲は少ない件数になります。</p>
          <button disabled={busy || !!active || !analysis.concepts.some(c => c.alternatives > 0 && (c.risk > 0 || c.due))} onClick={() => void start('practice', 10, section, { collection: reviewCollection })}>苦手・復習の類題を10問</button>
        </article></section>}
        <section className="hint"><h2>正解しても、迷ったら記録。</h2><p>「確信あり」「迷った」「推測」で理解の状態を残します。解説直後の正解に加えて、翌日以降に別の問題でも解けるかを確かめましょう。</p></section>
      </>}
      {tab === 'history' && <>
        <section><p className="eyebrow">YOUR PROGRESS</p><h1 className="compact-title">履歴と苦手分野</h1><p>正答率は解答回数による集計です。本試験の得点予測ではありません。</p><div className="table-wrap"><table><thead><tr><th>科目・分野</th><th>正解 / 解答</th><th>異なる問題</th><th>初回正解</th><th>迷った正解等</th></tr></thead><tbody>{dashboard.stats.map(s => <tr key={`${s.section}-${s.topic}`}><th>{s.section} · {s.topic}</th><td>{s.correct} / {s.attempts}</td><td>{s.unique}問</td><td>{s.firstCorrect} / {s.firstCount}</td><td>{s.uncertain}問</td></tr>)}</tbody></table></div>{!dashboard.stats.length && <p className="empty">まだ採点済みの回答はありません。</p>}<p className="muted">同じ問題の反復は「異なる問題」の件数に加算しません。自信度未入力の正解も不安定な正解に含みます。</p></section>
        {dashboard.analysis.filter(a => a.attempts > 0).map(a => <section key={a.section} aria-label={`${a.section}の概念別分析`}>
          <h2>{a.section} · 解答傾向と優先する概念</h2>
          <p>{a.attempts}解答のうち同じ問題群への反復は{a.repeated}解答。初回正解は{a.firstCorrect} / {a.unique}問題群、各問題群の直近正解は{a.latestCorrect} / {a.unique}です。</p>
          <p>「わからない」{a.unknown}解答（正解でも基礎から確認） · 自信のある正解{a.sureCorrect}解答 · 未回答・自信度未入力{a.skipped}解答。</p>
          <p className="muted">少数の回答から分野全体の得意・不得意を断定しません。同じ問題での再正解だけでは定着候補にせず、別日・別問題群での確信正解を確認します。</p>
          <ConceptTable concepts={a.concepts.slice(0, 12)} />
          {a.concepts.length > 12 && <details><summary>残り{a.concepts.length - 12}概念も見る</summary><ConceptTable concepts={a.concepts.slice(12)} /></details>}
          {a.missingAlternatives > 0 && <p className="muted">{a.missingAlternatives}概念は利用できる別問題がありません。元の問題の再出題では埋めず、新しい類題の追加対象としてAI出力に含めます。</p>}
        </section>)}
        {dashboard.bank.map(b => <article className="topic-card" key={b.section}><h3>{b.section} · 収録問題で未着手の分野</h3><p>{b.unseenTopics.join(' / ') || '収録分野は一度ずつ取り組み済みです。'}</p><small>収録教材内の集計です。試験範囲全体の習得を意味しません。</small></article>)}
        <section><h2>これまでの演習</h2><div className="history-list">{dashboard.sessions.map(s => <article key={s.id}><div><h3>{s.title}</h3><small>{date(s.startedAt)} · {s.status === 'cancelled' && '中止済み · '}{s.status === 'submitted' ? `${s.correct} / ${s.count}問正解` : `${s.answered} / ${s.count}問回答済み`}</small></div><button className="secondary" disabled={busy} onClick={() => void task(() => open(s.id))}>{s.status !== 'active' ? '結果を見る' : '再開する'}</button></article>)}</div></section>
      </>}
      {tab === 'ai' && <>
        <section><p className="eyebrow">NEXT LEARNING SET</p><h1 className="compact-title">結果をAIに渡して、次の問題へ。</h1><p>1問の回答を確定したら結果を出力でき、この環境のAIに次セットの作成を依頼します。新しく作った問題は内容を検証してから出題します。</p><article><h2>1. 結果を出力する</h2><p>この環境にもJSONが保存されます。出力したファイルを読むようにAIへ依頼してください。</p><div className="actions">{(['A-1', 'A-2'] as const).map(s => <button disabled={busy} key={s} onClick={() => void task(async () => { const data = await api<{ requestId: string }>('/export', 'POST', { section: s }); download(`learning-context-${s}-${data.requestId}.json`, data); setNotice(`結果を data/exports/${data.requestId}/learning-context.json に保存しました。このファイルをAIに読み込ませてください。`); })}>{s}の結果を出力</button>)}</div></article></section>
        <section><article><h2>2. 次の問題セットを取り込む</h2><p>AIが作成した next-set.json を選ぶか、JSONを貼り付けてください。</p><label className="file-label">JSONファイル<input type="file" accept=".json,application/json" onChange={e => void task(async () => { const file = e.target.files?.[0]; if (file) { if (file.size > 2_000_000) throw new Error('ファイルは2MB以内にしてください。'); setImportText(await file.text()); } })} /></label><label>問題セットのJSON<textarea rows={9} value={importText} onChange={e => setImportText(e.target.value)} placeholder="next-set.json の内容" /></label><button disabled={busy || !importText.trim()} onClick={() => void task(async () => { await api('/import', 'POST', JSON.parse(importText)); setImportText(''); setNotice('セットを取り込みました。検証済みの問題から演習を始められます。AIの新規問題は未検証で保存します。'); await refresh(); })}>内容を検証して取り込む</button></article></section>
        <section><h2>3. 取り込んだセットを解く</h2>{!dashboard.imports.length && <p className="empty">取り込んだセットはここに表示されます。</p>}{dashboard.imports.map(i => <article className="import-card" key={i.requestId}><h3>{i.title}</h3><p>出題可能 {i.readyCount}問 / 確認待ち等 {i.pendingCount}問</p><button disabled={busy || !i.readyCount || (!!active && active.id !== i.sessionId)} onClick={() => void task(async () => { const s = await api<PublicSession>(`/imports/${i.requestId}/start`, 'POST', {}); setSession(s); location.hash = `session/${s.id}`; await refresh(); })}>{i.sessionId ? 'このセットを開く' : `検証済み${i.readyCount}問で始める`}</button></article>)}</section>
        {dashboard.drafts.length > 0 && <section><h2>内容確認待ちのAI問題</h2><p>AIに正答の一意性・計算・根拠の照合を依頼してください。確認内容はCLIで記録します。手順はREADMEにあります。</p><ul>{dashboard.drafts.map(q => <li key={q.id}>{q.id} · {q.prompt}</li>)}</ul></section>}
        <section><button className="secondary" disabled={busy} onClick={() => void task(async () => { const paths = await api<{ sqlite: string; json: string }>('/backup', 'POST', {}); setNotice(`バックアップを保存しました：${paths.sqlite} / ${paths.json}`); })}>履歴をバックアップする</button></section>
      </>}
    </>}
    <footer>IPA非公式の個人学習アプリ · <a href="https://www.ipa.go.jp/shiken/kubun/nw.html" target="_blank" rel="noreferrer">公式試験情報</a><p>過去問の出典は各問題に表示しています。解説は本アプリ独自作成です。</p></footer>
  </main>;
}
function ConceptTable({ concepts }: { concepts: Dashboard['analysis'][number]['concepts'] }) {
  return <div className="table-wrap"><table><thead><tr><th>概念</th><th>現在の確認点</th><th>解答 / 問題群</th><th>次の復習目安</th><th>別問題の候補</th></tr></thead><tbody>
    {concepts.map(c => <tr key={c.concept}><th>{c.concept}</th><td>{c.status}</td><td>{c.attempts} / {c.unique}</td><td>{c.due ? '復習の時期' : date(c.dueAt)}</td><td>{c.alternatives}問題群</td></tr>)}
  </tbody></table></div>;
}

function Exercise({ initial, onHome, onChange, onNext }: { initial: PublicSession; onHome: () => void; onChange: (s: PublicSession) => void; onNext: () => void }) {
  const [session, setSession] = useState(initial);
  const captureRef = useRef<HTMLDivElement>(null);
  const [capturing, setCapturing] = useState(false);
  const [captureMessage, setCaptureMessage] = useState('');
  const [captureError, setCaptureError] = useState('');
  async function screenshot() {
    if (!captureRef.current || capturing) return;
    setCapturing(true); setCaptureMessage(''); setCaptureError('');
    try {
      await copyQuestionScreenshot(captureRef.current);
      setCaptureMessage('問題と解答欄の画像をクリップボードにコピーしました。');
    } catch (error) {
      setCaptureError(error instanceof Error && error.message.includes('HTTPS') ? error.message : '画像をコピーできませんでした。問題画像の読み込みとブラウザーのクリップボード権限を確認して、再試行してください。');
    } finally { setCapturing(false); }
  }
  const [action, setAction] = useState<'grade' | 'submit' | 'cancel' | 'home' | null>(null);
  const busy = action !== null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(''); const [unsaved, setUnsaved] = useState(false);
  const [conflicts, setConflicts] = useState<Draft[]>([]); const [timeoutError, setTimeoutError] = useState('');
  const [confirm, setConfirm] = useState(false); const [paused, setPaused] = useState(false); const [now, setNow] = useState(Date.now());
  const started = useRef(Date.now()); const visibleSeconds = useRef(0);
  const exclusive = useRef(false);
  const ownedDraft = useRef<string | null>(null);
  const key = `nw-draft:${session.id}`;
  const conflictKey = `nw-conflicts:${session.id}`;
  function preserveDraft(draft: Draft) {
    const append = (items: Draft[]) => items.some(item => JSON.stringify(item) === JSON.stringify(draft)) ? items : [...items, draft];
    try {
      const items = append(JSON.parse(localStorage.getItem(conflictKey) || '[]') as Draft[]);
      localStorage.setItem(conflictKey, JSON.stringify(items)); setConflicts(items); return true;
    } catch { setConflicts(append); return false; }
  }
  const [sync] = useState(() => new SessionSync(initial,
    (command, draft, questionId) => api<PublicSession>(`/sessions/${initial.id}/${command}`, command === 'draft' ? 'PUT' : 'POST',
      command === 'draft' ? draft : { revision: draft.revision, questionId, draft }),
    (current, dirty, writing) => {
      setSession(current); setUnsaved(dirty); setSaving(writing);
      try {
        if (dirty) {
          const pending = localStorage.getItem(key);
          if (pending && pending !== ownedDraft.current) {
            const previous = JSON.parse(pending) as Draft;
            if (previous.revision !== current.revision && !preserveDraft(previous)) return;
          }
          ownedDraft.current = JSON.stringify(sessionDraft(current));
          localStorage.setItem(key, ownedDraft.current);
        } else if (ownedDraft.current && localStorage.getItem(key) === ownedDraft.current) {
          localStorage.removeItem(key); ownedDraft.current = null;
        }
      } catch { /* Optional temporary cache; SQLite remains authoritative. */ }
      if (!dirty) onChange(current);
    },
    (e, draft) => {
      if (e instanceof ApiError && e.status === 409) preserveDraft(draft);
      setError(`${e instanceof Error ? e.message : '保存に失敗しました。'} 回答は未保存です。再試行してください。`);
    }));
  useEffect(() => {
    try {
      setConflicts(JSON.parse(localStorage.getItem(conflictKey) || '[]') as Draft[]);
      const pending = localStorage.getItem(key);
      if (pending) {
        const draft = JSON.parse(pending) as Draft;
        if (initial.status === 'active' && draft.revision === initial.revision) {
          sync.edit({ ...initial, ...draft });
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
  const submitted = session.status !== 'active';
  const revealed = session.status === 'submitted' || !!session.graded?.[q.id];
  const remaining = session.deadline ? Math.max(0, Math.ceil((Date.parse(session.deadline) - now) / 1000)) : null;
  const expired = remaining === 0 && !submitted;
  useEffect(() => {
    if (!expired || busy) return;
    let cancelled = false; let retry: ReturnType<typeof setTimeout>;
    async function checkSubmission() {
      try {
        const result = await api<PublicSession>(`/sessions/${session.id}`);
        if (cancelled) return;
        if (result.status !== 'active') {
          sync.accept(result); setTimeoutError(''); return;
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
  function stage(next: PublicSession) {
    const current = sync.current;
    const question = current.questions[current.currentIndex];
    const locked = current.status !== 'active' || !!current.graded?.[question.id];
    const elapsed = locked ? 0 : visibleSeconds.current + (!document.hidden && !paused ? (Date.now() - started.current) / 1000 : 0);
    const answer = next.answers[question.id] ?? blankAnswer();
    visibleSeconds.current = 0; started.current = Date.now();
    sync.edit({ ...next, answers: { ...next.answers, [question.id]: { ...answer, seconds: Math.round((answer.seconds + elapsed) * 10) / 10 } } });
  }
  async function save() {
    if (sync.current.status !== 'active') return sync.current;
    if (exclusive.current || expired) return null;
    setError(''); stage(sync.current);
    return sync.flush();
  }
  function update(patch: Partial<Answer>) {
    if (exclusive.current || expired) return;
    const current = sync.current; const id = current.questions[current.currentIndex].id;
    setError(''); stage({ ...current, answers: { ...current.answers, [id]: { ...(current.answers[id] ?? blankAnswer()), ...patch } } });
    void sync.flush();
  }
  async function commit(command: 'grade' | 'submit' | 'cancel') {
    if (exclusive.current || expired) return;
    exclusive.current = true; setAction(command); setError('');
    const questionId = sync.current.questions[sync.current.currentIndex].id;
    stage(sync.current);
    try {
      const result = await sync.commit(command, questionId);
      if (result && result.status !== 'active') window.scrollTo(0, 0);
    } catch (e) {
      // The response can be lost after the server commits. Fetch only to recover
      // that confirmed result; never merge or overwrite answers from another tab.
      try {
        const result = await api<PublicSession>(`/sessions/${initial.id}`);
        if (result.status !== 'active' || (command === 'grade' && result.graded?.[questionId])) {
          sync.accept(result); setError(''); return;
        }
      } catch { /* Keep the temporary draft available for an explicit retry. */ }
      setError(`${e instanceof Error ? e.message : '結果を取得できませんでした。'} 回答は未保存の可能性があります。確定を再試行するか、再読込してください。`);
    } finally { exclusive.current = false; setAction(null); setConfirm(false); }
  }
  async function home() {
    if (exclusive.current) return;
    if (submitted) { onHome(); return; }
    if (expired) return;
    exclusive.current = true; setAction('home'); setError('');
    stage(sync.current);
    try { if (await sync.flush()) onHome(); }
    finally { exclusive.current = false; setAction(null); }
  }
  function move(index: number) {
    if (exclusive.current || expired || paused) return;
    const current = sync.current;
    if (current.status !== 'active') sync.accept({ ...current, currentIndex: index });
    else {
      setError(''); stage({ ...current, currentIndex: index });
      void sync.flush();
    }
    setConfirm(false);
  }
  const nextImage = session.questions[session.currentIndex + 1]?.source.image;
  useEffect(() => {
    if (!nextImage || paused) return;
    const preload = document.createElement('link');
    preload.rel = 'preload'; preload.as = 'image'; preload.href = nextImage;
    document.head.append(preload);
    return () => preload.remove();
  }, [nextImage, paused]);
  useEffect(() => {
    if (!unsaved) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [unsaved]);
  const unanswered = session.questions.filter(x => session.answers[x.id]?.choice == null).length;
  const score = session.questions.filter(x => session.answers[x.id]?.choice === x.correctIndex).length;
  const uncertain = session.questions.filter(x => session.answers[x.id]?.choice === x.correctIndex && session.answers[x.id]?.confidence !== 'sure').length;
  return <>
    <div className="exercise-top"><button className="text-button" disabled={busy || expired} onClick={() => void home()}>← 学習画面へ</button><span className="save-status" role="status">{submitted ? (session.status === 'cancelled' ? '中止済み・保存済み' : '提出済み・保存済み') : expired ? '提出結果を確認しています…' : busy && action !== 'home' ? '回答を確定しています…' : saving || action === 'home' ? '保存しています…' : unsaved ? '未保存の回答あり' : 'この環境に保存済み'}</span></div>
    {error && <div className="message error" role="alert">{error}{unsaved && <button disabled={busy} onClick={() => void save()}>保存を再試行</button>}<button className="secondary" onClick={() => download(`unsaved-${session.id}.json`, session)}>回答の控えを保存</button></div>}
    {conflicts.length > 0 && <div className="message" role="alert">別の画面との競合などで未保存になった回答の控えを保持しています。現在の回答とは別にダウンロードできます。<button className="secondary" onClick={() => download(`conflicting-answers-${session.id}.json`, { sessionId: session.id, drafts: conflicts })}>競合した回答の控えを保存</button></div>}
    {timeoutError && !submitted && <div className="message error" role="alert">{timeoutError}</div>}
    {submitted && <section className="result"><p className="eyebrow">{session.status === 'cancelled' ? '中止したセットの結果' : 'RESULT'}</p><h1 className="compact-title">{score}<span> / {session.status === 'cancelled' ? Object.keys(session.graded ?? {}).length : session.questions.length}問正解</span></h1><p>迷った・推測・わからない・自信度未入力の正解：{uncertain}問 · 未回答：{unanswered}問</p>{session.status === 'cancelled' && <p>回答済みの結果を保存しました。未回答の問題は学習履歴に記録していません。</p>}{session.practiceScope?.collection === rapidCollection && <p>今回確認した分野：{[...new Set(session.questions.map(q => q.topic))].join(' / ')}。次のセットも未着手の知識と別問題での復習を組み合わせます。</p>}<div className="actions"><button onClick={onNext}>{session.practiceScope?.collection === reviewOnlyCollection ? '復習専用を続ける →' : session.practiceScope?.collection === newOnlyCollection ? '新規分野専用を続ける →' : session.practiceScope?.collection === rapidCollection ? '短期集中テストを続ける →' : session.practiceScope?.collection === reviewCollection ? '苦手・復習の類題を続ける →' : session.practiceScope?.collection === supplementCollection ? '同じ範囲で続ける →' : '続けて問題を解く →'}</button><button className="secondary" onClick={onHome}>履歴・AI連携へ</button></div></section>}
    <section className="exercise-heading"><div><p className="eyebrow">{session.section} / {submitted ? 'REVIEW' : 'PRACTICE'}</p><h2>{session.title}</h2></div>{remaining !== null && !submitted && <p className={`timer ${remaining < 300 ? 'urgent' : ''}`} aria-label="残り時間">残り {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</p>}</section>
    <div className="question-layout"><aside><p>{session.currentIndex + 1} / {session.questions.length}問</p><div className="question-map">{session.questions.map((x, i) => <button key={x.id} disabled={busy || expired || paused} aria-label={`問${i + 1}${session.answers[x.id]?.choice != null ? ' 回答済み' : ' 未回答'}${session.answers[x.id]?.flagged ? ' 見直し' : ''}`} aria-current={i === session.currentIndex ? 'step' : undefined} className={`${session.answers[x.id]?.choice != null ? 'answered' : ''} ${session.answers[x.id]?.flagged ? 'flagged' : ''}`} onClick={() => void move(i)}>{i + 1}</button>)}</div><p className="muted">色付き：回答済み<br />●：見直し</p>{!session.deadline && !submitted && <button className="secondary" onClick={() => { started.current = Date.now(); setPaused(!paused); }}>{paused ? '学習を再開' : '一時停止'}</button>}</aside>
      <article className="question-card">
        <div className="screenshot-actions"><button className="secondary" disabled={capturing || paused} onClick={() => void screenshot()}>{capturing ? '画像をコピーしています…' : 'スクリーンショットをコピー'}</button></div>
        {captureMessage && <p role="status" className="message">{captureMessage}</p>}
        {captureError && <p role="alert" className="message error">{captureError}</p>}
        {paused && <div className="empty">一時停止中です。再開すると問題が表示されます。</div>}
        <div ref={captureRef}><div className="section-heading"><p className="topic">{q.topic}{q.tags.length > 0 ? ` · ${q.tags.join(' / ')}` : ''}</p><span className="pill">{q.origin === 'past' ? '公式過去問' : q.origin === 'ai' ? 'AI類題・内容確認済み' : '独自問題'}</span></div><h2>{q.prompt}</h2>{session.selectionReasons[q.id] && <small>出題理由：{session.selectionReasons[q.id]}</small>}
        {!paused && <>
          {q.source.image && <><a className="question-image-link" href={q.source.image} target="_blank" rel="noreferrer"><img className="question-image" src={q.source.image} alt={`${q.source.label}の問題文・図表・選択肢。クリックで拡大できます。`} onError={() => setError('問題画像を読み込めません。原本PDFで該当ページを確認してください。')} /></a><small>問題部分を切り抜いて表示しています。問題文の変更はありません。画像を押すと拡大します。</small></>}
          <fieldset disabled={submitted || revealed || busy || expired}><legend>解答を選んでください</legend><div className={q.source.image ? 'answer-grid' : 'answer-list'}>{q.choices.map((choice, i) => <label key={i} className={`${revealed && i === q.correctIndex ? 'correct-choice' : ''}`}><input type="radio" name="choice" checked={a.choice === i} onChange={() => void update({ choice: i })} />{choice === labels[i] ? choice : `${labels[i]}　${choice}`}</label>)}</div><div className="actions"><button className="text-button" type="button" disabled={submitted || revealed || busy || expired || a.choice === null} onClick={() => void update({ choice: null })}>回答を取り消す</button></div></fieldset>
        </>}
        </div>
        {!paused && <>
          <fieldset disabled={submitted || revealed || busy || expired}><legend>自信度</legend><div className="confidence">{([['sure', '確信あり'], ['unsure', '迷った'], ['guess', '推測'], ['unknown', 'わからない']] as const).map(([value, label]) => <label key={value}><input type="radio" name="confidence" checked={a.confidence === value} onChange={() => void update({ confidence: value })} />{label}</label>)}</div></fieldset>
          {!submitted && <label><input type="checkbox" checked={a.flagged} disabled={busy || expired} onChange={e => void update({ flagged: e.target.checked })} />後で見直す</label>}
          {!submitted && !revealed && <div className="answer-confirm"><p>解答と自信度を選び、1問ずつ正誤・解説を確認します。「わからない」は解答なしでも確定できます。</p><button data-answer-confirm disabled={busy || expired || paused || (a.choice === null && a.confidence !== 'unknown')} onClick={() => void commit('grade')}>この回答を確定する</button><small>キーボード：e で確定 · l で次の問題</small></div>}
          {revealed && <div role="region" aria-label="この問題の採点結果" className={`explanation ${a.choice === q.correctIndex ? '' : 'incorrect'}`}><h3>{a.choice === q.correctIndex ? '正解' : a.choice === null ? (a.confidence === 'unknown' ? 'わからない' : '未回答') : '不正解'} · 正答 {labels[q.correctIndex!]}</h3><p>あなたの回答：{a.choice === null ? '未回答' : labels[a.choice]}</p><p>回答時の自信度：{a.confidence === null ? '未入力' : { sure: '確信あり', unsure: '迷った', guess: '推測', unknown: 'わからない' }[a.confidence]}</p><p className="explanation-body">{q.explanation}</p>{q.choiceExplanations && <ul>{q.choiceExplanations.map((explanation, i) => <li key={i}>{labels[i]}：{explanation}</li>)}</ul>}<small>{q.origin === 'past' ? '解説は本アプリ独自作成（追加分はAI生成）。公式解答は出典リンクで確認できます。' : '独自作成の問題・解説です。根拠資料と確認方法を下に表示しています。'}</small></div>}
        </>}
        <div className="source">{q.source.label}<br />{q.origin === 'past' ? <><a href={`${q.source.url}#page=${q.source.page || 1}`} target="_blank" rel="noreferrer">原本PDF {q.source.page ? `（${q.source.page}ページ）` : ''}</a>{revealed && q.source.answerUrl && <> · <a href={q.source.answerUrl} target="_blank" rel="noreferrer">公式解答PDF</a></>}{revealed && q.review.references.filter(url => url !== q.source.url && url !== q.source.answerUrl).length > 0 && <div className="actions">{q.review.references.filter(url => url !== q.source.url && url !== q.source.answerUrl).map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">解説の参考資料{i + 1}</a>)}</div>}</> : revealed ? <><div className="actions">{q.review.references.map((url, i) => <a key={url} href={url} target="_blank" rel="noreferrer">根拠資料{i + 1}</a>)}</div><p>確認：{q.review.reviewer} · {date(q.review.at)}<br />{q.review.method}</p></> : '根拠資料と確認方法は回答の確定後に表示します。'}</div>
        <div className="question-nav"><button data-question-prev className="secondary" disabled={busy || expired || paused || session.currentIndex === 0} onClick={() => void move(session.currentIndex - 1)}>← 前の問題</button>{submitted && session.currentIndex === session.questions.length - 1 ? <button data-question-next onClick={onNext}>次の問題を続ける →</button> : <button data-question-next disabled={busy || expired || paused || session.currentIndex === session.questions.length - 1} onClick={() => void move(session.currentIndex + 1)}>次の問題 →</button>}</div>
      </article></div>
    {!submitted && <section className="submit-panel"><p>途中で中止すると、選択済み・「わからない」の回答だけを採点して保存します。未回答は記録せず、このセットの再開はできなくなります。</p><button className="secondary" disabled={busy || expired} onClick={() => { if (window.confirm('このセットを途中で中止しますか？回答済みの結果だけを保存し、未回答は学習履歴に記録しません。中止後は再開できません。')) void commit('cancel'); }}>途中で中止する</button></section>}
    {!submitted && <section className="submit-panel"><p>{session.questions.length}問中 {Object.keys(session.graded ?? {}).length}問を採点済み。1問ずつ解説を確認して進めます。</p>{confirm ? <><p>このセットを終了します。未確定の回答も採点し、未回答は不正解として記録します。続けて学習する場合は見直しに戻ってください。</p><div className="actions"><button disabled={busy || expired || paused} onClick={() => void commit('submit')}>この回答で提出する</button><button className="secondary" disabled={busy} onClick={() => setConfirm(false)}>見直しに戻る</button></div></> : <button className="secondary" disabled={busy || expired || paused} onClick={() => setConfirm(true)}>セットを終了して結果を見る</button>}</section>}
  </>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
