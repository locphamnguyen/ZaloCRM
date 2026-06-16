<template>
  <div class="lists-view">
    <!-- ================== TOPBAR (HS .mkt-top scaffold) ================== -->
    <div class="mkt-top">
      <div>
        <div class="mtt">Tệp khách hàng</div>
        <div class="mts">
          Paste / Excel / Lead Ads (FB · TikTok · Google · Zalo) đổ về tệp tự động theo <b>#mã</b> trong tên chiến dịch.
          Tệp KH làm <b>nguồn đối tượng</b> cho Sequence / Broadcast / Campaign.
        </div>
      </div>
      <div class="actions">
        <button class="btn btn-ghost btn-sm" disabled title="Nhập danh sách từ tệp CSV">
          <v-icon size="16">mdi-upload</v-icon> Import CSV
        </button>
        <button class="btn btn-primary btn-sm" @click="showCreate = true">
          <v-icon size="16">mdi-plus-circle-outline</v-icon> Tạo tệp
        </button>
      </div>
    </div>

    <div class="mkt-body">
      <!-- ============ STATS BAND (Atlas .mkt-stats) ============ -->
      <div class="mkt-stats stats-5">
        <button class="mstat clickable" :class="{ on: platformFilter === 'all' }" @click="onPlatformFilter('all')">
          <div class="mv num">{{ stats.totalLists.toLocaleString('vi-VN') }}</div>
          <div class="ml">Tổng tệp</div>
        </button>
        <button class="mstat clickable" :class="{ on: platformFilter === 'leadads' }" @click="onPlatformFilter('leadads')">
          <div class="mv num">{{ stats.leadAdsLists.toLocaleString('vi-VN') }}</div>
          <div class="ml"><v-icon size="13">mdi-bullhorn-outline</v-icon> Lead Ads</div>
        </button>
        <button class="mstat clickable" :class="{ on: platformFilter === 'paste' }" @click="onPlatformFilter('paste')">
          <div class="mv num">{{ stats.pasteLists.toLocaleString('vi-VN') }}</div>
          <div class="ml"><v-icon size="13">mdi-clipboard-text-outline</v-icon> Paste / File</div>
        </button>
        <div class="mstat">
          <div class="mv num">{{ stats.totalEntries.toLocaleString('vi-VN') }}</div>
          <div class="ml">SĐT trong các tệp</div>
        </div>
        <div class="mstat">
          <div class="mv num">{{ stats.totalHasZalo.toLocaleString('vi-VN') }}</div>
          <div class="ml">SĐT có Zalo</div>
        </div>
      </div>

      <!-- ============ Status tabs: Đang dùng / Lưu trữ ============ -->
      <div class="status-tabs">
        <button
          class="status-tab"
          :class="{ active: listsStatus === 'active' }"
          @click="onSwitchStatus('active')"
        >
          <v-icon size="16">mdi-folder-account-outline</v-icon>
          Đang dùng
          <span class="count num">{{ listsStatus === 'active' ? listsTotal : '' }}</span>
        </button>
        <button
          class="status-tab"
          :class="{ active: listsStatus === 'archived' }"
          @click="onSwitchStatus('archived')"
        >
          <v-icon size="16">mdi-archive-outline</v-icon>
          Lưu trữ
          <span class="count num">{{ listsStatus === 'archived' ? listsTotal : '' }}</span>
        </button>
        <button
          class="status-tab"
          :class="{ active: listsStatus === 'all' }"
          @click="onSwitchStatus('all')"
        >
          <v-icon size="16">mdi-view-list</v-icon>
          Tất cả
        </button>
        <div class="spacer"></div>
        <div class="field sm search">
          <v-icon size="16">mdi-magnify</v-icon>
          <input
            v-model="listsSearch"
            placeholder="Tìm tên tệp..."
            @input="debouncedFetch"
          />
        </div>
      </div>

      <!-- ============ Empty state ============ -->
      <div v-if="!loadingLists && lists.length === 0" class="empty">
        <v-icon size="40">mdi-folder-open-outline</v-icon>
        <h3 v-if="listsStatus === 'archived'">Chưa có tệp nào lưu trữ</h3>
        <h3 v-else>Chưa có tệp khách hàng nào</h3>
        <p v-if="listsStatus === 'active'">
          Bấm "Tạo tệp" để paste/upload danh sách SĐT đầu tiên.
        </p>
        <p v-else-if="listsStatus === 'archived'">
          Tệp lưu trữ sẽ xuất hiện ở đây sau khi anh bấm "Lưu trữ" trên 1 tệp đang dùng.
        </p>
      </div>

      <!-- ============ Lists table ============ -->
      <div v-else class="card table-card">
        <table class="tbl lists-table">
          <thead>
            <tr>
              <th>Tên tệp</th>
              <th>Số khách</th>
              <th>Nguồn</th>
              <th>Mã đồng bộ</th>
              <th>Chia sẻ</th>
              <th>Cập nhật</th>
              <th class="right">Hợp lệ</th>
              <th class="right">Trùng</th>
              <th class="right">Có Zalo</th>
              <th>Tiến độ</th>
              <th>Trạng thái</th>
              <th class="right"></th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="list in filteredLists"
              :key="list.id"
              class="row-clickable"
              @click="goToDetail(list.id)"
            >
              <td>
                <div class="list-name-cell">
                  <div class="tev">
                    <v-icon size="18">mdi-folder-outline</v-icon>
                  </div>
                  <div class="nst">
                    <div class="nm cell-strong">
                      {{ list.name }}
                      <v-icon
                        v-if="list.fbLocked"
                        size="13"
                        color="primary"
                        title="Tệp khoá: tạo tự động từ Facebook Lead Form — không thể xoá/đổi tên"
                      >mdi-lock</v-icon>
                    </div>
                    <div class="sub t-cap">{{ list.createdBy?.fullName ?? list.createdBy?.email ?? '—' }}</div>
                  </div>
                </div>
              </td>
              <td>
                <span class="num cell-strong">{{ list.totalEntries.toLocaleString('vi-VN') }}</span>
              </td>
              <td>
                <span
                  v-if="isAutoSource(list.sourceType)"
                  class="chip chip-blue"
                >
                  <v-icon size="12">mdi-lightning-bolt</v-icon> {{ sourceLabel(list.sourceType) }}
                </span>
                <span v-else class="t-sub">{{ sourceLabel(list.sourceType) }}</span>
              </td>
              <td>
                <span v-if="list.integrationKey === '__UNROUTED__'" class="key-chip unrouted" title="Lead chảy về tệp này vì không khớp #mã nào — anh nên đổi tên chiến dịch hoặc tạo tệp mới có mã đó.">
                  <v-icon size="12">mdi-alert</v-icon> UNROUTED
                </span>
                <span v-else-if="list.integrationKey" class="key-chip" :title="`Đặt tên chiến dịch FB/TikTok kèm #${list.integrationKey} để lead chảy về tệp này`">
                  #{{ list.integrationKey }}
                </span>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <span v-if="list.shareableToPool" class="chip chip-green" title="Tệp này đã chia sẻ vào Lead Pool — sale có quyền có thể nhận lead">
                  <v-icon size="12">mdi-account-multiple</v-icon> Pool
                </span>
                <span v-else class="muted">—</span>
              </td>
              <td class="date t-cap">{{ formatDate(list.createdAt) }}</td>
              <td class="num-cell green">{{ list.validEntries.toLocaleString('vi-VN') }}</td>
              <td class="num-cell" :class="dupTotal(list) > 0 ? 'amber' : 'muted'">{{ dupTotal(list).toLocaleString('vi-VN') }}</td>
              <td class="num-cell" :class="list.hasZaloEntries > 0 ? 'blue' : 'muted'">
                <template v-if="list.status === 'processing' && list.pendingLookupEntries > 0">
                  <span class="muted">— /{{ list.validEntries.toLocaleString('vi-VN') }}</span>
                </template>
                <template v-else>
                  {{ list.hasZaloEntries.toLocaleString('vi-VN') }}
                </template>
              </td>
              <td class="progress-cell">
                <div class="bar split" :title="`Hợp lệ ${progressPct(list, 'valid')}% · Lỗi ${progressPct(list, 'invalid')}% · Trùng ${progressPct(list, 'dup')}%`">
                  <i class="ok" :style="{ width: progressPct(list, 'valid') + '%' }"></i>
                  <i class="warn" :style="{ width: progressPct(list, 'dup') + '%' }"></i>
                  <i class="bad" :style="{ width: progressPct(list, 'invalid') + '%' }"></i>
                </div>
              </td>
              <td>
                <span v-if="list.status === 'processing'" class="chip chip-amber">
                  <v-icon size="12">mdi-progress-clock</v-icon> Đang quét
                </span>
                <span v-else-if="list.status === 'archived'" class="chip chip-grey">
                  <v-icon size="12">mdi-archive</v-icon> Lưu trữ
                </span>
                <span v-else class="chip chip-green">
                  <v-icon size="12">mdi-check-circle</v-icon> Hoàn tất
                </span>
              </td>
              <td class="row-actions" @click.stop>
                <button class="btn btn-ghost btn-icon btn-sm" title="Tạo campaign từ tệp này">
                  <v-icon size="15">mdi-send</v-icon>
                </button>
                <button class="btn btn-ghost btn-icon btn-sm" title="Export CSV">
                  <v-icon size="15">mdi-download</v-icon>
                </button>
                <v-menu :close-on-content-click="true">
                  <template #activator="{ props: act }">
                    <button v-bind="act" class="btn btn-ghost btn-icon btn-sm" title="More">
                      <v-icon size="15">mdi-dots-vertical</v-icon>
                    </button>
                  </template>
                  <v-list density="compact" min-width="180">
                    <v-list-item @click="onRescan(list.id)" prepend-icon="mdi-refresh">
                      <v-list-item-title>Quét lại Zalo</v-list-item-title>
                    </v-list-item>
                    <v-list-item
                      v-if="list.archivedAt"
                      @click="onUnarchive(list.id)"
                      prepend-icon="mdi-archive-arrow-up-outline"
                    >
                      <v-list-item-title>Đưa khỏi lưu trữ</v-list-item-title>
                    </v-list-item>
                    <v-list-item
                      v-else
                      @click="onArchive(list.id)"
                      prepend-icon="mdi-archive-outline"
                    >
                      <v-list-item-title>Lưu trữ</v-list-item-title>
                    </v-list-item>
                    <v-divider />
                    <v-list-item
                      v-if="list.fbLocked"
                      disabled
                      prepend-icon="mdi-lock"
                      title="Tệp khoá: tạo tự động từ Facebook Lead Form — ngắt kết nối form trước khi xoá"
                    >
                      <v-list-item-title style="color: var(--text-muted)">Khoá (FB Form)</v-list-item-title>
                    </v-list-item>
                    <v-list-item v-else @click="onDelete(list.id)" prepend-icon="mdi-delete-outline" class="danger">
                      <v-list-item-title style="color: var(--error)">Xoá tệp</v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-menu>
                <button class="btn btn-icon btn-sm go-arrow" title="Mở tệp">
                  <v-icon size="15">mdi-arrow-right</v-icon>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <CreateListModal v-model="showCreate" @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useCustomerLists, type CustomerListSummary, type ListStatusFilter } from '@/composables/use-customer-lists';
