import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import { vuetify } from './plugins/vuetify';
import { setFeatures } from './plugin-api';
import './assets/tokens.css';
import './assets/main.css';
import './assets/rbac-page.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);

// Optional UI plugin bundle — chỉ có ở build mở rộng (VITE_EDITION=enterprise).
// Build mặc định không cài bundle này; @vite-ignore để build không lỗi resolve.
if (import.meta.env.VITE_EDITION === 'enterprise') {
  const bundle = '@zalocrm/enterprise-ui';
  import(/* @vite-ignore */ bundle)
    .then((mod) => mod.setupAll?.({ router }))
    .catch(() => console.info('[plugins] no UI plugin bundle present'));
}

app.mount('#app');

// Nạp danh sách feature đang bật để các ExtensionSlot có requiresFeature biết hiển thị.
fetch('/api/v1/license')
  .then((r) => r.json())
  .then((d) => setFeatures(Array.isArray(d?.features) ? d.features : []))
  .catch(() => { /* mặc định không feature nào */ });

// TODO: Re-enable PWA when vite-plugin-pwa supports vite 8
// if ('serviceWorker' in navigator) {
//   import('virtual:pwa-register').then(({ registerSW }) => {
//     registerSW({ immediate: true });
//   });
// }
