<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  ContactDetailPanel — Phase Dual View 2026-05-28.

  Inline detail panel cho ContactsView khi user chọn Mode 2 ("Chi tiết bên")
  và click 1 row. Render bên phải, list bên trái shrink lại 5 cột rút gọn.

  Layout (theo mockup Variant D):
    [Header]  Avatar 56px + Tên + SĐT + Email + 🟢 Zalo + Pills + 2 nút action + ✕
    [Tabs]    Tổng quan / Nick chăm (N) / Lịch sử chat / Lịch hẹn / Notes
    [Body]    Nội dung tab — default "Nick chăm" hiển thị Friend cards + timeline
-->
<template>
  <div class="cdp-root">
    <!-- Header -->
    <header class="cdp-head">
      <div class="cdp-head-row">
        <div class="cdp-avatar" :style="{ background: avatarBg }">
          <img v-if="contact.avatarUrl" :src="contact.avatarUrl" :alt="displayName" />
          <span v-else>{{ initials }}</span>
        </div>
        <div class="cdp-head-info">
          <div class="cdp-name">
            {{ displayName }}
            <span v-if="isOwner" class="cdp-crown" title="Chủ tổ chức">👑</span>
          </div>
          <div class="cdp-meta">
            <span v-if="contact.phone" class="cdp-phone-line">📱 <code>{{ contact.phone }}</code></span>
            <span v-if="contact.email" class="cdp-email-line">✉ {{ contact.email }}</span>
            <span v-if="locationLine" class="cdp-loc-line">📍 {{ locationLine }}</span>
          </div>
        </div>
        <button class="cdp-close" @click="$emit('close')" title="Đóng panel">✕</button>
      </div>

      <!-- Pills row: trạng thái Zalo + status + role -->
      <div class="cdp-pills">
        <span class="zalo-pill" :class="zaloPillClass">{{ zaloPillText }}</span>
        <span v-if="(contact as any).displayStatus" class="cdp-pill" :style="statusPillStyle">
          {{ (contact as any).displayStatus.name }}
        </span>
        <span v-for="t in (contact.tags || []).slice(0, 5)" :key="t" class="cdp-pill cdp-tag">🏷 {{ t }}</span>
        <span v-if="(contact as any).viewerRole === 'primary'" class="cdp-pill cdp-role-primary">👤 Bạn phụ trách</span>
        <span v-else-if="(contact as any).viewerRole === 'collaborator'" class="cdp-pill cdp-role-collab">🤝 Cùng chăm</span>
      </div>

      <!-- 2 action buttons chính -->
      <!-- M53 2026-05-30: KH no-Zalo → nút "Mở chat nội bộ" (cam) thay "Mở chat Zalo" (xanh) -->
      <div class="cdp-actions">
        <button
          v-if="contact.hasZalo"
          class="cdp-btn-primary"
          @click="$emit('go-chat')"
        >💬 Mở chat Zalo</button>
        <button
          v-else
          class="cdp-btn-virtual"
          :disabled="virtualLoading"
          @click="openVirtualChat"
          title="KH chưa có Zalo — mở chat nội bộ để ghi nhật ký + AI gợi ý khai thác thông tin"
        >
          <span v-if="virtualLoading">⏳</span>
          <span v-else>🔒</span>
          Mở chat nội bộ
        </button>
        <button class="cdp-btn-outline" @click="openAppointment">📅 Đặt lịch hẹn</button>
        <button class="cdp-btn-outline" @click="addNote">📝 Thêm note</button>
        <button class="cdp-btn-outline" @click="$emit('edit')" title="Sửa thông tin">✎ Sửa</button>
      </div>
    </header>

    <!-- Tabs -->
    <nav class="cdp-tabs">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="cdp-tab"
        :class="{ active: activeTab === t.key }"
        @click="activeTab = t.key"
      >
        {{ t.icon }} {{ t.label }}
        <span v-if="t.count !== undefined" class="cdp-tab-count">({{ t.count }})</span>
      </button>
    </nav>

    <!-- Body -->
    <div class="cdp-body">
      <!-- TAB: Tổng quan -->
      <section v-if="activeTab === 'overview'" class="cdp-section">
        <div class="cdp-info-grid">
          <div class="cdp-info-row">
            <span class="cdp-info-label">Nguồn</span>
            <span class="cdp-info-value">{{ contact.source || '—' }}</span>
          </div>
          <div class="cdp-info-row">
            <span class="cdp-info-label">Lead score</span>
            <span class="cdp-info-value">
              <span class="cdp-score" :class="scoreClass">{{ Math.round((contact as any).displayLeadScore ?? contact.leadScore ?? 0) }}</span>
            </span>
          </div>
          <div class="cdp-info-row">
            <span class="cdp-info-label">Tổng tin nhắn</span>
            <span class="cdp-info-value">📥 {{ (contact as any).totalInbound ?? 0 }} · 📤 {{ (contact as any).totalOutbound ?? 0 }}</span>
          </div>
          <div class="cdp-info-row">
            <span class="cdp-info-label">Hoạt động cuối</span>
            <span class="cdp-info-value">{{ formatRelative(contact.lastActivity) }}</span>
          </div>
          <div class="cdp-info-row" v-if="(contact as any).assignedUser">
            <span class="cdp-info-label">Sale phụ trách</span>
            <span class="cdp-info-value">{{ (contact as any).assignedUser.fullName }}</span>
          </div>
          <div class="cdp-info-row" v-if="contact.notes">
            <span class="cdp-info-label">Ghi chú</span>
            <span class="cdp-info-value">{{ contact.notes }}</span>
          </div>
        </div>
      </section>

      <!-- TAB: Nick chăm -->
      <section v-if="activeTab === 'nicks'" class="cdp-section">
        <div v-if="loadingFriends" class="cdp-loading">Đang tải nick chăm...</div>
        <template v-else>
          <div v-if="myFriends.length > 0" class="cdp-friend-group">
            <h3 class="cdp-h3">👤 Bạn đang chăm qua {{ myFriends.length }} nick</h3>
            <div v-for="f in myFriends" :key="f.id" class="cdp-friend-card cdp-friend-mine">
              <div class="cdp-friend-avatar" :style="{ background: friendBg(f) }">
                <img v-if="f.zaloAvatarUrl" :src="f.zaloAvatarUrl" :alt="friendName(f)" />
                <span v-else>{{ friendInitials(f) }}</span>
              </div>
              <div class="cdp-friend-info">
                <div class="cdp-friend-row1">
                  <span class="cdp-friend-name">{{ friendName(f) }}</span>
                  <span class="cdp-chip-tiny" :class="kindClass(f.relationshipKind)">{{ kindLabel(f.relationshipKind) }}</span>
                </div>
                <div class="cdp-friend-sub">
                  <span v-if="f.aliasInNick">KH gọi: "{{ f.aliasInNick }}"</span>
                  <span class="cdp-when">⏱ {{ formatRelative(f.lastInboundAt || f.lastInteractionAt) }}</span>
                </div>
                <div v-if="f.lastInboundPreview" class="cdp-friend-msg">
                  💬 <PrivateBlur v-if="f.redacted" :redacted="true" mode="inline" />
                  <template v-else>"{{ f.lastInboundPreview }}"</template>
                </div>
              </div>
              <div class="cdp-friend-right">
                <span class="cdp-friend-score" :class="friendScoreClass(f.leadScore)">{{ f.leadScore || 0 }}</span>
                <span class="cdp-role-pill cdp-role-primary">👤 Bạn</span>
              </div>
            </div>
          </div>

          <div v-if="otherFriends.length > 0" class="cdp-friend-group">
            <h3 class="cdp-h3">🤝 Đồng đội cùng chăm ({{ otherFriends.length }})</h3>
            <div v-for="f in otherFriends" :key="f.id" class="cdp-friend-card">
              <div class="cdp-friend-avatar" :style="{ background: friendBg(f) }">
                <img v-if="f.zaloAvatarUrl" :src="f.zaloAvatarUrl" :alt="friendName(f)" />
                <span v-else>{{ friendInitials(f) }}</span>
              </div>
              <div class="cdp-friend-info">
                <div class="cdp-friend-row1">
                  <span class="cdp-friend-name">{{ friendName(f) }}</span>
                  <span class="cdp-chip-tiny" :class="kindClass(f.relationshipKind)">{{ kindLabel(f.relationshipKind) }}</span>
                </div>
                <div class="cdp-friend-sub">
                  <span>Sale: <b>{{ ownerName(f) }}</b></span>
                  <span class="cdp-when">⏱ {{ formatRelative(f.lastInboundAt || f.lastInteractionAt) }}</span>
                </div>
                <div v-if="f.lastInboundPreview" class="cdp-friend-msg">
                  💬 <PrivateBlur v-if="f.redacted" :redacted="true" mode="inline" />
                  <template v-else>"{{ f.lastInboundPreview }}"</template>
                </div>
              </div>
              <div class="cdp-friend-right">
                <span class="cdp-friend-score" :class="friendScoreClass(f.leadScore)">{{ f.leadScore || 0 }}</span>
                <span class="cdp-role-pill cdp-role-collab">🤝 Đồng đội</span>
              </div>
            </div>
          </div>

          <div v-if="myFriends.length === 0 && otherFriends.length === 0" class="cdp-empty">
            Chưa có nick nào kết bạn với KH này.
          </div>
        </template>
      </section>

      <!-- TAB: Lịch sử chat (mini timeline) -->
      <section v-if="activeTab === 'chat'" class="cdp-section">
        <div v-if="loadingTimeline" class="cdp-loading">Đang tải...</div>
        <template v-else>
          <div v-for="t in chatTimeline" :key="t.id" class="cdp-tl-row">
            <span class="cdp-tl-icon">{{ t.icon }}</span>
            <span class="cdp-tl-text">{{ t.text }}</span>
            <span class="cdp-tl-when">{{ formatRelative(t.at) }}</span>
          </div>
          <div v-if="chatTimeline.length === 0" class="cdp-empty">Chưa có hoạt động chat.</div>
        </template>
      </section>

      <!-- TAB: Lịch hẹn -->
      <section v-if="activeTab === 'appt'" class="cdp-section">
        <div v-if="loadingAppts" class="cdp-loading">Đang tải lịch hẹn...</div>
        <template v-else>
          <div v-for="a in appointments" :key="a.id" class="cdp-appt-card">
            <div class="cdp-appt-date">📅 {{ formatDate(a.appointmentDate) }} {{ a.appointmentTime || '' }}</div>
            <div class="cdp-appt-title">{{ a.title || a.type || '(Không tiêu đề)' }}</div>
            <div class="cdp-appt-status" :class="'appt-' + a.status">{{ apptStatusLabel(a.status) }}</div>
            <div v-if="a.notes" class="cdp-appt-notes">{{ a.notes }}</div>
          </div>
          <div v-if="appointments.length === 0" class="cdp-empty">Chưa có lịch hẹn nào.</div>
        </template>
      </section>

      <!-- TAB: Notes -->
      <section v-if="activeTab === 'notes'" class="cdp-section">
        <div v-if="loadingNotes" class="cdp-loading">Đang tải ghi chú...</div>
        <template v-else>
          <div v-for="n in notes" :key="n.id" class="cdp-note-row">
            <div class="cdp-note-author">{{ n.author?.fullName || 'N/A' }} <span class="cdp-when">· {{ formatRelative(n.createdAt) }}</span></div>
            <div class="cdp-note-body">{{ n.body }}</div>
          </div>
          <div v-if="notes.length === 0" class="cdp-empty">Chưa có ghi chú nào.</div>
        </template>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import type { Contact } from '@/composables/use-contacts';
