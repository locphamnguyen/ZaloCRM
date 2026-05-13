<template>
  <aside class="filter-rail" :class="{ collapsed }">
    <!-- Header: toggle + nick picker compact -->
    <div class="fr-header">
      <button
        class="fr-toggle"
        :title="collapsed ? 'Mở rộng bộ lọc' : 'Thu gọn bộ lọc'"
        @click="toggleCollapsed"
      >
        <v-icon size="18">{{ collapsed ? 'mdi-chevron-double-right' : 'mdi-chevron-double-left' }}</v-icon>
        <span v-if="!collapsed" class="fr-title">Bộ lọc</span>
      </button>

      <!-- Nick picker: compact avatar stack + dropdown -->
      <div v-if="!collapsed" class="nick-picker">
        <div class="nick-picker-label">Nick CRM</div>
        <button class="nick-picker-trigger" @click="showAccountMenu = !showAccountMenu">
          <div v-if="selectedAccounts.length === 0" class="nick-placeholder">
            <v-icon size="14">mdi-account-plus-outline</v-icon>
            Chọn nick
          </div>
          <template v-else>
            <div class="avatar-stack">
              <Avatar
                v-for="(nick, idx) in selectedAccounts.slice(0, 3)"
                :key="nick.id"
                :src="nick.avatarUrl"
                :name="nick.displayName || 'Nick'"
                :size="24"
                :gradient-seed="nick.id"
                platform="zalo"
                :style="{ marginLeft: idx === 0 ? '0' : '-8px', zIndex: 3 - idx }"
                class="stack-avatar"
              />
            </div>
            <span class="nick-count-label">
              {{ selectedAccounts.length === 1
                  ? (selectedAccounts[0].displayName || 'Nick')
                  : `${selectedAccounts.length} nick` }}
              <span v-if="selectedAccounts.length > 3" class="plus-more">+{{ selectedAccounts.length - 3 }}</span>
            </span>
          </template>
          <v-icon size="14" class="ml-auto">mdi-chevron-down</v-icon>
        </button>

        <div class="nick-picker-tools">
          <label class="group-toggle">
            <input type="checkbox" v-model="groupInbox" @change="emitFilters" />
            Gom inbox
          </label>
          <span v-if="selectedAccounts.length > 0" class="clear-nick" @click="clearAllNicks">× Bỏ chọn</span>
        </div>

        <!-- Nick selection dropdown -->
        <v-menu v-model="showAccountMenu" :close-on-content-click="false" location="bottom start">
          <template #activator="{ props: act }">
            <span v-bind="act" />
          </template>
          <v-card min-width="320" max-width="380">
            <div class="picker-toolbar">
              <v-text-field
                v-model="nickSearchQuery"
                placeholder="Tìm nick..."
                variant="plain"
                density="compact"
                hide-details
                prepend-inner-icon="mdi-magnify"
                class="picker-search"
              />
              <button class="picker-action" @click="selectAllNicks">Chọn tất cả</button>
              <button class="picker-action" @click="clearAllNicks">Bỏ chọn</button>
            </div>
            <v-list density="compact" max-height="400">
              <template v-for="group in groupedAccountsBySale" :key="group.saleId || 'no-sale'">
                <v-list-subheader v-if="group.saleId" class="sale-group-header">
                  <v-icon size="14" class="mr-1">mdi-account-tie</v-icon>
                  {{ group.saleName }} ({{ group.nicks.length }})
                </v-list-subheader>
                <v-list-item
                  v-for="acc in group.nicks"
                  :key="acc.id"
                  @click="toggleAccount(acc.id)"
                >
                  <template #prepend>
                    <v-icon size="18" :color="isSelected(acc.id) ? 'primary' : ''">
                      {{ isSelected(acc.id) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                    </v-icon>
                  </template>
                  <div class="picker-item-body">
                    <Avatar :src="acc.avatarUrl" :name="acc.displayName || 'Nick'" :size="22" :gradient-seed="acc.id" platform="zalo" />
                    <span class="picker-item-name">{{ acc.displayName || 'Nick chưa đặt tên' }}</span>
                  </div>
                </v-list-item>
              </template>
              <v-list-item v-if="!filteredAccounts.length" class="text-grey text-center">
                Không tìm thấy nick
              </v-list-item>
            </v-list>
          </v-card>
        </v-menu>
      </div>

      <!-- Collapsed-mode nick avatar stack only -->
      <div v-else-if="selectedAccounts.length" class="nick-collapsed">
        <div class="avatar-stack avatar-stack-vertical" :title="selectedNickNames">
          <Avatar
            v-for="(nick, idx) in selectedAccounts.slice(0, 3)"
            :key="nick.id"
            :src="nick.avatarUrl"
            :name="nick.displayName || 'Nick'"
            :size="28"
            :gradient-seed="nick.id"
            platform="zalo"
            :style="{ marginTop: idx === 0 ? '0' : '-6px' }"
            class="stack-avatar"
          />
          <span v-if="selectedAccounts.length > 3" class="stack-more">+{{ selectedAccounts.length - 3 }}</span>
        </div>
      </div>
    </div>

    <!-- Filter rows body -->
    <div class="fr-filters">
      <!-- Section: Conversation -->
      <div v-if="!collapsed" class="filter-section-title">Hội thoại</div>
      <div
        class="filter-row"
        :class="{ active: threadType === 'group' }"
        :title="collapsed ? `Tin nhắn nhóm${counts?.groups != null ? ' (' + counts.groups + ')' : ''}` : ''"
        @click="setThreadType('group')"
      >
        <span class="icon">👥</span>
        <span class="label">Tin nhắn nhóm</span>
        <span class="count" v-if="!collapsed && counts?.groups != null">{{ counts.groups }}</span>
      </div>
      <div
        class="filter-row"
        :class="{ active: threadType === 'user' }"
        :title="collapsed ? `Tin nhắn user 1-1${counts?.users != null ? ' (' + counts.users + ')' : ''}` : ''"
        @click="setThreadType('user')"
      >
        <span class="icon">👤</span>
        <span class="label">Tin nhắn user (1-1)</span>
        <span class="count" v-if="!collapsed && counts?.users != null">{{ counts.users }}</span>
      </div>

      <div class="filter-divider"></div>

      <!-- Section: Đọc / Trả lời -->
      <div v-if="!collapsed" class="filter-section-title">Đọc / Trả lời</div>
      <div
        class="filter-row"
        :class="{ active: filters.unread }"
        :title="collapsed ? 'Chỉ lọc chưa đọc' : ''"
        @click="toggleFilter('unread')"
      >
        <span class="icon">⊙</span>
        <span class="label">Chỉ chưa đọc</span>
        <div v-if="!collapsed" class="smax-toggle-pill" :class="{ on: filters.unread }"></div>
        <span v-else-if="filters.unread" class="badge-dot" />
      </div>
      <div
        class="filter-row"
        :class="{ active: filters.unreplied }"
        :title="collapsed ? 'Chưa trả lời' : ''"
        @click="toggleFilter('unreplied')"
      >
        <span class="icon">↩</span>
        <span class="label">Chưa trả lời</span>
        <div v-if="!collapsed" class="smax-toggle-pill" :class="{ on: filters.unreplied }"></div>
        <span v-else-if="filters.unreplied" class="badge-dot" />
      </div>
      <div
        class="filter-row"
        :class="{ active: filters.unreadOnTop }"
        :title="collapsed ? 'Chưa đọc lên trên' : ''"
        @click="toggleFilter('unreadOnTop')"
      >
        <span class="icon">⬆</span>
        <span class="label">Chưa đọc lên trên</span>
        <div v-if="!collapsed" class="smax-toggle-pill" :class="{ on: filters.unreadOnTop }"></div>
        <span v-else-if="filters.unreadOnTop" class="badge-dot" />
      </div>

      <div class="filter-divider"></div>

      <!-- Section: KH (Contact level) -->
      <div v-if="!collapsed" class="filter-section-title">Khách hàng</div>

      <!-- Trạng thái KH -->
      <div class="filter-row filter-row-select" :title="collapsed ? 'Trạng thái KH' : ''">
        <span class="icon">🏷</span>
        <template v-if="!collapsed">
          <select v-model="advFilters.statusId" @change="emitFilters" class="rail-select">
            <option value="">Trạng thái KH: tất cả</option>
            <option v-for="s in allStatuses" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </template>
        <span v-else-if="advFilters.statusId" class="badge-dot" />
      </div>

      <!-- Sale phụ trách -->
      <div class="filter-row filter-row-select" :title="collapsed ? 'Sale phụ trách' : ''">
        <span class="icon">👤</span>
        <template v-if="!collapsed">
          <select v-model="advFilters.assignedUserId" @change="emitFilters" class="rail-select">
            <option value="">Sale: tất cả</option>
            <option v-for="u in allUsers" :key="u.id" :value="u.id">{{ u.fullName }}</option>
          </select>
        </template>
        <span v-else-if="advFilters.assignedUserId" class="badge-dot" />
      </div>

      <!-- Có Zalo? -->
      <div class="filter-row filter-row-select" :title="collapsed ? 'Trạng thái Zalo' : ''">
        <span class="icon">💬</span>
        <template v-if="!collapsed">
          <select v-model="advFilters.hasZalo" @change="emitFilters" class="rail-select">
            <option value="">Zalo: tất cả</option>
            <option value="true">✓ Có Zalo</option>
            <option value="false">✗ Không có</option>
            <option value="unknown">? Chưa tra</option>
          </select>
        </template>
        <span v-else-if="advFilters.hasZalo" class="badge-dot" />
      </div>

      <!-- KB Zalo per-pair -->
      <div class="filter-row filter-row-select" :title="collapsed ? 'Trạng thái KB Zalo' : ''">
        <span class="icon">🤝</span>
        <template v-if="!collapsed">
          <select v-model="advFilters.relationshipKindAny" @change="emitFilters" class="rail-select">
            <option value="">KB Zalo: tất cả</option>
            <option value="friend">✓ Đã KB</option>
            <option value="pending_friend">… Đang mời</option>
            <option value="chatting_stranger">💬 Chat lạ</option>
            <option value="ghost">🚫 Ngắt</option>
          </select>
        </template>
        <span v-else-if="advFilters.relationshipKindAny" class="badge-dot" />
      </div>

      <!-- Lead score range -->
      <div class="filter-row filter-row-range" :title="collapsed ? 'Lead score range' : ''">
        <span class="icon">⭐</span>
        <template v-if="!collapsed">
          <input type="number" v-model.number="advFilters.scoreMin" placeholder="Min" min="0" max="100" class="rail-score" @change="emitFilters" />
          <span class="dash">—</span>
          <input type="number" v-model.number="advFilters.scoreMax" placeholder="Max" min="0" max="100" class="rail-score" @change="emitFilters" />
        </template>
        <span v-else-if="advFilters.scoreMin != null || advFilters.scoreMax != null" class="badge-dot" />
      </div>

      <!-- Tags multi -->
      <div class="filter-row filter-row-select" :title="collapsed ? 'Tag CRM' : ''">
        <span class="icon">#</span>
        <template v-if="!collapsed">
          <select v-model="advFilters.tags" @change="emitFilters" class="rail-select">
            <option value="">Tag CRM: tất cả</option>
            <option v-for="t in commonTags" :key="t" :value="t">{{ t }}</option>
          </select>
        </template>
        <span v-else-if="advFilters.tags" class="badge-dot" />
      </div>

      <!-- Date range -->
      <div class="filter-row filter-row-range" :title="collapsed ? 'Tin nhắn cuối: khoảng thời gian' : ''">
        <span class="icon">📅</span>
        <template v-if="!collapsed">
          <input type="date" v-model="advFilters.dateFrom" class="rail-date" @change="emitFilters" />
          <input type="date" v-model="advFilters.dateTo" class="rail-date" @change="emitFilters" />
        </template>
        <span v-else-if="advFilters.dateFrom || advFilters.dateTo" class="badge-dot" />
      </div>

      <div v-if="!collapsed && hasAnyFilter" class="filter-divider"></div>
      <button v-if="!collapsed && hasAnyFilter" class="clear-all-btn" @click="clearAllFilters">
        × Xoá tất cả bộ lọc
      </button>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch, onMounted } from 'vue';
import Avatar from '@/components/ui/Avatar.vue';
import { api } from '@/api';

interface ZaloAccountLite {
  id: string;
  displayName: string | null;
  avatarUrl?: string | null;
  ownerUserId?: string;
}

const props = defineProps<{
  accounts: ZaloAccountLite[];
  selectedAccountIds: string[];
  counts?: { groups?: number; users?: number };
}>();
const emit = defineEmits<{
  'update:accounts': [ids: string[]];
  'update:filters': [filters: Record<string, string>];
}>();

// ── Collapse state (persist localStorage) ────────────────────────────────
const LS_KEY_COLLAPSED = 'filterRail.collapsed.v1';
const collapsed = ref<boolean>(localStorage.getItem(LS_KEY_COLLAPSED) === '1');
function toggleCollapsed() {
  collapsed.value = !collapsed.value;
  try { localStorage.setItem(LS_KEY_COLLAPSED, collapsed.value ? '1' : '0'); } catch { /* ignore */ }
}

// ── Nick picker ───────────────────────────────────────────────────────────
const allAccounts = computed(() => props.accounts || []);
const selectedAccounts = computed(() =>
  allAccounts.value.filter(a => props.selectedAccountIds.includes(a.id)),
);
const selectedNickNames = computed(() =>
  selectedAccounts.value.map(n => n.displayName || 'Nick').join(', '),
);

const showAccountMenu = ref(false);
const nickSearchQuery = ref('');
const filteredAccounts = computed(() => {
  const q = nickSearchQuery.value.trim().toLowerCase();
  if (!q) return allAccounts.value;
  return allAccounts.value.filter(a => (a.displayName || '').toLowerCase().includes(q));
});
// Group nicks by sale owner cho UX rõ ràng team đa sale.
// Resolve owner name từ allUsers loaded (ownerUserId → fullName).
const userById = computed(() => {
  const m = new Map<string, string>();
  for (const u of allUsers.value) m.set(u.id, u.fullName);
  return m;
});
const groupedAccountsBySale = computed(() => {
  const groups = new Map<string, { saleId: string | null; saleName: string; nicks: ZaloAccountLite[] }>();
  for (const acc of filteredAccounts.value) {
    const saleId = acc.ownerUserId || null;
    const saleName = saleId ? (userById.value.get(saleId) || `Sale ${saleId.slice(0, 4)}`) : '(chưa gán sale)';
    const key = saleId || '__no_sale__';
    if (!groups.has(key)) groups.set(key, { saleId, saleName, nicks: [] });
    groups.get(key)!.nicks.push(acc);
  }
  return [...groups.values()].sort((a, b) => a.saleName.localeCompare(b.saleName));
});

function isSelected(id: string) { return props.selectedAccountIds.includes(id); }
function toggleAccount(id: string) {
  const next = isSelected(id)
    ? props.selectedAccountIds.filter(x => x !== id)
    : [...props.selectedAccountIds, id];
  emit('update:accounts', next);
}
function selectAllNicks() {
  emit('update:accounts', allAccounts.value.map(a => a.id));
}
function clearAllNicks() {
  emit('update:accounts', []);
}

// ── Filter state ──────────────────────────────────────────────────────────
const groupInbox = ref(true);
const threadType = ref<'all' | 'user' | 'group'>('all');
const filters = reactive({
  unread: false,
  unreplied: false,
  unreadOnTop: true,
});
const advFilters = reactive({
  statusId: '',
  assignedUserId: '',
  hasZalo: '' as '' | 'true' | 'false' | 'unknown',
  relationshipKindAny: '',
  scoreMin: null as number | null,
  scoreMax: null as number | null,
  tags: '',
  dateFrom: '',
  dateTo: '',
});

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
  if (advFilters.statusId) out.statusId = advFilters.statusId;
  if (advFilters.assignedUserId) out.assignedUserId = advFilters.assignedUserId;
  if (advFilters.hasZalo) out.hasZalo = advFilters.hasZalo;
  if (advFilters.relationshipKindAny) out.relationshipKindAny = advFilters.relationshipKindAny;
  if (advFilters.scoreMin != null) out.scoreMin = String(advFilters.scoreMin);
  if (advFilters.scoreMax != null) out.scoreMax = String(advFilters.scoreMax);
  if (advFilters.tags) out.tags = advFilters.tags;
  if (advFilters.dateFrom) out.dateFrom = advFilters.dateFrom;
  if (advFilters.dateTo) out.dateTo = advFilters.dateTo;
  emit('update:filters', out);
}

