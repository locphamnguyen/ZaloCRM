<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- 2026-05-21: switched from fixed overlay (Teleport to body) to inline panel
       as 3rd grid column in AppointmentsView. Was causing z-index conflicts +
       content bleed-through. Mobile fallback remains overlay via CSS media query. -->
  <aside v-if="appointment" class="apt-panel" :class="{ open: !!appointment }">
    <div class="panel-overlay panel-overlay--mobile-only" @click="$emit('close')" />
    <div class="apt-panel-inner">
      <template v-if="appointment">
        <div class="panel-head">
          <div class="ev-color" :style="{ background: typeBgColor(appointment.type) }" />
          <h3>{{ appointment.contact?.fullName || 'Lịch hẹn' }} — {{ typeLabel(appointment.type) }}</h3>
          <button class="close" @click="$emit('close')">✕</button>
        </div>

        <div class="panel-body">
          <div class="panel-section">
            <h5>Khách hàng</h5>
            <div class="cust-card">
              <div
                class="av"
                :style="contactAvatarUrl ? {} : { background: saleColor(ownerId(appointment)).bg }"
              >
                <img
                  v-if="contactAvatarUrl"
                  :src="contactAvatarUrl"
                  alt=""
                  @error="onAvatarError"
                />
                <template v-else>{{ initials(appointment.contact?.fullName) }}</template>
              </div>
              <div class="info">
                <div class="name">{{ appointment.contact?.fullName || 'Chưa rõ' }}</div>
                <div class="sub">
                  <span v-if="appointment.contact?.phone">📱 {{ appointment.contact.phone }}</span>
                  <span v-if="appointment.contact?.zaloUid"> · 🔵 {{ appointment.contact.zaloUid }}</span>
                </div>
              </div>
              <div class="actions-stack">
                <button
                  v-if="appointment.source === 'zalo' && appointment.conversationId"
                  title="Mở Zalo chat"
                  @click="$emit('open-chat', appointment)"
                >💬</button>
                <button
                  v-if="appointment.contact?.id"
                  title="Hồ sơ KH"
                  @click="$emit('open-contact', appointment)"
                >👤</button>
              </div>
            </div>
          </div>

          <div class="panel-section">
            <h5>Chi tiết</h5>
            <div class="kv-row">
              <span class="k">⏰ Thời gian</span>
              <span class="v"><b>{{ timeRangeLabel }}</b></span>
            </div>
            <div class="kv-row">
              <span class="k">🎯 Loại</span>
              <span class="v">
                <span class="pill type">{{ typeIcon(appointment.type) }} {{ typeLabel(appointment.type) }}</span>
              </span>
            </div>
            <div class="kv-row">
              <span class="k">✅ Trạng thái</span>
              <span class="v">
                <span class="pill" :class="`status-${appointment.status}`">{{ statusLabel(appointment.status) }}</span>
              </span>
            </div>
            <div class="kv-row">
              <span class="k">👤 Sale</span>
              <span class="v">
                <span class="av-mini" :style="{ background: saleColor(ownerId(appointment)).bg }">{{ initials(ownerName(appointment)) }}</span>
                {{ ownerName(appointment) }}
              </span>
            </div>
            <div class="kv-row">
              <span class="k">🔗 Nguồn</span>
              <span class="v">
                {{ appointment.source === 'zalo' ? 'Tự tạo từ chat Zalo' : 'Tạo thủ công' }}
                <a v-if="appointment.source === 'zalo' && appointment.conversationId" href="#" class="link" @click.prevent="$emit('open-chat', appointment)">· Xem chat gốc →</a>
              </span>
            </div>
            <div v-if="appointment.notes" class="kv-row">
              <span class="k">📝 Ghi chú</span>
              <span class="v">{{ appointment.notes }}</span>
            </div>
          </div>

          <div class="panel-section">
            <h5>Lịch sử hoạt động</h5>
            <div class="timeline">
              <div v-if="appointment.statusChangedAt && appointment.statusChangedBy" class="tl-item done">
                <div class="when">{{ formatRelative(appointment.statusChangedAt) }}</div>
                <div class="what">✅ {{ statusLabel(appointment.status) }} — bởi {{ appointment.statusChangedBy.fullName || appointment.statusChangedBy.email }}</div>
              </div>
              <div class="tl-item done">
                <div class="when">{{ formatRelative(appointment.createdAt) }}</div>
                <div class="what">🆕 Lịch hẹn được tạo</div>
                <div v-if="appointment.source === 'zalo'" class="more">Auto-detect từ chat Zalo</div>
              </div>
            </div>
          </div>
        </div>

        <div class="panel-foot">
          <button class="btn" @click="$emit('reschedule', appointment)">📅 Đổi giờ</button>
          <button
            v-if="appointment.status === 'scheduled' || appointment.status === 'overdue'"
            class="btn danger"
            @click="$emit('cancel', appointment)"
          >✕ Huỷ</button>
          <button
            v-if="appointment.status === 'scheduled' || appointment.status === 'overdue'"
            class="btn warn"
            @click="$emit('no-show', appointment)"
          >👤 Vắng</button>
          <button
            v-if="appointment.status === 'scheduled' || appointment.status === 'overdue'"
            class="btn primary"
            @click="$emit('complete', appointment)"
          >✓ Hoàn thành</button>
        </div>
      </template>
    </div>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { api } from '@/api/index';