import PrivateBlur from '@/components/privacy/PrivateBlur.vue';

const router = useRouter();

const props = defineProps<{ contact: Contact }>();
const emit = defineEmits<{ close: []; 'go-chat': []; saved: []; edit: [] }>();

type TabKey = 'overview' | 'nicks' | 'chat' | 'appt' | 'notes';
const activeTab = ref<TabKey>('nicks');

// ── Data lazy-loaded per tab ──
const friends = ref<any[]>([]);
const loadingFriends = ref(false);
const appointments = ref<any[]>([]);
const loadingAppts = ref(false);
const notes = ref<any[]>([]);
const loadingNotes = ref(false);
const chatTimeline = ref<any[]>([]);
const loadingTimeline = ref(false);
const currentUserId = ref<string | null>(null);

async function loadFriends() {
  if (loadingFriends.value) return;
  loadingFriends.value = true;
  try {
    const res = await api.get<any>(`/contacts/${props.contact.id}`);
    friends.value = res.data?.friends ?? [];
  } catch { friends.value = []; }
  finally { loadingFriends.value = false; }
}
async function loadAppts() {
  loadingAppts.value = true;
  try {
    const res = await api.get<any>(`/appointments?contactId=${props.contact.id}&limit=20`);
    appointments.value = res.data?.appointments ?? [];
  } catch { appointments.value = []; }
  finally { loadingAppts.value = false; }
}
async function loadNotes() {
  loadingNotes.value = true;
  try {
    const res = await api.get<any>(`/contacts/${props.contact.id}/notes`);
    notes.value = res.data?.notes ?? [];
  } catch { notes.value = []; }
  finally { loadingNotes.value = false; }
}
async function loadTimeline() {
  loadingTimeline.value = true;
  try {
    const res = await api.get<any>(`/customers/${props.contact.id}/timeline?limit=20&categories=message,call,note`);
    chatTimeline.value = (res.data?.items ?? []).map((x: any) => ({
      id: x.id,
      icon: x.type === 'message' ? '💬' : x.type === 'call' ? '📞' : '📝',
      text: x.data?.preview || x.data?.body || x.data?.summary || '(không nội dung)',
      at: x.createdAt,
    }));
  } catch { chatTimeline.value = []; }
  finally { loadingTimeline.value = false; }
}

