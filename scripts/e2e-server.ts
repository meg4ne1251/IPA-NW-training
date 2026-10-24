import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/index.ts';
import { TrainingStore } from '../server/store.ts';
import type { TrainingQuestion } from '../src/domain/training.ts';
const directory = mkdtempSync(join(tmpdir(), 'nw-browser-'));
const supplement = process.argv.includes('--supplement');
const rapid = process.argv.includes('--rapid');
const focused = process.argv.includes('--focused');
const seed: TrainingQuestion[] = supplement ? JSON.parse(readFileSync('materials/a1-supplement.json', 'utf8')) : Array.from({ length: 200 }, (_, n) => ({
  id: `browser-${n}`, version: 1, section: 'A-1', topic: 'ネットワーク', tags: ['CIDR'],
  prompt: `確認問題 ${n + 1}：/27で使用できるホストアドレス数は？`, choices: ['14', '30', '32', '62'], correctIndex: 1,
  explanation: 'ホスト部5ビットの32個からネットワーク・ブロードキャストの2個を除き30個です。', origin: 'original', groupId: `browser-${n}`, heldOut: false,
  source: { label: 'ブラウザーテスト用独自教材', url: 'https://example.com/source' },
  review: { status: 'verified', method: '独立した計算で検算', reviewer: 'test', at: '2026-10-16T00:00:00Z', references: ['https://example.com/source'] },
}));
if (focused) seed.forEach((q, n) => { q.topic = `未学習分野-${n}`; q.tags = [`論点-${n}`]; q.reviewConcepts = [`論点-${n}`]; });
if (rapid || focused) seed.push(...seed.map((q, n) => ({ ...q, id: `rapid-a2-${n}`, groupId: `rapid-a2-${n}`, section: 'A-2' as const,
  topic: focused ? q.topic : n < 21 ? 'ネットワーク' : n < 29 ? 'セキュリティ' : 'システム構成要素' })));
const store = new TrainingStore(directory, seed); const server = createApp(store);
server.listen(focused ? 3202 : rapid ? 3201 : supplement ? 3200 : 3199, '127.0.0.1');
const stop = () => server.close(() => { store.close(); rmSync(directory, { recursive: true, force: true }); process.exit(0); });
process.on('SIGINT', stop); process.on('SIGTERM', stop);
