import { useEffect, useState } from 'react';

const alphabet = 'asdfghjklqwertyuiopzxcvbnm';
const controls = () => Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary'))
  .filter(el => !el.matches(':disabled') && el.getClientRects().length > 0 && !el.closest('[inert]'));
const code = (index: number) => alphabet[Math.floor(index / alphabet.length)] + alphabet[index % alphabet.length];

export function KeyboardShortcuts() {
  const [hints, setHints] = useState<{ element: HTMLElement; key: string }[]>([]);
  const [prefix, setPrefix] = useState('');
  useEffect(() => {
    let targets: { element: HTMLElement; key: string }[] = [];
    let typed = '';
    const clear = () => { targets = []; typed = ''; setHints([]); setPrefix(''); };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { clear(); return; }
      if (event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (targets.length) {
        if (event.key.length !== 1) { clear(); return; }
        event.preventDefault();
        typed += event.key.toLowerCase();
        const found = targets.find(item => item.key === typed);
        if (found) {
          const el = found.element; clear();
          if (!el.isConnected || el.matches(':disabled')) return;
          el.focus(); el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          if (el.matches('button, a, summary, input[type=radio], input[type=checkbox], input[type=file]')) el.click();
        } else if (targets.some(item => item.key.startsWith(typed))) setPrefix(typed);
        else clear();
        return;
      }
      if (target.closest('textarea, select, [contenteditable=true]') || (target instanceof HTMLInputElement && !['radio', 'checkbox', 'button', 'submit'].includes(target.type))) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        targets = controls().map((element, index) => ({ element, key: code(index) }));
        setHints(targets); setPrefix('');
      } else if (key === 'h' || key === 'l') {
        const button = document.querySelector<HTMLButtonElement>(key === 'h' ? '[data-question-prev]' : '[data-question-next]');
        if (button) { event.preventDefault(); if (!button.disabled) button.click(); }
      } else if (key === 'j' || key === 'k') {
        event.preventDefault();
        const items = controls(); const index = items.indexOf(document.activeElement as HTMLElement);
        const next = index < 0 ? (key === 'j' ? 0 : items.length - 1) : (index + (key === 'j' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus(); items[next]?.scrollIntoView({ block: 'nearest' });
      }
    };
    document.addEventListener('keydown', keydown);
    window.addEventListener('resize', clear); window.addEventListener('scroll', clear, true);
    return () => { document.removeEventListener('keydown', keydown); window.removeEventListener('resize', clear); window.removeEventListener('scroll', clear, true); };
  }, []);
  return <>
    <details className="keyboard-help"><summary>キーボード操作</summary><p><kbd>h</kbd> 前の問題 / <kbd>l</kbd> 次の問題 · <kbd>j</kbd> 次の入力・ボタン / <kbd>k</kbd> 前へ · <kbd>Enter</kbd> ボタンを実行 / <kbd>Space</kbd> 選択</p><p><kbd>f</kbd> ですべての操作に2文字のキーを表示。表示されたキーを順に入力するとクリックと同じ操作ができます。入力欄はフォーカスします。<kbd>Esc</kbd> で解除。文字入力中は無効です。</p></details>
    {hints.length > 0 && <div className="shortcut-layer" aria-live="polite"><span className="shortcut-status">操作キーを入力：{prefix || '2文字'} · Escで解除</span>{hints.filter(item => item.key.startsWith(prefix)).map(({ element, key }) => {
      const rect = element.getBoundingClientRect();
      return <span key={key} className="shortcut-badge" style={{ top: Math.max(0, rect.top), left: Math.max(0, Math.min(window.innerWidth - 32, rect.left)) }}>{key}</span>;
    })}</div>}
  </>;
}
