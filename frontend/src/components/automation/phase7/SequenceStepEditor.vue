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
          <span class="delay-prefix">Chờ</span>
          <!-- 2026-06-04 — ô nhập số + đơn vị (Giây/Phút/Giờ/Ngày), auto-chọn. -->
          <TimeAmountInput
            :model-value="step.delayMinutes"
            base-unit="minute"
            :units="['minute','hour','day']"
            @update:model-value="(v: number) => updateDelay(idx, v)"
          />
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

          <!-- Thành phần trong khối (Anh chốt 2026-06-07: show được bao nhiêu thành phần) -->
          <div v-if="!blockArchived(step.blockId)" class="step-card__parts">
            <span
              v-for="(p, pi) in blockParts(step.blockId)"
              :key="pi"
              class="part-chip"
              :title="p.title"
            >
              <v-icon size="12">{{ p.icon }}</v-icon>{{ p.label }}
            </span>
            <span v-if="blockVariantCount(step.blockId) > 1" class="part-chip part-chip--variant" title="Số mẫu nội dung — gửi random 1 mẫu">
              <v-icon size="12">mdi-shuffle-variant</v-icon>{{ blockVariantCount(step.blockId) }} mẫu
            </span>
          </div>

          <div v-if="blockArchived(step.blockId)" class="step-card__warn">
            <v-icon size="12">mdi-alert-circle</v-icon>
            Khối đã archive — engine sẽ skip
          </div>
        </div>
        <div class="step-card__actions">
          <v-btn
            icon
            size="x-small"
            variant="text"
            :disabled="blockArchived(step.blockId)"
            @click="previewStep(idx)"
            title="Xem trước khối — KH sẽ thấy thế này trên Zalo"
          >
            <v-icon size="16">mdi-eye-outline</v-icon>
          </v-btn>
          <!-- Anh chốt 2026-06-07: cho ĐỔI khối ở MỌI bước (không chỉ bước cuối).
               Server vẫn chặn nếu luồng đang có KH chạy dở (sequence_edit_destructive). -->
          <v-btn
            icon
            size="x-small"
            variant="text"
            @click="editStep(idx)"
            title="Đổi khối ở bước này"
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
            :title="idx !== steps.length - 1 ? 'Chỉ được xoá step CUỐI — xoá step giữa làm lệch tin cho KH đang chờ delay' : 'Xoá bước'"
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
          <span>Chọn khối cho bước {{ pickerStepIdx !== null ? pickerStepIdx + 1 : 'mới' }}</span>
          <v-spacer />
          <v-btn icon variant="text" size="small" @click="pickerOpen = false"><v-icon>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-text-field v-model="pickerSearch" placeholder="Tìm khối theo tên / loại action..." variant="solo-filled" flat density="comfortable" prepend-inner-icon="mdi-magnify" clearable hide-details class="mb-3" />

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
            <div class="mt-2 text-caption">Không tìm thấy khối. Tạo khối ở tab "Thư viện khối" trước.</div>
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

    <!-- Block preview (chỉ-xem, không gửi) — Anh chốt 2026-06-07 -->
    <BlockPreviewDialog
      v-if="previewBlock"
      :visible="previewOpen"
      :block="previewBlock"
      contact-name="KH mẫu"
      nick-name="Nick của anh"
      preview-only
      @close="previewOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { ACTION_TYPE_LABELS, ACTION_TYPE_ICONS, type SequenceStep, type Block, type BlockActionType } from '@/api/automation/types';
import { ACTION_TYPE_COLOR } from './design-tokens';
import TimeAmountInput from '@/components/automation/TimeAmountInput.vue';
import BlockPreviewDialog from '@/components/chat/BlockPreviewDialog.vue';
import { useConfirm } from '@/composables/use-confirm';

const { confirm } = useConfirm();

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

function blockName(id: string): string { return blockMap.value.get(id)?.name ?? 'Khối đã xoá'; }
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

