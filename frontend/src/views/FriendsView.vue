<template>
  <div class="smax-friends-page">
    <!-- ════════ Page header ════════ -->
    <header class="page-header">
      <h1>Bạn bè</h1>
      <div class="subtitle">
        Mỗi row = 1 cặp <strong>(nick × KH)</strong> đã sinh UID. Quản lý
        <strong>Đã KB</strong>, <strong>Đã gửi mời</strong>, <strong>Đang nhắn (lạ)</strong> per-nick.
      </div>
    </header>

    <!-- ════════ Filter bar ════════ -->
    <div class="filter-bar">
      <!-- Row 1: search + nick + care + date + actions -->
      <div class="filter-row-1">
        <input
          v-model="search"
          class="search-input"
          placeholder="Tìm tên KH / SĐT / tên nick…"
          @input="debouncedFetch"
        />

        <button class="nick-single" @click="cycleNick" :disabled="!accounts.length" title="Click để đổi nick">
          <span class="ns-label">NICK</span>
          <span class="ns-avatar">{{ nickAvatar }}</span>
          <span class="ns-name">{{ activeAccount?.displayName || 'Chọn nick' }}</span>
          <span v-if="friendsDbTotal" class="ns-count">{{ friendsDbTotal }} bạn</span>
          <span class="ns-arrow">▾</span>
        </button>

        <select v-model="careStatus" @change="fetch">
          <option value="">Tất cả trạng thái KH</option>
          <option value="interested">💬 Quan tâm</option>
          <option value="caring">🤝 Chăm sóc</option>
          <option value="negotiating">⚡ Đàm phán</option>
          <option value="hot">🔥 Nóng</option>
          <option value="cold">❄ Lạnh</option>
          <option value="won">✅ Đã chốt</option>
        </select>

        <input type="date" v-model="dateFrom" class="date-input" />
        <span class="date-separator">→</span>
        <input type="date" v-model="dateTo" class="date-input" />

        <span class="spacer"></span>
        <button class="btn">⚙ Cột</button>
        <button class="btn">⬇ Xuất CSV</button>
        <button
          v-if="activeAccount"
          class="btn btn-primary"
          :disabled="syncing"
          @click="onSync"
        >
          {{ syncing ? '↻ Đang đồng bộ…' : '↻ Đồng bộ Zalo' }}
        </button>
      </div>

      <!-- Row 2: kind tabs -->
      <div class="kind-tabs">
        <button
          v-for="t in KIND_TABS"
          :key="t.value"
          class="kind-tab"
          :class="{ active: kindTab === t.value }"
          @click="kindTab = t.value; fetch()"
        >
          <span v-if="t.dotColor" class="badge-dot" :style="`background:${t.dotColor}`"></span>
          {{ t.label }}
          <span class="count">{{ kindCount(t.value) }}</span>
        </button>
      </div>

      <!-- Row 3: label chip filter -->
      <div class="label-chip-row">
        <span class="label-text">Tag CRM:</span>
        <span
          v-for="lbl in CRM_LABEL_CHIPS"
          :key="lbl.text"
          class="smax-label-chip"
          :class="{ active: activeChips.includes(lbl.text) }"
          :data-color="lbl.color"
          @click="toggleChip(lbl.text)"
        >{{ lbl.text }}</span>
      </div>
    </div>

    <!-- ════════ Stats row ════════ -->
    <div class="stats-row">
      <div class="stat-box">📋 Tổng pair: <span class="stat-num">{{ friendsDbTotal }}</span></div>
      <div class="stat-box">🟢 Đã KB: <span class="stat-num">{{ kindCount('friend') }}</span></div>
      <div class="stat-box">🟡 Đang chờ: <span class="stat-num">{{ kindCount('pending_friend') }}</span></div>
      <div class="stat-box">🔵 Đang nhắn lạ: <span class="stat-num">{{ kindCount('chatting_stranger') }}</span></div>
      <div class="stat-box">⚪ Đã ngắt: <span class="stat-num">{{ kindCount('ghost') }}</span></div>
    </div>

    <!-- ════════ Empty state ════════ -->
    <div v-if="!activeAccount" class="empty-page">
      Chọn 1 nick Zalo phía trên để xem danh sách bạn bè per-pair.
    </div>

    <!-- ════════ Table ════════ -->
    <div v-else class="scroll-wrap">
      <table class="smax-table">
        <thead>
          <tr>
            <th>Khách hàng</th>
            <th>Nick Zalo (Sale)</th>
            <th>Tên CRM / Nick (KH)</th>
            <th>Tên Zalo + UID</th>
            <th>Trạng thái KB</th>
            <th>Trạng thái KH</th>
            <th>Nhãn CRM</th>
            <th>Label Zalo</th>
            <th>KH nhắn cuối</th>
            <th>Sale nhắn cuối</th>
            <th>Tin (in/out)</th>
            <th>Là bạn từ</th>
            <th class="w-180">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="f in friendsDb" :key="f.id">
            <!-- KH cell -->
            <td>
              <div class="kh-cell">
                <div class="avatar avatar-customer" :class="{ 'is-female': f.contact?.gender === 'female' }">
                  {{ initials(f.contact) }}
                </div>
                <div class="three-line">
                  <span class="line1">{{ f.contact?.crmName || f.contact?.fullName || '—' }}</span>
                  <span class="line2">
                    {{ f.contact?.phone || '—' }}
                    <template v-if="f.contact?.gender">· {{ genderLabel(f.contact.gender) }}</template>
                    <template v-if="ageOf(f.contact)">· {{ ageOf(f.contact) }}t</template>
                  </span>
                  <span v-if="f.contact?.fullName" class="line3">{{ f.contact.fullName }}</span>
                </div>
              </div>
            </td>

            <!-- Nick cell -->
            <td>
              <div class="nick-cell">
                <div class="avatar avatar-nick">{{ nickShort(f.zaloAccount?.displayName) }}</div>
                <div class="two-line">
                  <span class="line1">{{ f.zaloAccount?.displayName || '—' }}</span>
                  <span class="line2">{{ f.zaloAccount?.phone || '—' }}</span>
                </div>
              </div>
            </td>

            <!-- Tên CRM / Nick KH -->
            <td>
              <div class="two-line">
                <span class="line1" :class="{ empty: !f.aliasInNick }">
                  {{ f.aliasInNick || '— chưa đặt alias —' }}
                </span>
                <span class="line2">{{ f.aliasInNick ? 'alias do nick đặt' : 'dùng tên Zalo' }}</span>
              </div>
            </td>

            <!-- Tên Zalo thật + UID -->
            <td>
              <div class="two-line">
                <span class="line1">{{ f.contact?.fullName || '—' }}</span>
                <span class="uid">{{ f.zaloUidInNick }}</span>
              </div>
            </td>

            <!-- Trạng thái KB -->
            <td>
              <span class="badge-dot" :style="`background:${kindDotColor(f.relationshipKind)}`"></span>
              <span :class="['chip', kindChipClass(f.relationshipKind)]">
                {{ kindLabel(f.relationshipKind) }}
              </span>
            </td>

            <!-- Trạng thái KH -->
            <td>
              <span v-if="f.contact?.status" :class="['chip', statusChipClass(f.contact.status)]">
                {{ statusLabel(f.contact.status) }}
              </span>
              <span v-else class="empty">—</span>
            </td>

            <!-- Nhãn CRM -->
            <td>
              <div class="tag-cell">
                <span v-for="tag in (f.contact?.tags || []).slice(0, 2)" :key="tag" class="chip chip-info">{{ tag }}</span>
                <span v-if="(f.contact?.tags || []).length > 2" class="chip chip-grey">
                  +{{ f.contact!.tags.length - 2 }}
                </span>
                <span v-if="!f.contact?.tags?.length" class="empty">—</span>
              </div>
            </td>

            <!-- Label Zalo -->
            <td>
              <div class="tag-cell">
                <span v-for="lbl in (f.zaloLabels || []).slice(0, 2)" :key="lbl.id || lbl.name" class="chip chip-orange-soft">
                  {{ lbl.name }}
                </span>
                <span v-if="!f.zaloLabels?.length" class="empty">—</span>
              </div>
            </td>

            <!-- KH nhắn cuối -->
            <td>
              <template v-if="f.lastInboundAt">
                <div class="cell-strong">{{ formatRecentDateTime(f.lastInboundAt) }}</div>
              </template>
              <span v-else class="empty">—</span>
            </td>

            <!-- Sale nhắn cuối -->
            <td>
              <template v-if="f.lastOutboundAt">
                <div class="cell-strong">{{ formatRecentDateTime(f.lastOutboundAt) }}</div>
              </template>
              <span v-else class="empty">—</span>
            </td>

            <!-- Tin in/out -->
            <td><strong>{{ f.totalInbound }}</strong> / {{ f.totalOutbound }}</td>

            <!-- Là bạn từ -->
            <td>
              <span v-if="f.becameFriendAt" class="text-grey">{{ relativeDate(f.becameFriendAt) }}</span>
              <span v-else class="empty">—</span>
            </td>

            <!-- Action -->
            <td>
              <div class="action-cell">
                <button class="row-action-btn" @click="goChat(f)" title="Mở chat">💬</button>
                <button
                  v-if="f.relationshipKind === 'pending_friend'"
                  class="row-action-btn"
                  @click="onCancelInvite(f)"
                  title="Hủy mời"
                >↻ Hủy</button>
                <button
                  v-else-if="f.relationshipKind === 'chatting_stranger'"
                  class="row-action-btn"
                  @click="onSendInvite(f)"
                  title="Gửi mời KB"
                >+ KB</button>
                <button class="row-action-btn" @click="onAutomation(f)" title="Automation">⚡</button>
              </div>
            </td>
          </tr>

          <tr v-if="!loadingDb && !friendsDb.length">
            <td colspan="13" class="empty-state">
              {{ activeAccount ? 'Chưa có pair nào.' : 'Chọn 1 nick Zalo để xem.' }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="activeAccount" class="pagination">
      <button class="btn" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">← Trước</button>
      <span class="page-info">Trang {{ pagination.page }} / {{ totalPages }}</span>
      <button class="btn" :disabled="pagination.page >= totalPages" @click="changePage(pagination.page + 1)">Sau →</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useFriends, type DbFriend } from '@/composables/use-friends';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import {
  STATUS_OPTIONS, GENDER_OPTIONS,
  formatRecentDateTime,
} from '@/composables/use-contacts';

