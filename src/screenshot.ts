import { toBlob } from 'html-to-image';

/** Start the clipboard write during the click, before rendering awaits lose user activation. */
export async function copyQuestionScreenshot(element: HTMLElement): Promise<void> {
  if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('画像のコピーにはHTTPS（またはlocalhost）と、画像のクリップボードコピーに対応したブラウザーが必要です。');
  }
  const image = (async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(element.querySelectorAll('img'), img => img.decode()));
    const blob = await toBlob(element, {
      backgroundColor: '#ffffff', pixelRatio: 2,
      style: { padding: '20px', boxSizing: 'border-box' },
    });
    if (!blob) throw new Error('問題の画像を作成できませんでした。');
    return blob;
  })();
  // Attach a handler even if the browser rejects the clipboard write immediately.
  void image.catch(() => {});
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
}
