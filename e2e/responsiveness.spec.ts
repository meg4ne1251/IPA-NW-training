import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

async function finishActive(request: APIRequestContext) {
  const dashboard = await (await request.get('/api/dashboard')).json();
  for (const active of dashboard.sessions.filter((s: { status: string }) => s.status === 'active')) {
    const session = await (await request.get(`/api/sessions/${active.id}`)).json();
    await request.post(`/api/sessions/${active.id}/submit`, { data: { revision: session.revision } });
  }
}
test.beforeEach(async ({ request }) => finishActive(request));
test.afterEach(async ({ request }) => finishActive(request));

test('保存応答が止まっていても選択・自信度・見直し・問題移動を続けられる', async ({ page, request }) => {
  const session = await (await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 3 } })).json();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/draft', async route => {
    requests++;
    const response = await route.fetch();
    if (requests === 1) await gate;
    await route.fulfill({ response });
  });
  await page.goto(`/#session/${session.id}`);
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('保存しています');
  await page.getByRole('radio', { name: '迷った', exact: true }).check();
  await page.getByRole('checkbox', { name: '後で見直す' }).check();
  await page.keyboard.press('l');
  await expect(page.getByText('2 / 3問', { exact: true })).toBeVisible();
  await page.getByRole('radio', { name: 'ア　14', exact: true }).check();
  await page.keyboard.press('h');
  await expect(page.getByText('1 / 3問', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'イ　30', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '迷った', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '後で見直す' })).toBeChecked();
  expect(requests).toBe(1);
  release();
  await expect(page.getByRole('status')).toContainText('この環境に保存済み');
  expect(requests).toBe(2);
  const saved = await (await request.get(`/api/sessions/${session.id}`)).json();
  expect(saved.currentIndex).toBe(0);
  expect(saved.answers[session.questions[0].id]).toMatchObject({ choice: 1, confidence: 'unsure', flagged: true });
  expect(saved.answers[session.questions[1].id].choice).toBe(0);
  await page.reload();
  await expect(page.getByRole('radio', { name: '迷った', exact: true })).toBeChecked();
});

test('保存中に確定しても最新の自信度を採点し、余分な保存通信を挟まない', async ({ page, request }) => {
  const session = await (await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 2 } })).json();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const commands: string[] = [];
  await page.route('**/api/sessions/*/*', async route => {
    const command = route.request().url().split('/').at(-1)!; commands.push(command);
    const response = await route.fetch();
    if (command === 'draft') await gate;
    await route.fulfill({ response });
  });
  await page.goto(`/#session/${session.id}`);
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await page.getByRole('radio', { name: '迷った', exact: true }).check();
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('回答を確定しています');
  await expect(page.getByRole('button', { name: '次の問題 →', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toContainText('回答時の自信度：迷った');
  expect(commands).toEqual(['draft', 'grade']);
  const saved = await (await request.get(`/api/sessions/${session.id}`)).json();
  expect(saved.answers[session.questions[0].id].confidence).toBe('unsure');
  expect(saved.questions[1].correctIndex).toBeUndefined();
});

test('保存済みの回答確定は採点の1往復で完了する', async ({ page, request }) => {
  const session = await (await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 2 } })).json();
  await page.goto(`/#session/${session.id}`);
  await page.getByRole('radio', { name: 'わからない', exact: true }).check();
  await expect(page.getByRole('status')).toContainText('この環境に保存済み');
  const commands: string[] = [];
  page.on('request', req => { if (/\/(draft|grade)$/.test(req.url())) commands.push(req.method()); });
  await page.getByRole('button', { name: 'この回答を確定する', exact: true }).click();
  await expect(page.getByRole('region', { name: 'この問題の採点結果' })).toContainText('わからない · 正答 イ');
  expect(commands).toEqual(['POST']);
});

test('学習画面へ戻るときは保留中の回答を保存してから移動する', async ({ page, request }) => {
  const session = await (await request.post('/api/sessions', { data: { section: 'A-1', mode: 'practice', count: 2 } })).json();
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/draft', async route => {
    const first = ++requests === 1;
    const response = await route.fetch();
    if (first) await gate;
    await route.fulfill({ response });
  });
  await page.goto(`/#session/${session.id}`);
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await page.getByRole('radio', { name: '迷った', exact: true }).check();
  await page.getByRole('button', { name: '← 学習画面へ', exact: true }).click();
  await expect(page.getByRole('radio', { name: '迷った', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'この回答を確定する', exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole('button', { name: '演習を再開する →', exact: true })).toBeVisible();
  const saved = await (await request.get(`/api/sessions/${session.id}`)).json();
  expect(saved.answers[session.questions[0].id]).toMatchObject({ choice: 1, confidence: 'unsure' });
});
