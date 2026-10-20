import { expect, test } from '@playwright/test';
test.use({ baseURL: 'http://127.0.0.1:3201' });
test.afterEach(async ({ request }) => {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } });
  }
});
test('概念別分析から別問題の復習を開始し、確定前は正答や概念キーを返さない', async ({ page, request }, info) => {
  const created = await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 3 } });
  expect(created.ok()).toBe(true); const original = await created.json(); const id = original.questions[0].id;
  const confirmed = await (await request.post(`/api/sessions/${original.id}/grade`, { data: { questionId: id, revision: original.revision,
    draft: { revision: original.revision, currentIndex: 0, answers: { [id]: { choice: null, confidence: 'unknown', reason: '', seconds: 20, flagged: false } } } } })).json();
  await request.post(`/api/sessions/${original.id}/submit`, { data: { revision: confirmed.revision } });
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: '苦手な概念を、別の問題で確かめる' })).toBeVisible();
  await page.getByRole('button', { name: '履歴と苦手分野', exact: true }).click();
  const analysis = page.getByRole('region', { name: 'A-1の概念別分析' });
  await expect(analysis).toContainText('わからない'); await expect(analysis).toContainText('別問題の候補');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await analysis.screenshot({ path: info.outputPath('concept-analysis-mobile.png') });
  await page.getByRole('button', { name: '今日の学習', exact: true }).click();
  const started = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '苦手・復習の類題を10問', exact: true }).click();
  const next = await (await started).json(); expect(next.practiceScope.collection).toBe('concept-review');
  expect(next.questions).toHaveLength(10);
  for (const q of next.questions) {
    expect(original.questions.some((old: { groupId: string }) => old.groupId === q.groupId)).toBe(false);
    expect(q.correctIndex).toBeUndefined(); expect(q.reviewConcepts).toBeUndefined();
  }
  await expect(page.getByRole('heading', { name: 'A-1 苦手・復習の類題（10問）', exact: true })).toBeVisible();
});
