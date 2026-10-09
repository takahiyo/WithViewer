import { test, expect } from '@playwright/test';

test('長い議事録でも操作へ戻れ、設定は右側で開閉できる', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#title')).toHaveValue('新しい会議');
  await page.locator('#minutes').evaluate(el => {
    el.innerHTML = '<nav class="minutes-nav"><a href="#report-copy">1. 清書</a><a href="#report-original">2. 音声原本</a><a href="#report-screens">3. スクショ</a></nav><section id="report-copy"><h2>1. 清書</h2><div class="minutes-copy">' + '<p>本日の会議では、来期の取り組みと進め方について確認しました。各部門で課題を整理し、次回の会議で具体的な計画を共有する予定です。</p>'.repeat(100) + '</div></section><details id="report-original"><summary>2. 音声原本</summary>原本</details><details id="report-screens"><summary>3. スクショ</summary>画像一覧</details>';
  });
  await page.getByRole('navigation', { name: '会議の操作' }).getByRole('link', { name: '議事録', exact: true }).click();
  expect(await page.locator('#minutes').evaluate(el => el.scrollHeight > el.clientHeight * 5)).toBe(true);
  await page.locator('#minutes').getByRole('link', { name: '3. スクショ' }).click();
  await expect(page.locator('#report-screens')).toHaveAttribute('open', '');
  await page.getByRole('navigation', { name: '会議の操作' }).getByRole('link', { name: '記録', exact: true }).click();
  await expect(page.locator('#record')).toBeInViewport();
  await page.locator('#settings-open').click();
  await expect(page.locator('#drive-connect')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-panel')).toBeHidden();
  await expect(page.locator('#settings-open')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('workspace.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#settings-open').click();
  await expect(page.locator('#settings-close')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('settings-mobile.png') });
  await page.locator('#settings-close').click();
  await page.getByRole('navigation', { name: '会議の操作' }).getByRole('link', { name: '議事録', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('minutes-mobile.png') });
  await page.goto('/privacy.html');
  await expect(page.locator('h1')).toHaveText('プライバシーポリシー');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('privacy-mobile.png') });
});
