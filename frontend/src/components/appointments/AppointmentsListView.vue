<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="apt-list">
    <div v-if="!appointments.length" class="empty">
      <div class="empty-icon">📅</div>
      <h3>Chưa có lịch hẹn</h3>
      <p>Lọc hiện tại không khớp lịch nào. Thử bỏ bớt filter hoặc tạo lịch hẹn mới.</p>
      <button class="empty-btn" @click="$emit('create')">＋ Tạo nhắc hẹn</button>
    </div>

    <!-- 7-col header (chỉ hiện 1 lần ở top, sticky-ish) -->
    <div v-if="appointments.length" class="list-header">
      <div class="col col-time">Thời gian</div>
      <div class="col col-customer">Khách hàng</div>
      <div class="col col-title">Tiêu đề & Ghi chú</div>
      <div class="col col-type">Loại</div>
      <div class="col col-status">Trạng thái</div>
      <div class="col col-owner">Sale</div>
      <div class="col col-actions"></div>
    </div>

    <div v-for="group in grouped" :key="group.iso" class="group">
      <h3>
        {{ group.label }}
        <span class="badge">{{ group.items.length }} lịch<span v-if="group.conflicts"> · ⚠ {{ group.conflicts }} trùng giờ</span></span>
      </h3>
      <div
        v-for="a in group.items"
        :key="a.id"
        class="row"
        :class="rowUrgency(a)"
        :style="{ borderLeftColor: rowUrgency(a) === 'overdue' ? '#dc2626' : saleColor(ownerId(a)).bg }"
        @click="$emit('select-appointment', a)"
      >
        <!-- Col 1: Thời gian -->
        <div class="col col-time">
          {{ fmtTime(a) }}
          <span class="dur">{{ a.durationMin || 15 }} phút</span>
        </div>
        <!-- Col 2: Avatar + tên KH + SDT -->
        <div class="col col-customer">
          <div
            class="av"
            :style="resolveContactAvatar(a.contact) ? {} : { background: saleColor(ownerId(a)).bg }"
          >
            <img
              v-if="resolveContactAvatar(a.contact)"
              :src="resolveContactAvatar(a.contact) || ''"
              alt=""
              @error="(e) => { (e.target as HTMLImageElement).style.display = 'none' }"
            />
            <template v-else>{{ initials(a.contact?.fullName) }}</template>
          </div>
          <div class="info">
            <div class="name">
              {{ a.contact?.fullName || 'Khách hàng' }}
              <span v-if="a.contact?.zaloUid" class="zalo-tag">🔵</span>
            </div>
            <div class="sub">
              <span v-if="a.contact?.phone">📱 {{ a.contact.phone }}</span>
            </div>
            <!-- mobile-only inline meta (desktop hide qua media query) -->
            <div class="mobile-meta">
              <span class="pill type">{{ typeIcon(a.type) }} {{ typeLabel(a.type) }}</span>
              <span class="pill" :class="`status-${a.status}`">{{ statusLabel(a.status) }}</span>
              <span class="av-mini" :style="{ background: saleColor(ownerId(a)).bg }">{{ initials(ownerName(a)) }}</span>
            </div>
          </div>
        </div>
        <!-- Col 3: Tiêu đề nhắc hẹn + Note (2 dòng) -->
        <div class="col col-title">
          <div class="title-text">{{ (a as any).title || '(Chưa có tiêu đề)' }}</div>
          <div class="note-text" v-if="a.notes">{{ a.notes }}</div>
          <div class="note-text muted" v-else>—</div>
        </div>
        <!-- Col 4: Loại -->
        <div class="col col-type">
          <span class="pill type">{{ typeIcon(a.type) }} {{ typeLabel(a.type) }}</span>
        </div>
        <!-- Col 5: Trạng thái -->
        <div class="col col-status">
          <span class="pill" :class="`status-${a.status}`">{{ statusLabel(a.status) }}</span>
        </div>
        <!-- Col 6: Sale -->
        <div class="col col-owner">
          <span class="av-mini" :style="{ background: saleColor(ownerId(a)).bg }">{{ initials(ownerName(a)) }}</span>
          <span class="owner-name">{{ shortName(ownerName(a)) }}</span>
        </div>
        <!-- Col 7: Actions -->
        <div class="col col-actions" @click.stop>
          <button
            v-if="a.source === 'zalo' && a.conversationId"
            title="Mở chat Zalo"
            @click="$emit('open-chat', a)"
          >💬</button>
          <button
            v-if="a.status === 'scheduled' || a.status === 'overdue'"
            title="Hoàn thành"
            @click="$emit('mark-complete', a)"
          >✓</button>
          <button title="Chi tiết" @click="$emit('select-appointment', a)">⋯</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  saleColor,
  typeIcon,
  typeLabel,
  statusLabel,
  initials,
  resolveContactAvatar,
  appointmentOwnerId as ownerId,
  appointmentOwnerName as ownerName,
  appointmentStart,
  appointmentEnd,
  type AppointmentEx as Appointment,
} from '@/composables/appointment-helpers';
import { orgDayKey, getOrgParts, weekdayInOrgTz } from '@/composables/use-org-timezone';

