<!--
  LeadRequestModal — Phase Lead Pool 2026-05-24.
  Modal hoành tráng hiển thị full thông tin lead sale vừa nhận.
  Đầy đủ: contact info + hành trình + insight + note lịch sử + gợi ý mở chat.
-->
<template>
  <div v-if="lead" class="lrm-overlay" @click.self="onClose">
    <div class="lrm-modal" role="dialog" aria-labelledby="lrm-title">
      <!-- ─── Header — score badge ─── -->
      <header class="lrm-header" :class="sourceClass">
        <div class="lrm-source-badge">
          <span class="lrm-source-icon">{{ sourceIcon }}</span>
          <span class="lrm-source-text">{{ sourceLabel }}</span>
        </div>
        <h2 id="lrm-title" class="lrm-title">
          🎯 Lead mới · Priority Score <strong>{{ lead.priorityScore }}</strong>
        </h2>
        <button class="lrm-close" @click="onClose" aria-label="Đóng">✕</button>
      </header>

      <!-- ─── Body scrollable ─── -->
      <div class="lrm-body">
        <!-- Profile -->
        <section class="lrm-profile">
          <div class="lrm-avatar" :style="{ background: avatarColor }">
            <img v-if="lead.contact.avatarUrl" :src="lead.contact.avatarUrl" :alt="displayName" />
            <span v-else>{{ initials }}</span>
          </div>
          <div class="lrm-profile-info">
            <h3 class="lrm-name">{{ displayName }}</h3>
            <div class="lrm-meta">
              <span v-if="lead.contact.phone" class="lrm-phone">📱 {{ lead.contact.phone }}</span>
              <span v-if="lead.contact.hasZalo === true" class="lrm-tag lrm-tag-green">🟢 Có Zalo</span>
              <span v-else-if="lead.contact.hasZalo === false" class="lrm-tag lrm-tag-grey">⚪ Chưa có Zalo</span>
              <span v-else class="lrm-tag lrm-tag-grey">❔ Chưa rõ Zalo</span>
            </div>
            <div v-if="locationLine" class="lrm-meta-sub">📍 {{ locationLine }}</div>
            <div v-if="lead.contact.email" class="lrm-meta-sub">✉ {{ lead.contact.email }}</div>
          </div>
        </section>

        <!-- ─── Insights grid ─── -->
        <section class="lrm-insights">
          <div class="lrm-stat">
            <div class="lrm-stat-label">Bỏ rơi</div>
            <div class="lrm-stat-value">
              {{ lead.insights.daysIdle != null ? lead.insights.daysIdle + ' ngày' : '—' }}
            </div>
          </div>
          <div class="lrm-stat">
            <div class="lrm-stat-label">Tin nhắn</div>
            <div class="lrm-stat-value">{{ lead.insights.totalMessages }}</div>
          </div>
          <div class="lrm-stat">
            <div class="lrm-stat-label">Đã kết bạn</div>
            <div class="lrm-stat-value">{{ lead.insights.acceptedFriendCount }} nick</div>
          </div>
          <div class="lrm-stat" :class="{ 'lrm-stat-warn': lead.insights.noShowCount > 0 }">
            <div class="lrm-stat-label">Lỡ hẹn</div>
            <div class="lrm-stat-value">{{ lead.insights.noShowCount }}</div>
          </div>
        </section>

        <!-- ─── Hành trình ─── -->
        <section class="lrm-section">
          <h4 class="lrm-section-title">📊 Hành trình</h4>
          <div class="lrm-info-grid">
            <div class="lrm-info-row">
              <span class="lrm-info-label">Nguồn:</span>
              <span class="lrm-info-value">{{ lead.contact.source || '—' }}</span>
            </div>
            <div class="lrm-info-row">
              <span class="lrm-info-label">Trạng thái:</span>
              <span class="lrm-info-value">
                <span class="lrm-status-chip" :style="statusChipStyle">
                  {{ lead.contact.status?.name || lead.contact.status || '—' }}
                </span>
              </span>
            </div>
            <div v-if="lead.previousAssignee" class="lrm-info-row">
              <span class="lrm-info-label">Sale cũ:</span>
              <span class="lrm-info-value">
                {{ lead.previousAssignee.fullName }}
                <small v-if="!lead.previousAssignee.isActive" class="lrm-muted">(đã vô hiệu)</small>
              </span>
            </div>
            <div class="lrm-info-row">
              <span class="lrm-info-label">Last activity:</span>
              <span class="lrm-info-value">{{ formatDate(lead.contact.lastActivity) }}</span>
            </div>
          </div>
        </section>

        <!-- ─── Note lịch sử ─── -->
        <section v-if="lead.recentNotes.length > 0" class="lrm-section">
          <h4 class="lrm-section-title">💬 Note gần đây ({{ lead.recentNotes.length }})</h4>
          <ul class="lrm-notes">
            <li v-for="n in lead.recentNotes" :key="n.id" class="lrm-note">
              <div class="lrm-note-body">{{ n.body }}</div>
              <div class="lrm-note-meta">
                — {{ n.author?.fullName || 'N/A' }} · {{ formatDate(n.createdAt) }}
              </div>
            </li>
          </ul>
        </section>

        <!-- ─── Appointments ─── -->
        <section v-if="lead.recentAppointments.length > 0" class="lrm-section">
          <h4 class="lrm-section-title">📅 Lịch hẹn gần đây</h4>
          <ul class="lrm-appts">
            <li v-for="a in lead.recentAppointments" :key="a.id" class="lrm-appt">
              <span class="lrm-appt-date">{{ formatDate(a.appointmentDate) }}</span>
              <span class="lrm-appt-title">{{ a.title || '(không tiêu đề)' }}</span>
              <span class="lrm-appt-status" :class="`status-${a.status}`">{{ apptStatusLabel(a.status) }}</span>
            </li>
          </ul>
        </section>

        <!-- ─── Gợi ý mở chat ─── -->
        <section class="lrm-section lrm-suggestions">
          <h4 class="lrm-section-title">💡 Gợi ý câu mở đầu</h4>
          <div class="lrm-sug-list">
            <button
              v-for="(s, i) in lead.suggestedOpenings"
              :key="i"
              class="lrm-sug-item"
              @click="copyToClipboard(s)"
              :title="copied === i ? 'Đã copy!' : 'Click để copy'"
            >
              <span class="lrm-sug-text">{{ s }}</span>
              <span class="lrm-sug-icon">{{ copied === i ? '✓' : '📋' }}</span>
            </button>
          </div>
        </section>
      </div>

      <!-- ─── Footer actions ─── -->
      <footer class="lrm-footer">
        <button class="lrm-btn-ghost" :disabled="returning" @click="onReturn">
          ↩ Trả lại pool
        </button>
        <div class="lrm-footer-main">
          <button v-if="primaryZaloFriend" class="lrm-btn" @click="onOpenChat">
            💬 Mở chat ({{ primaryZaloFriend.zaloAccount?.displayName || 'nick' }})
          </button>
          <button class="lrm-btn-primary" @click="onShowNote">
            📝 Ghi note ngay
          </button>
        </div>
      </footer>

      <!-- ─── Note input (inline expand) ─── -->
      <div v-if="noteFormOpen" class="lrm-note-form">
        <textarea
          v-model="noteText"
          class="lrm-note-textarea"
          :placeholder="`Note tối thiểu ${noteMinLength} ký tự. Vd: Đã gọi điện, KH bận, hẹn lại 16h chiều...`"
          rows="3"
        ></textarea>
        <div class="lrm-note-actions">
          <span class="lrm-note-counter" :class="{ 'lrm-note-ok': noteText.length >= noteMinLength }">
            {{ noteText.length }} / {{ noteMinLength }}
          </span>
          <button class="lrm-btn-ghost" :disabled="submitting" @click="noteFormOpen = false">Huỷ</button>
          <button
            class="lrm-btn-primary"
            :disabled="submitting || noteText.length < noteMinLength"
            @click="onSubmitNote"
          >
            <span v-if="submitting">Đang lưu...</span>
            <span v-else>Lưu note + Bắt đầu chăm</span>
          </button>
        </div>
      </div>

      <div v-if="actionError" class="lrm-error">⚠ {{ actionError }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useLeadPool, type LeadPayload } from '@/composables/use-lead-pool';

