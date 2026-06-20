<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="chat-appointments">
    <v-divider class="my-3" />
    <div class="d-flex align-center mb-2">
      <v-icon size="16" color="warning" class="mr-1">mdi-calendar-clock</v-icon>
      <span class="text-caption font-weight-bold">Lịch hẹn ({{ appointments.length }})</span>
      <v-spacer />
      <v-btn
        size="x-small"
        variant="tonal"
        color="primary"
        rounded
        @click="openEditor(null)"
      >
        <v-icon size="14" class="mr-1">mdi-plus</v-icon>
        Tạo
      </v-btn>
    </div>

    <!-- Modal "Nhắc hẹn" — AppointmentEditor unified với trang /appointments + edit mode.
         Tạo mới: editingApt=null. Sửa: editingApt = apt (modal mở edit mode). -->
    <AppointmentEditor
      v-model="showEditor"
      :appointment="editingApt as any"
      :prefill-contact="contactId && !editingApt ? {
        id: contactId,
        fullName: contactName || null,
        phone: null,
        zaloUid: null,
        zaloUsername: null,
      } : null"
      :current-user-id="currentUserId"
      @created="onSaved"
      @updated="onSaved"
    />

    <!-- Appointment list — overdue trên cùng, scheduled middle, done bottom.
         Card layout kế thừa Airtable design từ AppointmentsListView. -->
    <div
      v-for="apt in sortedAppointments"
      :key="apt.id"
      class="apt-row"
      :class="aptRowClass(apt)"
    >
      <!-- Row 1: source badge + type chip + status pill -->
      <div class="apt-top">
        <span class="apt-tag" :class="apt.source === 'zalo' ? 'tag-zalo' : 'tag-crm'">
          {{ apt.source === 'zalo' ? `${apt.emoji || '🔔'} Zalo` : 'CRM' }}
        </span>
        <span v-if="apt.type" class="apt-type-pill">{{ typeIcon(apt.type) }} {{ typeLabel(apt.type) }}</span>
        <span class="apt-status-pill" :class="`s-${effectiveStatus(apt)}`">
          {{ statusLabel(effectiveStatus(apt)) }}
        </span>
        <button class="apt-edit-btn" title="Sửa nhắc hẹn" @click="openEditor(apt)">
          <PencilIcon :size="14" :stroke-width="2" />
        </button>
      </div>

      <!-- Row 2: tiêu đề (font 500, có icon loại nếu có) -->
      <div v-if="apt.title" class="apt-title">{{ apt.title }}</div>
      <div v-else class="apt-title muted">(Chưa có tiêu đề)</div>

      <!-- Row 3: time + duration line -->
      <div class="apt-time-line">
        <span class="apt-datetime">
          {{ formatAptDate(apt.appointmentDate) }} · {{ formatAptTime(apt) }}
        </span>
        <span class="apt-dur">· {{ apt.durationMin || 15 }}p</span>
      </div>

      <!-- Row 4: meta — location, sale, notes -->
      <div v-if="apt.location || apt.assignedUser" class="apt-meta">
        <span v-if="apt.location" class="apt-loc">📍 {{ apt.location }}</span>
        <span v-if="apt.assignedUser" class="apt-sale">👤 {{ apt.assignedUser.fullName || apt.assignedUser.email }}</span>
      </div>
      <div v-if="apt.notes" class="apt-notes">{{ apt.notes }}</div>

      <!-- Row 5: quick action buttons (scheduled/overdue) -->
      <div v-if="canQuickAction(apt)" class="apt-quick-actions">
        <button
          class="qa-btn qa-success"
          :disabled="changingId === apt.id && changingTo === 'completed'"
          @click="quickChangeStatus(apt, 'completed')"
        ><CheckIcon :size="14" :stroke-width="2" /> Hoàn thành</button>
        <button
          class="qa-btn qa-danger"
          :disabled="changingId === apt.id && changingTo === 'no_show'"
          @click="quickChangeStatus(apt, 'no_show')"
        ><BanIcon :size="14" :stroke-width="2" /> Không đến</button>
        <button
          class="qa-btn qa-ghost"
          :disabled="changingId === apt.id && changingTo === 'cancelled'"
          @click="quickChangeStatus(apt, 'cancelled')"
        ><XIcon :size="14" :stroke-width="2" /> Huỷ</button>
      </div>

      <!-- Audit line: ai đổi status + lúc nào -->
      <div v-if="apt.statusChangedBy && apt.status !== 'scheduled' && apt.status !== 'overdue'" class="apt-audit">
        <CheckIcon :size="12" :stroke-width="2" /> {{ apt.statusChangedBy.fullName || apt.statusChangedBy.email }}<span v-if="apt.statusChangedAt"> · {{ formatRelativeTime(apt.statusChangedAt) }}</span>
      </div>
    </div>

    <div v-if="appointments.length === 0" class="apt-empty">
      Chưa có lịch hẹn nào
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { api } from '@/api/index';
// Icon nút — Lucide line (anh chốt 2026-06-08, bỏ ký tự thô).
import {
  Pencil as PencilIcon,
  Check as CheckIcon,
  Ban as BanIcon,
  X as XIcon,
} from 'lucide-vue-next';
import AppointmentEditor from '@/components/appointments/AppointmentEditor.vue';
import { useAuthStore } from '@/stores/auth';
const _authStoreChatApt = useAuthStore();
const currentUserId = computed<string | null>(() => _authStoreChatApt.user?.id ?? null);
import { getOrgParts, weekdayInOrgTz, formatInOrgTz, startOfOrgDay, orgDayKey, orgWallClockToUtc } from '@/composables/use-org-timezone';
import { typeIcon, typeLabel } from '@/composables/appointment-helpers';

