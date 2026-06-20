<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  PrivacyLockBadge — pill nhỏ hiển thị ngay ô tên user ở Cột 1 sidebar.
  Anh chốt 2026-05-22:
    - 🔒 (closed) khi chưa unlock → click mở PrivacyUnlockDialog
    - 🔓 (open) + countdown HH:MM khi đang unlock → click cho phép lock ngay
    - Auto refresh expiresAt mỗi giây, khi countdown chạm 0 thì re-fetch status

  Emits:
    click — parent toggle dialog (mở khoá hoặc settings)
-->
<template>
  <!-- 2026-06-11 (rule anh chốt): TÁCH 2 BADGE RIÊNG. Khoá → 1 badge ổ khoá.
       Mở khoá → badge mở-khoá (teal) + badge đồng hồ navy/cyan (M6) riêng biệt.
       Icon ổ khoá TO bằng icon hộp quà (18px Lucide). -->
  <div class="lb-group">
    <!-- Badge ổ khoá / mở khoá -->
    <button
      type="button"
      class="lb-badge"
      :class="{ unlocked: isUnlocked, locked: !isUnlocked }"
      :title="badgeTitle"
      :aria-label="badgeTitle"
      @click="onClick"
    >
      <!-- Lock (đóng) -->
      <svg v-if="!isUnlocked" class="lb-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
      </svg>
      <!-- Unlock (mở) -->
      <svg v-else class="lb-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7-2.6" />
      </svg>
      <span class="lb-text">{{ isUnlocked ? 'Đã mở' : 'Riêng tư' }}</span>
    </button>

    <!-- Badge ĐỒNG HỒ riêng (chỉ khi đã mở khoá) — M6 navy nền + số cyan -->
    <button
      v-if="isUnlocked"
      type="button"
      class="lb-clock"
      :class="{ urgent: isUrgent }"
      :title="`Phiên Riêng tư còn ${countdownFull} · click để khoá lại`"
      @click="onClick"
    >
      <svg class="lb-clock-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
      <span class="lb-digits" v-html="countdownSmart"></span>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { usePrivacyStore } from '@/stores/privacy';

const emit = defineEmits<{ click: [unlocked: boolean] }>();
const store = usePrivacyStore();

const isUnlocked = computed(() => store.isUnlocked);
const expiresAt = computed(() => store.activeSessions[0]?.expiresAt ?? null);

const now = ref(Date.now());
let timerId: number | null = null;
let lastTriggeredRefetch = 0;

function tick() {
  now.value = Date.now();
  // Khi session sắp hết hạn → re-fetch để FE state đồng bộ
  if (expiresAt.value) {
    const remain = new Date(expiresAt.value).getTime() - now.value;
    if (remain <= 0 && Date.now() - lastTriggeredRefetch > 5000) {
      lastTriggeredRefetch = Date.now();
      store.fetchStatus(true).catch(() => {});
    }
  }
}

onMounted(() => {
  timerId = window.setInterval(tick, 1000);
});
onUnmounted(() => {
  if (timerId) window.clearInterval(timerId);
});

// Giây còn lại của phiên (reactive theo `now` tick mỗi giây).
const remainingSec = computed(() => {
  if (!expiresAt.value) return 0;
  const ms = new Date(expiresAt.value).getTime() - now.value;
  return ms <= 0 ? 0 : Math.floor(ms / 1000);
});

// Đồng hồ THÔNG MINH (anh chốt 2026-06-11):
//   còn ≥1 giờ → hiện GIỜ:PHÚT (vd 02g:14p)
//   còn <1 giờ → hiện PHÚT:GIÂY (vd 04:32) — dạng đồng hồ điện tử đếm ngược
// pad 2 số, dấu : nhấp nháy (CSS). unit nhỏ mờ. Trả HTML để style unit/colon.
const countdownSmart = computed(() => {
  const s = remainingSec.value;
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p = (n: number) => String(n).padStart(2, '0');
  if (hh >= 1) {
    return `${p(hh)}<span class="u">g</span><span class="c">:</span>${p(mm)}<span class="u">p</span>`;
  }
  return `${p(mm)}<span class="c">:</span>${p(ss)}`;
});

