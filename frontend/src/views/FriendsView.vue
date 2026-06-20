<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="friends-page">
    <!-- 2-col layout: sidebar (nicks) + main -->
    <div class="page-grid">
      <NickSidebar
        :accounts="accounts"
        :selected-nick-id="effectiveNickId"
        :count-by-nick="countByNick"
        :total-friends-all="totalAcrossAllNicks"
        @select="onSelectNick"
      />

      <main class="main">
        <header class="page-head">
          <h1>👥 Bạn bè</h1>

          <span v-if="activeAccount" class="active-nick">
            <span class="av" :class="nickAvatarClass(activeAccount.id)">{{ nickInitials(activeAccount.displayName) }}</span>
            <span class="nick-name">{{ activeAccount.displayName || 'Nick' }}</span>
            <span class="dot-sep">·</span>
            <span>{{ friendsDbTotal }} bạn</span>
          </span>
          <span v-else-if="effectiveNickId === 'all'" class="active-nick all">
            <span class="av">∑</span>
            <span class="nick-name">Tất cả nick</span>
            <span class="dot-sep">·</span>
            <span>{{ totalAcrossAllNicks }} bạn</span>
          </span>

          <div class="spacer" />
          <input
            v-model="searchInput"
            class="head-search"
            placeholder="🔍 Tìm KH theo tên / SĐT / nick Zalo..."
            @input="debouncedFetch"
          />
          <button class="btn" title="Xuất CSV (chưa làm)" @click="onExportCsv">⬇ Xuất CSV</button>
          <v-menu :close-on-content-click="false">
            <template #activator="{ props: act }">
              <button v-bind="act" class="btn" title="Bật/tắt cột tuỳ chọn">⚙ Cột</button>
            </template>
            <v-list density="compact" min-width="280">
              <v-list-subheader>Cột mặc định (luôn hiện)</v-list-subheader>
              <v-list-item v-for="c in DEFAULT_COLUMNS" :key="c.key" disabled>
                <template #prepend>
                  <v-icon size="18" color="primary">mdi-checkbox-marked</v-icon>
                </template>
                <v-list-item-title>{{ c.label }}</v-list-item-title>
                <v-list-item-subtitle v-if="c.hint" class="text-caption">{{ c.hint }}</v-list-item-subtitle>
              </v-list-item>
              <v-divider class="my-1" />
              <v-list-subheader>Cột tuỳ chọn (bật/tắt)</v-list-subheader>
              <v-list-item
                v-for="c in OPTIONAL_COLUMNS"
                :key="c.key"
                @click="toggleColumn(c.key)"
              >
                <template #prepend>
                  <v-icon size="18" :color="visibleCols[c.key] ? 'primary' : ''">
                    {{ visibleCols[c.key] ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                  </v-icon>
                </template>
                <v-list-item-title>{{ c.label }}</v-list-item-title>
                <v-list-item-subtitle v-if="c.hint" class="text-caption">{{ c.hint }}</v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-menu>
          <button
            v-if="activeAccount"
            class="btn primary"
            :disabled="syncing"
            title="Auto-sync mỗi 15 phút. Click để refresh ngay lập tức."
            @click="onSync"
          >{{ syncing ? '↻ Đang làm mới…' : '↻ Làm mới ngay' }}</button>
        </header>

        <FriendsSmartHints :friends="friendsDb" @apply="onApplyHint" />

        <FriendsFilterBar
          :kind-filter="state.kindFilter.value"
          :count-by-kind="countByKind"
          :care-status="state.careStatus.value"
          @update:kind-filter="onKindChange"
          @update:care-status="onCareChange"
        />

        <div class="stats">
          <div class="stat good"><span class="sdot ok"></span>Đã KB: <strong>{{ friendCounts.friend ?? 0 }}</strong></div>
          <div class="stat warn"><span class="sdot warn"></span>Đang chờ: <strong>{{ friendCounts.pending_friend ?? 0 }}</strong></div>
          <div class="stat"><span class="sdot info"></span>Đang nhắn lạ: <strong>{{ friendCounts.chatting_stranger ?? 0 }}</strong></div>
          <div class="stat"><span class="sdot mut"></span>Đã ngắt: <strong>{{ friendCounts.ghost ?? 0 }}</strong></div>
          <div v-if="silentCount > 0" class="stat bad"><span class="sdot err"></span>Im lặng &gt; 7d: <strong>{{ silentCount }}</strong></div>
          <div class="spacer-flex" />
          <span class="density-label">Hiển thị:</span>
          <div class="density-toggle">
            <button
              v-for="d in DENSITY_OPTIONS"
              :key="d.value"
              :class="{ active: state.density.value === d.value }"
              @click="state.density.value = d.value"
            >{{ d.label }}</button>
          </div>
        </div>

        <FriendsBulkBar
          :count="selected.size"
          @clear="selected = new Set()"
          @msg-batch="onBulkMessage"
          @tag="onBulkTag"
          @change-status="onBulkChangeStatus"
          @export="onBulkExport"
        />

        <FriendsTable
          :friends="friendsDb"
          :loading="loadingDb"
          :density="state.density.value"
          :selected="selected"
          :visible-cols="visibleCols"
          :sort-by="sortBy"
          @update:selected="selected = $event"
          @open-detail="onOpenDetail"
          @open-chat="onOpenChat"
          @open-contact="onOpenContact"
          @sort-by="setSortBy"
        />

        <div class="pag">
          <span>{{ pagFrom }}–{{ pagTo }} / {{ friendsDbTotal }}</span>
          <div class="spacer-flex" />
          <span>Trang:</span>
          <button :disabled="pagination.page === 1" @click="goPage(pagination.page - 1)">« Trước</button>
          <button
            v-for="p in visiblePages"
            :key="p"
            :class="{ primary: p === pagination.page }"
            @click="goPage(p)"
          >{{ p }}</button>
          <button :disabled="pagination.page >= totalPages" @click="goPage(pagination.page + 1)">Sau »</button>
        </div>
      </main>
    </div>

    <FriendDetailPanel
      :friend="detailFriend"
      :active-nick-name="activeAccount?.displayName || 'Nick'"
      @close="detailFriend = null"
      @open-chat="onOpenChat"
      @call="onCall"
      @open-contact="onOpenContact"
    />

    <!-- Hồ sơ KH tổng (tái dùng) — mở từ nút 👤 Hồ sơ, vào thẳng tab Nick chăm đúng nick. -->
    <CustomerProfileDialog
      v-model="showProfileDialog"
      :contact-id="profileContactId"
      :friend-id="profileFriendId"
      initial-tab="nicks"
    />

    <!-- 2026-06-17 (anh chốt): bỏ toast khôi phục — vẫn nhớ view gần nhất qua localStorage/URL,
         chỉ không thông báo ra UI. -->
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import { useFriends, type DbFriend } from '@/composables/use-friends';
import { useZaloAccounts } from '@/composables/use-zalo-accounts';
import { useFriendsState, type DensityMode, type FriendKindFilter } from '@/composables/use-friends-state';
import { useFriendSocket, type FriendUpdatedPayload } from '@/composables/use-friend-socket';
import NickSidebar from '@/components/friends/NickSidebar.vue';
import FriendsFilterBar from '@/components/friends/FriendsFilterBar.vue';
import FriendsSmartHints from '@/components/friends/FriendsSmartHints.vue';
import FriendsTable from '@/components/friends/FriendsTable.vue';
import FriendsBulkBar from '@/components/friends/FriendsBulkBar.vue';
import FriendDetailPanel from '@/components/friends/FriendDetailPanel.vue';
import CustomerProfileDialog from '@/components/contacts/CustomerProfileDialog.vue';
import { useToast } from '@/composables/use-toast';
import type { SmartHint } from '@/components/friends/FriendsSmartHints.vue';

const router = useRouter();
const toast = useToast();
const { accounts, fetchAccounts } = useZaloAccounts();
const {
  friendsDb,
  friendsDbTotal,
  friendCounts,
  loadingDb,
  syncing,
  fetchFriendsDb,
  fetchFriendsDbAllNicks,
  syncFriendsDb,
} = useFriends();

const stateRaw = useFriendsState();
// Expose .value refs together to template via shorthand
const state = {
  kindFilter: stateRaw.kindFilter,
  careStatus: stateRaw.careStatus,
  density: stateRaw.density,
  restoredFromStorage: stateRaw.restoredFromStorage,
  dismissRestoreToast: stateRaw.dismissRestoreToast,
};

const DENSITY_OPTIONS: { value: DensityMode; label: string }[] = [
  { value: 'compact',  label: 'Gọn' },
  { value: 'normal',   label: 'Vừa' },
  { value: 'detailed', label: 'Rộng' },
];

// ─── Column toggle (Tier 1 default vs Tier 2 optional) ───
// Tier 1: KB từ ngày, Đình trệ, Auto tag — luôn hiện, không toggle được (subheader disable)
const DEFAULT_COLUMNS = [
  { key: 'becameFriendAt', label: '🕒 KB từ ngày',  hint: 'Ngày trở thành bạn bè trên Zalo' },
  { key: 'stuckSince',     label: '⚠ Đình trệ',    hint: 'KH bị cron flag stuck do không tương tác' },
  { key: 'autoTags',       label: '🤖 Auto tag',    hint: 'System auto: active / stuck / cold / ready ...' },
] as const;

// Tier 2: optional, toggle qua menu, persist localStorage
const OPTIONAL_COLUMNS = [
  { key: 'zaloGlobalId',  label: '🌐 Global ID',         hint: 'Zalo global identity, cross-nick' },
  { key: 'zaloUsername',  label: '@ Username',           hint: 'Zalo handle (@t_abc...)' },
  { key: 'lastInboundAt', label: '📥 KH nhắn cuối',      hint: 'Tách riêng inbound (tin từ KH)' },
  { key: 'lastOutboundAt',label: '📤 Sale nhắn cuối',    hint: 'Tách riêng outbound (tin từ sale)' },
  { key: 'firstMessageAt',label: '💬 First message',     hint: 'Mở chat 1-1 lần đầu' },
  { key: 'stageEnteredAt',label: '⏱ Stage từ',           hint: 'Vào trạng thái KH hiện tại lúc nào' },
  // Phase 2 — Derived cols (tính từ field có sẵn)
  { key: 'silent',        label: '🔇 Silent',            hint: 'Số ngày KH không nhắn (KH cold tail)' },
  { key: 'replyRate',     label: '📨 Reply rate',        hint: 'Tỷ lệ outbound/inbound — sale có chăm đủ không' },
  { key: 'healthBars',    label: '🌡 Health bars',       hint: 'Score breakdown 4-dim mini bars (engagement/intent/fit/velocity)' },
] as const;

type OptionalColKey = (typeof OPTIONAL_COLUMNS)[number]['key'];

const LS_KEY_COLS = 'friendsview.visibleCols.v1';
function loadVisibleCols(): Record<OptionalColKey, boolean> {
  const def: Record<OptionalColKey, boolean> = {
    zaloGlobalId: false, zaloUsername: false,
    lastInboundAt: false, lastOutboundAt: false,
    firstMessageAt: false, stageEnteredAt: false,
    silent: false, replyRate: false, healthBars: false,
  };
  try {
    const raw = localStorage.getItem(LS_KEY_COLS);
    if (raw) return { ...def, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return def;
}
const visibleCols = ref<Record<OptionalColKey, boolean>>(loadVisibleCols());
function toggleColumn(key: OptionalColKey) {
  visibleCols.value[key] = !visibleCols.value[key];
  try { localStorage.setItem(LS_KEY_COLS, JSON.stringify(visibleCols.value)); } catch { /* ignore */ }
}

function onExportCsv() {
  // Placeholder: chưa làm. Defer phase sau, tránh button placeholder không phản hồi.
  console.warn('[FriendsView] CSV export chưa implement');
}

const searchInput = ref('');
const pagination = reactive({ page: 1, limit: 25 });
const selected = ref<Set<string>>(new Set());
const detailFriend = ref<DbFriend | null>(null);

// ─── Active nick resolution ───
// effectiveNickId: 'all' | account.id | null (loading)
const effectiveNickId = computed<string | null>(() => stateRaw.selectedNickId.value);
const activeAccount = computed(() =>
  accounts.value.find(a => a.id === effectiveNickId.value) || null,
);

// Counts (TODO khi backend cho aggregate). Tạm derive từ list hiện tại.
const countByNick = ref<Record<string, number>>({});
const totalAcrossAllNicks = computed(() => {
  return Object.values(countByNick.value).reduce((s, v) => s + v, 0);
});
const countByKind = computed<Record<string, number>>(() => {
  return {
    all: friendsDbTotal.value,
    friend: friendCounts.value.friend ?? 0,
    pending_friend: friendCounts.value.pending_friend ?? 0,
    chatting_stranger: friendCounts.value.chatting_stranger ?? 0,
    ghost: friendCounts.value.ghost ?? 0,
  };
});

const silentCount = computed(() => {
  const SEVEN = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return friendsDb.value.filter(f => f.lastInteractionAt && now - new Date(f.lastInteractionAt).getTime() >= SEVEN).length;
});


// ─── Pagination derived ───
const totalPages = computed(() => Math.max(1, Math.ceil(friendsDbTotal.value / pagination.limit)));
const pagFrom = computed(() => {
  if (friendsDbTotal.value === 0) return 0;
  return (pagination.page - 1) * pagination.limit + 1;
});
const pagTo = computed(() => Math.min(pagination.page * pagination.limit, friendsDbTotal.value));
const visiblePages = computed<number[]>(() => {
  const total = totalPages.value;
  const cur = pagination.page;
  const out = new Set<number>([1, total, cur - 1, cur, cur + 1]);
  return [...out].filter(p => p >= 1 && p <= total).sort((a, b) => a - b);
});

// ─── Fetch wiring ───
let searchTimeout: ReturnType<typeof setTimeout>;
function debouncedFetch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    pagination.page = 1;
    fetch();
  }, 300);
}

async function fetch() {
  const id = effectiveNickId.value;
  if (!id) return;
  if (id === 'all') {
    // Cross-nick aggregate: gọi /friends-db/all-nicks (Phase 4)
    await fetchFriendsDbAllNicks({
      kind: state.kindFilter.value === 'all' ? undefined : state.kindFilter.value,
      page: pagination.page,
      limit: pagination.limit,
      search: searchInput.value || undefined,
      sortBy: sortBy.value,
      statusId: state.careStatus.value || undefined,
    });
    return;
  }
  await fetchFriendsDb(id, {
    kind: state.kindFilter.value === 'all' ? undefined : state.kindFilter.value,
    page: pagination.page,
    limit: pagination.limit,
    search: searchInput.value || undefined,
    sortBy: sortBy.value,
    statusId: state.careStatus.value || undefined,
  });
}

// Phase 6 polish — sort theo Score header click. Persist localStorage.
type SortBy = 'recent' | 'score-desc' | 'score-asc' | 'stuck';
const SORT_LS_KEY = 'friendsview.sortBy.v1';
const sortBy = ref<SortBy>((localStorage.getItem(SORT_LS_KEY) as SortBy) || 'recent');
function setSortBy(v: SortBy) {
  sortBy.value = v;
  try { localStorage.setItem(SORT_LS_KEY, v); } catch { /* ignore */ }
  pagination.page = 1;
  fetch();
}

function goPage(p: number) {
  pagination.page = p;
  fetch();
}

function onSelectNick(nickId: string) {
  stateRaw.selectedNickId.value = nickId;
  pagination.page = 1;
  selected.value = new Set();
  fetch();
}

function onKindChange(v: FriendKindFilter) {
  state.kindFilter.value = v;
  pagination.page = 1;
  fetch();
}

function onCareChange(v: string) {
  state.careStatus.value = v;
  pagination.page = 1;
  fetch();  // statusId truyền trong fetch() (backend filter theo Friend.statusId)
}

async function onSync() {
  if (!effectiveNickId.value || effectiveNickId.value === 'all') return;
  const result = await syncFriendsDb(effectiveNickId.value);
  if (result?.cooldown) {
    // Backend từ chối do 5s cooldown — hiện hint nhẹ không cần fetch lại
    console.warn('[FriendsView] sync cooldown:', result.message);
    return;
  }
  await fetch();
}

// ─── Live socket subscribe: friend:updated → merge patch vào row trong cache
// Không refetch list, chỉ mutate trực tiếp row để tránh flicker + tiết kiệm HTTP.
useFriendSocket((payload: FriendUpdatedPayload) => {
  const row = friendsDb.value.find((f) => f.id === payload.friendId);
  if (!row) return; // row không có trong page hiện tại, skip
  Object.assign(row as Record<string, unknown>, payload.patch);
});

// ─── Detail panel + actions ───
function onOpenDetail(f: DbFriend) {
  detailFriend.value = f;
}

async function onOpenChat(f: DbFriend) {
  // Best-effort: ensure conversation tồn tại trước, rồi điều hướng tới Chat.
  // Reuse logic của FriendsView cũ — backend đảm bảo idempotent.
  try {
    const { api } = await import('@/api/index');
    const res = await api.post<{ conversationId: string }>(`/friends/${f.id}/ensure-conversation`, {});
    if (res.data?.conversationId) {
      router.push({ name: 'Chat', params: { convId: res.data.conversationId } });
      return;
    }
  } catch (err) {
    console.error('[FriendsView] ensure-conversation failed:', err);
  }
  if (f.contact?.id) router.push({ path: '/chat', query: { contactId: f.contact.id } });
}

// Hồ sơ KH tổng — mở POPUP CustomerProfileDialog ngay trên /friends (không rời màn).
// Mở thẳng tab "Nick chăm" + highlight đúng nick đang xem (anh chốt 2026-06-13).
const showProfileDialog = ref(false);
const profileContactId = ref<string | null>(null);
const profileFriendId = ref<string | null>(null);
function onOpenContact(f: DbFriend) {
  if (!f.contact?.id) {
    toast.warning('Bạn này chưa gắn khách CRM — không mở được hồ sơ.');
    return;
  }
  profileContactId.value = f.contact.id;
  profileFriendId.value = f.id;
  showProfileDialog.value = true;
}

function onCall(f: DbFriend) {
  if (f.contact?.phone) {
    window.location.href = `tel:${f.contact.phone}`;
  }
}

// ─── Bulk actions (stubs — backend wiring lần kế) ───
function onBulkMessage() {
  console.log('[bulk] message to', [...selected.value]);
}
function onBulkTag() {
  console.log('[bulk] tag', [...selected.value]);
}
function onBulkChangeStatus() {
  console.log('[bulk] change status', [...selected.value]);
}
function onBulkExport() {
  console.log('[bulk] export', [...selected.value]);
}

// ─── Smart hints ───
function onApplyHint(h: SmartHint) {
  if (h.key === 'silent7d') {
    // Filter client-side cho session này — backend cần thêm param sau
    console.log('[hint] silent7d — TODO wire backend filter');
  } else if (h.key === 'newThisWeek') {
    console.log('[hint] newThisWeek');
  } else if (h.key === 'hotPending') {
    state.careStatus.value = 'hot';
    fetch();
  } else if (h.key === 'aliasDup') {
    console.log('[hint] aliasDup — show merge dialog');
  }
}

// ─── Avatar helpers cho header ───
const NICK_PALETTE = ['av-c1', 'av-c2', 'av-c3', 'av-c4', 'av-c5', 'av-c6', 'av-c7'];
function nickAvatarClass(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return NICK_PALETTE[h % NICK_PALETTE.length];
}
function nickInitials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[parts.length - 2][0] + parts[parts.length - 1][0]).toUpperCase();
}


