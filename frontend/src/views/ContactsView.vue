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
      <button class="btn" @click="showCandidateDialog = true">
        💡 Gợi ý KH Cha
        <span v-if="candidateCount > 0" class="btn-badge">{{ candidateCount }}</span>
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
            <th class="w-220">Nick chăm</th>
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
                <Avatar
                  :src="contact.avatarUrl"
                  :name="contact.crmName || contact.fullName || '?'"
                  :size="32"
                  :gender="contact.gender"
                  :gradient-seed="contact.id"
                />
              </td>
              <td>
                <div class="name-text">
                  {{ contact.crmName || contact.fullName || '—' }}
                  <span
                    v-if="(contact._count?.conversations || 0) > 1"
                    class="chip chip-multi-nick"
                    :title="`${contact._count?.conversations} nick CRM đang chăm khách này`"
                  >
                    👥 Đa nick ({{ contact._count?.conversations }})
                  </span>
                </div>
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
                <!-- Status chip dùng displayStatus aggregate (Cha = MAX order của Con). Color từ Status table. -->
                <span
                  v-if="contact.displayStatus"
                  class="chip"
                  :style="{ background: chipBg(contact.displayStatus.color), color: chipFg(contact.displayStatus.color) }"
                  :title="contact.childrenCount && contact.childrenCount > 0 ? `Aggregate từ ${contact.childrenCount} KH con` : ''"
                >
                  {{ contact.displayStatus.name }}
                </span>
                <span v-else-if="contact.status" :class="['chip', statusChipClass(contact.status)]">{{ statusLabel(contact.status) }}</span>
                <span v-else class="empty">—</span>
              </td>
              <td>
                <span :class="['chip', scoreChipClass(contact.displayLeadScore ?? contact.leadScore)]">
                  {{ Math.round(contact.displayLeadScore ?? contact.leadScore ?? 0) }}
                </span>
              </td>
              <td>
                <!-- Nick chăm: 4 chip count theo trạng thái KB -->
                <div class="nick-count-row">
                  <span v-for="b in nickCountChips(contact)" :key="b.kind" :class="['chip', b.cls]" :title="b.title">
                    {{ b.icon }} {{ b.count }}
                  </span>
                </div>
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

            <!-- Child row: nick chăm (real data từ /contacts/:id/friendships) -->
            <tr v-if="expandedId === contact.id" class="child-wrap">
              <td colspan="17">
                <div class="child-table-wrap">
                  <div v-if="friendshipLoading[contact.id]" class="child-empty">Đang tải…</div>
                  <table v-else-if="childRows(contact).length" class="child-table">
                    <thead>
                      <tr>
                        <th>Nick Zalo (Sale)</th>
                        <th>Tên CRM/Nick KH</th>
                        <th>Ảnh KH</th>
                        <th>Tên Zalo + UID</th>
                        <th>Trạng thái KB</th>
                        <th>Trạng thái KH</th>
                        <th>Score</th>
                        <th>Nhãn CRM</th>
                        <th>Label Zalo</th>
                        <th>KH nhắn cuối</th>
                        <th>Sale nhắn cuối</th>
                        <th>In/Out</th>
                        <th>Là bạn từ</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(row, idx) in childRows(contact)" :key="row.id" :class="{ winner: idx === 0 }">
                        <td>
                          <div class="nick-cell">
                            <Avatar :name="row.nickName" :size="26" :gradient-seed="row.id" platform="zalo" />
                            <div class="two-line">
                              <span class="line1">
                                {{ row.nickName }}
                                <span v-if="idx === 0" class="winner-badge">🏆</span>
                              </span>
                              <span class="line2">{{ row.salePhone }} · {{ row.saleName }}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span :class="['line1', { empty: !row.aliasInNick }]">
                            {{ row.aliasInNick || '— chưa đặt —' }}
                          </span>
                        </td>
                        <td>
                          <Avatar :src="contact.avatarUrl" :name="contact.fullName || '?'" :size="32" :gradient-seed="contact.id" />
                        </td>
                        <td>
                          <div class="two-line">
                            <span class="line1">{{ row.zaloName || '—' }}</span>
                            <span class="uid">{{ row.zaloUid || 'chưa lấy' }}</span>
                          </div>
                        </td>
                        <td>
                          <span :class="['chip', kindChipClass(row.relationshipKind)]">
                            {{ kindLabel(row.relationshipKind) }}
                          </span>
                        </td>
                        <td>
                          <span
                            v-if="row.statusRef"
                            class="chip status-edit-chip"
                            :style="{ background: chipBg(row.statusRef.color), color: chipFg(row.statusRef.color) }"
                            :title="'Click đổi status'"
                            @click="openFriendStatusEdit(row)"
                          >{{ row.statusRef.name }}</span>
                          <span v-else class="empty" @click="openFriendStatusEdit(row)" style="cursor:pointer">— đặt —</span>
                        </td>
                        <td>
                          <input
                            type="number"
                            class="score-input"
                            :value="row.leadScore"
                            min="0" max="100"
                            @change="onFriendScoreChange(row, ($event.target as HTMLInputElement).value)"
                            :title="'Score per-nick này. Cha = AVG.'"
                          />
                        </td>
                        <td>
                          <div class="tag-cell">
                            <span v-for="t in row.crmTagsPerNick" :key="t" class="chip chip-info">{{ t }}</span>
                            <span v-if="!row.crmTagsPerNick.length" class="empty">—</span>
                          </div>
                        </td>
                        <td>
                          <div class="tag-cell">
                            <span v-for="lbl in row.zaloLabels" :key="lbl" class="chip chip-orange-soft">{{ lbl }}</span>
                            <span v-if="!row.zaloLabels.length" class="empty">—</span>
                          </div>
                        </td>
                        <td>
                          <span v-if="row.lastInboundAt" class="cell-strong">{{ formatRecentDateTime(row.lastInboundAt) }}</span>
                          <span v-else class="empty">—</span>
                        </td>
                        <td>
                          <span v-if="row.lastOutboundAt" class="cell-strong">{{ formatRecentDateTime(row.lastOutboundAt) }}</span>
                          <span v-else class="empty">—</span>
                        </td>
                        <td><strong>{{ row.totalInbound }}</strong> / {{ row.totalOutbound }}</td>
                        <td>{{ row.becameFriendAt || '—' }}</td>
                        <td>
                          <div class="action-cell">
                            <button class="row-action-btn" @click="onChildAction('chat', row)">💬</button>
                            <button class="row-action-btn" @click="onChildAction('auto', row)">⚡</button>
                          </div>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <div v-else class="child-empty">
                    KH này chưa có nick CRM nào chăm.
                  </div>
                </div>
              </td>
            </tr>
          </template>

          <tr v-if="!loading && !contacts.length">
            <td colspan="17" class="empty-state">Không tìm thấy KH nào khớp bộ lọc.</td>
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
    <ParentCandidateDialog v-model="showCandidateDialog" @resolved="onCandidateResolved" />

    <!-- Friend status picker dialog (per-pair status) -->
    <div v-if="statusEditTarget" class="status-picker-overlay" @click.self="statusEditTarget = null">
      <div class="status-picker">
        <h4>Chọn trạng thái cho nick này</h4>
        <div class="status-picker-list">
          <button
            v-for="s in allStatuses"
            :key="s.id"
            class="status-picker-item"
            :class="{ active: statusEditTarget?.statusRef?.id === s.id }"
            :style="{ background: chipBg(s.color), color: chipFg(s.color) }"
            @click="applyFriendStatus(s.id)"
          >
            {{ s.name }}
            <span class="order-num">#{{ s.order }}</span>
          </button>
        </div>
        <button class="btn-close" @click="statusEditTarget = null">Đóng</button>
      </div>
    </div>
    <DuplicateReviewDialog v-model="showDuplicateDialog" @merged="onDuplicateMerged" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import ContactDetailDialog from '@/components/contacts/ContactDetailDialog.vue';
