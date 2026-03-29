import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import { vuetify } from './plugins/vuetify';
import './assets/main.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(vuetify);
app.mount('#app');

// Register PWA service worker
if ('serviceWorker' in navigator) {
  import('virtual:pwa-register').then(({ registerSW }) => {
    registerSW({ immediate: true });
  });
}
