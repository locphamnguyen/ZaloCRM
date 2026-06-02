<template>
  <div class="sequence-step-editor">
    <!-- START node -->
    <div class="flow-node start-node">
      <v-icon size="20" color="success">mdi-play-circle</v-icon>
      <span>Bắt đầu khi KH được enroll</span>
    </div>

    <!-- Steps with delay arrows -->
    <template v-for="(step, idx) in steps" :key="step.stepId">
      <!-- Delay pill between previous node and this step -->
      <div class="flow-connector">
        <div class="flow-line" />
        <div class="delay-pill">
          <v-icon size="14">mdi-timer-sand</v-icon>
          <v-text-field
            :model-value="step.delayMinutes"
            @update:model-value="updateDelay(idx, $event)"
            variant="plain"
            density="compact"
            type="number"
            min="0"
            hide-details
            class="delay-input"
          />
          <span class="delay-unit">phút</span>
        </div>
      </div>

      <!-- Step card -->
      <div
        class="step-card"
        :style="cardStyleFor(step.blockId)"
        :class="{ 'is-broken': blockArchived(step.blockId) }"
      >
        <div class="step-card__num">{{ idx + 1 }}</div>
        <div class="step-card__icon">
          <v-icon size="22">{{ blockIcon(step.blockId) }}</v-icon>
        </div>
        <div class="step-card__body">
          <div class="step-card__label">Bước {{ idx + 1 }} · {{ blockActionLabel(step.blockId) }}</div>
          <div class="step-card__title">{{ blockName(step.blockId) }}</div>
          <div v-if="blockArchived(step.blockId)" class="step-card__warn">
            <v-icon size="12">mdi-alert-circle</v-icon>
            Block đã archive — engine sẽ skip
          </div>
        </div>
        <div class="step-card__actions">
          <v-btn
            icon
            size="x-small"
            variant="text"
            :disabled="idx !== steps.length - 1"
            @click="editStep(idx)"
            :title="idx !== steps.length - 1 ? 'Chỉ được đổi block ở step CUỐI — đổi step giữa làm lệch tin cho KH đang chờ delay' : 'Đổi block'"
          >
            <v-icon size="16">mdi-swap-horizontal</v-icon>
          </v-btn>
          <v-btn
            icon
            size="x-small"
            variant="text"
            color="error"
            :disabled="idx !== steps.length - 1"
            @click="removeStep(idx)"
            :title="idx !== steps.length - 1 ? 'Chỉ được xoá step CUỐI — sửa step giữa làm lệch tin cho KH đang chờ delay' : 'Xoá'"
          >
            <v-icon size="16">mdi-close</v-icon>
          </v-btn>
        </div>
      </div>
    </template>

    <!-- END + Add button -->
    <div v-if="steps.length > 0" class="flow-connector">
      <div class="flow-line" />
    </div>
    <div v-if="steps.length > 0" class="flow-node end-node">
      <v-icon size="18" color="grey">mdi-flag-checkered</v-icon>
      <span>Kết thúc flow</span>
    </div>

    <div class="add-step-wrap">
      <v-btn color="primary" variant="tonal" rounded prepend-icon="mdi-plus" @click="addStep">
        Thêm bước
      </v-btn>
    </div>

    <!-- Block picker dialog -->
    <v-dialog v-model="pickerOpen" max-width="640">
      <v-card>
        <v-card-title class="d-flex align-center">
          <v-icon class="mr-2">mdi-puzzle</v-icon>
          <span>Chọn block cho bước {{ pickerStepIdx !== null ? pickerStepIdx + 1 : 'mới' }}</span>
          <v-spacer />
          <v-btn icon variant="text" size="small" @click="pickerOpen = false"><v-icon>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-text-field v-model="pickerSearch" placeholder="Tìm block theo tên / loại action..." variant="solo-filled" flat density="comfortable" prepend-inner-icon="mdi-magnify" clearable hide-details class="mb-3" />

          <v-text-field
            v-if="pickerStepIdx !== null"
            :model-value="steps[pickerStepIdx].delayMinutes"
            @update:model-value="updateDelay(pickerStepIdx, $event)"
            type="number" min="0"
            label="Delay trước bước này (phút)"
            variant="outlined" density="compact"
            prepend-inner-icon="mdi-timer-sand"
            class="mb-3"
          />

          <div v-if="filteredPickerBlocks.length === 0" class="text-center pa-6 text-medium-emphasis">
            <v-icon size="36" color="grey-lighten-1">mdi-puzzle-outline</v-icon>
            <div class="mt-2 text-caption">Không tìm thấy block. Tạo block ở tab "Thư viện block" trước.</div>
          </div>

          <div v-else class="block-picker-grid">
            <button
              v-for="block in filteredPickerBlocks"
              :key="block.id"
              class="picker-item"
              :style="pickerItemStyle(block.actionType)"
              @click="pickBlock(block.id)"
            >
              <div class="picker-item__icon">
                <v-icon size="18">{{ ACTION_TYPE_ICONS[block.actionType] }}</v-icon>
              </div>
              <div class="picker-item__body">
                <div class="picker-item__name">{{ block.name }}</div>
                <div class="picker-item__type">{{ ACTION_TYPE_LABELS[block.actionType] }}</div>
              </div>
              <v-icon size="16" color="grey">mdi-chevron-right</v-icon>
            </button>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ACTION_TYPE_LABELS, ACTION_TYPE_ICONS, type SequenceStep, type Block, type BlockActionType } from '@/api/automation/types';
