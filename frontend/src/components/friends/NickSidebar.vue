<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <aside class="nick-sidebar">
    <div class="head">
      <div class="title">
        <span>Nick Zalo của bạn</span>
        <span class="total">{{ accounts.length }}</span>
      </div>
      <input
        v-model="searchQuery"
        class="search"
        placeholder="🔍 Tìm nick..."
      />
    </div>

    <div
      class="all-row"
      :class="{ active: selectedNickId === 'all' }"
      @click="$emit('select', 'all')"
    >
      <div class="av">∑</div>
      <div>
        <div>Tất cả nick</div>
        <div class="sub">Tổng hợp {{ accounts.length }} nick</div>
      </div>
      <span class="count">{{ totalFriendsAll }}</span>
    </div>

    <div class="nick-list">
      <div
        v-for="acc in filteredAccounts"
        :key="acc.id"
        class="nick-pill"
        :class="{ active: selectedNickId === acc.id }"
        @click="$emit('select', acc.id)"
      >
        <div class="av" :class="[saleClass(acc.id), { offline: !isOnline(acc) }]">
          <img
            v-if="acc.avatarUrl"
            :src="acc.avatarUrl"
            :alt="acc.displayName || 'Nick'"
            loading="lazy"
            referrerpolicy="no-referrer"
            @error="onNickAvatarError($event)"
          />
          <span v-else>{{ initials(acc.displayName) }}</span>
        </div>
        <div class="info">
          <div class="name">{{ acc.displayName || 'Nick chưa đặt tên' }}</div>
          <div class="meta">{{ acc.phone || acc.zaloUid || '—' }}</div>
        </div>
        <span class="count">{{ countByNick[acc.id] ?? '—' }}</span>
      </div>
      <div v-if="!filteredAccounts.length" class="empty-nick">
        Không tìm thấy nick "{{ searchQuery }}"
      </div>
    </div>

    <div class="footer">
      <span class="dot" />
      <span>{{ onlineCount }}/{{ accounts.length }} online · Auto-sync</span>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import type { ZaloAccount } from '@/composables/use-zalo-accounts';

const props = defineProps<{
  accounts: ZaloAccount[];
  selectedNickId: string | null;
  countByNick: Record<string, number>;
  totalFriendsAll: number;
}>();

defineEmits<{
  (e: 'select', nickId: string): void;
}>();

const searchQuery = ref('');

const filteredAccounts = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return props.accounts;
  return props.accounts.filter(a => {
    const hay = `${a.displayName || ''} ${a.phone || ''} ${a.zaloUid || ''}`.toLowerCase();
    return hay.includes(q);
  });
});

function isOnline(acc: ZaloAccount): boolean {
  return acc.liveStatus === 'online' || acc.status === 'connected';
}

const onlineCount = computed(() => props.accounts.filter(isOnline).length);

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}

// 7-color palette hashed by account id (matches mockup avatars)
const PALETTE = ['av-c1', 'av-c2', 'av-c3', 'av-c4', 'av-c5', 'av-c6', 'av-c7'];
function saleClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// Khi avatar URL fail load (Zalo CDN expire hoặc hotlink block) → ẩn img,
// fallback sang initials span (đã có sẵn trong DOM nhờ v-else nếu URL null,
// nhưng khi URL có-rồi-fail, span chưa render → tự inject).
function onNickAvatarError(e: Event): void {
  const img = e.target as HTMLImageElement;
  img.style.display = 'none';
  const parent = img.parentElement;
  if (parent && !parent.querySelector('span')) {
    const span = document.createElement('span');
    span.textContent = '?';
    parent.appendChild(span);
  }
}
</script>

<style scoped>
.nick-sidebar {
  background: var(--surface);
  border-right: 1px solid var(--line);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  height: 100%;
}

