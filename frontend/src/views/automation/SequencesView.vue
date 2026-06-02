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
        <!-- Top bar: name + Lưu + Switch on/off + kebab menu -->
        <div class="seq-topbar">
          <v-text-field
            v-model="editing.name"
            variant="plain"
            density="compact"
            placeholder="Tên luồng kịch bản..."
            hide-details
            class="seq-topbar__name"
          />
          <div class="seq-topbar__actions">
            <v-btn size="small" variant="tonal" :loading="saving" @click="saveSequence">
              <v-icon start>mdi-content-save</v-icon>
              Lưu
            </v-btn>
            <v-switch
              v-if="editing.id"
              :model-value="editing.enabled"
              @update:model-value="toggleEnabled"
              color="success"
              :label="editing.enabled ? 'Đang chạy' : 'Đang tắt'"
              hide-details
              density="compact"
              inset
              class="seq-topbar__switch"
            />
            <v-menu v-if="editing.id">
              <template #activator="{ props }">
                <v-btn icon="mdi-dots-vertical" size="small" variant="text" v-bind="props" />
              </template>
              <v-list density="compact">
                <v-list-item @click="onDuplicate" prepend-icon="mdi-content-copy">
                  <v-list-item-title>Nhân bản luồng</v-list-item-title>
                </v-list-item>
                <v-list-item @click="onDelete" prepend-icon="mdi-delete" class="text-error">
                  <v-list-item-title>Xoá luồng</v-list-item-title>
                </v-list-item>
              </v-list>
            </v-menu>
          </div>
        </div>

        <v-textarea
          v-model="editing.description"
          variant="outlined"
          density="compact"
          rows="2"
          placeholder="Mô tả ngắn (tuỳ chọn)"
          hide-details
          class="mb-4"
        />

        <!-- 3 setting cards: Khi nào / Bảo vệ KH / Dừng bám đuổi -->
        <div class="seq-rule-cards">
          <!-- Card 1: Khi nào chạy -->
          <div class="seq-rule-card">
            <div class="seq-rule-card__header">
              <v-icon size="20" color="primary">mdi-clock-outline</v-icon>
              <strong>Khi nào chạy</strong>
            </div>
            <div class="seq-rule-card__body">
              <div class="seq-rule-row">
                <label>Giờ làm việc</label>
                <div class="seq-rule-input-pair">
                  <v-text-field :model-value="hourStart" @update:model-value="setHourStart($event)" type="number" min="0" max="23" variant="outlined" density="compact" hide-details suffix="h" />
                  <span class="seq-rule-arrow">→</span>
                  <v-text-field :model-value="hourEnd" @update:model-value="setHourEnd($event)" type="number" min="0" max="23" variant="outlined" density="compact" hide-details suffix="h" />
                </div>
                <p class="seq-rule-hint">
                  Chỉ gửi từ {{ hourStart }}h đến {{ hourEnd }}h (giờ Việt Nam). Ngoài khung này sẽ hoãn sang sáng hôm sau.
                </p>
              </div>
              <div class="seq-rule-row">
                <label>Giãn cách giữa các lần gửi</label>
                <div class="seq-rule-input-pair">
                  <v-text-field :model-value="delayMin" @update:model-value="setDelayMin($event)" type="number" min="0" variant="outlined" density="compact" hide-details suffix="phút" />
                  <span class="seq-rule-arrow">→</span>
                  <v-text-field :model-value="delayMax" @update:model-value="setDelayMax($event)" type="number" min="0" variant="outlined" density="compact" hide-details suffix="phút" />
                </div>
                <p class="seq-rule-hint">
                  Mỗi nick chờ ngẫu nhiên {{ delayMin === delayMax ? delayMin : `${delayMin}–${delayMax}` }} phút trước khi gửi tin tiếp theo. Giả lập tự nhiên, tránh Zalo phát hiện bot.
                </p>
              </div>
            </div>
          </div>

          <!-- Card 2: Bảo vệ KH không spam -->
          <div class="seq-rule-card">
            <div class="seq-rule-card__header">
              <v-icon size="20" color="warning">mdi-shield-account-outline</v-icon>
              <strong>Bảo vệ KH không spam</strong>
            </div>
            <div class="seq-rule-card__body">
              <div class="seq-rule-row">
                <label>Tránh gửi trùng KH</label>
                <div class="seq-rule-input-pair">
                  <v-text-field :model-value="recencyDays" @update:model-value="setRecencyDays($event)" type="number" min="0" variant="outlined" density="compact" hide-details suffix="ngày" style="max-width: 140px" />
                </div>
                <p class="seq-rule-hint" v-if="recencyDays > 0">
                  Nếu KH đã chạm với nick CRM khác trong <strong>{{ recencyDays }} ngày</strong> qua → bỏ qua, không bám đuổi (tránh nhiều sale spam 1 KH).
                </p>
                <p class="seq-rule-hint" v-else>
                  <strong>Đã tắt</strong> — gửi cho mọi KH, kể cả nick khác vừa chăm hôm qua. Phù hợp test, KHÔNG khuyến nghị production.
                </p>
              </div>
              <div class="seq-rule-row seq-rule-row--switch">
                <v-switch
                  :model-value="editing.runtimeRules.perNickThrottle ?? true"
                  @update:model-value="editing.runtimeRules.perNickThrottle = !!$event"
                  color="success"
                  hide-details
                  density="compact"
                  inset
                />
                <div>
                  <label>Giãn đều số tin giữa các nick</label>
                  <p class="seq-rule-hint">
                    Nick nào gửi gần đây phải chờ; nick chưa gửi sẽ ưu tiên. Phân bổ tải đều, tránh 1 nick gửi dồn quá nhiều.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- Card 3: Khi nào dừng bám đuổi -->
          <div class="seq-rule-card">
            <div class="seq-rule-card__header">
              <v-icon size="20" color="error">mdi-stop-circle-outline</v-icon>
              <strong>Khi nào dừng bám đuổi</strong>
            </div>
            <div class="seq-rule-card__body">
              <div class="seq-rule-row seq-rule-row--switch">
                <v-switch
                  :model-value="editing.runtimeRules.stopOnAccept ?? true"
                  @update:model-value="editing.runtimeRules.stopOnAccept = !!$event"
                  color="success"
                  hide-details
                  density="compact"
                  inset
                />
                <div>
                  <label>Dừng nick khác khi 1 nick đã kết bạn</label>
                  <p class="seq-rule-hint">
                    Nếu 1 nick được KH đồng ý kết bạn → các nick còn lại tự dừng gửi tin nhắn (tránh nhiều nick cùng chăm 1 KH).
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

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

    <!-- Destructive edit dialog (server rejected mutable-sequence edit) -->
    <v-dialog v-model="destructiveDialogOpen" max-width="520" persistent>
      <v-card>
        <v-card-title class="d-flex align-center destructive-dialog__header">
          <v-icon color="error" class="mr-2">mdi-alert-octagon</v-icon>
          <span>Không thể sửa bước giữa chuỗi</span>
        </v-card-title>
        <v-divider />
        <v-card-text class="destructive-dialog__body">
          <p class="mb-2">{{ destructiveHint }}</p>
          <p class="text-caption text-medium-emphasis mb-0">
            Mẹo: nếu cần restructure, hãy tạo Sequence mới và bật song song — KH hiện tại sẽ chạy hết flow cũ rồi mới được enroll vào flow mới.
          </p>
        </v-card-text>
        <v-divider />
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="destructiveDialogOpen = false">Đã hiểu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
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