const router = useRouter();
const { accounts, fetchAccounts } = useZaloAccounts();
const {
  friendsDb, friendsDbTotal, friendCounts, loadingDb, syncing,
  fetchFriendsDb, syncFriendsDb,
} = useFriends();

const search = ref('');
const careStatus = ref('');
const dateFrom = ref('');
const dateTo = ref('');
const kindTab = ref<'all' | 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost'>('all');
const activeChips = ref<string[]>([]);
const selectedAccountId = ref<string | null>(null);
const pagination = reactive({ page: 1, limit: 25 });

const KIND_TABS = [
  { value: 'all',                label: 'Tất cả',        dotColor: '' },
  { value: 'friend',             label: 'Đã kết bạn',     dotColor: 'var(--smax-success)' },
  { value: 'pending_friend',     label: 'Đã gửi mời',     dotColor: 'var(--smax-warning)' },
  { value: 'chatting_stranger',  label: 'Đang nhắn (lạ)', dotColor: 'var(--smax-info)' },
  { value: 'ghost',              label: 'Đã ngắt',        dotColor: '#9e9e9e' },
] as const;

const CRM_LABEL_CHIPS = [
  { text: 'TTAVIO',        color: 'red' },
  { text: 'EGD',           color: 'purple' },
  { text: 'Phiền',         color: 'orange' },
  { text: 'Ấm',            color: 'yellow' },
  { text: 'Nóng',          color: 'red' },
  { text: 'Có tương tác',  color: 'green' },
  { text: 'Lạnh',          color: 'blue' },
  { text: 'Đàm phán',      color: 'green' },
];

