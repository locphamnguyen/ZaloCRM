<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="apt-week">
    <div class="cal-head">
      <div class="corner" />
      <div v-for="d in days" :key="d.iso" class="dcol" :class="{ today: d.isToday }">
        <div class="dow">{{ d.dowLabel }}{{ d.isToday ? ' — Hôm nay' : '' }}</div>
        <div class="date">{{ d.day }}</div>
        <div class="count">{{ d.count }} lịch<span v-if="d.pending"> · {{ d.pending }} quá hạn</span></div>
      </div>
    </div>

    <div ref="bodyEl" class="cal-body">
      <div class="timecol">
        <div v-for="h in hourRange" :key="h" class="slot">{{ String(h).padStart(2,'0') }}:00</div>
      </div>

      <div v-for="d in days" :key="d.iso" class="daycol" :class="{ today: d.isToday }">
        <div
          v-for="h in hourRange"
          :key="h"
          class="slot"
          @click="onSlotClick(d.date, h, 0)"
        >
          <div class="halfslot" @click.stop="onSlotClick(d.date, h, 30)" />
        </div>

        <div
          v-for="ev in d.events"
          :key="ev.appt.id"
          class="event"
          :class="[`tier-${ev.tier}`, `state-${ev.appt.status}`, ev.appt.status === 'overdue' ? 'striped' : '']"
          :style="{
            top: ev.top + 'px',
            height: ev.height + 'px',
            background: ev.appt.status === 'cancelled' ? '#94a3b8' : typeBgColor(ev.appt.type),
            left: ev.left,
            width: ev.width,
          }"
          :title="`${ev.contactName} · ${ev.saleName}`"
          @click.stop="$emit('select-appointment', ev.appt)"
        >
          <!-- Dải màu sale bên trái (mọi tier) — element riêng để KHÔNG bị border-rule
               của overdue/cancelled đè. Giữ nền màu-theo-loại. -->
          <span v-if="ev.saleId" class="ev-salebar" :style="{ background: ev.saleBar }" />
          <!-- TIER: COMPACT (< 34px, ≤30p) — 1 dòng: icon + KH + giờ -->
          <template v-if="ev.tier === 'compact'">
            <span class="ev-ico">{{ typeIcon(ev.appt.type) }}</span>
            <span class="ev-name">{{ ev.contactName }}</span>
            <span class="ev-time-inline">{{ ev.startTime }}</span>
          </template>
          <!-- TIER: MEDIUM (34-57px, 45-60p) — 2 dòng -->
          <template v-else-if="ev.tier === 'medium'">
            <div class="ev-top">
              <span class="ev-ico">{{ typeIcon(ev.appt.type) }}</span>
              <span class="ev-name">{{ ev.contactName }}</span>
            </div>
            <div class="ev-bot">{{ ev.timeLabel }}</div>
          </template>
          <!-- TIER: FULL (≥ 58px, ≥75p) — 3 dòng + avatar -->
          <template v-else>
            <div class="ev-top">
              <span class="ev-av" :class="{ 'has-img': !!ev.avatarUrl }">
                <img v-if="ev.avatarUrl" :src="ev.avatarUrl" alt="" @error="onAvatarError" />
                <template v-else>{{ initials(ev.contactName) }}</template>
              </span>
              <span class="ev-name">{{ ev.contactName }}</span>
            </div>
            <div v-if="ev.title" class="ev-title">{{ typeIcon(ev.appt.type) }} {{ ev.title }}</div>
            <div class="ev-meta">
              <span v-if="ev.appt.location" class="ev-loc">📍 {{ ev.appt.location }}</span>
              <span class="ev-time-bottom">{{ ev.timeLabel }}</span>
            </div>
            <!-- Chip sale phụ trách (tier full) — chấm màu sale + tên tắt. -->
            <div v-if="ev.saleId" class="ev-sale" :title="'Phụ trách: ' + ev.saleName">
              <span class="ev-sale-dot" :style="{ background: ev.saleBar }" />
              <span class="ev-sale-name">{{ initials(ev.saleName) }}</span>
            </div>
          </template>
        </div>

        <div v-if="d.isToday && nowOffset !== null" class="nowline" :style="{ top: nowOffset + 'px' }" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import {
  typeIcon,
  typeBgColor,
  initials,
  resolveContactAvatar,
  appointmentStart,
  appointmentEnd,
  saleColor,
  appointmentOwnerId,
  appointmentOwnerName,
  type AppointmentEx as Appointment,
} from '@/composables/appointment-helpers';
import { orgDayKey, getOrgParts, startOfOrgDay } from '@/composables/use-org-timezone';

const props = defineProps<{
  weekStart: Date;
  appointments: Appointment[];
}>();