import ParentCandidateDialog from '@/components/contacts/ParentCandidateDialog.vue';
import DuplicateReviewDialog from '@/components/contacts/DuplicateReviewDialog.vue';
import type { CareStatusValue } from '@/constants/care-status';
import Avatar from '@/components/ui/Avatar.vue';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api';
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
const toast = useToast();

const showDialog = ref(false);
const showDuplicateDialog = ref(false);
const showCandidateDialog = ref(false);
const candidateCount = ref(0);
async function fetchCandidateCount() {
  try {
    const res = await api.get<{ candidates: unknown[] }>('/contacts/parent-candidates');
    candidateCount.value = (res.data.candidates || []).length;
  } catch { candidateCount.value = 0; }
}
function onCandidateResolved() { fetchCandidateCount(); fetchContacts(); }
const selectedContact = ref<Contact | null>(null);
const expandedId = ref<string | null>(null);
// Real friendship data per contact (key: contactId → ChildRow[]). Fetched on first expand.
const friendshipCache = ref<Record<string, ChildRow[]>>({});
const friendshipLoading = ref<Record<string, boolean>>({});
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
  if (expandedId.value === id && !friendshipCache.value[id]) {
    const contact = contacts.value.find(c => c.id === id);
    if (contact) void fetchFriendships(contact);
  }
}

