<template>
  <div class="sequences-view">
    <header class="at-page-header">
      <div>
        <h1 class="at-page-title">Luồng kịch bản</h1>
        <p class="at-page-subtitle">
          Luồng kịch bản ghép nhiều Khối thành chuỗi có delay. Mỗi KH được "enroll" sẽ trải qua từng bước theo thời gian.
        </p>
      </div>
      <button class="at-btn at-btn--primary" @click="createNew">
        <v-icon size="18">mdi-plus</v-icon>
        Luồng mới
      </button>
    </header>

    <div class="seq-layout">
      <!-- Sidebar: sequence list -->
      <aside class="seq-sidebar">
        <v-text-field
          v-model="search"
          placeholder="Tìm sequence..."
          variant="solo-filled"
          flat
          density="compact"
          prepend-inner-icon="mdi-magnify"
          hide-details
          clearable
          class="mb-2"
        />

        <div v-if="filteredSequences.length === 0" class="empty-seq-list">
          <v-icon size="36" color="grey-lighten-1">mdi-format-list-numbered</v-icon>
          <p class="text-caption mt-2 text-medium-emphasis">Chưa có sequence</p>
        </div>

        <ul v-else class="seq-list">
          <li v-for="seq in filteredSequences" :key="seq.id">
            <button
              class="seq-item"
              :class="{ 'is-active': seq.id === selectedSeqId }"
              @click="selectSequence(seq.id)"
            >
              <div class="seq-item__title">
                <span>{{ seq.name }}</span>
                <span v-if="!seq.enabled" class="seq-item__off-badge">tắt</span>
              </div>
              <div class="seq-item__meta">
                <span><v-icon size="11">mdi-format-list-bulleted</v-icon> {{ seq.steps.length }} bước</span>
                <span v-if="seq.enrolledCount > 0"><v-icon size="11">mdi-account-multiple</v-icon> {{ seq.enrolledCount }}</span>
              </div>
            </button>
          </li>
        </ul>
      </aside>

      <!-- Main: editor -->
      <section class="seq-editor">
        <div v-if="!editing" class="seq-empty">
          <v-icon size="80" color="grey-lighten-1">mdi-format-list-numbered</v-icon>
          <h3 class="mt-3">Chọn sequence ở sidebar</h3>
          <p class="text-body-2 text-medium-emphasis">hoặc bấm <strong>Luồng mới</strong> để tạo</p>
        </div>

        <div v-else>
        <div class="d-flex align-center mb-3">
          <v-text-field
            v-model="editing.name"
            variant="plain"
            density="compact"
            placeholder="Tên kịch bản..."
            hide-details
            class="text-h6"
            style="max-width: 480px;"
          />
          <v-spacer />
          <v-btn size="small" variant="text" :loading="saving" @click="saveSequence">
            <v-icon start>mdi-content-save</v-icon>
            Lưu
          </v-btn>
          <v-btn
            v-if="editing.id"
            size="small" variant="text"
            :color="editing.enabled ? 'success' : 'grey'"
            @click="toggleEnabled"
          >
            <v-icon start>{{ editing.enabled ? 'mdi-toggle-switch' : 'mdi-toggle-switch-off' }}</v-icon>
            {{ editing.enabled ? 'Đang bật' : 'Đang tắt' }}
          </v-btn>
          <v-btn v-if="editing.id" size="small" variant="text" @click="onDuplicate">
            <v-icon start>mdi-content-copy</v-icon> Nhân bản
          </v-btn>
          <v-btn v-if="editing.id" size="small" variant="text" color="error" @click="onDelete">
            <v-icon start>mdi-delete</v-icon> Xoá
          </v-btn>
        </div>

        <v-textarea
          v-model="editing.description"
          variant="outlined"
          density="compact"
          rows="2"
          placeholder="Mô tả ngắn (optional)"
          hide-details
          class="mb-4"
        />

        <!-- Runtime rules collapsible -->
        <v-expansion-panels variant="accordion" class="mb-4">
          <v-expansion-panel>
            <v-expansion-panel-title>
              <v-icon class="mr-2">mdi-cog</v-icon>
              Cấu hình chạy (delay, giờ, throttle, recency, stop-on-accept)
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="d-flex flex-wrap" style="gap: 16px;">
                <div style="min-width: 240px;">
                  <div class="text-caption mb-1">Giờ được phép chạy</div>
                  <div class="d-flex align-center" style="gap: 8px;">
                    <v-text-field :model-value="hourStart" @update:model-value="setHourStart($event)" type="number" min="0" max="23" variant="outlined" density="compact" hide-details style="width: 80px" />
                    <span>→</span>
                    <v-text-field :model-value="hourEnd" @update:model-value="setHourEnd($event)" type="number" min="0" max="23" variant="outlined" density="compact" hide-details style="width: 80px" />
                  </div>
                </div>
                <div style="min-width: 240px;">
                  <div class="text-caption mb-1">Delay ngẫu nhiên giữa mỗi lần gửi (phút)</div>
                  <div class="d-flex align-center" style="gap: 8px;">
                    <v-text-field :model-value="delayMin" @update:model-value="setDelayMin($event)" type="number" min="0" variant="outlined" density="compact" hide-details style="width: 80px" />
                    <span>→</span>
                    <v-text-field :model-value="delayMax" @update:model-value="setDelayMax($event)" type="number" min="0" variant="outlined" density="compact" hide-details style="width: 80px" />
                  </div>
                </div>
                <div style="min-width: 200px;">
                  <div class="text-caption mb-1">Cross-nick recency (ngày)</div>
                  <v-text-field :model-value="recencyDays" @update:model-value="setRecencyDays($event)" type="number" min="0" variant="outlined" density="compact" hide-details style="width: 120px" />
                  <div class="text-caption text-medium-emphasis mt-1">Bỏ qua nếu KH active với nick khác trong N ngày</div>
                </div>
                <v-switch
                  :model-value="editing.runtimeRules.perNickThrottle ?? true"
                  @update:model-value="editing.runtimeRules.perNickThrottle = !!$event"
                  label="Per-nick throttle (cap chia đều)"
                  hide-details
                />
                <v-switch
                  :model-value="editing.runtimeRules.stopOnAccept ?? true"
                  @update:model-value="editing.runtimeRules.stopOnAccept = !!$event"
                  label="Dừng các nick còn lại khi 1 nick đã accept"
                  hide-details
                />
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>

        <!-- Vertical step diagram -->
        <SequenceStepEditor
          :steps="editing.steps"
          :available-blocks="availableBlocks"
          @update:steps="editing.steps = $event"
        />

        <v-alert v-if="error" type="error" variant="tonal" class="mt-4" closable @click:close="error = ''">{{ error }}</v-alert>
        </div>
      </section>
    </div>

    <v-snackbar v-model="toastOpen" :color="toastColor" timeout="3000" location="bottom right">
      {{ toastMsg }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { sequencesApi, blocksApi } from '@/api/automation';
import type { AutomationSequence, SequenceStep, SequenceRuntimeRules, Block } from '@/api/automation/types';
import SequenceStepEditor from '@/components/automation/phase7/SequenceStepEditor.vue';

const sequences = ref<AutomationSequence[]>([]);
const availableBlocks = ref<Block[]>([]);
const selectedSeqId = ref<string | null>(null);
const search = ref('');
const error = ref('');
const saving = ref(false);

const toastOpen = ref(false);
const toastMsg = ref('');
const toastColor = ref<'success' | 'error' | 'info'>('info');
function showToast(msg: string, color: 'success' | 'error' | 'info' = 'info') {
  toastMsg.value = msg; toastColor.value = color; toastOpen.value = true;
}

interface DraftSequence {
  id: string | null;
  name: string;
  description: string;
  channel: string;
  enabled: boolean;
  steps: SequenceStep[];
  runtimeRules: SequenceRuntimeRules;
}
const editing = ref<DraftSequence | null>(null);

const filteredSequences = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return sequences.value;
  return sequences.value.filter((s) => s.name.toLowerCase().includes(q));
});