const hasAnyFilter = computed(() => Boolean(
  filters.unread || filters.unreplied || threadType.value !== 'all'
  || advFilters.statusId || advFilters.assignedUserId || advFilters.hasZalo
  || advFilters.relationshipKindAny || advFilters.scoreMin != null
  || advFilters.scoreMax != null || advFilters.tags
  || advFilters.dateFrom || advFilters.dateTo,
));
function clearAllFilters() {
  filters.unread = false;
  filters.unreplied = false;
  threadType.value = 'all';
  advFilters.statusId = '';
  advFilters.assignedUserId = '';
  advFilters.hasZalo = '';
  advFilters.relationshipKindAny = '';
  advFilters.scoreMin = null;
  advFilters.scoreMax = null;
  advFilters.tags = '';
  advFilters.dateFrom = '';
  advFilters.dateTo = '';
  emitFilters();
}

// ── Static data: Status + Users + Common tags ────────────────────────────
interface StatusLite { id: string; name: string }
interface UserLite { id: string; fullName: string }
const allStatuses = ref<StatusLite[]>([]);
const allUsers = ref<UserLite[]>([]);
const commonTags = ref<string[]>([]);

async function loadStatuses() {
  try {
    const res = await api.get<{ statuses: StatusLite[] }>('/settings/statuses');
    allStatuses.value = res.data?.statuses || [];
  } catch { /* non-critical */ }
}
async function loadUsers() {
  try {
    const res = await api.get<{ users?: UserLite[] }>('/users');
    allUsers.value = res.data?.users || [];
  } catch { /* non-critical */ }
}
async function loadCommonTags() {
  // Lấy distinct tag từ contacts đã load (fallback simple). Backend chưa có endpoint riêng.
  commonTags.value = ['warm-lead', 'cold-lead', 'hot-lead', 'vip', 'quan_tam', 'đầu_tư', 'cần_báo_giá'];
}
onMounted(() => {
  loadStatuses(); loadUsers(); loadCommonTags();
});