async function fetchFriendships(contact: Contact) {
  friendshipLoading.value[contact.id] = true;
  try {
    // GET /contacts/:id trả friends include statusRef per-pair (model B).
    const res = await api.get<Contact & { friends?: ApiFriendship[] }>(`/contacts/${contact.id}`);
    friendshipCache.value[contact.id] = (res.data.friends || []).map(f => mapFriendshipToChildRow(f, contact));
  } catch (err) {
    console.error('[contact-detail] fetch error:', err);
    friendshipCache.value[contact.id] = [];
  } finally {
    friendshipLoading.value[contact.id] = false;
  }
}

interface ApiFriendship {
  id: string;
  zaloUidInNick: string;
  relationshipKind: string;
  friendshipStatus: string;
  hasConversation: boolean;
  aliasInNick: string | null;
  zaloLabels: unknown;
  becameFriendAt: string | null;
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  totalInbound: number;
  totalOutbound: number;
  leadScore: number;
  statusId: string | null;
  statusRef: StatusLite | null;
  zaloAccount: {
    id: string;
    displayName: string | null;
    phone: string | null;
    zaloUid: string | null;
    avatarUrl: string | null;
    owner: { id: string; fullName: string } | null;
  };
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return null;
  const diff = Date.now() - ts;
  const days = Math.floor(diff / 86_400_000);
  if (days <= 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  if (days < 30) return `${days}d trước`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}th trước`;
  return `${Math.floor(months / 12)}y trước`;
}

function mapFriendshipToChildRow(f: ApiFriendship, contact: Contact): ChildRow {
  const validKinds: ChildRow['relationshipKind'][] = ['friend', 'pending_friend', 'chatting_stranger', 'ghost'];
  const kind = (validKinds.includes(f.relationshipKind as ChildRow['relationshipKind'])
    ? f.relationshipKind
    : 'chatting_stranger') as ChildRow['relationshipKind'];
  const labels = Array.isArray(f.zaloLabels)
    ? (f.zaloLabels as Array<{ name?: string }>).map(l => l.name || '').filter(Boolean)
    : [];
  return {
    id: f.id,
    nickName: f.zaloAccount.displayName || 'Nick',
    salePhone: f.zaloAccount.phone || '',
    saleName: f.zaloAccount.owner?.fullName || '—',
    aliasInNick: f.aliasInNick,
    zaloName: contact.fullName,
    zaloUid: f.zaloUidInNick,
    relationshipKind: kind,
    careStatus: (contact.status as CareStatusValue) || 'interested',
    statusRef: f.statusRef,
    leadScore: f.leadScore ?? 0,
    crmTagsPerNick: contact.tags?.slice(0, 3) || [],
    zaloLabels: labels,
    lastInboundAt: f.lastInboundAt,
    lastOutboundAt: f.lastOutboundAt,
    totalInbound: f.totalInbound ?? 0,
    totalOutbound: f.totalOutbound ?? 0,
    becameFriendAt: relativeTime(f.becameFriendAt),
    autoLabel: null,
  };
}

// ── Friend per-pair: edit status + score ─────────────────────────────────
async function onFriendScoreChange(row: ChildRow, value: string) {
  const score = Math.max(0, Math.min(100, parseInt(value) || 0));
  try {
    await api.patch(`/friends/${row.id}`, { leadScore: score });
    row.leadScore = score;
    // Invalidate cache để refetch aggregate Cha
    Object.keys(friendshipCache.value).forEach(k => delete friendshipCache.value[k]);
    fetchContacts();
  } catch (err) {
    toast.error('Cập nhật score thất bại');
  }
}

const statusEditTarget = ref<ChildRow | null>(null);
const allStatuses = ref<StatusLite[]>([]);

async function fetchAllStatuses() {
  if (allStatuses.value.length > 0) return;
  try {
    const res = await api.get<{ statuses: StatusLite[] }>('/settings/statuses');
    allStatuses.value = res.data.statuses || [];
  } catch {}
}

function openFriendStatusEdit(row: ChildRow) {
  fetchAllStatuses();
  statusEditTarget.value = row;
}

async function applyFriendStatus(statusId: string) {
  if (!statusEditTarget.value) return;
  const row = statusEditTarget.value;
  try {
    await api.patch(`/friends/${row.id}`, { statusId });
    const newStatus = allStatuses.value.find(s => s.id === statusId);
    if (newStatus) row.statusRef = newStatus;
    statusEditTarget.value = null;
    Object.keys(friendshipCache.value).forEach(k => delete friendshipCache.value[k]);
    fetchContacts();
  } catch (err) {
    toast.error('Cập nhật status thất bại');
  }
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
// Status color helpers — hex từ Status.color → background nhạt + foreground đậm cho readable chip.
function chipBg(hex: string | null | undefined): string {
  if (!hex) return 'rgba(90,100,120,0.10)';
  // hex → rgba 0.15 alpha
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return 'rgba(90,100,120,0.10)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},0.15)`;
}
function chipFg(hex: string | null | undefined): string {
  return hex || 'var(--smax-grey-700)';
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
  multiClaim: contacts.value.filter(c => (c._count?.conversations || 0) >= 3).length,
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
function onAutomation(_c: Contact) { toast.warning('Automation dialog: chưa implement'); }

// ════════ Child rows (MOCK — chờ /contacts/:id/friendships) ════════
interface StatusLite { id: string; name: string; order: number; color: string | null }
interface ChildRow {
  id: string;
  nickName: string;
  statusRef: StatusLite | null;
  leadScore: number;
  salePhone: string;
  saleName: string;
  aliasInNick: string | null;
  zaloName: string | null;
  zaloUid: string | null;
  relationshipKind: 'friend' | 'pending_friend' | 'chatting_stranger' | 'ghost';
  careStatus: CareStatusValue;
  crmTagsPerNick: string[];
  zaloLabels: string[];
  lastInboundAt: string | null;
  lastOutboundAt: string | null;
  totalInbound: number;
  totalOutbound: number;
  becameFriendAt: string | null;
  autoLabel: string | null;
}

/** Child rows từ cache thật (load qua /contacts/:id/friendships khi expand) */
function childRows(contact: Contact): ChildRow[] {
  return friendshipCache.value[contact.id] || [];
}


function kindLabel(kind: ChildRow['relationshipKind']): string {
  const map: Record<ChildRow['relationshipKind'], string> = {
    friend: 'Đã KB',
    pending_friend: 'Đã gửi mời',
    chatting_stranger: 'Đang nhắn (lạ)',
    ghost: 'Đã ngắt',
  };
  return map[kind];
}
function kindChipClass(kind: ChildRow['relationshipKind']): string {
  const map: Record<ChildRow['relationshipKind'], string> = {
    friend: 'chip-success',
    pending_friend: 'chip-warning',
    chatting_stranger: 'chip-info',
    ghost: 'chip-grey',
  };
  return map[kind];
}

function onChildAction(action: string, row: ChildRow) {
  if (action === 'chat') {
    toast.success(`Mở chat qua nick ${row.nickName}`);
  } else if (action === 'auto') {
    toast.warning(`Automation cho cặp ${row.nickName} × KH: chưa implement`);
  }
}

// ════════ Master row "Nick chăm" — 4 chip count ════════
interface NickCountChip { kind: string; icon: string; count: number; cls: string; title: string }
function nickCountChips(contact: Contact): NickCountChip[] {
  // Backend aggregate Friend.relationshipKind per contact (set trong GET /contacts).
  const m = contact.nicksByKind || {};
  return [
    { kind: 'friend', icon: '🟢', count: m.friend || 0, cls: 'chip-success', title: 'Đã KB' },
    { kind: 'pending', icon: '🟡', count: m.pending_friend || 0, cls: 'chip-warning', title: 'Đã gửi mời' },
    { kind: 'stranger', icon: '🔵', count: m.chatting_stranger || 0, cls: 'chip-info', title: 'Đang nhắn lạ' },
    { kind: 'ghost', icon: '⚪', count: m.ghost || 0, cls: 'chip-grey', title: 'Đã ngắt' },
  ];
}
function onSaved() { fetchContacts(); }
function onDeleted() { fetchContacts(); }
function onDuplicateMerged() {
  fetchContacts();
  fetchDuplicateGroups();
}

onMounted(() => {
  fetchContacts();
  fetchDuplicateGroups();
  fetchCandidateCount();
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
.toggle-inline { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--smax-grey-700); cursor: pointer; padding: 6px 10px; border-radius: 6px; }
.toggle-inline:hover { background: rgba(0,0,0,0.04); }
.toggle-inline input { cursor: pointer; }
.status-edit-chip { cursor: pointer; }
.status-edit-chip:hover { filter: brightness(1.1); }
.score-input { width: 50px; padding: 2px 4px; font-size: 11.5px; text-align: center; border: 1px solid var(--smax-grey-300); border-radius: 4px; }
.score-input:focus { outline: 2px solid var(--smax-primary, #00f2ff); }
.status-picker-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1100; display: flex; align-items: center; justify-content: center; }
.status-picker { background: var(--smax-bg); border-radius: 10px; padding: 16px 20px; min-width: 320px; max-width: 480px; }
.status-picker h4 { margin: 0 0 12px; font-size: 14px; }
.status-picker-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.status-picker-item { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border: 1px solid transparent; border-radius: 6px; cursor: pointer; font-weight: 500; text-align: left; }
.status-picker-item.active { border-color: var(--smax-primary, #00f2ff); }
.status-picker-item:hover { filter: brightness(1.05); }
.order-num { font-size: 10px; opacity: 0.5; font-family: monospace; }
.btn-close { width: 100%; padding: 8px; background: var(--smax-grey-100); border: 1px solid var(--smax-grey-200); border-radius: 6px; cursor: pointer; }
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
.chip-multi-nick {
  background: linear-gradient(135deg, rgba(124,77,255,0.14), rgba(33,150,243,0.10));
  color: #4527a0;
  margin-left: 6px;
  font-weight: 600;
  letter-spacing: 0.2px;
}

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
  padding: 9px;
}
.child-mock-banner {
  font-size: 11px;
  background: rgba(255,145,0,0.10);
  color: #ef6c00;
  padding: 5px 9px;
  border-radius: 5px;
  margin-bottom: 9px;
}
.child-mock-banner code {
  background: white;
  padding: 1px 5px; border-radius: 4px;
  font-size: 10.5px;
}
.child-table {
  width: 100%;
  border-collapse: collapse;
  background: var(--smax-bg);
  border-radius: 7px;
  overflow: hidden;
}
.child-table thead th {
  background: rgba(33,150,243,0.06);
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 7px 9px;
  color: var(--smax-grey-700);
  font-weight: 600;
  text-align: left;
  border-bottom: 1px solid var(--smax-grey-200);
}
.child-table tbody td {
  padding: 7px 9px;
  font-size: 12px;
  border-bottom: 1px solid var(--smax-grey-100);
  vertical-align: top;
}
.child-table tbody tr.winner {
  background: rgba(76,175,80,0.06);
}
.child-table tbody tr.more-row td {
  text-align: center;
  font-size: 11px;
  color: var(--smax-grey-700);
  font-style: italic;
  background: var(--smax-grey-50);
}

.winner-badge {
  display: inline-block;
  margin-left: 4px;
  font-size: 11px;
}

.nick-cell {
  display: flex; align-items: center; gap: 6px;
}
.avatar-nick {
  width: 26px; height: 26px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffb74d, #f57c00);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 10px;
  flex-shrink: 0;
}
.two-line {
  display: flex; flex-direction: column; gap: 1px;
  min-width: 0;
}
.line1 { font-weight: 500; color: var(--smax-text); font-size: 12px; }
.line2 { font-size: 10.5px; color: var(--smax-grey-700); }
.line1.empty { color: var(--smax-grey-300); font-style: italic; font-weight: 400; }
.uid {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 10px;
  color: var(--smax-grey-700);
  word-break: break-all;
}

.nick-count-row {
  display: flex; gap: 3px; flex-wrap: wrap;
}
.nick-count-row .chip {
  font-size: 10px;
  padding: 2px 6px;
}

.chip-orange-soft {
  background: rgba(255,167,38,0.18);
  color: #ef6c00;
}

.w-220 { width: 220px; }

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
