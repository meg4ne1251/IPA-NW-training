import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

async function finishActive(request: APIRequestContext) {
  const dashboard = await (await request.get('/api/dashboard', { maxRetries: 2 })).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    expect((await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } })).ok()).toBe(true);
  }
}
test.beforeEach(async ({ request }) => finishActive(request));
test.afterEach(async ({ request }) => finishActive(request));

test('演習→保存・再読込→提出→AIファイル出力・取り込み→再演習', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '10問を解く', exact: true }).click();
  await expect(page.getByRole('heading', { name: /確認問題/ })).toBeVisible();
  await page.route('**/api/sessions/*/draft', route => route.abort('failed'));
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await expect(page.getByRole('alert')).toContainText('回答は未保存');
  await page.reload();
  await expect(page.getByRole('alert')).toContainText('前回の未保存回答を復元');
  await expect(page.getByRole('radio', { name: 'イ　30', exact: true })).toBeChecked();
  await page.unroute('**/api/sessions/*/draft');
  await page.getByRole('button', { name: '保存を再試行', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('radio', { name: '迷った', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('button', { name: '次の問題 →', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.reload();
  await expect(page.getByText('2 / 10問', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '← 前の問題', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'イ　30', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '迷った', exact: true })).toBeChecked();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.getByRole('button', { name: 'セットを終了して結果を見る', exact: true }).click();
  await page.getByRole('button', { name: 'この回答で提出する', exact: true }).click();
  await expect(page.getByRole('heading', { name: '1 / 10問正解' })).toBeVisible();
  await expect(page.getByText('迷った・推測・わからない・自信度未入力の正解：1問 · 未回答：9問')).toBeVisible();
  await page.getByRole('button', { name: '履歴・AI連携へ', exact: true }).click();
  await page.getByRole('button', { name: 'AIとの受け渡し', exact: true }).click();
  const exported = page.waitForResponse(r => r.url().endsWith('/api/export') && r.request().method() === 'POST');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'A-1の結果を出力', exact: true }).click();
  expect((await downloaded).suggestedFilename()).toMatch(/learning-context-A-1/);
  const context = await (await exported).json();
  const imported = { ...context.nextSetTemplate, title: '弱点の再確認セット', selected: context.nextSetTemplate.selected.slice(0, 3) };
  await page.getByRole('textbox', { name: '問題セットのJSON', exact: true }).fill(JSON.stringify(imported));
  await page.getByRole('button', { name: '内容を検証して取り込む', exact: true }).click();
  await expect(page.getByRole('heading', { name: '弱点の再確認セット', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '検証済み3問で始める', exact: true }).click();
  await expect(page.getByRole('heading', { name: '弱点の再確認セット（検証済み3問）' })).toBeVisible();
  await expect(page.getByText('1 / 3問', { exact: true })).toBeVisible();
});

test('スマートフォン幅で画面がはみ出さず、キーボードで操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('heading', { name: /一問ずつ解いて、.*苦手を減らしていく。/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: '履歴と苦手分野', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '履歴と苦手分野', exact: true })).toBeVisible();
});


test('わからないの永続化・vim移動・全ボタンのヒント操作', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto('/');
  await page.getByRole('button', { name: '10問を解く', exact: true }).click();
  await page.getByRole('radio', { name: 'わからない', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'わからない', exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('l');
  await expect(page.getByText('2 / 10問', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.keyboard.press('h');
  await expect(page.getByText('1 / 10問', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('保存済み');
  await page.keyboard.press('j');
  const before = await page.evaluate(() => document.activeElement?.outerHTML);
  await page.keyboard.press('j');
  expect(await page.evaluate(() => document.activeElement?.outerHTML)).not.toBe(before);
  await page.keyboard.press('f');
  await expect(page.locator('.shortcut-badge').first()).toBeVisible();
  const hint = await page.evaluate(() => {
    const controls = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, summary')).filter(el => !el.matches(':disabled') && el.getClientRects().length > 0 && !el.closest('[inert]'));
    const index = controls.indexOf(document.querySelector('[data-question-next]')!);
    const keys = 'asdfghjklqwertyuiopzxcvbnm'; return keys[Math.floor(index / keys.length)] + keys[index % keys.length];
  });
  await page.keyboard.type(hint);
  await expect(page.getByText('2 / 10問', { exact: true })).toBeVisible();
});
