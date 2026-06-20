<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="za-page">
    <!-- TOP BAR -->
    <div class="topbar">
      <div class="lead">
        <h1>Quản lý tài khoản Zalo</h1>
        <div class="sub">
          <b>{{ stats?.totalNick ?? '—' }}</b> nick
          <span v-if="stats"> · {{ stats.active }} active · {{ stats.idle }} idle</span>
          <span v-if="stats?.error" class="warn"> · {{ stats.error }} cần re-login</span>
          <span class="dot">·</span>
          cập nhật {{ lastRefreshLabel }}
        </div>
      </div>
      <div class="actions">
        <button class="btn" @click="onRefresh" :disabled="loadingStats || loadingEnriched">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
          Refresh
        </button>
        <button class="btn btn-primary" @click="openAddDialog">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Kết nối kênh
        </button>
      </div>
    </div>

    <!-- Phase Privacy v2 2026-05-23 — Tab strip: Quản lý nick / Riêng tư
         Phase Internal Contact 2-method 2026-05-23 — thêm tab "🏠 Liên lạc nội bộ" top-level -->
    <div class="za-tabs">
      <button
        class="za-tab"
        :class="{ active: activeTab === 'manage' }"
        @click="setTab('manage')"
      >
        Quản lý nick
      </button>
      <!-- Open-core: tab "Riêng tư" chỉ hiện ở bản Extension; Community ẩn (code vẫn ở source). -->
      <button
        v-if="isExtension"
        class="za-tab"
        :class="{ active: activeTab === 'privacy' }"
        @click="setTab('privacy')"
      >
        🔒 Riêng tư
        <span v-if="privacyCounter" class="za-tab-counter" :class="{ full: privacyCounter.atMax }">
          ({{ privacyCounter.used }}/{{ privacyCounter.max }})
        </span>
      </button>
      <!-- GỠ 2026-06-10 (CEO-review): tab "Sửa nick nhận thông báo" (setup thủ công)
           đã bỏ — gây bug gửi nhầm UID. Nick nhận giờ chỉ đến từ luồng tạo user bằng SĐT
           + Check Live ở trang Thông báo hệ thống. Ẩn nút, không cho vào tab. -->
      <button
        v-if="false"
        class="za-tab"
        :class="{ active: activeTab === 'internal-contact' }"
        @click="setTab('internal-contact')"
      >
        🏠 Sửa nick nhận thông báo
      </button>
    </div>

    <!-- Tab content: manage (default) -->
    <template v-if="activeTab === 'manage'">
    <!-- Sub-tab Đơn giản (grid card, sale) / Nâng cao (bảng, admin) — Anh chốt 2026-06-09 -->
    <div class="za-subtabs">
      <button class="za-subtab" :class="{ active: viewMode === 'simple' }" @click="viewMode = 'simple'">
        <v-icon size="15">mdi-view-grid-outline</v-icon> Đơn giản
      </button>
      <button class="za-subtab" :class="{ active: viewMode === 'advanced' }" @click="viewMode = 'advanced'">
        <v-icon size="15">mdi-table</v-icon> Nâng cao
      </button>
    </div>

    <!-- ===== TAB ĐƠN GIẢN: grid card ===== -->
    <template v-if="viewMode === 'simple'">
      <!-- Mục 1 (2026-06-11): chuyển nhóm theo trạng thái ↔ theo người dùng -->
      <div class="za-groupby">
        <span class="za-groupby-lbl">Nhóm theo:</span>
        <button class="za-groupby-opt" :class="{ active: simpleGroupBy === 'status' }" @click="simpleGroupBy = 'status'">Trạng thái</button>
        <button class="za-groupby-opt" :class="{ active: simpleGroupBy === 'owner' }" @click="simpleGroupBy = 'owner'">Người dùng</button>
      </div>
      <NickGridCards
        :accounts="visibleAccounts"
        :reconnecting-ids="reconnectingIds"
        :group-by="simpleGroupBy"
        @reconnect="onCardReconnect"
        @delete="onConfirmDelete"
        @disconnect="onCardDisconnect"
        @open-detail="openDrawer"
        @add="openAddDialog"
      />
    </template>

    <!-- ===== TAB NÂNG CAO: bảng đầy đủ ===== -->
    <template v-else>
    <!-- STATS CARDS -->
    <StatsCards :stats="stats" />

    <!-- FILTER ROW — Phase 4 redesign 2026-05-22 -->
    <div class="filter-row">
      <div class="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input v-model="search" placeholder="Tìm theo tên nick, UID, SĐT..." />
      </div>
      <select v-model="statusFilter" class="select">
        <option value="all">Trạng thái: Tất cả</option>
        <option value="active">Active</option>
        <option value="idle">Idle</option>
        <option value="error">Error / Disconnected</option>
      </select>
      <!-- 2026-06-09: BỎ filter Phòng ban (nick không gắn phòng ban, chỉ Owner + Sale hỗ trợ). -->
      <select v-model="saleFilter" class="select">
        <option value="">Owner: Tất cả</option>
        <option v-for="u in ownerOptions" :key="u.id" :value="u.id">{{ u.fullName || u.email }}</option>
      </select>
      <select v-model="sortMode" class="select select-sort">
        <option value="recent">Sort: Hoạt động mới</option>
        <option value="msg-desc">Sort: Msg today (nhiều→ít)</option>
        <option value="uptime-asc">Sort: Uptime thấp trước</option>
        <option value="name">Sort: Tên A→Z</option>
      </select>
    </div>

    <!-- TABLE -->
    <AccountsTable
      :accounts="visibleAccounts"
      :uptime-cache="uptimeCache"
      :group-by-dept="groupByDept"
      :is-selected="isSelected"
      :toggle-select="toggleSelect"
      :select-all="selectAll"
      :clear-selection="clearSelection"
      :relative-time="relativeTime"
      :status-label="statusLabel"
      :uptime-color="uptimeColor"
      :limit-for="limitFor"
      @open-detail="openDrawer"
      @action="onTableAction"
      @reassign-owner="onOpenReassign"
    />
    </template>
    <!-- /viewMode advanced -->

    <!-- 2026-06-18 — Dialog cài đặt trần SDK đã DỜI sang Cài đặt › Kênh & Tự động ›
         "Trần an toàn SDK Zalo" (chỉ admin). Trang này GIỮ cột usage (loadSdkLimits đọc để hiện). -->

    <!-- Phase 4 2026-05-22: Owner reassign drawer -->
    <OwnerReassignDrawer
      v-model="reassignOpen"
      :account="reassignAccount"
      @reassigned="onReassigned"
    />

    </template>

    <!-- Tab content: privacy (Phase Privacy v2 2026-05-23) -->
    <template v-else-if="activeTab === 'privacy'">
      <PrivacyNicksTab />
    </template>

    <!-- Tab content: internal-contact (Phase Internal Contact 2-method 2026-05-23)
         Phase user-create-with-zalo 2026-05-27: ADMIN ONLY (sale không sửa nick nhận thông báo,
         admin sẽ sửa cho sale khi cần). Gate ở tab button + safeguard fallback nếu URL hack. -->
    <template v-else-if="activeTab === 'internal-contact' && canManageZalo">
      <InternalContactSetupPage />
    </template>
    <template v-else-if="activeTab === 'internal-contact' && !canManageZalo">
      <div class="za-locked-tab">
        <div class="za-locked-icon">🔒</div>
        <h3>Chỉ admin có quyền sửa nick nhận thông báo</h3>
        <p>Liên hệ admin để cập nhật. Sale không được tự sửa để tránh sai thông tin nhận login + thông báo hệ thống.</p>
        <button class="btn-primary" @click="setTab('manage')">← Quay lại Quản lý nick</button>
      </div>
    </template>

    <!-- DETAIL DRAWER -->
    <AccountDetailDrawer
      v-model="drawerOpen"
      :account="drawerAccount"
      :uptime-cache="uptimeCache"
      :relative-time="relativeTime"
      :status-label="statusLabel"
      :uptime-color="uptimeColor"
      :limit-for="limitFor"
      @add-crew="onAddCrew"
      @remove-crew="onRemoveCrew"
      @action="onDrawerAction"
      @reassign-owner="onOpenReassign"
    />

    <!-- BULK ACTION BAR -->
    <BulkActionBar
      :count="selectedCount"
      :loading="bulkLoading"
      @action="onBulkAction"
      @clear="clearSelection"
    />

    <!-- KẾT NỐI NICK — wizard 4 bước (Anh chốt 2026-06-09): SĐT→Check→xác nhận→QR→chúc mừng -->
    <ConnectNickWizard
      v-if="wizardOpen"
      v-model:step="wizardStep"
      :qr-image="qrImage"
      :qr-scanned="qrScanned"
      :scanned-name="scannedName"
      :qr-error="qrError"
      :qr-session-dead="qrSessionDead"
      :sale-name="saleShortName"
      :connected-nick-name="connectedNickName"
      @checked="onWizardChecked"
      @confirm-connect="onWizardConfirmConnect"
      @reconnect-existing="onWizardReconnectExisting"
      @rescan-existing="onWizardRescanExisting"
      @retry-qr="onWizardRetryQr"
      @close="closeWizard"
    />

    <!-- DELETE CONFIRM -->
    <div v-if="showDeleteDialog" class="modal-backdrop" @click.self="showDeleteDialog = false">
      <div class="modal">
        <div class="modal-head"><h3>Xoá nick</h3></div>
        <div class="modal-body">
          <p>Xoá nick "<b>{{ deleteTarget?.displayName || deleteTarget?.zaloUid || deleteTarget?.id }}</b>" khỏi quản lý?</p>
          <div class="hint">Nick sẽ bị ẩn nhưng GIỮ toàn bộ tin nhắn (xem lại được). Kết nối lại đúng nick này sẽ tự khôi phục.</div>
        </div>
        <div class="modal-foot">
          <button class="btn" @click="showDeleteDialog = false">Huỷ</button>
          <button class="btn btn-danger" :disabled="deleting" @click="handleDelete">
            {{ deleting ? 'Đang xoá...' : 'Xoá' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ACCESS DIALOG (reuse existing) -->
    <ZaloAccessDialog
      v-model="showAccessDialog"
      :account-id="accessTargetId"
      :account-name="accessTargetName"
      @update:modelValue="onAccessDialogClose"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted, watch } from 'vue';
import { useZaloAccountsDashboard } from '@/composables/use-zalo-accounts-dashboard';
import StatsCards from '@/components/zalo-accounts/StatsCards.vue';
import AccountsTable from '@/components/zalo-accounts/AccountsTable.vue';
// SdkLimitsDialog dời sang trang Cài đặt SdkLimitsSettingsPage (2026-06-18) — ko import ở đây nữa.
import AccountDetailDrawer from '@/components/zalo-accounts/AccountDetailDrawer.vue';
import BulkActionBar from '@/components/zalo-accounts/BulkActionBar.vue';
import OwnerReassignDrawer from '@/components/zalo-accounts/OwnerReassignDrawer.vue';
import NickGridCards from '@/components/zalo-accounts/NickGridCards.vue';
import ConnectNickWizard from '@/components/zalo-accounts/ConnectNickWizard.vue';
import PrivacyNicksTab from '@/components/zalo-accounts/PrivacyNicksTab.vue';
// Open-core: edition flag (true in Extension, false in Community). Privacy code
// stays in the Community source — only the tab is hidden via this flag.
import { isExtension } from '@ee/edition';
import InternalContactSetupPage from '@/components/zalo-accounts/InternalContactSetupPage.vue';
import ZaloAccessDialog from '@/components/settings/ZaloAccessDialog.vue';
import { api } from '@/api/index';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import type { EnrichedAccount } from '@/composables/use-zalo-accounts-dashboard';

const dash = useZaloAccountsDashboard();
const {
  // dashboard data
  stats, enriched, filtered, loadingStats, loadingEnriched,
  // filters
  search, statusFilter, saleFilter, sortMode,
  // selection
  selectedCount, isSelected, toggleSelect, selectAll, clearSelection,
  // drawer
  drawerOpen, drawerAccount, openDrawer,
  // uptime
  uptimeCache,
  // actions
  fetchStats, refreshAll, bulkAction,
  // helpers
  relativeTime, statusLabel, uptimeColor,
  // QR/socket from base composable
  showQRDialog, qrImage, qrScanned, scannedName, qrError, qrSessionDead, duplicateInfo,
  currentLoginAccountId,
  deleting,
  addAccount, loginAccount, reconnectAccount, deleteAccount,
  cancelQR, setupSocket,
} = dash;

// 2026-06-06 — Trần SDK: load org default + nick override để vẽ thanh quota X/cap.
// showSdkLimits bỏ (dialog dời sang Cài đặt). Giữ sdkOrgLimits/sdkNickOverrides để hiện cột usage.
const sdkOrgLimits = ref<Record<string, { daily: number }>>({});
const sdkNickOverrides = ref<Record<string, Record<string, { daily: number }>>>({});
async function loadSdkLimits() {
  try {
    const { data } = await api.get('/zalo-accounts/sdk-limits');
    sdkOrgLimits.value = data.orgDefault ?? {};
    sdkNickOverrides.value = data.nickOverrides ?? {};
  } catch { /* non-fatal: bảng vẫn hiển thị, cap = 0 */ }
}
// limitFor: trần hiệu lực 1 nick + category (ưu tiên nick override → org default → 0).
function limitFor(nickId: string, category: string): number {
  return sdkNickOverrides.value[nickId]?.[category]?.daily
    ?? sdkOrgLimits.value[category]?.daily
    ?? 0;
}

// Local UI state
// 2026-06-09: sub-tab Đơn giản (grid card sale) / Nâng cao (bảng admin). Mặc định Đơn giản.
const viewMode = ref<'simple' | 'advanced'>('simple');
// Mục 1 (2026-06-11): nhóm grid card theo trạng thái (mặc định) hoặc theo người dùng.
const simpleGroupBy = ref<'status' | 'owner'>('status');
// Wizard kết nối 4 bước (thay 2 dialog Add+QR cũ).
const wizardOpen = ref(false);
const wizardStep = ref<'phone' | 'confirm' | 'qr' | 'done'>('phone');
const wizardPhone = ref('');
const connectedNickName = ref<string | null>(null);
const showDeleteDialog = ref(false);
const deleteTargetId = ref<string | null>(null);
const bulkLoading = ref(false);
const lastRefresh = ref(new Date());

const showAccessDialog = ref(false);
const accessTargetId = ref('');
const accessTargetName = ref('');

const deleteTarget = computed(() => filtered.value.find((a) => a.id === deleteTargetId.value));

const lastRefreshLabel = computed(() => relativeTime(lastRefresh.value.toISOString()));

// Phase Privacy v2 2026-05-23 — Tab strip state + URL sync
const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const toast = useToast();
const reconnectingIds = ref<Set<string>>(new Set());
// RBAC 2026-06-08 — quản lý nick + sửa liên lạc nội bộ của sale theo grants 'zalo_account.edit'
// (owner/admin tự bypass). Thay cho check legacy role.
const canManageZalo = computed(() => authStore.canAccess('zalo_account', 'edit'));
// GỠ 2026-06-10 (CEO-review): bỏ 'internal-contact' khỏi tab hợp lệ — URL hack
// ?tab=internal-contact sẽ rơi về 'manage'. Cơ chế setup thủ công đã gỡ.
type TabKey = 'manage' | 'privacy' | 'internal-contact';
// Community edition: 'privacy' not a valid tab → ?tab=privacy falls back to 'manage'.
const VALID_TABS: TabKey[] = isExtension ? ['manage', 'privacy'] : ['manage'];
const activeTab = ref<TabKey>(VALID_TABS.includes(route.query.tab as TabKey) ? (route.query.tab as TabKey) : 'manage');
function setTab(t: TabKey) {
  activeTab.value = t;
  router.replace({ query: { ...route.query, tab: t === 'manage' ? undefined : t } });
  if (t === 'privacy') loadPrivacyCounter();
  if (t === 'internal-contact') loadInternalContactBadge();
}

// Phase Internal Contact 2-method 2026-05-23 — badge "Chưa setup" / "✓" trên tab
const internalContactBadge = ref<string>('');
const internalContactReady = ref(false);
async function loadInternalContactBadge() {
  try {
    const { data } = await api.get('/me/internal-contact');
    if (data.recipient?.status === 'ready') {
      internalContactBadge.value = '✓';
      internalContactReady.value = true;
    } else if (data.method) {
      internalContactBadge.value = 'pending';
      internalContactReady.value = false;
    } else {
      internalContactBadge.value = '!';
      internalContactReady.value = false;
    }
  } catch { /* silent */ }
}

// Counter (N/max) hiển thị trên tab "Riêng tư"
const privacyCounter = ref<{ used: number; max: number; atMax: boolean } | null>(null);
async function loadPrivacyCounter() {
  try {
    const { data } = await api.get<{ maxPrivacyNicks: number }>('/me/internal-contact');
    const myNicksRes = await api.get<{ nicks: Array<{ privacyMode: string }> }>('/privacy/my-nicks');
    // BE wraps response trong { nicks: [...] }
    const list = Array.isArray(myNicksRes.data) ? myNicksRes.data : (myNicksRes.data?.nicks ?? []);
    const used = list.filter((n) => n.privacyMode === 'main').length;
    privacyCounter.value = { used, max: data.maxPrivacyNicks, atMax: used >= data.maxPrivacyNicks };
  } catch { /* silent — counter optional */ }
}

// Phase 4 2026-05-22: Owner filter dropdown (KHÔNG còn "Sales" — đã đổi thành Owner per design).
// Derive từ accounts hiện tại, chỉ owner chính chủ (ownerUserId).
const ownerOptions = computed(() => {
  const map = new Map<string, { id: string; fullName: string | null; email: string }>();
  for (const a of filtered.value) {
    if (a.owner && !map.has(a.owner.id)) map.set(a.owner.id, a.owner);
  }
  return Array.from(map.values()).sort((a, b) =>
    (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email),
  );
});

// Phase 4 2026-05-22: Department tree (cascade filter chip).
// Fetch tree từ /departments → flatten to depth-indexed list cho dropdown.
interface DeptNode {
  id: string;
  name: string;
  path: string;
  depth: number;
  parentId: string | null;
  children?: DeptNode[];
}
const deptTree = ref<DeptNode[]>([]);
const deptFilter = ref<string[]>([]); // selected dept IDs (cascade — subtree path match)
const showDeptPicker = ref(false);
const groupByDept = ref(false);

async function fetchDeptTree() {
  try {
    const { data } = await api.get<{ tree: DeptNode[] }>('/departments');
    deptTree.value = data.tree;
  } catch {
    // Org chưa setup dept — không block UI
    deptTree.value = [];
  }
}

const deptFlatOptions = computed(() => {
  const out: { id: string; name: string; depth: number; path: string }[] = [];
  function walk(nodes: DeptNode[], depth: number) {
    for (const n of nodes) {
      out.push({ id: n.id, name: n.name, depth, path: n.path });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(deptTree.value, 0);
  return out;
});

// Build a Set of dept IDs whose `path` is under any selected dept path (cascade match).
const deptFilterSet = computed(() => {
  if (deptFilter.value.length === 0) return null; // null = no filter
  const selectedPaths = deptFlatOptions.value
    .filter((d) => deptFilter.value.includes(d.id))
    .map((d) => d.path);
  const matchedIds = new Set<string>();
  for (const d of deptFlatOptions.value) {
    for (const p of selectedPaths) {
      if (d.path.startsWith(p)) {
        matchedIds.add(d.id);
        break;
      }
    }
  }
  return matchedIds;
});

// Apply dept filter on top of `filtered` (which already covers search/status/sale).
const visibleAccounts = computed(() => {
  let list = filtered.value;
  const deptSet = deptFilterSet.value;
  if (deptSet) {
    list = list.filter((a) => a.ownerDepartment && deptSet.has(a.ownerDepartment.id));
  }
  return list;
});

// Owner reassign drawer
const reassignOpen = ref(false);
const reassignAccount = ref<EnrichedAccount | null>(null);

function onOpenReassign(account: EnrichedAccount) {
  reassignAccount.value = account;
  reassignOpen.value = true;
}
async function onReassigned(_accountId: string, _newOwnerUserId: string) {
  await refreshAll();
}

// Click outside dept picker → close
function onDocClick(e: MouseEvent) {
  if (!showDeptPicker.value) return;
  const t = e.target as HTMLElement;
  if (t.closest('.chip-multi')) return;
  showDeptPicker.value = false;
}
onMounted(() => document.addEventListener('click', onDocClick));
onUnmounted(() => document.removeEventListener('click', onDocClick));

// ─────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────
async function onRefresh() {
  await refreshAll();
  lastRefresh.value = new Date();
}

// ── Wizard kết nối 4 bước (2026-06-09) ──
// Tên sale ngắn (last word) cho màn chúc mừng.
const saleShortName = computed(() => {
  const f = authStore.user?.fullName?.trim();
  return f ? (f.split(/\s+/).pop() || f) : 'Bạn';
});

function openAddDialog() {
  wizardStep.value = 'phone';
  wizardPhone.value = '';
  connectedNickName.value = null;
  reviveAccountId.value = null; // T2: reset cờ revive mỗi lần mở wizard fresh
  wizardOpen.value = true;
}
function closeWizard() {
  wizardOpen.value = false;
  cancelQR(); // hủy phiên QR đang chờ (tránh nick treo qr_pending rác)
}

// T2 2026-06-20: id nick ĐÃ XÓA của chính mình khớp UID (BE check-phone trả reviveAccountId).
// → login THẲNG trên record cũ (revive) thay vì tạo nick mới ở bước Xác nhận.
const reviveAccountId = ref<string | null>(null);

// B1→B2: wizard đã gọi check-phone, lưu phone.
function onWizardChecked(payload: { phone: string; info: any }) {
  wizardPhone.value = payload.phone;
  reviveAccountId.value = payload.info?.reviveAccountId ?? null;
  if (payload.info?.found && payload.info?.info?.displayName) {
    connectedNickName.value = payload.info.info.displayName;
  }
}

// B2→B3: sale xác nhận → tạo nick (gửi kèm SĐT để BE check trùng owner) + login QR.
async function onWizardConfirmConnect() {
  wizardStep.value = 'qr';
  // T2 2026-06-20: nick ĐÃ XÓA của chính mình khớp UID → login THẲNG trên record cũ (revive),
  // KHÔNG tạo nick mới (giữ uid + toàn bộ tin nhắn cũ).
  if (reviveAccountId.value) {
    await loginAccount(reviveAccountId.value);
    return;
  }
  // displayName/proxy để trống — lấy tên thật sau QR. phone giúp BE chặn trùng (fix ①).
  const res = await addAccount('', undefined, wizardPhone.value);
  if (!res.ok) {
    // 409 trùng nick người khác → quay lại confirm, hiện thông báo chặn (fix ①).
    if (res.code === 'account_owned_by_other') {
      wizardStep.value = 'confirm';
      alert(res.message); // box chặn đã hiện ở B2; alert backup nếu sale bỏ qua check
    } else {
      wizardStep.value = 'phone';
      alert(res.message || 'Không tạo được nick. Thử lại.');
    }
    return;
  }
  // Nếu BE trả record cũ (nick của chính mình) → reconnect record đó, không tạo mới.
  if (res.reused && res.account?.id) {
    await onWizardReconnectExisting(res.account.id);
    return;
  }
  // Nick mới → trigger QR login. FIX #5 (2026-06-16): dùng THẲNG id BE vừa trả (res.account.id),
  // KHÔNG fetch list rồi đoán `list[length-1]` (sai nick nếu list sort khác created-asc hoặc 2
  // sale tạo nick song song → login QR nhầm nick).
  if (res.account?.id) await loginAccount(res.account.id);
  else { wizardStep.value = 'phone'; alert('Không lấy được nick vừa tạo. Thử lại.'); }
}

// Fix ①: trùng nick CỦA CHÍNH MÌNH → Kết nối lại record cũ (thử reconnect session;
// nếu hết session thì rơi về quét QR trên chính record đó, KHÔNG đẻ record mới).
async function onWizardReconnectExisting(accountId: string) {
  connectedNickName.value = wizardPhone.value;
  const r: any = await reconnectAccount(accountId);
  if (r?.needsQR || r?.success === false) {
    // Session cũ hết hạn → quét QR lại trên đúng record cũ.
    wizardStep.value = 'qr';
    await loginAccount(accountId);
  } else {
    // Reconnect thành công bằng session cũ → vào màn hoàn tất.
    wizardStep.value = 'done';
    await refreshAll();
  }
}

// T2 2026-06-20: nick mình NGẮT THỦ CÔNG / ĐÃ XÓA (phiên cũ đã đóng) → đi THẲNG quét QR mới
// trên chính record cũ (revive), KHÔNG gọi reconnectAccount (BE skip im lặng nick manual).
async function onWizardRescanExisting(accountId: string) {
  connectedNickName.value = wizardPhone.value;
  wizardStep.value = 'qr';
  await loginAccount(accountId);
}

function onWizardRetryQr() {
  // Tạo QR mới (FRESH phiên) cho nick đang chờ — dùng khi QR hết hiệu lực (qrSessionDead).
  const id = currentLoginAccountId.value;
  if (id) loginAccount(id);
}

// Khi QR dialog đóng lúc wizard đang ở bước QR → CHỈ báo "Hoàn tất" nếu nick THẬT SỰ
// connected (FIX #1 2026-06-16 — Anh chốt: Hoàn tất phải là nick connected thật, không phải
// "dialog đóng = xong"). Trước đây bất kỳ lý do nào đóng dialog (QR hết hạn, nick khác connect)
// đều nhảy 'done' giả. Giờ: refresh danh sách → kiểm nick đang login có liveStatus='connected'
// + có zaloUid; KHÔNG thì coi như chưa xong (giữ nguyên bước qr / đóng wizard tùy lý do).
watch(showQRDialog, async (open, was) => {
  if (!(was && !open && wizardOpen.value && wizardStep.value === 'qr')) return;
  const loginId = currentLoginAccountId.value;
  await refreshAll(); // refresh danh sách nick mới nhất trước khi verify
  // code-review: dùng `enriched` (danh sách GỐC) KHÔNG phải `filtered` — nếu sale đang bật ô
  // tìm/lọc trạng thái, nick vừa connected có thể bị filter loại → verify false oan → wizard
  // kẹt ở bước qr dù nick đã online. enriched luôn chứa mọi nick.
  const acct = enriched.value.find((a: EnrichedAccount) => a.id === loginId);
  const reallyConnected = !!acct
    && (acct.liveStatus || acct.status || '').toLowerCase() === 'connected'
    && !!acct.zaloUid;
  if (reallyConnected) {
    if (scannedName.value) connectedNickName.value = scannedName.value;
    else connectedNickName.value = acct!.displayName ?? connectedNickName.value;
    wizardStep.value = 'done';
  }
  // Nếu CHƯA connected thật: không báo done. Dialog đã đóng do QR hết hạn/lỗi → các handler
  // riêng (zalo:duplicate→closeWizard, qr-session-dead→giữ bước qr + nút Quét lại) lo phần đó.
});

// Fix ②: BE báo nick quét trúng zaloUid đã tồn tại (record rác đã bị dọn) → đóng wizard,
// hiện thông báo tử tế. Người dùng biết rõ vì sao "quét mãi không xong".
watch(duplicateInfo, (info) => {
  if (!info) return;
  closeWizard();
  alert(info.message);
  (duplicateInfo as any).value = null; // reset để lần sau còn trigger
});

// ── Grid card (tab Đơn giản) handlers ──
function openQrForReconnect(account: any) {
  wizardStep.value = 'qr';
  wizardOpen.value = true;
  connectedNickName.value = account.displayName ?? null;
  loginAccount(account.id);
}

async function onCardReconnect(account: any) {
  const live = (account.liveStatus || account.status || '').toLowerCase();
  // qr_pending (session hết hạn / circuit breaker) → cần quét QR lại.
  // 2026-06-16: nick NGẮT THỦ CÔNG (disconnectReason='manual') → cũng quét QR lại (Anh chốt:
  // "Kết nối lại = quét QR", không reconnect ngầm). loginQR sẽ clear reason khi connected.
  if (live === 'qr_pending' || account.disconnectReason === 'manual') {
    openQrForReconnect(account);
    return;
  }
  // Còn session → reconnect ngầm + báo feedback (trước đây nuốt lỗi im → "không hiện gì").
  reconnectingIds.value.add(account.id);
  try {
    const result = await reconnectAccount(account.id);
    if (result.success) {
      toast.push('Đang kết nối lại nick…', 'success');
    } else if (result.needsQR) {
      // Nick chưa có phiên lưu → mở QR thay vì reconnect ngầm.
      toast.push('Nick chưa có phiên lưu — mở quét QR để đăng nhập lại.', 'warning');
      openQrForReconnect(account);
    } else {
      toast.push('Kết nối lại thất bại: ' + result.message, 'error');
    }
  } finally {
    reconnectingIds.value.delete(account.id);
  }
}
function onConfirmDelete(account: any) {
  // Mở modal xác nhận (giống tab nâng cao). 2026-06-20 (T10): BE bỏ purge — xóa LUÔN là ẩn-mềm
  // (giữ uid + tin nhắn). Card chỉ cho xóa khi nick ĐÃ NGẮT.
  deleteTargetId.value = account.id;
  showDeleteDialog.value = true;
}

// Grid "Ngắt kết nối" → dùng chung flow disable (bulk-action) như tab nâng cao.
async function onCardDisconnect(account: any) {
  // eslint-disable-next-line no-alert
  if (!window.confirm('Ngắt kết nối nick này?')) return;
  try {
    await api.post('/zalo-accounts/bulk-action', { ids: [account.id], action: 'disable' });
    await refreshAll();
  } catch (e: any) {
    toast.push('Ngắt kết nối thất bại: ' + (e.response?.data?.error || e.message), 'error');
  }
}

function onTableAction(payload: { account: any; action: 'reconnect' | 'sync' }) {
  if (payload.action === 'reconnect') {
    if (payload.account.liveStatus === 'connected') {
      // Already connected → trigger sync-history instead as "refresh"
      api.post(`/zalo-accounts/${payload.account.id}/sync-history`).catch(() => {});
    } else if (payload.account.disconnectReason === 'manual' || (payload.account.liveStatus || '').toLowerCase() === 'qr_pending') {
      // 2026-06-16: ngắt thủ công / qr_pending → quét QR lại (không reconnect ngầm).
      openQrForReconnect(payload.account);
    } else {
      reconnectAccount(payload.account.id);
    }
  } else if (payload.action === 'sync') {
    api.post(`/zalo-accounts/${payload.account.id}/sync-contacts`)
      .then(() => refreshAll())
      .catch((e) => alert('Sync thất bại: ' + (e.response?.data?.error || e.message)));
  }
}

async function onDrawerAction(payload: { accountId: string; action: string }) {
  const id = payload.accountId;
  try {
    switch (payload.action) {
      case 'sync-contacts':
        await api.post(`/zalo-accounts/${id}/sync-contacts`);
        await refreshAll();
        toast.push('Đồng bộ danh bạ thành công', 'success');
        break;
      case 'sync-history':
        await api.post(`/zalo-accounts/${id}/sync-history`);
        toast.push('Đồng bộ lịch sử chat thành công', 'success');
        break;
      case 'reconnect':
        await reconnectAccount(id);
        break;
      case 'qr-login': {
        // 2026-06-11 FIX: mở wizard ở bước QR (ConnectNickWizard render qrImage) thay vì
        // loginAccount trần — trước đây chỉ set showQRDialog (dialog cũ không còn render)
        // → "bấm QR không nhảy QR". openQrForReconnect set wizardStep='qr' + loginAccount.
        const acct = filtered.value.find((a) => a.id === id);
        if (acct) openQrForReconnect(acct);
        else { wizardStep.value = 'qr'; wizardOpen.value = true; await loginAccount(id); }
        break;
      }
      case 'edit-proxy':
        // Simple inline prompt — replaces the dedicated proxy dialog for now.
        // eslint-disable-next-line no-alert
        const url = window.prompt('Proxy URL (để trống = xoá):', '');
        if (url === null) return; // cancelled
        await api.put(`/zalo-accounts/${id}/proxy`, { proxyUrl: url.trim() || null });
        await refreshAll();
        break;
      case 'disconnect':
        // eslint-disable-next-line no-alert
        if (!window.confirm('Ngắt kết nối nick này?')) return;
        await api.post('/zalo-accounts/bulk-action', { ids: [id], action: 'disable' });
        await refreshAll();
        toast.push('Đã ngắt kết nối nick', 'success');
        break;
      case 'delete':
        deleteTargetId.value = id;
        showDeleteDialog.value = true;
        break;
    }
  } catch (e: any) {
    toast.push('Lỗi: ' + (e.response?.data?.error || e.message), 'error');
  }
}

function onAddCrew(accountId: string) {
  const acct = filtered.value.find((a) => a.id === accountId);
  accessTargetId.value = accountId;
  accessTargetName.value = acct?.displayName || acct?.zaloUid || accountId;
  showAccessDialog.value = true;
}

async function onRemoveCrew(payload: { accountId: string; accessId: string }) {
  // eslint-disable-next-line no-alert
  if (!window.confirm('Bỏ gán sale này?')) return;
  try {
    await api.delete(`/zalo-accounts/${payload.accountId}/access/${payload.accessId}`);
    await refreshAll();
  } catch (e: any) {
    alert('Bỏ gán thất bại: ' + (e.response?.data?.error || e.message));
  }
}

function onAccessDialogClose() {
  // Refresh after the dialog closes so newly granted access shows up
  refreshAll();
}

async function onBulkAction(action: 'reconnect' | 'sync-contacts' | 'disable') {
  if (action === 'disable') {
    // eslint-disable-next-line no-alert
    if (!window.confirm(`Disable ${selectedCount.value} nick? Status sẽ chuyển sang disconnected.`)) return;
  }
  bulkLoading.value = true;
  try {
    const res = await bulkAction(action);
    if (res) {
      alert(`Hoàn tất: ${res.ok}/${res.total} thành công${res.failed ? `, ${res.failed} lỗi` : ''}`);
      clearSelection();
    }
  } finally {
    bulkLoading.value = false;
  }
}

async function handleDelete() {
  if (!deleteTarget.value) return;
  const ok = await deleteAccount(deleteTarget.value as any);
  if (ok) {
    showDeleteDialog.value = false;
    deleteTargetId.value = null;
    drawerOpen.value = false; // 2026-06-11: đóng drawer chi tiết sau khi xoá (giống main)
    toast.push('Đã ẩn nick khỏi quản lý (giữ tin nhắn — kết nối lại sẽ khôi phục)', 'success');
    await refreshAll();
  } else {
    toast.push('Xoá nick thất bại', 'error');
  }
}

// ─────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  setupSocket();
  await Promise.all([refreshAll(), fetchDeptTree(), loadPrivacyCounter(), loadInternalContactBadge(), loadSdkLimits()]);
  lastRefresh.value = new Date();

  // Light polling — refresh stats every 60s while page is open.
  // No refresh of enriched list to avoid blowing away in-flight selection state.
  const id = window.setInterval(() => {
    if (!document.hidden) fetchStats();
  }, 60_000);
  // Pin to view lifecycle
  (window as any).__zaPollId = id;
});
</script>

<style scoped>
/* Phase Privacy v2 2026-05-23 — Tab strip */
.za-tabs {
  display: flex; gap: 6px;
  border-bottom: 1px solid #E5E7EB;
  margin-bottom: 18px; padding-bottom: 0;
}
.za-tab {
  background: transparent; border: none; cursor: pointer;
  padding: 10px 18px; font-family: inherit; font-size: 13.5px; font-weight: 600;
  color: #6B7280; position: relative;
  border-bottom: 2px solid transparent; margin-bottom: -1px;
  transition: color 0.15s;
  display: inline-flex; align-items: center; gap: 6px;
}
.za-tab:hover { color: #374151; }
.za-tab.active { color: #5E6AD2; border-bottom-color: #5E6AD2; }
.za-tab-counter {
  font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 9999px;
  background: #EFF6FF; color: #1D4ED8;
  font-variant-numeric: tabular-nums;
}
.za-tab-counter.full { background: #FEF2F2; color: #B91C1C; }

/* 2026-06-09 — sub-tab Đơn giản / Nâng cao (cấp 2): pill segmented, cùng tông brand Atlas v2. */
.za-subtabs {
  display: inline-flex; gap: 3px; padding: 3px;
  background: #F3F4F6; border-radius: 10px;
  margin-bottom: 16px;
}
.za-subtab {
  background: transparent; border: none; cursor: pointer;
  padding: 7px 16px; font-family: inherit; font-size: 13px; font-weight: 600;
  color: #6B7280; border-radius: 7px;
  display: inline-flex; align-items: center; gap: 6px;
  transition: color .15s, background .15s, box-shadow .15s;
}
.za-subtab:hover { color: #374151; }
.za-subtab.active {
  color: #5E6AD2; background: #FFFFFF;
  box-shadow: 0 1px 2px rgba(16,24,40,.08);
}

/* Mục 1 — gạt nhóm theo trạng thái / người dùng (atlas v2) */
.za-groupby { display: inline-flex; align-items: center; gap: 6px; margin-bottom: 14px; }
.za-groupby-lbl { font-size: 12.5px; color: #6b7280; font-weight: 600; margin-right: 2px; }
.za-groupby-opt {
  background: #fff; border: 1px solid #e5e7eb; cursor: pointer;
  padding: 6px 14px; font-family: inherit; font-size: 12.5px; font-weight: 600;
  color: #6b7280; border-radius: 8px; transition: all .15s;
}
.za-groupby-opt:hover { border-color: #c7d2fe; color: #374151; }
.za-groupby-opt.active { background: #eef0ff; border-color: #5e6ad2; color: #5e6ad2; }

/* Phase 4 redesign 2026-05-22: filter chip Phòng ban + group-by toggle */
.chip-multi { position: relative; }
.chip-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; background: white; border: 1px solid #E4E5E9;
  border-radius: 6px; font-size: 13px; cursor: pointer;
  font-family: inherit; color: #374151;
}
.chip-btn:hover { background: #F9FAFB; border-color: #C7CCEB; }
.chip-multi.open .chip-btn { border-color: #5E6AD2; background: #EEF0FF; color: #4F5BC4; }
.chip-count {
  background: #5E6AD2; color: white;
  font-size: 10px; font-weight: 700;
  padding: 1px 6px; border-radius: 10px;
  line-height: 1.4;
}
.chip-caret { font-size: 10px; color: #9CA3AF; }
.chip-pop {
  position: absolute; top: 100%; left: 0; margin-top: 4px;
  background: white; border: 1px solid #E4E5E9; border-radius: 8px;
  box-shadow: 0 6px 24px rgba(15, 23, 42, 0.12);
  min-width: 260px; max-width: 360px;
  z-index: 50;
}
.chip-pop-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; border-bottom: 1px solid #F3F4F6;
  font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: .04em; font-weight: 600;
}
.chip-clear {
  background: transparent; border: none; color: #5E6AD2;
  font-size: 11px; cursor: pointer; font-family: inherit; font-weight: 600;
}
.chip-pop-list { max-height: 320px; overflow-y: auto; padding: 4px 0; }
.chip-pop-row {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px; font-size: 13px; color: #374151;
  cursor: pointer;
}
.chip-pop-row:hover { background: #F9FAFB; }
.chip-pop-empty { padding: 16px; text-align: center; color: #9CA3AF; font-size: 12px; }

.toggle-group {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 10px; background: white; border: 1px solid #E4E5E9;
  border-radius: 6px; font-size: 12.5px; color: #374151;
  cursor: pointer; user-select: none;
}
.toggle-group input { cursor: pointer; accent-color: #5E6AD2; }
.toggle-group:has(input:checked) { background: #EEF0FF; border-color: #5E6AD2; color: #4F5BC4; }

.za-page {
  padding: 20px 24px 120px;
  max-width: 1480px;
  margin: 0 auto;
}

.topbar {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 18px;
}
.topbar h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
  color: #111827;
}
.topbar .sub {
  font-size: 12.5px;
  color: #6B7280;
  margin-top: 2px;
}
.topbar .sub b { color: #111827; font-weight: 600 }
.topbar .sub .warn { color: #B91C1C; font-weight: 500 }
.topbar .sub .dot { margin: 0 6px; color: #D1D5DB }
.topbar .actions { display: flex; gap: 8px }

.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  border-radius: 8px;
  border: 1px solid #E5E7EB;
  background: white;
  cursor: pointer;
  font-size: 12.5px;
  color: #4B5563;
  font-weight: 500;
  transition: background 0.12s, border 0.12s, color 0.12s;
}
.btn:hover:not(:disabled) {
  border-color: #D1D5DB;
  color: #111827;
}
.btn:disabled { opacity: 0.55; cursor: not-allowed }
.btn svg { width: 14px; height: 14px }
.btn-primary {
  background: #6366F1;
  color: white;
  border-color: #6366F1;
}
.btn-primary:hover:not(:disabled) {
  background: #4F46E5;
  border-color: #4F46E5;
  color: white;
}
.btn-danger {
  background: #EF4444;
  color: white;
  border-color: #EF4444;
}
.btn-danger:hover:not(:disabled) {
  background: #DC2626;
  border-color: #DC2626;
}

.filter-row {
  display: flex;
  gap: 8px;
  align-items: center;
  background: white;
  border: 1px solid #F3F4F6;
  border-radius: 10px;
  padding: 8px 10px;
  margin-bottom: 12px;
}
.search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px;
  background: #F9FAFB;
  border: 1px solid #F3F4F6;
  border-radius: 8px;
  height: 32px;
}
.search input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 12.5px;
  color: #111827;
}
.search input::placeholder { color: #9CA3AF }
.search svg { width: 13px; height: 13px; color: #6B7280 }

.select {
  height: 32px;
  padding: 0 9px;
  border: 1px solid #E5E7EB;
  border-radius: 7px;
  background: white;
  font-size: 12px;
  color: #4B5563;
  cursor: pointer;
  font-family: inherit;
}
.select:hover { border-color: #D1D5DB }

/* MODAL */
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}
.modal {
  background: white;
  border-radius: 14px;
  width: 420px;
  max-width: 92vw;
  box-shadow: 0 24px 60px rgba(17, 24, 39, 0.18);
  overflow: hidden;
}
.modal-qr { width: 380px }
.modal-head {
  padding: 14px 18px;
  border-bottom: 1px solid #F3F4F6;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.modal-head h3 { margin: 0; font-size: 15px; font-weight: 600; color: #111827 }
.x-btn {
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 8px;
}
.modal-body {
  padding: 18px;
  font-size: 13px;
  color: #4B5563;
}
.modal-body.text-center { text-align: center }
.field { margin-bottom: 12px }
.field label {
  display: block;
  font-size: 11.5px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: .04em;
  margin-bottom: 4px;
}
.field input {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid #E5E7EB;
  border-radius: 7px;
  font-size: 13px;
  outline: none;
  font-family: inherit;
}
.field input:focus { border-color: #6366F1 }
.hint {
  font-size: 11px;
  color: #9CA3AF;
  margin-top: 4px;
}
.modal-foot {
  padding: 12px 18px;
  background: #FAFBFC;
  border-top: 1px solid #F3F4F6;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.qr-img-wrap img {
  max-width: 220px;
  margin-bottom: 14px;
}
.qr-step {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 5px 8px;
  border-radius: 7px;
  font-size: 12px;
  color: #6B7280;
  margin-bottom: 4px;
  text-align: left;
}
.qr-step.active {
  background: #EEF2FF;
  color: #4F46E5;
}
.qr-step .n {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #F3F4F6;
  color: #6B7280;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 10.5px;
}
.qr-step.active .n { background: #6366F1; color: white }
.qr-scanned p { color: #047857; font-weight: 500; margin: 8px 0 }
.qr-scanned .muted { color: #6B7280; font-weight: 400; font-size: 12px }
.error-text {
  color: #B91C1C;
  font-size: 12px;
  margin-top: 8px;
  background: #FEF2F2;
  padding: 6px 10px;
  border-radius: 6px;
}
.loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #F3F4F6;
  border-top-color: #6366F1;
  border-radius: 50%;
  margin: 20px auto;
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg) }
}
</style>
