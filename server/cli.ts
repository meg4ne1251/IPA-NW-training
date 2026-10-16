import { readFileSync } from 'node:fs';
import { openStore } from './store.ts';
import type { Section } from '../src/domain/training.ts';
const store = openStore();
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'export') {
    const result = store.exportContext((args[0] || 'A-1') as Section);
    console.log(`${store.directory}/exports/${result.requestId}/learning-context.json`);
  } else if (command === 'import') {
    console.log(JSON.stringify(store.importSet(JSON.parse(readFileSync(args[0], 'utf8'))), null, 2));
  } else if (command === 'verify') {
    const [id, method, reference, reviewer] = args;
    const q = store.verify(id || '', method || '', reference || '', reviewer || '');
    console.log(`${q.id} v${q.version}: 正答・解説の内容確認を記録しました。`);
  } else if (command === 'backup') console.log(store.backup());
  else if (command === 'status') console.log(JSON.stringify(store.dashboard(), null, 2));
  else throw new Error('使い方: npm run training -- export A-1 | import <JSONパス> | verify <問題ID> <確認方法> <根拠URL> <確認者> | backup | status');
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { store.close(); }
