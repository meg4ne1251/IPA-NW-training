import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: './e2e', workers: 1, use: { baseURL: 'http://127.0.0.1:3199', trace: 'retain-on-failure' }, webServer: [
  { command: 'node scripts/e2e-server.ts', url: 'http://127.0.0.1:3199/api/dashboard', reuseExistingServer: false },
  { command: 'node scripts/e2e-server.ts --supplement', url: 'http://127.0.0.1:3200/api/dashboard', reuseExistingServer: false },
  { command: 'node scripts/e2e-server.ts --rapid', url: 'http://127.0.0.1:3201/api/dashboard', reuseExistingServer: false },
], reporter: 'list' });
