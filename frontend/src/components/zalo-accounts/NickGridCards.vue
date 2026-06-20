<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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
        <!-- ── MẪU A (2026-06-16): gọn dọc, viền trái màu trạng thái, 1 nút trạng thái ở đáy ── -->
        <!-- Hàng 1: avatar + tên + SĐT -->
        <div class="ngc-head">
          <img v-if="a.avatarUrl" :src="a.avatarUrl" class="ngc-avatar" alt="" />
          <div v-else class="ngc-avatar ngc-avatar-ph">{{ initials(a.displayName) }}</div>
          <div class="ngc-id">
            <div class="ngc-name">{{ a.displayName || 'Chưa đặt tên' }}</div>
            <div class="ngc-phone">{{ a.phone || '— chưa có SĐT' }}</div>
          </div>
          <!-- Xóa nick: CHỈ owner/admin + nick ĐÃ NGẮT (không cho xóa nick đang online — chống tai nạn) -->
          <button
            v-if="a.canManage && !isOnline(a)"
            class="ngc-x"
            title="Xóa nick này khỏi CRM"
            @click.stop="$emit('delete', a)"
          ><v-icon size="15">mdi-trash-can-outline</v-icon></button>
        </div>

        <!-- Hàng 2: phụ trách (online) HOẶC trạng thái mất kết nối (offline) -->
        <div
          v-if="!isOnline(a) && a.disconnectReason"
          class="ngc-disc"
          :class="a.disconnectReason === 'manual' ? 'manual' : 'passive'"
        >
          <v-icon size="13">{{ a.disconnectReason === 'manual' ? 'mdi-link-off' : 'mdi-alert-circle-outline' }}</v-icon>
          <span v-if="a.disconnectReason === 'manual'">Đã ngắt lúc {{ fmtDiscTime(a.disconnectedAt) }}</span>
          <span v-else>Mất kết nối {{ discElapsed(a.disconnectedAt) }}</span>
        </div>
        <div v-else class="ngc-sub">Phụ trách: <b>{{ a.owner?.fullName || '—' }}</b></div>

        <!-- Hàng 3: 1 NÚT TRẠNG THÁI (Anh chốt) -->
        <!--   online  → xanh "Đang kết nối", HOVER → đỏ "Ngắt kết nối"
               offline → xanh-nhạt "Kết nối lại" (qr_pending/manual → quét QR; passive → reconnect ngầm) -->
        <button
          v-if="a.canManage && isOnline(a)"
          class="ngc-statebtn on"
          title="Đang kết nối — bấm để Ngắt kết nối"
          @click.stop="$emit('disconnect', a)"
        >
          <span class="ngc-dot"></span>
          <span class="lbl-on">Đang kết nối</span>
          <span class="lbl-hover"><v-icon size="15">mdi-link-off</v-icon> Ngắt kết nối</span>
        </button>
        <button
          v-else-if="a.canManage"
          class="ngc-statebtn off"
          :disabled="isReconnecting(a.id)"
          @click.stop="$emit('reconnect', a)"
        >
          <v-icon size="15" :class="{ 'ngc-spin': isReconnecting(a.id) }">{{ isReconnecting(a.id) ? 'mdi-loading' : reconnectIcon(a) }}</v-icon>
          {{ isReconnecting(a.id) ? 'Đang kết nối…' : reconnectLabel(a) }}
        </button>
        <!-- Sale không quản lý nick → chỉ xem trạng thái, không nút -->
        <div v-else class="ngc-statebtn readonly" :class="isOnline(a) ? 'on' : 'off'">
          <span class="ngc-dot"></span>{{ stateLabel(a) }}
        </div>
      </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';

// 2026-06-16: đồng hồ tick 1s để đếm "mất kết nối X phút Y giây" tăng real-time (passive).
// FE tự đếm từ mốc disconnectedAt BE lưu — không gọi API liên tục.
const nowMs = ref(Date.now());
let discTimer: ReturnType<typeof setInterval> | null = null;
onMounted(() => { discTimer = setInterval(() => { nowMs.value = Date.now(); }, 1000); });
onUnmounted(() => { if (discTimer) clearInterval(discTimer); });