import { formatInOrgTz } from '@/composables/use-org-timezone';
import CreateListModal from '@/components/automation/lists/CreateListModal.vue';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

const toast = useToast();
const { confirm } = useConfirm();

// Phase Multi-Source Lead Ads 2026-05-27 — platform filter
type PlatformFilter = 'all' | 'leadads' | 'paste';
const platformFilter = ref<PlatformFilter>('all');

function onPlatformFilter(p: PlatformFilter) {
  platformFilter.value = p;
}

const router = useRouter();
const {
  lists,
  listsTotal,
  loadingLists,
  listsStatus,
  listsSearch,
  fetchLists,
  archiveList,
  unarchiveList,
  rescanZalo,
  deleteList,
} = useCustomerLists();

const showCreate = ref(false);

onMounted(() => fetchLists());

function onSwitchStatus(s: ListStatusFilter) {
  listsStatus.value = s;
  fetchLists();
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedFetch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => fetchLists(), 300);
}

function goToDetail(id: string) {
  router.push(`/marketing/lists/${id}`);
}

function onCreated(payload: { id: string }) {
  // Navigate to detail of newly created list
  router.push(`/marketing/lists/${payload.id}`);
}

async function onArchive(id: string) {
  if (!(await confirm({
    title: 'Lưu trữ tệp này?',
    message: 'Tệp sẽ ẩn khỏi danh sách "Đang dùng" nhưng dữ liệu vẫn còn.',
    tone: 'danger',
    confirmText: 'Lưu trữ',
    cancelText: 'Hủy',
  }))) return;
  await archiveList(id);
}

