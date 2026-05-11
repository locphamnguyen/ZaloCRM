<template>
  <MobileContactView v-if="isMobile" />
  <div v-else class="smax-contacts-page">
    <!-- ════════ Page header ════════ -->
    <header class="page-header">
      <h1>Khách hàng</h1>
      <div class="subtitle">
        Tổng hợp toàn bộ KH đã kết bạn / đã gửi mời / đang nhắn tin / import vào hệ thống.
        KEY chính = <strong>SĐT</strong>. Click ▸ để xem chi tiết các nick chăm KH này.
      </div>
      <div class="legend">
        <span class="legend-item"><span class="dot" style="background:var(--smax-success)"></span> Đã KB</span>
        <span class="legend-item"><span class="dot" style="background:var(--smax-warning)"></span> Đã gửi mời</span>
        <span class="legend-item"><span class="dot" style="background:var(--smax-info)"></span> Đang nhắn (lạ)</span>
        <span class="legend-item"><span class="dot" style="background:#9e9e9e"></span> Đã ngắt / từ chối</span>
        <span class="legend-item">·</span>
        <span class="legend-item">🏆 = winner-nick (data master row pull từ row này)</span>
      </div>
    </header>

    <!-- ════════ Toolbar ════════ -->
    <div class="toolbar">
      <input
        v-model="filters.search"
        class="toolbar-search"
        placeholder="🔍 Tìm tên / SĐT / nội dung tin nhắn…"
        @input="debouncedFetch"
      />
      <select v-model="filters.source" @change="fetchContacts">
        <option value="">Tất cả nguồn</option>
        <option v-for="o in SOURCE_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
      <select v-model="filters.status" @change="fetchContacts">
        <option value="">Tất cả trạng thái</option>
        <option v-for="o in STATUS_OPTIONS" :key="o.value" :value="o.value">{{ o.text }}</option>
      </select>
      <input type="date" v-model="dateFrom" class="date-input" />
      <span class="date-separator">→</span>
      <input type="date" v-model="dateTo" class="date-input" />

      <span class="spacer"></span>

      <button class="btn" @click="showDuplicateDialog = true">
        ⊜ Trùng lặp
        <span v-if="duplicateTotal > 0" class="btn-badge">{{ duplicateTotal }}</span>
      </button>
      <button class="btn">⬇ Xuất</button>
      <button class="btn btn-primary" @click="openCreate">+ Thêm KH</button>
    </div>

    <!-- ════════ Stats row ════════ -->
    <div class="stats-row">
      <div class="stat-box">📋 Tổng KH: <span class="stat-num">{{ total }}</span></div>
      <div class="stat-box">🟢 Có nick chăm: <span class="stat-num">{{ stats.withNick }}</span></div>
      <div class="stat-box">⚠ Multi-claim ≥3: <span class="stat-num">{{ stats.multiClaim }}</span></div>
      <div class="stat-box">🚫 Revoked: <span class="stat-num">{{ stats.revoked }}</span></div>
      <div class="stat-box">📵 No Zalo: <span class="stat-num">{{ stats.noZalo }}</span></div>
    </div>

    <!-- ════════ Master/child table ════════ -->
    <div class="scroll-wrap">
      <table class="smax-table">
        <thead>
          <tr>
            <th class="w-32"></th>
            <th class="w-40"></th>
            <th>Tên CRM / Zalo (KH)</th>
            <th>SĐT</th>
            <th>Giới tính</th>
            <th>Tỉnh/Quận</th>
            <th>Nguồn</th>
            <th>Trạng thái KH</th>
            <th class="w-78">Score</th>
            <th>Sale chính</th>
            <th>KH nhắn cuối</th>
            <th>Sale nhắn cuối</th>
            <th>Tin (in/out)</th>
            <th>Tags CRM</th>
            <th>Có Zalo?</th>
            <th class="w-180">Action</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="contact in contacts" :key="contact.id">
            <tr class="master-row" :class="{ open: expandedId === contact.id }">
              <td>
                <button class="expand-btn" @click="toggleExpand(contact.id)">
                  {{ expandedId === contact.id ? '▾' : '▸' }}
                </button>
              </td>
              <td>
                <div class="avatar avatar-customer" :class="{ 'is-female': contact.gender === 'female' }">
                  {{ initials(contact) }}
                </div>
              </td>
              <td>
                <div class="name-text">{{ contact.crmName || contact.fullName || '—' }}</div>
                <div v-if="contact.fullName && contact.crmName && contact.fullName !== contact.crmName" class="name-sub">
                  {{ contact.fullName }}
                </div>
              </td>
              <td>{{ contact.phone || '—' }}</td>
              <td>
                <template v-if="contact.gender">
                  {{ genderLabel(contact.gender) }}
                  <template v-if="ageOf(contact)">· {{ ageOf(contact) }}t</template>
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <template v-if="contact.province || contact.district">
                  {{ [contact.province, contact.district].filter(Boolean).join(' / ') }}
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <span v-if="contact.source" class="chip chip-grey">{{ sourceLabel(contact.source) }}</span>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <span v-if="contact.status" :class="['chip', statusChipClass(contact.status)]">
                  {{ statusLabel(contact.status) }}
                </span>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <span :class="['chip', scoreChipClass(contact.leadScore)]">
                  {{ contact.leadScore ?? 0 }}
                </span>
              </td>
              <td>{{ contact.assignedUser?.fullName || '—' }}</td>
              <td>
                <template v-if="contact.lastInboundAt">
                  <div class="cell-strong">{{ formatRecentDateTime(contact.lastInboundAt) }}</div>
                  <div class="cell-preview" :title="contact.lastInboundPreview || ''">
                    {{ messagePreview(contact.lastInboundPreview, contact.lastInboundType ?? null) }}
                  </div>
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <template v-if="contact.lastOutboundAt">
                  <div class="cell-strong">{{ formatRecentDateTime(contact.lastOutboundAt) }}</div>
                  <div class="cell-preview" :title="contact.lastOutboundPreview || ''">
                    {{ messagePreview(contact.lastOutboundPreview, contact.lastOutboundType ?? null) }}
                  </div>
                </template>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <strong>{{ contact.totalInbound ?? 0 }}</strong> / {{ contact.totalOutbound ?? 0 }}
              </td>
              <td>
                <div class="tag-cell">
                  <span v-for="tag in (contact.tags || []).slice(0, 2)" :key="tag" class="chip chip-grey">{{ tag }}</span>
                  <span v-if="(contact.tags || []).length > 2" class="chip chip-grey">
                    +{{ contact.tags.length - 2 }}
                  </span>
                </div>
              </td>
              <td>
                <span v-if="contact.hasZalo === true" class="chip chip-success">Có</span>
                <span v-else-if="contact.hasZalo === false" class="chip chip-grey">Không</span>
                <span v-else class="empty">?</span>
              </td>
              <td>
                <div class="action-cell">
                  <button class="row-action-btn" @click="goChat(contact)" title="Mở chat">💬</button>
                  <button class="row-action-btn" @click="openDetail(contact)" title="Chi tiết">✎</button>
                  <button class="row-action-btn" @click="onAutomation(contact)" title="Automation">⚡</button>
                </div>
              </td>
            </tr>

            <!-- Child row (placeholder cho Phase 3 — sẽ render danh sách nick chăm khi backend có endpoint per-contact friendships) -->
            <tr v-if="expandedId === contact.id" class="child-wrap">
              <td colspan="16">
                <div class="child-empty">
                  Chi tiết các nick chăm KH này sẽ hiển thị tại đây.
                  <span class="text-grey">(chờ endpoint <code>/contacts/{id}/friendships</code> bên backend)</span>
                </div>
              </td>
            </tr>
          </template>

          <tr v-if="!loading && !contacts.length">
            <td colspan="16" class="empty-state">Không tìm thấy KH nào khớp bộ lọc.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div class="pagination">
      <button class="btn" :disabled="pagination.page <= 1" @click="changePage(pagination.page - 1)">← Trước</button>
      <span class="page-info">Trang {{ pagination.page }} / {{ totalPages }}</span>
      <button class="btn" :disabled="pagination.page >= totalPages" @click="changePage(pagination.page + 1)">Sau →</button>
    </div>

    <!-- Dialogs (giữ nguyên) -->
    <ContactDetailDialog v-model="showDialog" :contact="selectedContact" @saved="onSaved" @deleted="onDeleted" />
    <DuplicateReviewDialog v-model="showDuplicateDialog" @merged="onDuplicateMerged" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import ContactDetailDialog from '@/components/contacts/ContactDetailDialog.vue';
