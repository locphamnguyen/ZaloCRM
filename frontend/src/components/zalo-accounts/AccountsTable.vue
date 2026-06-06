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
          <th>Sale phụ trách (Owner)</th>
          <th>Phòng ban</th>
          <th>Đội ngũ chia sẻ</th>
          <th class="th-sdk">
            SDK / Giới hạn hôm nay
            <button class="sdk-cfg-btn" title="Cài đặt trần giới hạn SDK" @click.stop="emit('configLimits')">⚙️ Trần</button>
          </th>
          <th title="Tin nhắn GỬI ĐI cho người lạ hôm nay / giới hạn người lạ. Bạn bè + tin nhận KHÔNG tính.">Gửi người lạ</th>
          <th>Hôm nay <span class="th-hint">📥📤🤖🤝🔍</span></th>
          <th>Hoạt động 7d</th>
          <th>Hoạt động cuối</th>
          <th class="th-actions">Action</th>
        </tr>
      </thead>
      <tbody>
        <template v-for="group in rowGroups" :key="group.key">
          <!-- Group header (chỉ hiện khi groupByDept=true) -->
          <tr v-if="groupByDept && group.label" class="group-row">
            <td colspan="10">
              <div class="group-head">
                <span class="group-name">{{ group.label }}</span>
                <span class="group-count">{{ group.accounts.length }} nick</span>
              </div>
            </td>
          </tr>
        <tr
          v-for="acct in group.accounts"
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
              <NickAvatarLock :privacy-mode="(acct as any).privacyMode">
                <div class="avatar" :style="avatarStyle(acct)">
                  {{ initials(acct) }}
                </div>
              </NickAvatarLock>
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
            <!-- Sale phụ trách (chính chủ — ownerUserId). Click → mở reassign drawer nếu canManage. -->
            <div
              v-if="acct.owner"
              class="owner-cell"
              :class="{ clickable: acct.canManage }"
              :title="acct.canManage ? 'Click để chuyển nhượng owner' : ''"
              @click.stop="onOwnerClick(acct)"
            >
              <span class="avatar-mini owner-avatar" :style="{ background: avatarColor(acct.owner.fullName || acct.owner.email, 0) }">
                {{ shortName(acct.owner.fullName || acct.owner.email) }}
              </span>
              <div class="owner-info">
                <div class="owner-name">{{ acct.owner.fullName || acct.owner.email }}</div>
                <div class="owner-tag">
                  <span class="badge-owner">Chính chủ</span>
                  <span v-if="acct.isOwnedByMe" class="badge-self">Bạn</span>
                  <!-- Phase Privacy v2 2026-05-23 — badge nick này là internal contact của ai -->
                  <span
                    v-if="acct.isInternalContactFor"
                    class="badge-internal"
                    :title="`Đang là nick liên lạc nội bộ của ${acct.isInternalContactFor.fullName || acct.isInternalContactFor.id}`"
                  >
                    🏠 Liên lạc nội bộ
                  </span>
                </div>
              </div>
              <svg v-if="acct.canManage" class="owner-edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </div>
            <span v-else class="muted-italic">Chưa có owner</span>
          </td>
          <td>
            <!-- Phòng ban của owner — Phase 4 2026-05-22 -->
            <div v-if="acct.ownerDepartment" class="dept-cell">
              <span class="dept-name">{{ acct.ownerDepartment.name }}</span>
              <span v-if="acct.ownerDeptRole === 'leader'" class="dept-role leader">Trưởng phòng</span>
              <span v-else-if="acct.ownerDeptRole === 'deputy'" class="dept-role deputy">Phó phòng</span>
            </div>
            <span v-else class="muted-italic">—</span>
          </td>
          <td>
            <!-- Đội ngũ chia sẻ (crew không gồm owner) -->
            <div v-if="crewWithoutOwner(acct).length" class="sales-stack">
              <span
                v-for="(c, i) in crewWithoutOwner(acct).slice(0, 3)"
                :key="c.accessId"
                class="avatar-mini"
                :style="{ background: avatarColor((c.user.fullName || c.user.email), i + 1), zIndex: 3 - i }"
                :title="`${c.user.fullName || c.user.email} · Quyền: ${permLabel(c.permission)}`"
              >
                {{ shortName(c.user.fullName || c.user.email) }}
                <span class="perm-dot" :class="`perm-${c.permission}`" :title="permLabel(c.permission)"></span>
              </span>
              <span v-if="crewWithoutOwner(acct).length > 3" class="more">+{{ crewWithoutOwner(acct).length - 3 }}</span>
            </div>
            <span v-else class="muted-italic">—</span>
          </td>
          <!-- 2026-06-06 — Cột SDK ma trận: 4 thanh quota X/cap (đổi màu theo %) -->
          <td class="td-sdk">
            <div class="sdk-grid">
              <div class="sdk-row" title="Tổng lượt gọi SDK hôm nay">
                <span class="sk">⚡ SDK</span>
                <span class="sv">{{ acct.sdkTotal ?? 0 }}</span>
              </div>
              <template v-for="m in [
                  { cat: 'friend_action', ic: '🤝', lb: 'Kết bạn' },
                  { cat: 'friend_lookup', ic: '🔍', lb: 'Tìm SĐT' },
                  { cat: 'contact_sync', ic: '🔄', lb: 'Đồng bộ DB' },
                  { cat: 'message', ic: '💌', lb: 'Tin nhắn' },
                ]" :key="m.cat">
                <div class="sdk-row" :class="sdkBar(acct, m.cat).cls" :title="`${m.lb}: ${sdkBar(acct, m.cat).used}/${sdkBar(acct, m.cat).cap}`">
                  <span class="sk">{{ m.ic }}</span>
                  <span class="sv">{{ sdkBar(acct, m.cat).used }}<small>/{{ sdkBar(acct, m.cat).cap }}</small></span>
                  <div class="sbar"><i :style="{ width: sdkBar(acct, m.cat).pct + '%' }"></i></div>
                </div>
              </template>
            </div>
          </td>
          <td>
            <div class="progress" :class="progressClass(acct.msgToday, acct.quota)">
              <span class="vals">{{ acct.msgToday }}/{{ acct.quota }}</span>
              <div class="bar"><i :style="{ width: progressPct(acct.msgToday, acct.quota) + '%' }"></i></div>
            </div>
          </td>
          <td>
            <!-- Phase Hôm nay redesign 2026-05-28: mini 4-col table.
                 4 metric × 4 col: Loại · Nguồn 1 · Nguồn 2 · Σ.
                 📥 Đến: 👥 bạn / 🕵🏽 lạ. Còn lại: 👤 sale / 🤖 bot.
                 Click row → drawer chi tiết (vẫn giữ qua @click onRowClick). -->
            <div v-if="acct.metricsToday" class="hn-mt">
              <div class="hn-mt-head">
                <div class="h label">Loại</div>
                <div class="h">Nguồn 1</div>
                <div class="h">Nguồn 2</div>
                <div class="h total">Σ</div>
              </div>
              <div class="hn-mt-row" :title="`Đến: ${acct.metricsToday.msgReceivedFromFriends} bạn / ${acct.metricsToday.msgReceivedFromStrangers} lạ`">
                <div class="label"><span class="em">📥</span>Đến</div>
                <div class="friend" :class="{ zero: acct.metricsToday.msgReceivedFromFriends === 0 }"><span class="cell-icon">👥</span>{{ acct.metricsToday.msgReceivedFromFriends }}</div>
                <div class="stranger" :class="{ zero: acct.metricsToday.msgReceivedFromStrangers === 0 }"><span class="cell-icon">🕵🏽</span>{{ acct.metricsToday.msgReceivedFromStrangers }}</div>
                <div class="total" :class="{ zero: acct.metricsToday.msgReceivedTotal === 0 }">{{ acct.metricsToday.msgReceivedTotal }}</div>
              </div>
              <div class="hn-mt-row" :title="`Đi: ${acct.metricsToday.msgSentByUser} sale / ${acct.metricsToday.msgSentByBot} bot`">
                <div class="label"><span class="em">📤</span>Đi</div>
                <div class="user" :class="{ zero: acct.metricsToday.msgSentByUser === 0 }"><span class="cell-icon">👤</span>{{ acct.metricsToday.msgSentByUser }}</div>
                <div class="bot" :class="{ zero: acct.metricsToday.msgSentByBot === 0 }"><span class="cell-icon">🤖</span>{{ acct.metricsToday.msgSentByBot }}</div>
                <div class="total" :class="{ zero: acct.metricsToday.msgSentTotal === 0 }">{{ acct.metricsToday.msgSentTotal }}</div>
              </div>
              <div class="hn-mt-row" :title="`Kết bạn: ${acct.metricsToday.friendReqByUser} thủ công / ${acct.metricsToday.friendReqByBot} auto`">
                <div class="label"><span class="em">🤝</span>Kết bạn</div>
                <div class="user" :class="{ zero: acct.metricsToday.friendReqByUser === 0 }"><span class="cell-icon">👤</span>{{ acct.metricsToday.friendReqByUser }}</div>
                <div class="bot" :class="{ zero: acct.metricsToday.friendReqByBot === 0 }"><span class="cell-icon">🤖</span>{{ acct.metricsToday.friendReqByBot }}</div>
                <div class="total" :class="{ zero: acct.metricsToday.friendReqSent === 0 }">{{ acct.metricsToday.friendReqSent }}</div>
              </div>
              <div class="hn-mt-row" :title="`Tìm KH: ${acct.metricsToday.phoneSearchByUser} thủ công / ${acct.metricsToday.phoneSearchByBot} auto`">
                <div class="label"><span class="em">🔍</span>Tìm KH</div>
                <div class="user" :class="{ zero: acct.metricsToday.phoneSearchByUser === 0 }"><span class="cell-icon">👤</span>{{ acct.metricsToday.phoneSearchByUser }}</div>
                <div class="bot" :class="{ zero: acct.metricsToday.phoneSearchByBot === 0 }"><span class="cell-icon">🤖</span>{{ acct.metricsToday.phoneSearchByBot }}</div>
                <div class="total" :class="{ zero: acct.metricsToday.phoneSearchTotal === 0 }">{{ acct.metricsToday.phoneSearchTotal }}</div>
              </div>
            </div>
            <span v-else class="muted-italic">—</span>
          </td>
          <td>
            <!-- "Hoạt động 7d" = % ngày có message trong 7 ngày qua (không phải uptime kết nối) -->
            <span class="uptime" :class="uptimeColor(acct.uptime7d)" :title="`${acct.uptime7d}% (số ngày có message trong 7 ngày)`">
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
            <!-- Actions gate theo canManage (owner-of-nick hoặc org admin) — anh chốt 2026-05-22 -->
            <template v-if="acct.canManage">
              <button class="icon-btn" :title="acct.liveStatus === 'connected' ? 'Sync' : 'Re-login'" @click="onActionClick(acct, 'reconnect')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
              </button>
              <button class="icon-btn" title="Sync danh bạ" @click="onActionClick(acct, 'sync')">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
              </button>
              <button class="icon-btn" title="Mở chi tiết" @click="$emit('open-detail', acct.id)">
                <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
              </button>
            </template>
            <template v-else>
              <button class="icon-btn" title="Xem chi tiết (chỉ đọc — không phải chính chủ)" @click="$emit('open-detail', acct.id)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              </button>
              <span class="readonly-badge" title="Bạn không phải chính chủ nick này — chỉ xem được">🔒</span>
            </template>
          </td>
        </tr>
        </template>
        <tr v-if="!accounts.length">
          <td colspan="10" class="empty-row">
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
import NickAvatarLock from '@/components/privacy/NickAvatarLock.vue';