import {
  saleColor,
  typeIcon,
  typeLabel,
  typeBgColor,
  statusLabel,
  initials,
  resolveContactAvatar,
  appointmentOwnerId as ownerId,
  appointmentOwnerName as ownerName,
  appointmentStart,
  appointmentEnd,
  type AppointmentEx as Appointment,
} from '@/composables/appointment-helpers';
import { formatInOrgTz, getOrgParts, weekdayInOrgTz } from '@/composables/use-org-timezone';

const props = defineProps<{
  appointment: Appointment | null;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'reschedule', a: Appointment): void;
  (e: 'cancel', a: Appointment): void;
  (e: 'no-show', a: Appointment): void;
  (e: 'complete', a: Appointment): void;
  (e: 'open-chat', a: Appointment): void;
  (e: 'open-contact', a: Appointment): void;
}>();

// 2026-05-21 Phase B-4: DOW + dd/mm/yyyy compute via org TZ (xem use-org-timezone.ts).
// Trước: getDay/getDate/getMonth/getFullYear/getHours/getMinutes → browser local TZ.

// Avatar resolve: ưu tiên data sẵn có trên appointment.contact (Contact.avatarUrl +
// friends embed từ APPOINTMENT_INCLUDE). Nếu vẫn null → fetch /contacts/:id enrich.
const enrichedAvatarUrl = ref<string | null>(null);
const contactAvatarUrl = computed<string | null>(() => {
  if (enrichedAvatarUrl.value) return enrichedAvatarUrl.value;
  return resolveContactAvatar(props.appointment?.contact);
});
async function enrichAvatar(contactId: string) {
  try {
    const res = await api.get(`/contacts/${contactId}`);
    const url = resolveContactAvatar(res.data);
    if (url && props.appointment?.contact?.id === contactId) {
      enrichedAvatarUrl.value = url;
    }
  } catch (err) {
    console.warn('[detail-panel] avatar enrich failed', err);
  }
}
function onAvatarError(e: Event) {
  (e.target as HTMLImageElement).style.display = 'none';
}
// Reset + enrich khi đổi appointment
watch(() => props.appointment?.id, (id) => {
  enrichedAvatarUrl.value = null;
  const c = props.appointment?.contact;
  if (id && c?.id && !resolveContactAvatar(c)) {
    enrichAvatar(c.id);
  }
}, { immediate: true });