async function onUnarchive(id: string) {
  await unarchiveList(id);
}

async function onRescan(id: string) {
  const result = await rescanZalo(id);
  if (result?.ok) {
    toast.success(`Đã bắt đầu quét lại ${result.pendingLookup} SĐT. Refresh sau vài phút.`);
  }
}

async function onDelete(id: string) {
  if (!(await confirm({
    title: 'Xoá vĩnh viễn tệp này?',
    message: 'Contact đã được tạo từ tệp sẽ KHÔNG bị xoá theo.',
    tone: 'danger',
    confirmText: 'Xoá',
    cancelText: 'Hủy',
  }))) return;
  await deleteList(id);
}

// ───────── Helpers ─────────
function formatDate(iso: string): string {
  return formatInOrgTz(iso);
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'paste': return 'Paste';
    case 'csv': return 'CSV';
    case 'excel': return 'Excel';
    case 'leadads': return 'Lead Ads';
    case 'api': return 'API';
    default: return s;
  }
}

// Phase Multi-Source Lead Ads 2026-05-27 — nguồn tự động (leadads/api) hiển thị chip-blue + tia chớp
function isAutoSource(s: string): boolean {
  return s === 'leadads' || s === 'api';
}

const filteredLists = computed(() => {
  if (platformFilter.value === 'all') return lists.value;
  if (platformFilter.value === 'leadads') {
    return lists.value.filter((l) => l.sourceType === 'leadads' || l.sourceType === 'api');
  }
  if (platformFilter.value === 'paste') {
    return lists.value.filter((l) => l.sourceType === 'paste' || l.sourceType === 'csv' || l.sourceType === 'excel');
  }
  return lists.value;
});

