import { test, expect } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:3200' });
test.afterEach(async ({ request }) => {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } });
  }
});

test('実教材の分野・論点を選び、解説を読み、同じ範囲で続けられる', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('24分野・120問。', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: '補強する分野' }).selectOption('ネットワーク・アドレス');
  await expect(page.getByText('選択中の範囲：5問。', { exact: false })).toBeVisible();
  await page.getByRole('combobox', { name: '細かな論点' }).selectOption('ネットワークアドレス');
  await page.getByRole('button', { name: '補強問題を1問解く', exact: true }).click();
  await expect(page.getByText('1 / 1問', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /192.0.2.141/ })).toBeVisible();
  await expect(page.getByRole('link', { name: '根拠資料1', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'イ　192.0.2.128', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 / 1問正解', exact: true })).toBeVisible();
  await expect(page.locator('.explanation li')).toHaveCount(4);
  await expect(page.getByRole('link', { name: '根拠資料1', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '同じ範囲で続ける →', exact: true }).click();
  await page.reload();
  await expect(page.getByText('1 / 1問', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'A-1補強 · ネットワークアドレス（1問）', exact: true })).toBeVisible();
});

test('スマートフォンでも分野を選べ、A-2へ切り替えるとA-1補強を表示しない', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: '分野別の細かな補強' })).toBeVisible();
  await page.getByRole('combobox', { name: '補強する分野' }).selectOption('企業活動・会計');
  await page.getByRole('combobox', { name: '細かな論点' }).selectOption('損益分岐点');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[aria-labelledby="supplement-heading"]').screenshot({ path: testInfo.outputPath('supplement-mobile.png') });
  await page.getByRole('button', { name: 'A-2', exact: true }).click();
  await expect(page.getByRole('heading', { name: '分野別の細かな補強' })).toHaveCount(0);
});