// ─── Watchers ───
watch(() => stateRaw.density.value, () => {
  // density chỉ là UI, không cần refetch
});

// Khi accounts đã load, nếu state đang null thì pick first.
watch(accounts, (list) => {
  if (!stateRaw.selectedNickId.value && list.length) {
    stateRaw.selectedNickId.value = list[0].id;
    fetch();
  }
}, { immediate: false });

onMounted(async () => {
  await fetchAccounts();

  // Validate restored nick — nếu nick id từ storage không còn tồn tại → fallback
  const persisted = stateRaw.selectedNickId.value;
  if (persisted && persisted !== 'all') {
    const exists = accounts.value.some(a => a.id === persisted);
    if (!exists && accounts.value.length) {
      stateRaw.selectedNickId.value = accounts.value[0].id;
    }
  } else if (!persisted && accounts.value.length) {
    stateRaw.selectedNickId.value = accounts.value[0].id;
  }
  fetch();

  // Auto-dismiss restore toast sau 5s
  if (stateRaw.restoredFromStorage.value) {
    setTimeout(() => stateRaw.dismissRestoreToast(), 5000);
  }
});
</script>

<style scoped>
.friends-page {
  height: calc(100vh - var(--smax-topnav-h, 52px));
  background: var(--surface-2);
  display: flex; flex-direction: column;
  overflow: hidden;
}