// Full HH:MM:SS cho tooltip.
const countdownFull = computed(() => {
  const s = remainingSec.value;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
});

// Sắp hết phiên (<5 phút) → đồng hồ ngả đỏ cảnh báo.
const isUrgent = computed(() => remainingSec.value > 0 && remainingSec.value < 300);

const badgeTitle = computed(() =>
  isUnlocked.value
    ? `Đang mở khoá Riêng tư · còn ${countdownFull.value} · click để khoá lại`
    : 'Chế độ Riêng tư đang đóng · click để mở khoá',
);

async function onClick() {
  if (isUnlocked.value) {
    // Đang mở → khoá lại ngay (bubble blur kích hoạt lại).
    // Anh chốt 2026-05-22: click badge khi unlocked = lock ngay, KHÔNG mở dialog.
    try { await store.lock(); } catch { /* silent */ }
    emit('click', false);
    return;
  }
  // Đang đóng → để parent mở dialog nhập PIN.
  emit('click', false);
}
</script>

<style scoped>
/* ── 2 badge tách rời, đặt cạnh nhau ── */
.lb-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

/* ── Badge ổ khoá / mở khoá ── */
.lb-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 11px;          /* to bằng icon hộp quà (gift badge) */
  border-radius: 999px;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  transition: all 0.15s ease;
  user-select: none;
}
.lb-svg { width: 18px; height: 18px; flex-shrink: 0; }  /* icon TO = 18px như hộp quà */
.lb-text { line-height: 1; }

.lb-badge.locked {
  background: #F4F4F7;
  color: #6B7785;
  border-color: #E4E5E9;
}
.lb-badge.locked:hover {
  background: #E9F5FB;
  border-color: #BFE2F4;
  color: #0F6EA3;
}
/* Mở khoá — teal grad (Atlas v2 teal-navy-cyan) */
.lb-badge.unlocked {
  background: linear-gradient(135deg, #0F6EA3 0%, #1786BE 100%);
  color: #fff;
  border-color: #0F6EA3;
  box-shadow: 0 1px 4px rgba(15, 110, 163, 0.3);
}
.lb-badge.unlocked:hover {
  background: linear-gradient(135deg, #0C5680 0%, #0F6EA3 100%);
  box-shadow: 0 2px 7px rgba(15, 110, 163, 0.4);
}
.lb-badge.unlocked .lb-svg { filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.2)); }

/* ── Badge ĐỒNG HỒ (M6: solid navy nền + số cyan) ── */
.lb-clock {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 10px 6px 9px;
  border-radius: 999px;
  border: 1px solid #1C3556;
  background: #0F2747;          /* navy đậm Atlas */
  color: #7EE0FF;              /* cyan */
  cursor: pointer;
  transition: all 0.15s ease;
}
.lb-clock:hover { background: #163358; border-color: #2A4D7A; }
.lb-clock-svg { width: 15px; height: 15px; flex-shrink: 0; opacity: 0.85; }
.lb-digits {
  font-family: 'JetBrains Mono', 'SF Mono', ui-monospace, monospace;
  font-size: 12.5px;
  font-weight: 700;
  letter-spacing: 0.5px;
  font-variant-numeric: tabular-nums;
}
/* unit (g/p) nhỏ mờ, dấu : nhấp nháy như đồng hồ điện tử */
.lb-digits :deep(.u) { font-size: 9px; opacity: 0.6; margin-left: 1px; font-weight: 600; }
.lb-digits :deep(.c) { animation: lb-blink 1s steps(1) infinite; }
@keyframes lb-blink { 50% { opacity: 0.25; } }

/* Sắp hết phiên (<5 phút) → ngả đỏ cảnh báo */
.lb-clock.urgent {
  background: #3a0f12;
  border-color: #6b1f24;
  color: #ff9a9a;
}

.lb-badge:focus-visible, .lb-clock:focus-visible {
  outline: 2px solid #1786BE;
  outline-offset: 2px;
}
</style>
