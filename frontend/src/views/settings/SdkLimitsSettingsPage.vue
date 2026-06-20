<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  SdkLimitsSettingsPage — Cài đặt "Trần an toàn SDK Zalo" (2026-06-18).
  DỜI từ trang Tài khoản Zalo sang module Cài đặt (chỉ admin) — sale quản nick KHÔNG còn
  tự đổi trần (trần SDK nguy hiểm: đặt sai → Zalo khoá nick / chiến dịch nghẽn).
  Backend gate: PUT/DELETE trần đã chuyển sang requireGrant('settings','edit').
  Host lại SdkLimitsDialog ở chế độ embedded (panel trong trang, không overlay).
-->
<template>
  <div class="sdk-page">
    <header class="sdk-page-head">
      <div class="ico">🛡️</div>
      <div>
        <h1>Trần an toàn SDK Zalo</h1>
        <p>
          Giới hạn số lượt mỗi loại thao tác / nick / ngày để tránh Zalo khoá nick. Áp cho mọi
          chiến dịch (Mục tiêu, Luồng kịch bản, Gửi hàng loạt). <b>Chỉ quản trị</b> chỉnh được —
          lưu xong áp dụng ngay.
        </p>
      </div>
    </header>

    <div v-if="loading" class="sdk-page-loading">Đang tải…</div>
    <SdkLimitsDialog v-else embedded :nicks="nicks" @saved="reload" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import SdkLimitsDialog from '@/components/zalo-accounts/SdkLimitsDialog.vue';

const loading = ref(true);
const nicks = ref<Array<{ id: string; displayName: string | null }>>([]);

async function load() {
  loading.value = true;
  try {
    const { data } = await api.get('/zalo-accounts/sdk-limits');
    nicks.value = Array.isArray(data?.nicks)
      ? data.nicks.map((n: { id: string; displayName: string | null }) => ({ id: n.id, displayName: n.displayName ?? null }))
      : [];
  } catch {
    nicks.value = []; // vẫn dùng được tab "Mặc định hệ thống"
  } finally {
    loading.value = false;
  }
}
// SdkLimitsDialog tự nạp lại trần sau khi lưu; chỉ cần refresh danh sách nick nếu đổi.
function reload() { void load(); }

onMounted(load);
</script>

<style scoped>
.sdk-page { max-width: 920px; }
.sdk-page-head { display: flex; gap: 14px; align-items: flex-start; margin-bottom: 18px; }
.sdk-page-head .ico { width: 44px; height: 44px; border-radius: 12px; background: #eff6ff; display: grid; place-items: center; font-size: 22px; flex: none; }
.sdk-page-head h1 { font-size: 19px; font-weight: 700; margin: 0 0 4px; }
.sdk-page-head p { font-size: 13px; color: #6B7785; margin: 0; line-height: 1.55; }
.sdk-page-loading { padding: 28px; text-align: center; color: #97A0AC; }
</style>