export interface Appointment {
  id: string;
  appointmentDate: string;
  appointmentTime: string | null;
  type: string | null;
  status: string;
  notes: string | null;
  title?: string | null;
  durationMin?: number | null;
  location?: string | null;
  source?: 'manual' | 'zalo';
  emoji?: string | null;
  externalRef?: string | null;
  zaloMessageId?: string | null;
  statusChangedAt?: string | null;
  statusChangedBy?: { id: string; fullName: string | null; email: string } | null;
  assignedUser?: { id: string; fullName: string | null; email: string } | null;
  contact?: { id: string; fullName: string | null; phone: string | null } | null;
}

const props = defineProps<{
  contactId: string;
  contactName?: string | null;
  appointments: Appointment[];
}>();

const emit = defineEmits<{
  refresh: [];
}>();

const showEditor = ref(false);
const editingApt = ref<Appointment | null>(null);
const changingId = ref<string | null>(null);
const changingTo = ref<string | null>(null);

function openEditor(apt: Appointment | null) {
  editingApt.value = apt;
  showEditor.value = true;
}

function onSaved() {
  // Editor emit('created' | 'updated') sau khi save xong → close + refresh list
  showEditor.value = false;
  editingApt.value = null;
  emit('refresh');
}

const statusOptions = [
  { title: 'Đã lên lịch', value: 'scheduled' },
  { title: 'Quá hạn', value: 'overdue' },
  { title: 'Hoàn thành', value: 'completed' },
  { title: 'Huỷ', value: 'cancelled' },
  { title: 'Không đến', value: 'no_show' },
];

// FIX 2026-06-09 (Anh báo cột 4 chat sai giờ): dựng start Date GHÉP appointmentDate (ngày)
// + appointmentTime (giờ thật "HH:mm" wall-clock org), khớp appointmentStart() ở
// appointment-helpers. Trước đây mọi nơi dùng new Date(appointmentDate) (midnight UTC →
// 07:00 VN) làm giờ hiển thị + overdue + sort đều sai.
function aptStart(apt: Appointment): Date {
  const dayKey = orgDayKey(apt.appointmentDate);
  const t = (apt.appointmentTime || '').trim();
  if (dayKey && t) {
    const combined = orgWallClockToUtc(dayKey, t);
    if (combined) return combined;
  }
  return new Date(apt.appointmentDate);
}

// Compute "effective status" — bao gồm cả scheduled qua hạn nhưng cron chưa flip
// (cron chạy mỗi 30 phút → có lag, UI cần real-time hơn).
function effectiveStatus(apt: Appointment): string {
  if (apt.status === 'scheduled' && aptStart(apt).getTime() < Date.now()) {
    return 'overdue';
  }
  return apt.status;
}

// Thứ tự hiển thị (final):
//   1. OVERDUE (cảnh báo, border đỏ) — TOP, sắp xếp quá hạn gần nhất lên trước
//   2. SCHEDULED (chờ diễn ra, border vàng) — middle, gần đến giờ lên đầu
//   3. COMPLETED/CANCELLED/NO_SHOW (đã chốt outcome, border xám) — BOTTOM
const sortedAppointments = computed(() => {
  const overdue: Appointment[] = [];
  const scheduled: Appointment[] = [];
  const done: Appointment[] = [];
  for (const a of props.appointments) {
    const es = effectiveStatus(a);
    if (es === 'overdue') overdue.push(a);
    else if (es === 'scheduled') scheduled.push(a);
    else done.push(a); // completed | cancelled | no_show
  }
  // Overdue: quá hạn gần nhất (sát now) lên trên — dễ action
  overdue.sort((a, b) => aptStart(b).getTime() - aptStart(a).getTime());
  // Scheduled: gần đến giờ nhất lên đầu
  scheduled.sort((a, b) => aptStart(a).getTime() - aptStart(b).getTime());
  // Done: gần nhất (vừa close) lên trước
  done.sort((a, b) => {
    const ta = a.statusChangedAt ? new Date(a.statusChangedAt).getTime() : aptStart(a).getTime();
    const tb = b.statusChangedAt ? new Date(b.statusChangedAt).getTime() : aptStart(b).getTime();
    return tb - ta;
  });
  return [...overdue, ...scheduled, ...done];
});