const props = defineProps<{
  accounts: EnrichedAccount[];
  uptimeCache: Record<string, UptimeBucket[]>;
  groupByDept?: boolean;
  isSelected: (id: string) => boolean;
  toggleSelect: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clearSelection: () => void;
  relativeTime: (iso: string | null) => string;
  statusLabel: (live: string) => { label: string; color: string };
  uptimeColor: (uptime: number) => 'success' | 'warning' | 'error';
  // 2026-06-06 — trần hiệu lực per-nick (đã gộp nick override + org default ở composable).
  //   limitFor(nickId, category) → daily limit để vẽ thanh quota X/cap.
  limitFor?: (nickId: string, category: string) => number;
}>();

// Thanh quota SDK: trả { pct, cls, used, cap } cho 1 nick + category.
function sdkBar(acct: EnrichedAccount, category: string): { used: number; cap: number; pct: number; cls: string } {
  const used = acct.sdkCounts?.[category] ?? 0;
  const cap = props.limitFor ? props.limitFor(acct.id, category) : 0;
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const cls = pct >= 100 ? 'q-crit' : pct >= 70 ? 'q-warn' : 'q-ok';
  return { used, cap, pct, cls };
}

const emit = defineEmits<{
  (e: 'open-detail', id: string): void;
  (e: 'action', payload: { account: EnrichedAccount; action: 'reconnect' | 'sync' }): void;
  (e: 'reassign-owner', account: EnrichedAccount): void;
  // 2026-06-06 — mở dialog cài đặt trần SDK (org default + nick override).
  (e: 'configLimits'): void;
}>();

