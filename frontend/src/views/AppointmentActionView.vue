<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  AppointmentActionView — trang CÔNG KHAI mở từ link trong tin Zalo (2026-06-16).
  Sale bấm link → xem lịch hẹn → bấm Hoàn thành / Huỷ. Xác thực bằng token (query ?t=),
  gọi endpoint public (không cần đăng nhập). Dùng fetch thuần.
-->
<template>
  <div class="aa-wrap">
    <div class="aa-card">
      <div class="aa-brand"><span class="aa-logo">HS</span> ZaloCRM</div>

      <div v-if="loading" class="aa-state">Đang tải lịch hẹn…</div>

      <div v-else-if="error" class="aa-state aa-err">
        <div class="aa-ic err">!</div>
        <p>{{ error }}</p>
      </div>

      <div v-else-if="done" class="aa-state aa-ok">
        <div class="aa-ic ok">✓</div>
        <h2>{{ doneLabel }}</h2>
        <p class="aa-sub">Bạn có thể đóng trang này.</p>
      </div>

      <template v-else-if="appt">
        <div class="aa-head">
          <div class="aa-ic cal">📅</div>
          <h2>{{ appt.title || 'Lịch hẹn' }}</h2>
        </div>
        <div class="aa-info">
          <div class="aa-row"><span class="l">Khách</span><span class="v">{{ appt.contactName || '—' }}</span></div>
          <div class="aa-row"><span class="l">Thời gian</span><span class="v">{{ whenLabel }}</span></div>
          <div v-if="appt.ownerName" class="aa-row"><span class="l">Người phụ trách</span><span class="v">{{ appt.ownerName }}</span></div>
          <div class="aa-row"><span class="l">Trạng thái</span><span class="v"><span class="aa-badge" :class="appt.status">{{ statusLabel }}</span></span></div>
        </div>

        <div v-if="isClosed" class="aa-state aa-ok" style="padding-top:8px">
          <p class="aa-sub">Lịch hẹn đã <b>{{ statusLabel }}</b> rồi.</p>
        </div>
        <div v-else class="aa-actions">
          <p class="aa-q">Đánh dấu lịch hẹn này:</p>
          <button class="aa-btn ok" :disabled="busy" @click="act('completed')">✓ Hoàn thành</button>
          <button class="aa-btn cancel" :disabled="busy" @click="act('cancelled')">✕ Huỷ lịch</button>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';

interface ApptInfo {
  id: string; status: string; appointmentDate: string;
  appointmentTime: string | null; title: string | null; contactName: string | null;
  ownerName: string | null;
}
const route = useRoute();
const token = String(route.query.t ?? '');
const loading = ref(true);
const busy = ref(false);
const error = ref('');
const appt = ref<ApptInfo | null>(null);
const done = ref(false);
const doneAction = ref<'completed' | 'cancelled' | ''>('');

const STATUS_VI: Record<string, string> = {
  scheduled: 'Đã lên lịch', overdue: 'Quá giờ', completed: 'Hoàn thành', cancelled: 'Đã huỷ', no_show: 'Vắng',
};
const statusLabel = computed(() => STATUS_VI[appt.value?.status ?? ''] ?? appt.value?.status ?? '');
const isClosed = computed(() => ['completed', 'cancelled', 'no_show'].includes(appt.value?.status ?? ''));
const doneLabel = computed(() => (doneAction.value === 'completed' ? 'Đã đánh dấu Hoàn thành ✓' : 'Đã Huỷ lịch hẹn'));
const whenLabel = computed(() => {
  if (!appt.value) return '';
  const d = new Date(appt.value.appointmentDate);
  const date = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const time = appt.value.appointmentTime
    || new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  return `${time} · ${date}`;
});

