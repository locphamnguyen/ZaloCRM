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
          <button class="btn" title="Tùy chỉnh cột">⚙ Cột</button>
          <button class="btn" title="Xuất CSV">⬇ Xuất CSV</button>
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
          <div class="stat good">🟢 Đã KB: <strong>{{ friendCounts.friend ?? 0 }}</strong></div>
          <div class="stat warn">🟡 Đang chờ: <strong>{{ friendCounts.pending_friend ?? 0 }}</strong></div>
          <div class="stat">🔵 Đang nhắn lạ: <strong>{{ friendCounts.chatting_stranger ?? 0 }}</strong></div>
          <div class="stat">⚪ Đã ngắt: <strong>{{ friendCounts.ghost ?? 0 }}</strong></div>
          <div v-if="silentCount > 0" class="stat bad">⚠ Im lặng &gt; 7d: <strong>{{ silentCount }}</strong></div>
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
          @update:selected="selected = $event"
          @open-detail="onOpenDetail"
          @open-chat="onOpenChat"
          @open-contact="onOpenContact"
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

    <!-- Persistent restore toast -->
    <div v-if="state.restoredFromStorage.value" class="toast" @click.self="state.dismissRestoreToast()">
      ✓ Đã khôi phục nick
      <b>{{ restoredNickLabel }}</b>
      + filter từ phiên trước.
      <a href="#" @click.prevent="onResetAll">Đặt lại</a>
      <button class="toast-close" @click="state.dismissRestoreToast()">✕</button>
    </div>
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
import type { SmartHint } from '@/components/friends/FriendsSmartHints.vue';

const router = useRouter();
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

const restoredNickLabel = computed(() => {
  if (stateRaw.restoredNickId.value === 'all') return 'Tất cả nick';
  const a = accounts.value.find(x => x.id === stateRaw.restoredNickId.value);
  return a?.displayName || 'Nick';
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
    });
    return;
  }
  await fetchFriendsDb(id, {
    kind: state.kindFilter.value === 'all' ? undefined : state.kindFilter.value,
    page: pagination.page,
    limit: pagination.limit,
    search: searchInput.value || undefined,
  });
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
  // TODO: pass careStatus to fetchFriendsDb khi backend hỗ trợ filter theo statusRef
  fetch();
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

function onOpenContact(f: DbFriend) {
  if (f.contact?.id) router.push(`/contacts/${f.contact.id}`);
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

function onResetAll() {
  stateRaw.reset();
  searchInput.value = '';
  selected.value = new Set();
  pagination.page = 1;
  if (accounts.value.length) {
    stateRaw.selectedNickId.value = accounts.value[0].id;
    fetch();
  }
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
  background: #f5f7fb;
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
  padding: 12px 20px 8px;
  background: #fff;
  border-bottom: 1px solid #e4e8ef;
  display: flex; align-items: center; gap: 12px;
  flex-wrap: wrap;
}
.page-head h1 { margin: 0; font-size: 18px; font-weight: 700; color: #1a2433; }

.active-nick {
  display: inline-flex; align-items: center; gap: 6px;
  background: #e8f0fe; color: #2f6ee5;
  padding: 3px 10px; border-radius: 14px;
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
  padding: 7px 12px;
  border: 1px solid #cdd4df; border-radius: 8px;
  width: 280px; font-size: 13px;
  font-family: inherit;
}
.head-search:focus { outline: none; border-color: #2f6ee5; box-shadow: 0 0 0 3px #e8f0fe; }

.btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border-radius: 7px; border: 1px solid #cdd4df;
  background: #fff; color: #1a2433;
  font-weight: 600; font-size: 12px;
  cursor: pointer; font-family: inherit;
}
.btn:hover { background: #f9fafc; }
.btn.primary { background: #2f6ee5; color: #fff; border-color: #2f6ee5; }
.btn.primary:hover:not(:disabled) { background: #2356b8; }
.btn:disabled { opacity: .6; cursor: not-allowed; }

.stats {
  padding: 8px 20px;
  background: #f9fafc;
  border-bottom: 1px solid #e4e8ef;
  display: flex; gap: 16px; align-items: center;
  font-size: 12px; color: #5b6573;
}
.stats .stat strong { color: #1a2433; }
.stats .stat.good strong { color: #16a34a; }
.stats .stat.warn strong { color: #d97706; }
.stats .stat.bad strong { color: #dc2626; }
.spacer-flex { flex: 1; }

.density-label { font-size: 11px; }
.density-toggle {
  display: inline-flex;
  background: #fff; border: 1px solid #e4e8ef;
  border-radius: 6px; padding: 1px;
}
.density-toggle button {
  padding: 3px 8px;
  background: transparent; border: none;
  border-radius: 4px;
  font-size: 11px; color: #5b6573;
  cursor: pointer; font-family: inherit;
}
.density-toggle button.active {
  background: #2f6ee5; color: #fff; font-weight: 600;
}

.pag {
  padding: 8px 20px;
  background: #fff;
  border-top: 1px solid #e4e8ef;
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; color: #5b6573;
}
.pag button {
  padding: 4px 10px;
  border: 1px solid #e4e8ef; background: #fff;
  border-radius: 5px; cursor: pointer; font-size: 12px;
  font-family: inherit;
}
.pag button:hover:not(:disabled) { background: #f9fafc; }
.pag button.primary { background: #2f6ee5; color: #fff; border-color: #2f6ee5; }
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
