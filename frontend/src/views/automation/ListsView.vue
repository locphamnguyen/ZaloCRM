<template>
  <div class="lists-view">
    <header class="at-page-header">
      <div>
        <h1 class="at-page-title">📂 Tệp khách hàng</h1>
        <p class="at-page-subtitle">
          Paste hoặc upload danh sách SĐT → tạo Tệp KH với counter có/không Zalo, dedup tự động.
          Tệp KH làm <b>audience source</b> cho Sequence / Broadcast / Campaign sau này.
        </p>
      </div>
      <button class="at-btn at-btn--primary" @click="showCreate = true">
        <v-icon size="18">mdi-plus</v-icon>
        Tạo tệp mới
      </button>
    </header>

    <!-- Status tabs: Đang dùng / Lưu trữ -->
    <div class="status-tabs">
      <button
        class="status-tab"
        :class="{ active: listsStatus === 'active' }"
        @click="onSwitchStatus('active')"
      >
        <v-icon size="16">mdi-folder-account-outline</v-icon>
        Đang dùng
        <span class="count">{{ listsStatus === 'active' ? listsTotal : '' }}</span>
      </button>
      <button
        class="status-tab"
        :class="{ active: listsStatus === 'archived' }"
        @click="onSwitchStatus('archived')"
      >
        <v-icon size="16">mdi-archive-outline</v-icon>
        Lưu trữ
        <span class="count">{{ listsStatus === 'archived' ? listsTotal : '' }}</span>
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
      <div class="search">
        <v-icon size="14">mdi-magnify</v-icon>
        <input
          v-model="listsSearch"
          placeholder="Tìm tên tệp..."
          @input="debouncedFetch"
        />
      </div>
    </div>

    <!-- Empty state -->
    <div v-if="!loadingLists && lists.length === 0" class="empty-state">
      <div class="empty-icon">📂</div>
      <h3 v-if="listsStatus === 'archived'">Chưa có tệp nào lưu trữ</h3>
      <h3 v-else>Chưa có tệp khách hàng nào</h3>
      <p v-if="listsStatus === 'active'">
        Bấm "Tạo tệp mới" để paste/upload danh sách SĐT đầu tiên.
      </p>
      <p v-else-if="listsStatus === 'archived'">
        Tệp lưu trữ sẽ xuất hiện ở đây sau khi anh bấm "Lưu trữ" trên 1 tệp đang dùng.
      </p>
    </div>

    <!-- Lists table -->
    <div v-else class="lists-table-wrap">
      <table class="lists-table">
        <thead>
          <tr>
            <th>Tên tệp</th>
            <th>Ngày tạo</th>
            <th>Người tạo</th>
            <th>Nguồn</th>
            <th class="right">Tổng</th>
            <th class="right">Hợp lệ</th>
            <th class="right">Lỗi</th>
            <th class="right">Trùng</th>
            <th class="right">Có Zalo</th>
            <th>Tiến độ</th>
            <th>Trạng thái</th>
            <th class="right">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="list in lists"
            :key="list.id"
            class="row-clickable"
            @click="goToDetail(list.id)"
          >
            <td>
              <div class="list-name-cell">
                <!-- Auto-managed FB list: show mdi-facebook instead of emoji -->
                <template v-if="list.sourceType === 'api' && list.facebookSource">
                  <v-icon size="20" color="#1877F2" class="icon-em" aria-hidden="true">mdi-facebook</v-icon>
                </template>
                <span v-else class="icon-em">{{ list.iconEmoji || '📂' }}</span>
                <div>
                  <div class="nm">
                    {{ list.name }}
                    <v-tooltip
                      v-if="['api', 'webhook'].includes(list.sourceType)"
                      location="top"
                      text="📘 Tệp được liên kết tự động từ Facebook (hoặc nguồn tự động khác). Không thể đổi tên."
                    >
                      <template #activator="{ props: tp }">
                        <v-icon v-bind="tp" size="14" color="blue-grey" class="ms-1" aria-hidden="true">
                          mdi-lock-outline
                        </v-icon>
                      </template>
                    </v-tooltip>
                  </div>
                  <div class="sub">{{ list.totalEntries.toLocaleString('vi-VN') }} SĐT</div>
                </div>
              </div>
            </td>
            <td class="date">{{ formatDate(list.createdAt) }}</td>
            <td>
              <span class="author-cell">
                <span class="av" :style="avatarStyle(list.createdBy?.fullName ?? list.createdBy?.email ?? '?')">
                  {{ initials(list.createdBy?.fullName ?? list.createdBy?.email ?? '?') }}
                </span>
                {{ list.createdBy?.fullName ?? list.createdBy?.email ?? '—' }}
              </span>
            </td>
            <td>
              <span class="source-chip">{{ sourceLabel(list.sourceType) }}</span>
              <FacebookSourceBadge
                v-if="list.facebookSource"
                :form-name="list.facebookSource.formName"
                :page-name="list.facebookSource.pageName"
                :last-lead-at="list.facebookSource.lastLeadAt"
                :total-leads="list.facebookSource.totalFbLeads"
                style="margin-left: 6px;"
              />
            </td>
            <td class="num-cell">{{ list.totalEntries.toLocaleString('vi-VN') }}</td>
            <td class="num-cell green">{{ list.validEntries.toLocaleString('vi-VN') }}</td>
            <td class="num-cell" :class="list.invalidEntries > 0 ? 'red' : 'muted'">{{ list.invalidEntries.toLocaleString('vi-VN') }}</td>
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
              <div class="progress-bar" :title="`Hợp lệ ${progressPct(list, 'valid')}% · Lỗi ${progressPct(list, 'invalid')}% · Trùng ${progressPct(list, 'dup')}%`">
                <i class="ok" :style="{ width: progressPct(list, 'valid') + '%' }"></i>
                <i class="warn" :style="{ width: progressPct(list, 'dup') + '%' }"></i>
                <i class="bad" :style="{ width: progressPct(list, 'invalid') + '%' }"></i>
              </div>
            </td>
            <td>
              <span v-if="list.status === 'processing'" class="status-chip processing">
                <v-icon size="12">mdi-progress-clock</v-icon> Đang quét
              </span>
              <span v-else-if="list.status === 'archived'" class="status-chip archived">
                <v-icon size="12">mdi-archive</v-icon> Lưu trữ
              </span>
              <span v-else class="status-chip done">
                <v-icon size="12">mdi-check-circle</v-icon> Hoàn tất
              </span>
            </td>
            <td class="row-actions" @click.stop>
              <button class="icon-btn" title="Tạo campaign từ tệp này">
                <v-icon size="14">mdi-send</v-icon>
              </button>
              <button class="icon-btn" title="Export CSV">
                <v-icon size="14">mdi-download</v-icon>
              </button>
              <v-menu :close-on-content-click="true">
                <template #activator="{ props: act }">
                  <button v-bind="act" class="icon-btn" title="More">
                    <v-icon size="14">mdi-dots-vertical</v-icon>
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
                  <v-list-item @click="onDelete(list.id)" prepend-icon="mdi-delete-outline" class="danger">
                    <v-list-item-title style="color: #B91C1C">Xoá tệp</v-list-item-title>
                  </v-list-item>
                </v-list>
              </v-menu>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <CreateListModal v-model="showCreate" @created="onCreated" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useCustomerLists, type CustomerListSummary, type ListStatusFilter } from '@/composables/use-customer-lists';
