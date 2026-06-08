<template>
  <div class="airtable-scope bot-auto-shell" :class="{ 'is-drawer-open': drawerOpen }">
    <!-- Mobile hamburger button (visible only on <768) -->
    <button class="mobile-trigger" @click="drawerOpen = true" aria-label="Mở menu Marketing">
      <v-icon size="20">mdi-menu</v-icon>
      <span class="mobile-trigger__label">{{ activeNavLabel }}</span>
      <v-icon size="18">mdi-chevron-down</v-icon>
    </button>

    <!-- Drawer backdrop (mobile only) -->
    <div
      v-if="drawerOpen"
      class="drawer-backdrop"
      @click="drawerOpen = false"
    />

    <aside class="bot-auto-sidebar">
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <v-icon size="20">mdi-bullhorn-variant-outline</v-icon>
        </div>
        <div class="sidebar-header__body">
          <div class="sidebar-title">Marketing</div>
          <div class="sidebar-subtitle">Mục tiêu · Luồng · Khối</div>
        </div>
        <button class="drawer-close" @click="drawerOpen = false" aria-label="Đóng menu">
          <v-icon size="20">mdi-close</v-icon>
        </button>
      </div>

      <nav class="sidebar-nav">
        <RouterLink
          v-for="item in navItems"
          :key="item.to"
          :to="item.to"
          class="sidebar-link"
          :class="{ 'is-primary': item.isPrimary, 'is-active': isLinkActive(item.to) }"
          :title="item.label"
          @click="drawerOpen = false"
        >
          <v-icon size="18" class="sidebar-link__icon">{{ item.icon }}</v-icon>
          <span class="sidebar-link__label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-foot-card">
          <div class="sidebar-foot-card__title">Marketing</div>
          <p class="sidebar-foot-card__desc">
            Tạo Mục tiêu · Luồng kịch bản · Khối nội dung · Gửi tin hàng loạt.
            Kênh: Zalo cá nhân.
          </p>
        </div>
      </div>
    </aside>

    <main class="bot-auto-content">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute } from 'vue-router';
import '@/components/automation/phase7/airtable.css';

const route = useRoute();
const drawerOpen = ref(false);

const navItems = [
  // Wave 4.1 (2026-06-02) — Anh chốt: tách Luồng và Khối thành 2 menu riêng.
  // Khối = nội dung dùng hàng ngày (sale gửi 1-1 + ghép vào Luồng), KHÔNG phải admin-only.
  { to: '/marketing/triggers/tao-moi',  label: 'Tạo Mục tiêu mới',   icon: 'mdi-plus-circle',         isPrimary: true },
  { to: '/marketing/triggers',          label: 'Mục tiêu',           icon: 'mdi-target' },
  { to: '/marketing/care-sessions',     label: 'Phiên chăm sóc',     icon: 'mdi-account-heart' },
  { to: '/marketing/sequences',         label: 'Luồng kịch bản',     icon: 'mdi-format-list-numbered' },
  { to: '/marketing/blocks',            label: 'Khối nội dung',      icon: 'mdi-puzzle' },
  { to: '/marketing/broadcasts',        label: 'Gửi tin hàng loạt',  icon: 'mdi-bullhorn' },
  { to: '/marketing/lists',             label: 'Tệp khách hàng',     icon: 'mdi-folder-account' },
];

// 2026-06-05 — Longest-prefix match. /marketing/triggers/tao-moi (wizard) là prefix-
// con của /marketing/triggers (Mục tiêu) → nếu dùng startsWith thường, cả 2 item cùng
// "active". Chọn item có `to` DÀI NHẤT khớp path để chỉ 1 item sáng: ở /tao-moi →
// "Tạo Mục tiêu mới"; ở /triggers hoặc /triggers/:id → "Mục tiêu".
function matchLen(to: string): number {
  if (route.path === to) return to.length + 1; // exact thắng prefix cùng độ dài
  if (route.path.startsWith(to + '/')) return to.length;
  return -1;
}
const activeTo = computed(() => {
  let best = '';
  let bestLen = -1;
  for (const n of navItems) {
    const len = matchLen(n.to);
    if (len > bestLen) { bestLen = len; best = n.to; }
  }
  return bestLen >= 0 ? best : '';
});
function isLinkActive(to: string): boolean {
  return to === activeTo.value;
}

const activeNavLabel = computed(() => {
  const match = navItems.find((n) => n.to === activeTo.value);
  return match?.label ?? 'Marketing';
});

// Close drawer when route changes (in case user uses browser nav)
watch(() => route.path, () => { drawerOpen.value = false; });
</script>

<style scoped>
/* HS re-skin 2026-06-05: sidebar theo .mkt-side HS (token --brand/--ink/--surface).
   Giữ nguyên template + navItems + drawer logic — chỉ đổi giao diện. */
.bot-auto-shell {
  display: flex;
  height: calc(100vh - var(--nav-h, 48px));
  position: relative;
  background: var(--surface-2);
}

