import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStore, RevisionConflictError } from './store.ts';
import type { TrainingStore } from './store.ts';
import type { Section, Session } from '../src/domain/training.ts';

export function createApp(store: TrainingStore, staticRoot = resolve('dist')) {
  return createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin');
    const json = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value));
    };
    try {
      const url = new URL(req.url || '/', 'http://localhost'); const path = url.pathname;
      if (path.startsWith('/api/')) {
        if (req.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: '同じ画面から操作してください。' });
        const origin = req.headers.origin;
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        if (origin && new URL(origin).host !== host) return json(403, { error: '接続元が一致しません。' });
        let body: any = {};
        if (req.method === 'POST' || req.method === 'PUT') {
          if (!req.headers['content-type']?.startsWith('application/json')) return json(415, { error: 'JSON形式で送信してください。' });
          let length = 0; const parts: Buffer[] = [];
          for await (const chunk of req) { length += chunk.length; if (length > 2_000_000) return json(413, { error: 'ファイルは2MB以内にしてください。' }); parts.push(chunk); }
          try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { return json(400, { error: 'JSONを読み取れません。' }); }
        }
        if (req.method === 'GET' && path === '/api/dashboard') return json(200, store.dashboard());
        if (req.method === 'POST' && path === '/api/sessions') return json(201, store.create(body.section, body.mode, body.count, body.collection, { topic: body.topic, tag: body.tag }));
        const match = path.match(/^\/api\/sessions\/([a-zA-Z0-9-]+)(?:\/(draft|submit|grade))?$/);
        if (match) {
          if (req.method === 'GET' && !match[2]) { store.expire(); return json(200, store.publicSession(store.session(match[1]))); }
          if (req.method === 'PUT' && match[2] === 'draft') return json(200, store.save(match[1], body));
          if (req.method === 'POST' && match[2] === 'grade') return json(200, store.grade(match[1], body.questionId, body.revision, body.draft));
          if (req.method === 'POST' && match[2] === 'submit') return json(200, store.publicSession(store.submit(match[1], body.revision, body.draft)));
        }
        if (req.method === 'POST' && path === '/api/export') return json(200, store.exportContext(body.section as Section));
        if (req.method === 'POST' && path === '/api/import') return json(200, store.importSet(body));
        const imported = path.match(/^\/api\/imports\/([a-zA-Z0-9-]+)\/start$/);
        if (req.method === 'POST' && imported) return json(201, store.startImport(imported[1]));
        if (req.method === 'POST' && path === '/api/backup') return json(200, store.backup());
        return json(404, { error: '指定された操作が見つかりません。' });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(405, { error: '許可されていない操作です。' });
      const isMaterial = path.startsWith('/assets/2025-spring/') || path.startsWith('/assets/archive/');
      const root = isMaterial ? resolve(store.directory, 'assets') : staticRoot;
      const relative = isMaterial ? path.slice('/assets/'.length) : path === '/' ? 'index.html' : decodeURIComponent(path.slice(1));
      const file = resolve(root, relative);
      if (!file.startsWith(root + sep)) return json(403, { error: 'このファイルは開けません。' });
      const allowed: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.pdf': 'application/pdf', '.svg': 'image/svg+xml' };
      if (!allowed[extname(file)]) return json(404, { error: 'ファイルが見つかりません。' });
      try {
        const info = await stat(file);
        const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
        const hashedAsset = /^\/assets\/[^/]+-[\w-]{8,}\.(js|css)$/.test(path);
        const cache = hashedAsset ? 'public, max-age=31536000, immutable' : isMaterial && extname(file) === '.png' ? 'private, max-age=3600' : 'no-cache';
        const headers = { 'Content-Type': allowed[extname(file)], 'Cache-Control': cache, ETag: etag };
        if (req.headers['if-none-match']?.split(',').map(tag => tag.trim()).includes(etag)) { res.writeHead(304, headers); return res.end(); }
        const content = req.method === 'HEAD' ? undefined : await readFile(file);
        res.writeHead(200, headers); res.end(content);
      } catch { return json(404, { error: isMaterial ? '教材画像がありません。npm run setup:materials を確認してください。' : 'ビルドがありません。npm run build を実行してください。' }); }
    } catch (error) { json(error instanceof RevisionConflictError ? 409 : 400, { error: error instanceof Error ? error.message : '処理に失敗しました。' }); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const store = openStore(); const port = Number(process.env.PORT || 3001);
  const host = process.env.HOST || '127.0.0.1';
  if (store.sessions().length) store.backup();
  const server = createApp(store); server.listen(port, host, () => console.log(`NW Training: http://${host}:${port}`));
  const interval = setInterval(() => { try { store.expire(); } catch (error) { console.error('時間切れの保存に失敗しました。', error); } }, 5000);
  const daily = setInterval(() => { try { store.backup(); } catch (error) { console.error('バックアップに失敗しました。', error); } }, 86400000);
  const stop = () => { clearInterval(interval); clearInterval(daily); server.close(() => { store.close(); process.exit(0); }); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
