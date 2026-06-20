<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="airtable-scope apt-page">
    <!-- Hero band: white canvas, h1 weight 400 size 32, 2-row layout (title+CTA / controls) -->
    <header class="apt-hero">
      <div class="apt-hero-row1">
        <div class="title-block">
          <button class="icon-btn icon-btn--bordered drawer-toggle" title="Mở bộ lọc" @click="sidebarOpen = !sidebarOpen">☰</button>
          <div>
            <h1 class="apt-hero-title">📅 Lịch hẹn</h1>
            <div class="apt-hero-sub">
              <b>{{ totalLabel }}</b> · {{ weekLabel }}
            </div>
          </div>
        </div>
        <div class="apt-hero-actions">
          <button class="at-btn at-btn--secondary" :title="'Xuất CSV'">
            <span class="ic">⤓</span>
            <span class="btn-label">Xuất CSV</span>
          </button>
          <button class="at-btn at-btn--primary" @click="openQuickCreate(null)">
            <span class="ic">+</span>
            <span class="btn-label">Tạo nhắc hẹn</span>
          </button>
        </div>
      </div>
      <div class="apt-hero-row2">
        <!-- Segmented view toggle -->
        <div class="at-segmented">
          <button
            v-for="v in viewOptions"
            :key="v.value"
            :class="{ active: viewMode === v.value }"
            :disabled="v.value === 'week' && isNarrow"
            :title="v.value === 'week' && isNarrow ? 'View tuần chỉ hỗ trợ màn ≥ 900px' : ''"
            @click="viewMode = v.value"
          >{{ v.label }}</button>
        </div>

        <!-- Trạng thái filter dropdown -->
        <v-menu :close-on-content-click="false">
          <template #activator="{ props: act }">
            <button v-bind="act" class="filter-trigger" :class="{ active: selectedStatuses.size < APPOINTMENT_STATUS_OPTIONS.length }">
              Trạng thái <span class="trigger-count">{{ selectedStatuses.size }}/{{ APPOINTMENT_STATUS_OPTIONS.length }}</span>
              <span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="220" class="filter-menu">
            <v-list-item v-for="opt in APPOINTMENT_STATUS_OPTIONS" :key="opt.value" @click="toggleStatus(opt.value)">
              <template #prepend>
                <v-icon size="16" :color="selectedStatuses.has(opt.value) ? '#181d26' : '#9CA3AF'">
                  {{ selectedStatuses.has(opt.value) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                </v-icon>
              </template>
              <v-list-item-title>
                <span class="menu-pill" :class="`status-${opt.value}`">{{ opt.text }}</span>
                <span class="menu-count">{{ countByStatus[opt.value] || 0 }}</span>
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>

        <!-- Loại lịch hẹn filter dropdown -->
        <v-menu :close-on-content-click="false">
          <template #activator="{ props: act }">
            <button v-bind="act" class="filter-trigger" :class="{ active: selectedTypes.size < APPOINTMENT_TYPE_OPTIONS.length }">
              Loại lịch hẹn <span class="trigger-count">{{ selectedTypes.size }}/{{ APPOINTMENT_TYPE_OPTIONS.length }}</span>
              <span class="caret">▾</span>
            </button>
          </template>
          <v-list density="compact" min-width="220" class="filter-menu">
            <v-list-item v-for="opt in APPOINTMENT_TYPE_OPTIONS" :key="opt.value" @click="toggleType(opt.value)">
              <template #prepend>
                <v-icon size="16" :color="selectedTypes.has(opt.value) ? '#181d26' : '#9CA3AF'">
                  {{ selectedTypes.has(opt.value) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}
                </v-icon>
              </template>
              <v-list-item-title>
                <span class="menu-pill type">{{ opt.text }}</span>
                <span class="menu-count">{{ countByType[opt.value] || 0 }}</span>
              </v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>

        <div class="hero-row2-spacer" />

        <!-- Date nav (week view only) -->
        <div class="apt-date-nav" :class="{ hidden: viewMode !== 'week' }">
          <button class="icon-btn icon-btn--bordered" @click="shiftWeek(-1)">‹</button>
          <span class="week-range">{{ weekRangeLabel }}</span>
          <button class="icon-btn icon-btn--bordered" @click="shiftWeek(1)">›</button>
          <button class="at-btn at-btn--secondary" @click="goToToday">Hôm nay</button>
        </div>
      </div>
    </header>

    <!-- Filter chips strip (Airtable: surface-soft bg, hairline border) -->
    <div class="apt-filter-strip">
      <span class="lbl">Đang lọc</span>
      <span class="at-chip at-chip--active">
        <span class="dot" :style="{ background: saleColor(currentUserId).bg }" />
        {{ scopeLabel }}
        <span v-if="scope !== 'me'" class="chip-info">· {{ visibleAppointments.length }} lịch</span>
      </span>
      <span v-if="source !== 'all'" class="at-chip" @click="source = 'all'">
        Nguồn: {{ source === 'zalo' ? 'Zalo' : 'Thủ công' }} <span class="x">✕</span>
      </span>
      <span v-if="selectedStatuses.size < APPOINTMENT_STATUS_OPTIONS.length" class="at-chip">
        Trạng thái: {{ selectedStatuses.size }}/{{ APPOINTMENT_STATUS_OPTIONS.length }}
      </span>
      <span v-if="selectedTypes.size < APPOINTMENT_TYPE_OPTIONS.length" class="at-chip">
        Loại: {{ selectedTypes.size }}/{{ APPOINTMENT_TYPE_OPTIONS.length }}
      </span>
      <div class="spacer" />
      <span class="kb-hint">
        <kbd>N</kbd> tạo nhanh · <kbd>←</kbd><kbd>→</kbd> tuần · <kbd>T</kbd> hôm nay · <kbd>Esc</kbd> đóng
      </span>
    </div>

    <!-- Body: sidebar + content + detail panel (3-col squeeze layout) -->
    <div class="apt-body" :class="{ 'with-panel': !!selectedAppointment }">
      <div v-if="sidebarOpen && isNarrow" class="sidebar-backdrop" @click="sidebarOpen = false" />
      <div class="sidebar-wrap" :class="{ open: sidebarOpen }">
      <AppointmentsSidebar
        :scope="scope"
        :selected-sales="selectedSales"
        :selected-statuses="selectedStatuses"
        :selected-types="selectedTypes"
        :source="source"
        :users="users"
        :current-user-id="currentUserId"
        :appointments="scopedAppointments"
        :visible-month="visibleMonth"
        :selected-date="selectedDate"
        @update:scope="onScopeChange"
        @update:selected-sales="selectedSales = $event"
        @update:selected-statuses="selectedStatuses = $event"
        @update:selected-types="selectedTypes = $event"
        @update:source="source = $event"
        @update:visible-month="visibleMonth = $event"
        @select-date="onSelectDate"
        @select-appointment="onSelectAppointment"
      />
      </div>

      <main class="apt-content">
        <AppointmentsWeekView
          v-if="viewMode === 'week'"
          :week-start="weekStart"
          :appointments="visibleAppointments"
          @select-appointment="onSelectAppointment"
          @create-slot="onCreateSlot"
        />
        <AppointmentsListView
          v-else
          :appointments="visibleAppointments"
          @select-appointment="onSelectAppointment"
          @create="openQuickCreate(null)"
          @mark-complete="onMarkComplete"
          @open-chat="onOpenChat"
        />
      </main>

      <!-- Detail panel — 3rd grid column trên desktop, overlay trên mobile (<900px) -->
      <AppointmentDetailPanel
        :appointment="selectedAppointment"
        @close="selectedAppointment = null"
        @complete="onMarkComplete"
        @cancel="onCancel"
        @no-show="onNoShow"
        @reschedule="onReschedule"
        @open-chat="onOpenChat"
        @open-contact="onOpenContact"
      />
    </div>

    <!-- Editor modal — 1 UI cho create + edit "Nhắc hẹn" -->
    <AppointmentEditor
      v-model="quickCreateOpen"
      :appointment="editAppointment"
      :default-date="quickCreateDate"
      :prefill-contact="quickCreatePrefillContact"
      :users="users"
      :current-user-id="currentUserId"
      @created="onAppointmentCreated"
      @updated="onAppointmentUpdated"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { useAppointments } from '@/composables/use-appointments';
import { useUsers } from '@/composables/use-users';
import {
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TYPE_OPTIONS,
  saleColor,
  appointmentOwnerId,
  appointmentStart,
  type AppointmentEx as Appointment,
} from '@/composables/appointment-helpers';
import AppointmentsSidebar from '@/components/appointments/AppointmentsSidebar.vue';
import AppointmentsWeekView from '@/components/appointments/AppointmentsWeekView.vue';
import AppointmentsListView from '@/components/appointments/AppointmentsListView.vue';
import AppointmentDetailPanel from '@/components/appointments/AppointmentDetailPanel.vue';
import AppointmentEditor from '@/components/appointments/AppointmentEditor.vue';

const router = useRouter();
const authStore = useAuthStore();
const currentUserId = computed<string | null>(() => authStore.user?.id ?? null);

const {
  appointments,
  filters,
  fetchAppointments,
  markComplete,
  cancelAppointment,
  markNoShow,
} = useAppointments();
const { users, fetchUsers } = useUsers();

// Responsive: track viewport width — narrow under 900px, force list view & drawer-style sidebar
const viewportWidth = ref<number>(typeof window !== 'undefined' ? window.innerWidth : 1440);
const isNarrow = computed(() => viewportWidth.value < 900);
const sidebarOpen = ref(false);

// View state — initialize 'list' nếu load thẳng mobile (watch sau chỉ trigger on change)
type ViewMode = 'week' | 'list';
const viewMode = ref<ViewMode>(isNarrow.value ? 'list' : 'week');
const viewOptions: { value: ViewMode; label: string }[] = [
  { value: 'week', label: 'Tuần' },
  { value: 'list', label: 'Danh sách' },
];

function onResize() { viewportWidth.value = window.innerWidth; }

// When viewport becomes narrow while user is on week view, switch to list automatically
watch(isNarrow, (narrow) => {
  if (narrow && viewMode.value === 'week') viewMode.value = 'list';
  if (!narrow) sidebarOpen.value = false; // reset drawer when back to desktop
});

// Date navigation
const today = new Date(); today.setHours(0, 0, 0, 0);
const selectedDate = ref<Date>(new Date(today));
const visibleMonth = ref<Date>(new Date(today.getFullYear(), today.getMonth(), 1));

const weekStart = computed(() => {
  const d = new Date(selectedDate.value);
  d.setHours(0, 0, 0, 0);
  const offset = (d.getDay() + 6) % 7; // Mon = 0
  d.setDate(d.getDate() - offset);
  return d;
});
const weekEnd = computed(() => {
  const d = new Date(weekStart.value);
  d.setDate(d.getDate() + 7);
  return d;
});

// Filters
type Scope = 'me' | 'team' | 'all';
const scope = ref<Scope>('me');
const selectedSales = ref<Set<string>>(new Set());
const selectedStatuses = ref<Set<string>>(new Set(['scheduled', 'overdue']));
const selectedTypes = ref<Set<string>>(new Set(APPOINTMENT_TYPE_OPTIONS.map(o => o.value)));
const source = ref<'all' | 'manual' | 'zalo'>('all');

function toggleStatus(v: string) {
  const next = new Set(selectedStatuses.value);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  selectedStatuses.value = next;
}
function toggleType(v: string) {
  const next = new Set(selectedTypes.value);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  selectedTypes.value = next;
}
// Counts cho dropdown — đếm trên scopedAppointments (đã filter scope/sale/source)
const countByStatus = computed<Record<string, number>>(() => {
  const m: Record<string, number> = {};
  for (const a of scopedAppointments.value) m[a.status] = (m[a.status] || 0) + 1;
  return m;
});
const countByType = computed<Record<string, number>>(() => {
  const m: Record<string, number> = {};
  for (const a of scopedAppointments.value) m[a.type] = (m[a.type] || 0) + 1;
  return m;
});

// Quick create
const quickCreateOpen = ref(false);
const quickCreateDate = ref<Date | null>(null);
const quickCreatePrefillContact = ref<{ id: string; fullName: string | null; phone: string | null; zaloUid?: string | null } | null>(null);
// Edit mode: nếu set → mở editor ở mode sửa, ngược lại null = create.
const editAppointment = ref<Appointment | null>(null);

// Detail panel
const selectedAppointment = ref<Appointment | null>(null);

// Re-fetch when scope or date range changes
async function reloadAppointments() {
  const from = weekStart.value;
  const to = new Date(weekEnd.value); to.setDate(to.getDate() + 7); // pad 1 week ahead
  filters.from = from.toISOString();
  filters.to = to.toISOString();
  filters.source = source.value;
  await fetchAppointments();
}

watch([weekStart, source], () => { reloadAppointments(); }, { immediate: false });

// Initialize selectedSales when users + scope change
watch([users, scope, currentUserId], () => {
  if (scope.value === 'me' && currentUserId.value) {
    selectedSales.value = new Set([currentUserId.value]);
  } else if (scope.value === 'team' || scope.value === 'all') {
    selectedSales.value = new Set(users.value.map(u => u.id));
  }
});

function onScopeChange(s: Scope) {
  scope.value = s;
}

// Derived: scope filter
const scopedAppointments = computed<Appointment[]>(() => {
  if (scope.value === 'me') {
    return (appointments.value as Appointment[]).filter(a => {
      const owner = appointmentOwnerId(a);
      return !owner || owner === currentUserId.value;
    });
  }
  if (scope.value === 'team' || scope.value === 'all') {
    if (selectedSales.value.size === 0) return [];
    return (appointments.value as Appointment[]).filter(a => {
      const owner = appointmentOwnerId(a);
      return !owner || selectedSales.value.has(owner);
    });
  }
  return appointments.value as Appointment[];
});

// Apply remaining filters: status, type, source
const visibleAppointments = computed<Appointment[]>(() => {
  return scopedAppointments.value.filter(a => {
    if (!selectedStatuses.value.has(a.status)) return false;
    if (!selectedTypes.value.has(a.type)) return false;
    if (source.value !== 'all' && a.source !== source.value) return false;
    // restrict to current week for week view
    if (viewMode.value === 'week') {
      const s = appointmentStart(a).getTime();
      return s >= weekStart.value.getTime() && s < weekEnd.value.getTime();
    }
    return true;
  });
});

// Labels
const VN_MONTHS_SHORT = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const weekRangeLabel = computed(() => {
  const s = weekStart.value;
  const e = new Date(weekStart.value); e.setDate(e.getDate() + 6);
  return `${String(s.getDate()).padStart(2, '0')}/${VN_MONTHS_SHORT[s.getMonth()]} – ${String(e.getDate()).padStart(2, '0')}/${VN_MONTHS_SHORT[e.getMonth()]}/${e.getFullYear()}`;
});
const weekLabel = computed(() => `Tuần ${weekRangeLabel.value}`);
const totalLabel = computed(() => `${visibleAppointments.value.length} lịch`);
const scopeLabel = computed(() => {
  if (scope.value === 'me') return 'Sale: Của tôi';
  if (scope.value === 'team') return `Sale: Nhóm (${selectedSales.value.size})`;
  return `Sale: Tất cả (${selectedSales.value.size})`;
});

// Navigation actions
function shiftWeek(delta: number) {
  const d = new Date(selectedDate.value);
  d.setDate(d.getDate() + delta * 7);
  selectedDate.value = d;
}
function goToToday() {
  selectedDate.value = new Date(today);
}
function onSelectDate(d: Date) {
  selectedDate.value = d;
  if (viewMode.value === 'list') viewMode.value = 'week';
}

// Event handlers
function onSelectAppointment(a: Appointment) {
  selectedAppointment.value = a;
}
function onCreateSlot(payload: { date: Date }) {
  openQuickCreate(payload.date);
}
function openQuickCreate(date: Date | null) {
  editAppointment.value = null; // create mode
  quickCreateDate.value = date;
  quickCreatePrefillContact.value = null;
  quickCreateOpen.value = true;
}
function openEditor(a: Appointment) {
  editAppointment.value = a;
  quickCreateDate.value = null;
  quickCreatePrefillContact.value = null;
  quickCreateOpen.value = true;
}
async function onAppointmentCreated() {
  await reloadAppointments();
}
async function onAppointmentUpdated() {
  selectedAppointment.value = null;
  await reloadAppointments();
}

async function onMarkComplete(a: Appointment) {
  await markComplete(a.id);
  selectedAppointment.value = null;
  await reloadAppointments();
}
async function onCancel(a: Appointment) {
  await cancelAppointment(a.id);
  selectedAppointment.value = null;
  await reloadAppointments();
}
async function onNoShow(a: Appointment) {
  await markNoShow(a.id);
  selectedAppointment.value = null;
  await reloadAppointments();
}
function onReschedule(a: Appointment) {
  // Mở Editor ở mode edit (giữ data + sửa giờ) thay vì tạo mới
  selectedAppointment.value = null;
  openEditor(a);
}
function onOpenChat(a: Appointment) {
  if (a.source === 'zalo' && a.conversationId) {
    router.push(`/chat/${a.conversationId}`);
  }
}
function onOpenContact(a: Appointment) {
  if (a.contact?.id) router.push(`/contacts/${a.contact.id}`);
}

// Keyboard shortcuts
function onKey(e: KeyboardEvent) {
  const tgt = e.target as HTMLElement | null;
  if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' || tgt.isContentEditable)) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openQuickCreate(null); }
  else if (e.key === 'ArrowRight') { shiftWeek(1); }
  else if (e.key === 'ArrowLeft') { shiftWeek(-1); }
  else if (e.key === 't' || e.key === 'T') { goToToday(); }
  else if (e.key === 'Escape') { selectedAppointment.value = null; }
}

onMounted(() => {
  fetchUsers();
  reloadAppointments();
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize, { passive: true });
  onResize();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
});
</script>

<style scoped>
@import '@/assets/airtable.css';

/* Page shell — Airtable design */
.apt-page {
  display: flex; flex-direction: column;
  height: calc(100vh - var(--smax-topnav-h, 52px));
  width: 100%;
  background: var(--at-canvas);
  overflow: hidden;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--at-body);
}

/* ── Hero band (white canvas, 2 rows) ────────────────────────────────── */
.apt-hero {
  background: var(--at-canvas);
  padding: var(--at-s-lg) var(--at-s-xl) var(--at-s-md);
  border-bottom: 1px solid var(--at-hairline);
  flex-shrink: 0;
}
.apt-hero-row1 {
  display: flex; align-items: flex-start; justify-content: space-between;
  gap: var(--at-s-md);
  margin-bottom: var(--at-s-md);
}
.apt-hero-row2 {
  display: flex; align-items: center; justify-content: space-between;
  gap: var(--at-s-md);
  flex-wrap: wrap;
}
.title-block {
  display: flex; align-items: flex-start; gap: var(--at-s-sm);
  min-width: 0; flex: 1;
}
.apt-hero-title {
  margin: 0;
  font-size: 28px;
  font-weight: 400;
  line-height: 1.2;
  color: var(--at-ink);
  letter-spacing: 0;
}
.apt-hero-sub {
  font-size: 12px;
  font-weight: 500;
  color: var(--at-muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-top: 4px;
}
.apt-hero-sub b { color: var(--at-ink); font-weight: 500; }

.apt-hero-actions { display: flex; align-items: center; gap: var(--at-s-xs); flex-shrink: 0; }
.drawer-toggle { display: none; }

/* ── At-btn / icon-btn (Airtable spec) ───────────────────────────────── */
.at-btn {
  display: inline-flex; align-items: center; justify-content: center;
  gap: 6px;
  padding: 10px 16px;
  border-radius: var(--at-r-lg);
  font-size: 13px;
  font-weight: 500;
  line-height: 1.4;
  cursor: pointer;
  white-space: nowrap;
  border: none;
  font-family: inherit;
  transition: background 0.12s, border-color 0.12s;
}
.at-btn--primary {
  background: var(--at-primary);
  color: var(--at-on-primary);
}
.at-btn--primary:active { background: var(--at-primary-active); }
.at-btn--secondary {
  background: var(--at-canvas);
  color: var(--at-ink);
  border: 1px solid var(--at-hairline);
}
.at-btn--secondary:active { background: var(--at-surface-soft); }
.at-btn .ic { font-size: 15px; line-height: 1; }
.at-btn:disabled { opacity: 0.35; cursor: not-allowed; }

.icon-btn {
  width: 32px; height: 32px;
  border-radius: var(--at-r-md);
  background: transparent;
  color: var(--at-body);
  cursor: pointer;
  font-size: 14px;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid transparent;
  font-family: inherit;
}
.icon-btn:active { background: var(--at-surface-soft); }
.icon-btn--bordered { border-color: var(--at-hairline); background: var(--at-canvas); }

/* ── Segmented view toggle ───────────────────────────────────────────── */
.at-segmented {
  display: inline-flex;
  background: var(--at-surface-soft);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: 3px;
  gap: 2px;
}
.at-segmented button {
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  color: var(--at-body);
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
}
.at-segmented button.active {
  background: var(--at-ink);
  color: var(--at-on-primary);
}
.at-segmented button:disabled { opacity: 0.35; cursor: not-allowed; }

/* ── Filter dropdown trigger (Trạng thái / Loại lịch hẹn) ───────────── */
.filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  font-size: 13px;
  font-weight: 500;
  color: var(--at-body);
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  height: 36px;
}
.filter-trigger:active { background: var(--at-surface-soft); }
.filter-trigger.active {
  border-color: var(--at-ink);
  color: var(--at-ink);
}
.filter-trigger .trigger-count {
  font-size: 11.5px;
  background: var(--at-surface-soft);
  color: var(--at-muted);
  padding: 1px 7px;
  border-radius: var(--at-r-pill);
  font-variant-numeric: tabular-nums;
}
.filter-trigger.active .trigger-count {
  background: var(--at-ink);
  color: var(--at-on-primary);
}
.filter-trigger .caret { font-size: 10px; color: var(--at-muted); }

/* Menu items inside dropdown */
:global(.filter-menu .v-list-item) {
  min-height: 36px !important;
}
:global(.filter-menu .v-list-item-title) {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
}
:global(.filter-menu .menu-pill) {
  display: inline-flex; align-items: center;
  padding: 2px 8px;
  border-radius: var(--at-r-pill);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.16px;
  flex: 1;
}
:global(.filter-menu .menu-pill.status-scheduled) { background: #fdf0e3; color: #7a4115; }
:global(.filter-menu .menu-pill.status-overdue)   { background: #fdf3df; color: #7a5818; }
:global(.filter-menu .menu-pill.status-completed) { background: #e3ede4; color: #0a2e0e; }
:global(.filter-menu .menu-pill.status-cancelled) { background: #e0e2e6; color: #41454d; text-decoration: line-through; }
:global(.filter-menu .menu-pill.status-no_show)   { background: #fbe6dc; color: #7a2000; }
:global(.filter-menu .menu-pill.type)             { background: #f8fafc; color: #333840; border: 1px solid #dddddd; }
:global(.filter-menu .menu-count) {
  margin-left: auto;
  font-size: 11.5px;
  color: #6B7280;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

/* Push date-nav qua phải */
.hero-row2-spacer { flex: 1; }

/* ── Date nav ────────────────────────────────────────────────────────── */
.apt-date-nav { display: inline-flex; align-items: center; gap: var(--at-s-xs); }
.apt-date-nav.hidden { display: none; }
.apt-date-nav .week-range {
  font-size: 13px;
  font-weight: 500;
  color: var(--at-ink);
  padding: 0 var(--at-s-sm);
  min-width: 170px;
  text-align: center;
}

/* ── Filter chips strip (surface-soft bg) ─────────────────────────────── */
.apt-filter-strip {
  display: flex; align-items: center; gap: var(--at-s-xs);
  padding: var(--at-s-sm) var(--at-s-xl);
  background: var(--at-surface-soft);
  border-bottom: 1px solid var(--at-hairline);
  flex-wrap: wrap;
  flex-shrink: 0;
}
.apt-filter-strip .lbl {
  font-size: 11px;
  font-weight: 500;
  color: var(--at-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-right: var(--at-s-xs);
}
.apt-filter-strip .spacer { flex: 1; }
.apt-filter-strip .kb-hint {
  font-size: 11.5px;
  color: var(--at-muted);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.apt-filter-strip .kb-hint kbd {
  display: inline-block;
  padding: 1px 5px;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-xs);
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  font-size: 10.5px;
  color: var(--at-ink);
  margin: 0 1px;
}

.at-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 11px;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-pill);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--at-body);
  white-space: nowrap;
  cursor: pointer;
}
.at-chip:active { background: var(--at-surface-soft); }
.at-chip--active {
  background: var(--at-ink);
  color: var(--at-on-primary);
  border-color: var(--at-ink);
}
.at-chip .dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.at-chip .chip-info { opacity: 0.8; font-weight: 400; }
.at-chip .x { margin-left: 2px; opacity: 0.6; font-size: 11px; }

/* ── Body grid (3-col squeeze layout) ────────────────────────────────── */
.apt-body {
  display: grid;
  grid-template-columns: 280px 1fr;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
  background: var(--at-canvas);
  transition: grid-template-columns 0.18s ease;
}
.apt-body.with-panel {
  grid-template-columns: 280px 1fr 380px;
}
.sidebar-wrap { overflow: hidden; background: var(--at-surface-soft); border-right: 1px solid var(--at-hairline); }
.sidebar-backdrop { display: none; }
.apt-content {
  overflow: hidden;
  display: flex; flex-direction: column;
  min-width: 0;
  background: var(--at-canvas);
}

/* Tablet */
@media (max-width: 1280px) {
  .apt-body.with-panel { grid-template-columns: 280px 1fr 340px; }
}
@media (max-width: 1100px) {
  .apt-body { grid-template-columns: 240px 1fr; }
  .apt-body.with-panel { grid-template-columns: 240px 1fr 320px; }
  .apt-hero { padding: var(--at-s-md) var(--at-s-lg); }
  .apt-hero-title { font-size: 24px; }
}

/* Narrow tablet & mobile: sidebar = drawer, panel = overlay */
@media (max-width: 900px) {
  .apt-body, .apt-body.with-panel { grid-template-columns: 1fr; }
  .drawer-toggle { display: inline-flex; }
  .sidebar-wrap {
    position: absolute;
    top: 0; left: 0; bottom: 0;
    width: 300px;
    max-width: 86vw;
    z-index: 20;
    transform: translateX(-100%);
    transition: transform .22s ease;
    box-shadow: 4px 0 24px rgba(24,29,38,0.10);
  }
  .sidebar-wrap.open { transform: translateX(0); }
  .sidebar-backdrop {
    display: block;
    position: absolute; inset: 0;
    background: rgba(24,29,38,0.32);
    z-index: 15;
  }
  .apt-hero-row1 { flex-direction: column; align-items: stretch; }
  .apt-hero-actions { flex-wrap: wrap; }
  .apt-hero-title { font-size: 22px; }
  .apt-hero-sub { font-size: 11px; }
}

/* Mobile portrait */
@media (max-width: 600px) {
  .apt-hero { padding: var(--at-s-md); }
  .apt-filter-strip { padding: var(--at-s-xs) var(--at-s-md); overflow-x: auto; flex-wrap: nowrap; }
  .apt-filter-strip .kb-hint, .apt-filter-strip .spacer { display: none; }
  .apt-hero-row2 { flex-wrap: wrap; gap: var(--at-s-xs); }
  .at-segmented { flex: 1 1 100%; }
  .at-segmented button { flex: 1; padding: 6px 10px; font-size: 12px; }
  .filter-trigger { padding: 6px 10px; font-size: 12px; height: 32px; }
  .hero-row2-spacer { display: none; }
  .at-btn { padding: 9px 12px; font-size: 12.5px; }
  .apt-hero-actions .at-btn--secondary .btn-label { display: none; }
  .apt-hero-actions .at-btn--primary { flex: 1; }
  .apt-date-nav { flex: 1 1 100%; justify-content: space-between; }
  .apt-date-nav .week-range { min-width: 100px; font-size: 12px; }
}
</style>
