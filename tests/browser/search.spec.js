import { test, expect } from '@playwright/test';

const search = async (page, query) => {
  await page.getByRole('navigation', { name: '会議の操作' }).getByRole('link', { name: '検索', exact: true }).click();
  await page.locator('#query').fill(query);
  await page.getByRole('button', { name: '検索', exact: true }).click();
};

test('発言の検索結果から長い原本と清書へ移動し、対象を強調する', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#title')).toHaveValue('新しい会議');
  const segments = Array.from({ length: 80 }, (_, i) => ({ id: `s${i}`, source: 'meeting', start: i * 10, end: i * 10 + 10, status: 'done', text: i === 60 ? '予算の承認を来週行います。' : `議題${i}の検討について説明しました。` }));
  const copy = Array.from({ length: 80 }, (_, i) => i === 60 ? '来週、予算を承認することになりました。' : `議題${i}について内容を整理し、今後の進め方を確認しました。`).join('\n\n');
  const backup = { version: 1, meeting: { id: 'search-backup', title: '検索ジャンプ会議', segments, consultations: [], visuals: [], minutes: { format: 2, parts: [copy] } } };
  await page.locator('#import').setInputFiles({ name: 'search.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.locator('#title')).toHaveValue('検索ジャンプ会議');
  await search(page, '予算');
  await expect(page.locator('#results')).toContainText('来週、予算を承認');
  await page.getByRole('button', { name: '原本へ', exact: true }).click();
  await expect(page.locator('#report-original')).toHaveAttribute('open', '');
  const raw = page.locator('#minutes .search-target');
  await expect(raw).toContainText('予算の承認を来週');
  await expect(raw).toBeFocused();
  await expect(raw).toBeInViewport();
  expect(await page.locator('#minutes').evaluate(el => el.scrollTop > 1000)).toBe(true);
  await search(page, '予算');
  await page.getByRole('button', { name: '清書へ', exact: true }).click();
  await expect(page.locator('#report-paragraph-60')).toBeFocused();
  await expect(page.locator('#report-paragraph-60')).toHaveClass('search-target');
  await expect(page.locator('#report-paragraph-60')).toBeInViewport();
  await page.setViewportSize({ width: 390, height: 844 });
  await search(page, '承認すること'); // A phrase present only in the edited copy.
  await expect(page.locator('#results')).toContainText('一致する発言がありません');
  await page.getByRole('button', { name: '清書へ', exact: true }).click();
  await expect(page.locator('#report-paragraph-60')).toBeInViewport();
  await search(page, '存在しない語句');
  await expect(page.locator('#results')).toContainText('清書に一致する語句がありません');
  await expect(page.locator('#results button')).toHaveCount(0);
});

test('清書が未作成でも手入力メモへ戻れ、空の検索と会議切替を扱える', async ({ page }) => {
  await page.goto('/');
  await page.locator('summary').filter({ hasText: '会議メモを追加' }).click();
  await page.locator('#note').fill('予算は次回確認する。');
  await page.getByRole('button', { name: '会議記録に追加' }).click();
  await search(page, '予算');
  await expect(page.locator('#results')).toContainText('清書はまだ作成されていません');
  await page.getByRole('button', { name: '会議メモへ' }).click();
  await expect(page.locator('#segments .search-target')).toBeFocused();
  await expect(page.locator('#segments .search-target')).toBeInViewport();
  await search(page, ' ');
  await expect(page.locator('#results')).toContainText('検索する語句を入力');
  await page.locator('#new').click();
  await expect(page.locator('#results')).toBeEmpty();
});
