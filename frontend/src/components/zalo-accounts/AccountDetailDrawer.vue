<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="drawer-overlay" :class="{ open: modelValue }" @click.self="close">
    <aside class="drawer" :class="{ open: modelValue }">
      <header class="drawer-head">
        <div class="ttl">Chi tiết nick Zalo</div>
        <button class="close" @click="close" title="Đóng">✕</button>
      </header>

      <div v-if="!account" class="drawer-body empty">
        Đang tải...
      </div>

      <div v-else class="drawer-body">
        <!-- HERO -->
        <div class="hero">
          <div class="avatar" :style="avatarStyle(account)">{{ initials(account) }}</div>
          <div class="meta">
            <div class="nm">{{ account.displayName || 'Nick chưa đặt tên' }}</div>
            <div class="uid" v-if="account.zaloUid">UID {{ account.zaloUid }}</div>
            <!-- SĐT nick (lưu ZaloAccount.phone) — sửa thủ công + verify trùng Zalo/tên. -->
            <div class="phone-line">
              <template v-if="!editingPhone">
                <span v-if="account.phone" class="uid">📱 {{ maskPhone(account.phone) }}</span>
                <span v-else class="uid phone-empty">📱 Chưa có SĐT</span>
                <button class="phone-edit" @click="startEditPhone">{{ account.phone ? 'Sửa' : 'Thêm' }}</button>
              </template>
              <template v-else>
                <input v-model="phoneInput" class="phone-input" placeholder="0xxxxxxxxx" @keydown.enter.prevent="savePhone(false)" />
                <button class="phone-save" :disabled="phoneSaving" @click="savePhone(false)">Lưu</button>
                <button class="phone-cancel" :disabled="phoneSaving" @click="editingPhone = false">Hủy</button>
              </template>
            </div>
            <div class="st">
              <span class="status" :class="statusClass(account.liveStatus)">
                <span class="dot"></span>
                {{ statusLabel(account.liveStatus).label }}
                <span class="rel" v-if="account.lastActivityAt"> · {{ relativeTime(account.lastActivityAt) }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- STATS TRIO -->
        <div class="stats-trio">
          <div class="it">
            <div class="lbl">Msg hôm nay</div>
            <div class="v">{{ account.msgToday }}<small> / {{ account.quota }}</small></div>
          </div>
          <div class="it">
            <div class="lbl">Uptime 7d</div>
            <div class="v" :class="uptimeColor(account.uptime7d)">{{ account.uptime7d }}%</div>
            <UptimeSparkline
              v-if="uptimeCache[account.id]"
              :buckets="uptimeCache[account.id]"
              :color="uptimeColor(account.uptime7d)"
              :width="68"
              :height="18"
            />
          </div>
          <div class="it">
            <div class="lbl">Crew</div>
            <div class="v">{{ account.crewCount }}</div>
            <div class="sub-muted">sale phụ trách</div>
          </div>
        </div>

        <!-- 2026-06-06 — SDK & Giới hạn hôm nay (thanh quota X/cap theo trần) -->
        <section v-if="account" class="d-section">
          <div class="h"><span>⚡ SDK &amp; Giới hạn hôm nay</span></div>
          <div class="sdk-detail">
            <div class="sdk-tot">Tổng lượt gọi SDK: <b>{{ formatNum(account.sdkTotal ?? 0) }}</b></div>
            <div v-for="m in SDK_ROWS" :key="m.cat" class="sdkd-row" :class="sdkClass(m.cat)">
              <div class="sdkd-lbl">{{ m.ic }} {{ m.lb }}</div>
              <div class="sdkd-val">{{ formatNum(sdkUsed(m.cat)) }}<small>/{{ formatNum(sdkCap(m.cat)) }}</small></div>
              <div class="sdkd-bar"><i :style="{ width: sdkPct(m.cat) + '%' }"></i></div>
            </div>
          </div>
        </section>

        <!-- Phase metrics layer 2026-05-22 — Số liệu hôm nay -->
        <section v-if="account.metricsToday" class="d-section">
          <div class="h"><span>📊 Số liệu hôm nay</span></div>

          <!-- Tin nhắn -->
          <div class="metrics-group">
            <div class="metrics-title">Tin nhắn</div>
            <div class="metrics-grid">
              <div class="metric-cell">
                <div class="metric-icon icon-friend">◐</div>
                <div class="metric-info">
                  <div class="metric-label">Nhận từ Bạn bè</div>
                  <div class="metric-value">{{ formatNum(account.metricsToday.msgReceivedFromFriends) }}</div>
                </div>
              </div>
              <div class="metric-cell">
                <div class="metric-icon icon-stranger">◑</div>
                <div class="metric-info">
                  <div class="metric-label">Nhận từ Người lạ</div>
                  <div class="metric-value">{{ formatNum(account.metricsToday.msgReceivedFromStrangers) }}</div>
                </div>
              </div>
              <div class="metric-cell">
                <div class="metric-icon icon-user">▶</div>
                <div class="metric-info">
                  <div class="metric-label">Sale gửi</div>
                  <div class="metric-value">{{ formatNum(account.metricsToday.msgSentByUser) }}</div>
                </div>
              </div>
              <div class="metric-cell">
                <div class="metric-icon icon-bot">◆</div>
                <div class="metric-info">
                  <div class="metric-label">Bot gửi</div>
                  <div class="metric-value">{{ formatNum(account.metricsToday.msgSentByBot) }}</div>
                </div>
              </div>
            </div>
          </div>

          <!-- Friend-add -->
          <div class="metrics-group">
            <div class="metrics-title">Lời mời kết bạn</div>
            <div class="metrics-grid grid-4">
              <div class="metric-cell tight">
                <div class="metric-label">Gửi đi</div>
                <div class="metric-value">{{ formatNum(account.metricsToday.friendReqSent) }}</div>
              </div>
              <div class="metric-cell tight">
                <div class="metric-label" style="color:#047857">Đồng ý</div>
                <div class="metric-value" style="color:#047857">{{ formatNum(account.metricsToday.friendReqAccepted) }}</div>
              </div>
              <div class="metric-cell tight">
                <div class="metric-label" style="color:#B91C1C">Từ chối</div>
                <div class="metric-value" style="color:#B91C1C">{{ formatNum(account.metricsToday.friendReqRejected) }}</div>
              </div>
              <div class="metric-cell tight">
                <div class="metric-label" style="color:#9CA3AF">Tỉ lệ accept</div>
                <div class="metric-value">{{ acceptRate(account.metricsToday) }}%</div>
              </div>
            </div>
          </div>

          <!-- Phone search -->
          <div class="metrics-group">
            <div class="metrics-title">Tìm SĐT trên Zalo</div>
            <div class="metrics-grid grid-3">
              <div class="metric-cell tight">
                <div class="metric-label">Tổng search</div>
                <div class="metric-value">{{ formatNum(account.metricsToday.phoneSearchTotal) }}</div>
              </div>
              <div class="metric-cell tight">
                <div class="metric-label" style="color:#047857">Có Zalo</div>
                <div class="metric-value" style="color:#047857">{{ formatNum(account.metricsToday.phoneSearchFoundZalo) }}</div>
              </div>
              <div class="metric-cell tight">
                <div class="metric-label" style="color:#9CA3AF">Không có</div>
                <div class="metric-value">{{ formatNum(account.metricsToday.phoneSearchNoZalo) }}</div>
              </div>
            </div>
          </div>
        </section>

        <!-- OWNER (chính chủ) — Phase 4 2026-05-22 -->
        <section v-if="account.owner" class="d-section">
          <div class="h">
            <span>Chính chủ (Owner)</span>
            <a v-if="authStore.isOwner" class="link" @click="$emit('reassign-owner', account)">⚙ Chuyển nhượng</a>
          </div>
          <div class="owner-row-detail">
            <div class="avatar-mini" :style="{ background: avatarColor(account.owner.fullName || account.owner.email, 0) }">
              {{ shortName(account.owner.fullName || account.owner.email) }}
            </div>
            <div class="nm-col">
              <div class="nm">{{ account.owner.fullName || account.owner.email }}</div>
              <div class="em">{{ account.owner.email }}</div>
            </div>
            <div class="owner-meta">
              <span v-if="account.ownerDepartment" class="dept-chip">{{ account.ownerDepartment.name }}</span>
              <span v-if="account.ownerDeptRole === 'leader'" class="role-chip leader">Trưởng phòng</span>
              <span v-else-if="account.ownerDeptRole === 'deputy'" class="role-chip deputy">Phó phòng</span>
            </div>
          </div>
        </section>

        <!-- CREW LIST -->
        <section class="d-section">
          <div class="h">
            <span>Đội ngũ chia sẻ ({{ account.crew.length }})</span>
            <a class="link" @click="$emit('add-crew', account.id)">+ Thêm sale</a>
          </div>
          <div v-if="!account.crew.length" class="muted-italic">Chưa gán sale nào</div>
          <div v-for="c in account.crew" :key="c.accessId" class="assign-row">
            <div class="avatar-mini" :style="{ background: avatarColor(c.user.fullName || c.user.email, 0) }">
              {{ shortName(c.user.fullName || c.user.email) }}
            </div>
            <div class="nm-col">
              <div class="nm">{{ c.user.fullName || c.user.email.split('@')[0] }}</div>
              <div class="em">{{ c.user.email }}</div>
            </div>
            <span class="role-badge" :class="c.role">{{ roleLabel(c.role) }}</span>
            <button
              v-if="c.role !== 'owner'"
              class="x"
              title="Bỏ gán"
              @click="$emit('remove-crew', { accountId: account.id, accessId: c.accessId })"
            >✕</button>
          </div>
        </section>

        <!-- ACTIONS -->
        <section class="d-section">
          <div class="h"><span>Hành động</span></div>
          <div class="actions-grid">
            <button class="action-btn" @click="$emit('action', { accountId: account.id, action: 'sync-contacts' })">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
              <span class="lbl">Sync danh bạ</span>
            </button>
            <button class="action-btn" @click="$emit('action', { accountId: account.id, action: 'sync-history' })">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span class="lbl">Sync lịch sử chat</span>
            </button>
            <button
              class="action-btn"
              :disabled="account.liveStatus === 'connected'"
              @click="$emit('action', { accountId: account.id, action: 'reconnect' })"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
              <span class="lbl">Kết nối lại</span>
            </button>
            <button
              class="action-btn"
              :disabled="account.liveStatus === 'connected'"
              @click="$emit('action', { accountId: account.id, action: 'qr-login' })"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              <span class="lbl">Đăng nhập QR</span>
            </button>
            <button class="action-btn full" @click="$emit('action', { accountId: account.id, action: 'edit-proxy' })">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              <span class="lbl">Cấu hình Proxy {{ account.hasProxy ? '(đã cài)' : '(chưa)' }}</span>
            </button>
          </div>
        </section>

        <!-- CẦU TELEGRAM (Zalo ↔ Telegram 2 chiều) -->
        <section v-if="account" class="d-section">
          <div class="h"><span>Cầu Telegram</span></div>

          <div v-if="tgLoading" class="muted-italic">Đang tải trạng thái…</div>

          <template v-else-if="tgStatus">
            <div v-if="!tgStatus.botConfigured" class="muted-italic">
              Chưa cấu hình bot (TELEGRAM_BRIDGE_BOT_TOKEN) — cầu đang tắt ở mức hệ thống.
            </div>

            <template v-else>
              <div class="tg-status">
                <span class="tg-dot" :class="tgStatus.enabled ? 'on' : 'off'"></span>
                <b>{{ tgStatus.enabled ? 'Đang bật' : 'Chưa bật' }}</b>
                <span v-if="tgStatus.telegramChatId" class="tg-chat">· group {{ tgStatus.telegramChatId }}</span>
              </div>

              <div class="actions-grid" style="margin-top:8px">
                <button
                  class="action-btn full"
                  :disabled="tgStatus.enabled || tgProvisioning || !tgStatus.provisionerConfigured || !canEditSettings"
                  @click="provisionBridge"
                >
                  <span class="lbl">{{ tgStatus.enabled ? '✓ Đã bật cầu' : (tgProvisioning ? 'Đang bật…' : 'Bật cầu Telegram') }}</span>
                </button>
                <button class="action-btn full" :disabled="tgLinkLoading" @click="getLinkCode">
                  <span class="lbl">{{ tgLinkLoading ? 'Đang lấy mã…' : 'Lấy mã liên kết (sale)' }}</span>
                </button>
              </div>

              <div v-if="!tgStatus.provisionerConfigured" class="muted-italic" style="margin-top:6px">
                Chưa cấu hình tài khoản provisioner (TELEGRAM_PROVISIONER_*) — không tự tạo group được.
              </div>
              <div v-else-if="!canEditSettings" class="muted-italic" style="margin-top:6px">
                Cần quyền settings:edit để bật cầu.
              </div>

              <div v-if="tgLinkCode" class="tg-code">
                Gõ trong Telegram cho bot: <code>/link {{ tgLinkCode }}</code>
                <div class="tg-code-hint">(mã hết hạn sau 10 phút)</div>
              </div>
            </template>
          </template>

          <div v-if="tgError" class="tg-err">{{ tgError }}</div>
        </section>

        <!-- DANGER ZONE -->
        <section class="d-section">
          <div class="danger-zone">
            <div class="dz-ttl">⚠ Danger zone</div>
            <button
              class="dz-btn"
              :disabled="account.liveStatus !== 'connected'"
              @click="$emit('action', { accountId: account.id, action: 'disconnect' })"
            >
              Ngắt kết nối
            </button>
            <button class="dz-btn" @click="$emit('action', { accountId: account.id, action: 'delete' })">
              Xoá nick khỏi CRM
            </button>
          </div>
        </section>
      </div>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { EnrichedAccount, UptimeBucket } from '@/composables/use-zalo-accounts-dashboard';
import UptimeSparkline from './UptimeSparkline.vue';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

// Fix ③ (2026-06-11): chuyển nhượng nick CHỈ chủ tổ chức (khớp gate BE đã siết role='owner').
const authStore = useAuthStore();
const toast = useToast();
const { confirm } = useConfirm();

// ── Sửa SĐT thủ công (anh hỏi 2026-06-21) ──────────────────────────────────
const editingPhone = ref(false);
const phoneInput = ref('');
const phoneSaving = ref(false);
function startEditPhone() {
  phoneInput.value = props.account?.phone ?? '';
  editingPhone.value = true;
}
async function savePhone(force: boolean) {
  if (!props.account) return;
  phoneSaving.value = true;
  try {
    const { data } = await api.put(`/zalo-accounts/${props.account.id}/phone`, { phone: phoneInput.value, force });
    (props.account as any).phone = phoneInput.value.trim().replace(/[\s.\-()]/g, '') || null;
    editingPhone.value = false;
    toast.push(data?.message || 'Đã lưu SĐT', 'success');
    emit('refresh');
  } catch (e: any) {
    // 409 needsConfirm: SĐT KHÁC tên/uid Zalo (hoặc chưa có Zalo) → hỏi gõ "OK" lưu vẫn.
    if (e.response?.status === 409 && e.response?.data?.needsConfirm) {
      const ok = await confirm({
        title: 'SĐT không khớp Zalo',
        message: (e.response.data.message || '') + ' Vẫn muốn lưu số này cho nick?',
        tone: 'danger',
        requireTypedConfirm: 'OK',
        confirmText: 'Vẫn lưu',
        cancelText: 'Hủy',
      });
      if (ok) await savePhone(true);
    } else {
      toast.push(e.response?.data?.message || 'Lưu SĐT thất bại', 'error');
    }
  } finally {
    phoneSaving.value = false;
  }
}

const props = defineProps<{
  modelValue: boolean;
  account: EnrichedAccount | null;
  uptimeCache: Record<string, UptimeBucket[]>;
  relativeTime: (iso: string | null) => string;
  statusLabel: (live: string) => { label: string; color: string };
  uptimeColor: (uptime: number) => 'success' | 'warning' | 'error';
  // 2026-06-06 — trần hiệu lực để vẽ thanh quota SDK.
  limitFor?: (nickId: string, category: string) => number;
}>();

// 2026-06-06 — SDK quota rows trong panel chi tiết.
const SDK_ROWS = [
  { cat: 'friend_action', ic: '🤝', lb: 'Gửi kết bạn' },
  { cat: 'friend_lookup', ic: '🔍', lb: 'Tìm SĐT → UID' },
  { cat: 'contact_sync', ic: '🔄', lb: 'Đồng bộ danh bạ' },
  { cat: 'message', ic: '💌', lb: 'Gửi tin nhắn' },
  { cat: 'reaction', ic: '❤️', lb: 'Thả cảm xúc' },
  { cat: 'query', ic: '👁️', lb: 'Xem thông tin' },
];
function sdkUsed(cat: string): number { return props.account?.sdkCounts?.[cat] ?? 0; }
function sdkCap(cat: string): number { return props.account && props.limitFor ? props.limitFor(props.account.id, cat) : 0; }
function sdkPct(cat: string): number { const c = sdkCap(cat); return c > 0 ? Math.min(100, Math.round((sdkUsed(cat) / c) * 100)) : 0; }
function sdkClass(cat: string): string { const p = sdkPct(cat); return p >= 100 ? 'q-crit' : p >= 70 ? 'q-warn' : 'q-ok'; }

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'add-crew', accountId: string): void;
  (e: 'remove-crew', payload: { accountId: string; accessId: string }): void;
  (e: 'action', payload: { accountId: string; action: 'sync-contacts' | 'sync-history' | 'reconnect' | 'qr-login' | 'edit-proxy' | 'disconnect' | 'delete' }): void;
  (e: 'reassign-owner', account: EnrichedAccount): void;
  (e: 'refresh'): void;
}>();