const hourStart = computed(() => editing.value?.runtimeRules.allowedHourRange?.[0] ?? 6);
const hourEnd   = computed(() => editing.value?.runtimeRules.allowedHourRange?.[1] ?? 22);
const delayMin  = computed(() => editing.value?.runtimeRules.randomDelayPerSend?.min ?? 15);
const delayMax  = computed(() => editing.value?.runtimeRules.randomDelayPerSend?.max ?? 45);
const recencyDays = computed(() => editing.value?.runtimeRules.crossNickRecencyDays ?? 30);

function setHourStart(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.allowedHourRange = [Number(v) || 0, hourEnd.value];
}
function setHourEnd(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.allowedHourRange = [hourStart.value, Number(v) || 0];
}
function setDelayMin(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.randomDelayPerSend = { min: Number(v) || 0, max: delayMax.value };
}
function setDelayMax(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.randomDelayPerSend = { min: delayMin.value, max: Number(v) || 0 };
}
function setRecencyDays(v: string | number) {
  if (!editing.value) return;
  editing.value.runtimeRules.crossNickRecencyDays = Number(v) || 0;
}

async function loadAll() {
  const [seqs, blocks] = await Promise.all([
    sequencesApi.listSequences(),
    blocksApi.listBlocks({ limit: 500 }),
  ]);
  sequences.value = seqs;
  availableBlocks.value = blocks;
}

onMounted(loadAll);