.page-grid {
  display: grid;
  grid-template-columns: 260px 1fr;
  flex: 1;
  min-height: 0;
}

@media (max-width: 1100px) {
  .page-grid { grid-template-columns: 220px 1fr; }
}
@media (max-width: 800px) {
  .page-grid { grid-template-columns: 1fr; }
  .page-grid > :first-child { display: none; }
}

.main {
  display: flex; flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.page-head {
  padding: 12px 22px 8px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  display: flex; align-items: center; gap: 12px;
  flex-wrap: wrap;
}
.page-head h1 { margin: 0; font-size: 18px; font-weight: 800; color: var(--ink); }

.active-nick {
  display: inline-flex; align-items: center; gap: 6px;
  background: var(--brand-soft); color: var(--brand-700);
  padding: 3px 10px; border-radius: var(--r-pill);
  font-weight: 600; font-size: 12px;
}
.active-nick .av {
  width: 18px; height: 18px; border-radius: 50%;
  color: #fff; display: grid; place-items: center;
  font-size: 9px; font-weight: 700;
}
.active-nick.all .av {
  background: linear-gradient(135deg, #94a3b8, #64748b);
}
.active-nick .dot-sep { opacity: .6; }

.spacer { flex: 1; }

.head-search {
  padding: 8px 12px;
  border: 1px solid var(--line); border-radius: var(--r-sm);
  width: 280px; font-size: 13px;
  color: var(--ink);
  font-family: inherit;
  transition: border-color .12s, box-shadow .12s;
}
.head-search:focus { outline: none; border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 13px; border-radius: var(--r-sm); border: 1px solid var(--line);
  background: var(--surface); color: var(--ink-2);
  font-weight: 600; font-size: 12.5px;
  cursor: pointer; font-family: inherit;
  transition: all .12s;
}
.btn:hover { background: var(--surface-3); color: var(--ink); }
.btn.primary { background: var(--brand); color: #fff; border-color: var(--brand); box-shadow: var(--sh-xs); }
.btn.primary:hover:not(:disabled) { background: var(--brand-600); }
.btn:disabled { opacity: .6; cursor: not-allowed; }

.stats {
  padding: 9px 22px;
  background: var(--surface-2);
  border-bottom: 1px solid var(--line);
  display: flex; gap: 16px; align-items: center;
  font-size: 12.5px; color: var(--ink-2);
}
.stats .stat { display: inline-flex; align-items: center; gap: 6px; }
.stats .stat strong { color: var(--ink); font-weight: 700; }
.stats .stat.good strong { color: var(--success); }
.stats .stat.warn strong { color: var(--warning); }
.stats .stat.bad strong { color: var(--error); }
.sdot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex: none; }
.sdot.ok { background: var(--success); }
.sdot.warn { background: var(--warning); }
.sdot.info { background: var(--info); }
.sdot.mut { background: var(--ink-4); }
.sdot.err { background: var(--error); }
.spacer-flex { flex: 1; }

.density-label { font-size: 11px; color: var(--ink-3); }
.density-toggle {
  display: inline-flex;
  background: var(--surface-3); border: 1px solid var(--line);
  border-radius: var(--r-sm); padding: 2px;
}
.density-toggle button {
  padding: 4px 9px;
  background: transparent; border: none;
  border-radius: 6px;
  font-size: 11.5px; font-weight: 600; color: var(--ink-3);
  cursor: pointer; font-family: inherit;
}
.density-toggle button.active {
  background: var(--surface); color: var(--brand-700); box-shadow: var(--sh-xs);
}

.pag {
  padding: 9px 22px;
  background: var(--surface);
  border-top: 1px solid var(--line);
  display: flex; align-items: center; gap: 8px;
  font-size: 12.5px; color: var(--ink-2);
}
.pag button {
  padding: 5px 11px;
  border: 1px solid var(--line); background: var(--surface);
  border-radius: var(--r-sm); cursor: pointer; font-size: 12.5px; font-weight: 600;
  color: var(--ink-2);
  font-family: inherit;
  transition: all .12s;
}
.pag button:hover:not(:disabled) { background: var(--surface-3); }
.pag button.primary { background: var(--brand); color: #fff; border-color: var(--brand); }
.pag button:disabled { opacity: .4; cursor: not-allowed; }

.toast {
  position: fixed; bottom: 20px; right: 20px;
  background: #1a2433; color: #fff;
  padding: 10px 16px; border-radius: 8px;
  font-size: 12px; max-width: 360px;
  box-shadow: 0 4px 20px rgba(0,0,0,.25);
  z-index: 60;
  display: flex; align-items: center; gap: 8px;
  animation: slideUp .25s;
}
.toast a { color: #93c5fd; text-decoration: none; margin-left: 4px; }
.toast a:hover { text-decoration: underline; }
.toast-close {
  background: transparent; border: none;
  color: #fff; opacity: .6; cursor: pointer;
  margin-left: 4px; font-family: inherit; font-size: 12px;
}
.toast-close:hover { opacity: 1; }
@keyframes slideUp {
  from { transform: translateY(20px); opacity: 0; }
  to   { transform: translateY(0); opacity: 1; }
}

.av-c1 { background: linear-gradient(135deg, #2f6ee5, #1d4ed8); }
.av-c2 { background: linear-gradient(135deg, #16a34a, #15803d); }
.av-c3 { background: linear-gradient(135deg, #d97706, #b45309); }
.av-c4 { background: linear-gradient(135deg, #7c3aed, #6d28d9); }
.av-c5 { background: linear-gradient(135deg, #db2777, #be185d); }
.av-c6 { background: linear-gradient(135deg, #0891b2, #0e7490); }
.av-c7 { background: linear-gradient(135deg, #ea580c, #c2410c); }
</style>
