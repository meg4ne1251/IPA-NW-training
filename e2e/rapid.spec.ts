import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3201' });
test.afterEach(async ({ request }) => {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } });
  }
});

test('専用ボタンから開始し、途中保存・再開・同じ10問モードの継続ができる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '短期集中で知識を増やす' })).toBeVisible();
  const started = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '短期集中テストを10問', exact: true }).click();
  const first = await (await started).json();
  expect(first.practiceScope.collection).toBe('rapid-knowledge');
  await expect(page.getByRole('heading', { name: 'A-1 短期集中テスト（10問）', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'わからない', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.locator('.explanation')).toBeVisible();
  await page.reload();
  await expect(page.locator('.explanation')).toBeVisible();
  await page.getByRole('button', { name: 'セットを終了して結果を見る', exact: true }).click();
  await page.getByRole('button', { name: 'この回答で提出する', exact: true }).click();
  await expect(page.getByText('今回確認した分野：', { exact: false })).toBeVisible();
  const continued = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '短期集中テストを続ける →', exact: true }).click();
  const next = await (await continued).json();
  expect(next.questions).toHaveLength(10);
  expect(next.practiceScope.collection).toBe('rapid-knowledge');
  expect(next.questions.every((q: { groupId: string }) => !first.questions.some((old: { groupId: string }) => old.groupId === q.groupId))).toBe(true);
  await expect(page.getByText('1 / 10問', { exact: true })).toBeVisible();
});

test('スマートフォンでA-2を選び、専用のテストを開始できる', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.getByRole('button', { name: 'A-2', exact: true }).click();
  await expect(page.getByText('ネットワーク6割・セキュリティ約2割', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.rapid-section').screenshot({ path: info.outputPath('rapid-mobile.png') });
  await page.getByRole('button', { name: '短期集中テストを10問', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A-2 短期集中テスト（10問）', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('1 / 10問', { exact: true })).toBeVisible();
});
