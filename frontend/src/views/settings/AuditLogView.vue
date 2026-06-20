<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- 2026-06-09 (anh chốt): Nhật ký kiểm soát — ai làm gì với nhân viên (đổi quyền,
       reset mật khẩu, vô hiệu, bàn giao KH). Đọc ActivityLog category='admin'. -->
  <div class="al-wrap">
    <header class="al-head">
      <h1 class="al-title">Nhật ký quản trị</h1>
      <p class="al-sub">Lịch sử thao tác với tài khoản nhân viên — minh bạch nội bộ.</p>
    </header>

    <div class="al-toolbar">
      <div class="al-chips" role="group" aria-label="Lọc hành động">
        <button
          v-for="opt in ACTION_FILTERS"
          :key="opt.value"
          class="al-chip"
          :class="{ active: actionFilter === opt.value }"
          @click="setAction(opt.value)"
        >{{ opt.label }}</button>
      </div>
      <span class="al-count">{{ total }} bản ghi</span>
    </div>

    <div v-if="loading" class="al-loading">Đang tải nhật ký…</div>
    <div v-else-if="logs.length === 0" class="al-empty">
      <span class="al-empty-icon">📋</span>
      <p>Chưa có thao tác nào được ghi lại.</p>
    </div>
    <table v-else class="al-table">
      <thead>
        <tr>
          <th class="al-th-time">Thời gian</th>
          <th class="al-th-actor">Người thực hiện</th>
          <th class="al-th-action">Hành động</th>
          <th class="al-th-target">Đối tượng</th>
          <th class="al-th-detail">Chi tiết</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="log in logs" :key="log.id">
          <td class="al-time">{{ fmtTime(log.createdAt) }}</td>
          <td class="al-actor">{{ log.actor?.name || '(hệ thống)' }}</td>
          <td><span class="al-badge" :class="badgeClass(log.action)">{{ actionLabel(log.action) }}</span></td>
          <td class="al-target">{{ log.target?.name || '—' }}</td>
          <td class="al-detail">{{ detailText(log) }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="!loading && total > limit" class="al-pager">
      <button class="al-page-btn" :disabled="offset === 0" @click="prevPage">← Trước</button>
      <span class="al-page-info">{{ offset + 1 }}–{{ Math.min(offset + limit, total) }} / {{ total }}</span>
      <button class="al-page-btn" :disabled="offset + limit >= total" @click="nextPage">Sau →</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api/index';

interface AuditLog {
  id: string;
  action: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  target: { id: string; name: string } | null;
  details: Record<string, any>;
}

const ACTION_FILTERS = [
  { value: '', label: 'Tất cả' },
  { value: 'user.handoff', label: '🔄 Bàn giao' },
  { value: 'user.reset_password', label: '🔑 Reset mật khẩu' },
  { value: 'user.deactivate', label: '🚫 Vô hiệu' },
];
const ACTION_LABELS: Record<string, string> = {
  'user.handoff': 'Bàn giao khách hàng',
  'user.reset_password': 'Đặt lại mật khẩu',
  'user.deactivate': 'Vô hiệu hóa',
};

const logs = ref<AuditLog[]>([]);
const total = ref(0);
const limit = ref(50);
const offset = ref(0);
const loading = ref(false);
const actionFilter = ref('');

async function load() {
  loading.value = true;
  try {
    const params: Record<string, string> = { limit: String(limit.value), offset: String(offset.value) };
    if (actionFilter.value) params.action = actionFilter.value;
    const { data } = await api.get('/audit-logs', { params });
    logs.value = data.logs || [];
    total.value = data.total || 0;
  } catch {
    logs.value = [];
  } finally {
    loading.value = false;
  }
}
function setAction(v: string) {
  actionFilter.value = v;
  offset.value = 0;
  load();
}
function nextPage() { offset.value += limit.value; load(); }
function prevPage() { offset.value = Math.max(0, offset.value - limit.value); load(); }

function actionLabel(a: string) { return ACTION_LABELS[a] || a; }
function badgeClass(a: string) {
  if (a === 'user.handoff') return 'b-handoff';
  if (a === 'user.reset_password') return 'b-reset';
  if (a === 'user.deactivate') return 'b-danger';
  return 'b-default';
}
function fmtTime(iso: string) {
  // Hiển thị giờ VN (Asia/Ho_Chi_Minh) — theo chuẩn chung hệ thống.
  try {
    return new Date(iso).toLocaleString('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}
function detailText(log: AuditLog): string {
  const d = log.details || {};
  if (log.action === 'user.handoff') {
    return `→ ${d.toName || '?'}: ${d.contacts ?? 0} khách, ${d.nicks ?? 0} nick, ${d.appointments ?? 0} lịch hẹn`;
  }
  return '';
}

onMounted(load);
</script>

<style scoped>
.al-wrap { padding: 20px 24px; max-width: 1366px; }
.al-head { margin-bottom: 16px; }
.al-title { font-size: 22px; font-weight: 700; color: #0e445a; margin: 0 0 4px; }
.al-sub { font-size: 13.5px; color: #6b7280; margin: 0; }
.al-toolbar { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; flex-wrap: wrap; }
.al-chips { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.al-chip {
  font-size: 12.5px; font-weight: 500; color: #41454d; background: #f0f1f3;
  border: 1px solid transparent; padding: 6px 13px; border-radius: 9999px; cursor: pointer;
}
.al-chip:hover { background: #e4e6e9; }
.al-chip.active { background: #e4f1f8; border-color: #1786be; color: #1786be; font-weight: 600; }
.al-count { font-size: 12px; color: #6b7280; margin-left: auto; }
.al-loading, .al-empty { text-align: center; padding: 48px; color: #6b7280; }
.al-empty-icon { font-size: 36px; display: block; margin-bottom: 8px; }
.al-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.al-table th {
  text-align: left; padding: 9px 12px; background: #f7f8fa; color: #6b7280;
  font-weight: 600; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.3px;
  border-bottom: 1px solid #e4e5e9;
}
.al-table td { padding: 10px 12px; border-bottom: 1px solid #f0f1f3; color: #2b2f36; }
.al-table tr:hover td { background: #fafbfc; }
.al-time { color: #6b7280; white-space: nowrap; }
.al-actor { font-weight: 600; }
.al-badge { font-size: 12px; font-weight: 600; padding: 3px 9px; border-radius: 6px; white-space: nowrap; }
.b-handoff { background: #e4f1f8; color: #0e6491; }
.b-reset { background: #fef3c7; color: #92400e; }
.b-danger { background: #fee2e2; color: #b91c1c; }
.b-default { background: #f0f1f3; color: #41454d; }
.al-detail { color: #6b7280; font-size: 12.5px; }
.al-pager { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 18px; }
.al-page-btn {
  background: #fff; border: 1px solid #d4d6db; color: #41454d; padding: 6px 14px;
  border-radius: 8px; cursor: pointer; font-size: 13px;
}
.al-page-btn:hover:not(:disabled) { background: #f0f1f3; }
.al-page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.al-page-info { font-size: 12.5px; color: #6b7280; }
</style>
