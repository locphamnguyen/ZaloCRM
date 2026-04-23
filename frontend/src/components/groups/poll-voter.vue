<template>
  <v-card variant="outlined" class="mb-2">
    <v-card-text class="pa-3">
      <!-- Question -->
      <div class="text-body-2 font-weight-medium mb-2">{{ poll.question }}</div>

      <!-- Meta chips -->
      <div class="d-flex gap-1 flex-wrap mb-3">
        <v-chip v-if="poll.isMultiChoice || poll.multi" size="x-small" color="blue" variant="tonal">
          Chọn nhiều
        </v-chip>
        <v-chip v-if="poll.isAnonymous || poll.anonymous" size="x-small" color="purple" variant="tonal">
          Ẩn danh
        </v-chip>
        <v-chip v-if="poll.isLocked || poll.locked" size="x-small" color="error" variant="tonal">
          Đã khóa
        </v-chip>
        <v-chip v-if="expiresText" size="x-small" color="warning" variant="tonal">
          {{ expiresText }}
        </v-chip>
      </div>

      <!-- Options -->
      <div class="mb-3">
        <div
          v-for="(opt, idx) in normalizedOptions"
          :key="idx"
          class="mb-2"
        >
          <div class="d-flex align-center gap-2 mb-1">
            <v-checkbox
              v-if="poll.isMultiChoice || poll.multi"
              v-model="selectedIds"
              :value="opt.id ?? idx"
              :label="opt.text || opt.name || String(opt)"
              density="compact"
              hide-details
              :disabled="isLocked || loading"
              class="flex-1-1"
            />
            <v-radio-group
              v-else
              v-model="singleSelected"
              hide-details
              density="compact"
              class="flex-1-1 mt-0"
            >
              <v-radio
                :label="opt.text || opt.name || String(opt)"
                :value="opt.id ?? idx"
                :disabled="isLocked || loading"
              />
            </v-radio-group>
            <span class="text-caption text-grey text-no-wrap">
              {{ opt.voteCount ?? 0 }} phiếu
            </span>
          </div>

          <!-- Vote progress bar -->
          <v-progress-linear
            v-if="totalVotes > 0"
            :model-value="votePercent(opt.voteCount ?? 0)"
            color="primary"
            height="4"
            rounded
            bg-color="grey-lighten-3"
          />
        </div>
      </div>

      <!-- Total votes -->
      <div class="text-caption text-grey mb-3">
        Tổng {{ totalVotes }} phiếu bầu
      </div>

      <!-- Actions -->
      <div class="d-flex gap-2 flex-wrap">
        <v-btn
          v-if="!isLocked"
          size="small"
          color="primary"
          variant="elevated"
          :loading="loading"
          :disabled="!hasSelection"
          @click="submitVote"
        >
          Bình chọn
        </v-btn>

        <v-btn
          v-if="canLock && !isLocked"
          size="small"
          color="warning"
          variant="tonal"
          :loading="loading"
          @click="$emit('lock', poll)"
        >
          Khóa bình chọn
        </v-btn>

        <v-btn
          v-if="canShare"
          size="small"
          color="secondary"
          variant="tonal"
          prepend-icon="mdi-share-variant"
          :loading="loading"
          @click="$emit('share', poll)"
        >
          Chia sẻ
        </v-btn>
      </div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

interface PollOption {
  id?: number;
  text?: string;
  name?: string;
  voteCount?: number;
}

interface Poll {
  id?: string;
  pollId?: string;
  question: string;
  options: PollOption[] | string[];
  isMultiChoice?: boolean;
  multi?: boolean;
  isAnonymous?: boolean;
  anonymous?: boolean;
  isLocked?: boolean;
  locked?: boolean;
  expiresAt?: string | null;
}

const props = defineProps<{
  poll: Poll;
  loading?: boolean;
  canLock?: boolean;
  canShare?: boolean;
}>();

const emit = defineEmits<{
  vote: [pollId: string, optionIds: number[]];
  lock: [poll: Poll];
  share: [poll: Poll];
}>();

// Normalise options — zca-js may return strings or objects
const normalizedOptions = computed<PollOption[]>(() => {
  return (props.poll.options ?? []).map((opt, idx) => {
    if (typeof opt === 'string') return { id: idx, text: opt, voteCount: 0 };
    return { id: (opt as PollOption).id ?? idx, ...opt as PollOption };
  });
});

const isLocked = computed(() => !!(props.poll.isLocked || props.poll.locked));

const totalVotes = computed(() =>
  normalizedOptions.value.reduce((sum, o) => sum + (o.voteCount ?? 0), 0),
);

function votePercent(count: number): number {
  if (totalVotes.value === 0) return 0;
  return Math.round((count / totalVotes.value) * 100);
}

const expiresText = computed(() => {
  if (!props.poll.expiresAt) return '';
  const d = new Date(props.poll.expiresAt);
  if (isNaN(d.getTime())) return '';
  const now = Date.now();
  if (d.getTime() < now) return 'Đã hết hạn';
  const diffH = Math.round((d.getTime() - now) / 3_600_000);
  return diffH < 24 ? `Còn ${diffH}h` : `HH ${d.toLocaleDateString('vi-VN')}`;
});

// Selection state
const selectedIds = ref<number[]>([]);   // multi-choice
const singleSelected = ref<number | null>(null); // single-choice

const hasSelection = computed(() => {
  if (props.poll.isMultiChoice || props.poll.multi) return selectedIds.value.length > 0;
  return singleSelected.value !== null;
});

// Reset when poll changes
watch(() => props.poll, () => {
  selectedIds.value = [];
  singleSelected.value = null;
}, { deep: true });

function submitVote() {
  const pollId = props.poll.id ?? props.poll.pollId ?? '';
  if (!pollId) return;
  const ids = (props.poll.isMultiChoice || props.poll.multi)
    ? selectedIds.value
    : singleSelected.value !== null ? [singleSelected.value] : [];
  if (ids.length === 0) return;
  emit('vote', pollId, ids);
}
</script>