.head {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line);
}
.head .title {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: var(--ink-4);
  font-weight: 700;
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.head .title .total {
  background: var(--brand-soft);
  color: var(--brand);
  padding: 1px 8px;
  border-radius: var(--r-pill);
  font-size: 11px;
}
.head .search {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-xs);
  font-size: 12px;
  background: var(--surface-2);
  font-family: inherit;
  box-sizing: border-box;
}
.head .search:focus { outline: none; background: var(--surface); border-color: var(--brand); }

.all-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 10px; border-radius: var(--r-sm);
  cursor: pointer; border: 1px dashed var(--line);
  margin: 8px;
  font-weight: 600; font-size: 13px; color: var(--ink-2);
}
.all-row:hover { background: var(--brand-soft); color: var(--brand); border-color: var(--brand); }
.all-row.active { background: var(--brand); color: #fff; border-color: var(--brand); border-style: solid; }
.all-row .av {
  width: 28px; height: 28px; border-radius: var(--r-xs);
  background: linear-gradient(135deg, #94a3b8, #64748b);
  display: grid; place-items: center; color: #fff; font-size: 12px;
  flex-shrink: 0;
}
.all-row.active .av { background: rgba(255,255,255,.18); }
.all-row .sub { font-size: 10px; opacity: .7; font-weight: 400; }
.all-row .count {
  margin-left: auto; font-size: 11px;
  padding: 2px 8px; border-radius: var(--r-pill);
  background: var(--surface-2); color: var(--ink-2);
}
.all-row.active .count { background: rgba(255,255,255,.2); color: #fff; }

.nick-list { padding: 6px 8px; overflow-y: auto; flex: 1; }

.nick-pill {
  display: grid; grid-template-columns: 32px 1fr auto; gap: 8px; align-items: center;
  padding: 8px 10px; border-radius: var(--r-sm);
  cursor: pointer;
  border: 1px solid transparent;
  margin-bottom: 2px;
}
.nick-pill:hover { background: var(--surface-2); }
.nick-pill.active {
  background: var(--brand-soft);
  border-color: var(--brand);
  box-shadow: 0 1px 2px rgba(47,110,229,.1);
}
.nick-pill .av {
  width: 32px; height: 32px; border-radius: 50%;
  color: #fff; display: grid; place-items: center;
  font-weight: 700; font-size: 11px;
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
}
.nick-pill .av img {
  width: 100%; height: 100%; object-fit: cover;
  display: block;
}
.nick-pill .av::after {
  content: ""; position: absolute; bottom: -1px; right: -1px;
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--success); border: 2px solid var(--surface);
  z-index: 1;
}
.nick-pill .av.offline::after { background: var(--ink-4); }
.nick-pill .info { min-width: 0; }
.nick-pill .info .name {
  font-weight: 600; font-size: 13px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.nick-pill .info .meta { font-size: 11px; color: var(--ink-4); }
.nick-pill .count {
  font-size: 11px; font-weight: 700;
  background: var(--surface-2); color: var(--ink-2);
  padding: 2px 8px; border-radius: var(--r-pill);
}
.nick-pill.active .count { background: var(--brand); color: #fff; }

.empty-nick {
  text-align: center;
  font-size: 12px;
  color: var(--ink-4);
  padding: 20px 10px;
}

.footer {
  padding: 10px 14px;
  border-top: 1px solid var(--line);
  font-size: 11px;
  color: var(--ink-4);
  display: flex; align-items: center; gap: 6px;
}
.footer .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--success); }

/* Sale color palette — đồng nhất qua hash account.id */
.av-c1 { background: linear-gradient(135deg, #2f6ee5, #1d4ed8); }
.av-c2 { background: linear-gradient(135deg, #16a34a, #15803d); }
.av-c3 { background: linear-gradient(135deg, #d97706, #b45309); }
.av-c4 { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
.av-c5 { background: linear-gradient(135deg, #db2777, #be185d); }
.av-c6 { background: linear-gradient(135deg, #0891b2, #0e7490); }
.av-c7 { background: linear-gradient(135deg, #ea580c, #c2410c); }
</style>