watch(() => filters.unreadOnTop, () => { /* triggers via toggleFilter */ });
</script>

<style scoped>
.filter-rail {
  background: var(--smax-bg);
  border-right: 1px solid var(--smax-grey-200);
  display: flex; flex-direction: column;
  overflow: hidden;
  height: 100%;
  transition: width 0.18s ease;
}
/* Width controlled bởi parent grid (ChatView) — collapsed mode signal qua class */
.filter-rail.collapsed { /* parent grid sẽ set width 56px qua media query khác */ }

/* Header */
.fr-header {
  padding: 8px 9px;
  border-bottom: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
}
.fr-toggle {
  width: 100%;
  display: flex; align-items: center; gap: 7px;
  padding: 6px 8px;
  background: transparent; border: none;
  cursor: pointer; font-family: inherit;
  color: var(--smax-grey-700);
  border-radius: 6px;
  margin-bottom: 7px;
}
.fr-toggle:hover { background: var(--smax-grey-100); color: var(--smax-primary); }
.collapsed .fr-toggle { justify-content: center; padding: 6px 4px; }
.fr-title { font-size: 14px; font-weight: 600; }

/* Nick picker (expanded mode) */
.nick-picker {
  background: var(--smax-bg);
  border: 1.5px solid var(--smax-primary-soft);
  border-radius: 7px;
  padding: 7px 9px;
}
.nick-picker-label {
  font-size: 10.5px; color: var(--smax-grey-700);
  text-transform: uppercase;
  margin-bottom: 5px; letter-spacing: 0.3px; font-weight: 600;
}
.nick-picker-trigger {
  width: 100%;
  display: flex; align-items: center; gap: 8px;
  padding: 5px 8px;
  background: var(--smax-grey-50);
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  cursor: pointer; font-family: inherit;
  text-align: left;
  color: var(--smax-text); font-size: 12.5px;
  min-height: 38px;
}
.nick-picker-trigger:hover { border-color: var(--smax-primary); background: var(--smax-bg); }
.nick-placeholder {
  display: flex; align-items: center; gap: 6px;
  color: var(--smax-grey-700);
}
.avatar-stack {
  display: inline-flex; align-items: center;
}
.stack-avatar {
  border: 2px solid var(--smax-bg);
  border-radius: 50%;
  flex-shrink: 0;
}
.nick-count-label {
  font-weight: 500; color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}