function close() {
  emit('update:modelValue', false);
}

// ── Cầu Telegram (Zalo ↔ Telegram 2 chiều) ───────────────────────────────────
interface TgStatus { botConfigured: boolean; provisionerConfigured: boolean; enabled: boolean; telegramChatId: string | null }
const tgStatus = ref<TgStatus | null>(null);
const tgLoading = ref(false);
const tgProvisioning = ref(false);
const tgLinkCode = ref<string | null>(null);
const tgLinkLoading = ref(false);
const tgError = ref<string | null>(null);
const canEditSettings = computed(() => authStore.canAccess('settings', 'edit'));

async function loadTgStatus() {
  if (!props.account) return;
  tgLoading.value = true; tgError.value = null; tgLinkCode.value = null;
  try {
    const { data } = await api.get<TgStatus>(`/telegram-bridge/${props.account.id}/status`);
    tgStatus.value = data;
  } catch {
    tgStatus.value = null;
    tgError.value = 'Không tải được trạng thái cầu Telegram.';
  } finally {
    tgLoading.value = false;
  }
}

async function provisionBridge() {
  if (!props.account || tgProvisioning.value) return;
  tgProvisioning.value = true; tgError.value = null;
  try {
    await api.post(`/telegram-bridge/provision/${props.account.id}`);
    await loadTgStatus();
  } catch (e: unknown) {
    tgError.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Bật cầu thất bại.';
  } finally {
    tgProvisioning.value = false;
  }
}

