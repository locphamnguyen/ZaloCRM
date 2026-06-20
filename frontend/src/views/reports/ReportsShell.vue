<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  ReportsShell — khung Module Báo cáo (2026-06-17). Sub-nav 7 màn + router-view.
  report-kit.css (global, scope .rpt-scope) cấp design system cho các view con.
-->
<template>
  <div class="rpt-shell">
    <nav class="rpt-subnav" aria-label="Báo cáo">
      <RouterLink v-for="t in tabs" :key="t.to" :to="t.to">
        <v-icon :icon="t.icon" size="17" /> {{ t.label }}
      </RouterLink>
    </nav>
    <div class="rpt-scope">
      <RouterView />
    </div>
  </div>
</template>

<script setup lang="ts">
const tabs = [
  { to: '/reports/tong-quan', icon: 'mdi-view-dashboard-outline', label: 'Tổng quan' },
  { to: '/reports/nick', icon: 'mdi-cellphone-link', label: 'Nick Zalo' },
  { to: '/reports/sale', icon: 'mdi-account-tie-outline', label: 'Sale & Team' },
  { to: '/reports/pipeline', icon: 'mdi-filter-variant', label: 'Pipeline & Lead Pool' },
  { to: '/reports/automation', icon: 'mdi-cog-sync-outline', label: 'Automation' },
  { to: '/reports/engagement', icon: 'mdi-fire', label: 'Engagement' },
  { to: '/reports/audit', icon: 'mdi-shield-check-outline', label: 'Audit & Hệ thống' },
];
</script>