const stats = computed(() => {
  let leadAdsLists = 0, pasteLists = 0;
  let totalEntries = 0, totalHasZalo = 0;
  for (const l of lists.value) {
    if (l.sourceType === 'leadads' || l.sourceType === 'api') leadAdsLists++;
    else pasteLists++;
    totalEntries += l.totalEntries;
    totalHasZalo += l.hasZaloEntries;
  }
  return {
    totalLists: lists.value.length,
    leadAdsLists,
    pasteLists,
    totalEntries,
    totalHasZalo,
  };
});

function dupTotal(l: CustomerListSummary): number {
  return l.dupInListEntries + l.dupCrossListEntries + l.dupWithContactEntries;
}

function progressPct(l: CustomerListSummary, kind: 'valid' | 'invalid' | 'dup'): number {
  if (l.totalEntries === 0) return 0;
  if (kind === 'valid') {
    const validOnly = l.validEntries - dupTotal(l);
    return Math.max(0, (validOnly / l.totalEntries) * 100);
  }
  if (kind === 'invalid') return (l.invalidEntries / l.totalEntries) * 100;
  if (kind === 'dup') return (dupTotal(l) / l.totalEntries) * 100;
  return 0;
}
</script>

<style scoped>
/* ════════════════════════════════════════════════════════════
   Tệp khách hàng (ListsView) — Atlas HS Holding re-skin 2026-06-06
   Scaffold dùng .mkt-top / .mkt-body / .mkt-stats từ hs-crm-theme.css.
   CSS-only override cho phần custom: status-tabs, key-chip, bar split,
   num-cell màu. Token hoá toàn bộ — KHÔNG hardcode hex lạ.
   ════════════════════════════════════════════════════════════ */
