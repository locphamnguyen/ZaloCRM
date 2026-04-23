<template>
  <div class="voice-bubble d-flex align-center gap-2 px-3 py-2 rounded-pill" style="min-width: 180px; max-width: 260px;">
    <!-- Play / Pause button -->
    <v-btn
      icon
      size="small"
      :color="isPlaying ? 'primary' : 'default'"
      variant="tonal"
      @click="togglePlay"
    >
      <v-icon size="18">{{ isPlaying ? 'mdi-pause' : 'mdi-play' }}</v-icon>
    </v-btn>

    <!-- Waveform bars (static visual, animated when playing) -->
    <div class="waveform flex-grow-1 d-flex align-center gap-px" style="height: 28px;">
      <div
        v-for="(h, i) in bars"
        :key="i"
        class="waveform-bar rounded-pill"
        :class="{ active: isPlaying }"
        :style="{ height: `${h}%`, animationDelay: `${i * 60}ms` }"
      />
    </div>

    <!-- Duration -->
    <span class="text-caption" style="white-space: nowrap; min-width: 36px; text-align: right;">
      {{ displayTime }}
    </span>

    <!-- Hidden audio element -->
    <audio
      ref="audioEl"
      :src="audioUrl"
      @ended="onEnded"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onMeta"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onBeforeUnmount } from 'vue';

const props = defineProps<{
  audioUrl: string;
  /** Duration in milliseconds (from message metadata) */
  durationMs?: number;
}>();

const audioEl = ref<HTMLAudioElement | null>(null);
const isPlaying = ref(false);
const currentTimeSec = ref(0);
const totalSec = ref(props.durationMs ? props.durationMs / 1000 : 0);

// 12 bars with pseudo-random heights for waveform visual
const bars = Array.from({ length: 12 }, (_, i) => {
  const heights = [35, 55, 70, 45, 80, 60, 40, 75, 50, 65, 38, 58];
  return heights[i % heights.length]!;
});

const displayTime = computed(() => {
  const sec = isPlaying.value ? Math.floor(currentTimeSec.value) : Math.round(totalSec.value);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});

function togglePlay() {
  const audio = audioEl.value;
  if (!audio) return;
  if (isPlaying.value) {
    audio.pause();
    isPlaying.value = false;
  } else {
    audio.play().then(() => { isPlaying.value = true; }).catch(() => {});
  }
}

function onEnded() { isPlaying.value = false; currentTimeSec.value = 0; }
function onTimeUpdate() { currentTimeSec.value = audioEl.value?.currentTime ?? 0; }
function onMeta() { if (!props.durationMs) totalSec.value = audioEl.value?.duration ?? 0; }

onBeforeUnmount(() => { audioEl.value?.pause(); });
</script>

<style scoped>
.voice-bubble {
  background: rgba(var(--v-theme-surface-variant), 0.6);
}
.waveform-bar {
  width: 3px;
  background: rgba(var(--v-theme-primary), 0.5);
  transition: background 0.2s;
  flex-shrink: 0;
}
.waveform-bar.active {
  background: rgb(var(--v-theme-primary));
  animation: pulse 0.8s ease-in-out infinite alternate;
}
@keyframes pulse {
  from { transform: scaleY(0.6); }
  to   { transform: scaleY(1.2); }
}
</style>