async function load() {
  if (!token) { error.value = 'Link không hợp lệ.'; loading.value = false; return; }
  try {
    const res = await fetch(`/api/public/appointments/action?t=${encodeURIComponent(token)}`);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      error.value = j.error === 'invalid_or_expired_token' ? 'Link đã hết hạn hoặc không hợp lệ.' : 'Không tìm thấy lịch hẹn.';
      return;
    }
    appt.value = await res.json();
  } catch {
    error.value = 'Lỗi kết nối, thử lại sau.';
  } finally {
    loading.value = false;
  }
}
async function act(action: 'completed' | 'cancelled') {
  if (busy.value) return;
  busy.value = true;
  try {
    const res = await fetch('/api/public/appointments/action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.ok) { error.value = 'Không cập nhật được, link có thể đã hết hạn.'; return; }
    doneAction.value = action;
    done.value = true;
  } catch {
    error.value = 'Lỗi kết nối, thử lại sau.';
  } finally {
    busy.value = false;
  }
}
onMounted(load);
</script>

<style scoped>
/* 2026-06-17 FIX mobile thật lệch (Chrome desktop OK): 100vh tính cả vùng sau thanh URL
   động trên mobile → card căn giữa bị đẩy lệch, nút Hoàn thành/Huỷ rớt khỏi màn.
   → dùng 100dvh (vùng nhìn thấy thật) + fallback 100vh. Căn giữa bằng margin:auto trên
   card (KHÔNG dùng align-items:center) để khi card cao hơn màn vẫn cuộn được, không cụt
   đỉnh. index.html có viewport-fit=cover → chừa safe-area (notch/home indicator). */
/* 2026-06-18 FIX lệch NGANG mobile thật: trang công khai này bị bọc AuthLayout
   (<v-app>/<v-main> Vuetify, d-flex) + global #app{min-width:1100px}. Hệ quả: .aa-wrap
   co theo nội dung (≈380px) & dính padding layout của v-main → card bị đẩy sang phải,
   tràn khỏi màn (nền xám auth-shell lòi ra). → ghim position:fixed inset:0 phủ đúng
   viewport, thoát cả v-main lẫn #app 1100px. Giữ nguyên dvh/safe-area/cuộn của fix 2026-06-17. */
.aa-wrap { position: fixed; inset: 0; box-sizing: border-box;
  min-height: 100vh; min-height: 100dvh; display: flex; justify-content: center; overflow-y: auto;
  padding: calc(16px + env(safe-area-inset-top)) calc(16px + env(safe-area-inset-right)) calc(16px + env(safe-area-inset-bottom)) calc(16px + env(safe-area-inset-left));
  background: linear-gradient(160deg, #0e445a 0%, #06222f 100%); }
.aa-card { width: 100%; max-width: 380px; margin: auto; background: #fff; border-radius: 16px; padding: 22px 20px 24px;
  box-shadow: 0 16px 48px rgba(0,0,0,.3); font-family: Inter, system-ui, -apple-system, sans-serif; color: #141a24; }
.aa-brand { display: flex; align-items: center; gap: 8px; font-weight: 800; font-size: 14px; color: #0b5880; margin-bottom: 16px; }
.aa-logo { width: 26px; height: 26px; border-radius: 8px; background: linear-gradient(135deg, #1786be, #0b5880); color: #fff;
  font-size: 11px; display: grid; place-items: center; }
.aa-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
.aa-head h2 { margin: 0; font-size: 17px; font-weight: 700; }
.aa-ic { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 19px; flex: none; }
.aa-ic.cal { background: #e4f1f8; }
.aa-ic.ok { background: #e7f7ef; color: #12b76a; font-weight: 800; }
.aa-ic.err { background: #fdeceb; color: #f04438; font-weight: 800; }
.aa-info { display: flex; flex-direction: column; gap: 9px; padding: 12px 0; border-top: 1px solid #eef1f6; border-bottom: 1px solid #eef1f6; margin-bottom: 16px; }
.aa-row { display: flex; justify-content: space-between; align-items: center; font-size: 14px; }
.aa-row .l { color: #6b7488; }
.aa-row .v { font-weight: 600; }
.aa-badge { font-size: 12px; font-weight: 700; padding: 2px 9px; border-radius: 999px; background: #f1f4f9; color: #475066; }
.aa-badge.completed { background: #e7f7ef; color: #157f3c; }
.aa-badge.cancelled, .aa-badge.no_show { background: #fdeceb; color: #b42318; }
.aa-badge.overdue { background: #fdf3e2; color: #b45309; }
.aa-q { font-size: 13px; color: #475066; margin: 0 0 10px; font-weight: 600; }
.aa-actions { display: flex; flex-direction: column; gap: 9px; }
.aa-btn { height: 46px; border: 0; border-radius: 10px; font: inherit; font-size: 15px; font-weight: 700; cursor: pointer; }
.aa-btn:disabled { opacity: .6; }
.aa-btn.ok { background: #12b76a; color: #fff; }
.aa-btn.cancel { background: #fff; color: #b42318; border: 1px solid #f0c0bb; }
.aa-state { text-align: center; padding: 22px 4px; }
.aa-state .aa-ic { margin: 0 auto 12px; width: 48px; height: 48px; font-size: 26px; }
.aa-state h2 { margin: 0 0 4px; font-size: 17px; }
.aa-sub { color: #6b7488; font-size: 13px; margin: 0; }
.aa-err p { color: #b42318; font-weight: 600; }
</style>
