<!--
  NickGridCards — tab "Đơn giản" cho Sale (Anh chốt 2026-06-09 CEO review).
  Grid card gọn: SĐT, Tên nick, Trạng thái (TO + viền xanh/đỏ), Owner, Sale hỗ trợ.
  Mục tiêu: sale dễ thấy nick live/disconnect → reconnect 1 chạm. Sale thường ≤5 nick.
  Viền XANH=online, ĐỎ=disconnect/qr_pending, VÀNG=đang kết nối (trung gian).
-->
<template>
  <div class="ngc">
    <div v-if="!accounts.length" class="ngc-empty">
      <v-icon size="42" color="grey">mdi-cellphone-link-off</v-icon>
      <p>Bạn chưa kết nối nick Zalo nào</p>
      <button class="btn btn-primary" @click="$emit('add')">
        <v-icon size="16">mdi-plus</v-icon> Kết nối nick đầu tiên
      </button>
    </div>

    <!-- Nhóm theo trạng thái nick (2026-06-10) -->
    <div v-else class="ngc-groups">
      <section v-for="g in groups" :key="g.key" class="ngc-group">
        <!-- Header nhóm: theo trạng thái (icon màu) hoặc theo user (avatar + vai trò) -->
        <header v-if="g.kind === 'owner'" class="ngc-group-head gh-owner">
          <span class="ngc-owner-av">{{ initials(g.label) }}</span>
          <span class="ngc-group-label">{{ g.label }}</span>
          <span class="ngc-group-count">{{ g.items.length }}</span>
          <span class="ngc-owner-role">{{ ownerRole(g.owner) }}</span>
        </header>
        <header v-else class="ngc-group-head" :class="`gh-${g.key}`">
          <v-icon size="16">{{ g.icon }}</v-icon>
          <span class="ngc-group-label">{{ g.label }}</span>
          <span class="ngc-group-count">{{ g.items.length }}</span>
        </header>
        <div class="ngc-grid">
      <div
        v-for="a in g.items"
        :key="a.id"
        class="ngc-card"
        :class="stateClass(a)"
        @click="$emit('open-detail', a.id)"
      >
        <!-- Trạng thái nổi bật góc trên -->
        <div class="ngc-top">
          <span class="ngc-status" :class="stateClass(a)">
            <span class="ngc-dot"></span>{{ stateLabel(a) }}
          </span>
          <button
            v-if="a.canManage"
            class="ngc-x"
            title="Xóa nick khỏi danh sách"
            @click.stop="$emit('delete', a)"
          ><v-icon size="15">mdi-trash-can-outline</v-icon></button>
        </div>

        <!-- Avatar + tên + SĐT -->
        <div class="ngc-head">
          <img v-if="a.avatarUrl" :src="a.avatarUrl" class="ngc-avatar" alt="" />
          <div v-else class="ngc-avatar ngc-avatar-ph">{{ initials(a.displayName) }}</div>
          <div class="ngc-id">
            <div class="ngc-name">{{ a.displayName || 'Chưa đặt tên' }}</div>
            <div class="ngc-phone">{{ a.phone || '— chưa có SĐT' }}</div>
          </div>
        </div>

        <!-- Owner + Sale hỗ trợ -->
        <div class="ngc-meta">
          <div class="ngc-row">
            <span class="ngc-lbl">Phụ trách:</span>
            <span class="ngc-val">{{ a.owner?.fullName || '—' }}</span>
          </div>
          <div class="ngc-row" v-if="crewOf(a).length">
            <span class="ngc-lbl">Hỗ trợ:</span>
            <span class="ngc-crew">
              <span v-for="c in crewOf(a).slice(0, 3)" :key="c.id" class="ngc-crew-chip" :title="c.fullName || ''">
                {{ initials(c.fullName) }}
              </span>
              <span v-if="crewOf(a).length > 3" class="ngc-crew-more">+{{ crewOf(a).length - 3 }}</span>
            </span>
          </div>
        </div>

        <!-- Hàng nút: Kết nối lại + Ngắt kết nối — luôn hiện (xám khi không dùng được) -->
        <div v-if="a.canManage" class="ngc-actions">
          <!-- Kết nối lại: xám khi nick đang online hoặc đang kết nối -->
          <button
            class="ngc-reconnect"
            :disabled="isOnline(a) || isReconnecting(a.id)"
            @click.stop="$emit('reconnect', a)"
          >
            <v-icon size="16" :class="{ 'ngc-spin': isReconnecting(a.id) }">{{ isReconnecting(a.id) ? 'mdi-loading' : reconnectIcon(a) }}</v-icon>
            {{ isReconnecting(a.id) ? 'Đang kết nối…' : reconnectLabel(a) }}
          </button>
          <!-- Ngắt kết nối: xám khi nick KHÔNG online -->
          <button
            class="ngc-disconnect"
            :disabled="!isOnline(a)"
            @click.stop="$emit('disconnect', a)"
          >
            <v-icon size="16">mdi-link-off</v-icon>
            Ngắt kết nối
          </button>
        </div>
      </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