watch(() => props.contact.id, () => {
  // Reset state khi đổi KH selected
  friends.value = [];
  appointments.value = [];
  notes.value = [];
  chatTimeline.value = [];
  loadDataForActiveTab();
}, { immediate: false });

watch(activeTab, () => loadDataForActiveTab());

function loadDataForActiveTab() {
  if (activeTab.value === 'nicks' && friends.value.length === 0) loadFriends();
  if (activeTab.value === 'appt' && appointments.value.length === 0) loadAppts();
  if (activeTab.value === 'notes' && notes.value.length === 0) loadNotes();
  if (activeTab.value === 'chat' && chatTimeline.value.length === 0) loadTimeline();
}

onMounted(async () => {
  // Lấy currentUserId từ /auth/me hoặc store — đơn giản gọi /me/onboarding endpoint trả userId
  try {
    const res = await api.get<any>('/me/onboarding');
    currentUserId.value = res.data?.userId ?? null;
  } catch { /* ignore */ }
  loadDataForActiveTab();
});

// ── Computed ──
const displayName = computed(() => props.contact.fullName || props.contact.crmName || '(chưa đặt tên)');
const isOwner = computed(() => (props.contact as any).role === 'owner');
const locationLine = computed(() => {
  const c: any = props.contact;
  return [c.district, c.province].filter(Boolean).join(', ');
});

