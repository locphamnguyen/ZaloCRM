<template>
  <div class="airtable-scope bot-auto-shell" :class="{ 'is-drawer-open': drawerOpen }">
    <!-- Mobile hamburger button (visible only on <768) -->
    <button class="mobile-trigger" @click="drawerOpen = true" aria-label="Mở menu Bot-Auto">
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
          <v-icon size="20">mdi-robot-outline</v-icon>
        </div>
        <div class="sidebar-header__body">
          <div class="sidebar-title">Bot-Auto</div>
          <div class="sidebar-subtitle">Automation framework</div>
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
          active-class="is-active"
          :title="item.label"
          @click="drawerOpen = false"
        >
          <v-icon size="18" class="sidebar-link__icon">{{ item.icon }}</v-icon>
          <span class="sidebar-link__label">{{ item.label }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-footer">
        <div class="sidebar-foot-card">
          <div class="sidebar-foot-card__title">Phase 7</div>
          <p class="sidebar-foot-card__desc">
            Block · Sequence · Trigger · Broadcast.
            Channel: Zalo cá nhân.
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
  { to: '/automation/bot/triggers',   label: 'Kịch bản',                  icon: 'mdi-lightning-bolt' },
  { to: '/automation/bot/blocks',     label: 'Thư viện block',            icon: 'mdi-puzzle' },
  { to: '/automation/bot/sequences',  label: 'Kịch bản chăm sóc',         icon: 'mdi-format-list-numbered' },
  { to: '/automation/bot/broadcasts', label: 'Broadcast & Re-marketing',  icon: 'mdi-bullhorn' },
  { to: '/automation/bot/lists',      label: 'Tệp khách hàng',            icon: 'mdi-folder-account' },
];

const activeNavLabel = computed(() => {
  const match = navItems.find((n) => route.path.startsWith(n.to));
  return match?.label ?? 'Bot-Auto';
});

// Close drawer when route changes (in case user uses browser nav)
watch(() => route.path, () => { drawerOpen.value = false; });
</script>

<style scoped>
.bot-auto-shell {
  display: flex;
  height: calc(100vh - 64px);
  position: relative;
}

/* ─── Mobile hamburger trigger (visible <768) ─────────────────────────── */
.mobile-trigger {
  display: none;
  align-items: center;
  gap: var(--at-s-sm);
  background: var(--at-canvas);
  border-bottom: 1px solid var(--at-hairline);
  border-top: 0; border-left: 0; border-right: 0;
  padding: var(--at-s-sm) var(--at-s-md);
  font-size: 15px;
  font-weight: 500;
  color: var(--at-ink);
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
  color: var(--at-muted);
  padding: 6px;
  border-radius: var(--at-r-sm);
  min-width: 44px;
  min-height: 44px;
}
.drawer-close:hover { background: var(--at-surface-soft); }

/* ─── Sidebar (desktop default: full 240px) ───────────────────────────── */
.bot-auto-sidebar {
  width: 240px;
  flex-shrink: 0;
  background: var(--at-canvas);
  border-right: 1px solid var(--at-hairline);
  display: flex;
  flex-direction: column;
  padding: var(--at-s-lg) var(--at-s-md);
  gap: var(--at-s-lg);
  overflow-y: auto;
  transition: width 0.15s ease;
}

.sidebar-header {
  display: flex;
  align-items: center;
  gap: var(--at-s-sm);
  padding: 0 var(--at-s-xxs);
}
.sidebar-header__body { min-width: 0; flex: 1; overflow: hidden; }
.sidebar-logo {
  width: 40px;
  height: 40px;
  border-radius: var(--at-r-md);
  background: var(--at-ink);
  color: var(--at-on-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.sidebar-title {
  font-size: 18px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--at-ink);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar-subtitle {
  font-size: 12px;
  color: var(--at-muted);
  margin-top: 2px;
  letter-spacing: 0.16px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.sidebar-link {
  display: flex;
  align-items: center;
  gap: var(--at-s-sm);
  padding: 10px 12px;
  border-radius: var(--at-r-sm);
  color: var(--at-body);
  font-size: 14px;
  font-weight: 500;
  text-decoration: none;
  border: 1px solid transparent;
  min-height: 44px;
}
.sidebar-link:active { background: var(--at-surface-soft); }
.sidebar-link.is-active {
  background: var(--at-ink);
  color: var(--at-on-primary);
  border-color: var(--at-ink);
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
  padding: var(--at-s-md);
  background: var(--at-cream);
  border-radius: var(--at-r-md);
}
.sidebar-foot-card__title {
  font-size: 13px;
  font-weight: 500;
  color: var(--at-ink);
  margin-bottom: 4px;
}
.sidebar-foot-card__desc {
  font-size: 12px;
  line-height: 1.45;
  color: var(--at-body);
  margin: 0;
}

.bot-auto-content {
  flex: 1;
  padding: var(--at-s-xxl);
  overflow-y: auto;
  background: var(--at-canvas);
  min-width: 0; /* prevent grid overflow */
}

/* ─── TABLET (768-1023): icon-only sidebar rail ──────────────────────── */
@media (min-width: 768px) and (max-width: 1023px) {
  .bot-auto-sidebar {
    width: 72px;
    padding: var(--at-s-md) var(--at-s-xs);
    gap: var(--at-s-md);
  }
  .sidebar-header { justify-content: center; padding: 0; }
  .sidebar-header__body,
  .sidebar-link__label,
  .sidebar-foot-card { display: none; }
  .sidebar-link {
    justify-content: center;
    padding: 12px;
  }
  .bot-auto-content { padding: var(--at-s-lg); }
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