// Phase 4 2026-05-22: group rows theo phòng ban khi groupByDept=true.
// Return 1 group "all" khi flag tắt, hoặc list groups theo department name khi bật.
const rowGroups = computed(() => {
  if (!props.groupByDept) {
    return [{ key: 'all', label: '', accounts: props.accounts }];
  }
  const map = new Map<string, { key: string; label: string; accounts: EnrichedAccount[] }>();
  for (const a of props.accounts) {
    const deptKey = a.ownerDepartment?.id ?? '__no_dept__';
    const deptLabel = a.ownerDepartment?.name ?? 'Chưa thuộc phòng ban';
    if (!map.has(deptKey)) {
      map.set(deptKey, { key: deptKey, label: deptLabel, accounts: [] });
    }
    map.get(deptKey)!.accounts.push(a);
  }
  // Sort: "Chưa thuộc phòng ban" cuối cùng
  return Array.from(map.values()).sort((a, b) => {
    if (a.key === '__no_dept__') return 1;
    if (b.key === '__no_dept__') return -1;
    return a.label.localeCompare(b.label);
  });
});

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

function onOwnerClick(account: EnrichedAccount) {
  // Chỉ owner-of-nick HOẶC org admin được reassign. BE cũng gate, FE chỉ skip UX noise.
  if (!account.canManage) return;
  emit('reassign-owner', account);
}