import DuplicateReviewDialog from '@/components/contacts/DuplicateReviewDialog.vue';
import {
  useContacts, useContactIntelligence,
  SOURCE_OPTIONS, STATUS_OPTIONS, GENDER_OPTIONS,
  formatRecentDateTime, messagePreview,
} from '@/composables/use-contacts';
import type { Contact } from '@/composables/use-contacts';
import MobileContactView from '@/views/MobileContactView.vue';
import { useMobile } from '@/composables/use-mobile';

const { isMobile } = useMobile();
const router = useRouter();

const { contacts, total, loading, filters, pagination, fetchContacts } = useContacts();
const { duplicateTotal, fetchDuplicateGroups } = useContactIntelligence();

const showDialog = ref(false);
const showDuplicateDialog = ref(false);
const selectedContact = ref<Contact | null>(null);
const expandedId = ref<string | null>(null);
const dateFrom = ref('');
const dateTo = ref('');

let searchTimeout: ReturnType<typeof setTimeout>;
function debouncedFetch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => {
    pagination.page = 1;
    fetchContacts();
  }, 300);
}

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pagination.limit)));
function changePage(p: number) {
  pagination.page = p;
  fetchContacts();
}

function toggleExpand(id: string) {
  expandedId.value = expandedId.value === id ? null : id;
}