interface Crew { id: string; fullName: string | null }

// accounts: EnrichedAccount[] từ parent — component chỉ đọc field hiển thị (type lỏng).
// groupBy: 'status' (mặc định, nhóm theo trạng thái) | 'owner' (mục 1 2026-06-11, nhóm theo người dùng).
const props = defineProps<{ accounts: any[]; reconnectingIds?: Set<string>; groupBy?: 'status' | 'owner' }>();
function isReconnecting(id: string): boolean {
  return props.reconnectingIds?.has(id) ?? false;
}
defineEmits<{
  reconnect: [account: any];
  disconnect: [account: any];
  delete: [account: any];
  'open-detail': [accountId: string];
  add: [];
}>();

function liveOf(a: any): string {
  return (a.liveStatus || a.status || 'disconnected').toLowerCase();
}
function isOnline(a: any): boolean {
  return liveOf(a) === 'connected';
}
// Viền + chip: xanh=online, vàng=trung gian (connecting/qr_pending), đỏ=disconnect/error.
function stateClass(a: any): string {
  const s = liveOf(a);
  if (s === 'connected') return 'is-online';
  if (s === 'connecting' || s === 'qr_pending') return 'is-pending';
  return 'is-offline';
}
function stateLabel(a: any): string {
  const s = liveOf(a);
  if (s === 'connected') return 'Đang kết nối';
  if (s === 'connecting') return 'Đang kết nối lại…';
  if (s === 'qr_pending') return 'Chờ quét QR';
  return 'Mất kết nối';
}
// Nhãn nút theo trạng thái: qr_pending (session hết hạn / breaker) → quét QR lại;
// còn lại (disconnected) → reconnect ngầm bằng session đã lưu.
function reconnectLabel(a: any): string {
  return liveOf(a) === 'qr_pending' ? 'Quét QR lại' : 'Kết nối lại';
}
function reconnectIcon(a: any): string {
  return liveOf(a) === 'qr_pending' ? 'mdi-qrcode-scan' : 'mdi-refresh';
}
function crewOf(a: any): Crew[] {
  return (a.crew || []).filter((c: Crew) => !!c);
}

// 2026-06-10 (anh chốt): nhóm card theo TRẠNG THÁI nick. Thứ tự ưu tiên:
// online (quan trọng nhất, lên đầu) → pending (đang xử lý) → offline (cần re-login).
const STATE_GROUPS = [
  { key: 'online',  label: 'Đang hoạt động', icon: 'mdi-check-circle',     match: (a: any) => stateClass(a) === 'is-online' },
  { key: 'pending', label: 'Đang kết nối',    icon: 'mdi-progress-clock',   match: (a: any) => stateClass(a) === 'is-pending' },
  { key: 'offline', label: 'Mất kết nối',     icon: 'mdi-alert-circle-outline', match: (a: any) => stateClass(a) === 'is-offline' },
] as const;

const statusGroups = computed(() =>
  STATE_GROUPS
    .map((g) => ({ key: g.key, label: g.label, icon: g.icon, kind: 'status' as const, owner: null as any, items: props.accounts.filter(g.match) }))
    .filter((g) => g.items.length > 0),
);

// Mục 1 (2026-06-11) — nhóm theo người dùng (owner). Header = avatar + tên sale + vai trò.
const ownerGroups = computed(() => {
  type OwnerGroup = { key: string; label: string; owner: any; items: any[] };
  const map = new Map<string, OwnerGroup>();
  for (const a of props.accounts) {
    const oid = a.ownerUserId ?? a.owner?.id ?? 'unknown';
    const g: OwnerGroup = map.get(oid) ?? {
      key: oid,
      label: a.owner?.fullName || a.owner?.email || 'Chưa gán chủ',
      owner: a.owner ?? null,
      items: [],
    };
    g.items.push(a);
    map.set(oid, g);
  }
  return Array.from(map.values())
    .map((g) => ({ ...g, kind: 'owner' as const, icon: '' }))
    .sort((x, y) => x.label.localeCompare(y.label));
});

const groups = computed(() => (props.groupBy === 'owner' ? ownerGroups.value : statusGroups.value));

// Vai trò sale hiển thị ở header nhóm owner.
function ownerRole(owner: any): string {
  const dm = owner?.departmentMember;
  const r = dm?.deptRole;
  if (r === 'leader') return 'Trưởng phòng';
  if (r === 'deputy') return 'Phó phòng';
  return 'Nhân viên';
}
function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1]?.[0] || '?').toUpperCase();
}
</script>

