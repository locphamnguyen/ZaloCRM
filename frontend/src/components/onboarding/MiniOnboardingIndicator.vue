<!--
  MiniOnboardingIndicator — Phase Onboarding v1 2026-05-24.
  Floating button góc phải dưới khi sale đã dismiss checklist nhưng chưa xong 100%.
  Click → reopen checklist.
-->
<template>
  <button
    v-if="visible"
    class="mini-onboard"
    :class="{ complete: percent === 100 }"
    @click="onClick"
    :title="percent === 100 ? 'Setup hoàn tất' : 'Mở lại checklist'"
  >
    <span class="mini-icon">🎯</span>
    <span class="mini-text">{{ completedCount }}/{{ totalCount }}</span>
    <span v-if="percent === 100" class="mini-check">✓</span>
  </button>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { api } from '@/api/index';

const router = useRouter();
const route = useRoute();
const completedCount = ref(0);
const totalCount = ref(4);
const percent = ref(0);
const dismissed = ref(false);

const visible = computed(() => {
  // Hiện khi đã dismiss (tức là đã có data + sale chủ động ẩn) hoặc 100%
  if (totalCount.value === 0) return false;
  // 2026-06-01: ẩn ở /chat vì đè lên bottom-tabs cột 4 (ChatContactPanel).
  if (route.path.startsWith('/chat')) return false;
  return dismissed.value || percent.value === 100;
});

async function fetchState() {
  try {
    const { data } = await api.get('/me/onboarding');
    completedCount.value = data.completedCount;
    totalCount.value = data.totalCount;
    percent.value = data.percent;
    dismissed.value = data.dismissed;
  } catch { /* silent */ }
}

async function onClick() {
  if (percent.value === 100) return; // chỉ là indicator, không reopen
  await api.post('/me/onboarding/reopen');
  router.push('/');
  setTimeout(fetchState, 200); // sau khi push, reload state
}

onMounted(fetchState);
</script>

<style scoped>
.mini-onboard {
  position: fixed;
  bottom: 24px;
  right: 24px;
  z-index: 90;
  background: linear-gradient(135deg, #F59E0B 0%, #D97706 100%);
  color: white;
  border: none;
  padding: 10px 16px;
  border-radius: 9999px;
  font-weight: 700;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  box-shadow: 0 8px 24px rgba(180, 83, 9, 0.25);
  transition: transform 0.15s, box-shadow 0.15s;
}
.mini-onboard:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 32px rgba(180, 83, 9, 0.35);
}
.mini-onboard.complete {
  background: linear-gradient(135deg, #10B981 0%, #047857 100%);
  cursor: default;
}
.mini-onboard.complete:hover {
  transform: none;
  box-shadow: 0 8px 24px rgba(4, 120, 87, 0.25);
}

.mini-icon { font-size: 16px; }
.mini-text { font-variant-numeric: tabular-nums; }
.mini-check { font-size: 14px; }
</style>
