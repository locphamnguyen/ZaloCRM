<template>
  <aside class="filter-rail">
    <div class="fr-header">
      <h3>Bộ lọc</h3>

      <div class="nick-picker">
        <div class="nick-picker-label">Show tin nhắn của nick</div>
        <div class="nick-picker-active">
          <span
            v-for="nick in selectedAccounts"
            :key="nick.id"
            class="nick-pill-mini"
          >
            {{ nick.displayName || 'Nick' }}
            <span class="x" @click="onRemoveNick(nick.id)">×</span>
          </span>
          <button class="nick-picker-add" @click="showAccountMenu = !showAccountMenu">+ Thêm nick</button>
        </div>
        <div class="nick-picker-tools">
          <label class="group-toggle">
            <input type="checkbox" v-model="groupInbox" @change="emitFilters" />
            Gom inbox <span>{{ selectedAccounts.length }}</span> nick
          </label>
          <span class="ml-auto-count">
            Đã chọn <span>{{ selectedAccounts.length }}</span> / {{ allAccounts.length }}
          </span>
        </div>

        <!-- Pop-up multi-select -->
        <v-menu v-model="showAccountMenu" :close-on-content-click="false" location="bottom start">
          <template #activator="{ props: act }">
            <span v-bind="act" />
          </template>
          <v-list density="compact" max-height="320" min-width="240">
            <v-list-item
              v-for="acc in allAccounts"
              :key="acc.id"
              :title="acc.displayName || 'Nick'"
              @click="toggleAccount(acc.id)"
            >
              <template #prepend>
                <v-icon size="18" :color="isSelected(acc.id) ? 'primary' : ''">
                  {{ isSelected(acc.id) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                </v-icon>
              </template>
            </v-list-item>
          </v-list>
        </v-menu>
      </div>
    </div>

    <div class="fr-filters">
      <div class="filter-section-title">Loại hội thoại</div>
      <div class="filter-row" :class="{ active: threadType === 'group' }" @click="setThreadType('group')">
        <span class="icon">👥</span><span class="label">Tin nhắn nhóm</span>
        <span class="count" v-if="counts?.groups != null">{{ counts.groups }}</span>
      </div>
      <div class="filter-row" :class="{ active: threadType === 'user' }" @click="setThreadType('user')">
        <span class="icon">👤</span><span class="label">Tin nhắn user (1-1)</span>
        <span class="count" v-if="counts?.users != null">{{ counts.users }}</span>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-section-title">Đọc / Trả lời</div>
      <div class="filter-row">
        <span class="icon">⊙</span><span class="label">Chỉ lọc chưa đọc</span>
        <div class="smax-toggle-pill" :class="{ on: filters.unread }" @click="toggleFilter('unread')"></div>
      </div>
      <div class="filter-row">
        <span class="icon">↩</span><span class="label">Hội thoại chưa trả lời</span>
        <div class="smax-toggle-pill" :class="{ on: filters.unreplied }" @click="toggleFilter('unreplied')"></div>
      </div>
      <div class="filter-row">
        <span class="icon">⬆</span><span class="label">Chưa đọc lên trên cùng</span>
        <div class="smax-toggle-pill" :class="{ on: filters.unreadOnTop }" @click="toggleFilter('unreadOnTop')"></div>
      </div>

      <div class="filter-divider"></div>

      <div class="filter-section-title">Theo thuộc tính</div>
      <div class="filter-row" @click="$emit('open-tag-filter')">
        <span class="icon">🏷</span><span class="label">Lọc theo nhãn</span>
        <span class="count">+</span>
      </div>
      <div class="filter-row" @click="$emit('open-time-filter')">
        <span class="icon">📅</span><span class="label">Lọc theo thời gian</span>
        <span class="count">+</span>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';

interface ZaloAccountLite {
  id: string;
  displayName: string | null;
}

const props = defineProps<{
  accounts: ZaloAccountLite[];
  selectedAccountIds: string[];
  counts?: { groups?: number; users?: number };
}>();
const emit = defineEmits<{
  'update:accounts': [ids: string[]];
  'update:filters': [filters: Record<string, string>];
  'open-tag-filter': [];
  'open-time-filter': [];
}>();

const allAccounts = computed(() => props.accounts || []);
const selectedAccounts = computed(() =>
  allAccounts.value.filter(a => props.selectedAccountIds.includes(a.id)),
);

const showAccountMenu = ref(false);
const groupInbox = ref(true);
const threadType = ref<'all' | 'user' | 'group'>('all');
const filters = reactive({
  unread: false,
  unreplied: false,
  unreadOnTop: true,
});

function isSelected(id: string) { return props.selectedAccountIds.includes(id); }
function toggleAccount(id: string) {
  const next = isSelected(id)
    ? props.selectedAccountIds.filter(x => x !== id)
    : [...props.selectedAccountIds, id];
  emit('update:accounts', next);
}
function onRemoveNick(id: string) {
  emit('update:accounts', props.selectedAccountIds.filter(x => x !== id));
}
function toggleFilter(key: keyof typeof filters) {
  filters[key] = !filters[key];
  emitFilters();
}
function setThreadType(t: 'user' | 'group') {
  threadType.value = threadType.value === t ? 'all' : t;
  emitFilters();
}
function emitFilters() {
  const out: Record<string, string> = {};
  if (filters.unread) out.unread = '1';
  if (filters.unreplied) out.unreplied = '1';
  if (filters.unreadOnTop) out.unreadOnTop = '1';
  if (threadType.value !== 'all') out.threadType = threadType.value;
  if (groupInbox.value) out.groupInbox = '1';
  emit('update:filters', out);
}

watch(() => filters.unreadOnTop, () => { /* triggers via toggleFilter */ });
</script>

<style scoped>
.filter-rail {
  background: var(--smax-bg);
  border-right: 1px solid var(--smax-grey-200);
  display: flex; flex-direction: column;
  overflow: hidden;
  height: 100%;
}
.fr-header {
  padding: 11px 13px;
  border-bottom: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
}
.fr-header h3 {
  margin: 0 0 8px 0;
  font-size: 14px; font-weight: 600;
  color: var(--smax-grey-700);
}
.nick-picker {
  background: var(--smax-bg);
  border: 1.5px solid var(--smax-primary-soft);
  border-radius: 7px;
  padding: 7px 9px;
}
.nick-picker-label {
  font-size: 11px; color: var(--smax-grey-700);
  text-transform: uppercase;
  margin-bottom: 5px; letter-spacing: 0.3px;
}
.nick-picker-active {
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
}
.nick-pill-mini {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  padding: 3px 7px 3px 5px;
  border-radius: 11px;
  font-size: 12px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 4px;
}
.nick-pill-mini .x { cursor: pointer; opacity: 0.6; font-weight: 700; }
.nick-pill-mini .x:hover { opacity: 1; }
.nick-picker-add {
  background: transparent;
  border: 1px dashed var(--smax-grey-300);
  border-radius: 11px;
  padding: 2px 9px;
  font-size: 11px; color: var(--smax-grey-700);
  cursor: pointer;
}
.nick-picker-add:hover { background: var(--smax-grey-50); }
.nick-picker-tools {
  margin-top: 7px;
  display: flex; gap: 7px; align-items: center;
  font-size: 12px;
}
.group-toggle {
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer; color: var(--smax-primary);
  user-select: none;
}
.group-toggle input { margin: 0; cursor: pointer; }
.ml-auto-count {
  margin-left: auto;
  color: var(--smax-grey-700); font-size: 11px;
}

.fr-filters { flex: 1; overflow-y: auto; padding: 6px 0; }
.filter-section-title {
  font-size: 11px; color: var(--smax-grey-700);
  text-transform: uppercase;
  padding: 9px 13px 4px; letter-spacing: 0.5px; font-weight: 600;
}
.filter-row {
  display: flex; align-items: center; gap: 9px;
  padding: 8px 13px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
}
.filter-row:hover { background: var(--smax-grey-50); }
.filter-row.active {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  font-weight: 500;
}
.filter-row .icon { width: 20px; flex-shrink: 0; text-align: center; opacity: 0.8; }
.filter-row .label { flex: 1; }
.filter-row .count {
  font-size: 11px; color: var(--smax-grey-700);
  background: var(--smax-grey-100);
  padding: 1px 7px; border-radius: 9px;
}
.filter-row.active .count { background: white; color: var(--smax-primary); }
.filter-divider {
  height: 1px; background: var(--smax-grey-200);
  margin: 5px 13px;
}
</style>