const emit = defineEmits<{
  (e: 'select-appointment', a: Appointment): void;
  (e: 'create-slot', payload: { date: Date }): void;
}>();

const HOUR_START = 7;
const HOUR_END = 21;
const SLOT_PX = 48;
const hourRange = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const DOW = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

const bodyEl = ref<HTMLElement | null>(null);

// 2026-05-21 Phase B-1: tất cả tính ngày/giờ chuyển sang org TZ.
function isoDay(d: Date): string {
  return orgDayKey(d);
}

const days = computed(() => {
  const todayKey = orgDayKey(new Date());
  return Array.from({ length: 7 }, (_, i) => {
    // Cộng i ngày (delta UTC ms) → giữ chính xác bất kể TZ.
    const date = new Date(props.weekStart.getTime() + i * 86_400_000);
    const orgMid = startOfOrgDay(date);
    const dateOrgMid = orgMid || date;
    const iso = isoDay(dateOrgMid);
    const dayApts = props.appointments.filter(a => isoDay(appointmentStart(a)) === iso);
    const parts = getOrgParts(dateOrgMid);
    return {
      date: dateOrgMid,
      iso,
      dowLabel: DOW[i],
      day: parts?.day ?? dateOrgMid.getDate(),
      isToday: iso === todayKey,
      count: dayApts.length,
      pending: dayApts.filter(a => a.status === 'overdue').length,
      events: layoutEvents(dayApts),
    };
  });
});

type EventTier = 'compact' | 'medium' | 'full';
type LaidOut = {
  appt: Appointment;
  top: number;
  height: number;
  left: string;
  width: string;
  tier: EventTier;
  timeLabel: string;     // "12:00–12:30" (medium/full)
  startTime: string;     // "12:00" (compact)
  contactName: string;
  title: string | null;
  avatarUrl: string | null;
  // Sale phụ trách (dải màu trái mọi tier + chip tier full). Anh chốt 2026-06-08:
  // kết hợp màu-theo-loại (nền) + dấu hiệu sale (dải trái + chip) để nhìn ra cả loại lẫn người.
  saleId: string | null;
  saleName: string;
  saleBar: string;       // màu dải trái = saleColor(saleId).bg
};
function layoutEvents(items: Appointment[]): LaidOut[] {
  const sorted = [...items].sort((a, b) => appointmentStart(a).getTime() - appointmentStart(b).getTime());
  const clusters: Appointment[][] = [];
  let current: Appointment[] = [];
  let currentEnd = 0;
  for (const a of sorted) {
    const s = appointmentStart(a).getTime();
    const e = appointmentEnd(a).getTime();
    if (current.length === 0 || s < currentEnd) {
      current.push(a);
      currentEnd = Math.max(currentEnd, e);
    } else {
      clusters.push(current);
      current = [a];
      currentEnd = e;
    }
  }
  if (current.length) clusters.push(current);

  const out: LaidOut[] = [];
  for (const cluster of clusters) {
    const columns: Appointment[][] = [];
    for (const a of cluster) {
      let placed = false;
      for (const col of columns) {
        const last = col[col.length - 1];
        if (appointmentEnd(last).getTime() <= appointmentStart(a).getTime()) {
          col.push(a);
          placed = true;
          break;
        }
      }
      if (!placed) columns.push([a]);
    }
    const nCols = columns.length;
    columns.forEach((col, colIdx) => {
      for (const a of col) {
        out.push(buildLaidOut(a, colIdx, nCols));
      }
    });
  }
  return out;
}

