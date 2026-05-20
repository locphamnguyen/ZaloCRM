<template>
  <div class="list-detail-view">
    <!-- Breadcrumb -->
    <div class="breadcrumb">
      <a @click="$router.push('/automation/bot/lists')">
        <v-icon size="14">mdi-folder-account-outline</v-icon> Tệp khách hàng
      </a>
      <span class="sep">›</span>
      <span>{{ currentList?.name ?? '...' }}</span>
    </div>

    <!-- Hero: title + actions + stats -->
    <div v-if="currentList" class="detail-hero">
      <div class="hero-head">
        <div>
          <h2>
            <span>{{ currentList.iconEmoji || '📂' }}</span>
            {{ currentList.name }}
            <span v-if="currentList.archivedAt" class="archived-tag">
              <v-icon size="13">mdi-archive</v-icon> Lưu trữ
            </span>
          </h2>
          <div class="sub">
            Tạo <b>{{ formatDate(currentList.createdAt) }}</b>
            bởi <b>{{ currentList.createdBy?.fullName ?? currentList.createdBy?.email ?? '—' }}</b>
            · Nguồn <b>{{ sourceLabel(currentList.sourceType) }}</b>
          </div>
        </div>
        <div class="hero-actions">
          <button class="at-btn at-btn--primary">
            <v-icon size="16">mdi-send</v-icon>
            Tạo campaign từ tệp này
          </button>
          <button class="at-btn" @click="onRescan">
            <v-icon size="16">mdi-refresh</v-icon>
            Quét lại Zalo
          </button>
          <button class="at-btn">
            <v-icon size="16">mdi-download</v-icon>
            Export CSV
          </button>
          <v-menu :close-on-content-click="true">
            <template #activator="{ props: act }">
              <button v-bind="act" class="at-btn at-btn--ghost">
                <v-icon size="16">mdi-dots-vertical</v-icon>
              </button>
            </template>
            <v-list density="compact" min-width="200">
              <v-list-item
                v-if="currentList.archivedAt"
                @click="onUnarchive"
                prepend-icon="mdi-archive-arrow-up-outline"
              >
                <v-list-item-title>Đưa khỏi lưu trữ</v-list-item-title>
              </v-list-item>
              <v-list-item
                v-else
                @click="onArchive"
                prepend-icon="mdi-archive-outline"
              >
                <v-list-item-title>Lưu trữ</v-list-item-title>
              </v-list-item>
              <v-divider />
              <v-list-item @click="onDelete" prepend-icon="mdi-delete-outline">
                <v-list-item-title style="color:#B91C1C">Xoá tệp</v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </div>

      <!-- Hero stats — clickable to filter tab -->
      <div class="hero-stats">
        <div
          class="hero-stat"
          :class="{ active: entryTab === 'all' }"
          @click="setTab('all')"
        >
          <div class="l">Tổng SĐT</div>
          <div class="v">{{ currentList.totalEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">100%</div>
        </div>
        <div
          class="hero-stat green"
          :class="{ active: entryTab === 'valid' }"
          @click="setTab('valid')"
        >
          <div class="l">Hợp lệ</div>
          <div class="v">{{ currentList.validEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ pct(currentList.validEntries, currentList.totalEntries) }}%</div>
        </div>
        <div
          class="hero-stat red"
          :class="{ active: entryTab === 'invalid' }"
          @click="setTab('invalid')"
        >
          <div class="l">Lỗi format</div>
          <div class="v">{{ currentList.invalidEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ pct(currentList.invalidEntries, currentList.totalEntries) }}%</div>
        </div>
        <div
          class="hero-stat amber"
          :class="{ active: entryTab === 'dup' }"
          @click="setTab('dup')"
        >
          <div class="l">Trùng</div>
          <div class="v">{{ dupTotal(currentList).toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ currentList.dupInListEntries }} list + {{ currentList.dupWithContactEntries }} CRM</div>
        </div>
        <div
          class="hero-stat blue"
          :class="{ active: entryTab === 'has_zalo' }"
          @click="setTab('has_zalo')"
          title="Đã match Friend table hoặc SDK lookup xác nhận có Zalo"
        >
          <div class="l">Có Zalo</div>
          <div class="v">{{ currentList.hasZaloEntries.toLocaleString('vi-VN') }}</div>
          <div class="pct">{{ pct(currentList.hasZaloEntries, currentList.validEntries) }}% / hợp lệ</div>
        </div>
        <div
          class="hero-stat"
          :class="{ active: entryTab === 'no_zalo' }"
          @click="setTab('no_zalo')"
          title="Đã check Friend table xong nhưng không match. Chưa biết chắc — cần Campaign SDK scan."
        >
          <div class="l">Chưa quét SDK</div>
          <div class="v">{{ notScannedSdk.toLocaleString('vi-VN') }}</div>
          <div class="pct">cần Campaign quét xác nhận</div>
        </div>
      </div>
    </div>

    <!-- Sub-tabs filter -->
    <div class="subtabs">
      <button class="subtab" :class="{ active: entryTab === 'all' }" @click="setTab('all')">
        Tất cả <span class="count">{{ currentList?.totalEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'valid' }" @click="setTab('valid')">
        ✓ Hợp lệ <span class="count">{{ currentList?.validEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'invalid' }" @click="setTab('invalid')">
        ✗ Lỗi format <span class="count">{{ currentList?.invalidEntries.toLocaleString('vi-VN') ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup' }" @click="setTab('dup')">
        ⚠ Trùng <span class="count">{{ dupTotal(currentList).toLocaleString('vi-VN') }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_in_list' }" @click="setTab('dup_in_list')">
        ↺ Trùng list này <span class="count">{{ currentList?.dupInListEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_cross_list' }" @click="setTab('dup_cross_list')">
        ↔ Trùng list khác <span class="count">{{ currentList?.dupCrossListEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'dup_with_crm' }" @click="setTab('dup_with_crm')">
        ⚷ Trùng CRM <span class="count">{{ currentList?.dupWithContactEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'has_zalo' }" @click="setTab('has_zalo')">
        📱 Có Zalo <span class="count">{{ currentList?.hasZaloEntries ?? 0 }}</span>
      </button>
      <button class="subtab" :class="{ active: entryTab === 'no_zalo' }" @click="setTab('no_zalo')" title="Đã check Friend xong, chưa biết Zalo — cần Campaign SDK scan">
        ❓ Chưa quét SDK <span class="count">{{ notScannedSdk }}</span>
      </button>
    </div>

    <!-- Filter strip -->
    <div class="filter-strip">
      <div class="search">
        <v-icon size="14">mdi-magnify</v-icon>
        <input
          v-model="entrySearch"
          placeholder="Tìm SĐT, tên KH, UID..."
          @input="debouncedFetchEntries"
        />
      </div>
    </div>

    <!-- Entries table -->
    <div class="entries-wrap">
      <table class="entries-table">
        <thead>
          <tr>
            <th style="width:30px">
              <input
                type="checkbox"
                class="chk"
                :checked="allSelectedVisible"
                :indeterminate.prop="someSelected && !allSelectedVisible"
                @change="onToggleAllVisible"
              />
            </th>
            <th>#</th>
            <th title="Phone gốc anh paste">📋 Phone (paste)</th>
            <th title="Phone E.164 chuẩn quốc tế">🌐 Phone (+84)</th>
            <th title="Phone local VN (0xxx)">🇻🇳 Phone (local)</th>
            <th>Tên KH (file)</th>
            <th>Tên KH (Zalo)</th>
            <th title="Lời mời / tin nhắn riêng cho KH này (chỉ có khi import từ CSV/Excel)">💬 Lời mời riêng</th>
            <th>Trạng thái</th>
            <th>Zalo UID</th>
            <th>Nick tìm ra</th>
            <th>Global ID</th>
            <th title="Thông báo hệ thống — lý do invalid, dup, error">⚙️ Thông báo hệ thống</th>
            <th class="right">Action</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="loadingEntries">
            <td colspan="14" class="loading-cell">⏳ Đang tải...</td>
          </tr>
          <tr v-else-if="entries.length === 0">
            <td colspan="14" class="empty-cell">Không có SĐT nào ở tab này</td>
          </tr>
          <tr
            v-for="entry in entries"
            :key="entry.id"
            :class="{ selected: isSelected(entry.id) }"
            @click="onRowClick(entry.id, $event)"
          >
            <td @click.stop>
              <input
                type="checkbox"
                class="chk"
                :checked="isSelected(entry.id)"
                @change="toggleSelect(entry.id)"
              />
            </td>
            <td class="ix">#{{ entry.rowIndex }}</td>
            <td class="phone-cell raw">{{ entry.phoneRaw }}</td>
            <td class="phone-cell e164">{{ entry.phoneE164 || '—' }}</td>
            <td class="phone-cell local">{{ entry.phoneLocal || '—' }}</td>
            <td class="name">
              <template v-if="entry.nameRaw">{{ entry.nameRaw }}</template>
              <span v-else class="muted-italic">(không có)</span>
            </td>
            <td class="name-zalo" :class="entry.zaloName ? 'has' : 'no'">
              <template v-if="entry.zaloName">{{ entry.zaloName }}</template>
              <template v-else-if="entry.status === 'invalid'">—</template>
              <template v-else>(chưa có)</template>
            </td>
            <td class="personal-note" :title="entry.personalNote || ''">
              <template v-if="entry.personalNote">{{ entry.personalNote }}</template>
              <span v-else class="muted-italic">—</span>
            </td>
            <td>
              <span class="status-pill" :class="statusPillClass(entry.status, entry.hasZalo)">
                {{ statusPillLabel(entry.status, entry.hasZalo) }}
              </span>
            </td>
            <td class="uid-cell" :class="{ empty: !entry.zaloUid }">
              {{ entry.zaloUid || '—' }}
            </td>
            <td>
              <span v-if="entry.resolvedByNick" class="nick-cell">
                <span class="av" :style="nickAvatarStyle(entry.resolvedByNick.displayName ?? '?')">
                  {{ initials(entry.resolvedByNick.displayName ?? '?') }}
                </span>
                {{ entry.resolvedByNick.displayName ?? '—' }}
                <span v-if="entry.multiNickCount > 0" class="more">+{{ entry.multiNickCount }}</span>
              </span>
              <span v-else class="muted-italic">—</span>
            </td>
            <td>
              <span v-if="entry.zaloGlobalId" class="global-id">{{ entry.zaloGlobalId }}</span>
              <span v-else class="global-id empty">—</span>
            </td>
            <td>
              <template v-if="entry.errorMessage">
                <span class="err-note">{{ entry.errorMessage }}</span>
              </template>
              <template v-else-if="entry.status === 'invalid'">
                <span class="err-note">{{ entry.invalidReason || '—' }}</span>
              </template>
              <template v-else-if="entry.status === 'dup_in_list'">
                <span class="dup-note">Trùng entry trong list này</span>
              </template>
              <template v-else-if="entry.status === 'dup_cross_list' && entry.dupWithListName">
                <span class="dup-note">Trùng tệp "{{ entry.dupWithListName }}"</span>
              </template>
              <template v-else-if="entry.status === 'dup_with_crm'">
                <span class="dup-note">Đã có Contact trong CRM</span>
              </template>
              <span v-else class="muted-italic">—</span>
            </td>
            <td class="row-actions" @click.stop>
              <button class="icon-btn" title="Mở Contact" v-if="entry.contactId">
                <v-icon size="13">mdi-open-in-new</v-icon>
              </button>
              <button class="icon-btn" title="Xoá entry">
                <v-icon size="13">mdi-delete-outline</v-icon>
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div v-if="entriesTotal > entryLimit" class="pag">
      <span>
        Hiện <b>{{ ((entryPage - 1) * entryLimit) + 1 }}–{{ Math.min(entryPage * entryLimit, entriesTotal) }}</b>
        / <b>{{ entriesTotal.toLocaleString('vi-VN') }}</b> SĐT
      </span>
      <div class="ctrls">
        <button :disabled="entryPage === 1" @click="goPage(entryPage - 1)">‹ Trước</button>
        <button class="cur">{{ entryPage }}</button>
        <button :disabled="entryPage * entryLimit >= entriesTotal" @click="goPage(entryPage + 1)">Sau ›</button>
      </div>
    </div>

    <!-- Bulk action bar -->
    <div v-if="selectedCount > 0" class="bulk-bar">
      <span class="ct"><em>{{ selectedCount }}</em>SĐT đã chọn</span>
      <span class="div"></span>
      <button @click="onBulk('skip')">↻ Bỏ qua (skip)</button>
      <button @click="onBulk('keep_both')">⊕ Tạo song song</button>
      <button @click="onBulk('delete')" class="danger">🗑 Xoá</button>
      <span class="div"></span>
      <button class="x" @click="clearSelection">✕</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useCustomerLists, type CustomerListSummary } from '@/composables/use-customer-lists';
import '@/components/automation/phase7/airtable.css';

const route = useRoute();
const router = useRouter();
const {
  currentList,
  entries,
  entriesTotal,
  loadingEntries,
  entryTab,
  entrySearch,
  entryPage,
  entryLimit,
  fetchListById,
  fetchEntries,
  archiveList,
  unarchiveList,
  rescanZalo,
  deleteList,
  bulkResolveEntries,
  selectedCount,
  toggleSelect,
  selectAllVisible,
  clearSelection,
  isSelected,
} = useCustomerLists();

const listId = computed(() => route.params.id as string);

/**
 * notScannedSdk = entries valid - hasZalo - dup(3) - skipped
 * = entries đã enriched (worker check Friend xong) nhưng chưa match → chờ Campaign SDK scan.
 * v1: noZaloEntries luôn = 0 (chưa có SDK confirm), nên dùng computed này thay thế.
 */
const notScannedSdk = computed<number>(() => {
  const l = currentList.value;
  if (!l) return 0;
  const dupTotal = l.dupInListEntries + l.dupCrossListEntries + l.dupWithContactEntries;
  return Math.max(0, l.validEntries - l.hasZaloEntries - l.noZaloEntries - dupTotal);
});

onMounted(async () => {
  await fetchListById(listId.value);
  await fetchEntries(listId.value);
});

// Re-fetch khi route id change
watch(listId, async (newId) => {
  if (newId) {
    await fetchListById(newId);
    await fetchEntries(newId);
  }
});

function setTab(tab: typeof entryTab.value) {
  entryTab.value = tab;
  entryPage.value = 1;
  fetchEntries(listId.value);
}

function goPage(p: number) {
  entryPage.value = p;
  fetchEntries(listId.value);
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedFetchEntries() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    entryPage.value = 1;
    fetchEntries(listId.value);
  }, 300);
}

const allSelectedVisible = computed(() =>
  entries.value.length > 0 && entries.value.every((e) => isSelected(e.id)),
);
const someSelected = computed(() => entries.value.some((e) => isSelected(e.id)));

function onToggleAllVisible() {
  if (allSelectedVisible.value) clearSelection();
  else selectAllVisible();
}

function onRowClick(entryId: string, e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (target.closest('input, button, .row-actions')) return;
  toggleSelect(entryId);
}

async function onBulk(action: 'skip' | 'keep_both' | 'delete') {
  if (action === 'delete' && !confirm(`Xoá ${selectedCount.value} entry đã chọn?`)) return;
  const result = await bulkResolveEntries(listId.value, action);
  if (result?.ok) alert(`Đã cập nhật ${result.affected} entries`);
}

async function onArchive() {
  if (!confirm('Lưu trữ tệp này?')) return;
  await archiveList(listId.value);
  router.push('/automation/bot/lists');
}

async function onUnarchive() {
  await unarchiveList(listId.value);
  await fetchListById(listId.value);
}

async function onRescan() {
  const result = await rescanZalo(listId.value);
  if (result?.ok) {
    alert(`Đã bắt đầu quét lại ${result.pendingLookup} SĐT. Refresh sau vài phút.`);
    setTimeout(async () => {
      await fetchListById(listId.value);
      await fetchEntries(listId.value);
    }, 2000);
  }
}

async function onDelete() {
  if (!confirm('Xoá vĩnh viễn tệp này? Contact đã được tạo sẽ KHÔNG bị xoá.')) return;
  await deleteList(listId.value);
  router.push('/automation/bot/lists');
}

// ───────── Helpers ─────────
function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function sourceLabel(s: string): string {
  switch (s) {
    case 'paste': return 'Paste textarea';
    case 'csv': return 'CSV upload';
    case 'excel': return 'Excel upload';
    case 'api': return 'API webhook';
    default: return s;
  }
}

function pct(n: number, total: number): string {
  if (!total) return '0';
  return ((n / total) * 100).toFixed(1);
}

function dupTotal(l: CustomerListSummary | null): number {
  if (!l) return 0;
  return l.dupInListEntries + l.dupCrossListEntries + l.dupWithContactEntries;
}

function statusPillClass(status: string, hasZalo: boolean | null): string {
  if (status === 'invalid') return 'error';
  if (status.startsWith('dup_')) return 'dup';
  if (hasZalo === true) return 'has-zalo';
  if (hasZalo === false) return 'no-zalo';
  // hasZalo=null + status=enriched → "Chưa quét SDK" (worker đã check Friend nhưng không match)
  if (status === 'enriched' && hasZalo === null) return 'pending';
  return 'pending';
}

function statusPillLabel(status: string, hasZalo: boolean | null): string {
  if (status === 'invalid') return '✗ Lỗi format';
  if (status === 'dup_in_list') return '↺ Trùng list này';
  if (status === 'dup_cross_list') return '↔ Trùng list khác';
  if (status === 'dup_with_crm') return '⚷ Trùng CRM';
  if (status === 'skipped') return '⏭ Đã skip';
  if (hasZalo === true) return '✓ Có Zalo';
  if (hasZalo === false) return '⊘ Không Zalo';
  // hasZalo=null branch
  if (status === 'enriched') return '❓ Chưa quét SDK';
  return '⏳ Đang quét';
}

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const NICK_GRADIENTS: [string, string][] = [
  ['#10B981', '#059669'],
  ['#EC4899', '#BE185D'],
  ['#3B82F6', '#1D4ED8'],
  ['#F59E0B', '#D97706'],
  ['#6366F1', '#A855F7'],
  ['#14B8A6', '#0F766E'],
];
function hashIdx(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
function nickAvatarStyle(name: string): Record<string, string> {
  const [c1, c2] = NICK_GRADIENTS[hashIdx(name || '?', NICK_GRADIENTS.length)];
  return { background: `linear-gradient(135deg, ${c1}, ${c2})` };
}
</script>

<style scoped>
.list-detail-view {
  padding: 24px 28px 100px;
  max-width: 100%;
}

.breadcrumb {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 14px; font-size: 12px; color: #6B7280;
}
.breadcrumb a {
  color: #6366F1; text-decoration: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 4px;
}
.breadcrumb a:hover { text-decoration: underline; }
.breadcrumb .sep { color: #D1D5DB; }

.detail-hero {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 12px; padding: 18px 20px; margin-bottom: 16px;
}
.hero-head {
  display: flex; justify-content: space-between; align-items: flex-start;
  margin-bottom: 16px; gap: 14px;
}
.hero-head h2 {
  margin: 0 0 4px; font-size: 18px; font-weight: 700;
  display: flex; align-items: center; gap: 8px;
}
.hero-head .sub { color: #6B7280; font-size: 12.5px; }
.hero-head .sub b { color: #111827; font-weight: 600; }
.hero-head .archived-tag {
  font-size: 11px; background: #E5E7EB; color: #4B5563;
  padding: 2px 8px; border-radius: 99px; font-weight: 600;
  display: inline-flex; align-items: center; gap: 3px;
}

.hero-actions { display: flex; gap: 6px; align-items: center; flex-shrink: 0; }

.hero-stats {
  display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px;
}
.hero-stat {
  background: #F4F5F8; border: 1px solid #EFF1F4;
  border-radius: 9px; padding: 10px 12px;
  cursor: pointer; transition: all .12s;
}
.hero-stat:hover { border-color: #E0E7FF; background: #EEF2FF; }
.hero-stat.active {
  border-color: #6366F1; background: #EEF2FF;
  box-shadow: 0 0 0 3px rgba(99,102,241,.1);
}
.hero-stat .l {
  font-size: 10.5px; color: #6B7280;
  text-transform: uppercase; letter-spacing: .05em;
  font-weight: 600; margin-bottom: 4px;
}
.hero-stat .v {
  font-size: 20px; font-weight: 700; color: #111827;
  line-height: 1; font-variant-numeric: tabular-nums;
}
.hero-stat .pct {
  font-size: 10.5px; color: #6B7280; margin-top: 3px;
  font-variant-numeric: tabular-nums;
}
.hero-stat.green .v { color: #047857; }
.hero-stat.red .v { color: #B91C1C; }
.hero-stat.amber .v { color: #B45309; }
.hero-stat.blue .v { color: #1D4ED8; }

.subtabs {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 10px; padding: 6px; margin-bottom: 14px;
  display: flex; gap: 2px; flex-wrap: wrap;
}
.subtab {
  padding: 7px 12px; border-radius: 6px;
  font-size: 12px; color: #4B5563; cursor: pointer;
  font-weight: 500;
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; font-family: inherit;
}
.subtab:hover { background: #F4F5F8; color: #111827; }
.subtab.active { background: #111827; color: #fff; }
.subtab .count {
  background: rgba(0,0,0,.06); color: #4B5563;
  padding: 0 6px; border-radius: 99px;
  font-size: 10.5px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.subtab.active .count { background: rgba(255,255,255,.18); color: #fff; }

.filter-strip {
  display: flex; align-items: center; gap: 8px;
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 10px; padding: 8px 10px; margin-bottom: 14px;
}
.search {
  flex: 1; display: inline-flex; align-items: center; gap: 5px;
  background: #F4F5F8; border: 1px solid #EFF1F4;
  border-radius: 7px; padding: 0 9px; height: 32px;
}
.search input {
  flex: 1; border: none; background: transparent; outline: none;
  font-size: 12.5px; color: #111827; font-family: inherit;
}
.search input::placeholder { color: #9CA3AF; }

.entries-wrap {
  background: #fff; border: 1px solid #E5E7EB;
  border-radius: 10px; overflow: auto;
  max-height: calc(100vh - 380px);
}
.entries-table { width: 100%; border-collapse: collapse; font-size: 12px; min-width: 1500px; }
.entries-table thead th {
  background: #F4F5F8; position: sticky; top: 0; z-index: 2;
  font-size: 10.5px; font-weight: 600; color: #6B7280;
  text-transform: uppercase; letter-spacing: .04em;
  padding: 10px 9px; text-align: left;
  border-bottom: 1px solid #E5E7EB; white-space: nowrap;
}
.entries-table thead th.right { text-align: right; }
.entries-table tbody td {
  padding: 8px 9px; border-bottom: 1px solid #EFF1F4;
  vertical-align: middle; color: #111827;
}
.entries-table tbody tr { transition: background .1s; cursor: pointer; }
.entries-table tbody tr:hover { background: #FAFBFC; }
.entries-table tbody tr.selected { background: #EEF2FF; }
.entries-table tbody tr:last-child td { border-bottom: none; }

.chk { width: 14px; height: 14px; accent-color: #6366F1; cursor: pointer; }

.ix { color: #6B7280; font-family: "JetBrains Mono", monospace; font-size: 11px; width: 40px; }
.phone-cell {
  font-family: "JetBrains Mono", monospace;
  font-size: 11.5px; white-space: nowrap;
}
.phone-cell.raw { color: #6B7280; }
.phone-cell.e164 { color: #4B5563; }
.phone-cell.local { color: #111827; font-weight: 600; }
.name { font-weight: 500; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.name-zalo {
  max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.name-zalo.has { color: #111827; font-weight: 500; }
.name-zalo.no { color: #9CA3AF; font-style: italic; }

.personal-note {
  max-width: 200px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: #4B5563; font-size: 12px;
}

.muted-italic { color: #9CA3AF; font-style: italic; font-size: 11.5px; }

.status-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 7px; border-radius: 99px;
  font-size: 10.5px; font-weight: 600; white-space: nowrap;
}
.status-pill.has-zalo { background: #DBEAFE; color: #1D4ED8; }
.status-pill.no-zalo { background: #F4F5F8; color: #6B7280; }
.status-pill.error { background: #FEE2E2; color: #B91C1C; }
.status-pill.dup { background: #FEF3C7; color: #B45309; }
.status-pill.pending { background: #F4F5F8; color: #6B7280; }

.uid-cell {
  font-family: "JetBrains Mono", monospace;
  font-size: 11px; color: #4B5563; white-space: nowrap;
}
.uid-cell.empty { color: #9CA3AF; }

.nick-cell {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px;
}
.nick-cell .av {
  width: 20px; height: 20px; border-radius: 50%;
  font-size: 9px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  color: white; flex-shrink: 0;
}
.nick-cell .more {
  font-size: 10px; color: #6366F1; background: #EEF2FF;
  padding: 0 5px; border-radius: 99px; font-weight: 700;
}

.global-id {
  font-family: "JetBrains Mono", monospace;
  font-size: 10.5px; color: #A855F7;
  background: #FAF5FF; padding: 1px 6px; border-radius: 4px;
  white-space: nowrap;
}
.global-id.empty { color: #9CA3AF; background: transparent; font-style: italic; }

.dup-note {
  font-size: 10.5px; color: #B45309;
  background: #FFFBEB; padding: 1px 6px; border-radius: 4px;
  display: inline-block; white-space: nowrap;
}
.err-note {
  font-size: 10.5px; color: #B91C1C;
  background: #FEF2F2; padding: 1px 6px; border-radius: 4px;
  display: inline-block; white-space: nowrap;
}

.row-actions { text-align: right; white-space: nowrap; }
.icon-btn {
  width: 24px; height: 24px; border-radius: 5px;
  border: none; background: transparent; color: #6B7280;
  cursor: pointer; margin-left: 2px;
  display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: #F4F5F8; color: #111827; }

.loading-cell, .empty-cell {
  padding: 48px 16px; text-align: center;
  color: #6B7280; font-style: italic; font-size: 13px;
}

.pag {
  display: flex; justify-content: space-between; align-items: center;
  padding: 12px 14px; background: #fff;
  border: 1px solid #E5E7EB; border-top: none;
  border-radius: 0 0 10px 10px;
  font-size: 11.5px; color: #6B7280;
}
.pag .ctrls { display: flex; gap: 4px; align-items: center; }
.pag button {
  height: 26px; min-width: 26px; padding: 0 9px;
  border: 1px solid #E5E7EB; background: #fff;
  border-radius: 5px; font-size: 11px; cursor: pointer;
  color: #4B5563; font-family: inherit;
}
.pag button:hover:not(:disabled) { background: #F4F5F8; }
.pag button:disabled { opacity: 0.5; cursor: not-allowed; }
.pag button.cur { background: #6366F1; color: white; border-color: #6366F1; }

.bulk-bar {
  position: fixed; left: 50%; bottom: 24px;
  transform: translateX(-50%);
  background: #111827; color: white;
  border-radius: 12px; padding: 10px 16px;
  display: flex; align-items: center; gap: 12px;
  box-shadow: 0 16px 36px rgba(17,24,39,.28); z-index: 50;
}
.bulk-bar .ct { font-weight: 600; font-size: 13px; }
.bulk-bar .ct em {
  color: #FBBF24; font-style: normal; font-weight: 700;
  margin-right: 4px; font-variant-numeric: tabular-nums;
}
.bulk-bar .div { width: 1px; height: 18px; background: rgba(255,255,255,.16); }
.bulk-bar button {
  background: rgba(255,255,255,.08);
  border: 1px solid rgba(255,255,255,.12);
  color: white; font-size: 12px; padding: 6px 11px;
  border-radius: 7px; cursor: pointer;
  display: inline-flex; gap: 5px; align-items: center;
  font-family: inherit;
}
.bulk-bar button:hover { background: rgba(255,255,255,.18); }
.bulk-bar button.danger {
  background: rgba(239,68,68,.18); border-color: rgba(239,68,68,.35);
  color: #FCA5A5;
}
.bulk-bar .x {
  cursor: pointer; opacity: 0.6; margin-left: 4px;
  background: transparent; border: none; color: white;
}
</style>