.plus-more {
  font-size: 11px; color: var(--smax-grey-700);
  background: var(--smax-grey-100);
  padding: 1px 5px; border-radius: 7px;
  margin-left: 4px;
}
.ml-auto { margin-left: auto; }

.nick-picker-tools {
  margin-top: 7px;
  display: flex; gap: 8px; align-items: center;
  font-size: 11.5px;
}
.group-toggle {
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer; color: var(--smax-primary);
  user-select: none;
}
.group-toggle input { margin: 0; cursor: pointer; }
.clear-nick {
  margin-left: auto;
  color: var(--smax-grey-700); cursor: pointer; font-size: 11px;
}
.clear-nick:hover { color: var(--smax-error); }

/* Nick collapsed mode — vertical avatar stack */
.nick-collapsed {
  display: flex; justify-content: center;
  padding: 4px 0;
}
.avatar-stack-vertical {
  flex-direction: column; align-items: center;
}
.stack-more {
  font-size: 10px; font-weight: 700;
  color: var(--smax-grey-700);
  background: var(--smax-grey-100);
  padding: 1px 4px; border-radius: 7px;
  margin-top: 2px;
}

/* Dropdown picker */
.picker-toolbar {
  display: flex; gap: 4px; align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
}
.picker-search { flex: 1; font-size: 12px; }
.picker-action {
  padding: 3px 8px;
  font-size: 11px; font-weight: 500;
  border: 1px solid var(--smax-grey-300);
  border-radius: 5px; background: var(--smax-bg);
  color: var(--smax-grey-700); cursor: pointer;
}
.picker-action:hover { color: var(--smax-primary); border-color: var(--smax-primary); }
.sale-group-header {
  font-size: 11px !important; font-weight: 600;
  color: var(--smax-grey-700);
  min-height: 26px !important;
  background: var(--smax-grey-50);
}
.picker-item-body {
  display: flex; align-items: center; gap: 8px;
}
.picker-item-name {
  font-size: 13px; color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis;
}

