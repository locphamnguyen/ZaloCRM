<template>
  <aside class="apt-sidebar">
    <div class="side-section">
      <h4>Phạm vi</h4>
      <div class="scope-toggle">
        <button
          v-for="opt in scopeOptions"
          :key="opt.value"
          :class="{ active: scope === opt.value }"
          @click="$emit('update:scope', opt.value)"
        >{{ opt.label }}</button>
      </div>
    </div>

    <!-- Nguồn — 3-tab segmented, same style as Phạm vi (no icon để không bể UI) -->
    <div class="side-section">
      <h4>Nguồn</h4>
      <div class="scope-toggle">
        <button
          v-for="opt in sourceOptions"
          :key="opt.value"
          :class="{ active: source === opt.value }"
          @click="$emit('update:source', opt.value)"
        >{{ opt.label }}</button>
      </div>
    </div>

    <div v-if="scope !== 'me'" class="side-section">
      <h4>Sale phụ trách</h4>
      <div class="sale-list">
        <div
          v-for="u in users"
          :key="u.id"
          class="sale"
          :class="{ active: selectedSales.has(u.id) }"
          @click="toggleSale(u.id)"
        >
          <span class="swatch" :style="{ background: saleColor(u.id).bg }" />
          <span class="name">{{ u.fullName }}<span v-if="u.id === currentUserId"> (tôi)</span></span>
          <span class="count">{{ countBySale[u.id] || 0 }}</span>
        </div>
      </div>
    </div>

    <div class="side-section">
      <h4>{{ miniMonthLabel }}</h4>
      <div class="mini-cal">
        <div class="mini-cal-head">
          <button @click="shiftMonth(-1)">‹</button>
          <span class="month">{{ miniMonthLabel }}</span>
          <button @click="shiftMonth(1)">›</button>
        </div>
        <div class="mini-cal-grid">
          <div v-for="d in DOW_LABELS" :key="d" class="dow">{{ d }}</div>
          <div
            v-for="cell in miniCells"
            :key="cell.iso"
            class="day"
            :class="{ muted: cell.muted, today: cell.isToday, 'has-events': cell.count > 0, selected: cell.iso === selectedIso }"
            @click="$emit('select-date', cell.date)"
          >{{ cell.day }}</div>
        </div>
      </div>
    </div>

    <div class="side-section">
      <h4>Trạng thái</h4>
      <div class="filter-grid">
        <label v-for="opt in APPOINTMENT_STATUS_OPTIONS" :key="opt.value" class="filter-chip">
          <input
            type="checkbox"
            :checked="selectedStatuses.has(opt.value)"
            @change="toggleStatus(opt.value)"
          />
          <span class="pill" :class="`status-${opt.value}`">{{ opt.text }}</span>
          <span class="count">{{ countByStatus[opt.value] || 0 }}</span>
        </label>
      </div>
    </div>

    <div class="side-section">
      <h4>Loại lịch hẹn</h4>
      <div class="filter-grid">
        <label v-for="opt in APPOINTMENT_TYPE_OPTIONS" :key="opt.value" class="filter-chip">
          <input
            type="checkbox"
            :checked="selectedTypes.has(opt.value)"
            @change="toggleType(opt.value)"
          />
          <span class="pill type">{{ typeIcon(opt.value) }} {{ opt.text }}</span>
          <span class="count">{{ countByType[opt.value] || 0 }}</span>
        </label>
      </div>
    </div>

    <!-- Cream callout: keyboard tip -->
    <div class="side-section">
      <div class="sidebar-callout">
        <strong>💡 Mẹo nhanh</strong><br>
        Bấm <kbd>N</kbd> để tạo lịch hẹn nhanh · <kbd>←</kbd><kbd>→</kbd> chuyển tuần · click slot trống để chọn giờ
      </div>
    </div>

    <div v-if="upcomingPreview.length" class="side-section">
      <h4>Sắp tới hôm nay</h4>
      <div class="upcoming">
        <div
          v-for="a in upcomingPreview"
          :key="a.id"
          class="up-item"
          :style="{ borderLeftColor: saleColor(ownerId(a)).bg }"
          @click="$emit('select-appointment', a)"
        >
          <div class="row">
            <span class="time">{{ fmtTime(a) }}</span>
            <span class="name">{{ a.contact?.fullName || 'KH' }}</span>
          </div>
          <div class="meta">{{ typeIcon(a.type) }} {{ typeLabel(a.type) }} · {{ a.source === 'zalo' ? 'Zalo' : 'Thủ công' }}</div>
        </div>
      </div>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  APPOINTMENT_STATUS_OPTIONS,
  APPOINTMENT_TYPE_OPTIONS,
  saleColor,
  typeIcon,
  typeLabel,
  appointmentOwnerId as ownerId,
  appointmentStart,
  type AppointmentEx as Appointment,
} from '@/composables/appointment-helpers';
import type { OrgUser } from '@/composables/use-users';

const props = defineProps<{
  scope: 'me' | 'team' | 'all';
  selectedSales: Set<string>;
  selectedStatuses: Set<string>;
  selectedTypes: Set<string>;
  source: 'all' | 'manual' | 'zalo';
  users: OrgUser[];
  currentUserId: string | null;
  appointments: Appointment[];
  visibleMonth: Date;
  selectedDate: Date;
}>();