const timeRangeLabel = computed(() => {
  if (!props.appointment) return '';
  const s = appointmentStart(props.appointment);
  const e = appointmentEnd(props.appointment);
  const sp = getOrgParts(s);
  const ep = getOrgParts(e);
  if (!sp || !ep) return '';
  const dow = weekdayInOrgTz(s, undefined, 'long');
  const sd = `${dow}, ${String(sp.day).padStart(2, '0')}/${String(sp.month).padStart(2, '0')}/${sp.year}`;
  const st = `${String(sp.hour).padStart(2, '0')}:${String(sp.minute).padStart(2, '0')}`;
  const et = `${String(ep.hour).padStart(2, '0')}:${String(ep.minute).padStart(2, '0')}`;
  return `${sd} · ${st}–${et}`;
});

function formatRelative(iso: string): string {
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
@import '@/assets/airtable.css';

/* Desktop: inline panel = 3rd grid column trong apt-body. Không fixed/overlay. */
.apt-panel {
  position: relative;
  width: 100%;
  height: 100%;
  background: var(--at-canvas);
  border-left: 1px solid var(--at-hairline);
  display: flex;
  flex-direction: column;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--at-body);
  overflow: hidden;
}
.apt-panel-inner {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}
.panel-overlay--mobile-only { display: none; }

/* Mobile / narrow: fixed overlay với backdrop */
@media (max-width: 900px) {
  .apt-panel {
    position: fixed;
    top: var(--smax-topnav-h, 52px);
    right: 0;
    bottom: 0;
    left: 0;
    width: 100vw;
    z-index: 1200;
    border-left: none;
    box-shadow: 0 -8px 32px rgba(24,29,38,0.16);
  }
  .panel-overlay--mobile-only {
    display: block;
    position: fixed;
    inset: var(--smax-topnav-h, 52px) 0 0 0;
    background: rgba(24,29,38,0.22);
    z-index: -1;
  }
}

/* Head: signature ribbon (4px) on top via .ev-color, then content */
.panel-head {
  padding: var(--at-s-md) var(--at-s-lg);
  border-bottom: 1px solid var(--at-hairline);
  display: flex;
  align-items: center;
  gap: var(--at-s-sm);
}
.panel-head .ev-color {
  width: 4px;
  height: 32px;
  border-radius: 2px;
}
.panel-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--at-ink);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.panel-head .close {
  background: transparent;
  border: none;
  font-size: 18px;
  color: var(--at-muted);
  width: 32px; height: 32px;
  border-radius: var(--at-r-md);
  cursor: pointer;
  font-family: inherit;
}
.panel-head .close:active { background: var(--at-surface-soft); }

.panel-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--at-s-lg);
}
.panel-section { margin-bottom: var(--at-s-lg); }
.panel-section h5 {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--at-muted);
  margin: 0 0 var(--at-s-xs);
  letter-spacing: 0.08em;
}

/* Customer card — Airtable cream-ish surface */
.cust-card {
  background: var(--at-surface-soft);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-sm);
  display: flex;
  gap: var(--at-s-sm);
  align-items: center;
}
.cust-card .av {
  width: 48px; height: 48px;
  border-radius: var(--at-r-pill);
  color: var(--at-on-primary);
  display: grid; place-items: center;
  font-weight: 500;
  font-size: 17px;
  flex-shrink: 0;
  overflow: hidden;
}
.cust-card .av img {
  width: 100%; height: 100%; object-fit: cover;
  border-radius: var(--at-r-pill);
  display: block;
}
.cust-card .info { flex: 1; min-width: 0; }
.cust-card .info .name {
  font-weight: 500;
  font-size: 15px;
  color: var(--at-ink);
}
.cust-card .info .sub {
  font-size: 12.5px;
  color: var(--at-muted);
  margin-top: 2px;
}