const props = defineProps<{
  appointments: Appointment[];
}>();

defineEmits<{
  (e: 'select-appointment', a: Appointment): void;
  (e: 'create'): void;
  (e: 'mark-complete', a: Appointment): void;
  (e: 'open-chat', a: Appointment): void;
}>();

// 2026-05-21 Phase B-2: group/compare ngày theo org TZ thay vì browser local.
function isoDay(d: Date): string {
  return orgDayKey(d);
}

/**
 * Urgency tier cho row tint:
 *   overdue  → bg đỏ nhạt, border-left đỏ (quá hạn + chưa xử lý)
 *   upcoming → giữ neutral, border-left = saleColor
 *   done     → opacity 0.65, gạch ngang time
 * Effective overdue = status='overdue' HOẶC status='scheduled' nhưng đã qua now
 * (cron flip mỗi 30 phút có lag → UI phải real-time hơn).
 */
function rowUrgency(a: Appointment): 'overdue' | 'upcoming' | 'done' {
  if (a.status === 'completed' || a.status === 'cancelled' || a.status === 'no_show') return 'done';
  if (a.status === 'overdue') return 'overdue';
  // scheduled: check effective overdue.
  // FIX 2026-06-09: dùng appointmentStart(a) (đã ghép giờ thật) thay vì new Date(appointmentDate)
  // (midnight, bỏ giờ) → trước đây lịch chiều/tối HÔM NAY bị tô đỏ "quá hạn" oan vì 00:00 hôm nay
  // đã < now. Giờ chỉ quá hạn khi qua đúng giờ hẹn.
  if (a.status === 'scheduled' && appointmentStart(a).getTime() < Date.now()) return 'overdue';
  return 'upcoming';
}

function fmtTime(a: Appointment): string {
  const p = getOrgParts(appointmentStart(a));
  if (!p) return '';
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(-2).join(' ') : name;
}

function dayLabel(d: Date): string {
  // Phase B-2: today/tomorrow/yesterday so theo org TZ + DOW + dd/mm/yyyy theo org TZ.
  const todayKey = orgDayKey(new Date());
  const tmrKey = orgDayKey(new Date(Date.now() + 86_400_000));
  const yestKey = orgDayKey(new Date(Date.now() - 86_400_000));
  const dKey = orgDayKey(d);
  const p = getOrgParts(d);
  if (!p) return '';
  let prefix = '';
  if (dKey === todayKey) prefix = 'Hôm nay · ';
  else if (dKey === tmrKey) prefix = 'Mai · ';
  else if (dKey === yestKey) prefix = 'Hôm qua · ';
  const dow = weekdayInOrgTz(d, undefined, 'long');
  return `${prefix}${dow}, ${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}/${p.year}`;
}

function countConflicts(items: Appointment[]): number {
  const conflictSet = new Set<string>();
  const sorted = [...items].sort((a, b) => appointmentStart(a).getTime() - appointmentStart(b).getTime());
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (appointmentStart(sorted[j]).getTime() >= appointmentEnd(sorted[i]).getTime()) break;
      conflictSet.add(sorted[i].id);
      conflictSet.add(sorted[j].id);
    }
  }
  return conflictSet.size;
}