const emit = defineEmits<{
  (e: 'update:scope', v: 'me' | 'team' | 'all'): void;
  (e: 'update:selectedSales', v: Set<string>): void;
  (e: 'update:selectedStatuses', v: Set<string>): void;
  (e: 'update:selectedTypes', v: Set<string>): void;
  (e: 'update:source', v: 'all' | 'manual' | 'zalo'): void;
  (e: 'update:visibleMonth', v: Date): void;
  (e: 'select-date', v: Date): void;
  (e: 'select-appointment', v: Appointment): void;
}>();

const DOW_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
const VN_MONTHS = ['Th 1', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7', 'Th 8', 'Th 9', 'Th 10', 'Th 11', 'Th 12'];

const scopeOptions = [
  { value: 'me' as const, label: 'Của tôi' },
  { value: 'team' as const, label: 'Nhóm' },
  { value: 'all' as const, label: 'Tất cả' },
];

function toggleSale(id: string) {
  const next = new Set(props.selectedSales);
  if (next.has(id)) next.delete(id); else next.add(id);
  emit('update:selectedSales', next);
}
function toggleStatus(v: string) {
  const next = new Set(props.selectedStatuses);
  if (next.has(v)) next.delete(v); else next.add(v);
  emit('update:selectedStatuses', next);
}
function toggleType(v: string) {
  const next = new Set(props.selectedTypes);
  if (next.has(v)) next.delete(v); else next.add(v);
  emit('update:selectedTypes', next);
}

const countBySale = computed(() => {
  const m: Record<string, number> = {};
  for (const a of props.appointments) {
    const id = ownerId(a);
    if (id) m[id] = (m[id] || 0) + 1;
  }
  return m;
});
const countByStatus = computed(() => {
  const m: Record<string, number> = {};
  for (const a of props.appointments) m[a.status] = (m[a.status] || 0) + 1;
  return m;
});
const countByType = computed(() => {
  const m: Record<string, number> = {};
  for (const a of props.appointments) m[a.type] = (m[a.type] || 0) + 1;
  return m;
});

// 3-tab segmented giống Phạm vi — KHÔNG emoji/icon để label cân chiều ngang
// (3 cột chia đều, tránh "🔔 Zalo" wide hơn "Tất cả" gây bể alignment).
const sourceOptions = [
  { value: 'all' as const,    label: 'Tất cả' },
  { value: 'zalo' as const,   label: 'Zalo' },
  { value: 'manual' as const, label: 'Thủ công' },
];

const miniMonthLabel = computed(() => `${VN_MONTHS[props.visibleMonth.getMonth()]}, ${props.visibleMonth.getFullYear()}`);

function shiftMonth(delta: number) {
  const d = new Date(props.visibleMonth);
  d.setMonth(d.getMonth() + delta);
  emit('update:visibleMonth', d);
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const selectedIso = computed(() => isoDay(props.selectedDate));

const apptByDay = computed(() => {
  const m: Record<string, number> = {};
  for (const a of props.appointments) {
    const k = isoDay(appointmentStart(a));
    m[k] = (m[k] || 0) + 1;
  }
  return m;
});

const miniCells = computed(() => {
  const year = props.visibleMonth.getFullYear();
  const month = props.visibleMonth.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const offset = (firstOfMonth.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const cells: { date: Date; iso: string; day: number; muted: boolean; isToday: boolean; count: number }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = isoDay(d);
    cells.push({
      date: d,
      iso,
      day: d.getDate(),
      muted: d.getMonth() !== month,
      isToday: d.getTime() === today.getTime(),
      count: apptByDay.value[iso] || 0,
    });
  }
  return cells;
});

const upcomingPreview = computed(() => {
  const now = new Date();
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999);
  return props.appointments
    .filter(a => {
      const start = appointmentStart(a);
      return start >= now && start <= endOfDay && (a.status === 'scheduled' || a.status === 'overdue');
    })
    .sort((a, b) => appointmentStart(a).getTime() - appointmentStart(b).getTime())
    .slice(0, 3);
});

function fmtTime(a: Appointment): string {
  const d = appointmentStart(a);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
</script>

<style scoped>
@import '@/components/automation/phase7/airtable.css';

.apt-sidebar {
  background: var(--at-surface-soft);
  padding: var(--at-s-lg);
  overflow-y: auto;
  height: 100%;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--at-body);
}
.side-section { margin-bottom: var(--at-s-lg); }
.side-section h4 {
  margin: 0 0 var(--at-s-xs);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--at-muted);
}

