<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  ArchivedNicksPanel — T13 (2026-06-21): tab "Nick đã xóa".
  Admin/chủ tổ chức xem mọi nick đã ẩn của org; sale thường chỉ thấy nick đã xóa của mình.
  Khôi phục (bỏ ẩn → vào Quản lý nick bấm Kết nối lại để quét QR) hoặc Xóa hẳn (thẻ ma rỗng).
-->
<template>
  <div class="anp">
    <div class="anp-head">
      <h3>Nick đã xóa</h3>
      <button class="anp-refresh" :disabled="loading" @click="load">↻ Tải lại</button>
    </div>
    <p class="anp-hint">
      Nick đã xóa vẫn GIỮ tin nhắn. <b>Khôi phục</b> → nick về danh sách, bấm "Kết nối lại" quét QR
      để online + hiện lại lịch sử. <b>Xóa hẳn</b> chỉ cho thẻ ma rỗng (0 dữ liệu).
    </p>

    <div v-if="loading" class="anp-empty">Đang tải…</div>
    <div v-else-if="!rows.length" class="anp-empty">Không có nick nào đã xóa.</div>

    <table v-else class="anp-tbl">
      <thead>
        <tr>
          <th>Nick</th>
          <th>Chủ nick</th>
          <th>Người xóa</th>
          <th>Xóa lúc</th>
          <th>Online cuối</th>
          <th class="ta-c">Dữ liệu</th>
          <th>Loại</th>
          <th class="ta-r">Hành động</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>
            <div class="anp-nick">
              <span class="anp-av">{{ initials(r.displayName) }}</span>
              <div>
                <div class="anp-nm">{{ r.displayName || 'Nick chưa đặt tên' }}</div>
                <div class="anp-uid">{{ r.zaloUid ? ('UID ' + String(r.zaloUid).slice(0, 10) + '…') : 'chưa login' }}</div>
              </div>
            </div>
          </td>
          <td>{{ r.ownerName || '—' }}</td>
          <td>{{ r.archivedByName || 'Hệ thống' }}</td>
          <td>{{ fmtDate(r.archivedAt) }}</td>
          <td>{{ r.lastConnectedAt ? fmtDate(r.lastConnectedAt) : '—' }}</td>
          <td class="ta-c anp-data">{{ r.conversations }} HT · {{ r.friends }} bạn</td>
          <td>
            <span v-if="r.revivable" class="anp-badge ok">Khôi phục được</span>
            <span v-else class="anp-badge ghost">Thẻ ma rỗng</span>
          </td>
          <td class="ta-r">
            <button class="anp-btn restore" :disabled="busyId === r.id" @click="onRestore(r)">Khôi phục</button>
            <button
              v-if="!r.revivable && r.conversations === 0 && r.friends === 0"
              class="anp-btn purge"
              :disabled="busyId === r.id"
              @click="onPurge(r)"
            >Xóa hẳn</button>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

interface ArchivedNick {
  id: string; displayName: string | null; avatarUrl: string | null; zaloUid: string | null; phone: string | null;
  ownerName: string | null; archivedAt: string | null; lastConnectedAt: string | null; disconnectReason: string | null;
  archivedByName: string | null; conversations: number; friends: number; revivable: boolean;
}

const emit = defineEmits<{ (e: 'changed'): void }>();