async function getLinkCode() {
  if (tgLinkLoading.value) return;
  tgLinkLoading.value = true; tgError.value = null;
  try {
    const { data } = await api.post<{ code: string }>('/telegram-bridge/link-code');
    tgLinkCode.value = data.code;
  } catch (e: unknown) {
    tgError.value = (e as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Lấy mã liên kết thất bại.';
  } finally {
    tgLinkLoading.value = false;
  }
}

// Nạp trạng thái khi mở drawer / đổi nick.
watch(
  () => [props.modelValue, props.account?.id],
  () => { if (props.modelValue && props.account) loadTgStatus(); },
  { immediate: true },
);

// Phase metrics layer 2026-05-22
function formatNum(n: number | null | undefined): string {
  if (n == null) return '0';
  return n.toLocaleString('vi-VN');
}
function acceptRate(m: { friendReqSent: number; friendReqAccepted: number }): number {
  if (!m.friendReqSent) return 0;
  return Math.round((m.friendReqAccepted / m.friendReqSent) * 100);
}

function statusClass(live: string): string {
  if (live === 'connected') return 'ok';
  if (live === 'connecting' || live === 'qr_pending') return 'warn';
  return 'err';
}
function roleLabel(role: string): string {
  if (role === 'owner') return 'Owner';
  if (role === 'editor') return 'Editor';
  return 'Viewer';
}
function initials(a: EnrichedAccount): string {
  const src = a.displayName || a.zaloUid || a.phone || '?';
  const parts = src.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}
function shortName(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.trim().slice(0, 2).toUpperCase();
}

const GRADIENTS = [
  ['#6366F1', '#A855F7'],
  ['#10B981', '#059669'],
  ['#F59E0B', '#D97706'],
  ['#EC4899', '#BE185D'],
  ['#3B82F6', '#1D4ED8'],
  ['#14B8A6', '#0F766E'],
];
function hashIdx(s: string, mod: number) {
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
function avatarColor(seed: string, fallback: number): string {
  const [c1, c2] = GRADIENTS[seed ? hashIdx(seed, GRADIENTS.length) : fallback % GRADIENTS.length];
  return `linear-gradient(135deg, ${c1}, ${c2})`;
}
function maskPhone(p: string): string {
  if (!p || p.length < 7) return p ?? '';
  return p.slice(0, 4) + '.xxx.' + p.slice(-3);
}
</script>

<style scoped>
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: rgba(17, 24, 39, 0);
  pointer-events: none;
  transition: background 0.2s;
  z-index: 100;
}
.drawer-overlay.open {
  background: rgba(17, 24, 39, 0.18);
  pointer-events: auto;
}
.drawer {
  position: fixed;
  right: 0;
  top: 0;
  bottom: 0;
  width: 460px;
  max-width: 92vw;
  background: white;
  border-left: 1px solid #E5E7EB;
  box-shadow: -12px 0 32px rgba(17, 24, 39, 0.10);
  transform: translateX(100%);
  transition: transform 0.22s ease;
  display: flex;
  flex-direction: column;
  z-index: 101;
}
.drawer.open { transform: translateX(0) }
.drawer-head {
  padding: 14px 18px;
  border-bottom: 1px solid #F3F4F6;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.drawer-head .ttl {
  font-weight: 600;
  font-size: 13px;
  color: #4B5563;
}
.drawer-head .close {
  cursor: pointer;
  color: #6B7280;
  background: transparent;
  border: none;
  font-size: 16px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
}
.drawer-head .close:hover { background: #F3F4F6; color: #111827 }
.drawer-body {
  flex: 1;
  overflow: auto;
  padding: 18px;
}
.drawer-body.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #9CA3AF;
}

.hero {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 16px;
}
.hero .avatar {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  color: white;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
}
.hero .meta { flex: 1; min-width: 0 }
.hero .nm {
  font-size: 16px;
  font-weight: 700;
  color: #111827;
}
.hero .uid {
  font-size: 11.5px;
  color: #9CA3AF;
  font-family: Menlo, Consolas, monospace;
  margin-top: 2px;
}
.hero .st { margin-top: 6px }

/* Sửa SĐT thủ công (2026-06-21) */
.phone-line { display: flex; align-items: center; gap: 6px; margin-top: 2px; flex-wrap: wrap; }
.phone-empty { color: var(--ink-4, #b0b6bf); }
.phone-edit, .phone-save, .phone-cancel {
  font-size: 11px; font-family: inherit; border-radius: 6px; padding: 2px 8px; cursor: pointer;
  border: 1px solid var(--line, #e5e7eb); background: var(--surface, #fff); color: var(--ink-2, #4b5563);
}
.phone-edit:hover { background: var(--surface-3, #f3f4f6); }
.phone-save { background: var(--brand, #1786be); border-color: var(--brand, #1786be); color: #fff; }
.phone-save:disabled { opacity: 0.6; cursor: not-allowed; }
.phone-input {
  width: 130px; font-size: 12px; font-family: inherit; padding: 3px 8px;
  border: 1px solid var(--line, #e5e7eb); border-radius: 6px; color: var(--ink, #111827); background: var(--surface, #fff);
}
.phone-input:focus { outline: none; border-color: var(--brand, #1786be); }

.status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
}
.status .dot { width: 7px; height: 7px; border-radius: 50% }
.status.ok { color: #047857 } .status.ok .dot { background: #10B981 }
.status.warn { color: #B45309 } .status.warn .dot { background: #F59E0B }
.status.err { color: #B91C1C } .status.err .dot { background: #EF4444 }
.rel { color: #9CA3AF; font-weight: 400 }

.stats-trio {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}
.stats-trio .it {
  background: #F9FAFB;
  border: 1px solid #F3F4F6;
  border-radius: 9px;
  padding: 9px 10px;
  text-align: center;
}
.stats-trio .lbl {
  font-size: 10.5px;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: .04em;
}
.stats-trio .v {
  font-size: 18px;
  font-weight: 700;
  color: #111827;
  margin-top: 2px;
  font-variant-numeric: tabular-nums;
}
.stats-trio .v.success { color: #047857 }
.stats-trio .v.warning { color: #B45309 }
.stats-trio .v.error { color: #B91C1C }
.stats-trio .v small {
  font-size: 11px;
  font-weight: 400;
  color: #9CA3AF;
}
.sub-muted {
  font-size: 10.5px;
  color: #9CA3AF;
  margin-top: 2px;
}

.d-section { margin-bottom: 16px }
/* 2026-06-06 — SDK quota trong panel chi tiết */
.sdk-detail { display: flex; flex-direction: column; gap: 8px; }
.sdk-tot { font-size: 13px; color: #4b5563; }
.sdk-tot b { font-size: 15px; color: #1f2937; }
.sdkd-row { display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; align-items: baseline; }
.sdkd-lbl { font-size: 12.5px; color: #4b5563; }
.sdkd-val { font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; }
.sdkd-val small { font-weight: 500; color: #9ca3af; }
.sdkd-bar { grid-column: 1 / -1; height: 5px; background: #f3f4f6; border-radius: 99px; overflow: hidden; }
.sdkd-bar > i { display: block; height: 100%; border-radius: 99px; background: #2563eb; }
.sdkd-row.q-warn .sdkd-bar > i { background: #f59e0b; } .sdkd-row.q-warn .sdkd-val { color: #d97706; }
.sdkd-row.q-crit .sdkd-bar > i { background: #ef4444; } .sdkd-row.q-crit .sdkd-val { color: #dc2626; }
.sdkd-extra { font-size: 12px; color: #6b7280; margin-top: 2px; }
.sdkd-extra b { color: #1f2937; }
.d-section .h {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .06em;
  color: #6B7280;
  margin-bottom: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.d-section .link {
  font-size: 11px;
  color: #4F46E5;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  cursor: pointer;
}

.muted-italic {
  font-size: 12px;
  color: #9CA3AF;
  font-style: italic;
  padding: 8px 0;
}

.assign-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 9px;
  border: 1px solid #F3F4F6;
  border-radius: 9px;
  background: white;
  margin-bottom: 6px;
}
.avatar-mini {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  color: white;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.nm-col { flex: 1; min-width: 0 }
.nm-col .nm {
  font-size: 12.5px;
  font-weight: 500;
  color: #111827;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.nm-col .em {
  font-size: 10.5px;
  color: #9CA3AF;
}
.role-badge {
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: .04em;
  padding: 2px 7px;
  border-radius: 99px;
}
.role-badge.owner { background: #DBEAFE; color: #1E40AF }

/* Owner row in detail drawer — Phase 4 2026-05-22 */
.owner-row-detail {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: #EFF6FF; border: 1px solid #DBEAFE; border-radius: 8px;
}
.owner-meta { display: flex; flex-direction: column; gap: 4px; align-items: flex-end; }
.dept-chip {
  background: #F3F4F6; color: #374151; font-size: 11px; font-weight: 600;
  padding: 2px 8px; border-radius: 6px;
}
.role-chip {
  font-size: 9.5px; font-weight: 700; padding: 1px 7px; border-radius: 9999px;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.role-chip.leader { background: #DBEAFE; color: #1D4ED8; }
.role-chip.deputy { background: #FEF3C7; color: #92400E; }

/* Phase metrics layer 2026-05-22 — Số liệu hôm nay block */
.metrics-group { margin-bottom: 14px; }
.metrics-group:last-child { margin-bottom: 0; }
.metrics-title {
  font-size: 11px; color: #6B7280; text-transform: uppercase;
  letter-spacing: 0.04em; font-weight: 700; margin-bottom: 6px;
}
.metrics-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px;
}
.metrics-grid.grid-3 { grid-template-columns: repeat(3, 1fr); }
.metrics-grid.grid-4 { grid-template-columns: repeat(4, 1fr); }
.metric-cell {
  display: flex; align-items: center; gap: 8px;
  background: #F9FAFB; border: 1px solid #F3F4F6; border-radius: 8px;
  padding: 8px 10px;
}
.metric-cell.tight { flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 10px; }
.metric-icon {
  width: 28px; height: 28px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; font-weight: 700; flex-shrink: 0;
}
.metric-icon.icon-friend   { background: #E0E7FF; color: #4338CA; }
.metric-icon.icon-stranger { background: #F3F4F6; color: #6B7280; }
.metric-icon.icon-user     { background: #DCFCE7; color: #15803D; }
.metric-icon.icon-bot      { background: #F5F3FF; color: #6D28D9; }
.metric-info { min-width: 0; }
.metric-label { font-size: 11px; color: #6B7280; line-height: 1.2; }
.metric-value {
  font-size: 16px; font-weight: 700; color: #111827;
  font-variant-numeric: tabular-nums; line-height: 1.2; margin-top: 2px;
}
.role-badge.editor { background: #D1FAE5; color: #065F46 }
.role-badge.viewer { background: #F3F4F6; color: #4B5563 }
.x {
  cursor: pointer;
  color: #9CA3AF;
  font-size: 14px;
  padding: 2px 4px;
  background: transparent;
  border: none;
}
.x:hover { color: #EF4444 }

.actions-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.action-btn {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 9px 11px;
  background: white;
  border: 1px solid #F3F4F6;
  border-radius: 9px;
  cursor: pointer;
  font-size: 12px;
  color: #4B5563;
  text-align: left;
}
.action-btn:hover:not(:disabled) {
  border-color: #D1D5DB;
  background: #FAFBFC;
}
.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.action-btn svg { width: 14px; height: 14px; color: #6B7280; flex-shrink: 0 }
.action-btn .lbl { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
.action-btn.full { grid-column: 1/-1 }

/* Cầu Telegram */
.tg-status { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #374151 }
.tg-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0 }
.tg-dot.on { background: #10B981 }
.tg-dot.off { background: #9CA3AF }
.tg-chat { color: #6B7280 }
.tg-code {
  margin-top: 8px;
  padding: 8px 10px;
  background: #EFF6FF;
  border: 1px solid #BFDBFE;
  border-radius: 8px;
  font-size: 12px;
  color: #1E3A8A;
}
.tg-code code {
  background: #DBEAFE;
  padding: 2px 6px;
  border-radius: 5px;
  font-weight: 600;
  user-select: all;
}
.tg-code-hint { color: #6B7280; font-size: 11px; margin-top: 4px }
.tg-err { margin-top: 8px; font-size: 12px; color: #B91C1C }

.danger-zone {
  border: 1px dashed #FECACA;
  border-radius: 9px;
  padding: 10px 12px;
  background: #FEFAFA;
}
.dz-ttl {
  font-size: 11px;
  font-weight: 700;
  color: #B91C1C;
  text-transform: uppercase;
  letter-spacing: .06em;
  margin-bottom: 6px;
}
.dz-btn {
  background: white;
  border: 1px solid #FECACA;
  color: #B91C1C;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 10px;
  border-radius: 7px;
  cursor: pointer;
  margin-right: 6px;
}
.dz-btn:hover:not(:disabled) { background: #FEF2F2 }
.dz-btn:disabled { opacity: 0.4; cursor: not-allowed }
</style>
