import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
const saved = (page: Page) => expect(page.getByRole('status')).toHaveText('この環境に保存済み');
async function start(page: Page, request: import('@playwright/test').APIRequestContext, questionId: string) {
  const s = await (await request.post('/api/written/sessions', {data:{questionId}})).json();
  await page.goto(`/#written/${s.id}`); return s;
}
test('トップは記述対策で、科目の絞り込みと従来の選択式への移動ができる',async({page})=>{
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await expect(page.getByRole('heading',{name:/知識を、\s*伝わる解答に。/})).toBeVisible();
  await expect(page.locator('.w-question-card')).toHaveCount(15);
  await page.getByRole('button',{name:'B-2 / 旧午後Ⅱ',exact:true}).click();
  await expect(page.locator('.w-question-card')).toHaveCount(6);
  await page.getByLabel('年度',{exact:true}).selectOption('2025');
  await expect(page.locator('.w-question-card')).toHaveCount(2);
  await page.getByRole('searchbox',{name:'問題を検索'}).fill('CoAP');
  await expect(page.locator('.w-question-card')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'IoTシステムの設計',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link',{name:/科目A 選択式対策/}).click();
  await expect(page.getByRole('button',{name:'今日の学習',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'科目B 記述対策へ →'}).click();
  await expect(page.locator('.w-question-card')).toHaveCount(15);
});
test('年度・科目・キーワードを組み合わせて絞り込み、解除できる', async ({page}) => {
  await page.setViewportSize({width:390,height:844}); await page.goto('/');
  await expect(page.getByLabel('年度',{exact:true})).toBeVisible();
  for (const year of ['2024', '2023']) {
    await page.getByLabel('年度',{exact:true}).selectOption(year);
    await expect(page.locator('.w-question-card')).toHaveCount(5);
    for (const card of await page.locator('.w-question-card').all()) await expect(card).toContainText(`${year}年`);
  }
  await page.getByRole('button',{name:'B-1 / 旧午後Ⅰ',exact:true}).click();
  await expect(page.locator('.w-question-card')).toHaveCount(3);
  await page.getByRole('searchbox',{name:'問題を検索'}).fill('HTTP/2');
  await expect(page.locator('.w-question-card')).toHaveCount(1);
  await expect(page.getByRole('heading',{name:'Webシステムの更改',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('searchbox',{name:'問題を検索'}).fill('該当しない検索語');
  await page.getByRole('button',{name:'絞り込みを解除',exact:true}).click();
  await expect(page.getByLabel('年度',{exact:true})).toHaveValue('all');
  await expect(page.locator('.w-question-card')).toHaveCount(15);
});
test('追加2年分の両科目で正しい年度の画像・解答例を開ける', async ({page,request}) => {
  for (const [questionId,year,part,answer] of [
    ['2024-b1-q1','2024','1','ICMP Echo'], ['2024-b2-q2','2024','2','mail.y-sha.lan'],
    ['2023-b1-q1','2023','1','リバース'], ['2023-b2-q2','2023','2','NS'],
  ]) {
    const s = await start(page,request,questionId);
    await expect(page.locator('.w-page-viewer img')).toHaveAttribute('src',`/written/${year}/pm${part}-p${s.question.pages[0]}.png`);
    await expect(page.locator('.w-page-viewer img')).toBeVisible();
    await expect.poll(()=>page.locator('.w-page-viewer img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
    await page.getByRole('button',{name:'設問のページへ ↓'}).click();
    await expect(page.getByLabel('問題ページ')).toHaveValue(String(s.question.questionPages[0]));
    if (questionId === '2024-b2-q2') {
      await expect(page.getByRole('complementary',{name:'公式問題の注意事項'})).toContainText('設問5を回答・自己評価の対象から除外');
      await expect(page.locator('.w-answer-label')).toHaveCount(25);
      await expect(page.locator('.w-answer-label').filter({hasText:'設問5'})).toHaveCount(0);
    }
    await page.getByRole('button',{name:'公式解答例で答え合わせ →'}).click();
    await page.getByRole('button',{name:'未回答を含めて解答例を見る'}).click();
    await expect(page.locator('.w-example').first()).toContainText(answer);
    for (const name of ['公式解答例PDF ↗', '公式採点講評PDF ↗']) {
      const href = await page.getByRole('link',{name,exact:true}).getAttribute('href');
      expect(href).toMatch(new RegExp(`^/written/${year}/`));
      expect((await request.get(href!)).ok()).toBe(true);
    }
  }
});
test('記述回答を再開し、未回答も比較・自己評価して、履歴を残して解き直せる',async({page,request})=>{
  const s=await start(page,request,'2025-b1-q1');
  await page.getByLabel('設問1 (1) a',{exact:true}).fill('バックボーン');
  await page.getByLabel('考えた根拠・復習メモ').fill('経路収束を待つ理由を確認');
  await page.getByRole('button',{name:'設問のページへ ↓'}).click();
  await saved(page); await page.reload();
  await expect(page.getByLabel('設問1 (1) a',{exact:true})).toHaveValue('バックボーン');
  await expect(page.getByLabel('問題ページ')).toHaveValue('7');
  await page.getByRole('link',{name:'解答欄へ ↓'}).click();
  await expect(page.getByLabel('設問1 (1) a',{exact:true})).toBeVisible();
  expect(page.url()).toContain(s.id);
  await expect(page.locator('.w-page-viewer img')).toBeVisible();
  expect(await page.locator('.w-page-viewer img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
  await page.getByRole('button',{name:'公式解答例で答え合わせ →'}).click();
  await page.getByRole('button',{name:'未回答を含めて解答例を見る'}).click();
  await expect(page.locator('.w-example').first()).toContainText('バックボーン');
  await expect(page.getByRole('textbox',{name:'設問1 (1) a',exact:true})).toHaveCount(0);
  for(const field of await page.locator('.w-assessment').all()) await field.getByRole('radio',{name:'要復習',exact:true}).check();
  await page.getByRole('button',{name:'振り返りを完了する →'}).click();
  await expect(page.getByRole('region',{name:'振り返りの結果'})).toContainText('要復習 12');
  await page.getByRole('button',{name:'次の問題を選ぶ →'}).click();
  await page.getByRole('button',{name:/学習の記録/}).click();
  const row=page.locator('.w-history-list article').filter({hasText:'企業ネットワークの更改'}).first();
  await expect(row).toContainText('要復習 12');
  await row.getByRole('button').click();
  await expect(page.getByLabel('考えた根拠・復習メモ')).toHaveValue('経路収束を待つ理由を確認');
  await expect(page.getByLabel('考えた根拠・復習メモ')).toBeDisabled();
  await page.getByRole('button',{name:'← 保存して一覧へ'}).click();
  const card=page.locator('.w-question-card').filter({hasText:'企業ネットワークの更改'});
  await card.getByRole('button',{name:'解き直す',exact:true}).click();
  await expect(page.getByLabel('設問1 (1) a',{exact:true})).toHaveValue('');
  expect(page.url()).not.toContain(s.id);
});
test('通信失敗時の回答は未保存と表示し、再読込後に控えを復元して保存できる',async({page,request})=>{
  await page.setViewportSize({width:390,height:844}); await start(page,request,'2025-b1-q2');
  await page.route('**/api/written/sessions/*/draft',route=>route.abort());
  await page.getByLabel('設問1 (1) a',{exact:true}).fill('未保存の回答');
  await expect(page.getByRole('alert')).toContainText('回答はこの画面に保持');
  await page.reload();
  await expect(page.getByLabel('設問1 (1) a',{exact:true})).toHaveValue('未保存の回答');
  await expect(page.getByText('ブラウザーに退避した未保存の回答を復元しました。')).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/written/sessions/*/draft');
  await page.getByRole('button',{name:'保存を再試行',exact:true}).click();
  await saved(page); await page.reload();
  await expect(page.getByLabel('設問1 (1) a',{exact:true})).toHaveValue('未保存の回答');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('別タブの更新を上書きせず、競合した回答を控えとして取り出せる',async({page,context,request})=>{
  const s=await start(page,request,'2025-b2-q1');
  const other=await context.newPage();await other.goto(`/#written/${s.id}`);
  await expect(other.getByLabel('設問1 a',{exact:true})).toBeVisible();
  await page.getByLabel('設問1 a',{exact:true}).fill('最初の画面の回答'); await saved(page);
  await other.getByLabel('設問1 a',{exact:true}).fill('別タブの回答');
  await expect(other.getByRole('alert')).toContainText('別の画面で更新されています');
  const download=other.waitForEvent('download');
  await other.getByRole('button',{name:'回答の控えをダウンロード',exact:true}).click();
  expect((await download).suggestedFilename()).toContain(s.id);
  const server=await (await request.get(`/api/written/sessions/${s.id}`)).json();
  expect(server.answers.s1).toBe('最初の画面の回答');
  await expect(other.getByLabel('設問1 a',{exact:true})).toHaveValue('別タブの回答');
});

test('演習の読込失敗後に再接続すると同じ回答と閲覧ページを復元する', async ({page,request}) => {
  const s = await (await request.post('/api/written/sessions',{data:{questionId:'2025-b1-q1'}})).json();
  const savedDraft = await request.put(`/api/written/sessions/${s.id}/draft`, {data:{
    revision:s.revision, answers:{...s.answers,s1:'再接続前の回答'}, assessments:s.assessments, notes:'保存済みのメモ', page:7,
  }});
  expect(savedDraft.ok()).toBe(true);
  await page.route(`**/api/written/sessions/${s.id}`,route=>route.abort());
  await page.goto(`/#written/${s.id}`);
  await expect(page.getByRole('alert')).toBeVisible();
  // A retry that still fails must keep the recovery controls visible.
  await page.getByRole('button',{name:'再接続',exact:true}).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute(`**/api/written/sessions/${s.id}`);
  await page.getByRole('button',{name:'再接続',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'設問1 (1) a',exact:true})).toHaveValue('再接続前の回答');
  await expect(page.getByLabel('考えた根拠・復習メモ')).toHaveValue('保存済みのメモ');
  await expect(page.getByLabel('問題ページ')).toHaveValue('7');
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(page.url()).toContain(s.id);
});

test('三つの候補から二つ選ぶ解答例を両欄に表示する', async ({page,request}) => {
  await start(page,request,'2025-b1-q3');
  await page.getByRole('button',{name:'公式解答例で答え合わせ →'}).click();
  await page.getByRole('button',{name:'未回答を含めて解答例を見る'}).click();
  for (const id of ['s2','s3']) {
    const example = page.locator('.w-answer-item').filter({has:page.locator(`#answer-${id}`)}).locator('.w-example');
    for (const candidate of ['異なる2項目','順不同','ブロック','アクセス履歴','利用者認証']) await expect(example).toContainText(candidate);
  }
});