const props = defineProps<{ lead: LeadPayload | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'note-submitted'): void;
  (e: 'returned'): void;
}>();

const router = useRouter();
const { submitNote, returnLead, eligibility } = useLeadPool();

const noteFormOpen = ref(false);
const noteText = ref('');
const submitting = ref(false);
const returning = ref(false);
const actionError = ref('');
const copied = ref<number | null>(null);

const noteMinLength = computed(() => eligibility.value?.config.noteMinLength ?? 20);

const displayName = computed(() => {
  const c = props.lead?.contact;
  return c?.crmName || c?.fullName || c?.phone || 'KH chưa đặt tên';
});

const initials = computed(() => {
  const n = displayName.value;
  const parts = n.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

const avatarColor = computed(() => {
  const palette = [
    'linear-gradient(135deg,#3b82f6,#1e40af)',
    'linear-gradient(135deg,#10b981,#059669)',
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#8b5cf6,#6d28d9)',
    'linear-gradient(135deg,#ec4899,#be185d)',
  ];
  const h = displayName.value.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  return palette[h % palette.length];
});

const locationLine = computed(() => {
  const c = props.lead?.contact;
  if (!c) return '';
  return [c.ward, c.district, c.province].filter(Boolean).join(', ');
});

const sourceLabel = computed(() => {
  return ({
    forgotten: 'Khách bị bỏ quên',
    customer_list: 'Tệp khách hàng',
    external_sync: 'Sync từ CRM khác',
  } as Record<string, string>)[props.lead?.source ?? ''] || 'Lead';
});

const sourceIcon = computed(() => {
  return ({
    forgotten: '💤',
    customer_list: '📂',
    external_sync: '🔄',
  } as Record<string, string>)[props.lead?.source ?? ''] || '🎯';
});

const sourceClass = computed(() => `lrm-source-${props.lead?.source}`);

const statusChipStyle = computed(() => {
  const color = (props.lead?.contact.status as any)?.color;
  if (color) return { background: color + '22', color, border: `1px solid ${color}55` };
  return {};
});

const primaryZaloFriend = computed(() => {
  return props.lead?.friends.find((f: any) => f.friendshipStatus === 'accepted') ?? null;
});

function apptStatusLabel(s: string) {
  return ({ scheduled: 'Đã hẹn', completed: 'Đã gặp', cancelled: 'Huỷ', no_show: 'Lỡ hẹn' } as Record<string, string>)[s] || s;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    const idx = props.lead?.suggestedOpenings.indexOf(text) ?? -1;
    copied.value = idx;
    setTimeout(() => { copied.value = null; }, 1500);
  } catch { /* silent */ }
}

function onOpenChat() {
  // Tìm conversation đầu tiên của contact để navigate
  // (FE cần API contact → conversation; fallback: navigate to /contacts/:id)
  if (props.lead?.contact.id) {
    router.push(`/contacts/${props.lead.contact.id}/activity`);
  }
}

function onShowNote() {
  noteFormOpen.value = true;
  actionError.value = '';
}

function onClose() {
  emit('close');
}

async function onSubmitNote() {
  if (!props.lead) return;
  if (noteText.value.length < noteMinLength.value) return;
  submitting.value = true;
  actionError.value = '';
  const ok = await submitNote(props.lead.leadRequestId, noteText.value);
  submitting.value = false;
  if (ok) {
    emit('note-submitted');
  } else {
    actionError.value = 'Lưu note thất bại';
  }
}

async function onReturn() {
  if (!props.lead) return;
  if (!confirm('Trả lại lead này về pool?')) return;
  returning.value = true;
  const ok = await returnLead(props.lead.leadRequestId);
  returning.value = false;
  if (ok) emit('returned');
  else actionError.value = 'Trả lead thất bại';
}
</script>

<style scoped>
.lrm-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  backdrop-filter: blur(2px);
}