const grouped = computed(() => {
  const m = new Map<string, Appointment[]>();
  for (const a of props.appointments) {
    const k = isoDay(appointmentStart(a));
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(a);
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([iso, items]) => {
      items.sort((a, b) => appointmentStart(a).getTime() - appointmentStart(b).getTime());
      const d = appointmentStart(items[0]);
      return { iso, label: dayLabel(d), items, conflicts: countConflicts(items) };
    });
});
</script>

<style scoped>
@import '@/assets/airtable.css';

.apt-list {
  padding: var(--at-s-md) var(--at-s-xl) var(--at-s-lg);
  overflow-y: auto;
  height: 100%;
  background: var(--at-canvas);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--at-body);
}

/* Empty state — cream callout */
.empty {
  background: var(--at-cream);
  border-radius: var(--at-r-lg);
  padding: var(--at-s-xxl) var(--at-s-lg);
  text-align: center;
  color: var(--at-ink);
}
.empty-icon { font-size: 36px; margin-bottom: var(--at-s-xs); }
.empty h3 {
  margin: var(--at-s-xs) 0 var(--at-s-xxs);
  color: var(--at-ink);
  font-size: 18px;
  font-weight: 500;
}
.empty p { color: var(--at-body); font-size: 13.5px; margin: 0; }
.empty-btn {
  margin-top: var(--at-s-md);
  padding: 10px 18px;
  border: none;
  border-radius: var(--at-r-lg);
  cursor: pointer;
  font-weight: 500;
  font-size: 13px;
  background: var(--at-ink);
  color: var(--at-on-primary);
  font-family: inherit;
}
.empty-btn:active { background: var(--at-primary-active); }

/* Day group */
.group { margin-bottom: var(--at-s-lg); }
.group h3 {
  font-size: 11.5px;
  color: var(--at-muted);
  margin: 0 0 var(--at-s-xs);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  display: flex;
  align-items: center;
  gap: var(--at-s-xs);
}
.group h3 .badge {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  padding: 1px 8px;
  border-radius: var(--at-r-pill);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: var(--at-ink);
}

