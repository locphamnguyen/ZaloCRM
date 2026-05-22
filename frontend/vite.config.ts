import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vuetify from 'vite-plugin-vuetify';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['brand/zalocrm-logo.png'],
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2}'],
      },
      manifest: {
        name: 'ZaloCRM',
        short_name: 'ZaloCRM',
        description: 'Quản lý nhiều tài khoản Zalo cá nhân',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#070A12',
        theme_color: '#D6A84F',
        icons: [
          {
            src: '/brand/zalocrm-logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/brand/zalocrm-logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
        shortcuts: [
          {
            name: 'Chat',
            short_name: 'Chat',
            description: 'Mở tin nhắn',
            url: '/chat',
            icons: [{ src: '/brand/zalocrm-logo.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Khách hàng',
            short_name: 'Khách hàng',
            description: 'Mở danh sách khách hàng',
            url: '/contacts',
            icons: [{ src: '/brand/zalocrm-logo.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
      },
      devOptions: {
        enabled: process.env.VITE_PWA_DEV === 'true',
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
});