function initials(c: Contact): string {
  const name = c.crmName || c.fullName || '?';
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1]?.[0] || '').toUpperCase();
}
function genderLabel(value: string) {
  return GENDER_OPTIONS.find(o => o.value === value)?.text ?? value;
}
function sourceLabel(value: string) {
  return SOURCE_OPTIONS.find(o => o.value === value)?.text ?? value;
}
function statusLabel(value: string) {
  return STATUS_OPTIONS.find(o => o.value === value)?.text ?? value;
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
function scoreChipClass(score: number): string {
  if (score >= 70) return 'chip-success';
  if (score >= 40) return 'chip-warning';
  return 'chip-error';
}
function ageOf(c: Contact): number | null {
  const cy = new Date().getFullYear();
  if (c.birthDate) {
    const y = new Date(c.birthDate).getFullYear();
    if (Number.isFinite(y)) return cy - y;
  }
  if (c.birthYear) return cy - c.birthYear;
  return null;
}

const stats = computed(() => ({
  withNick: contacts.value.filter(c => c.hasZalo === true).length,
  multiClaim: 0, // chờ backend bổ sung trường multi_nick_count
  revoked: contacts.value.filter(c => c.consentStatus === 'revoked').length,
  noZalo: contacts.value.filter(c => c.hasZalo === false).length,
}));

function openCreate() {
  selectedContact.value = null;
  showDialog.value = true;
}
function openDetail(c: Contact) {
  selectedContact.value = c;
  showDialog.value = true;
}
function goChat(c: Contact) {
  router.push({ path: '/chat', query: { contactId: c.id } });
}
function onAutomation(_c: Contact) { /* TODO: open automation dialog for contact */ }
function onSaved() { fetchContacts(); }
function onDeleted() { fetchContacts(); }
function onDuplicateMerged() {
  fetchContacts();
  fetchDuplicateGroups();
}

onMounted(() => {
  fetchContacts();
  fetchDuplicateGroups();
});
</script>

<style scoped>
.smax-contacts-page {
  padding: 13px 18px 26px;
  background: var(--smax-grey-100);
  min-height: 100%;
}

/* ════════ Page header ════════ */
.page-header h1 {
  margin: 0 0 5px;
  font-size: 20px; font-weight: 600;
}
.subtitle {
  color: var(--smax-grey-700);
  margin-bottom: 11px;
  font-size: 13px;
}
.legend {
  display: flex; flex-wrap: wrap; gap: 11px;
  font-size: 12px; color: var(--smax-grey-700);
  margin-bottom: 11px;
}
.legend-item { display: inline-flex; align-items: center; gap: 4px; }
.legend-item .dot {
  display: inline-block; width: 8px; height: 8px;
  border-radius: 50%;
}

/* ════════ Toolbar ════════ */
.toolbar {
  background: var(--smax-bg);
  border-radius: 7px;
  padding: 9px 11px;
  margin-bottom: 9px;
  display: flex; align-items: center; gap: 7px;
  flex-wrap: wrap;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.toolbar > * {
  font-family: inherit; font-size: 13px;
}
.toolbar-search {
  flex: 1; min-width: 240px;
  padding: 7px 11px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
}
.toolbar-search:focus { outline: none; border-color: var(--smax-primary); }
.toolbar select,
.toolbar .date-input {
  padding: 7px 11px;
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  background: var(--smax-bg);
}
.toolbar .date-input { max-width: 140px; }
.date-separator { color: var(--smax-grey-700); font-size: 12px; }
.spacer { flex: 1 0 auto; }
.btn {
  padding: 7px 13px;
  border: 1px solid var(--smax-primary);
  background: var(--smax-bg);
  color: var(--smax-primary);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
}
.btn:hover { background: var(--smax-primary-soft); }
.btn-primary {
  background: var(--smax-primary);
  color: white;
}
.btn-primary:hover { background: var(--smax-primary-hover); }
.btn-badge {
  background: var(--smax-error);
  color: white;
  border-radius: 9px;
  padding: 1px 6px;
  font-size: 10px; font-weight: 600;
  margin-left: 3px;
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
.stat-box {
  display: flex; align-items: center; gap: 5px;
  font-size: 13px;
}
.stat-num {
  font-weight: 600;
  color: var(--smax-primary);
  margin-left: 3px;
}

/* ════════ Table ════════ */
.scroll-wrap {
  background: var(--smax-bg);
  border-radius: 7px;
  overflow-x: auto;
  box-shadow: 0 1px 3px rgba(0,0,0,0.05);
}
.smax-table {
  width: 100%;
  border-collapse: collapse;
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
.smax-table tbody tr.master-row {
  border-bottom: 1px solid var(--smax-grey-100);
  cursor: default;
}
.smax-table tbody tr.master-row:hover { background: var(--smax-grey-50); }
.smax-table tbody tr.master-row.open { background: var(--smax-primary-soft); }
.smax-table td {
  padding: 9px 11px;
  vertical-align: top;
}
.w-32 { width: 32px; }
.w-40 { width: 40px; }
.w-78 { width: 78px; }
.w-180 { width: 180px; }

.expand-btn {
  background: transparent; border: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--smax-grey-700);
  padding: 0; width: 22px; height: 22px;
}
.expand-btn:hover { color: var(--smax-primary); }

.avatar.avatar-customer {
  width: 32px; height: 32px;
  border-radius: 50%;
  background: linear-gradient(135deg, #90caf9, #1976d2);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 13px;
}
.avatar.avatar-customer.is-female {
  background: linear-gradient(135deg, #f48fb1, #c2185b);
}

.name-text { font-weight: 500; color: var(--smax-text); }
.name-sub { font-size: 11px; color: var(--smax-grey-700); }
.cell-strong { font-weight: 500; font-size: 12px; }
.cell-preview {
  font-size: 11.5px; color: var(--smax-grey-700);
  max-width: 220px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.empty { color: var(--smax-grey-300); }

.tag-cell { display: flex; flex-wrap: wrap; gap: 4px; }
.chip {
  display: inline-flex; align-items: center;
  padding: 1px 7px; border-radius: 9px;
  font-size: 10.5px; font-weight: 500;
  white-space: nowrap;
}
.chip-success { background: rgba(0,200,83,0.12); color: #00897b; }
.chip-warning { background: rgba(255,145,0,0.15); color: #ef6c00; }
.chip-info    { background: rgba(33,150,243,0.12); color: #1565c0; }
.chip-grey    { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); }
.chip-error   { background: rgba(255,82,82,0.12); color: #c62828; }

.action-cell { display: flex; gap: 4px; }
.row-action-btn {
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-300);
  border-radius: 5px;
  padding: 3px 7px;
  cursor: pointer;
  font-size: 12px;
}
.row-action-btn:hover { background: var(--smax-primary-soft); border-color: var(--smax-primary); color: var(--smax-primary); }

.child-wrap td {
  background: var(--smax-grey-50);
  padding: 9px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.child-empty {
  font-size: 12px;
  color: var(--smax-grey-700);
  font-style: italic;
}
.child-empty code {
  background: white;
  padding: 1px 5px; border-radius: 4px;
  font-size: 11px;
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
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