import { ACTION_TYPE_COLOR } from './design-tokens';

const props = defineProps<{
  steps: SequenceStep[];
  availableBlocks: Block[];
}>();
const emit = defineEmits<{ 'update:steps': [SequenceStep[]] }>();

const pickerOpen = ref(false);
const pickerStepIdx = ref<number | null>(null);
const pickerSearch = ref('');

const blockMap = computed(() => {
  const m = new Map<string, Block>();
  for (const b of props.availableBlocks) m.set(b.id, b);
  return m;
});

function blockName(id: string): string { return blockMap.value.get(id)?.name ?? '⚠ Block đã xoá'; }
function blockIcon(id: string): string {
  const b = blockMap.value.get(id);
  return b ? ACTION_TYPE_ICONS[b.actionType] : 'mdi-help-circle-outline';
}
function blockActionType(id: string): BlockActionType {
  return blockMap.value.get(id)?.actionType ?? 'send_message';
}
function blockActionLabel(id: string): string {
  return ACTION_TYPE_LABELS[blockActionType(id)];
}
function blockArchived(id: string): boolean {
  return Boolean(blockMap.value.get(id)?.archivedAt);
}
function cardStyleFor(blockId: string): Record<string, string> {
  const c = ACTION_TYPE_COLOR[blockActionType(blockId)];
  return { '--card-accent': c.bg, '--card-tint': c.tint, '--card-text': c.text };
}
function pickerItemStyle(actionType: BlockActionType): Record<string, string> {
  const c = ACTION_TYPE_COLOR[actionType];
  return { '--pick-bg': c.tint, '--pick-text': c.text };
}

const filteredPickerBlocks = computed(() => {
  const q = pickerSearch.value.trim().toLowerCase();
  return props.availableBlocks.filter((b) => {
    if (b.archivedAt) return false;
    if (!q) return true;
    return b.name.toLowerCase().includes(q) || ACTION_TYPE_LABELS[b.actionType].toLowerCase().includes(q);
  });
});

function emitSteps(newSteps: SequenceStep[]) { emit('update:steps', newSteps); }

