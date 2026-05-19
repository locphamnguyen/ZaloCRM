<template>
  <div class="accounts-table-wrap">
    <table class="accounts-table">
      <thead>
        <tr>
          <th class="th-chk">
            <input type="checkbox" class="chk" :checked="allChecked" :indeterminate.prop="someChecked" @change="onToggleAll" />
          </th>
          <th>Nick Zalo</th>
          <th>Trạng thái</th>
          <th>Sale phụ trách</th>
          <th>Msg today</th>
          <th>Uptime 7d</th>
          <th>Hoạt động cuối</th>
          <th class="th-actions">Action</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="acct in accounts"
          :key="acct.id"
          :class="[
            { selected: isSelected(acct.id) },
            { alert: acct.healthAlert },
          ]"
          @click="onRowClick(acct.id, $event)"
        >
          <td class="td-chk" @click.stop>
            <input
              type="checkbox"
              class="chk"
              :checked="isSelected(acct.id)"
              @change="toggleSelect(acct.id)"
            />
          </td>
          <td>
            <div class="name-cell">
              <div class="avatar" :style="avatarStyle(acct)">
                {{ initials(acct) }}
              </div>
              <div class="info">
                <div class="nm">
                  {{ acct.displayName || 'Nick chưa đặt tên' }}
                  <span v-if="acct.healthAlert" class="badge-alert" title="Uptime < 80% trong 7 ngày">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  </span>
                </div>
                <div class="uid">
                  <span v-if="acct.zaloUid">UID {{ acct.zaloUid }}</span>
                  <span v-if="acct.phone"> · {{ maskPhone(acct.phone) }}</span>
                </div>
              </div>
            </div>
          </td>
          <td>
            <span class="status" :class="statusClass(acct.liveStatus)">
              <span class="dot"></span>
              {{ statusLabel(acct.liveStatus).label }}
            </span>
          </td>
          <td>
            <div v-if="acct.crew.length" class="sales-stack">
              <span
                v-for="(c, i) in acct.crew.slice(0, 3)"
                :key="c.accessId"
                class="avatar-mini"
                :style="{ background: avatarColor((c.user.fullName || c.user.email), i), zIndex: 3 - i }"
                :title="`${c.user.fullName || c.user.email} · ${c.role}`"
              >
                {{ shortName(c.user.fullName || c.user.email) }}
              </span>
              <span v-if="acct.crew.length > 3" class="more">+{{ acct.crew.length - 3 }}</span>
            </div>
            <span v-else class="muted-italic">Chưa gán</span>
          </td>
          <td>
            <div class="progress" :class="progressClass(acct.msgToday, acct.quota)">
              <span class="vals">{{ acct.msgToday }}/{{ acct.quota }}</span>
              <div class="bar"><i :style="{ width: progressPct(acct.msgToday, acct.quota) + '%' }"></i></div>
            </div>
          </td>
          <td>
            <span class="uptime" :class="uptimeColor(acct.uptime7d)">
              {{ acct.uptime7d }}%
              <UptimeSparkline
                v-if="uptimeCache[acct.id]"
                :buckets="uptimeCache[acct.id]"
                :color="uptimeColor(acct.uptime7d)"
              />
            </span>
          </td>
          <td>{{ relativeTime(acct.lastActivityAt) }}</td>
          <td class="td-actions" @click.stop>
            <button class="icon-btn" :title="acct.liveStatus === 'connected' ? 'Sync' : 'Re-login'" @click="onActionClick(acct, 'reconnect')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
            </button>
            <button class="icon-btn" title="Sync danh bạ" @click="onActionClick(acct, 'sync')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
            </button>
            <button class="icon-btn" title="Mở chi tiết" @click="$emit('open-detail', acct.id)">
              <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
            </button>
          </td>
        </tr>
        <tr v-if="!accounts.length">
          <td colspan="8" class="empty-row">
            <div class="empty-msg">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/></svg>
              <div>Không có nick nào khớp bộ lọc</div>
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EnrichedAccount, UptimeBucket } from '@/composables/use-zalo-accounts-dashboard';
import UptimeSparkline from './UptimeSparkline.vue';

const props = defineProps<{
  accounts: EnrichedAccount[];
  uptimeCache: Record<string, UptimeBucket[]>;
  isSelected: (id: string) => boolean;
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  relativeTime: (iso: string | null) => string;
  statusLabel: (live: string) => { label: string; color: string };
  uptimeColor: (uptime: number) => 'success' | 'warning' | 'error';
}>();

const emit = defineEmits<{
  (e: 'open-detail', id: string): void;
  (e: 'action', payload: { account: EnrichedAccount; action: 'reconnect' | 'sync' }): void;
}>();

const allChecked = computed(() =>
  props.accounts.length > 0 && props.accounts.every((a) => props.isSelected(a.id)),
);
const someChecked = computed(() =>
  props.accounts.some((a) => props.isSelected(a.id)) && !allChecked.value,
);

function onToggleAll() {
  if (allChecked.value) props.clearSelection();
  else props.selectAll(props.accounts.map((a) => a.id));
}

function onRowClick(id: string, e: MouseEvent) {
  // Avoid trigger when interacting with action cells / checkbox
  const target = e.target as HTMLElement;
  if (target.closest('input, button, .td-actions, .td-chk')) return;
  emit('open-detail', id);
}

function onActionClick(account: EnrichedAccount, action: 'reconnect' | 'sync') {
  emit('action', { account, action });
}

