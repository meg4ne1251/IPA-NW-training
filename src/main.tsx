import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { exam2026 } from './domain/exam';
import { generatePractice, grade, questions, type Question } from './domain/practice';
import './style.css';
function App() {
  const [items, setItems] = useState<Question[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [submitted, setSubmitted] = useState(false);
  function start() { setItems(generatePractice(questions, 3)); setAnswers({}); setSubmitted(false); }
  return <main>
    <header><a href="./" className="brand">NW / TRAINING</a><span>2026年度 CBT対応を目指す学習プロジェクト</span></header>
    <section className="hero"><p className="eyebrow">NETWORK SPECIALIST</p><h1>ネットワークを理解する。<br/>一問ずつ、実力にする。</h1><p>知識の確認から、設計・運用を考える記述演習へ。<br/>ネットワークスペシャリスト試験のための学習アプリ。</p><button onClick={start}>3問のサンプル演習を始める →</button><small>独自問題の短い演習です。本番形式の模試・AI生成は今後実装予定です。</small></section>
    <section aria-labelledby="exam"><h2 id="exam">2026年度の試験構成</h2><div className="grid">{exam2026.sections.map(s => <article key={s.id}><p className="eyebrow">{s.format}</p><h3>{s.name}</h3><strong>{s.minutes}<span> 分</span></strong><p>{s.questions}問から{s.answers}問を解答</p></article>)}</div></section>
    {items.length > 0 && <section aria-labelledby="practice"><h2 id="practice">サンプル演習</h2><p>科目A-2に関連する基礎知識を確認します。回答は保存されません。</p>{items.map((q, i) => <fieldset key={q.id} disabled={submitted}><legend>問{i + 1} · {q.topic} — {q.prompt}</legend>{q.choices.map((choice, index) => <label key={choice}><input type="radio" name={q.id} value={index} checked={answers[q.id] === index} onChange={() => setAnswers({ ...answers, [q.id]: index })}/>{choice}</label>)}{submitted && <p className="explanation">{answers[q.id] === q.correctIndex ? '正解' : '不正解'}：{q.explanation}</p>}</fieldset>)}{submitted ? <div role="status"><h3>{items.length}問中 {grade(items, answers)}問正解</h3><button onClick={start}>もう一度取り組む</button></div> : <button disabled={items.some(q => answers[q.id] === undefined)} onClick={() => setSubmitted(true)}>採点して解説を見る</button>}</section>}
    <footer>IPA非公式の学習用アプリ · <a href="https://www.ipa.go.jp/shiken/kubun/nw.html" target="_blank" rel="noreferrer">公式試験情報</a><p>試験情報確認日：{exam2026.verifiedAt}。2027年度以降の制度は別途確認します。</p></footer>
  </main>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><App/></StrictMode>);