<style scoped>
.ngc { padding: 4px 0; }
.ngc-empty { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 56px; color: var(--ink-3, #6b7280); }
.ngc-empty p { font-style: italic; }

/* Nhóm theo trạng thái (2026-06-10) */
.ngc-groups { display: flex; flex-direction: column; gap: 22px; }
.ngc-group-head {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px; font-weight: 700; color: #475569;
  padding: 4px 2px 10px; margin-bottom: 2px;
  border-bottom: 1px solid #e5e7eb;
}
.ngc-group-count {
  margin-left: 2px; min-width: 20px; text-align: center;
  background: #f1f5f9; color: #64748b; border-radius: 10px;
  font-size: 11.5px; padding: 1px 7px;
}
.ngc-group-head.gh-online  { color: #15803d; } .gh-online .ngc-group-count  { background: #dcfce7; color: #15803d; }
.ngc-group-head.gh-pending { color: #b45309; } .gh-pending .ngc-group-count { background: #fef3c7; color: #b45309; }
.ngc-group-head.gh-offline { color: #b91c1c; } .gh-offline .ngc-group-count { background: #fee2e2; color: #b91c1c; }

/* Mục 1 — header nhóm theo người dùng (atlas v2) */
.ngc-group-head.gh-owner { color: #334155; }
.gh-owner .ngc-group-count { background: #eef0ff; color: #5e6ad2; }
.ngc-owner-av {
  width: 26px; height: 26px; border-radius: 50%;
  background: linear-gradient(135deg, #5e6ad2, #7c8af0); color: #fff;
  font-weight: 700; font-size: 11px; display: inline-flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.ngc-owner-role {
  margin-left: 6px; font-size: 11.5px; font-weight: 600; color: #94a3b8;
  background: #f1f5f9; padding: 2px 8px; border-radius: 6px;
}

.ngc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 14px; }
@media (min-width: 1366px) { .ngc-grid { grid-template-columns: repeat(3, 1fr); } }

.ngc-card {
  background: var(--surface, #fff);
  border: 2px solid var(--line, #e7eaf0);
  border-radius: 14px;
  padding: 13px 14px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: box-shadow .12s, transform .12s;
}
.ngc-card:hover { box-shadow: 0 4px 14px rgba(20,26,36,.1); transform: translateY(-1px); }
/* Viền theo trạng thái — TO + rõ */
.ngc-card.is-online  { border-color: #12b76a; }
.ngc-card.is-offline { border-color: #f04438; }
.ngc-card.is-pending { border-color: #f5a524; }

.ngc-top { display: flex; align-items: center; justify-content: space-between; }
.ngc-status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; padding: 3px 10px; border-radius: 999px; }
.ngc-status.is-online  { background: #e6f7ef; color: #047857; }
.ngc-status.is-offline { background: #fde8e6; color: #b42318; }
.ngc-status.is-pending { background: #fef4e6; color: #b45309; }
.ngc-dot { width: 9px; height: 9px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px rgba(0,0,0,.04); }
.ngc-x { border: none; background: none; color: #9ca3af; cursor: pointer; padding: 2px; border-radius: 6px; }
.ngc-x:hover { background: #fde8e6; color: #b42318; }

.ngc-head { display: flex; align-items: center; gap: 10px; }
.ngc-avatar { width: 44px; height: 44px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.ngc-avatar-ph { display: flex; align-items: center; justify-content: center; background: var(--brand-soft, #e6f3fb); color: var(--brand-700, #0f6ea3); font-weight: 700; font-size: 16px; }
.ngc-id { min-width: 0; }
.ngc-name { font-size: 15px; font-weight: 600; color: var(--ink, #141a24); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ngc-phone { font-size: 13px; color: var(--ink-3, #6b7280); font-variant-numeric: tabular-nums; }

.ngc-meta { display: flex; flex-direction: column; gap: 4px; }
.ngc-row { display: flex; align-items: center; gap: 6px; font-size: 12.5px; }
.ngc-lbl { color: var(--ink-4, #9ca3af); min-width: 58px; }
.ngc-val { color: var(--ink-2, #374151); font-weight: 500; }
.ngc-crew { display: inline-flex; gap: 3px; }
.ngc-crew-chip { width: 22px; height: 22px; border-radius: 50%; background: #eef2f7; color: #4b5563; font-size: 10.5px; font-weight: 600; display: inline-flex; align-items: center; justify-content: center; }
.ngc-crew-more { font-size: 11px; color: #9ca3af; align-self: center; }

.ngc-actions { display: flex; gap: 8px; margin-top: 2px; }
.ngc-reconnect, .ngc-disconnect {
  flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  padding: 9px; border: none; border-radius: 9px; font-weight: 600; font-size: 13.5px; cursor: pointer;
}
.ngc-reconnect { background: #f04438; color: #fff; }
.ngc-reconnect:hover:not(:disabled) { background: #d92d20; }
/* Ngắt kết nối: style giống .dz-btn (Danger zone drawer) — nền trắng, viền đỏ, chữ đỏ */
.ngc-disconnect { background: #fff; border: 1px solid #FECACA; color: #B91C1C; }
.ngc-disconnect:hover:not(:disabled) { background: #FEF2F2; }
/* Greyed/disabled — khớp main: opacity thấp + not-allowed */
.ngc-reconnect:disabled, .ngc-disconnect:disabled { opacity: .4; cursor: not-allowed; }
.ngc-spin { animation: ngc-spin .8s linear infinite; }
@keyframes ngc-spin { to { transform: rotate(360deg); } }
</style>