const activeAccount = computed(() =>
  accounts.value.find(a => a.id === selectedAccountId.value) || null,
);
const nickAvatar = computed(() => {
  const i = accounts.value.findIndex(a => a.id === selectedAccountId.value);
  return i >= 0 ? `N${i + 1}` : '?';
});
const totalPages = computed(() => Math.max(1, Math.ceil(friendsDbTotal.value / pagination.limit)));

function kindCount(kind: string): number {
  if (kind === 'all') return friendsDbTotal.value;
  return friendCounts.value[kind] || 0;
}

let searchTimeout: ReturnType<typeof setTimeout>;
function debouncedFetch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => { pagination.page = 1; fetch(); }, 300);
}

async function fetch() {
  if (!selectedAccountId.value) return;
  await fetchFriendsDb(selectedAccountId.value, {
    kind: kindTab.value === 'all' ? undefined : kindTab.value,
    page: pagination.page,
    limit: pagination.limit,
    search: search.value || undefined,
  });
}
function changePage(p: number) {
  pagination.page = p;
  fetch();
}

function cycleNick() {
  if (!accounts.value.length) return;
  const idx = accounts.value.findIndex(a => a.id === selectedAccountId.value);
  const next = accounts.value[(idx + 1) % accounts.value.length];
  selectedAccountId.value = next.id;
  pagination.page = 1;
  fetch();
}
function toggleChip(name: string) {
  activeChips.value = activeChips.value.includes(name)
    ? activeChips.value.filter(x => x !== name)
    : [...activeChips.value, name];
  // TODO: filter friendsDb client-side or send to API when supported
}

