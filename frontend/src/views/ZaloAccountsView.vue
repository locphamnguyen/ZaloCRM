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

    <!-- Phase Privacy v2 2026-05-23 — Tab strip: Quản lý nick / Riêng tư -->
    <div class="za-tabs">
      <button
        class="za-tab"
        :class="{ active: activeTab === 'manage' }"
        @click="setTab('manage')"
      >
        Quản lý nick
      </button>
      <button
        class="za-tab"
        :class="{ active: activeTab === 'privacy' }"
        @click="setTab('privacy')"
      >
        🔒 Riêng tư
        <span v-if="privacyCounter" class="za-tab-counter" :class="{ full: privacyCounter.atMax }">
          ({{ privacyCounter.used }}/{{ privacyCounter.max }})
        </span>
      </button>
    </div>

    <!-- Tab content: manage (default) -->
    <template v-if="activeTab === 'manage'">
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
      <!-- Phòng ban filter (multi-select) — Phase 4 2026-05-22 -->
      <div class="chip-multi" :class="{ open: showDeptPicker }">
        <button class="chip-btn" type="button" @click.stop="showDeptPicker = !showDeptPicker">
          <span>Phòng ban</span>
          <span v-if="deptFilter.length" class="chip-count">{{ deptFilter.length }}</span>
          <span class="chip-caret">▾</span>
        </button>
        <div v-if="showDeptPicker" class="chip-pop" @click.stop>
          <div class="chip-pop-head">
            <span>Lọc theo phòng ban (cascade)</span>
            <button v-if="deptFilter.length" class="chip-clear" @click="deptFilter = []">Bỏ tất cả</button>
          </div>
          <div class="chip-pop-list">
            <label
              v-for="d in deptFlatOptions"
              :key="d.id"
              class="chip-pop-row"
              :style="{ paddingLeft: 10 + d.depth * 14 + 'px' }"
            >
              <input type="checkbox" :value="d.id" v-model="deptFilter" />
              <span>{{ d.name }}</span>
            </label>
            <div v-if="!deptFlatOptions.length" class="chip-pop-empty">Chưa có phòng ban</div>
          </div>
        </div>
      </div>
      <select v-model="saleFilter" class="select">
        <option value="">Owner: Tất cả</option>
        <option v-for="u in ownerOptions" :key="u.id" :value="u.id">{{ u.fullName || u.email }}</option>
      </select>
      <label class="toggle-group">
        <input type="checkbox" v-model="groupByDept" />
        <span>Group theo phòng ban</span>
      </label>
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
      @open-detail="openDrawer"
      @action="onTableAction"
      @reassign-owner="onOpenReassign"
    />

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

    <!-- DETAIL DRAWER -->
    <AccountDetailDrawer
      v-model="drawerOpen"
      :account="drawerAccount"
      :uptime-cache="uptimeCache"
      :relative-time="relativeTime"
      :status-label="statusLabel"
      :uptime-color="uptimeColor"
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

    <!-- ADD ACCOUNT DIALOG -->
    <div v-if="showAddDialog" class="modal-backdrop" @click.self="showAddDialog = false">
      <div class="modal">
        <div class="modal-head">
          <h3>Kết nối nick Zalo mới</h3>
          <button class="x-btn" @click="showAddDialog = false">✕</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Tên hiển thị</label>
            <input v-model="newAccountName" placeholder="VD: Sale Hùng — Vinhomes" />
          </div>
          <div class="field">
            <label>Proxy URL (tùy chọn)</label>
            <input v-model="newAccountProxy" placeholder="http://user:pass@host:port" />
            <div class="hint">Để trống nếu kết nối Zalo trực tiếp qua internet</div>
          </div>
        </div>
        <div class="modal-foot">
          <button class="btn" @click="closeAddDialog">Huỷ</button>
          <button class="btn btn-primary" :disabled="adding" @click="handleAddAccount">
            {{ adding ? 'Đang tạo...' : 'Tạo + Quét QR' }}
          </button>
        </div>
      </div>
    </div>

    <!-- QR CODE DIALOG (reuse từ composable QR socket flow) -->
    <div v-if="showQRDialog" class="modal-backdrop">
      <div class="modal modal-qr">
        <div class="modal-head">
          <h3>Quét QR để đăng nhập Zalo</h3>
        </div>
        <div class="modal-body text-center">
          <div v-if="qrImage" class="qr-img-wrap">
            <img :src="'data:image/png;base64,' + qrImage" alt="QR" />
            <div class="qr-step active"><span class="n">1</span> Mở app Zalo trên điện thoại</div>
            <div class="qr-step"><span class="n">2</span> Cài đặt → Quản lý thiết bị → Quét QR</div>
            <div class="qr-step"><span class="n">3</span> Đợi xác thực hoàn tất</div>
          </div>
          <div v-else-if="qrScanned" class="qr-scanned">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
            <p>Đã quét! Xác nhận trên điện thoại…</p>
            <p v-if="scannedName" class="muted">{{ scannedName }}</p>
          </div>
          <div v-else>
            <div class="loading-spinner"></div>
            <p>Đang tạo QR code…</p>
          </div>
          <div v-if="qrError" class="error-text">{{ qrError }}</div>
        </div>
        <div class="modal-foot">
          <button class="btn" @click="cancelQR">Đóng</button>
        </div>
      </div>
    </div>

    <!-- DELETE CONFIRM -->
    <div v-if="showDeleteDialog" class="modal-backdrop" @click.self="showDeleteDialog = false">
      <div class="modal">
        <div class="modal-head"><h3>Xoá nick khỏi CRM</h3></div>
        <div class="modal-body">
          <p>Xoá nick "<b>{{ deleteTarget?.displayName || deleteTarget?.zaloUid || deleteTarget?.id }}</b>" khỏi quản lý?</p>
          <p class="hint">Nick sẽ bị ẩn khỏi danh sách. Nếu kết nối lại Zalo vào nick này, toàn bộ dữ liệu CRM sẽ hiện lại.</p>
          <label class="purge-check">
            <input type="checkbox" v-model="deletePurge" />
            <span>Xoá toàn bộ dữ liệu của nick Zalo này và không hoàn tác</span>
          </label>
          <p v-if="deletePurge" class="hint hint-danger">Nếu kết nối lại Zalo, sẽ tạo một nick CRM mới với dữ liệu CRM mới.</p>
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
import { ref, onMounted, computed, onUnmounted } from 'vue';
import { useZaloAccountsDashboard } from '@/composables/use-zalo-accounts-dashboard';
import { useToast } from '@/composables/use-toast';
import StatsCards from '@/components/zalo-accounts/StatsCards.vue';
import AccountsTable from '@/components/zalo-accounts/AccountsTable.vue';
import AccountDetailDrawer from '@/components/zalo-accounts/AccountDetailDrawer.vue';
import BulkActionBar from '@/components/zalo-accounts/BulkActionBar.vue';
import OwnerReassignDrawer from '@/components/zalo-accounts/OwnerReassignDrawer.vue';
import PrivacyNicksTab from '@/components/zalo-accounts/PrivacyNicksTab.vue';
import ZaloAccessDialog from '@/components/settings/ZaloAccessDialog.vue';
import { api } from '@/api/index';
import { useRoute, useRouter } from 'vue-router';
import type { EnrichedAccount } from '@/composables/use-zalo-accounts-dashboard';