function selectSequence(id: string) {
  const seq = sequences.value.find((s) => s.id === id);
  if (!seq) return;
  selectedSeqId.value = id;
  editing.value = {
    id: seq.id,
    name: seq.name,
    description: seq.description ?? '',
    channel: seq.channel,
    enabled: seq.enabled,
    steps: JSON.parse(JSON.stringify(seq.steps)),
    runtimeRules: JSON.parse(JSON.stringify(seq.runtimeRules ?? {})),
  };
  error.value = '';
}

function createNew() {
  selectedSeqId.value = null;
  editing.value = {
    id: null,
    name: '',
    description: '',
    channel: 'zalo_user',
    enabled: false,
    steps: [],
    runtimeRules: {
      allowedHourRange: [6, 22],
      randomDelayPerSend: { min: 15, max: 45 },
      perNickThrottle: true,
      crossNickRecencyDays: 30,
      stopOnAccept: true,
    },
  };
  error.value = '';
}

async function saveSequence() {
  if (!editing.value) return;
  error.value = '';
  if (!editing.value.name.trim()) { error.value = 'Tên không được rỗng'; return; }
  if (editing.value.steps.length === 0) { error.value = 'Cần ít nhất 1 bước'; return; }
  saving.value = true;
  try {
    const input = {
      name: editing.value.name.trim(),
      description: editing.value.description,
      channel: editing.value.channel,
      steps: editing.value.steps,
      runtimeRules: editing.value.runtimeRules,
      enabled: editing.value.enabled,
    };
    let saved: AutomationSequence;
    if (editing.value.id) {
      saved = await sequencesApi.updateSequence(editing.value.id, input);
    } else {
      saved = await sequencesApi.createSequence(input);
    }
    await loadAll();
    selectSequence(saved.id);
    showToast('Đã lưu sequence', 'success');
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Lỗi không xác định';
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled() {
  if (!editing.value?.id) return;
  if (editing.value.enabled) {
    await sequencesApi.disableSequence(editing.value.id);
  } else {
    await sequencesApi.enableSequence(editing.value.id);
  }
  editing.value.enabled = !editing.value.enabled;
  await loadAll();
}

async function onDuplicate() {
  if (!editing.value?.id) return;
  const copy = await sequencesApi.duplicateSequence(editing.value.id);
  await loadAll();
  selectSequence(copy.id);
}

async function onDelete() {
  if (!editing.value?.id) return;
  if (!confirm(`Xoá sequence "${editing.value.name}"? Chỉ được xoá khi chưa có campaign.`)) return;
  try {
    await sequencesApi.deleteSequence(editing.value.id);
    editing.value = null;
    selectedSeqId.value = null;
    await loadAll();
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.response?.data?.error || 'Không xoá được';
  }
}
</script>

<style scoped>
.sequences-view { max-width: 1280px; }

.seq-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: var(--at-s-lg);
  align-items: start;
}

.seq-sidebar {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-sm);
  position: sticky;
  top: 12px;
  max-height: calc(100vh - 180px);
  overflow-y: auto;
}

.seq-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
.seq-item {
  width: 100%;
  background: transparent;
  border: 0;
  border-radius: var(--at-r-sm);
  padding: 10px 12px;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
}
.seq-item:hover { background: var(--at-surface-soft); }
.seq-item.is-active {
  background: var(--at-ink);
  color: var(--at-on-primary);
}
.seq-item__title {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 14px;
  font-weight: 500;
  color: var(--at-ink);
}
.seq-item.is-active .seq-item__title { color: var(--at-on-primary); }
.seq-item__off-badge {
  font-size: 10px;
  background: var(--at-surface-soft);
  padding: 2px 6px;
  border-radius: var(--at-r-sm);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  font-weight: 500;
  color: var(--at-muted);
}
.seq-item.is-active .seq-item__off-badge {
  background: rgba(255,255,255,0.15);
  color: var(--at-on-primary);
}
.seq-item__meta {
  display: flex;
  gap: 12px;
  font-size: 12px;
  color: var(--at-muted);
  margin-top: 2px;
}
.seq-item.is-active .seq-item__meta { color: rgba(255,255,255,0.7); }
.seq-item__meta span { display: inline-flex; align-items: center; gap: 3px; }

.empty-seq-list {
  text-align: center;
  padding: 24px 12px;
  color: var(--at-muted);
}

.seq-editor {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-lg);
  min-height: calc(100vh - 200px);
}
.seq-empty {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  text-align: center;
  height: 60vh;
  color: var(--at-muted);
}
.seq-empty h3 {
  font-size: 18px;
  font-weight: 500;
  margin: 12px 0 4px;
  color: var(--at-ink);
}

@media (max-width: 900px) {
  .seq-layout { grid-template-columns: 1fr; }
  .seq-sidebar { position: relative; max-height: none; }
}
</style>