async function onSync() {
  if (!selectedAccountId.value) return;
  await syncFriendsDb(selectedAccountId.value);
  await fetch();
}

// Per-row actions
function goChat(f: DbFriend) {
  if (f.contact?.id) router.push({ path: '/chat', query: { contactId: f.contact.id } });
}
function onSendInvite(_f: DbFriend) { /* TODO: call /friends/requests endpoint */ }
function onCancelInvite(_f: DbFriend) { /* TODO: call DELETE /friends/requests/:userId */ }
function onAutomation(_f: DbFriend) { /* TODO: open automation dialog */ }

// Formatters
function initials(c?: { fullName: string | null; crmName: string | null } | null) {
  const name = c?.crmName || c?.fullName || '?';
  return (name.trim().split(/\s+/).pop()?.[0] || '?').toUpperCase();
}
function nickShort(name: string | null | undefined) {
  if (!name) return 'N';
  return name.split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
}
function genderLabel(value: string) {
  return GENDER_OPTIONS.find(o => o.value === value)?.text ?? value;
}
function statusLabel(value: string) {
  return STATUS_OPTIONS.find(o => o.value === value)?.text ?? value;
}
function kindLabel(kind: DbFriend['relationshipKind']): string {
  const map: Record<DbFriend['relationshipKind'], string> = {
    friend: 'Đã KB',
    pending_friend: 'Đã gửi mời',
    chatting_stranger: 'Đang nhắn (lạ)',
    ghost: 'Đã ngắt',
    none: '—',
  };
  return map[kind];
}
function kindDotColor(kind: DbFriend['relationshipKind']): string {
  const map: Record<DbFriend['relationshipKind'], string> = {
    friend: 'var(--smax-success)',
    pending_friend: 'var(--smax-warning)',
    chatting_stranger: 'var(--smax-info)',
    ghost: '#9e9e9e',
    none: 'var(--smax-grey-300)',
  };
  return map[kind];
}
function kindChipClass(kind: DbFriend['relationshipKind']): string {
  const map: Record<DbFriend['relationshipKind'], string> = {
    friend: 'chip-success',
    pending_friend: 'chip-warning',
    chatting_stranger: 'chip-info',
    ghost: 'chip-grey',
    none: 'chip-grey',
  };
  return map[kind];
}
function statusChipClass(status: string): string {
  const map: Record<string, string> = {
    new: 'chip-grey',
    contacted: 'chip-info',
    interested: 'chip-warning',
    converted: 'chip-success',
    lost: 'chip-error',
  };
  return map[status] || 'chip-grey';
}
function ageOf(c?: { birthYear: number | null } | null): number | null {
  if (!c?.birthYear) return null;
  return new Date().getFullYear() - c.birthYear;
}
function relativeDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  if (days < 30) return `${days}d trước`;
  return `${Math.floor(days / 30)}m trước`;
}