// Destructive edit dialog (server rejects xoá/đổi step giữa chuỗi)
const destructiveDialogOpen = ref(false);
const destructiveHint = ref('');

/**
 * Extract user-facing error message from axios error.
 * BE Wave 3 uses { error, code, hint } envelope; older endpoints used { detail }.
 * Prefer `hint` (tiếng Việt, sale-friendly) > detail > error > axios message.
 */
function extractErrorMsg(err: any): string {
  return (
    err?.response?.data?.hint ||
    err?.response?.data?.detail ||
    err?.response?.data?.error ||
    err?.message ||
    'Lỗi không xác định'
  );
}

/**
 * If server returned `error: "sequence_edit_destructive"`, surface a Vuetify
 * dialog with the Vietnamese hint instead of a tiny inline alert.
 * Returns true if dialog was shown (caller should skip inline error).
 */
function maybeShowDestructiveDialog(err: any): boolean {
  const code = err?.response?.data?.error;
  if (code === 'sequence_edit_destructive') {
    destructiveHint.value =
      err?.response?.data?.hint ||
      err?.response?.data?.detail ||
      'Không thể xoá hoặc đổi bước ở giữa chuỗi vì đang có KH chạy dở.';
    destructiveDialogOpen.value = true;
    return true;
  }
  return false;
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
    if (!maybeShowDestructiveDialog(err)) {
      error.value = extractErrorMsg(err);
    }
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
    if (!maybeShowDestructiveDialog(err)) {
      error.value = extractErrorMsg(err) || 'Không xoá được';
    }
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

/* ── Wave 1.5-C UI Redesign: top bar + 3 rule cards ──────────────────────── */
.seq-topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--at-border);
}
.seq-topbar__name {
  flex: 1;
  font-size: 18px;
  font-weight: 600;
}
.seq-topbar__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.seq-topbar__switch {
  margin: 0 4px;
}
.seq-topbar__switch :deep(.v-label) {
  font-size: 13px;
  opacity: 1;
  font-weight: 500;
}

.seq-rule-cards {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}
.seq-rule-card {
  background: #fff;
  border: 1px solid var(--at-border);
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.15s ease;
}
.seq-rule-card:hover {
  border-color: var(--at-accent-soft, #cbd5e1);
}
.seq-rule-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #f8fafc;
  border-bottom: 1px solid var(--at-border);
  font-size: 14px;
}
.seq-rule-card__header strong {
  color: var(--at-ink);
}
.seq-rule-card__body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.seq-rule-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.seq-rule-row > label {
  font-size: 13px;
  font-weight: 500;
  color: var(--at-ink);
}
.seq-rule-row--switch {
  flex-direction: row;
  align-items: flex-start;
  gap: 12px;
}
.seq-rule-row--switch > div {
  flex: 1;
}
.seq-rule-input-pair {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 300px;
}
.seq-rule-input-pair :deep(.v-text-field) {
  max-width: 110px;
}
.seq-rule-arrow {
  color: var(--at-ink-muted);
  font-weight: 500;
}
.seq-rule-hint {
  font-size: 12px;
  color: var(--at-ink-muted);
  line-height: 1.45;
  margin: 0;
}
.seq-rule-hint strong {
  color: var(--at-ink);
  font-weight: 600;
}

/* ── Destructive edit dialog (xoá/đổi step giữa chuỗi) ─────────────────── */
.destructive-dialog__header {
  background: rgba(170, 45, 0, 0.06);
  color: #aa2d00;
  font-size: 15px;
  font-weight: 600;
}
.destructive-dialog__body {
  padding-top: 16px !important;
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--at-ink);
}
</style>
