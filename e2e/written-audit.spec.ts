import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { WrittenQuestion } from '../src/domain/written';
const bank: WrittenQuestion[] = [2025,2024,2023].flatMap(y => JSON.parse(readFileSync(`materials/written-${y}.json`, 'utf8')));
for (const year of [2025,2024,2023]) test(`audit: ${year} 全解答欄の入力・字数・保存・固定・自己評価`, async ({page,request}) => {
  test.setTimeout(120000);
  await page.setViewportSize({width:390,height:844});
  for (const q of bank.filter(q => q.year === year)) {
    const created = await (await request.post('/api/written/sessions',{data:{questionId:q.id}})).json();
    await page.goto(`/#written/${created.id}`);
    await expect(page.locator('.w-answer-label')).toHaveCount(q.slots.length);
    const expected: Record<string,string> = {};
    for (const slot of q.slots) {
      const value = `${q.id}/${slot.id}\n日本語𠮷😀`;
      expected[slot.id] = value;
      await page.getByRole('textbox',{name:slot.label,exact:true}).fill(value);
      const count = Array.from(value.replace(/\n/g,'')).length;
      await expect(page.locator('.w-answer-item').filter({has:page.locator(`#answer-${slot.id}`)}).locator('.w-answer-label > span')).toHaveText(`${count}${slot.limit ? ` / ${slot.limit}字` : '字'}`);
    }
    const limited = q.slots.find(s => s.limit);
    if (limited) {
      expected[limited.id] = 'あ'.repeat(limited.limit!+1);
      await page.getByRole('textbox',{name:limited.label,exact:true}).fill(expected[limited.id]);
      await expect(page.locator(`#limit-${limited.id}`)).toHaveText('字数の目安を1字超えています。');
    }
    await page.getByRole('status').filter({hasText:'この環境に保存済み'}).waitFor();
    const stored = await (await request.get(`/api/written/sessions/${created.id}`)).json();
    expect(stored.answers).toEqual(expected);
    await page.reload();
    for (const slot of q.slots) await expect(page.getByRole('textbox',{name:slot.label,exact:true})).toHaveValue(expected[slot.id]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.getByRole('button',{name:'公式解答例で答え合わせ →',exact:true}).click();
    await expect(page.locator('.w-example')).toHaveCount(q.slots.length);
    for (let i=0;i<q.slots.length;i++) {
      await expect(page.locator('.w-example > p').nth(i)).toHaveText(q.slots[i].example!);
      await page.locator('.w-assessment').nth(i).getByRole('radio',{name:'一部できた',exact:true}).check();
    }
    await expect(page.locator('textarea[id^="answer-"]')).toHaveCount(0);
    await page.getByRole('button',{name:'振り返りを完了する →',exact:true}).click();
    await expect(page.getByRole('region',{name:'振り返りの結果'})).toContainText(`一部できた ${q.slots.length}`);
    const completed = await (await request.get(`/api/written/sessions/${created.id}`)).json();
    expect(completed.status).toBe('completed');
    expect(completed.answers).toEqual(expected);
    expect(Object.values(completed.assessments)).toEqual(q.slots.map(()=> 'partial'));
  }
});