function statusClass(live: string): string {
  if (live === 'connected') return 'ok';
  if (live === 'connecting' || live === 'qr_pending') return 'warn';
  return 'err';
}

function progressPct(n: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((n / total) * 100));
}
function progressClass(n: number, total: number): string {
  const p = progressPct(n, total);
  if (p >= 95) return 'over';
  if (p >= 80) return 'high';
  return '';
}

function initials(a: EnrichedAccount): string {
  const src = a.displayName || a.zaloUid || a.phone || '?';
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function shortName(name: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

const GRADIENTS = [
  ['#6366F1', '#A855F7'],
  ['#10B981', '#059669'],
  ['#F59E0B', '#D97706'],
  ['#EC4899', '#BE185D'],
  ['#3B82F6', '#1D4ED8'],
  ['#14B8A6', '#0F766E'],
];
function hashIdx(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % mod;
}
function avatarStyle(a: EnrichedAccount): Record<string, string> {
  if (a.avatarUrl) {
    return { backgroundImage: `url("${a.avatarUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  const key = a.zaloUid || a.id;
  const [c1, c2] = GRADIENTS[hashIdx(key, GRADIENTS.length)];
  return { background: `linear-gradient(135deg, ${c1}, ${c2})` };
}
function avatarColor(seed: string, fallbackIdx: number): string {
  const [c1, c2] = GRADIENTS[seed ? hashIdx(seed, GRADIENTS.length) : fallbackIdx % GRADIENTS.length];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}

function maskPhone(p: string): string {
  if (!p) return '';
  if (p.length < 7) return p;
  return p.slice(0, 4) + '.xxx.' + p.slice(-3);
}
</script>

<style scoped>
.accounts-table-wrap {
  background: #FFFFFF;
  border: 1px solid #F3F4F6;
  border-radius: 10px;
  overflow: hidden;
}
.accounts-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
thead th {
  background: #F9FAFB;
  font-size: 11px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 9px 10px;
  text-align: left;
  border-bottom: 1px solid #F3F4F6;
  white-space: nowrap;
}
.th-chk { width: 32px }
.th-actions { width: 110px; text-align: right }
tbody td {
  padding: 10px;
  border-bottom: 1px solid #F3F4F6;
  vertical-align: middle;
  color: #111827;
}
tbody tr {
  transition: background 0.12s;
  cursor: pointer;
}
tbody tr:hover { background: #FAFBFC }
tbody tr.selected { background: #EEF2FF }
tbody tr.alert { background: #FFFBFB }
tbody tr.alert:hover { background: #FFF5F5 }

.td-chk { width: 32px }
.td-actions { text-align: right }
.chk { width: 14px; height: 14px; accent-color: #6366F1; cursor: pointer }

.name-cell {
  display: flex;
  align-items: center;
  gap: 10px;
}
.avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
  letter-spacing: .02em;
}
.info { display: flex; flex-direction: column; min-width: 0 }
.nm {
  font-weight: 600;
  color: #111827;
  font-size: 12.5px;
  line-height: 1.25;
  display: flex;
  align-items: center;
  gap: 6px;
}
.uid {
  font-size: 11px;
  color: #9CA3AF;
  font-family: Menlo, Consolas, monospace;
  margin-top: 1px;
}

.badge-alert {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: #FEF2F2;
  color: #B91C1C;
  border: 1px solid #FECACA;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 99px;
}

.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 500;
}
.status .dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}
.status.ok { color: #047857 }
.status.ok .dot { background: #10B981; box-shadow: 0 0 0 2px #D1FAE5 }
.status.warn { color: #B45309 }
.status.warn .dot { background: #F59E0B; box-shadow: 0 0 0 2px #FEF3C7 }
.status.err { color: #B91C1C }
.status.err .dot { background: #EF4444; box-shadow: 0 0 0 2px #FEE2E2 }

.sales-stack { display: inline-flex; align-items: center }
.avatar-mini {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: .02em;
  border: 2px solid white;
  margin-left: -6px;
}
.avatar-mini:first-child { margin-left: 0 }
.more {
  margin-left: -6px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #F3F4F6;
  color: #6B7280;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9.5px;
  font-weight: 700;
  border: 2px solid white;
}
.muted-italic {
  font-size: 11.5px;
  color: #9CA3AF;
  font-style: italic;
}

.progress {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: #4B5563;
  white-space: nowrap;
}
.progress .vals { font-variant-numeric: tabular-nums }
.progress .bar {
  width: 60px;
  height: 5px;
  border-radius: 99px;
  background: #F3F4F6;
  overflow: hidden;
}
.progress .bar > i {
  display: block;
  height: 100%;
  background: #6366F1;
  border-radius: 99px;
}
.progress.high .bar > i { background: #F59E0B }
.progress.over .bar > i { background: #EF4444 }

.uptime {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #4B5563;
  font-variant-numeric: tabular-nums;
}
.uptime.success { color: #047857 }
.uptime.warning { color: #B45309 }
.uptime.error { color: #B91C1C }

.icon-btn {
  width: 26px;
  height: 26px;
  border: none;
  background: transparent;
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #6B7280;
  margin-left: 2px;
}
.icon-btn:hover { background: #F3F4F6; color: #111827 }
.icon-btn svg { width: 14px; height: 14px }

.empty-row { padding: 32px 16px }
.empty-msg {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: #9CA3AF;
  font-size: 13px;
}
</style>