.actions-stack { display: flex; flex-direction: column; gap: 4px; }
.actions-stack button {
  width: 32px; height: 32px;
  border-radius: var(--at-r-sm);
  border: 1px solid var(--at-hairline);
  background: var(--at-canvas);
  cursor: pointer;
  color: var(--at-body);
  font-family: inherit;
}
.actions-stack button:active { background: var(--at-surface-soft); }

/* Key-value rows */
.kv-row {
  display: flex;
  gap: var(--at-s-sm);
  padding: var(--at-s-xs) 0;
  border-bottom: 1px solid var(--at-hairline);
  font-size: 13px;
}
.kv-row:last-child { border-bottom: none; }
.kv-row .k {
  color: var(--at-muted);
  width: 100px;
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  padding-top: 2px;
}
.kv-row .v {
  flex: 1;
  color: var(--at-ink);
  line-height: 1.5;
}
.kv-row .v .link {
  color: var(--at-link);
  text-decoration: none;
  font-size: 12.5px;
}

/* Pills — Airtable signature tints */
.pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: var(--at-r-pill);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.16px;
}
.pill.type { background: var(--at-surface-soft); color: var(--at-body); border: 1px solid var(--at-hairline); }
.pill.status-scheduled { background: #fdf0e3; color: #7a4115; }
.pill.status-overdue   { background: #fdf3df; color: #7a5818; }
.pill.status-completed { background: #e3ede4; color: #0a2e0e; }
.pill.status-cancelled { background: var(--at-surface-strong); color: var(--at-muted); text-decoration: line-through; }
.pill.status-no_show   { background: #fbe6dc; color: #7a2000; }

.av-mini {
  display: inline-grid;
  place-items: center;
  width: 18px; height: 18px;
  border-radius: var(--at-r-pill);
  color: var(--at-on-primary);
  font-size: 9px;
  font-weight: 500;
  margin-right: 4px;
  vertical-align: middle;
}

/* Timeline */
.timeline { position: relative; padding-left: 24px; }
.timeline::before {
  content: "";
  position: absolute;
  left: 8px;
  top: 4px; bottom: 4px;
  width: 1px;
  background: var(--at-hairline);
}
.tl-item {
  position: relative;
  padding: 4px 0 12px;
  font-size: 12.5px;
}
.tl-item::before {
  content: "";
  position: absolute;
  left: -24px;
  top: 7px;
  width: 12px; height: 12px;
  border-radius: 50%;
  background: var(--at-canvas);
  border: 2px solid var(--at-coral);
}
.tl-item.done::before { background: var(--at-forest); border-color: var(--at-forest); }
.tl-item .when { color: var(--at-muted); font-size: 11px; }
.tl-item .what { font-weight: 500; color: var(--at-ink); }
.tl-item .more { color: var(--at-body); font-size: 12px; }

/* Foot — Airtable primary CTA near-black */
.panel-foot {
  padding: var(--at-s-sm) var(--at-s-lg);
  border-top: 1px solid var(--at-hairline);
  display: flex;
  gap: var(--at-s-xs);
  background: var(--at-surface-soft);
  flex-wrap: wrap;
}
.panel-foot .btn {
  flex: 1;
  padding: 9px 12px;
  border-radius: var(--at-r-lg);
  border: 1px solid var(--at-hairline);
  background: var(--at-canvas);
  cursor: pointer;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--at-ink);
  min-width: 80px;
  font-family: inherit;
}
.panel-foot .btn:active { background: var(--at-surface-soft); }
.panel-foot .btn.primary {
  background: var(--at-ink);
  color: var(--at-on-primary);
  border-color: var(--at-ink);
}
.panel-foot .btn.primary:active { background: var(--at-primary-active); }
.panel-foot .btn.danger { color: var(--at-coral); border-color: var(--at-coral); }
.panel-foot .btn.danger:active { background: #fbe6dc; }
.panel-foot .btn.warn { color: #7a5818; border-color: var(--at-mustard); }
.panel-foot .btn.warn:active { background: #fdf3df; }
</style>