function aptRowClass(apt: Appointment): string {
  const es = effectiveStatus(apt);
  if (es === 'overdue') return 'apt-overdue';
  if (es === 'completed' || es === 'cancelled' || es === 'no_show') return 'apt-done';
  return 'apt-upcoming';
}

function statusLabel(s: string): string {
  return statusOptions.find(o => o.value === s)?.title || s;
}

// FIX 2026-06-09: hiển thị giờ THẬT = aptStart (ghép appointmentDate + appointmentTime),
// không còn lấy mình appointmentDate (midnight UTC → 07:00). Khớp các view khác.
function formatAptTime(apt: Appointment): string {
  const p = getOrgParts(aptStart(apt));
  if (!p) return '';
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

// Hiển thị ngày kiểu thân thiện theo org TZ: Hôm qua / Hôm nay / Ngày mai / Ngày mốt;
// 3-6 ngày tới: tên thứ; 2-6 ngày trước: "Thứ X tuần trước"; xa hơn: dd/mm/yyyy.
function formatAptDate(d: string): string {
  const aptDay = startOfOrgDay(d);
  const today = startOfOrgDay(new Date());
  if (!aptDay || !today) return formatInOrgTz(d, undefined, { dateOnly: true });
  const diffDays = Math.round((aptDay.getTime() - today.getTime()) / 86400000);

  if (diffDays === -1) return 'Hôm qua';
  if (diffDays === 0) return 'Hôm nay';
  if (diffDays === 1) return 'Ngày mai';
  if (diffDays === 2) return 'Ngày mốt';

  // Trong tuần (3-6 ngày tới hoặc 2-6 ngày trước) → tên thứ — weekday theo org TZ.
  // weekdayInOrgTz đã trả về dạng "Thứ Hai" (cap-init), không cần replace nữa.
  if (diffDays >= 3 && diffDays <= 6) {
    return weekdayInOrgTz(d, undefined, 'long');
  }
  if (diffDays <= -2 && diffDays >= -6) {
    return `${weekdayInOrgTz(d, undefined, 'long')} tuần trước`;
  }
  // Xa hơn → full date
  return formatInOrgTz(d, undefined, { dateOnly: true });
}

// Quick action: chỉ active khi status đang ở scheduled/overdue (chưa có outcome cuối)
function canQuickAction(apt: Appointment): boolean {
  return apt.status === 'scheduled' || apt.status === 'overdue';
}

async function quickChangeStatus(apt: Appointment, newStatus: 'completed' | 'cancelled' | 'no_show') {
  changingId.value = apt.id;
  changingTo.value = newStatus;
  try {
    await api.patch(`/appointments/${apt.id}/status`, { status: newStatus });
    emit('refresh');
  } catch (err) {
    console.error('Quick status change error:', err);
  } finally {
    changingId.value = null;
    changingTo.value = null;
  }
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMin = Math.floor((now - then) / 60000);
  if (diffMin < 1) return 'vừa xong';
  if (diffMin < 60) return `${diffMin} phút trước`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} giờ trước`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 7) return `${diffD} ngày trước`;
  return formatInOrgTz(iso, undefined, { dateOnly: true });
}

</script>

<style scoped>
/* ChatAppointments card — kế thừa design Airtable signature từ AppointmentsListView.
   3-tier urgency: overdue (đỏ) / upcoming (xanh dương) / done (xám mờ). */

.apt-row {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-left: 4px solid #2563eb; /* default upcoming blue */
  border-radius: 10px;
  padding: 10px 12px;
  margin-bottom: 8px;
  transition: background 0.15s ease;
}
.apt-row.apt-upcoming {
  background: #fff;
  border-left-color: #2563eb;
}
.apt-row.apt-overdue {
  background: #fef2f2;
  border-color: #fecaca;
  border-left-color: #dc2626;
}
.apt-row.apt-done {
  background: #f8fafc;
  border-left-color: #94a3b8;
  opacity: 0.65;
}

/* Row 1: tags + status + edit */
.apt-top {
  display: flex; align-items: center; gap: 5px; flex-wrap: wrap;
  margin-bottom: 6px;
}
.apt-tag {
  font-size: 10.5px; font-weight: 500;
  padding: 2px 7px; border-radius: 999px;
  background: #f1f5f9; color: #475569;
  border: 1px solid #e2e8f0;
}
.apt-tag.tag-zalo { background: #e0f2fe; color: #075985; border-color: #bae6fd; }
.apt-tag.tag-crm  { background: #ede9fe; color: #5b21b6; border-color: #ddd6fe; }
.apt-type-pill {
  font-size: 10.5px; font-weight: 500;
  padding: 2px 8px; border-radius: 999px;
  background: #f8fafc; color: #41454d;
  border: 1px solid #e5e7eb;
  white-space: nowrap;
}
.apt-status-pill {
  margin-left: auto;
  font-size: 10.5px; font-weight: 500;
  padding: 2px 9px; border-radius: 999px;
  white-space: nowrap;
}
.apt-status-pill.s-overdue   { background: #fee2e2; color: #991b1b; }
.apt-status-pill.s-scheduled { background: #dbeafe; color: #1d4ed8; }
.apt-status-pill.s-completed { background: #dcfce7; color: #14532d; }
.apt-status-pill.s-cancelled { background: #f1f5f9; color: #64748b; text-decoration: line-through; }
.apt-status-pill.s-no_show   { background: #fbe6dc; color: #7a2000; }
.apt-edit-btn {
  width: 22px; height: 22px;
  border: 1px solid #e5e7eb; border-radius: 6px;
  background: #fff; color: #6b7280; cursor: pointer;
  font-size: 12px; line-height: 1;
  display: inline-flex; align-items: center; justify-content: center;
}
.apt-edit-btn:hover { background: #f1f5f9; color: #1f2937; }

/* Row 2: title */
.apt-title {
  font-size: 13.5px; font-weight: 500; color: #1a1d24;
  margin-bottom: 3px; line-height: 1.3;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.apt-title.muted { color: #94a3b8; font-style: italic; }
.apt-row.apt-overdue .apt-title { color: #991b1b; }
.apt-row.apt-done .apt-title { text-decoration: line-through; color: #64748b; }

/* Row 3: time + duration */
.apt-time-line {
  font-size: 12px; font-weight: 500;
  display: flex; align-items: baseline; gap: 4px;
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  margin-bottom: 3px;
}
.apt-datetime { color: #1d4ed8; font-weight: 600; }
.apt-row.apt-overdue .apt-datetime { color: #dc2626; }
.apt-row.apt-done .apt-datetime { color: #64748b; text-decoration: line-through; }
.apt-dur { color: #6b7280; font-weight: 500; font-family: 'Inter', sans-serif; font-size: 11px; }

/* Row 4: meta + notes */
.apt-meta {
  font-size: 11px; color: #6b7280;
  display: flex; gap: 10px; flex-wrap: wrap;
  margin-top: 2px;
}
.apt-meta .apt-loc { color: #4b5563; }
.apt-meta .apt-sale { color: #4b5563; }
.apt-notes {
  font-size: 11.5px; color: #475569;
  margin-top: 4px; line-height: 1.4;
  padding: 4px 6px;
  background: rgba(0, 0, 0, 0.025);
  border-radius: 6px;
}

/* Row 5: quick action buttons */
.apt-quick-actions {
  display: flex; gap: 5px;
  margin-top: 8px;
  padding-top: 6px;
  border-top: 1px dashed rgba(0, 0, 0, 0.08);
}
.qa-btn {
  font-size: 11px; font-weight: 500;
  padding: 4px 9px; border-radius: 7px;
  background: #fff; border: 1px solid #e5e7eb; cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
}
.qa-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.qa-btn.qa-success { background: #dcfce7; color: #14532d; border-color: #86efac; }
.qa-btn.qa-success:hover:not(:disabled) { background: #bbf7d0; }
.qa-btn.qa-danger { background: #fee2e2; color: #991b1b; border-color: #fecaca; }
.qa-btn.qa-danger:hover:not(:disabled) { background: #fecaca; }
.qa-btn.qa-ghost { color: #6b7280; }
.qa-btn.qa-ghost:hover:not(:disabled) { background: #f1f5f9; }

.apt-audit {
  margin-top: 6px;
  font-size: 10.5px; color: #6b7280;
  font-style: italic;
}

.apt-empty {
  font-size: 11.5px; color: #94a3b8;
  text-align: center;
  padding: 14px 0;
  font-style: italic;
}

/* Icon Lucide nút — căn giữa với text (2026-06-08). */
.apt-edit-btn { display: inline-flex; align-items: center; justify-content: center; }
.qa-btn { display: inline-flex; align-items: center; justify-content: center; gap: 4px; }
.apt-audit { display: inline-flex; align-items: center; gap: 4px; }
.apt-edit-btn svg, .qa-btn svg, .apt-audit svg { display: block; }
</style>
