import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3203' });
test.afterEach(async ({ request }) => {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const s of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${s.id}`)).json();
    await request.post(`/api/sessions/${s.id}/cancel`, { data: { revision: session.revision } });
  }
});

for (const count of [10, 30]) test(`おすすめ演習${count}問を開始・確定・再開し同じ件数で続ける`, async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  const curriculum = page.getByRole('region', { name: '解答結果からのおすすめ演習', exact: true });
  await expect(curriculum).toBeVisible(); await expect(curriculum).toContainText(`${count}問の構成：`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (count === 10) await curriculum.screenshot({ path: info.outputPath('curriculum-mobile.png') });
  const started = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: `おすすめ演習を${count}問`, exact: true }).click();
  const first = await (await started).json();
  expect(first.practiceScope.collection).toBe('a1-curriculum'); expect(first.questions).toHaveLength(count);
  await expect(page.getByRole('heading', { name: `A-1 おすすめ演習（${count}問）`, exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'わからない', exact: true }).check();
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.locator('.explanation')).toBeVisible(); await page.reload();
  await expect(page.locator('.explanation')).toBeVisible();
  await page.getByRole('button', { name: 'セットを終了して結果を見る', exact: true }).click();
  await page.getByRole('button', { name: 'この回答で提出する', exact: true }).click();
  const nextResponse = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'おすすめ演習を続ける →', exact: true }).click();
  const next = await (await nextResponse).json();
  expect(next.practiceScope.collection).toBe('a1-curriculum'); expect(next.questions).toHaveLength(count);
  expect(next.questions.every((q: { id: string }) => q.id !== first.questions[0].id)).toBe(true);
  await expect(page.getByRole('heading', { name: `A-1 おすすめ演習（${count}問）`, exact: true })).toBeVisible();
});