/* List header — 7 columns: Time | Customer | Title+Note | Type | Status | Sale | Actions */
.list-header {
  display: grid;
  grid-template-columns: 90px 220px 1fr 130px 130px 130px 96px;
  align-items: center;
  gap: var(--at-s-sm);
  padding: 10px var(--at-s-sm);
  background: var(--at-surface-soft);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--at-muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.list-header .col { padding: 0 4px; }

/* List row — Airtable card style, match header grid */
.row {
  display: grid;
  grid-template-columns: 90px 220px 1fr 130px 130px 130px 96px;
  align-items: center;
  gap: var(--at-s-sm);
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-left: 4px solid transparent;
  border-radius: var(--at-r-md);
  padding: 10px var(--at-s-sm);
  margin-bottom: 6px;
  cursor: pointer;
  transition: background 0.1s, box-shadow 0.1s;
}
.row:active { background: var(--at-surface-soft); }

/* Urgency tier tint — overdue (đỏ nhạt) / upcoming (neutral) / done (mờ).
   Border-left vẫn giữ saleColor (do inline style override), trừ overdue được override
   thành đỏ ở template để cảnh báo mạnh hơn. */
.row.overdue {
  background: #fef2f2;
  border-color: #fecaca;
}
.row.overdue .col-time { color: #dc2626; font-weight: 600; }
.row.done {
  opacity: 0.65;
  background: #f8fafc;
}
.row.done .col-time { text-decoration: line-through; color: #64748b; }
.row.done .col-title .title-text { color: var(--at-muted); }
.row .col { padding: 0 4px; min-width: 0; }
.col-time { display: flex; flex-direction: column; gap: 2px; }
.col-customer { display: flex; align-items: center; gap: 10px; min-width: 0; }
.col-title { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.col-title .title-text {
  font-size: 13px; font-weight: 500; color: var(--at-ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.col-title .note-text {
  font-size: 11.5px; color: var(--at-body);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.col-title .note-text.muted { color: var(--at-muted); font-style: italic; }
.col-owner { display: flex; align-items: center; gap: 6px; }
.col-actions { display: flex; gap: 4px; justify-content: flex-end; }

.col-time {
  font-weight: 500;
  font-size: 14px;
  color: var(--at-ink);
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
}
.col-time .dur {
  font-size: 10px;
  color: var(--at-muted);
  font-weight: 500;
  font-family: 'Inter', sans-serif;
  margin-top: 1px;
}

.col-customer .av {
  width: 36px; height: 36px;
  border-radius: var(--at-r-pill);
  color: var(--at-on-primary);
  display: grid; place-items: center;
  font-weight: 500;
  font-size: 12px;
  flex-shrink: 0;
  overflow: hidden;
}
.col-customer .av img {
  width: 100%; height: 100%; object-fit: cover;
  border-radius: var(--at-r-pill);
  display: block;
}
.col-customer .info { min-width: 0; flex: 1; }
.col-customer .info .name {
  font-weight: 500;
  color: var(--at-ink);
  font-size: 13.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.col-customer .info .zalo-tag {
  font-size: 10px;
  color: var(--at-muted);
  letter-spacing: 0.06em;
}
.col-customer .info .sub {
  font-size: 11.5px;
  color: var(--at-muted);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Source col (legacy, not used in 7-col layout but still styled if appears) */
.source {
  font-size: 12px;
  color: var(--at-body);
  display: flex;
  align-items: center;
  gap: 6px;
}
.src-icon {
  width: 22px; height: 22px;
  border-radius: var(--at-r-sm);
  display: grid; place-items: center;
  font-size: 11px;
  font-weight: 500;
  color: var(--at-on-primary);
  flex-shrink: 0;
}
.src-icon.zalo   { background: var(--at-link); }
.src-icon.manual { background: var(--at-muted); }

/* Pills — Airtable signature tints */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 9px;
  border-radius: var(--at-r-pill);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.16px;
  white-space: nowrap;
}
.pill.type { background: var(--at-surface-soft); color: var(--at-body); border: 1px solid var(--at-hairline); }
.pill.status-scheduled { background: #fdf0e3; color: #7a4115; }    /* peach tint */
.pill.status-overdue   { background: #fdf3df; color: #7a5818; }    /* mustard tint */
.pill.status-completed { background: #e3ede4; color: #0a2e0e; }    /* forest tint */
.pill.status-cancelled { background: var(--at-surface-strong); color: var(--at-muted); text-decoration: line-through; }
.pill.status-no_show   { background: #fbe6dc; color: #7a2000; }    /* coral tint */

/* Owner col */
.owner { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--at-body); }
.av-mini {
  width: 22px; height: 22px;
  border-radius: var(--at-r-pill);
  color: var(--at-on-primary);
  display: grid; place-items: center;
  font-size: 10px;
  font-weight: 500;
  flex-shrink: 0;
}

/* Actions */
.actions { display: flex; gap: 4px; justify-content: flex-end; }
.actions button {
  width: 28px; height: 28px;
  border-radius: var(--at-r-sm);
  border: 1px solid transparent;
  background: transparent;
  color: var(--at-body);
  cursor: pointer;
  font-family: inherit;
  font-size: 14px;
}
.actions button:active { background: var(--at-surface-soft); border-color: var(--at-hairline); }

@media (max-width: 1280px) {
  .list-header, .row { grid-template-columns: 80px 200px 1fr 120px 120px 110px 90px; gap: 8px; }
}
@media (max-width: 1100px) {
  .list-header { display: none; }
  .row { grid-template-columns: 70px 1fr 130px 110px 100px 90px 80px; gap: 6px; font-size: 12px; }
  .col-title { display: none; } /* tiêu đề+note merge vào sub của KH */
}

.mobile-meta { display: none; }

@media (max-width: 900px) {
  .apt-list { padding: 10px 12px 20px; }
  .list-header { display: none; }
  .row {
    grid-template-columns: 60px 1fr auto;
    row-gap: 4px;
  }
  .row .col-time { align-self: start; }
  .row .col-customer { min-width: 0; }
  .row .col-customer .info .name { font-size: 13px; }
  .row .col-title,
  .row .col-type,
  .row .col-status,
  .row .col-owner {
    display: none;
  }
  .mobile-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    margin-top: 4px;
  }
  .mobile-meta .src-icon { width: 18px; height: 18px; font-size: 9px; }
  .mobile-meta .av-mini { width: 18px; height: 18px; font-size: 9px; }
}

@media (max-width: 600px) {
  .row { padding: 8px 10px; }
  .row .col-customer .av { width: 33px; height: 33px; font-size: 11px; }
  .col-time { font-size: 13px; }
}
</style>
