import { test, expect } from '@playwright/test';

test('問題と選択済み解答欄をPNGでクリップボードにコピーする', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/choice');
  await page.getByRole('button', { name: '10問を解く', exact: true }).click();
  await page.getByRole('radio', { name: 'イ　30', exact: true }).check();
  await page.getByRole('button', { name: 'スクリーンショットをコピー', exact: true }).click();
  await expect(page.getByText('問題と解答欄の画像をクリップボードにコピーしました。', { exact: true })).toBeVisible();
  const result = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0].getType('image/png');
    const bitmap = await createImageBitmap(blob);
    return { size: blob.size, width: bitmap.width, height: bitmap.height };
  });
  expect(result.size).toBeGreaterThan(1000);
  expect(result.width).toBeGreaterThan(300);
  expect(result.height).toBeGreaterThan(100);
  await expect(page.getByRole('radio', { name: 'イ　30', exact: true })).toBeChecked();
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, 'write', {
    configurable: true, value: () => Promise.reject(new DOMException('Denied', 'NotAllowedError')),
  }));
  await page.getByRole('button', { name: 'スクリーンショットをコピー', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('画像をコピーできませんでした');
  await expect(page.getByRole('button', { name: 'スクリーンショットをコピー', exact: true })).toBeEnabled();
});