const initials = computed(() => {
  const s = displayName.value.trim();
  if (!s) return '?';
  const parts = s.split(/\s+/);
  return parts.length === 1 ? s.charAt(0).toUpperCase() : (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
});

const avatarBg = computed(() => {
  const palette = ['#aa2d00', '#0a2e0e', '#1b61c9', '#7a5818', '#1a3866', '#7a2000', '#94a3b8'];
  const h = displayName.value.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[h % palette.length];
});

const zaloPillClass = computed(() => {
  if (props.contact.hasZalo === true) return 'zalo-yes';
  if (props.contact.hasZalo === false) return 'zalo-no';
  return 'zalo-unknown';
});
const zaloPillText = computed(() => {
  if (props.contact.hasZalo === true) return '🟢 Có Zalo';
  if (props.contact.hasZalo === false) return '🔴 Không tìm thấy';
  return '⚪ Chưa tìm';
});

const statusPillStyle = computed(() => {
  const s = (props.contact as any).displayStatus;
  if (!s?.color) return {};
  return { background: s.color + '22', color: s.color };
});

const scoreClass = computed(() => {
  const s = Math.round((props.contact as any).displayLeadScore ?? props.contact.leadScore ?? 0);
  if (s >= 70) return 'score-high';
  if (s >= 40) return 'score-mid';
  return 'score-low';
});

const myFriends = computed(() => {
  return friends.value.filter((f: any) => f.zaloAccount?.owner?.id === currentUserId.value);
});
const otherFriends = computed(() => {
  return friends.value.filter((f: any) => f.zaloAccount?.owner?.id !== currentUserId.value);
});

const tabs = computed(() => [
  { key: 'overview' as TabKey, icon: '📋', label: 'Tổng quan' },
  { key: 'nicks' as TabKey, icon: '👥', label: 'Nick chăm', count: friends.value.length || (props.contact as any).childrenCount },
  { key: 'chat' as TabKey, icon: '💬', label: 'Lịch sử chat' },
  { key: 'appt' as TabKey, icon: '📅', label: 'Lịch hẹn', count: appointments.value.length || undefined },
  { key: 'notes' as TabKey, icon: '📝', label: 'Notes', count: notes.value.length || undefined },
]);

// ── Helpers ──
function friendName(f: any): string {
  return f.zaloAccount?.displayName || f.zaloDisplayName || f.aliasInNick || '(nick chưa đặt tên)';
}
function friendInitials(f: any): string {
  const s = friendName(f);
  const parts = s.split(/\s+/);
  return parts.length === 1 ? s.charAt(0).toUpperCase() : (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}
function friendBg(f: any): string {
  const palette = ['#aa2d00', '#0a2e0e', '#1b61c9', '#7a5818', '#1a3866', '#7a2000'];
  const name = friendName(f);
  const h = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palette[h % palette.length];
}
function ownerName(f: any): string {
  return f.zaloAccount?.owner?.fullName || '(không gán sale)';
}
function kindLabel(k: string): string {
  return ({
    friend: '🟢 Đã KB',
    pending_friend: '🟡 Đã mời',
    chatting_stranger: '💬 Chat lạ',
    ghost: '🚫 Ngắt',
    none: '⚪ Chưa KB',
  } as Record<string, string>)[k] || k;
}
function kindClass(k: string): string {
  return ({
    friend: 'kind-friend',
    pending_friend: 'kind-pending',
    chatting_stranger: 'kind-stranger',
    ghost: 'kind-ghost',
  } as Record<string, string>)[k] || 'kind-none';
}
function friendScoreClass(s: number): string {
  if (s >= 70) return 'score-high';
  if (s >= 40) return 'score-mid';
  return 'score-low';
}

function formatRelative(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  const diff = Date.now() - date.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h trước`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days} ngày trước`;
  return date.toLocaleDateString('vi-VN');
}
function formatDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('vi-VN');
}
function apptStatusLabel(s: string): string {
  return ({
    scheduled: '📅 Đã lên lịch',
    completed: '✅ Hoàn thành',
    cancelled: '❌ Huỷ',
    no_show: '⚠ Không đến',
  } as Record<string, string>)[s] || s;
}

function openAppointment() { emit('edit'); /* mở dialog nhắc hẹn — hiện tại reuse edit */ }
function addNote() { activeTab.value = 'notes'; /* TODO: focus textarea note */ }

// M53 2026-05-30: Mở Virtual Chat cho KH no-Zalo
const virtualLoading = ref(false);
async function openVirtualChat() {
  if (virtualLoading.value) return;
  virtualLoading.value = true;
  try {
    const res = await api.post<{ conversationId: string; created: boolean }>(
      `/contacts/${props.contact.id}/virtual-conversation`,
      {}
    );
    const convId = res.data?.conversationId;
    if (!convId) throw new Error('No conversationId returned');
    // Navigate sang /chat với conversation virtual mở sẵn
    await router.push({ path: '/chat', query: { conversationId: convId } });
  } catch (e: any) {
    const msg = e?.response?.data?.message || e?.message || 'Lỗi mở chat nội bộ';
    alert(msg);
  } finally {
    virtualLoading.value = false;
  }
}
</script>

<style scoped>
.cdp-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
  overflow: hidden;
}

