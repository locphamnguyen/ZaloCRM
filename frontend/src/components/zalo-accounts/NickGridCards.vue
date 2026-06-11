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

    <div v-else class="ngc-grid">
      <div
        v-for="a in accounts"
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
  </div>
</template>

<script setup lang="ts">
interface Crew { id: string; fullName: string | null }

// accounts: EnrichedAccount[] từ parent — component chỉ đọc field hiển thị (type lỏng).
const props = defineProps<{ accounts: any[]; reconnectingIds?: Set<string> }>();
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
