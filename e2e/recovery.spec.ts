import { test, expect } from '@playwright/test';
import type { APIRequestContext, Download, Page } from '@playwright/test';
import type { PublicSession } from '../src/domain/training';

async function finishActive(request: APIRequestContext) {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const active of dashboard.sessions.filter((s: PublicSession) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    expect((await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } })).ok()).toBe(true);
  }
}
async function createSession(request: APIRequestContext): Promise<PublicSession> {
  const response = await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 2 } });
  expect(response.ok()).toBe(true); return response.json();
}
async function openSession(page: Page, id: string) {
  await page.goto(`/#session/${id}`);
  await expect(page.getByRole('heading', { name: /確認問題/ })).toBeVisible();
}
async function readDownload(download: Download) {
  const stream = await download.createReadStream(); let content = '';
  for await (const chunk of stream!) content += chunk.toString();
  return JSON.parse(content);
}

test.beforeEach(async ({ request }) => finishActive(request));
test.afterEach(async ({ request }) => finishActive(request));

test('競合した未保存回答は再読込・別の回答の保存後も控えを取得できる', async ({ page, context, request }) => {
  const session = await createSession(request); const id = session.questions[0].id;
  const other = await context.newPage();
  await openSession(page, session.id); await openSession(other, session.id);
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('この環境に保存済み');
  const rejected = other.waitForResponse(r => r.url().endsWith('/draft'));
  await other.getByRole('radio', { name: 'ウ　32', exact: true }).check();
  expect((await rejected).status()).toBe(409);
  await expect(other.getByRole('alert').filter({ hasText: '回答は未保存' })).toBeVisible();
  // A successful save in the first tab must not delete the other tab's draft.
  await page.getByRole('radio', { name: '確信あり', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('この環境に保存済み');
  await other.reload();
  await expect(other.getByRole('radio', { name: 'イ　30', exact: true })).toBeChecked();
  const backup = other.getByRole('button', { name: '競合した回答の控えを保存', exact: true });
  await expect(backup).toBeVisible();
  let downloaded = other.waitForEvent('download'); await backup.click();
  let data = await readDownload(await downloaded);
  expect(data.sessionId).toBe(session.id); expect(data.drafts.some((d: PublicSession) => d.answers[id]?.choice === 2)).toBe(true);
  await other.getByRole('radio', { name: '迷った', exact: true }).check();
  await expect(other.getByRole('status')).toContainText('この環境に保存済み');
  await other.reload(); await expect(backup).toBeVisible();
  downloaded = other.waitForEvent('download'); await backup.click(); data = await readDownload(await downloaded);
  expect(data.drafts.some((d: PublicSession) => d.answers[id]?.choice === 2)).toBe(true);
});

test('保存失敗後の編集と再試行で経過時間を二重加算しない', async ({ page, request }) => {
  const session = await createSession(request); const id = session.questions[0].id;
  await openSession(page, session.id); await page.clock.install();
  await page.route('**/draft', route => route.abort());
  await page.clock.runFor(10000);
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await expect(page.getByRole('alert')).toContainText('回答は未保存');
  const first = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), `nw-draft:${session.id}`);
  expect(first.answers[id].seconds).toBeCloseTo(10, 0);
  await page.clock.runFor(5000);
  await page.getByRole('radio', { name: '迷った', exact: true }).check();
  await expect(page.getByRole('alert')).toContainText('回答は未保存');
  const second = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), `nw-draft:${session.id}`);
  expect(second.answers[id].seconds - first.answers[id].seconds).toBeCloseTo(5, 0);
  await page.unroute('**/draft'); await page.clock.runFor(3000);
  await page.getByRole('button', { name: '保存を再試行', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('この環境に保存済み');
  const saved = await (await request.get(`/api/sessions/${session.id}`)).json();
  expect(saved.answers[id].seconds - second.answers[id].seconds).toBeCloseTo(3, 0);
  expect(saved.answers[id].choice).toBe(1); expect(saved.answers[id].confidence).toBe('unsure');
});

test('時間切れ時の結果取得に失敗しても通信復旧後に自動で結果を表示する', async ({ page, request }) => {
  const session = await createSession(request); const now = new Date('2026-10-16T12:00:00Z');
  await page.clock.install({ time: now });
  let gets = 0;
  await page.route(`**/api/sessions/${session.id}`, async route => {
    gets++;
    if (gets === 1) return route.fulfill({ json: { ...session, deadline: new Date(now.getTime() + 3000).toISOString() } });
    if (gets === 2) return route.abort();
    return route.continue();
  });
  await openSession(page, session.id); await page.clock.runFor(3000);
  await expect(page.getByRole('alert')).toContainText('自動で再試行');
  await expect(page.getByRole('radio', { name: 'イ　30', exact: true })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('提出結果を確認');
  expect((await request.post(`/api/sessions/${session.id}/submit`, { data: { revision: session.revision } })).ok()).toBe(true);
  await page.clock.runFor(2000);
  await expect(page.getByRole('heading', { name: '0 / 2問正解', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('提出済み・保存済み');
  await expect(page.getByText('提出結果を取得できませんでした。', { exact: false })).toHaveCount(0);
  expect(gets).toBeGreaterThanOrEqual(3);
});
