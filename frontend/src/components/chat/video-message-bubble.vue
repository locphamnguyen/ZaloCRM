<template>
  <div class="video-bubble rounded-lg overflow-hidden" style="max-width: 320px;">
    <!-- Thumbnail with play overlay -->
    <div class="video-thumb-wrap" style="position: relative; cursor: pointer;" @click="open">
      <v-img
        v-if="thumbnailUrl"
        :src="thumbnailUrl"
        aspect-ratio="16/9"
        cover
        class="rounded-lg"
      />
      <div
        v-else
        class="video-placeholder d-flex align-center justify-center rounded-lg"
        style="aspect-ratio: 16/9; background: rgba(0,0,0,0.18);"
      >
        <v-icon size="40" color="white">mdi-video</v-icon>
      </div>

      <!-- Play button overlay -->
      <div
        class="play-overlay d-flex align-center justify-center"
        style="position: absolute; inset: 0;"
      >
        <div class="play-btn rounded-circle d-flex align-center justify-center">
          <v-icon color="white" size="28">mdi-play</v-icon>
        </div>
      </div>

      <!-- Duration badge -->
      <div
        v-if="duration"
        class="duration-badge text-caption px-1 rounded"
        style="position: absolute; bottom: 6px; right: 6px;"
      >
        {{ formatDuration(duration) }}
      </div>
    </div>

    <!-- Caption -->
    <div v-if="caption" class="px-2 py-1 text-body-2">{{ caption }}</div>

    <!-- Lightbox dialog -->
    <v-dialog v-model="showDialog" max-width="800">
      <v-card>
        <v-card-actions class="pa-1 justify-end">
          <v-btn icon size="small" variant="text" @click="showDialog = false">
            <v-icon>mdi-close</v-icon>
          </v-btn>
        </v-card-actions>
        <v-card-text class="pa-0">
          <video
            v-if="videoUrl"
            :src="videoUrl"
            controls
            autoplay
            class="w-100 rounded-b-lg"
            style="max-height: 60vh;"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = defineProps<{
  videoUrl?: string;
  thumbnailUrl?: string;
  /** Duration in milliseconds */
  duration?: number;
  caption?: string;
}>();

const showDialog = ref(false);

function open() {
  if (props.videoUrl) showDialog.value = true;
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
</script>

<style scoped>
.play-overlay {
  background: rgba(0, 0, 0, 0.25);
  transition: background 0.15s;
}
.video-thumb-wrap:hover .play-overlay {
  background: rgba(0, 0, 0, 0.4);
}
.play-btn {
  width: 52px;
  height: 52px;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(2px);
}
.duration-badge {
  background: rgba(0, 0, 0, 0.65);
  color: #fff;
  font-size: 11px;
}
</style>