// Ngắt thủ công: hiện mốc cố định "dd/MM HH:mm" (giờ VN).
function fmtDiscTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
}
// Mất kết nối thụ động: đếm thời gian đã trôi từ disconnectedAt → "X phút Y giây" / "Xh Ym" / "Nd".
function discElapsed(iso: string | null): string {
  if (!iso) return '';
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return '';
  let sec = Math.max(0, Math.floor((nowMs.value - start) / 1000));
  if (sec < 60) return `${sec} giây`;
  if (sec < 3600) { const m = Math.floor(sec / 60); return `${m} phút ${sec % 60} giây`; }
  if (sec < 86400) { const h = Math.floor(sec / 3600); return `${h} giờ ${Math.floor((sec % 3600) / 60)} phút`; }
  const d = Math.floor(sec / 86400); return `${d} ngày ${Math.floor((sec % 86400) / 3600)} giờ`;
}

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
// (Mẫu A 2026-06-16 bỏ dòng "Hỗ trợ" cho gọn → helper crewOf không còn dùng.)

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

/* Mẫu A (2026-06-16): card gọn → 4 nick/hàng từ HD 1366. minmax 210 để màn nhỏ tự co. */
.ngc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 12px; }
@media (min-width: 1280px) { .ngc-grid { grid-template-columns: repeat(4, 1fr); } }
@media (min-width: 1920px) { .ngc-grid { grid-template-columns: repeat(5, 1fr); } }

.ngc-card {
  background: var(--surface, #fff);
  border: 1px solid var(--line, #e7eaf0);
  border-left: 3px solid var(--line, #e7eaf0); /* viền trái = màu trạng thái (Mẫu A) */
  border-radius: 12px;
  padding: 13px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 9px;
  transition: box-shadow .12s, transform .12s;
}
.ngc-card:hover { box-shadow: 0 4px 14px rgba(20,26,36,.1); transform: translateY(-1px); }
/* Mẫu A — chỉ VIỀN TRÁI đổi màu theo trạng thái (gọn, không viền dày cả thẻ) */
.ngc-card.is-online  { border-left-color: #12b76a; }
.ngc-card.is-offline { border-left-color: #dc2626; }
.ngc-card.is-pending { border-left-color: #f5a524; }

/* Hàng 1: avatar + tên + SĐT + nút xóa */
.ngc-head { display: flex; align-items: center; gap: 10px; }
.ngc-avatar { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; }
.ngc-avatar-ph { display: flex; align-items: center; justify-content: center; background: var(--brand-soft, #e6f3fb); color: var(--brand-700, #0f6ea3); font-weight: 700; font-size: 15px; }
.ngc-id { min-width: 0; flex: 1; }
.ngc-name { font-size: 14px; font-weight: 600; color: var(--ink, #141a24); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ngc-phone { font-size: 12px; color: var(--ink-3, #6b7280); font-variant-numeric: tabular-nums; }
.ngc-x { border: none; background: none; color: #c0c6d0; cursor: pointer; padding: 3px; border-radius: 6px; flex-shrink: 0; }
.ngc-x:hover { background: #fde8e6; color: #b42318; }

/* Hàng 2: phụ trách / trạng thái mất kết nối */
.ngc-sub { font-size: 11.5px; color: var(--ink-4, #9ca3af); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ngc-sub b { color: var(--ink-2, #475066); font-weight: 500; }
.ngc-disc { display: flex; align-items: center; gap: 5px; font-size: 11.5px; padding: 3px 8px; border-radius: 6px; }
.ngc-disc.manual { background: #f3f4f6; color: #6b7280; }
.ngc-disc.passive { background: #fef2f2; color: #dc2626; font-variant-numeric: tabular-nums; }

/* Hàng 3: 1 nút trạng thái — online xanh (hover→đỏ Ngắt) / offline xanh-nhạt Kết nối lại */
.ngc-statebtn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px; width: 100%;
  border: none; border-radius: 8px; padding: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  min-height: 36px; transition: background .15s, color .15s;
}
.ngc-statebtn.on { background: #e7f7ef; color: #067647; }
.ngc-statebtn.on .lbl-hover { display: none; }
.ngc-statebtn.on:hover { background: #dc2626; color: #fff; }
.ngc-statebtn.on:hover .lbl-on { display: none; }
.ngc-statebtn.on:hover .lbl-hover { display: inline-flex; align-items: center; gap: 5px; }
.ngc-statebtn.off { background: var(--brand-soft, #e4f1f8); color: var(--brand-700, #1786be); }
.ngc-statebtn.off:hover:not(:disabled) { background: var(--brand-700, #1786be); color: #fff; }
.ngc-statebtn:disabled { opacity: .55; cursor: not-allowed; }
.ngc-statebtn.readonly { cursor: default; }
.ngc-statebtn.readonly.off { background: #f3f4f6; color: #6b7280; }
.ngc-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; flex-shrink: 0; }
.ngc-spin { animation: ngc-spin .8s linear infinite; }
@keyframes ngc-spin { to { transform: rotate(360deg); } }
</style>