function addStep() {
  pickerStepIdx.value = null;
  pickerOpen.value = true;
}
function editStep(idx: number) {
  // Đổi blockId step giữa = destructive_reorder ngầm → chỉ cho phép step CUỐI.
  if (idx !== props.steps.length - 1) return;
  pickerStepIdx.value = idx;
  pickerOpen.value = true;
}
function pickBlock(blockId: string) {
  if (pickerStepIdx.value === null) {
    const newStep: SequenceStep = {
      stepId: `s${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      blockId,
      delayMinutes: props.steps.length === 0 ? 0 : 30,
    };
    emitSteps([...props.steps, newStep]);
  } else {
    const newSteps = [...props.steps];
    newSteps[pickerStepIdx.value] = { ...newSteps[pickerStepIdx.value], blockId };
    emitSteps(newSteps);
  }
  pickerOpen.value = false;
}
function updateDelay(idx: number, value: string | number) {
  const newSteps = [...props.steps];
  const n = Math.max(0, Number(value) || 0);
  newSteps[idx] = { ...newSteps[idx], delayMinutes: n };
  emitSteps(newSteps);
}
function removeStep(idx: number) {
  // Chỉ cho phép xoá step CUỐI — xoá step giữa làm lệch tin cho KH đang chờ delay.
  // Nếu sale muốn restructure, tạo Sequence mới.
  if (idx !== props.steps.length - 1) return;
  if (!confirm('Xoá bước cuối này?')) return;
  emitSteps(props.steps.filter((_, i) => i !== idx));
}
</script>

<style scoped>
.sequence-step-editor {
  max-width: 640px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 100%;
}

@media (max-width: 767px) {
  .sequence-step-editor { max-width: 100%; }
}

.flow-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border-radius: var(--at-r-pill);
  font-size: 13px;
  font-weight: 500;
}
.start-node {
  background: var(--at-cream);
  color: var(--at-ink);
}
.end-node {
  background: var(--at-surface-soft);
  color: var(--at-muted);
  border: 1px solid var(--at-hairline);
}

.flow-connector {
  position: relative;
  height: 48px;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.flow-line {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  background: var(--at-hairline);
  transform: translateX(-0.5px);
}
.delay-pill {
  position: relative;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  padding: 4px 10px 4px 8px;
  border-radius: var(--at-r-pill);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--at-body);
}
.delay-input {
  width: 56px !important;
  font-size: 12px !important;
}
.delay-input :deep(input) {
  text-align: center;
  padding: 0 !important;
  min-height: unset !important;
  height: 20px !important;
  color: var(--at-ink);
}
.delay-unit { color: var(--at-muted); }

.step-card {
  width: 100%;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-sm) var(--at-s-md);
  display: flex;
  align-items: center;
  gap: var(--at-s-sm);
  position: relative;
  transition: border-color 0.1s;
}
.step-card::before {
  content: '';
  position: absolute;
  left: 0; top: 12px; bottom: 12px;
  width: 3px;
  border-radius: 2px;
  background: var(--card-accent);
}
.step-card:hover { border-color: var(--card-accent); }
.step-card.is-broken {
  opacity: 0.6;
  background: rgba(170, 45, 0, 0.04);
}

.step-card__num {
  width: 28px; height: 28px;
  border-radius: var(--at-r-sm);
  background: var(--card-tint);
  color: var(--card-text);
  font-weight: 500;
  font-size: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.step-card__icon {
  width: 40px; height: 40px;
  border-radius: var(--at-r-md);
  background: var(--card-accent);
  color: var(--at-on-primary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.step-card__body { flex: 1; min-width: 0; }
.step-card__label {
  font-size: 10.5px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--at-muted);
}
.step-card__title {
  font-size: 14px;
  font-weight: 500;
  color: var(--at-ink);
  margin-top: 1px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.step-card__warn {
  font-size: 12px;
  color: var(--at-coral);
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.step-card__actions {
  display: flex;
  align-items: center;
  gap: 0;
  flex-shrink: 0;
}

.add-step-wrap {
  margin-top: var(--at-s-md);
}

.block-picker-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 360px;
  overflow-y: auto;
}
.picker-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  cursor: pointer;
  text-align: left;
  width: 100%;
  font-family: inherit;
}
.picker-item:hover {
  background: var(--pick-bg);
  border-color: var(--pick-text);
}
.picker-item__icon {
  width: 32px; height: 32px;
  border-radius: var(--at-r-sm);
  background: var(--pick-bg);
  color: var(--pick-text);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.picker-item__body { flex: 1; min-width: 0; }
.picker-item__name {
  font-size: 14px;
  font-weight: 500;
  color: var(--at-ink);
}
.picker-item__type {
  font-size: 12px;
  color: var(--at-muted);
  margin-top: 1px;
}
</style>