import { formatInOrgTz } from '@/composables/use-org-timezone';
import CreateListModal from '@/components/automation/lists/CreateListModal.vue';
import FacebookSourceBadge from '@/components/automation/lists/FacebookSourceBadge.vue';
import '@/components/automation/phase7/airtable.css';

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
  router.push(`/automation/bot/lists/${id}`);
}

function onCreated(payload: { id: string }) {
  // Navigate to detail of newly created list
  router.push(`/automation/bot/lists/${payload.id}`);
}

async function onArchive(id: string) {
  if (!confirm('Lưu trữ tệp này? Tệp sẽ ẩn khỏi danh sách "Đang dùng" nhưng dữ liệu vẫn còn.')) return;
  await archiveList(id);
}

async function onUnarchive(id: string) {
  await unarchiveList(id);
}

async function onRescan(id: string) {
  const result = await rescanZalo(id);
  if (result?.ok) {
    alert(`Đã bắt đầu quét lại ${result.pendingLookup} SĐT. Refresh sau vài phút.`);
  }
}

async function onDelete(id: string) {
  if (!confirm('Xoá vĩnh viễn tệp này? Contact đã được tạo từ tệp sẽ KHÔNG bị xoá theo.')) return;
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
    case 'api': return 'API';
    default: return s;
  }
}

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

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const GRADIENTS: [string, string][] = [
  ['#6366F1', '#A855F7'],
  ['#10B981', '#059669'],
  ['#F59E0B', '#D97706'],
  ['#EC4899', '#BE185D'],
  ['#3B82F6', '#1D4ED8'],
];
function hashIdx(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
function avatarStyle(name: string): Record<string, string> {
  const [c1, c2] = GRADIENTS[hashIdx(name || '?', GRADIENTS.length)];
  return { background: `linear-gradient(135deg, ${c1}, ${c2})` };
}
</script>

<style scoped>
.lists-view {
  padding: 24px 28px 80px;
  max-width: 100%;
}

.status-tabs {
  display: flex; align-items: center; gap: 4px;
  background: #fff; border: 1px solid #E5E7EB; border-radius: 10px;
  padding: 6px; margin-bottom: 14px;
}
.status-tab {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 6px;
  background: transparent; border: none; cursor: pointer;
  font-size: 12.5px; font-weight: 500; color: #4B5563;
  font-family: inherit;
}
.status-tab:hover { background: #F4F5F8; color: #111827; }
.status-tab.active { background: #111827; color: #fff; }
.status-tab .count {
  background: rgba(0,0,0,.06); color: #4B5563;
  padding: 0 6px; border-radius: 99px;
  font-size: 10.5px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.status-tab.active .count {
  background: rgba(255,255,255,.18); color: #fff;
}
.spacer { flex: 1; }
.search {
  display: inline-flex; align-items: center; gap: 5px;
  background: #F4F5F8; border: 1px solid #EFF1F4;
  border-radius: 7px; padding: 0 9px;
  min-width: 220px; height: 32px;
}
.search input {
  border: none; background: transparent; outline: none;
  font-size: 12.5px; color: #111827;
  font-family: inherit; width: 100%;
}
.search input::placeholder { color: #9CA3AF; }

.empty-state {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 12px; padding: 64px 24px;
  text-align: center; color: #6B7280;
}
.empty-state .empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-state h3 { margin: 0 0 8px; color: #111827; font-size: 16px; }
.empty-state p { margin: 0; font-size: 13px; }

.lists-table-wrap {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 10px; overflow: auto;
}
.lists-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.lists-table thead th {
  background: #F4F5F8;
  font-size: 10.5px; font-weight: 600; color: #6B7280;
  text-transform: uppercase; letter-spacing: .04em;
  padding: 10px 10px; text-align: left;
  border-bottom: 1px solid #E5E7EB; white-space: nowrap;
}
.lists-table thead th.right { text-align: right; }
.lists-table tbody td {
  padding: 11px 10px;
  border-bottom: 1px solid #EFF1F4;
  vertical-align: middle; color: #111827;
}
.lists-table tbody tr.row-clickable { cursor: pointer; transition: background .1s; }
.lists-table tbody tr.row-clickable:hover { background: #FAFBFC; }
.lists-table tbody tr:last-child td { border-bottom: none; }

.list-name-cell { display: flex; align-items: center; gap: 8px; min-width: 0; }
.list-name-cell .icon-em { font-size: 18px; flex-shrink: 0; }
.list-name-cell .nm { font-weight: 600; color: #111827; font-size: 13px; }
.list-name-cell .sub { font-size: 11px; color: #6B7280; margin-top: 1px; }

.date { color: #4B5563; font-size: 12px; white-space: nowrap; }

.author-cell { display: inline-flex; align-items: center; gap: 6px; color: #4B5563; font-size: 12px; }
.author-cell .av {
  width: 22px; height: 22px; border-radius: 50%;
  color: #fff; font-size: 10px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}

.source-chip {
  display: inline-flex; align-items: center;
  font-size: 11px; color: #6B7280;
  background: #F4F5F8; padding: 2px 7px; border-radius: 5px;
}

.num-cell {
  font-family: "JetBrains Mono", Menlo, Consolas, monospace;
  font-size: 13px; font-weight: 600;
  font-variant-numeric: tabular-nums; text-align: right;
}
.num-cell.green { color: #047857; }
.num-cell.red { color: #B91C1C; }
.num-cell.amber { color: #B45309; }
.num-cell.blue { color: #1D4ED8; }
.num-cell.muted { color: #9CA3AF; font-weight: 400; }

.progress-cell { min-width: 120px; }
.progress-bar {
  display: flex; height: 6px; border-radius: 99px;
  overflow: hidden; background: #F4F5F8;
}
.progress-bar > i { display: block; height: 100%; }
.progress-bar .ok { background: #10B981; }
.progress-bar .warn { background: #F59E0B; }
.progress-bar .bad { background: #EF4444; }

.status-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 99px;
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
}
.status-chip.done { background: #D1FAE5; color: #047857; }
.status-chip.processing { background: #FEF3C7; color: #B45309; }
.status-chip.archived { background: #E5E7EB; color: #4B5563; }

.row-actions { text-align: right; white-space: nowrap; }
.icon-btn {
  width: 26px; height: 26px; border-radius: 5px;
  border: none; background: transparent; color: #6B7280;
  cursor: pointer; margin-left: 2px;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: #F4F5F8; color: #111827; }
</style>