/* Filter rows */
.fr-filters { flex: 1; overflow-y: auto; padding: 6px 0; }
.filter-section-title {
  font-size: 10.5px; color: var(--smax-grey-700);
  text-transform: uppercase;
  padding: 9px 13px 4px; letter-spacing: 0.5px; font-weight: 600;
}
.filter-row {
  display: flex; align-items: center; gap: 9px;
  padding: 7px 13px;
  cursor: pointer;
  font-size: 13px;
  user-select: none;
  position: relative;
}
.filter-row:hover { background: var(--smax-grey-50); }
.filter-row.active {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  font-weight: 500;
}
.filter-row .icon {
  width: 22px; flex-shrink: 0; text-align: center; opacity: 0.8;
  font-size: 14px;
}
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

/* Select/input inside filter row */
.filter-row-select, .filter-row-range {
  padding: 5px 13px;
}
.rail-select {
  flex: 1; min-width: 0;
  padding: 4px 6px;
  font-size: 12px;
  border: 1px solid var(--smax-grey-200);
  border-radius: 5px;
  background: var(--smax-bg);
  font-family: inherit;
  cursor: pointer;
}
.rail-select:focus { outline: none; border-color: var(--smax-primary); }
.rail-score {
  width: 50px; padding: 3px 5px;
  font-size: 12px; text-align: center;
  border: 1px solid var(--smax-grey-200);
  border-radius: 5px; font-family: inherit;
}
.rail-date {
  flex: 1; min-width: 0;
  padding: 3px 5px;
  font-size: 11px;
  border: 1px solid var(--smax-grey-200);
  border-radius: 5px; font-family: inherit;
}
.dash { color: var(--smax-grey-700); }

