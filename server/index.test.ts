import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vitest';
import { createApp } from './index';
import { TrainingStore } from './store';

test('教材画像とビルド成果物を再利用し、HTMLと学習APIは最新の内容を取得する', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nw-http-'));
  const store = new TrainingStore(join(directory, 'data'));
  const staticRoot = join(directory, 'dist');
  mkdirSync(join(store.directory, 'assets/archive'), { recursive: true });
  mkdirSync(join(staticRoot, 'assets'), { recursive: true });
  const image = join(store.directory, 'assets/archive/question.png');
  writeFileSync(image, 'first image');
  writeFileSync(join(staticRoot, 'index.html'), '<html>test</html>');
  writeFileSync(join(staticRoot, 'assets/index-AbCd1234.js'), 'test();');
  const server = createApp(store, staticRoot);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Server failed to start');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const first = await fetch(`${base}/assets/archive/question.png`);
    expect(first.headers.get('cache-control')).toBe('private, max-age=3600');
    expect(await first.text()).toBe('first image');
    const etag = first.headers.get('etag')!;
    const cached = await fetch(`${base}/assets/archive/question.png`, { headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304); expect(await cached.text()).toBe('');
    writeFileSync(image, 'updated image content');
    const updated = await fetch(`${base}/assets/archive/question.png`, { headers: { 'If-None-Match': etag } });
    expect(updated.status).toBe(200); expect(await updated.text()).toBe('updated image content');
    const asset = await fetch(`${base}/assets/index-AbCd1234.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    const html = await fetch(`${base}/`);
    expect(html.headers.get('cache-control')).toBe('no-cache');
    const head = await fetch(`${base}/assets/archive/question.png`, { method: 'HEAD' });
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    const dashboard = await fetch(`${base}/api/dashboard`);
    expect(dashboard.headers.get('cache-control')).toBe('no-store');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    store.close(); rmSync(directory, { recursive: true, force: true });
  }
});