const rows = ref<ArchivedNick[]>([]);
const loading = ref(false);
const busyId = ref<string | null>(null);
const toast = useToast();
const { confirm } = useConfirm();

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/zalo-accounts/archived');
    rows.value = Array.isArray(data?.accounts) ? data.accounts : [];
  } catch (e: any) {
    toast.push('Tải danh sách nick đã xóa thất bại: ' + (e.response?.data?.error || e.message), 'error');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
defineExpose({ load });

async function onRestore(r: ArchivedNick) {
  if (!(await confirm({
    title: `Khôi phục "${r.displayName || 'nick'}"?`,
    message: 'Nick sẽ về lại danh sách Quản lý nick (trạng thái đã ngắt). Bấm "Kết nối lại" để quét QR cho online + hiện lại lịch sử.',
    tone: 'primary',
    confirmText: 'Khôi phục',
    cancelText: 'Hủy',
  }))) return;
  busyId.value = r.id;
  try {
    await api.post(`/zalo-accounts/${r.id}/restore`);
    toast.push('Đã khôi phục — vào Quản lý nick bấm "Kết nối lại" để quét QR.', 'success');
    await load();
    emit('changed');
  } catch (e: any) {
    toast.push('Khôi phục thất bại: ' + (e.response?.data?.error || e.message), 'error');
  } finally {
    busyId.value = null;
  }
}

async function onPurge(r: ArchivedNick) {
  if (!(await confirm({
    title: `Xóa HẲN "${r.displayName || 'thẻ ma'}"?`,
    message: 'Thẻ ma rỗng (0 hội thoại, 0 bạn) — xóa vĩnh viễn khỏi hệ thống, KHÔNG khôi phục được. Gõ "OK" để xác nhận.',
    tone: 'danger',
    requireTypedConfirm: 'OK',
    confirmText: 'Xóa hẳn',
    cancelText: 'Hủy',
  }))) return;
  busyId.value = r.id;
  try {
    await api.delete(`/zalo-accounts/${r.id}/purge-empty`);
    toast.push('Đã xóa hẳn thẻ ma.', 'success');
    await load();
    emit('changed');
  } catch (e: any) {
    toast.push(e.response?.data?.message || 'Xóa hẳn thất bại', 'error');
  } finally {
    busyId.value = null;
  }
}

function initials(name: string | null): string {
  const n = (name || '?').trim();
  const parts = n.split(/\s+/);
  return parts.length === 1 ? parts[0].slice(0, 2).toUpperCase() : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
</script>

<style scoped>
.anp { padding: 4px 2px; }
.anp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
.anp-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--ink, #111827); }
.anp-refresh {
  font-size: 12px; font-family: inherit; border: 1px solid var(--line, #e5e7eb); background: var(--surface, #fff);
  color: var(--ink-2, #4b5563); border-radius: 7px; padding: 4px 10px; cursor: pointer;
}
.anp-refresh:hover:not(:disabled) { background: var(--surface-3, #f3f4f6); }
.anp-hint { font-size: 12px; color: var(--ink-3, #6b7280); margin: 0 0 12px; line-height: 1.5; }
.anp-empty { padding: 32px; text-align: center; color: var(--ink-4, #9ca3af); font-size: 13px; }

.anp-tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.anp-tbl th {
  text-align: left; font-weight: 600; color: var(--ink-3, #6b7280); font-size: 11.5px;
  padding: 8px 10px; border-bottom: 1px solid var(--line, #e5e7eb); white-space: nowrap;
}
.anp-tbl td { padding: 9px 10px; border-bottom: 1px solid var(--line-soft, #f1f3f5); color: var(--ink, #111827); vertical-align: middle; }
.ta-c { text-align: center; }
.ta-r { text-align: right; }

.anp-nick { display: flex; align-items: center; gap: 9px; }
.anp-av {
  width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; background: var(--brand, #1786be); color: #fff;
  display: inline-flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700;
}
.anp-nm { font-weight: 600; }
.anp-uid { font-size: 11px; color: var(--ink-4, #9ca3af); font-family: Menlo, Consolas, monospace; }
.anp-data { white-space: nowrap; color: var(--ink-2, #4b5563); }

.anp-badge { font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.anp-badge.ok { background: #dcfce7; color: #15803d; }
.anp-badge.ghost { background: #f3f4f6; color: #6b7280; }

.anp-btn {
  font-size: 12px; font-family: inherit; border-radius: 7px; padding: 4px 10px; cursor: pointer; margin-left: 6px;
  border: 1px solid var(--line, #e5e7eb); background: var(--surface, #fff);
}
.anp-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.anp-btn.restore { border-color: var(--brand, #1786be); color: var(--brand, #1786be); }
.anp-btn.restore:hover:not(:disabled) { background: #eaf6fb; }
.anp-btn.purge { border-color: #fca5a5; color: #dc2626; }
.anp-btn.purge:hover:not(:disabled) { background: #fef2f2; }
</style>
