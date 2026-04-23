<template>
  <div class="d-flex align-center gap-2">
    <!-- Record / Stop button -->
    <v-btn
      :icon="isRecording ? 'mdi-stop' : 'mdi-microphone'"
      :color="isRecording ? 'error' : 'default'"
      size="small"
      variant="tonal"
      :disabled="disabled || sending"
      :title="isRecording ? 'Dừng ghi' : 'Ghi âm tin nhắn thoại'"
      @click="toggleRecord"
    />

    <!-- Timer + waveform (visible while recording) -->
    <transition name="fade">
      <div v-if="isRecording" class="d-flex align-center gap-2">
        <span class="text-caption recording-dot" style="color: #f44336;">&#9679;</span>
        <span class="text-caption font-weight-medium">{{ timerLabel }}</span>
      </div>
    </transition>

    <!-- Send button (visible after recording is stopped) -->
    <transition name="fade">
      <div v-if="blobUrl && !isRecording" class="d-flex align-center gap-1">
        <audio :src="blobUrl" controls style="height: 28px; max-width: 160px;" />
        <v-btn
          icon="mdi-send"
          size="small"
          color="primary"
          :loading="sending"
          title="Gửi tin nhắn thoại"
          @click="send"
        />
        <v-btn
          icon="mdi-delete"
          size="small"
          variant="text"
          title="Hủy"
          @click="cancel"
        />
      </div>
    </transition>

    <v-alert v-if="recError" type="error" density="compact" variant="tonal" class="ml-2 py-1 px-2 text-caption">
      {{ recError }}
    </v-alert>
  </div>
</template>

<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue';

defineProps<{
  disabled?: boolean;
  sending?: boolean;
}>();

const emit = defineEmits<{
  /** Emitted with the recorded audio Blob and duration in ms */
  (e: 'send', payload: { blob: Blob; durationMs: number; mimeType: string }): void;
  (e: 'cancel'): void;
}>();

const isRecording = ref(false);
const blobUrl = ref('');
const recError = ref('');
const timerLabel = ref('0:00');

let mediaRecorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: BlobPart[] = [];
let startTime = 0;
let timerInterval: ReturnType<typeof setInterval> | null = null;
let recordedBlob: Blob | null = null;
let recordedDurationMs = 0;

async function toggleRecord() {
  if (isRecording.value) {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  recError.value = '';
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    recError.value = 'Không thể truy cập microphone';
    return;
  }

  chunks = [];
  const mimeType = getSupportedMimeType();
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);

  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data.size > 0) chunks.push(ev.data);
  };

  mediaRecorder.onstop = () => {
    recordedDurationMs = Date.now() - startTime;
    const mime = mediaRecorder?.mimeType ?? 'audio/webm';
    recordedBlob = new Blob(chunks, { type: mime });
    blobUrl.value = URL.createObjectURL(recordedBlob);
    stopStream();
  };

  mediaRecorder.start(100); // collect data every 100ms
  startTime = Date.now();
  isRecording.value = true;

  timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    timerLabel.value = `${m}:${String(s).padStart(2, '0')}`;

    // Auto-stop at 5 min (Zalo voice limit)
    if (elapsed >= 300) stopRecording();
  }, 500);
}

function stopRecording() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  isRecording.value = false;
  mediaRecorder?.stop();
}

function stopStream() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

function send() {
  if (!recordedBlob) return;
  emit('send', {
    blob: recordedBlob,
    durationMs: recordedDurationMs,
    mimeType: recordedBlob.type,
  });
  cleanup();
}

function cancel() {
  cleanup();
  emit('cancel');
}

function cleanup() {
  if (blobUrl.value) { URL.revokeObjectURL(blobUrl.value); blobUrl.value = ''; }
  recordedBlob = null;
  recordedDurationMs = 0;
  timerLabel.value = '0:00';
}

/** Pick best supported MIME type for recording */
function getSupportedMimeType(): string {
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

onBeforeUnmount(() => {
  if (timerInterval) clearInterval(timerInterval);
  mediaRecorder?.stop();
  stopStream();
  if (blobUrl.value) URL.revokeObjectURL(blobUrl.value);
});
</script>

<style scoped>
.recording-dot {
  animation: blink 1s step-start infinite;
}
@keyframes blink {
  50% { opacity: 0; }
}
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