.lists-view { background: var(--surface-2); min-height: 100%; }

/* stats band — 5 cột thay vì 4 mặc định */
.mkt-stats.stats-5 { grid-template-columns: repeat(5, 1fr); }
.mstat.clickable { text-align: left; cursor: pointer; transition: border-color .12s, background .12s; }
.mstat.clickable:hover { border-color: var(--brand-soft); }
.mstat.clickable.on { border-color: var(--brand); background: var(--brand-softer); }
.mstat .ml { display: inline-flex; align-items: center; gap: 4px; }

/* ───── Status tabs ───── */
.status-tabs {
  display: flex; align-items: center; gap: 4px;
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-md);
  padding: 6px; margin-bottom: 14px;
}
.status-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: var(--r-xs);
  background: transparent; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 500; color: var(--ink-2);
}
.status-tab:hover { background: var(--surface-3); color: var(--ink); }
.status-tab.active { background: var(--ink); color: #fff; }
.status-tab .count {
  background: var(--surface-3); color: var(--ink-2);
  padding: 0 6px; border-radius: var(--r-pill);
  font-size: 10.5px; font-weight: 700;
}
.status-tab.active .count { background: rgba(255,255,255,.18); color: #fff; }
.spacer { flex: 1; }
.search { min-width: 220px; }

/* ───── Table ───── */
.table-card { overflow: auto; padding: 0; }
.lists-table th.right, .lists-table td.right { text-align: right; }

.list-name-cell { display: flex; align-items: center; gap: 10px; min-width: 0; }
/* .tev trong theme scope dưới .tgt — định nghĩa base ở đây cho icon folder 32px */
.list-name-cell .tev {
  width: 32px; height: 32px; border-radius: var(--r-sm); flex: none;
  background: var(--brand-soft); color: var(--brand);
  display: flex; align-items: center; justify-content: center;
}
.list-name-cell .nst { min-width: 0; }
.list-name-cell .nm { font-size: 13px; }
.list-name-cell .sub { margin-top: 1px; }

.date { white-space: nowrap; }

.num-cell {
  font-family: var(--mono);
  font-size: 13px; font-weight: 600;
  font-variant-numeric: tabular-nums; text-align: right;
}
.num-cell.green { color: #157f3c; }
.num-cell.amber { color: #b45309; }
.num-cell.blue { color: var(--brand-700); }
.num-cell.muted { color: var(--ink-4); font-weight: 400; }

/* progress bar — reuse .bar, split thành 3 đoạn ok/warn/bad */
.progress-cell { min-width: 120px; }
.bar.split { display: flex; }
.bar.split > i { display: block; height: 100%; }
.bar.split .ok { background: var(--success); }
.bar.split .warn { background: var(--warning); }
.bar.split .bad { background: var(--error); }

/* key-chip (mã đồng bộ) — mono pill */
.key-chip {
  display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
  font-family: var(--mono); font-weight: 600;
  font-size: 11px; background: var(--surface-3); color: var(--ink);
  border-radius: var(--r-xs); letter-spacing: .5px;
}
.key-chip.unrouted { background: var(--error-soft); color: #b42318; }

.muted { color: var(--ink-4); font-size: 12px; }

.row-actions { text-align: right; white-space: nowrap; }
.row-actions .btn { margin-left: 2px; }
.go-arrow { background: var(--brand-soft); color: var(--brand-700); }
.go-arrow:hover { background: #d6e8f5; }

/* empty state — reuse .empty từ theme + heading riêng */
.empty {
  background: var(--surface); border: 1px solid var(--line);
  border-radius: var(--r-lg); padding: 56px 24px; margin-top: 4px;
}
.empty .v-icon { color: var(--ink-4); }
.empty h3 { margin: 12px 0 6px; color: var(--ink); font-size: 16px; font-weight: 700; }
.empty p { margin: 0; font-size: 13px; color: var(--ink-3); }
</style>