function statusClass(live: string): string {
  if (live === 'connected') return 'ok';
  if (live === 'connecting' || live === 'qr_pending') return 'warn';
  return 'err';
}

function crewWithoutOwner(a: EnrichedAccount) {
  if (!a.ownerUserId) return a.crew;
  return a.crew.filter((c) => c.user.id !== a.ownerUserId);
}

function permLabel(perm: string): string {
  if (perm === 'admin') return 'Quản trị';
  if (perm === 'chat') return 'Chat (đọc + gửi)';
  if (perm === 'read') return 'Chỉ đọc';
  return perm;
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

/* 2026-06-06 — cột SDK ma trận */
.th-sdk { white-space: nowrap; }
.sdk-cfg-btn {
  margin-left: 8px; border: 1px solid #d1d5db; background: #fff; border-radius: 6px;
  padding: 2px 8px; font-size: 11px; font-weight: 600; color: #2563eb; cursor: pointer;
}
.sdk-cfg-btn:hover { background: #eff6ff; }
.td-sdk { min-width: 160px; }
.sdk-grid { display: flex; flex-direction: column; gap: 3px; }
.sdk-row { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: 5px; font-size: 11px; color: #4b5563; position: relative; }
.sdk-row .sk { color: #6b7280; white-space: nowrap; }
.sdk-row .sv { font-weight: 700; font-variant-numeric: tabular-nums; }
.sdk-row .sv small { font-weight: 500; color: #9ca3af; }
.sdk-row .sbar { grid-column: 1 / -1; height: 3px; background: #f3f4f6; border-radius: 99px; overflow: hidden; margin-top: 1px; }
.sdk-row .sbar > i { display: block; height: 100%; border-radius: 99px; background: #2563eb; }
.sdk-row.q-warn .sbar > i { background: #f59e0b; }
.sdk-row.q-warn .sv { color: #d97706; }
.sdk-row.q-crit .sbar > i { background: #ef4444; }
.sdk-row.q-crit .sv { color: #dc2626; }

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

/* Owner cell (chính chủ) — Phase 4 clickable */
.owner-cell {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border-radius: 6px; margin: -4px -6px;
  transition: background 0.1s;
}
.owner-cell.clickable { cursor: pointer; }
.owner-cell.clickable:hover { background: #EEF0FF; }
.owner-cell.clickable:hover .owner-edit-icon { opacity: 1; }
.owner-edit-icon { color: #5E6AD2; opacity: 0; transition: opacity 0.15s; flex-shrink: 0; }
.owner-avatar { margin-left: 0 !important; flex-shrink: 0; }

/* Department cell — Phase 4 2026-05-22 */
.dept-cell { display: inline-flex; flex-direction: column; gap: 3px; }
.dept-name { font-size: 12px; font-weight: 600; color: #1F2937; }
.dept-role {
  font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 9999px;
  text-transform: uppercase; letter-spacing: 0.3px; width: max-content;
}
.dept-role.leader { background: #DBEAFE; color: #1D4ED8; }
.dept-role.deputy { background: #FEF3C7; color: #92400E; }

/* Phase metrics layer 2026-05-22 — cột "Hôm nay" mini-chips */
.th-hint { font-weight: 400; color: #9CA3AF; font-size: 11px; margin-left: 4px; letter-spacing: 1px; }
/* ═══════════ Phase Hôm nay redesign 2026-05-28 — mini 4-col table (HD-first 1280×720) ═══════════ */
.hn-mt {
  border: 1px solid #F3F4F6;
  border-radius: 5px;
  overflow: hidden;
  display: grid;
  grid-template-columns: 1.2fr 0.95fr 0.95fr 0.7fr;
  font-variant-numeric: tabular-nums;
  min-width: 188px;
  max-width: 240px;
}
.hn-mt-head { display: contents; }
.hn-mt-head .h {
  background: #F9FAFB;
  padding: 3px 4px;
  font-size: 9px;
  font-weight: 600;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-bottom: 1px solid #F3F4F6;
  line-height: 1.2;
}
.hn-mt-head .h.label { justify-content: flex-start; padding-left: 6px; }
.hn-mt-head .h.total { background: rgba(41, 98, 255, 0.08); color: #2962FF; }

.hn-mt-row { display: contents; cursor: help; }
.hn-mt-row > div {
  padding: 3px 4px;
  border-bottom: 1px solid #F3F4F6;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  font-size: 11px;
  font-weight: 600;
  color: #1F2937;
  line-height: 1.2;
}
.hn-mt-row > div.label {
  background: #F9FAFB;
  font-size: 10px;
  color: #374151;
  font-weight: 500;
  justify-content: flex-start;
  padding-left: 6px;
  gap: 4px;
}
.hn-mt-row > div.label .em { font-size: 11px; }
.hn-mt-row > div.total {
  background: rgba(41, 98, 255, 0.04);
  color: #2962FF;
  font-weight: 700;
  font-size: 11.5px;
}
.hn-mt-row > div.user { color: #2962FF; background: rgba(41, 98, 255, 0.06); }
.hn-mt-row > div.bot { color: #F59E0B; background: rgba(245, 158, 11, 0.08); }
.hn-mt-row > div.friend { color: #047857; background: rgba(16, 185, 129, 0.06); }
.hn-mt-row > div.stranger { color: #B45309; background: rgba(245, 158, 11, 0.06); }
.hn-mt-row > div.zero { color: #D1D5DB; font-weight: 400; }
.hn-mt-row > div .cell-icon { opacity: 0.75; font-size: 10px; line-height: 1; }
.hn-mt-row:last-of-type > div { border-bottom: 0; }

/* Group row (groupByDept=true) */
.group-row td {
  background: #F9FAFB !important;
  border-bottom: 1px solid #E5E7EB;
  padding: 8px 14px !important;
}
.group-head { display: flex; align-items: center; gap: 10px; }
.group-name {
  font-size: 12px; font-weight: 700; color: #374151;
  text-transform: uppercase; letter-spacing: 0.04em;
}
.group-count {
  font-size: 10.5px; color: #6B7280;
  background: #E5E7EB; padding: 2px 8px; border-radius: 9999px; font-weight: 600;
}

.owner-info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.owner-name {
  font-size: 12px;
  font-weight: 600;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 140px;
}
.owner-tag { display: flex; gap: 4px; align-items: center; }
.badge-owner {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 9999px;
  background: #FDF3DF;
  color: #7A5818;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.badge-self {
  font-size: 9px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 9999px;
  background: #181D26;
  color: white;
}
/* Phase Privacy v2 2026-05-23 — nick là internal contact */
.badge-internal {
  font-size: 9px; font-weight: 700;
  padding: 1px 7px; border-radius: 9999px;
  background: #FEF3C7; color: #92400E;
  letter-spacing: 0.2px;
  white-space: nowrap;
}

/* Permission dot on crew avatar */
.avatar-mini { position: relative; }
.perm-dot {
  position: absolute;
  bottom: -2px;
  right: -2px;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1.5px solid white;
}
.perm-admin { background: #aa2d00; }
.perm-chat { background: #1b61c9; }
.perm-read { background: #9CA3AF; }

/* Readonly badge khi không có canManage */
.readonly-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  font-size: 13px;
  color: #9CA3AF;
  margin-left: 2px;
}

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