// ── Thành phần trong khối (Anh chốt 2026-06-07) ───────────────────────────
// Đọc block.content → list chip {icon,label,title} cho UI step card.
interface BlockPart { icon: string; label: string; title: string }
function blockParts(id: string): BlockPart[] {
  const b = blockMap.value.get(id);
  if (!b) return [];
  const c = (b.content ?? {}) as Record<string, any>;
  const parts: BlockPart[] = [];

  if (b.actionType === 'request_friend') {
    parts.push({ icon: 'mdi-hand-wave-outline', label: 'Lời mời', title: 'Lời chào kết bạn' });
    return parts;
  }

  if (b.actionType === 'update_status') {
    parts.push({ icon: 'mdi-tag-arrow-right', label: 'Đổi trạng thái', title: 'Đổi trạng thái KH' });
    return parts;
  }

  // send_message — đếm theo components[] (format mới) hoặc legacy textVariants/attachments.
  if (Array.isArray(c.components) && c.components.length > 0) {
    const counts: Record<string, number> = {};
    for (const cmp of c.components) counts[cmp?.kind ?? 'text'] = (counts[cmp?.kind ?? 'text'] ?? 0) + 1;
    pushKindChips(parts, counts);
    return parts;
  }
  // Legacy
  const textN = Array.isArray(c.textVariants) ? (c.textVariants.length > 0 ? 1 : 0) : 0;
  const counts: Record<string, number> = {};
  if (textN) counts.text = 1;
  if (Array.isArray(c.attachments)) {
    for (const a of c.attachments) counts[a?.kind ?? 'file'] = (counts[a?.kind ?? 'file'] ?? 0) + 1;
  }
  if (Object.keys(counts).length === 0) counts.text = 1; // mặc định 1 bóng text
  pushKindChips(parts, counts);
  return parts;
}

const KIND_META: Record<string, { icon: string; label: string }> = {
  text:  { icon: 'mdi-message-text-outline', label: 'Văn bản' },
  image: { icon: 'mdi-image-outline',        label: 'Ảnh' },
  album: { icon: 'mdi-image-multiple-outline', label: 'Album' },
  file:  { icon: 'mdi-paperclip',            label: 'File' },
  video: { icon: 'mdi-video-outline',        label: 'Video' },
  link:  { icon: 'mdi-link-variant',         label: 'Link' },
};
function pushKindChips(parts: BlockPart[], counts: Record<string, number>): void {
  // Giữ thứ tự ưu tiên: text → image → album → file → video → link
  for (const kind of ['text', 'image', 'album', 'file', 'video', 'link']) {
    const n = counts[kind];
    if (!n) continue;
    const meta = KIND_META[kind] ?? { icon: 'mdi-shape-outline', label: kind };
    parts.push({
      icon: meta.icon,
      label: n > 1 ? `${meta.label} ×${n}` : meta.label,
      title: `${n} ${meta.label.toLowerCase()}`,
    });
  }
}

// Tổng số mẫu (variant) text trong khối — gửi random 1 mẫu khi chạy thật.
function blockVariantCount(id: string): number {
  const b = blockMap.value.get(id);
  if (!b) return 0;
  const c = (b.content ?? {}) as Record<string, any>;
  if (Array.isArray(c.greetingVariants)) return c.greetingVariants.length;
  if (Array.isArray(c.components)) {
    let n = 0;
    for (const cmp of c.components) {
      if (cmp?.kind === 'text') n += (Array.isArray(cmp.variants) ? cmp.variants.length : 0) + 1;
    }
    return n;
  }
  if (Array.isArray(c.textVariants)) return c.textVariants.length;
  return 0;
}

// ── Preview khối (chỉ-xem) ────────────────────────────────────────────────
const previewOpen = ref(false);
const previewBlock = ref<Block | null>(null);
function previewStep(idx: number) {
  const b = blockMap.value.get(props.steps[idx].blockId);
  if (!b) return;
  previewBlock.value = b;
  previewOpen.value = true;
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
  // Anh chốt 2026-06-07: cho đổi khối ở MỌI bước. Nếu luồng đang có KH chạy dở,
  // server sẽ chặn khi lưu (sequence_edit_destructive) + hiện dialog hướng dẫn.
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
async function removeStep(idx: number) {
  // Chỉ cho phép xoá step CUỐI — xoá step giữa làm lệch tin cho KH đang chờ delay.
  // Nếu sale muốn restructure, tạo Sequence mới.
  if (idx !== props.steps.length - 1) return;
  if (!(await confirm({ title: 'Xoá bước cuối này?', message: 'Bước cuối sẽ bị gỡ khỏi luồng.', tone: 'danger', confirmText: 'Xoá bước', cancelText: 'Hủy' }))) return;
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
  font-family: var(--mono);
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
  background: var(--error-soft);
}

.step-card__num {
  width: 28px; height: 28px;
  border-radius: var(--at-r-sm);
  background: var(--card-tint);
  color: var(--card-text);
  font-family: var(--mono);
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

/* Thành phần trong khối — chips nhỏ (Anh chốt 2026-06-07) */
.step-card__parts {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
}
.part-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px 1px 5px;
  border-radius: var(--at-r-pill);
  background: var(--at-surface-soft);
  border: 1px solid var(--at-hairline);
  font-size: 11px;
  line-height: 1.6;
  color: var(--at-body);
  white-space: nowrap;
}
.part-chip--variant {
  background: var(--card-tint);
  border-color: transparent;
  color: var(--card-text);
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
