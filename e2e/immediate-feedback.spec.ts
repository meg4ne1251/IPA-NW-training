import { test, expect } from '@playwright/test';

test.beforeEach(async ({ request }) => {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } });
  }
});
test.afterEach(async ({ request }) => {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } });
  }
});

test('スマホで1問ずつ確定・即時解説・再開・最後に次の問題へ継続', async ({ page, request }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  const response = await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 2 } });
  const session = await response.json();
  await page.goto(`/#session/${session.id}`);
  await expect(page.getByRole('button', { name: 'この回答を確定する', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('radio', { name: '迷った', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.keyboard.press('e');
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toContainText('正解 · 正答 イ');
  await expect(page.getByRole('radio', { name: 'イ　30', exact: true })).toBeDisabled();
  await expect(page.getByRole('radio', { name: '迷った', exact: true })).toBeDisabled();
  const saved = await (await request.get(`/api/sessions/${session.id}`)).json();
  expect(saved.questions[1].correctIndex).toBeUndefined();
  const context = await (await request.post('/api/export', { data: { section: 'A-1' } })).json();
  expect(context.history.filter((r: { sessionId: string }) => r.sessionId === session.id)).toHaveLength(1);
  await page.reload();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toContainText('正解 · 正答 イ');
  await page.keyboard.press('l');
  await expect(page.getByText('2 / 2問', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('radio', { name: 'ア　14', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toContainText('不正解 · 正答 イ');
  await expect(page.getByRole('heading', { name: '1 / 2問正解', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('l');
  await expect(page.getByText('1 / 30問', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toHaveCount(0);
});

test('わからないは選択肢なしで確定でき、採点の通信失敗後も再試行できる', async ({ page, request }) => {
  const response = await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 2 } });
  const session = await response.json();
  await page.goto(`/#session/${session.id}`);
  await page.getByRole('radio', { name: 'わからない', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.route('**/api/sessions/*/grade', route => route.abort('failed'));
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('確定を再試行');
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toHaveCount(0);
  await page.unroute('**/api/sessions/*/grade');
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toContainText('わからない · 正答 イ');
  await page.reload();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toContainText('回答時の自信度：わからない');
  const saved = await (await request.get(`/api/sessions/${session.id}`)).json();
  expect(saved.answers[session.questions[0].id]).toMatchObject({ choice: null, confidence: 'unknown' });
});