/* ── Header ── */
.cdp-head {
  padding: 20px 24px 14px;
  border-bottom: 1px solid #e5e7eb;
  flex-shrink: 0;
}
.cdp-head-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  margin-bottom: 12px;
}
.cdp-avatar {
  width: 56px; height: 56px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 18px; font-weight: 500;
  flex-shrink: 0;
  overflow: hidden;
}
.cdp-avatar img { width: 100%; height: 100%; object-fit: cover; }
.cdp-head-info { flex: 1; min-width: 0; }
.cdp-name {
  font-size: 20px; font-weight: 500; color: #181d26;
  display: flex; align-items: center; gap: 6px;
  letter-spacing: -0.01em;
}
.cdp-crown { font-size: 16px; }
.cdp-meta {
  display: flex; flex-wrap: wrap; gap: 12px;
  font-size: 12.5px; color: #41454d;
  margin-top: 4px;
}
.cdp-meta code {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  background: transparent;
  color: #333840;
}
.cdp-close {
  background: transparent;
  border: none;
  font-size: 18px;
  cursor: pointer;
  color: #94a3b8;
  padding: 4px 8px;
  border-radius: 6px;
}
.cdp-close:hover { background: #f1f5f9; color: #475569; }

/* Pills row */
.cdp-pills {
  display: flex; flex-wrap: wrap; gap: 5px;
  margin-bottom: 12px;
}
.zalo-pill {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11.5px;
  padding: 3px 10px;
  border-radius: 9999px;
  font-weight: 600;
  white-space: nowrap;
}
.zalo-pill.zalo-yes { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
.zalo-pill.zalo-no { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
.zalo-pill.zalo-unknown { background: #f1f5f9; color: #475569; border: 1px dashed #cbd5e1; }
.cdp-pill {
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 9999px;
  font-weight: 500;
  background: #f1f5f9; color: #475569;
}
.cdp-tag { background: #fef3c7; color: #92400e; }
.cdp-role-primary { background: #eef0ff; color: #4f46e5; }
.cdp-role-collab { background: #fef3c7; color: #92400e; }

/* Actions */
.cdp-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.cdp-btn-primary {
  background: #181d26; color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.cdp-btn-outline {
  background: white; color: #181d26;
  border: 1px solid #dddddd;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px; font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.cdp-btn-outline:hover { background: #f8fafc; }

/* M53 2026-05-30: nút Mở chat nội bộ — màu cam */
.cdp-btn-virtual {
  background: linear-gradient(135deg, #f97316, #ea580c);
  color: white;
  border: none;
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.cdp-btn-virtual:hover:not(:disabled) {
  background: linear-gradient(135deg, #ea580c, #c2410c);
}
.cdp-btn-virtual:disabled {
  opacity: 0.6;
  cursor: wait;
}

/* Tabs */
.cdp-tabs {
  display: flex;
  border-bottom: 1px solid #e5e7eb;
  padding: 0 24px;
  flex-shrink: 0;
  overflow-x: auto;
}
.cdp-tab {
  background: transparent;
  border: none;
  padding: 11px 12px;
  font-size: 13px;
  color: #41454d;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  font-family: inherit;
  white-space: nowrap;
}
.cdp-tab:hover { color: #181d26; }
.cdp-tab.active {
  color: #181d26;
  font-weight: 500;
  border-bottom-color: #aa2d00;
}
.cdp-tab-count { color: #94a3b8; font-size: 11.5px; margin-left: 2px; }

/* Body scrollable */
.cdp-body {
  flex: 1; min-height: 0;
  overflow-y: auto;
  padding: 16px 24px 24px;
}

.cdp-section h3.cdp-h3 {
  font-size: 11.5px;
  color: #41454d;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 500;
  margin: 0 0 8px;
}
.cdp-section + .cdp-section { margin-top: 16px; }
.cdp-friend-group + .cdp-friend-group { margin-top: 16px; }
.cdp-loading, .cdp-empty {
  text-align: center;
  color: #94a3b8;
  font-size: 13px;
  padding: 20px 0;
}

/* ── Info grid (tab Tổng quan) ── */
.cdp-info-grid {
  display: flex; flex-direction: column; gap: 0;
}
.cdp-info-row {
  display: flex; align-items: flex-start;
  padding: 9px 0;
  border-bottom: 1px dashed #e5e7eb;
}
.cdp-info-row:last-child { border-bottom: none; }
.cdp-info-label {
  flex: 0 0 140px;
  font-size: 12.5px;
  color: #41454d;
  font-weight: 500;
}
.cdp-info-value {
  flex: 1;
  font-size: 13px;
  color: #181d26;
}
.cdp-score {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 36px; padding: 2px 8px;
  border-radius: 6px;
  font-weight: 600; font-size: 12.5px;
}
.cdp-score.score-high { background: #dcfce7; color: #166534; }
.cdp-score.score-mid { background: #fef9c3; color: #854d0e; }
.cdp-score.score-low { background: #fee2e2; color: #991b1b; }

/* ── Friend cards (tab Nick chăm) ── */
.cdp-friend-card {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 13px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  background: white;
  margin-bottom: 8px;
}
.cdp-friend-mine { border-color: #a5b4fc; background: #f5f7ff; }
.cdp-friend-avatar {
  width: 36px; height: 36px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  color: white; font-size: 12px; font-weight: 500;
  flex-shrink: 0;
  overflow: hidden;
}
.cdp-friend-avatar img { width: 100%; height: 100%; object-fit: cover; }
.cdp-friend-info { flex: 1; min-width: 0; }
.cdp-friend-row1 {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 2px;
}
.cdp-friend-name {
  font-size: 13.5px; font-weight: 500; color: #181d26;
}
.cdp-friend-sub {
  display: flex; gap: 10px;
  font-size: 11.5px; color: #41454d;
}
.cdp-friend-msg {
  margin-top: 4px;
  font-size: 12px; color: #333840;
  font-style: italic;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 100%;
}
.cdp-redacted { color: #94a3b8; font-style: normal; }
.cdp-when { color: #94a3b8; }
.cdp-friend-right {
  display: flex; flex-direction: column; align-items: flex-end; gap: 4px;
  flex-shrink: 0;
}
.cdp-friend-score {
  font-size: 13px; font-weight: 600;
  padding: 3px 9px;
  border-radius: 6px;
  min-width: 36px; text-align: center;
}
.cdp-friend-score.score-high { background: #dcfce7; color: #166534; }
.cdp-friend-score.score-mid { background: #fef9c3; color: #854d0e; }
.cdp-friend-score.score-low { background: #fee2e2; color: #991b1b; }
.cdp-role-pill {
  font-size: 10px; font-weight: 600;
  padding: 2px 7px;
  border-radius: 9999px;
}
.cdp-chip-tiny {
  font-size: 10.5px;
  padding: 1.5px 7px;
  border-radius: 9999px;
  font-weight: 500;
}
.cdp-chip-tiny.kind-friend { background: #dcfce7; color: #166534; }
.cdp-chip-tiny.kind-pending { background: #fef9c3; color: #854d0e; }
.cdp-chip-tiny.kind-stranger { background: #cffafe; color: #155e75; }
.cdp-chip-tiny.kind-ghost { background: #fee2e2; color: #991b1b; }
.cdp-chip-tiny.kind-none { background: #f1f5f9; color: #475569; }

/* ── Timeline (tab Chat) ── */
.cdp-tl-row {
  display: flex; gap: 10px; align-items: center;
  padding: 8px 0;
  border-bottom: 1px dashed #e5e7eb;
  font-size: 12.5px;
}
.cdp-tl-row:last-child { border-bottom: none; }
.cdp-tl-icon {
  width: 24px; height: 24px;
  border-radius: 50%;
  background: #f8fafc;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
  flex-shrink: 0;
}
.cdp-tl-text { flex: 1; color: #333840; }
.cdp-tl-when { font-size: 11px; color: #94a3b8; }

/* ── Appointments (tab Lịch hẹn) ── */
.cdp-appt-card {
  padding: 12px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  margin-bottom: 8px;
}
.cdp-appt-date { font-size: 13px; font-weight: 500; color: #181d26; }
.cdp-appt-title { font-size: 12.5px; color: #333840; margin-top: 4px; }
.cdp-appt-status {
  display: inline-block;
  font-size: 11px; font-weight: 500;
  padding: 2px 8px;
  border-radius: 9999px;
  margin-top: 6px;
}
.cdp-appt-status.appt-scheduled { background: #ede9fe; color: #5b21b6; }
.cdp-appt-status.appt-completed { background: #dcfce7; color: #166534; }
.cdp-appt-status.appt-cancelled { background: #fee2e2; color: #991b1b; }
.cdp-appt-status.appt-no_show { background: #fef9c3; color: #854d0e; }
.cdp-appt-notes { font-size: 12px; color: #41454d; margin-top: 6px; font-style: italic; }

/* ── Notes ── */
.cdp-note-row {
  padding: 10px 0;
  border-bottom: 1px dashed #e5e7eb;
}
.cdp-note-row:last-child { border-bottom: none; }
.cdp-note-author { font-size: 11.5px; color: #94a3b8; margin-bottom: 4px; }
.cdp-note-body { font-size: 13px; color: #333840; line-height: 1.5; white-space: pre-wrap; }

/* ── Responsive (HD / Full HD / 2K) — Per memory: KHÔNG mobile ── */
@media (min-width: 1920px) {
  .cdp-head { padding: 24px 28px 16px; }
  .cdp-body { padding: 20px 28px 28px; }
  .cdp-tabs { padding: 0 28px; }
}
@media (min-width: 2560px) {
  .cdp-head { padding: 28px 32px 18px; }
  .cdp-body { padding: 24px 32px 32px; }
  .cdp-tabs { padding: 0 32px; }
  .cdp-name { font-size: 22px; }
  .cdp-friend-name { font-size: 14.5px; }
}
</style>
