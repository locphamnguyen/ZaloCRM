<template>
  <div ref="container" class="pull-to-refresh" @touchstart="onTouchStart" @touchmove="onTouchMove" @touchend="onTouchEnd">
    <div v-if="pulling" class="d-flex justify-center py-2">
      <v-progress-circular v-if="refreshing" indeterminate size="24" width="2" color="primary" />
      <v-icon v-else :style="{ transform: `rotate(${pullProgress * 180}deg)`, transition: 'transform 0.1s' }">mdi-arrow-down</v-icon>
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const emit = defineEmits<{ refresh: [] }>();

const container = ref<HTMLElement | null>(null);
const pulling = ref(false);
const refreshing = ref(false);
const pullProgress = ref(0);

let startY = 0;
const THRESHOLD = 60;

function onTouchStart(e: TouchEvent) {
  if (container.value && container.value.scrollTop === 0) {
    startY = e.touches[0].clientY;
  }
}

function onTouchMove(e: TouchEvent) {
  if (!startY) return;
  const diff = e.touches[0].clientY - startY;
  if (diff > 10) {
    pulling.value = true;
    pullProgress.value = Math.min(diff / THRESHOLD, 1);
  }
}

async function onTouchEnd() {
  if (pullProgress.value >= 1) {
    refreshing.value = true;
    emit('refresh');
    await new Promise(r => setTimeout(r, 500));
    refreshing.value = false;
  }
  pulling.value = false;
  pullProgress.value = 0;
  startY = 0;
}
</script>