.lrm-modal {
  background: white;
  border-radius: 16px;
  max-width: 720px; width: 100%;
  max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.3);
  overflow: hidden;
}

/* ─── Header ─── */
.lrm-header {
  padding: 18px 24px;
  background: linear-gradient(135deg, #EEF0FF 0%, #DBEAFE 100%);
  border-bottom: 1px solid #C7D2FE;
  display: flex; align-items: center; gap: 12px;
  position: relative;
}
.lrm-source-forgotten { background: linear-gradient(135deg, #FEF3C7, #FDE68A); border-color: #FCD34D; }
.lrm-source-customer_list { background: linear-gradient(135deg, #DCFCE7, #BBF7D0); border-color: #86EFAC; }

.lrm-source-badge {
  background: rgba(255, 255, 255, 0.8);
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 700;
  display: inline-flex; align-items: center; gap: 5px;
}
.lrm-source-icon { font-size: 14px; }

.lrm-title {
  margin: 0; flex: 1;
  font-size: 16px; font-weight: 700; color: #0F172A;
}
.lrm-title strong {
  color: #5E6AD2;
  font-weight: 800;
}

.lrm-close {
  background: transparent; border: none; cursor: pointer;
  font-size: 18px; font-weight: 700; color: #475569;
  padding: 4px 10px; border-radius: 6px;
  font-family: inherit;
}
.lrm-close:hover { background: rgba(0,0,0,0.08); color: #DC2626; }

/* ─── Body ─── */
.lrm-body {
  flex: 1; overflow-y: auto;
  padding: 20px 24px;
  display: flex; flex-direction: column; gap: 20px;
}

/* Profile */
.lrm-profile {
  display: flex; align-items: center; gap: 16px;
  padding-bottom: 16px; border-bottom: 1px solid #E5E7EB;
}
.lrm-avatar {
  width: 64px; height: 64px;
  border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 22px;
  overflow: hidden; flex-shrink: 0;
}
.lrm-avatar img { width: 100%; height: 100%; object-fit: cover; }

.lrm-profile-info { flex: 1; min-width: 0; }
.lrm-name {
  margin: 0 0 6px;
  font-size: 18px; font-weight: 700; color: #0F172A;
}
.lrm-meta { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.lrm-phone { font-size: 13px; color: #475569; font-weight: 600; font-variant-numeric: tabular-nums; }
.lrm-meta-sub { font-size: 12.5px; color: #64748B; margin-top: 4px; }

.lrm-tag {
  font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 9999px;
}
.lrm-tag-green { background: #DCFCE7; color: #166534; }
.lrm-tag-grey { background: #F1F5F9; color: #64748B; }

/* Insights */
.lrm-insights {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
}
.lrm-stat {
  background: #F8FAFC; border: 1px solid #E5E7EB;
  padding: 10px 12px; border-radius: 10px;
  display: flex; flex-direction: column; gap: 4px;
}
.lrm-stat-warn { background: #FEF3C7; border-color: #FCD34D; }
.lrm-stat-label {
  font-size: 10.5px; color: #64748B; font-weight: 600;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.lrm-stat-value {
  font-size: 16px; font-weight: 700; color: #0F172A;
  font-variant-numeric: tabular-nums;
}

/* Section */
.lrm-section { display: flex; flex-direction: column; gap: 10px; }
.lrm-section-title {
  margin: 0; font-size: 13px; font-weight: 700; color: #475569;
  text-transform: uppercase; letter-spacing: 0.02em;
}

.lrm-info-grid { display: flex; flex-direction: column; gap: 6px; }
.lrm-info-row { display: flex; gap: 10px; font-size: 13px; }
.lrm-info-label { color: #64748B; min-width: 90px; flex-shrink: 0; }
.lrm-info-value { color: #0F172A; flex: 1; }
.lrm-muted { color: #94A3B8; font-style: italic; }
.lrm-status-chip {
  background: #EEF0FF; color: #3730A3;
  padding: 2px 9px; border-radius: 9999px;
  font-size: 12px; font-weight: 600;
}

.lrm-notes, .lrm-appts {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 8px;
}
.lrm-note {
  background: #F8FAFC;
  padding: 10px 14px; border-radius: 8px;
  border-left: 3px solid #5E6AD2;
}
.lrm-note-body { font-size: 13px; color: #0F172A; line-height: 1.5; }
.lrm-note-meta { font-size: 11.5px; color: #94A3B8; margin-top: 4px; font-style: italic; }

.lrm-appt {
  display: flex; gap: 12px; padding: 8px 14px;
  background: #F8FAFC; border-radius: 8px;
  font-size: 13px; align-items: center;
}
.lrm-appt-date { color: #64748B; font-variant-numeric: tabular-nums; min-width: 130px; }
.lrm-appt-title { flex: 1; color: #0F172A; }
.lrm-appt-status {
  font-size: 11px; font-weight: 700;
  padding: 2px 8px; border-radius: 9999px;
}
.lrm-appt-status.status-scheduled { background: #DBEAFE; color: #1E40AF; }
.lrm-appt-status.status-completed { background: #DCFCE7; color: #166534; }
.lrm-appt-status.status-cancelled { background: #F1F5F9; color: #64748B; }
.lrm-appt-status.status-no_show { background: #FEE2E2; color: #B91C1C; }

/* Suggestions */
.lrm-suggestions { background: linear-gradient(135deg, #FEFCE8, #FEF3C7); padding: 14px; border-radius: 10px; margin: -4px; }
.lrm-sug-list { display: flex; flex-direction: column; gap: 6px; }
.lrm-sug-item {
  background: white; border: 1px dashed #FCD34D;
  padding: 9px 14px; border-radius: 8px;
  text-align: left; cursor: pointer;
  display: flex; gap: 8px; align-items: flex-start;
  font-family: inherit;
  transition: border-color 0.15s, background 0.15s;
}
.lrm-sug-item:hover { background: #FFFBEB; border-color: #F59E0B; }
.lrm-sug-text { font-size: 12.5px; color: #92400E; line-height: 1.5; flex: 1; }
.lrm-sug-icon { font-size: 14px; flex-shrink: 0; }

/* Footer */
.lrm-footer {
  padding: 14px 24px;
  background: #FAFBFC;
  border-top: 1px solid #E5E7EB;
  display: flex; gap: 10px; align-items: center; justify-content: space-between;
}
.lrm-footer-main { display: flex; gap: 10px; align-items: center; }

.lrm-btn, .lrm-btn-primary, .lrm-btn-ghost {
  padding: 9px 18px; border-radius: 9px;
  font-weight: 700; font-size: 13px; cursor: pointer;
  font-family: inherit;
  transition: background 0.15s;
}
.lrm-btn {
  background: white; color: #5E6AD2;
  border: 1px solid #C7D2FE;
}
.lrm-btn:hover { background: #EEF0FF; }
.lrm-btn-primary {
  background: #5E6AD2; color: white; border: none;
}
.lrm-btn-primary:hover:not(:disabled) { background: #4F46E5; }
.lrm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.lrm-btn-ghost {
  background: transparent; color: #B91C1C; border: none;
  font-weight: 500;
}
.lrm-btn-ghost:hover:not(:disabled) { background: #FEF2F2; }
.lrm-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }

/* Note form */
.lrm-note-form {
  padding: 14px 24px;
  background: #FFFBEB;
  border-top: 1px solid #FCD34D;
  display: flex; flex-direction: column; gap: 10px;
}
.lrm-note-textarea {
  width: 100%;
  padding: 10px 12px;
  border: 1.5px solid #FCD34D;
  border-radius: 9px;
  font-size: 13.5px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  background: white;
}
.lrm-note-textarea:focus { border-color: #F59E0B; }
.lrm-note-actions { display: flex; gap: 8px; align-items: center; justify-content: flex-end; }
.lrm-note-counter {
  font-size: 12px; color: #94A3B8; font-variant-numeric: tabular-nums;
  margin-right: auto;
}
.lrm-note-counter.lrm-note-ok { color: #047857; font-weight: 700; }

.lrm-error {
  margin: 0 24px 14px;
  padding: 9px 13px;
  background: #FEF2F2; color: #B91C1C;
  border: 1px solid #FCA5A5; border-radius: 7px;
  font-size: 12.5px;
}

/* Mobile */
@media (max-width: 640px) {
  .lrm-overlay { padding: 0; }
  .lrm-modal { max-height: 100vh; border-radius: 0; }
  .lrm-insights { grid-template-columns: repeat(2, 1fr); }
  .lrm-footer { flex-wrap: wrap; }
}
</style>
