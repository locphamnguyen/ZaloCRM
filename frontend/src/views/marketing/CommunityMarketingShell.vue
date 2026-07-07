<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  CommunityMarketingShell — menu Marketing cho bản COMMUNITY (open-core).
  Chỉ gồm chức năng CORE: Quét nhóm + Tệp khách hàng. KHÔNG chứa chức năng EE
  (triggers/sequences/blocks/broadcasts/care…). Route /marketing này chỉ đăng ký
  khi !isExtension (xem router/index.ts) nên KHÔNG đụng shell Marketing của EE.
-->
<template>
  <div class="ce-marketing-shell">
    <aside class="ce-mkt-sidebar">
      <div class="ce-mkt-header">
        <v-icon size="20">mdi-bullhorn-variant-outline</v-icon>
        <span class="ce-mkt-title">Marketing</span>
      </div>
      <nav class="ce-mkt-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="ce-mkt-link"
          :class="{ 'is-active': isActive(item.to) }"
        >
          <v-icon size="18">{{ item.icon }}</v-icon>
          <span>{{ item.label }}</span>
        </RouterLink>
      </nav>
    </aside>
    <main class="ce-mkt-content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router';

const route = useRoute();

// Chỉ chức năng core. Phase 2 thêm Tệp khách hàng (/marketing/lists) khi Lists move ra core.
const navItems = [
  { to: '/marketing/group-scan', label: 'Quét nhóm', icon: 'mdi-account-group-outline' },
  { to: '/marketing/lists', label: 'Tệp khách hàng', icon: 'mdi-format-list-bulleted' },
  // Community extension 2026-07-07 — Mục tiêu (auto kết bạn, nên chạy trước Broadcast).
  { to: '/marketing/targets', label: 'Mục tiêu', icon: 'mdi-account-multiple-plus-outline' },
  // Community extension 2026-07-06 — Broadcast tự động (gửi tin hàng loạt theo lịch).
  { to: '/marketing/broadcasts', label: 'Broadcast tự động', icon: 'mdi-bullhorn-variant-outline' },
  // Community extension 2026-07-07 — Khối nội dung (kho nội dung tái dùng cho Broadcast).
  { to: '/marketing/content-blocks', label: 'Khối nội dung', icon: 'mdi-view-grid-plus-outline' },
];

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(to + '/');
}
</script>

<style scoped>
.ce-marketing-shell { display: flex; height: 100%; min-height: 0; }
.ce-mkt-sidebar {
  flex: 0 0 220px; border-right: 1px solid var(--border, #e5e4e7);
  background: #fbfbfc; display: flex; flex-direction: column; padding: 12px 8px;
}
.ce-mkt-header {
  display: flex; align-items: center; gap: 8px; padding: 8px 10px 12px;
  font-weight: 700; color: #0e445a; font-size: 15px;
}
.ce-mkt-nav { display: flex; flex-direction: column; gap: 2px; }
.ce-mkt-link {
  display: flex; align-items: center; gap: 10px; padding: 9px 12px;
  border-radius: 8px; color: #44505c; text-decoration: none; font-size: 14px;
}
.ce-mkt-link:hover { background: rgba(15, 111, 160, 0.08); }
.ce-mkt-link.is-active { background: rgba(15, 111, 160, 0.14); color: #0e445a; font-weight: 600; }
.ce-mkt-content { flex: 1 1 auto; min-width: 0; overflow: auto; }

@media (max-width: 768px) {
  .ce-marketing-shell { flex-direction: column; }
  .ce-mkt-sidebar { flex: 0 0 auto; border-right: none; border-bottom: 1px solid var(--border, #e5e4e7); }
  .ce-mkt-nav { flex-direction: row; overflow-x: auto; }
}
</style>