onMounted(async () => {
  await fetchAccounts();
  if (accounts.value.length) {
    selectedAccountId.value = accounts.value[0].id;
    fetch();
  }
});
</script>

<style scoped>
.smax-friends-page {
  padding: 13px 18px 26px;
  background: var(--smax-grey-100);
  min-height: 100%;
}

.page-header h1 {
  margin: 0 0 5px;
  font-size: 20px; font-weight: 600;
}
.subtitle {
  color: var(--smax-grey-700);
  margin-bottom: 11px;
  font-size: 13px;
}

/* ════════ Filter bar ════════ */
.filter-bar {
  background: var(--smax-bg);
  border-radius: 7px;
  padding: 11px 13px;
  margin-bottom: 9px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.filter-row-1 {
  display: flex; align-items: center; gap: 7px;
  flex-wrap: wrap;
  margin-bottom: 9px;
}
.filter-row-1 > * { font-family: inherit; font-size: 13px; }
.search-input {
  flex: 1; min-width: 220px;
  padding: 7px 11px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
}
.search-input:focus { outline: none; border-color: var(--smax-primary); }
.filter-row-1 select,
.date-input {
  padding: 7px 11px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
}
.date-input { max-width: 140px; }
.date-separator { color: var(--smax-grey-700); font-size: 12px; }

.nick-single {
  background: var(--smax-bg);
  border: 1.5px solid var(--smax-primary);
  border-radius: 6px;
  padding: 5px 11px 5px 9px;
  display: flex; align-items: center; gap: 7px;
  min-width: 240px;
  cursor: pointer;
  color: var(--smax-primary);
}
.nick-single:hover { background: var(--smax-primary-soft); }
.nick-single:disabled { opacity: 0.5; cursor: not-allowed; }
.ns-label {
  font-size: 10px;
  color: var(--smax-grey-700);
  text-transform: uppercase; letter-spacing: 0.4px;
  font-weight: 600;
}
.ns-avatar {
  width: 22px; height: 22px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffb74d, #f57c00);
  color: white; font-size: 10px; font-weight: 600;
  display: inline-flex; align-items: center; justify-content: center;
}
.ns-name { flex: 1; font-weight: 600; color: var(--smax-text); }
.ns-count {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  padding: 1px 7px; border-radius: 9px;
  font-size: 11px;
}
.ns-arrow { font-size: 11px; color: var(--smax-grey-700); }

.spacer { flex: 1; }
.btn {
  padding: 7px 13px;
  border: 1px solid var(--smax-primary);
  background: var(--smax-bg);
  color: var(--smax-primary);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 13px;
}
.btn:hover { background: var(--smax-primary-soft); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-primary { background: var(--smax-primary); color: white; }
.btn-primary:hover:not(:disabled) { background: var(--smax-primary-hover); }

/* Kind tabs */
.kind-tabs {
  display: flex; gap: 3px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.kind-tab {
  background: transparent; border: none;
  padding: 8px 13px;
  cursor: pointer;
  font-size: 13px; font-weight: 500;
  color: var(--smax-grey-700);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: inline-flex; align-items: center; gap: 5px;
  font-family: inherit;
}
.kind-tab:hover { color: var(--smax-primary); }
.kind-tab.active {
  color: var(--smax-primary);
  border-bottom-color: var(--smax-primary);
}
.kind-tab .count {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  padding: 1px 7px; border-radius: 9px;
  font-size: 11px;
}
.kind-tab.active .count {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
}
.badge-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
}

/* Label chips */
.label-chip-row {
  display: flex; gap: 5px; flex-wrap: wrap;
  margin-top: 9px;
  align-items: center;
}
.label-text {
  font-size: 11px; color: var(--smax-grey-700);
  text-transform: uppercase; letter-spacing: 0.4px;
  font-weight: 600;
}

/* ════════ Stats ════════ */
.stats-row {
  display: flex; gap: 11px; flex-wrap: wrap;
  background: var(--smax-bg);
  padding: 9px 13px;
  border-radius: 7px;
  margin-bottom: 9px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.stat-box { display: flex; align-items: center; gap: 5px; font-size: 13px; }
.stat-num { font-weight: 600; color: var(--smax-primary); margin-left: 3px; }

.empty-page {
  background: var(--smax-bg);
  border-radius: 7px;
  padding: 60px 20px;
  text-align: center;
  color: var(--smax-grey-700);
  font-style: italic;
}

/* ════════ Table ════════ */
.scroll-wrap {
  background: var(--smax-bg);
  border-radius: 7px;
  overflow-x: auto;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.smax-table {
  width: 100%; border-collapse: collapse;
  font-size: 12.5px;
  min-width: 1500px;
}
.smax-table thead th {
  background: var(--smax-grey-50);
  border-bottom: 1px solid var(--smax-grey-200);
  padding: 9px 11px;
  text-align: left;
  font-weight: 600;
  color: var(--smax-grey-700);
  white-space: nowrap;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.smax-table tbody tr { border-bottom: 1px solid var(--smax-grey-100); }
.smax-table tbody tr:hover { background: var(--smax-grey-50); }
.smax-table td { padding: 9px 11px; vertical-align: top; }
.w-180 { width: 180px; }

.kh-cell, .nick-cell {
  display: flex; align-items: center; gap: 7px;
}
.three-line, .two-line {
  display: flex; flex-direction: column; gap: 2px;
  min-width: 0;
}
.line1 { font-weight: 500; color: var(--smax-text); font-size: 12.5px; }
.line2 { font-size: 11px; color: var(--smax-grey-700); }
.line3 { font-size: 10.5px; color: var(--smax-grey-300); font-style: italic; }
.line1.empty { color: var(--smax-grey-300); font-style: italic; font-weight: 400; }
.uid {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 10px; color: var(--smax-grey-700);
  word-break: break-all;
}

.avatar.avatar-customer {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #90caf9, #1976d2);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 13px;
  flex-shrink: 0;
}
.avatar.avatar-customer.is-female {
  background: linear-gradient(135deg, #f48fb1, #c2185b);
}
.avatar.avatar-nick {
  width: 26px; height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffb74d, #f57c00);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 10px;
  flex-shrink: 0;
}

.cell-strong { font-weight: 500; font-size: 12px; }
.empty { color: var(--smax-grey-300); }
.text-grey { color: var(--smax-grey-700); }

.tag-cell { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 9px;
  font-size: 10.5px; font-weight: 500;
  white-space: nowrap;
}
.chip-success     { background: rgba(0,200,83,0.12); color: #00897b; }
.chip-warning     { background: rgba(255,145,0,0.15); color: #ef6c00; }
.chip-info        { background: rgba(33,150,243,0.12); color: #1565c0; }
.chip-grey        { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); }
.chip-error       { background: rgba(255,82,82,0.12); color: #c62828; }
.chip-orange-soft { background: rgba(255,167,38,0.18); color: #ef6c00; }

.action-cell { display: flex; gap: 4px; }
.row-action-btn {
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-300);
  border-radius: 5px;
  padding: 3px 7px;
  cursor: pointer;
  font-size: 12px;
}
.row-action-btn:hover {
  background: var(--smax-primary-soft);
  border-color: var(--smax-primary);
  color: var(--smax-primary);
}

.empty-state {
  text-align: center;
  padding: 38px;
  color: var(--smax-grey-700);
  font-style: italic;
}

.pagination {
  display: flex; align-items: center; justify-content: center; gap: 11px;
  margin-top: 13px;
  font-size: 13px; color: var(--smax-grey-700);
}
</style>