const dash = useZaloAccountsDashboard();
const {
  // dashboard data
  stats, filtered, loadingStats, loadingEnriched,
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
  showQRDialog, qrImage, qrScanned, scannedName, qrError,
  adding, deleting,
  addAccount, loginAccount, reconnectAccount,
  cancelQR, setupSocket,
} = dash;

// Local UI state
const showAddDialog = ref(false);
const newAccountName = ref('');
const newAccountProxy = ref('');
const showDeleteDialog = ref(false);
const deleteTargetId = ref<string | null>(null);
const deletePurge = ref(false);
const bulkLoading = ref(false);
const _toast = useToast();
function showToast(text: string, type: 'success' | 'error' | 'warning' = 'success') {
  if (type === 'success') _toast.success(text);
  else if (type === 'error') _toast.error(text);
  else _toast.warning(text);
}
const lastRefresh = ref(new Date());

const showAccessDialog = ref(false);
const accessTargetId = ref('');
const accessTargetName = ref('');

const deleteTarget = computed(() => filtered.value.find((a) => a.id === deleteTargetId.value));

const lastRefreshLabel = computed(() => relativeTime(lastRefresh.value.toISOString()));

// Phase Privacy v2 2026-05-23 — Tab strip state + URL sync
const route = useRoute();
const router = useRouter();
type TabKey = 'manage' | 'privacy';
const activeTab = ref<TabKey>((route.query.tab as TabKey) === 'privacy' ? 'privacy' : 'manage');
function setTab(t: TabKey) {
  activeTab.value = t;
  router.replace({ query: { ...route.query, tab: t === 'manage' ? undefined : t } });
  if (t === 'privacy') loadPrivacyCounter();
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

function openAddDialog() {
  newAccountName.value = '';
  newAccountProxy.value = '';
  showAddDialog.value = true;
}
function closeAddDialog() {
  showAddDialog.value = false;
}

async function handleAddAccount() {
  const ok = await addAccount(newAccountName.value, newAccountProxy.value);
  if (ok) {
    showAddDialog.value = false;
    await refreshAll();
    // Auto-launch QR for the latest account
    // The created account is the most recent — find it and trigger login
    setTimeout(async () => {
      const list = await api.get('/zalo-accounts');
      const latest = list.data[list.data.length - 1];
      if (latest) await loginAccount(latest.id);
    }, 300);
  }
}

function onTableAction(payload: { account: any; action: 'reconnect' | 'sync' }) {
  if (payload.action === 'reconnect') {
    if (payload.account.liveStatus !== 'connected') {
      reconnectAccount(payload.account.id);
    }
  } else if (payload.action === 'sync') {
    api.post(`/zalo-accounts/${payload.account.id}/sync-contacts`)
      .then(() => { refreshAll(); showToast('Đồng bộ danh bạ thành công'); })
      .catch((e) => showToast('Sync thất bại: ' + (e.response?.data?.error || e.message), 'error'));
  }
}

async function onDrawerAction(payload: { accountId: string; action: string }) {
  const id = payload.accountId;
  try {
    switch (payload.action) {
      case 'sync-contacts':
        await api.post(`/zalo-accounts/${id}/sync-contacts`);
        await refreshAll();
        showToast('Đồng bộ danh bạ thành công');
        break;
      case 'sync-history':
        await api.post(`/zalo-accounts/${id}/sync-history`);
        showToast('Đồng bộ lịch sử chat thành công');
        break;
      case 'reconnect':
        await reconnectAccount(id);
        break;
      case 'qr-login':
        await loginAccount(id);
        break;
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
        break;
      case 'delete':
        deleteTargetId.value = id;
        showDeleteDialog.value = true;
        break;
    }
  } catch (e: any) {
    showToast('Lỗi: ' + (e.response?.data?.error || e.message), 'error');
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
  try {
    const purge = deletePurge.value;
    await api.delete(`/zalo-accounts/${deleteTarget.value.id}${purge ? '?purge=true' : ''}`);
    showDeleteDialog.value = false;
    deleteTargetId.value = null;
    deletePurge.value = false;
    drawerOpen.value = false;
    showToast(purge ? 'Đã xoá nick và dữ liệu' : 'Đã ẩn nick khỏi quản lý');
    await refreshAll();
  } catch (e: any) {
    showToast('Xoá thất bại: ' + (e.response?.data?.error || e.message), 'error');
  }
}

// ─────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────
onMounted(async () => {
  setupSocket();
  await Promise.all([refreshAll(), fetchDeptTree(), loadPrivacyCounter()]);
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
.purge-check {
  display: flex; align-items: flex-start; gap: 8px;
  margin-top: 12px; padding: 10px 12px;
  background: #FEF2F2; border: 1px solid #FECACA; border-radius: 8px;
  cursor: pointer; font-size: 12.5px; color: #991B1B; line-height: 1.4;
}
.purge-check input { margin-top: 2px; flex-shrink: 0; }
.hint-danger { color: #B91C1C; font-weight: 500; margin-top: 8px; }
</style>
