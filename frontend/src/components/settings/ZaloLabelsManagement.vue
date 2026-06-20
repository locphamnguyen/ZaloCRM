<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="zlbl-settings">
    <header class="settings-section-header">
      <p class="subtitle">
        Đồng bộ 2 chiều với Zalo client — auto khi đổi cuộc trò chuyện (cooldown 5s).
        Sửa màu / tên / emoji bên CRM sẽ ghi ngược về Zalo. Sửa bên Zalo sẽ tự kéo về.
      </p>
    </header>

    <div v-if="loading && !accounts.length" class="loading-state">Đang tải…</div>

    <section v-for="acc in accounts" :key="acc.id" class="account-card">
      <div class="account-head">
        <div class="account-meta">
          <img v-if="acc.avatarUrl" :src="acc.avatarUrl" class="acc-avatar" alt="" />
          <div v-else class="acc-avatar fallback">{{ (acc.displayName || '?').charAt(0) }}</div>
          <div>
            <div class="acc-name">{{ acc.displayName || 'Nick Zalo' }}</div>
            <div class="acc-status" :class="acc.status">{{ statusLabel(acc.status) }}</div>
          </div>
        </div>
        <button
          class="sync-btn"
          :disabled="syncing.has(acc.id) || acc.status !== 'connected'"
          @click="syncAccount(acc.id)"
        >
          <span v-if="syncing.has(acc.id)">🔄 Đang đồng bộ…</span>
          <span v-else>⟳ Đồng bộ ngay</span>
        </button>
      </div>

      <table v-if="acc.labels.length" class="labels-table">
        <thead>
          <tr>
            <th class="col-color">Màu</th>
            <th class="col-emoji">Emoji</th>
            <th class="col-name">Tên thẻ</th>
            <th class="col-count">KH gắn</th>
            <th class="col-synced">Đồng bộ lúc</th>
            <th class="col-actions">Hành động</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="label in acc.labels" :key="label.id" class="label-row">
            <td class="col-color">
              <input
                type="color"
                :value="normalizeColor(label.color)"
                class="color-picker"
                :disabled="acc.status !== 'connected'"
                @change="onColorChange(acc.id, label, $event)"
              />
            </td>
            <td class="col-emoji">
              <input
                type="text"
                :value="label.emoji || ''"
                class="emoji-input"
                maxlength="4"
                :disabled="acc.status !== 'connected'"
                @blur="onEmojiChange(acc.id, label, $event)"
              />
            </td>
            <td class="col-name">
              <input
                type="text"
                :value="label.text"
                class="name-input"
                :style="`color: ${normalizeColor(label.color)}`"
                :disabled="acc.status !== 'connected'"
                @blur="onTextChange(acc.id, label, $event)"
              />
            </td>
            <td class="col-count">
              <span class="count-pill">{{ label.assignedCount }}</span>
            </td>
            <td class="col-synced">{{ relTime(label.syncedAt) }}</td>
            <td class="col-actions">
              <span class="zlbl-pill" :style="`background:${normalizeColor(label.color)}22;color:${normalizeColor(label.color)};border-color:${normalizeColor(label.color)}`">
                {{ label.emoji ? label.emoji + ' ' : '' }}{{ label.text }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>

      <div v-else class="empty-state">
        <p v-if="acc.status !== 'connected'">⚠ Nick này chưa kết nối — không thể đồng bộ tag.</p>
        <p v-else>Chưa có tag nào. Nhấn "⟳ Đồng bộ ngay" để pull từ Zalo.</p>
      </div>
    </section>

    <div v-if="!loading && !accounts.length" class="empty-state">
      Không có nick Zalo nào. Vào trang <router-link to="/zalo-accounts">Tài khoản Zalo</router-link> để kết nối.
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { formatInOrgTz } from '@/composables/use-org-timezone';

interface ZaloLabelView {
  id: number;
  text: string;
  color: string;
  emoji: string | null;
  offset: number;
  syncedAt: string;
  assignedCount: number;
}
interface AccountView {
  id: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: string;
  labels: ZaloLabelView[];
}

const toast = useToast();
const accounts = ref<AccountView[]>([]);
const loading = ref(false);
const syncing = ref(new Set<string>());

async function fetchOverview() {
  loading.value = true;
  try {
    const { data } = await api.get('/zalo-accounts/labels-overview');
    accounts.value = data.accounts || [];
  } catch (err) {
    console.error(err);
    toast.error('Không tải được danh sách tag');
  } finally {
    loading.value = false;
  }
}

async function syncAccount(accountId: string) {
  syncing.value.add(accountId);
  try {
    const { data } = await api.post(`/zalo-accounts/${accountId}/labels/sync`);
    toast.success(`✓ Đồng bộ ${data.labels.length} tag · cập nhật ${data.friendsUpdated} KH`);
    await fetchOverview();
  } catch (err: any) {
    const msg = err.response?.data?.error || 'Đồng bộ thất bại';
    toast.error(msg);
  } finally {
    syncing.value.delete(accountId);
    syncing.value = new Set(syncing.value);
  }
}

async function patchLabel(accountId: string, labelId: number, body: { color?: string; text?: string; emoji?: string }) {
  try {
    await api.patch(`/zalo-accounts/${accountId}/labels/${labelId}`, body);
    toast.success('✓ Đã cập nhật & ghi ngược về Zalo');
    await fetchOverview();
  } catch (err: any) {
    const msg = err.response?.data?.error || 'Cập nhật thất bại';
    toast.error(msg);
  }
}

function onColorChange(accountId: string, label: ZaloLabelView, e: Event) {
  const newColor = (e.target as HTMLInputElement).value;
  if (newColor === normalizeColor(label.color)) return;
  void patchLabel(accountId, label.id, { color: newColor });
}

function onTextChange(accountId: string, label: ZaloLabelView, e: Event) {
  const newText = (e.target as HTMLInputElement).value.trim();
  if (!newText || newText === label.text) return;
  void patchLabel(accountId, label.id, { text: newText });
}

function onEmojiChange(accountId: string, label: ZaloLabelView, e: Event) {
  const newEmoji = (e.target as HTMLInputElement).value;
  if (newEmoji === (label.emoji || '')) return;
  void patchLabel(accountId, label.id, { emoji: newEmoji });
}

function normalizeColor(c: string): string {
  if (!c) return '#999999';
  if (c.startsWith('#')) return c.slice(0, 7);
  if (/^[0-9a-f]{6}$/i.test(c)) return '#' + c;
  return c;
}

function statusLabel(s: string): string {
  if (s === 'connected') return '● Đã kết nối';
  if (s === 'qr_pending') return '◐ Đang quét QR';
  return '○ Mất kết nối';
}

function relTime(iso: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s trước`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}p trước`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h trước`;
  return formatInOrgTz(iso);
}

// Auto-refresh mỗi 30s để pick up background sync changes
let refreshInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void fetchOverview();
  refreshInterval = setInterval(() => { void fetchOverview(); }, 30_000);
});
import { onBeforeUnmount } from 'vue';
onBeforeUnmount(() => { if (refreshInterval) clearInterval(refreshInterval); });
</script>

<style scoped>
.zlbl-settings {
  max-width: 1200px;
}
.settings-section-header {
  margin-bottom: 16px;
}
.subtitle {
  margin: 0 0 4px 0;
  font-size: 13px;
  color: var(--smax-grey-600);
  line-height: 1.5;
}

.loading-state, .empty-state {
  padding: 32px;
  text-align: center;
  color: var(--smax-grey-500);
}

.account-card {
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 12px;
  margin-bottom: 18px;
  overflow: hidden;
}
.account-head {
  padding: 12px 16px;
  background: var(--smax-grey-50, #f9fafb);
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--smax-grey-100);
}
.account-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}
.acc-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
}
.acc-avatar.fallback {
  background: linear-gradient(135deg, var(--smax-primary), #5e92ff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
}
.acc-name {
  font-size: 15px;
  font-weight: 600;
  color: var(--smax-text);
}
.acc-status {
  font-size: 11px;
  font-weight: 500;
  margin-top: 2px;
}
.acc-status.connected { color: #00897b; }
.acc-status.qr_pending { color: #f57c00; }
.acc-status.disconnected { color: #c62828; }

.sync-btn {
  background: var(--smax-primary);
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
}
.sync-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.sync-btn:hover:not(:disabled) { background: #1e4cc7; }

.labels-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.labels-table th, .labels-table td {
  padding: 8px 12px;
  text-align: left;
  border-bottom: 1px solid var(--smax-grey-100);
}
.labels-table th {
  background: #fafbfc;
  font-weight: 600;
  font-size: 11px;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.labels-table tr:last-child td { border-bottom: none; }

.col-color { width: 56px; }
.col-emoji { width: 70px; }
.col-count { width: 80px; text-align: center; }
.col-synced { width: 130px; color: var(--smax-grey-500); font-size: 12px; }
.col-actions { width: 180px; }

.color-picker {
  width: 36px;
  height: 28px;
  border: 1px solid var(--smax-grey-200);
  border-radius: 6px;
  padding: 0;
  cursor: pointer;
}
.color-picker:disabled { opacity: 0.5; }

.emoji-input, .name-input {
  border: 1px solid transparent;
  border-radius: 5px;
  padding: 4px 7px;
  font-family: inherit;
  font-size: 13px;
  background: transparent;
  width: 100%;
  outline: none;
}
.emoji-input:hover, .name-input:hover { border-color: var(--smax-grey-200); }
.emoji-input:focus, .name-input:focus {
  border-color: var(--smax-primary);
  background: var(--smax-primary-soft);
}
.emoji-input:disabled, .name-input:disabled { opacity: 0.6; }
.name-input { font-weight: 600; }

.count-pill {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  padding: 2px 9px;
  border-radius: 11px;
  font-size: 11.5px;
  font-weight: 600;
}

.zlbl-pill {
  padding: 3px 11px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1.5px solid;
  display: inline-block;
}
</style>
