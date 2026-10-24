import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3202' });
test.afterEach(async ({ request }) => {
  const dashboard = await (await request.get('/api/dashboard', { maxRetries: 2 })).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } });
  }
});

for (const section of ['A-1', 'A-2']) for (const count of [10, 30]) {
  test(`${section}の新規分野・復習専用${count}問を開始・再開・同じ問題数で継続する`, async ({ page, request }, info) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
    if (section === 'A-2') await page.getByRole('button', { name: 'A-2', exact: true }).click();
    const focused = page.getByRole('region', { name: '目的を絞って10問・30問', exact: true });
    await expect(focused).toContainText('出題可能：');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (section === 'A-1' && count === 10) {
      await expect(page.getByRole('button', { name: '復習専用を10問', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: '復習専用を30問', exact: true })).toBeDisabled();
      await focused.screenshot({ path: info.outputPath('focused-mobile.png') });
    }
    const started = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: `新規分野専用を${count}問`, exact: true }).click();
    const first = await (await started).json();
    expect(first.questions).toHaveLength(count); expect(first.practiceScope.collection).toBe('new-fields-only');
    await expect(page.getByRole('heading', { name: `${section} 新規分野専用（${count}問）`, exact: true })).toBeVisible();
    await page.getByRole('radio', { name: 'わからない', exact: true }).check();
    await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
    await expect(page.locator('.explanation')).toBeVisible(); await page.reload();
    await expect(page.locator('.explanation')).toBeVisible();
    await page.getByRole('button', { name: 'セットを終了して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: 'この回答で提出する', exact: true }).click();
    const continued = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '新規分野専用を続ける →', exact: true }).click();
    const next = await (await continued).json();
    expect(next.practiceScope.collection).toBe('new-fields-only'); expect(next.questions).toHaveLength(count);
    expect(next.questions.every((q: { topic: string }) => !first.questions.some((old: { topic: string }) => old.topic === q.topic))).toBe(true);
    await request.post(`/api/sessions/${next.id}/submit`, { data: { revision: next.revision } });
    await page.goto('/');
    if (section === 'A-2') await page.getByRole('button', { name: 'A-2', exact: true }).click();
    const reviewing = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: `復習専用を${count}問`, exact: true }).click();
    const review = await (await reviewing).json();
    expect(review.practiceScope.collection).toBe('review-only'); expect(review.questions).toHaveLength(count);
    await expect(page.getByRole('heading', { name: `${section} 復習専用（${count}問）`, exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText(`1 / ${count}問`, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'セットを終了して結果を見る', exact: true }).click();
    await page.getByRole('button', { name: 'この回答で提出する', exact: true }).click();
    const nextReview = page.waitForResponse(r => r.url().endsWith('/api/sessions') && r.request().method() === 'POST');
    await page.getByRole('button', { name: '復習専用を続ける →', exact: true }).click();
    const repeated = await (await nextReview).json();
    expect(repeated.practiceScope.collection).toBe('review-only'); expect(repeated.questions).toHaveLength(count);
  });
}