/* ─── Mobile hamburger trigger (visible <768) ─────────────────────────── */
.mobile-trigger {
  display: none;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  border-top: 0; border-left: 0; border-right: 0;
  padding: 8px 14px;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  width: 100%;
  font-family: inherit;
  min-height: 48px;
}
.mobile-trigger__label { flex: 1; text-align: left; }

.drawer-backdrop {
  display: none;
  position: fixed;
  inset: 64px 0 0 0;
  background: rgba(24, 29, 38, 0.4);
  z-index: 98;
}
.drawer-close {
  display: none;
  margin-left: auto;
  background: transparent;
  border: 0;
  cursor: pointer;
  color: var(--ink-3);
  padding: 6px;
  border-radius: var(--r-sm, 8px);
  min-width: 44px;
  min-height: 44px;
}
.drawer-close:hover { background: var(--surface-3); }

/* ─── Sidebar HS .mkt-side (desktop 244px) ───────────────────────────── */
.bot-auto-sidebar {
  width: 244px;
  flex-shrink: 0;
  background: var(--surface);
  border-right: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  padding: 16px 12px;
  gap: 16px;
  overflow-y: auto;
  transition: width 0.15s ease;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 0 4px;
}
.sidebar-header__body { min-width: 0; flex: 1; overflow: hidden; }
.sidebar-logo {
  width: 40px;
  height: 40px;
  border-radius: var(--r-md, 10px);
  background: linear-gradient(150deg, var(--brand), var(--brand-700));
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.sidebar-title {
  font-size: 17px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar-subtitle {
  font-size: 11.5px;
  color: var(--ink-4);
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.sidebar-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--r-sm, 8px);
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  border: 1px solid transparent;
}
.sidebar-link__icon { color: var(--ink-4); }
.sidebar-link:hover { background: var(--surface-3); }
.sidebar-link.is-active {
  background: var(--ink);
  color: #fff;
  border-color: var(--ink);
}
.sidebar-link.is-active .sidebar-link__icon { color: #fff; }
/* CTA "Tạo Mục tiêu mới" — brand HS metallic blue (thay #0068ff cũ) */
.sidebar-link.is-primary {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
  font-weight: 700;
}
.sidebar-link.is-primary .sidebar-link__icon { color: #fff; }
.sidebar-link.is-primary:hover {
  background: var(--brand-600);
  border-color: var(--brand-600);
}
.sidebar-link.is-primary.is-active {
  background: var(--brand-700);
  border-color: var(--brand-700);
  box-shadow: inset 0 0 0 2px rgba(255, 255, 255, 0.3);
}
.sidebar-link__icon { flex-shrink: 0; }
.sidebar-link__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-footer {
  margin-top: auto;
}
.sidebar-foot-card {
  padding: 13px;
  background: var(--brand-softer);
  border: 1px solid var(--brand-soft);
  border-radius: var(--r-md, 10px);
}
.sidebar-foot-card__title {
  font-size: 12.5px;
  font-weight: 700;
  color: var(--brand-700);
  margin-bottom: 5px;
}
.sidebar-foot-card__desc {
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--ink-3);
  margin: 0;
}

.bot-auto-content {
  flex: 1;
  padding: 0;
  overflow-y: auto;
  background: var(--surface-2);
  min-width: 0; /* prevent grid overflow */
}
/* 2026-06-04 — Mỗi view tự render layout topbar+content phù hợp shell.
   Padding cũ 48px (--at-s-xxl) quá rộng cho HD 1366. Bỏ padding,
   content view dùng .at-page-shell + .at-page-topbar + .at-page-body chuẩn. */

/* ─── TABLET (768-1023): icon-only sidebar rail ──────────────────────── */
@media (min-width: 768px) and (max-width: 1023px) {
  .bot-auto-sidebar {
    width: 72px;
    padding: 16px 8px;
    gap: 16px;
  }
  .sidebar-header { justify-content: center; padding: 0; }
  .sidebar-header__body,
  .sidebar-link__label,
  .sidebar-foot-card { display: none; }
  .sidebar-link {
    justify-content: center;
    padding: 12px;
  }
  .bot-auto-content { padding: 24px; }
}

/* ─── MOBILE (<768): drawer slide-in ──────────────────────────────────── */
@media (max-width: 767px) {
  .bot-auto-shell {
    flex-direction: column;
    height: auto;
    min-height: calc(100vh - 64px);
  }
  .mobile-trigger { display: flex; }
  .bot-auto-sidebar {
    position: fixed;
    top: 64px;
    bottom: 0;
    left: 0;
    width: 280px;
    z-index: 99;
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    box-shadow: 4px 0 24px rgba(0,0,0,0.08);
  }
  .is-drawer-open .bot-auto-sidebar { transform: translateX(0); }
  .is-drawer-open .drawer-backdrop { display: block; }
  .is-drawer-open .drawer-close { display: inline-flex; align-items: center; justify-content: center; }
  .bot-auto-content {
    padding: var(--at-s-md);
    flex: 1;
  }
}
</style>
