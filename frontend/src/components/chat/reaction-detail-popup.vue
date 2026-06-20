<!--
  reaction-detail-popup.vue — Anh chốt 2026-05-22: học Zalo native popup "Biểu cảm".
  Sidebar tabs: "Tất cả N" / "[emoji] [count]" cho mỗi emoji.
  Main panel: list users đã thả emoji của tab đang chọn (avatar + name + emoji + count).
-->
<template>
  <v-dialog :model-value="modelValue" max-width="560" @update:model-value="$emit('update:modelValue', $event)">
    <div class="reaction-popup">
      <div class="popup-head">
        <h3>Biểu cảm</h3>
        <button class="close-btn" @click="$emit('update:modelValue', false)">
          <v-icon size="20">mdi-close</v-icon>
        </button>
      </div>

      <div class="popup-body">
        <!-- LEFT: Tabs sidebar (Tất cả + per-emoji) -->
        <aside class="popup-sidebar">
          <button
            class="tab-item"
            :class="{ active: activeTab === 'all' }"
            @click="activeTab = 'all'"
          >
            <span class="tab-label">Tất cả</span>
            <span class="tab-count">{{ totalCount }}</span>
          </button>
          <button
            v-for="r in reactionsSorted"
            :key="r.emoji"
            class="tab-item"
            :class="{ active: activeTab === r.emoji }"
            @click="activeTab = r.emoji"
          >
            <span class="tab-emoji">{{ r.emoji }}</span>
            <span class="tab-count">{{ r.count }}</span>
          </button>
        </aside>

        <!-- RIGHT: User list của tab đang chọn -->
        <section class="popup-main">
          <div v-if="filteredUsers.length === 0" class="popup-empty">
            Chưa có ai thả emoji này
          </div>
          <div
            v-for="u in filteredUsers"
            :key="u.userId"
            class="user-row"
          >
            <img
              v-if="u.avatarUrl && !failedAvatars.has(u.userId)"
              class="user-avatar user-avatar-img"
              :src="u.avatarUrl"
              :alt="u.name"
              referrerpolicy="no-referrer"
              @error="onAvatarError(u.userId)"
            />
            <span v-else class="user-avatar" :style="{ background: avatarColor(u.name) }">
              {{ initials(u.name) }}
            </span>
            <div class="user-info">
              <div class="user-name">{{ u.name }}</div>
              <div v-if="u.source" class="user-source">{{ u.source === 'zalo' ? 'Từ Zalo App' : 'Từ CRM' }}</div>
            </div>
            <div class="user-emojis">
              <span v-for="e in u.emojis" :key="e" class="user-emoji">{{ e }}</span>
              <span class="user-emoji-count">{{ u.emojis.length }}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface ReactionView { emoji: string; count: number; reacted: boolean }
interface ReactionDetail {
  userId: string;
  userName?: string | null;
  emoji: string;
  source?: 'crm' | 'zalo';
  avatarUrl?: string | null;
}

const props = defineProps<{
  modelValue: boolean;
  reactions: ReactionView[];
  /** Optional: raw reaction rows from DB (per-user per-emoji) để show user list */
  details?: ReactionDetail[];
}>();

defineEmits<{
  'update:modelValue': [value: boolean];
}>();

const activeTab = ref<string>('all');

// Avatar thật lỗi tải (URL Zalo hết hạn) → fallback về vòng tròn chữ-cái.
const failedAvatars = ref<Set<string>>(new Set());
function onAvatarError(userId: string) {
  failedAvatars.value = new Set(failedAvatars.value).add(userId);
}

// Reset tab khi popup mở lại
watch(() => props.modelValue, (open) => {
  if (open) { activeTab.value = 'all'; failedAvatars.value = new Set(); }
});

const totalCount = computed(() =>
  props.reactions.reduce((sum, r) => sum + r.count, 0)
);

// Sort emoji tabs theo count desc
const reactionsSorted = computed(() => {
  return [...props.reactions].sort((a, b) => b.count - a.count);
});

// Group details by userId → user row với list emoji
const groupedUsers = computed(() => {
  const map = new Map<string, { userId: string; name: string; source?: 'crm' | 'zalo'; avatarUrl?: string | null; emojis: string[] }>();
  for (const d of props.details ?? []) {
    const existing = map.get(d.userId);
    if (existing) {
      existing.emojis.push(d.emoji);
      if (!existing.avatarUrl && d.avatarUrl) existing.avatarUrl = d.avatarUrl;
    } else {
      map.set(d.userId, {
        userId: d.userId,
        name: d.userName || 'Người dùng',
        source: d.source,
        avatarUrl: d.avatarUrl ?? null,
        emojis: [d.emoji],
      });
    }
  }
  return Array.from(map.values());
});

// Filter user list theo tab đang chọn
const filteredUsers = computed(() => {
  if (activeTab.value === 'all') return groupedUsers.value;
  return groupedUsers.value.filter((u) => u.emojis.includes(activeTab.value));
});

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style scoped>
.reaction-popup {
  background: white;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  max-height: 520px;
}
.popup-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 18px;
  border-bottom: 1px solid #f0f1f3;
}
.popup-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #181d26;
}
.close-btn {
  background: none;
  border: 0;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  cursor: pointer;
  color: #6B7280;
  display: flex;
  align-items: center;
  justify-content: center;
}
.close-btn:hover { background: #f0f1f3; color: #181d26; }

.popup-body {
  display: grid;
  grid-template-columns: 180px 1fr;
  min-height: 280px;
  max-height: 460px;
}
.popup-sidebar {
  background: #f8fafc;
  border-right: 1px solid #f0f1f3;
  padding: 8px;
  overflow-y: auto;
  min-height: 0;
}
.tab-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-radius: 8px;
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: 13px;
  color: #41454d;
  margin-bottom: 2px;
  transition: background 0.1s;
}
.tab-item:hover { background: #f0f1f3; }
.tab-item.active {
  background: white;
  color: #181d26;
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.tab-label, .tab-emoji {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.tab-emoji { font-size: 18px; }
.tab-count {
  font-size: 12px;
  color: #6B7280;
  font-weight: 600;
}
.tab-item.active .tab-count { color: #181d26; }

.popup-main {
  padding: 8px;
  overflow-y: auto;
  /* 2026-06-20 (anh báo: list dài không cuộn được): grid item mặc định min-height:auto →
     phình theo nội dung, tràn thay vì cuộn. min-height:0 cho phép co lại + overflow-y cuộn. */
  min-height: 0;
}
.popup-empty {
  padding: 40px 24px;
  text-align: center;
  color: #9CA3AF;
  font-size: 13px;
  font-style: italic;
}
.user-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 4px;
}
.user-row:hover { background: #f8fafc; }
.user-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
/* Avatar thật (Friend.zaloAvatarUrl) — phủ kín vòng tròn. */
.user-avatar-img {
  object-fit: cover;
  background: #e5e7eb;
}
.user-info { flex: 1; min-width: 0; }
.user-name {
  font-size: 13px;
  font-weight: 500;
  color: #181d26;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.user-source {
  font-size: 10px;
  color: #9CA3AF;
  margin-top: 2px;
}
.user-emojis {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.user-emoji { font-size: 18px; }
.user-emoji-count {
  font-size: 12px;
  font-weight: 700;
  color: #181d26;
  margin-left: 2px;
  font-variant-numeric: tabular-nums;
}
</style>
