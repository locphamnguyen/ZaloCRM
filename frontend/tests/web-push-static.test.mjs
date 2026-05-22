import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../src/pwa/sw.ts', import.meta.url), 'utf8');
const composable = readFileSync(new URL('../src/composables/use-web-push.ts', import.meta.url), 'utf8');
const bell = readFileSync(new URL('../src/components/NotificationBell.vue', import.meta.url), 'utf8');
const mobileLayout = readFileSync(new URL('../src/layouts/MobileLayout.vue', import.meta.url), 'utf8');

assert.match(viteConfig, /strategies:\s*['"]injectManifest['"]/);
assert.match(viteConfig, /filename:\s*['"]sw\.ts['"]/);
assert.match(sw, /self\.addEventListener\(['"]push['"]/);
assert.match(sw, /self\.addEventListener\(['"]notificationclick['"]/);
assert.match(composable, /Notification\.requestPermission\(\)/);
assert.match(composable, /pushManager\.subscribe/);
assert.match(composable, /\/notifications\/push\/subscriptions/);
assert.match(bell, /useWebPush/);
assert.match(bell, /Bật thông báo/);
assert.doesNotMatch(bell, /interface Notification\b/);
assert.match(mobileLayout, /ToastContainer/);

console.log('web push static checks passed');