function buildLaidOut(a: Appointment, colIdx: number, nCols: number): LaidOut {
  const start = appointmentStart(a);
  const end = appointmentEnd(a);
  // Phase B-1: hour/minute đọc theo org TZ → vertical position chính xác kể cả browser khác TZ.
  const sp = getOrgParts(start);
  const ep = getOrgParts(end);
  const startH = sp ? sp.hour + sp.minute / 60 : start.getHours() + start.getMinutes() / 60;
  const endH = ep ? ep.hour + ep.minute / 60 : end.getHours() + end.getMinutes() / 60;
  const top = (startH - HOUR_START) * SLOT_PX;
  // Min 30px để card 15-phút vẫn render được 1 dòng compact (icon + tên + giờ)
  const height = Math.max(30, (endH - startH) * SLOT_PX - 2);
  // Tier: compact ≤30p (<34px), medium 45-60p (34-57px), full ≥75p (≥58px)
  let tier: EventTier = 'compact';
  if (height >= 58) tier = 'full';
  else if (height >= 34) tier = 'medium';

  const widthPct = 100 / nCols;
  return {
    appt: a,
    top,
    height,
    left: `calc(${colIdx * widthPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
    tier,
    timeLabel: `${fmtTime(start)}–${fmtTime(end)}`,
    startTime: fmtTime(start),
    contactName: a.contact?.fullName || 'KH chưa rõ',
    title: (a as any).title || null,
    avatarUrl: resolveContactAvatar(a.contact),
    saleId: appointmentOwnerId(a),
    saleName: appointmentOwnerName(a),
    saleBar: saleColor(appointmentOwnerId(a)).bg,
  };
}

function onAvatarError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}

function fmtTime(d: Date): string {
  const p = getOrgParts(d);
  if (!p) return '';
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const nowTick = ref(Date.now());
let tickHandle: number | null = null;
onMounted(() => {
  tickHandle = window.setInterval(() => { nowTick.value = Date.now(); }, 60_000);
  // Phase B-1: scroll-to-current-hour theo org TZ.
  const nowP = getOrgParts(new Date());
  const nowHour = nowP?.hour ?? new Date().getHours();
  const hour = Math.max(HOUR_START, Math.min(HOUR_END - 2, nowHour - 1));
  if (bodyEl.value) bodyEl.value.scrollTop = (hour - HOUR_START) * SLOT_PX;
});
onBeforeUnmount(() => { if (tickHandle) window.clearInterval(tickHandle); });

const nowOffset = computed(() => {
  void nowTick.value;
  const nowP = getOrgParts(new Date());
  if (!nowP) return null;
  const h = nowP.hour + nowP.minute / 60;
  if (h < HOUR_START || h > HOUR_END) return null;
  return (h - HOUR_START) * SLOT_PX;
});

function onSlotClick(date: Date, hour: number, minute: number) {
  const d = new Date(date);
  d.setHours(hour, minute, 0, 0);
  emit('create-slot', { date: d });
}
</script>

<style scoped>
@import '@/assets/airtable.css';

.apt-week {
  display: grid; grid-template-rows: auto 1fr;
  height: 100%;
  background: var(--at-canvas);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Day header row */
.cal-head {
  display: grid;
  grid-template-columns: 60px repeat(7, 1fr);
  border-bottom: 1px solid var(--at-hairline);
}
.cal-head .corner { border-right: 1px solid var(--at-hairline); }
.cal-head .dcol {
  padding: var(--at-s-sm) var(--at-s-xs);
  border-right: 1px solid var(--at-hairline);
  text-align: center;
  background: var(--at-canvas);
}
.cal-head .dcol .dow {
  font-size: 10.5px;
  text-transform: uppercase;
  color: var(--at-muted);
  font-weight: 500;
  letter-spacing: 0.08em;
}
.cal-head .dcol .date {
  font-size: 20px;
  font-weight: 400;
  color: var(--at-ink);
  line-height: 1;
  margin-top: 2px;
}
.cal-head .dcol.today .dow { color: var(--at-coral); }
.cal-head .dcol.today .date {
  display: inline-flex;
  align-items: center; justify-content: center;
  width: 32px; height: 32px;
  background: var(--at-ink);
  color: var(--at-on-primary);
  border-radius: var(--at-r-pill);
  font-size: 16px;
  font-weight: 500;
}
.cal-head .dcol .count {
  font-size: 10px;
  color: var(--at-muted);
  margin-top: 2px;
  font-weight: 500;
}

/* Body grid */
.cal-body {
  position: relative;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 60px repeat(7, 1fr);
  background: var(--at-canvas);
}

/* Time column */
.timecol { border-right: 1px solid var(--at-hairline); }
.timecol .slot {
  height: 48px;
  border-bottom: 1px solid var(--at-hairline);
  font-size: 10.5px;
  color: var(--at-muted);
  padding: 2px 6px;
  text-align: right;
  font-weight: 500;
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  box-sizing: border-box;
}

/* Day columns */
.daycol {
  border-right: 1px solid var(--at-hairline);
  position: relative;
}
.daycol .slot {
  height: 48px;
  border-bottom: 1px solid var(--at-hairline);
  cursor: pointer;
  position: relative;
}
.daycol .slot:active { background: var(--at-surface-soft); }
.daycol .slot .halfslot {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 50%;
  border-top: 1px dashed var(--at-hairline);
}
.daycol .slot .halfslot:active { background: rgba(170,45,0,0.04); }
.daycol.today { background: rgba(170,45,0,0.018); }

/* Event card — saleColor bg (dark) + WHITE text. 3 tier theo height:
   compact (<34px) 1 dòng · medium (34-57px) 2 dòng · full (≥58px) 3 dòng + avatar */
.event {
  position: absolute;
  border-radius: 6px;
  overflow: hidden;
  cursor: pointer;
  color: #fff;
  border-left: 3px solid rgba(255,255,255,0.5);
  box-shadow: 0 1px 3px rgba(24,29,38,0.18);
  font-family: inherit;
  line-height: 1.25;
}
.event:hover { box-shadow: 0 2px 6px rgba(24,29,38,0.28); z-index: 5; }
.event:active { transform: translateY(1px); }

/* Dải màu sale bên trái — đè lên border-left trắng mờ, hiển thị mọi tier + mọi state
   (overdue/cancelled override border-left-color nhưng KHÔNG đụng element này). */
.event .ev-salebar {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  border-radius: 6px 0 0 6px;
  pointer-events: none;
  z-index: 1;
}
/* Chip sale (tier full): chấm màu + tên tắt, góc dưới-phải, nền mờ tối nhẹ. */
.event.tier-full .ev-sale {
  display: inline-flex; align-items: center; gap: 3px;
  margin-top: 3px;
  font-size: 9.5px; opacity: 0.92;
}
.event.tier-full .ev-sale-dot {
  width: 7px; height: 7px; border-radius: 50%;
  flex-shrink: 0; box-shadow: 0 0 0 1px rgba(255,255,255,0.6);
}
.event.tier-full .ev-sale-name {
  font-weight: 600; letter-spacing: 0.02em;
}

/* ─── COMPACT (1 dòng: icon + tên + giờ, font 10.5px) ─── */
.event.tier-compact {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 7px;
  font-size: 10.5px;
  font-weight: 500;
  white-space: nowrap;
}
.event.tier-compact .ev-ico { font-size: 11px; flex-shrink: 0; }
.event.tier-compact .ev-name {
  font-weight: 600;
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis;
}
.event.tier-compact .ev-time-inline {
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  font-size: 10px; opacity: 0.9; flex-shrink: 0;
}

/* ─── MEDIUM (2 dòng) ─── */
.event.tier-medium {
  padding: 4px 7px;
  font-size: 11px;
}
.event.tier-medium .ev-top {
  display: flex; align-items: center; gap: 5px;
  margin-bottom: 1px;
  font-weight: 600;
}
.event.tier-medium .ev-ico { font-size: 12px; flex-shrink: 0; }
.event.tier-medium .ev-name {
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.event.tier-medium .ev-bot {
  font-size: 10px; opacity: 0.88;
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
}

/* ─── FULL (3 dòng + avatar) ─── */
.event.tier-full {
  padding: 5px 8px;
  font-size: 11px;
}
.event.tier-full .ev-top {
  display: flex; align-items: center; gap: 6px;
  margin-bottom: 3px;
}
.event.tier-full .ev-av {
  width: 22px; height: 22px; border-radius: 50%;
  background: rgba(255,255,255,0.22);
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 600;
  flex-shrink: 0;
  overflow: hidden;
}
.event.tier-full .ev-av.has-img { background: transparent; }
.event.tier-full .ev-av img {
  width: 100%; height: 100%; object-fit: cover; border-radius: 50%;
  display: block;
}
.event.tier-full .ev-name {
  font-weight: 600; font-size: 12px;
  flex: 1; min-width: 0;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.event.tier-full .ev-title {
  font-size: 11px; opacity: 0.95;
  margin-bottom: 3px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.event.tier-full .ev-meta {
  font-size: 10px; opacity: 0.88;
  display: flex; gap: 8px; flex-wrap: wrap;
  align-items: baseline;
}
.event.tier-full .ev-loc { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.event.tier-full .ev-time-bottom {
  font-family: ui-monospace, 'SF Mono', Consolas, monospace;
  margin-left: auto; flex-shrink: 0;
}

/* ─── State modifiers ─── */
.event.striped {
  background-image: repeating-linear-gradient(45deg,
    transparent 0, transparent 5px,
    rgba(255,255,255,0.18) 5px, rgba(255,255,255,0.18) 10px) !important;
  border-left-color: #fbbf24 !important;
}
.event.striped::after {
  content: '⏰';
  position: absolute; top: 2px; right: 4px;
  font-size: 9.5px; opacity: 0.95;
}
.event.state-completed { opacity: 0.55; }
.event.state-completed .ev-name,
.event.state-completed .ev-title { text-decoration: line-through; }
.event.state-cancelled {
  opacity: 0.5;
  background: #94a3b8 !important;
  border-left-color: rgba(255,255,255,0.4) !important;
}
.event.state-cancelled .ev-name,
.event.state-cancelled .ev-title { text-decoration: line-through; }

/* Now line — coral instead of red */
.nowline {
  position: absolute; left: 0; right: 0;
  height: 2px;
  background: var(--at-coral);
  z-index: 4;
  pointer-events: none;
}
.nowline::before {
  content: "";
  position: absolute;
  left: -5px; top: -5px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--at-coral);
}
</style>
