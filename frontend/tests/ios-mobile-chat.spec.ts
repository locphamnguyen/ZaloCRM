import { devices, expect, request, test } from '@playwright/test';

test.use({ ...devices['iPhone 15 Pro'] });

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:3080';

async function loginToken() {
  const api = await request.newContext({ baseURL });
  const response = await api.post('/api/v1/auth/login', {
    data: { email: 'demo@zalocrm.local', password: 'Demo@123456' },
  });
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.token).toBeTruthy();
  return payload.token as string;
}

test('iPhone WebKit chat thread stays inside viewport and AI trigger works', async ({ page }) => {
  const token = await loginToken();

  await page.addInitScript((authToken) => {
    localStorage.setItem('token', authToken);
    localStorage.setItem('auth_token', authToken);
  }, token);

  await page.goto(`${baseURL}/chat`, { waitUntil: 'networkidle' });
  await expect(page.getByText('Lan Anh').first()).toBeVisible();

  await page.screenshot({ path: '.claude/browser-artifacts/ios-mobile-chat-list.png', fullPage: true });
  await page.getByText('Lan Anh').first().click();
  await expect(page.locator('.message-thread')).toBeVisible();

  const listAndThreadMetrics = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    bodyScrollWidth: document.body.scrollWidth,
    htmlClientWidth: document.documentElement.clientWidth,
    mobileChat: document.querySelector('.mobile-chat')?.getBoundingClientRect().toJSON(),
    messageThread: document.querySelector('.message-thread')?.getBoundingClientRect().toJSON(),
    bottomNav: document.querySelector('.golden-bottom-nav')?.getBoundingClientRect().toJSON(),
    tagBarVisible: !!document.querySelector('.tag-crm-bar') && getComputedStyle(document.querySelector('.tag-crm-bar')!).display !== 'none',
  }));

  expect(listAndThreadMetrics.bodyScrollWidth).toBeLessThanOrEqual(listAndThreadMetrics.htmlClientWidth);
  expect(listAndThreadMetrics.tagBarVisible).toBe(false);
  expect(listAndThreadMetrics.mobileChat?.left).toBe(0);
  expect(listAndThreadMetrics.mobileChat?.right).toBeLessThanOrEqual(listAndThreadMetrics.viewportWidth);
  expect(listAndThreadMetrics.messageThread?.bottom).toBeLessThanOrEqual(listAndThreadMetrics.bottomNav!.top);

  await page.locator('.ai-btn').first().click();
  await expect(page.locator('.ai-suggest-bar')).toBeVisible();
  await page.screenshot({ path: '.claude/browser-artifacts/ios-mobile-chat-ai.png', fullPage: true });

  const aiMetrics = await page.evaluate(() => ({
    aiBar: document.querySelector('.ai-suggest-bar')?.getBoundingClientRect().toJSON(),
    bottomNav: document.querySelector('.golden-bottom-nav')?.getBoundingClientRect().toJSON(),
    refresh: document.querySelector('.ai-refresh')?.getBoundingClientRect().toJSON(),
  }));

  expect(aiMetrics.aiBar?.right).toBeLessThanOrEqual(listAndThreadMetrics.viewportWidth);
  expect(aiMetrics.aiBar?.bottom).toBeLessThanOrEqual(aiMetrics.bottomNav!.top);
  expect(aiMetrics.refresh?.width).toBeGreaterThanOrEqual(44);
  expect(aiMetrics.refresh?.height).toBeGreaterThanOrEqual(44);
});