/* Scope toggle (segmented) */
.scope-toggle {
  display: flex;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: 3px;
  gap: 2px;
}
.scope-toggle button {
  flex: 1; padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: 8px;
  color: var(--at-body);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.scope-toggle button.active {
  background: var(--at-ink);
  color: var(--at-on-primary);
}

/* Sale filter list */
.sale-list { display: flex; flex-direction: column; gap: 2px; }
.sale-list .sale {
  display: flex; align-items: center; gap: var(--at-s-xs);
  padding: 6px 8px;
  border-radius: var(--at-r-sm);
  cursor: pointer;
  font-size: 13px;
  color: var(--at-body);
}
.sale-list .sale:active { background: var(--at-canvas); }
.sale-list .sale.active { color: var(--at-ink); font-weight: 500; background: var(--at-canvas); }
.sale-list .sale .swatch {
  width: 10px; height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.sale-list .sale .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sale-list .sale .count {
  font-size: 11px;
  color: var(--at-muted);
  font-variant-numeric: tabular-nums;
}

/* Mini calendar — Airtable style */
.mini-cal {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-sm);
}
.mini-cal-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: var(--at-s-xs);
}
.mini-cal-head .month {
  font-size: 13px;
  font-weight: 500;
  color: var(--at-ink);
}
.mini-cal-head button {
  background: transparent;
  border: none;
  color: var(--at-muted);
  font-size: 13px;
  width: 24px; height: 24px;
  border-radius: var(--at-r-sm);
  cursor: pointer;
}
.mini-cal-head button:active { background: var(--at-surface-soft); }
.mini-cal-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.mini-cal-grid .dow {
  font-size: 10px;
  color: var(--at-muted);
  text-align: center;
  padding: 4px 0;
  font-weight: 500;
}
.mini-cal-grid .day {
  font-size: 12px;
  text-align: center;
  aspect-ratio: 1;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--at-r-sm);
  cursor: pointer;
  position: relative;
  color: var(--at-body);
}
.mini-cal-grid .day:active { background: var(--at-surface-soft); }
.mini-cal-grid .day.muted { color: var(--at-muted); opacity: 0.4; }
.mini-cal-grid .day.today {
  background: var(--at-ink);
  color: var(--at-on-primary);
  font-weight: 500;
}
.mini-cal-grid .day.selected:not(.today) {
  background: var(--at-coral);
  color: var(--at-on-primary);
  font-weight: 500;
  opacity: 0.15;
}
.mini-cal-grid .day.has-events::after {
  content: "";
  position: absolute;
  bottom: 2px;
  left: 50%;
  transform: translateX(-50%);
  width: 4px; height: 4px;
  background: var(--at-coral);
  border-radius: 50%;
}
.mini-cal-grid .day.today.has-events::after { background: var(--at-on-primary); }

/* Filter chips (status / type) */
.filter-grid { display: flex; flex-direction: column; gap: 4px; }
.filter-chip {
  display: flex; align-items: center; gap: var(--at-s-xs);
  font-size: 12.5px;
  cursor: pointer;
  padding: 6px 8px;
  border-radius: var(--at-r-sm);
  color: var(--at-body);
}
.filter-chip:active { background: var(--at-canvas); }
.filter-chip input[type=checkbox] {
  accent-color: var(--at-ink);
  width: 14px; height: 14px;
  flex-shrink: 0;
}
.filter-chip .pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px;
  border-radius: var(--at-r-pill);
  font-weight: 500;
  font-size: 11px;
  letter-spacing: 0.12px;
}
.filter-chip .pill.status-scheduled { background: var(--at-canvas); color: var(--at-ink); border: 1px solid var(--at-hairline); }
.filter-chip .pill.status-overdue   { background: #fdf3df; color: #7a5818; }   /* mustard tint */
.filter-chip .pill.status-completed { background: #e3ede4; color: #0a2e0e; }   /* forest tint */
.filter-chip .pill.status-cancelled { background: var(--at-surface-strong); color: var(--at-muted); }
.filter-chip .pill.status-no_show   { background: #fbe6dc; color: #7a2000; }   /* coral tint */
.filter-chip .pill.type             { background: var(--at-canvas); color: var(--at-body); border: 1px solid var(--at-hairline); }
.filter-chip .count {
  margin-left: auto;
  color: var(--at-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* Upcoming preview */
.upcoming { display: flex; flex-direction: column; gap: 6px; }
.upcoming .up-item {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-left-width: 3px;
  border-radius: var(--at-r-md);
  padding: var(--at-s-xs) var(--at-s-sm);
  cursor: pointer;
}
.upcoming .up-item:active { background: var(--at-surface-soft); }
.upcoming .up-item .row { display: flex; align-items: center; gap: 6px; }
.upcoming .up-item .time {
  font-weight: 500;
  font-size: 12px;
  color: var(--at-ink);
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
}
.upcoming .up-item .name { font-size: 12.5px; color: var(--at-body); }
.upcoming .up-item .meta {
  font-size: 11px;
  color: var(--at-muted);
  margin-top: 2px;
}

/* Cream callout — keyboard tip */
.sidebar-callout {
  background: var(--at-cream);
  border-radius: var(--at-r-md);
  padding: var(--at-s-md);
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--at-ink);
}
.sidebar-callout strong { font-weight: 500; }
.sidebar-callout kbd {
  display: inline-block;
  padding: 0 5px;
  background: var(--at-canvas);
  border: 1px solid var(--at-mustard);
  border-radius: var(--at-r-xs);
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: var(--at-ink);
}
</style>