/* Active filter badge dot (collapsed mode visual) */
.badge-dot {
  position: absolute; top: 6px; right: 6px;
  width: 7px; height: 7px;
  background: var(--smax-error, #ff3d00);
  border-radius: 50%;
  border: 1.5px solid var(--smax-bg);
}

/* Collapsed mode styling */
.collapsed .fr-filters { padding: 4px 0; }
.collapsed .filter-row {
  justify-content: center;
  padding: 9px 4px;
}
.collapsed .filter-row .label,
.collapsed .filter-row .count,
.collapsed .filter-row .smax-toggle-pill,
.collapsed .filter-section-title {
  display: none;
}
.collapsed .filter-row .icon { width: 24px; font-size: 16px; opacity: 1; }
.collapsed .filter-divider { margin: 4px 8px; }

/* Toggle pill (toggle filter visual) */
.smax-toggle-pill {
  width: 26px; height: 14px;
  border-radius: 8px;
  background: var(--smax-grey-300);
  position: relative;
  transition: background 0.15s;
  cursor: pointer;
  flex-shrink: 0;
}
.smax-toggle-pill::after {
  content: '';
  position: absolute;
  width: 10px; height: 10px;
  border-radius: 50%;
  background: white;
  top: 2px; left: 2px;
  transition: left 0.15s;
}
.smax-toggle-pill.on { background: var(--smax-primary); }
.smax-toggle-pill.on::after { left: 14px; }

.clear-all-btn {
  margin: 8px 13px;
  padding: 7px 11px;
  background: transparent;
  border: 1px dashed var(--smax-grey-300);
  border-radius: 6px;
  color: var(--smax-grey-700);
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.clear-all-btn:hover { color: var(--smax-error); border-color: var(--smax-error); }
</style>
