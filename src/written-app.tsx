import { useEffect, useRef, useState } from 'react';
import type { Assessment, WrittenCatalog, WrittenDashboard, WrittenSession, WrittenSummary } from './domain/written';
import { assessmentLabels, characterCount } from './domain/written';
import { WrittenSync, writtenApi, writtenDraft } from './written-sync';
import './written.css';

const timestamp = (s: string) => new Date(s).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const statusLabels = { writing: '解答中', reviewing: '振り返り中', completed: '完了' };
function download(session: WrittenSession) {
  const data = { question: session.question, title: session.question.source.label, status: session.status, savedAt: new Date().toISOString(), ...writtenDraft(session) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `NW-${session.question.id}-${session.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function WrittenApp() {
  const [dashboard, setDashboard] = useState<WrittenDashboard>(); const [session, setSession] = useState<WrittenSession>();
  const [section, setSection] = useState('all'); const [year, setYear] = useState('all'); const [filter, setFilter] = useState('all'); const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'practice' | 'history'>('practice'); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function refresh() { setDashboard(await writtenApi<WrittenDashboard>('/dashboard')); }
  function show(s: WrittenSession) { setSession(s); history.pushState(null, '', `#written/${s.id}`); window.scrollTo(0, 0); }
  async function task(action: () => Promise<void>) { setBusy(true); setError(''); try { await action(); } catch (e) { setError(e instanceof Error ? e.message : '通信に失敗しました。'); } finally { setBusy(false); } }
  useEffect(() => {
    document.title = 'NW / WRITE — ネットワークスペシャリスト 記述対策';
    let alive = true;
    const load = async () => {
      const match = location.hash.match(/^#written\/([a-zA-Z0-9-]+)$/);
      try {
        const [d, s] = await Promise.all([writtenApi<WrittenDashboard>('/dashboard'), match ? writtenApi<WrittenSession>(`/sessions/${match[1]}`) : Promise.resolve(undefined)]);
        if (alive) { setDashboard(d); setSession(s); setError(''); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : '読み込めませんでした。'); }
    };
    void load(); window.addEventListener('hashchange', load); window.addEventListener('popstate', load);
    return () => { alive = false; window.removeEventListener('hashchange', load); window.removeEventListener('popstate', load); };
  }, []);
  async function open(id: string) { await task(async () => show(await writtenApi<WrittenSession>(`/sessions/${id}`))); }
  async function start(q: WrittenCatalog) { await task(async () => show(await writtenApi<WrittenSession>('/sessions', 'POST', { questionId: q.id }))); }
  async function home() { setTab('practice'); setSession(undefined); history.pushState(null, '', location.pathname); window.scrollTo(0, 0); await task(refresh); }
  const latest = (id: string) => dashboard?.sessions.find(s => s.questionId === id);
  const needsReview = (id: string) => { const s = latest(id); return s && (s.partial > 0 || s.review > 0); };
  const questions = dashboard?.questions.filter(q => (section === 'all' || q.section === section)
    && (year === 'all' || q.year === Number(year))
    && (filter === 'all' || filter === 'new' && !latest(q.id) || filter === 'review' && needsReview(q.id))
    && `${q.title} ${q.tags.join(' ')} ${q.year}`.toLowerCase().includes(query.toLowerCase().trim())) ?? [];
  const completed = dashboard?.sessions.filter(s => s.status === 'completed') ?? [];
  const inProgress = dashboard?.sessions.filter(s => s.status !== 'completed') ?? [];
  const reviewCount = dashboard?.questions.filter(q => needsReview(q.id)).length ?? 0;
  const years = [...new Set(dashboard?.questions.map(q => q.year))].sort((a, b) => b - a);
  return <div className="written-app">
    <a className="w-skip" href="#w-content" onClick={e => { e.preventDefault(); document.getElementById('w-content')?.focus(); }}>本文へ移動</a>
    <header className="w-header"><a className="w-brand" href="/" aria-label="NW WRITE ホーム">NW<span className="w-brand-slash">/</span>WRITE<span className="w-brand-caption">NETWORK SPECIALIST</span></a><nav aria-label="サイト切替"><span className="w-current">科目B 記述対策</span><a href="/choice">科目A 選択式対策 <span aria-hidden="true">↗</span></a></nav></header>
    <main id="w-content" tabIndex={-1} className={session ? 'w-main w-main-exercise' : 'w-main'}>
      {error && <div className="w-alert" role="alert">{error}<button onClick={() => void task(refresh)}>再接続</button><button onClick={() => void home()}>ホームへ</button></div>}
      {session ? <WrittenExercise key={session.id} initial={session} onHome={home} onUpdated={() => void refresh().catch(() => {})} /> : <>
        <nav className="w-tabs" aria-label="学習メニュー"><button aria-current={tab === 'practice' ? 'page' : undefined} onClick={() => setTab('practice')}>過去問を解く</button><button aria-current={tab === 'history' ? 'page' : undefined} onClick={() => setTab('history')}>学習の記録 <span>{dashboard?.sessions.length ?? 0}</span></button></nav>
        {!dashboard && !error && <p role="status" className="w-loading">学習データを読み込んでいます…</p>}
        {dashboard && tab === 'practice' && <>
          <section className="w-hero"><div><p className="w-eyebrow">NETWORK SPECIALIST / WRITTEN PRACTICE</p><h1>知識を、<br /><span>伝わる解答に。</span></h1><p className="w-hero-description">図を読み、根拠をつかみ、自分の言葉で書く。<br />公式過去問で、記述の力を一問ずつ。</p><a className="w-button" href="#question-bank">過去問を選ぶ <span aria-hidden="true">↓</span></a><p className="w-hero-note">科目B-1・B-2（旧午後Ⅰ・Ⅱ）対応</p></div><aside className="w-study-card" aria-label="記述演習の進め方"><div className="w-sheet-top"><span>YOUR STUDY NOTE</span><i aria-hidden="true">↗</i></div><h2>読む。書く。確かめる。</h2><ol><li><b>01</b><div><strong>原本で考える</strong><p>問題文と構成図を、そのまま読む。</p></div></li><li><b>02</b><div><strong>制約の中で書く</strong><p>字数を確認しながら解答を組み立てる。</p></div></li><li><b>03</b><div><strong>解答例と比べる</strong><p>足りなかった要点を、次の一問へ。</p></div></li></ol><div className="w-sheet-bottom"><span className="w-dot" /> 回答・復習メモは自動保存</div></aside></section>
          <section className="w-stats" aria-label="記述対策の学習状況"><div><span>収録している過去問</span><strong>{dashboard.questions.length}<small>大問</small></strong><p>{years.length > 1 ? `${years[years.length-1]}〜${years[0]}年春期` : `${years[0]}年春期`} / B-1・B-2</p></div><div><span>完了した演習</span><strong>{completed.length}<small>回</small></strong><p>公式解答例で振り返り済み</p></div><div><span>もう一度取り組む</span><strong>{reviewCount}<small>大問</small></strong><p>直近の記録に一部・要復習あり</p></div></section>
          {inProgress.length > 0 && <section className="w-resume"><div><p className="w-eyebrow">CONTINUE LEARNING</p><h2>前回の続きから。</h2><p>{inProgress[0].section} 問{inProgress[0].number} · {inProgress[0].title}<br /><small>{statusLabels[inProgress[0].status]} · {inProgress[0].answered}/{inProgress[0].total}欄を記入</small></p></div><button disabled={busy} onClick={() => void open(inProgress[0].id)}>演習を再開する →</button></section>}
          <section id="question-bank" className="w-bank"><div className="w-section-title"><div><p className="w-eyebrow">PAST QUESTION LIBRARY</p><h2>過去問から、練習を始める。</h2></div><span>{questions.length} / {dashboard.questions.length} 大問</span></div><p className="w-description">大問を1つ選んで、自分のペースで。B-1は1大問45分、B-2は120分が練習の目安です。</p>
            <div className="w-filters"><fieldset><legend className="w-sr-only">科目で絞り込み</legend>{[['all','すべて'],['B-1','B-1 / 旧午後Ⅰ'],['B-2','B-2 / 旧午後Ⅱ']].map(([id,label]) => <button key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}</fieldset><label className="w-sr-only" htmlFor="w-year">年度</label><select id="w-year" value={year} onChange={e => setYear(e.target.value)}><option value="all">すべての年度</option>{years.map(y => <option key={y} value={y}>{y}年 春期</option>)}</select><label className="w-sr-only" htmlFor="w-state">学習状況</label><select id="w-state" value={filter} onChange={e => setFilter(e.target.value)}><option value="all">すべての学習状況</option><option value="new">未着手</option><option value="review">復習する</option></select><label className="w-search"><span aria-hidden="true">⌕</span><input aria-label="問題を検索" type="search" placeholder="テーマ・キーワードで検索" value={query} onChange={e => setQuery(e.target.value)} /></label></div>
            <div className="w-question-grid">{questions.map(q => { const s = latest(q.id); return <article className="w-question-card" key={q.id}><div className="w-card-meta"><span className={`w-section-badge ${q.section === 'B-2' ? 'w-b2' : ''}`}>{q.section}</span><span>{q.year}年 {q.season} · 問{q.number}</span><span className="w-card-status">{s ? s.status !== 'completed' ? statusLabels[s.status] : needsReview(q.id) ? '復習する' : '完了' : '未着手'}</span></div><h3>{q.title}</h3><div className="w-tags">{q.tags.map(t => <span key={t}>{t}</span>)}</div><div className="w-card-bottom"><span>{q.slotCount} 回答欄 <i>·</i> 目安 {q.minutes}分</span><button className="w-link-button" disabled={busy} onClick={() => s && s.status !== 'completed' ? void open(s.id) : void start(q)}>{s?.status === 'completed' ? '解き直す' : s ? '続きから' : '問題を解く'} <span aria-hidden="true">→</span></button></div></article>; })}</div>
            {!questions.length && <div className="w-empty"><h3>条件に合う問題はありません</h3><p>科目・年度・学習状況・検索語を変更してみてください。</p><button className="w-secondary" onClick={() => { setSection('all'); setYear('all'); setFilter('all'); setQuery(''); }}>絞り込みを解除</button></div>}
          </section><section className="w-method"><span aria-hidden="true">✎</span><div><h2>丸暗記で終わらせない、答え合わせ。</h2><p>公式解答例と自分の回答を並べ、各欄を「できた・一部できた・要復習」で振り返ります。記述の表現違いは自分で確かめ、抜けた根拠や気付きをメモに残しましょう。</p><small>自己評価による学習記録です。本試験の得点や合否を判定するものではありません。</small></div></section>
        </>}
        {dashboard && tab === 'history' && <section className="w-history"><p className="w-eyebrow">LEARNING LOG</p><h1>書いた分だけ、振り返る。</h1><p className="w-description">解答中の演習も、解き直しの記録もここに残ります。</p>{!dashboard.sessions.length ? <div className="w-empty"><h2>最初の一問を、ここから。</h2><p>過去問に取り組むと、回答と振り返りが記録されます。</p><button onClick={() => setTab('practice')}>過去問を選ぶ</button></div> : <div className="w-history-list">{dashboard.sessions.map(s => <HistoryRow key={s.id} session={s} busy={busy} onOpen={() => void open(s.id)} />)}</div>}</section>}
      </>}
    </main><footer className="w-footer"><div className="w-brand">NW / WRITE</div><p>ネットワークスペシャリストのための、非公式の記述練習ノート。</p><p>問題・図表・公式解答例・採点講評の著作権はIPAに帰属します。学習のヒントは本アプリ独自作成です。</p><a href="https://www.ipa.go.jp/shiken/mondai-kaiotu/" target="_blank" rel="noreferrer">出典：IPA 過去問題 ↗</a></footer>
  </div>;
}
function HistoryRow({ session: s, busy, onOpen }: { session: WrittenSummary; busy: boolean; onOpen: () => void }) {
  return <article><div><span className="w-section-badge">{s.section}</span><small>{timestamp(s.updatedAt)} · {statusLabels[s.status]}</small><h2>{s.year}年 問{s.number} · {s.title}</h2><p>{s.status === 'writing' ? `${s.answered}/${s.total}欄を記入` : `できた ${s.good} ／ 一部 ${s.partial} ／ 要復習 ${s.review} ／ 未評価 ${s.total-s.good-s.partial-s.review}`}</p></div><button className="w-secondary" disabled={busy} onClick={onOpen}>{s.status === 'completed' ? '回答と振り返りを見る' : '続きを開く'} →</button></article>;
}
function WrittenExercise({ initial, onHome, onUpdated }: { initial: WrittenSession; onHome: () => Promise<void>; onUpdated: () => void }) {
  const [, render] = useState(0); const syncRef = useRef<WrittenSync | null>(null);
  const [busy, setBusy] = useState(false); const [actionError, setActionError] = useState(''); const [confirmReveal, setConfirmReveal] = useState(false);
  const [now, setNow] = useState(Date.now()); const [focusSlot, setFocusSlot] = useState('all');
  useEffect(() => {
    let storage: Storage | undefined; try { storage = window.localStorage; } catch { /* Server saves remain available. */ }
    const sync = new WrittenSync(initial, () => render(n => n+1), storage); syncRef.current = sync; render(n => n+1);
    const unload = (event: BeforeUnloadEvent) => { if (sync.dirty) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload); const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => { sync.dispose(); window.removeEventListener('beforeunload', unload); clearInterval(interval); };
  }, [initial]);
  const sync = syncRef.current; const s = sync?.session ?? initial; const q = s.question;
  const writing = s.status === 'writing'; const completed = s.status === 'completed';
  const answered = Object.values(s.answers).filter(a => a.trim()).length; const assessed = Object.keys(s.assessments).length;
  const seconds = Math.max(0, Math.floor((Date.parse(s.revealedAt ?? new Date(now).toISOString()) - Date.parse(s.startedAt))/1000));
  const pageIndex = q.pages.indexOf(s.page);
  const reviewCount = Object.values(s.assessments).filter(v => v !== 'good').length;
  const slots = q.slots.filter(slot => focusSlot === 'all' || focusSlot === 'unassessed' && !s.assessments[slot.id] || focusSlot === 'review' && s.assessments[slot.id] && s.assessments[slot.id] !== 'good');
  function movePage(page: number) {
    if (!sync || busy) return;
    if (completed) { sync.session = { ...sync.session, page }; render(n => n+1); }
    else sync.edit({ page });
  }
  async function command(action: 'save' | 'home' | 'reveal' | 'complete') {
    if (!sync) return; setBusy(true); setActionError('');
    try { await sync.save(action === 'reveal' || action === 'complete' ? action : 'draft'); onUpdated(); if (action === 'home') await onHome(); }
    catch (e) { setActionError(e instanceof Error ? e.message : '保存に失敗しました。'); } finally { setBusy(false); }
  }
  return <>
    <div className="w-exercise-toolbar"><button className="w-link-button" disabled={busy || !sync} onClick={() => void command('home')}>← 保存して一覧へ</button><span role="status" className={`w-save ${sync?.state === 'saved' ? '' : 'w-not-saved'}`}>{sync?.state === 'saving' ? '保存しています…' : sync?.state === 'conflict' ? '保存の競合あり' : sync?.state === 'unsaved' ? '回答は未保存' : 'この環境に保存済み'}</span></div>
    {(sync?.error || actionError) && <div className="w-alert" role="alert"><p>{sync?.error || actionError}</p><p>回答はこの画面に保持されています。控えをダウンロードできます。</p><div className="w-actions"><button onClick={() => download(s)}>回答の控えをダウンロード</button>{sync?.state === 'conflict' ? <button className="w-secondary" onClick={() => { download(s); sync.discardBackup(); location.reload(); }}>控えを保存して最新の内容を読み込む</button> : <button className="w-secondary" disabled={busy} onClick={() => void command('save')}>保存を再試行</button>}</div></div>}
    {sync?.recovered && !sync.error && <p className="w-notice">ブラウザーに退避した未保存の回答を復元しました。</p>}
    <section className="w-exercise-heading"><div><div className="w-card-meta"><span className="w-section-badge">{q.section}</span><span>{q.year}年 {q.season} · 問{q.number}</span><span>{statusLabels[s.status]}</span></div><h1>{q.title}</h1><p>{writing ? `記入済み ${answered} / ${q.slots.length}欄` : `振り返り ${assessed} / ${q.slots.length}欄`}<span className="w-heading-divider">/</span>{writing ? '解答は途中で保存して再開できます。' : '公式解答例と比較して、要点を振り返りましょう。'}</p></div><div className="w-time"><small>{writing ? '開始からの経過' : '解答例確認まで'}</small><strong>{Math.floor(seconds/60)}<span>分</span> {seconds%60}<span>秒</span></strong><small>練習の目安 {q.minutes}分 · 自動終了なし</small></div></section>
    {q.notice && <aside className="w-notice" aria-label="公式問題の注意事項"><p>{q.notice.text}</p><a href={q.notice.url} target="_blank" rel="noreferrer">IPAのお知らせ ↗</a></aside>}
    {completed && <section className="w-result" aria-label="振り返りの結果"><div><p className="w-eyebrow">PRACTICE COMPLETE</p><h2>一問分の理解を、次につなげる。</h2><p>できた {Object.values(s.assessments).filter(v => v === 'good').length} ／ 一部できた {Object.values(s.assessments).filter(v => v === 'partial').length} ／ 要復習 {Object.values(s.assessments).filter(v => v === 'review').length}</p><small>自己評価の記録です。採点結果ではありません。解き直しは一覧の同じ問題から始められます。</small></div><button onClick={() => void command('home')}>次の問題を選ぶ →</button></section>}
    <div className="w-workspace"><section className="w-document" aria-label="問題文と図表"><div className="w-panel-heading"><h2>問題文・図表</h2><a href={`${q.source.localPdf}#page=${s.page}`} target="_blank" rel="noreferrer">原本PDF ↗</a></div><div className="w-page-controls"><button aria-label="前のページ" className="w-secondary" disabled={pageIndex === 0 || busy || !sync} onClick={() => movePage(q.pages[pageIndex-1])}>←</button><label>原本ページ<select aria-label="問題ページ" value={s.page} disabled={busy || !sync} onChange={e => movePage(Number(e.target.value))}>{q.pages.map(p => <option key={p} value={p}>{p}ページ {q.questionPages.includes(p) ? '· 設問' : '· 本文'}</option>)}</select></label><button className="w-secondary" aria-label="次のページ" disabled={pageIndex === q.pages.length-1 || busy || !sync} onClick={() => movePage(q.pages[pageIndex+1])}>→</button></div><div className="w-document-links"><button disabled={busy || !sync} className="w-link-button" onClick={() => movePage(q.questionPages[0])}>設問のページへ ↓</button><a href="#written-answers" onClick={e => { e.preventDefault(); document.getElementById('written-answers')?.scrollIntoView({block:'start'}); }}>解答欄へ ↓</a></div><div className="w-page-viewer"><a href={`/written/${q.year}/pm${q.section === 'B-1' ? 1 : 2}-p${s.page}.png`} target="_blank" rel="noreferrer"><img key={s.page} src={`/written/${q.year}/pm${q.section === 'B-1' ? 1 : 2}-p${s.page}.png`} alt={`${q.source.label} 原本${s.page}ページ。クリックで拡大できます。`} onError={e => { e.currentTarget.alt='問題画像を読み込めません。上の原本PDFから確認してください。'; }} /></a><p>画像を押すと別タブで拡大できます。</p></div><div className="w-source">{q.source.label}<br />問題文・図表はIPA公式原本を表示しています。<a href={`${q.source.url}#page=${s.page}`} target="_blank" rel="noreferrer">IPAの原本 ↗</a></div></section>
    <section id="written-answers" className="w-answers" aria-label="記述解答"><div className="w-panel-heading"><h2>{writing ? 'あなたの解答' : '解答と振り返り'}</h2><span>{writing ? `${answered}/${q.slots.length} 記入` : `${assessed}/${q.slots.length} 評価`}</span></div>{!writing && <div className="w-review-intro"><p>意味と根拠が解答例の要点を満たしているかを確認します。表現の完全一致は不要です。</p><div className="w-actions"><a href={q.source.localAnswer} target="_blank" rel="noreferrer">公式解答例PDF ↗</a><a href={q.source.localComment} target="_blank" rel="noreferrer">公式採点講評PDF ↗</a></div><label>表示する回答<select value={focusSlot} onChange={e => setFocusSlot(e.target.value)}><option value="all">すべての回答欄</option><option value="unassessed">まだ評価していない欄</option><option value="review">一部できた・要復習の欄</option></select></label></div>}
      <div className="w-answer-scroll">{slots.map(slot => { const answer=s.answers[slot.id] ?? ''; const count=characterCount(answer); const over=slot.limit !== undefined && count>slot.limit; return <article className={`w-answer-item ${s.assessments[slot.id] ? `w-assessed-${s.assessments[slot.id]}` : ''}`} key={slot.id}><div className="w-answer-label"><label htmlFor={`answer-${slot.id}`}>{slot.label}</label><span className={over ? 'w-over' : ''}>{count}{slot.limit ? ` / ${slot.limit}字` : '字'}</span></div>{writing ? <><textarea id={`answer-${slot.id}`} aria-describedby={over ? `limit-${slot.id}` : undefined} rows={slot.limit ? 3 : 2} maxLength={4000} value={answer} disabled={busy || !sync} placeholder={slot.limit ? `${slot.limit}字以内で記述してください` : '解答を入力してください'} onChange={e => sync?.edit({answers:{...s.answers,[slot.id]:e.target.value}})} />{over && <p id={`limit-${slot.id}`} className="w-over">字数の目安を{count-slot.limit!}字超えています。</p>}</> : <><p className="w-your-answer" id={`answer-${slot.id}`}><small>あなたの解答</small>{answer || '（未回答）'}</p><div className="w-example"><small>公式解答例・解答の要点</small><p>{slot.example}</p></div><fieldset disabled={busy || completed || !sync} className="w-assessment"><legend>{slot.label}の振り返り</legend>{(Object.entries(assessmentLabels) as [Assessment,string][]).map(([value,label]) => <label key={value}><input type="radio" name={`assessment-${slot.id}`} value={value} checked={s.assessments[slot.id] === value} onChange={() => sync?.edit({assessments:{...s.assessments,[slot.id]:value}})} />{label}</label>)}</fieldset></>}</article>; })}{!slots.length && <p className="w-empty">この条件の回答欄はありません。</p>}
      <div className="w-notes"><label htmlFor="written-notes">考えた根拠・復習メモ</label><p>読み落とした条件や、次に意識したいことを残しましょう。</p><textarea id="written-notes" rows={5} maxLength={10000} value={s.notes} disabled={busy || completed || !sync} placeholder="例：経路のコストだけでなく、切戻し手順まで考える。" onChange={e => sync?.edit({notes:e.target.value})} /></div>
      {!writing && <aside className="w-guidance"><p className="w-eyebrow">REVIEW NOTES</p><h3>この問題の振り返り方</h3><ul>{q.guide?.map(g => <li key={g}>{g}</li>)}</ul><small>本アプリ独自の学習のヒントです。詳しい出題意図・評価は公式採点講評を確認してください。</small></aside>}
      </div><div className="w-answer-bottom">{writing ? <>{confirmReveal ? <div role="group" aria-label="解答例の表示確認"><p>{q.slots.length-answered}欄が未回答です。解答例を表示すると、回答は固定されます。</p><div className="w-actions"><button disabled={busy} onClick={() => void command('reveal')}>未回答を含めて解答例を見る</button><button className="w-secondary" onClick={() => setConfirmReveal(false)}>解答に戻る</button></div></div> : <><p>解答例を表示すると回答を固定し、振り返りに進みます。</p><button disabled={busy || !sync || sync.state === 'conflict'} onClick={() => answered < q.slots.length ? setConfirmReveal(true) : void command('reveal')}>公式解答例で答え合わせ →</button></>}</> : !completed ? <><p>評価済み {assessed}/{q.slots.length}欄 · 一部できた・要復習 {reviewCount}欄</p><button disabled={busy || assessed !== q.slots.length || !sync || sync.state === 'conflict'} onClick={() => void command('complete')}>振り返りを完了する →</button><small>全欄の評価を選ぶと完了できます。途中で保存して一覧に戻ることもできます。</small></> : <button className="w-secondary" onClick={() => download(s)}>回答と振り返りをダウンロード</button>}</div>
    </section></div>
  </>;
}
