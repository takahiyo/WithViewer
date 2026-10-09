import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/browser', timeout: 45000, workers: 1,
  use: { channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true, baseURL: 'http://127.0.0.1:5174', viewport: { width: 1280, height: 1000 } }
});
