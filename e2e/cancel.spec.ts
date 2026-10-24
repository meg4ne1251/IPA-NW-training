import { expect, test } from '@playwright/test';

test('途中中止は回答済みだけを保存し、再読込後も再開せず次のセットを開始できる', async ({ page, request }) => {
  const created = await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 3 } });
  expect(created.ok()).toBe(true);
  const initial = await created.json();
  await page.goto(`/#session/${initial.id}`);
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '途中で中止する', exact: true }).click();
  await expect(page.getByText('中止したセットの結果', { exact: true })).toBeVisible();
  await expect(page.getByText('回答済みの結果を保存しました。未回答の問題は学習履歴に記録していません。')).toBeVisible();
  await page.reload();
  await expect(page.getByText('中止済み・保存済み', { exact: true })).toBeVisible();
  const saved = await (await request.get(`/api/sessions/${initial.id}`)).json();
  expect(saved.status).toBe('cancelled');
  expect(Object.keys(saved.graded)).toHaveLength(1);
  expect(saved.questions[1].correctIndex).toBeUndefined();
  await page.getByRole('button', { name: '次の問題 →', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'イ　30', exact: true })).toBeDisabled();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toHaveCount(0);
  await page.getByRole('button', { name: '履歴・AI連携へ', exact: true }).click();
  await expect(page.getByRole('button', { name: '演習を再開する →', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '10問を解く', exact: true }).click();
  await expect(page.getByRole('button', { name: '途中で中止する', exact: true })).toBeVisible();
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const s of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const current = await (await request.get(`/api/sessions/${s.id}`)).json();
    await request.post(`/api/sessions/${s.id}/cancel`, { data: { revision: current.revision } });
  }
});
