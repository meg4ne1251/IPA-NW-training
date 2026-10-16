import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const python = process.env.PYTHON || (existsSync('.venv/bin/python') ? '.venv/bin/python' : 'python3');
const result = spawnSync(python, [process.argv[2] || 'scripts/setup-materials.py'], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
