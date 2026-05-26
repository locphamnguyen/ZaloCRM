<template>
  <div class="broadcasts-view">
    <header class="at-page-header">
      <div>
        <h1 class="at-page-title">Broadcast</h1>
        <p class="at-page-subtitle">
          Mass send qua Zalo cá nhân với pacing per-nick (cap, hour range, throttle).
          Mỗi Broadcast = 1 Khối tin nhắn + 1 segment + lịch chạy.
        </p>
      </div>
      <button class="at-btn at-btn--primary" @click="openCreate">
        <v-icon size="18">mdi-plus</v-icon>
        Broadcast mới
      </button>
    </header>

    <!-- Filter bar -->
    <div class="filter-bar">
      <button
        v-for="f in stateFilters"
        :key="f.key"
        class="filter-chip"
        :class="{ 'is-active': stateFilter === f.key }"
        @click="stateFilter = f.key"
      >
        {{ f.label }}
        <span v-if="countByState[f.key]" class="filter-chip__count">{{ countByState[f.key] }}</span>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="at-empty">
      <v-progress-circular indeterminate size="28" color="primary" />
    </div>

    <!-- Empty -->
    <div v-else-if="filtered.length === 0" class="at-empty">
      <v-icon size="48">mdi-bullhorn-outline</v-icon>
      <div class="at-empty__title">{{ emptyMsg }}</div>
      <p v-if="stateFilter === 'all'" class="at-empty__desc">
        Tạo broadcast đầu tiên: pick 1 block send_message + segment (manual list / filter / customer-list).
      </p>
      <button v-if="stateFilter === 'all'" class="at-btn at-btn--primary" @click="openCreate">
        <v-icon size="18">mdi-plus</v-icon>
        Tạo broadcast
      </button>
    </div>

    <!-- List -->
    <div v-else class="bc-list">
      <article v-for="bc in filtered" :key="bc.id" class="bc-card">
        <div class="bc-card__head">
          <div class="bc-card__title-block">
            <span class="bc-state" :class="`bc-state--${bc.state}`">{{ stateLabel(bc.state) }}</span>
            <h3 class="bc-card__title">{{ bc.name }}</h3>
          </div>
          <div class="bc-card__actions">
            <button v-if="['draft','scheduled','paused'].includes(bc.state)" class="at-btn at-btn--primary at-btn--sm" @click="onStart(bc)">
              <v-icon size="16">mdi-play</v-icon>
              {{ bc.state === 'paused' ? 'Tiếp tục' : 'Chạy' }}
            </button>
            <button v-if="bc.state === 'running'" class="at-btn at-btn--secondary at-btn--sm" @click="onPause(bc)">
              <v-icon size="16">mdi-pause</v-icon>
              Tạm dừng
            </button>
            <button v-if="['running','paused','scheduled'].includes(bc.state)" class="at-btn at-btn--ghost at-btn--sm" @click="onCancel(bc)" style="color: var(--at-coral);">
              <v-icon size="16">mdi-stop-circle-outline</v-icon>
              Huỷ
            </button>
            <button v-if="bc.state === 'draft'" class="at-btn at-btn--ghost at-btn--sm" @click="openEdit(bc)">
              <v-icon size="16">mdi-pencil-outline</v-icon>
            </button>
            <button v-if="bc.state === 'draft'" class="at-btn at-btn--ghost at-btn--sm" @click="onDelete(bc)" style="color: var(--at-coral);">
              <v-icon size="16">mdi-delete-outline</v-icon>
            </button>
          </div>
        </div>

        <p v-if="bc.description" class="bc-card__desc">{{ bc.description }}</p>

        <div class="bc-stats">
          <div class="bc-stat">
            <div class="bc-stat__label">Recipient</div>
            <div class="bc-stat__value">{{ bc.totalRecipients }}</div>
          </div>
          <div class="bc-stat">
            <div class="bc-stat__label">Đã gửi</div>
            <div class="bc-stat__value">{{ bc.sentCount }}<span class="bc-stat__divider">/{{ bc.totalRecipients }}</span></div>
          </div>
          <div class="bc-stat">
            <div class="bc-stat__label">Thất bại</div>
            <div class="bc-stat__value">{{ bc.failedCount }}</div>
          </div>
          <div class="bc-stat">
            <div class="bc-stat__label">Schedule</div>
            <div class="bc-stat__value bc-stat__value--small">
              {{ bc.scheduleKind === 'now' ? 'Chạy ngay' : bc.scheduledAt ? formatDate(bc.scheduledAt) : '—' }}
            </div>
          </div>
        </div>

        <!-- Progress bar -->
        <div v-if="bc.totalRecipients > 0" class="bc-progress">
          <div
            class="bc-progress__fill"
            :style="{ width: `${Math.min(100, (bc.sentCount / bc.totalRecipients) * 100)}%` }"
          />
        </div>
      </article>
    </div>

    <!-- Editor dialog -->
    <v-dialog v-model="editorOpen" max-width="640" persistent>
      <div v-if="draft" class="airtable-scope editor-card">
        <div class="editor-card__head">
          <div>
            <div class="at-title-sm">{{ draft.id ? 'Sửa Broadcast' : 'Tạo Broadcast' }}</div>
            <div class="at-caption">{{ draft.scheduleKind === 'now' ? 'Chạy ngay sau khi bấm Start' : 'Lên lịch' }}</div>
          </div>
          <button class="editor-card__close" @click="editorOpen = false"><v-icon>mdi-close</v-icon></button>
        </div>
        <hr class="at-hairline" />
        <div class="editor-card__body">
          <div class="form-field">
            <label class="form-label">Tên broadcast</label>
            <input v-model="draft.name" class="at-input" placeholder="Ví dụ: Tết 2026 — chúc mừng năm mới" />
          </div>
          <div class="form-field">
            <label class="form-label">Mô tả (optional)</label>
            <input v-model="draft.description" class="at-input" placeholder="Note nội bộ cho team" />
          </div>

          <div class="form-field">
            <label class="form-label">Khối tin nhắn (send_message)</label>
            <select v-model="draft.blockId" class="at-input">
              <option :value="''">— Chọn Khối —</option>
              <option v-for="b in sendMessageBlocks" :key="b.id" :value="b.id">{{ b.name }}</option>
            </select>
            <p v-if="sendMessageBlocks.length === 0" class="at-caption form-hint">
              Chưa có Khối send_message. Tạo ở tab "Khối" trước.
            </p>
          </div>

          <div class="form-field">
            <label class="form-label">Segment (tệp KH nhận)</label>
            <select v-model="segmentKind" class="at-input">
              <option value="filter">Filter Contact (có Zalo + có status...)</option>
              <option value="manual">Danh sách contactId thủ công</option>
              <option value="customer-list">Tệp khách hàng (CustomerList)</option>
            </select>
            <textarea
              v-if="segmentKind === 'manual'"
              v-model="manualContactIdsText"
              class="at-input"
              style="min-height: 80px; padding: 10px;"
              placeholder="Mỗi dòng 1 contactId"
            />
            <input
              v-if="segmentKind === 'customer-list'"
              v-model="customerListId"
              class="at-input"
              placeholder="CustomerList ID"
            />
            <p v-if="segmentKind === 'filter'" class="at-caption form-hint">
              Mặc định filter "hasZalo=true + acceptedNicksCount > 0" (chỉ KH có thể nhận tin).
            </p>
          </div>

          <div class="form-field">
            <label class="form-label">Lịch chạy</label>
            <select v-model="draft.scheduleKind" class="at-input">
              <option value="now">Chạy ngay (sau khi bấm Start)</option>
              <option value="scheduled">Lên lịch chạy 1 lần</option>
            </select>
            <input
              v-if="draft.scheduleKind === 'scheduled'"
              v-model="draft.scheduledAt"
              type="datetime-local"
              class="at-input"
            />
          </div>

          <div class="form-row">
            <div class="form-field">
              <label class="form-label">Max msg/giờ/nick</label>
              <input
                v-model.number="pacing.maxPerNickPerHour"
                type="number" min="1" max="300"
                class="at-input"
              />
            </div>
            <div class="form-field">
              <label class="form-label">Giờ start–end (0-23)</label>
              <div style="display: flex; gap: 8px;">
                <input v-model.number="pacing.allowedHourRangeStart" type="number" min="0" max="23" class="at-input" />
                <input v-model.number="pacing.allowedHourRangeEnd" type="number" min="0" max="23" class="at-input" />
              </div>
            </div>
          </div>

          <div v-if="error" class="form-error">{{ error }}</div>
        </div>
        <hr class="at-hairline" />
        <div class="editor-card__foot">
          <button class="at-btn at-btn--secondary" @click="editorOpen = false">Huỷ</button>
          <button class="at-btn at-btn--primary" :disabled="saving" @click="onSave">
            {{ saving ? 'Đang lưu...' : 'Lưu nháp' }}
          </button>
        </div>
      </div>
    </v-dialog>

    <v-snackbar v-model="toastOpen" :color="toastColor" timeout="3500" location="bottom right">
      {{ toastMsg }}
    </v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { blocksApi, broadcastsApi } from '@/api/automation';
import { getOrgParts } from '@/composables/use-org-timezone';
import type { Broadcast, BroadcastState, SegmentSpec } from '@/api/automation/broadcasts';
import type { Block } from '@/api/automation/types';

const broadcasts = ref<Broadcast[]>([]);
const blocks = ref<Block[]>([]);
const loading = ref(true);

const stateFilter = ref<BroadcastState | 'all'>('all');
const stateFilters: Array<{ key: BroadcastState | 'all'; label: string }> = [
  { key: 'all',       label: 'Tất cả' },
  { key: 'draft',     label: 'Nháp' },
  { key: 'scheduled', label: 'Lên lịch' },
  { key: 'running',   label: 'Đang chạy' },
  { key: 'paused',    label: 'Tạm dừng' },
  { key: 'completed', label: 'Hoàn thành' },
  { key: 'cancelled', label: 'Đã huỷ' },
];

const editorOpen = ref(false);
const saving = ref(false);
const error = ref('');

interface Draft {
  id: string | null;
  name: string;
  description: string;
  blockId: string;
  scheduleKind: 'now' | 'scheduled';
  scheduledAt: string;
}
const draft = ref<Draft | null>(null);
const segmentKind = ref<'manual' | 'filter' | 'customer-list'>('filter');
const manualContactIdsText = ref('');
const customerListId = ref('');
const pacing = ref({
  maxPerNickPerHour: 50,
  allowedHourRangeStart: 6,
  allowedHourRangeEnd: 22,
});

const toastOpen = ref(false);
const toastMsg = ref('');
const toastColor = ref<'success' | 'error' | 'info'>('info');

const sendMessageBlocks = computed(() =>
  blocks.value.filter((b) => b.actionType === 'send_message' && !b.archivedAt),
);

const filtered = computed(() => {
  if (stateFilter.value === 'all') return broadcasts.value;
  return broadcasts.value.filter((b) => b.state === stateFilter.value);
});

const countByState = computed(() => {
  const out: Record<string, number> = {};
  for (const b of broadcasts.value) out[b.state] = (out[b.state] ?? 0) + 1;
  return out;
});

const emptyMsg = computed(() => {
  if (stateFilter.value === 'all') return 'Chưa có broadcast nào';
  return `Không có broadcast trạng thái "${stateLabel(stateFilter.value as BroadcastState)}"`;
});

function stateLabel(s: BroadcastState): string {
  return {
    draft: 'Nháp',
    scheduled: 'Lên lịch',
    running: 'Đang chạy',
    paused: 'Tạm dừng',
    completed: 'Hoàn thành',
    cancelled: 'Đã huỷ',
  }[s];
}

function showToast(msg: string, color: 'success' | 'error' | 'info' = 'info') {
  toastMsg.value = msg; toastColor.value = color; toastOpen.value = true;
}

function formatDate(iso: string): string {
  const p = getOrgParts(iso);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

async function loadAll() {
  loading.value = true;
  try {
    const [bcs, bks] = await Promise.all([
      broadcastsApi.listBroadcasts(),
      blocksApi.listBlocks({ limit: 500 }),
    ]);
    broadcasts.value = bcs;
    blocks.value = bks;
  } finally {
    loading.value = false;
  }
}

onMounted(loadAll);

function openCreate() {
  draft.value = {
    id: null,
    name: '',
    description: '',
    blockId: '',
    scheduleKind: 'now',
    scheduledAt: '',
  };
  segmentKind.value = 'filter';
  manualContactIdsText.value = '';
  customerListId.value = '';
  pacing.value = { maxPerNickPerHour: 50, allowedHourRangeStart: 6, allowedHourRangeEnd: 22 };
  error.value = '';
  editorOpen.value = true;
}

function openEdit(bc: Broadcast) {
  draft.value = {
    id: bc.id,
    name: bc.name,
    description: bc.description ?? '',
    blockId: bc.blockId,
    scheduleKind: bc.scheduleKind as 'now' | 'scheduled',
    scheduledAt: bc.scheduledAt ?? '',
  };
  segmentKind.value = (bc.segmentSpec.kind as 'manual' | 'filter' | 'customer-list') ?? 'filter';
  if (bc.segmentSpec.kind === 'manual') manualContactIdsText.value = bc.segmentSpec.contactIds.join('\n');
  if (bc.segmentSpec.kind === 'customer-list') customerListId.value = bc.segmentSpec.listId;
  pacing.value = {
    maxPerNickPerHour: bc.pacing.maxPerNickPerHour ?? 50,
    allowedHourRangeStart: bc.pacing.allowedHourRange?.[0] ?? 6,
    allowedHourRangeEnd: bc.pacing.allowedHourRange?.[1] ?? 22,
  };
  error.value = '';
  editorOpen.value = true;
}

function buildSegmentSpec(): SegmentSpec | null {
  if (segmentKind.value === 'manual') {
    const ids = manualContactIdsText.value.split('\n').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) { error.value = 'Cần ít nhất 1 contactId'; return null; }
    return { kind: 'manual', contactIds: ids };
  }
  if (segmentKind.value === 'customer-list') {
    if (!customerListId.value.trim()) { error.value = 'Cần listId'; return null; }
    return { kind: 'customer-list', listId: customerListId.value.trim() };
  }
  // filter — default: friendable contacts only
  return { kind: 'filter', criteria: { acceptedNicksCount: { gt: 0 } } };
}

async function onSave() {
  if (!draft.value) return;
  error.value = '';
  if (!draft.value.name.trim()) { error.value = 'Tên không được rỗng'; return; }
  if (!draft.value.blockId) { error.value = 'Phải chọn block'; return; }

  const segment = buildSegmentSpec();
  if (!segment) return;

  saving.value = true;
  try {
    const payload = {
      name: draft.value.name.trim(),
      description: draft.value.description,
      blockId: draft.value.blockId,
      segmentSpec: segment,
      scheduleKind: draft.value.scheduleKind,
      scheduledAt: draft.value.scheduledAt || undefined,
      pacing: {
        maxPerNickPerHour: pacing.value.maxPerNickPerHour,
        allowedHourRange: [pacing.value.allowedHourRangeStart, pacing.value.allowedHourRangeEnd] as [number, number],
        randomDelayBetweenSends: { min: 15, max: 45 },
        distributeAcrossNicks: true,
      },
    };
    if (draft.value.id) await broadcastsApi.updateBroadcast(draft.value.id, payload);
    else                await broadcastsApi.createBroadcast(payload);
    editorOpen.value = false;
    await loadAll();
    showToast('Đã lưu broadcast (state=draft). Bấm Chạy để fire.', 'success');
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Lỗi';
  } finally {
    saving.value = false;
  }
}

async function onStart(bc: Broadcast) {
  if (!confirm(`Chạy "${bc.name}" ngay? Engine sẽ resolve segment → enqueue tasks. Action không thể undo.`)) return;
  try {
    const r = await broadcastsApi.startBroadcast(bc.id);
    showToast(`Đã enqueue ${r.recipientsEnqueued} recipient`, 'success');
    await loadAll();
  } catch (err: any) {
    showToast(err?.response?.data?.error ?? 'Lỗi start', 'error');
  }
}

async function onPause(bc: Broadcast) {
  try {
    await broadcastsApi.pauseBroadcast(bc.id);
    showToast('Đã tạm dừng', 'success');
    await loadAll();
  } catch (err: any) {
    showToast(err?.response?.data?.error ?? 'Lỗi pause', 'error');
  }
}

async function onCancel(bc: Broadcast) {
  if (!confirm(`Huỷ "${bc.name}"? Tasks queued sẽ bị skip, không thể resume.`)) return;
  try {
    await broadcastsApi.cancelBroadcast(bc.id);
    showToast('Đã huỷ', 'success');
    await loadAll();
  } catch (err: any) {
    showToast(err?.response?.data?.error ?? 'Lỗi cancel', 'error');
  }
}

async function onDelete(bc: Broadcast) {
  if (!confirm(`Xoá draft "${bc.name}"?`)) return;
  try {
    await broadcastsApi.deleteBroadcast(bc.id);
    showToast('Đã xoá', 'success');
    await loadAll();
  } catch (err: any) {
    showToast(err?.response?.data?.error ?? 'Lỗi delete', 'error');
  }
}
</script>

<style scoped>
.broadcasts-view { max-width: 1280px; }

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--at-s-lg);
}
.filter-chip {
  background: var(--at-canvas);
  color: var(--at-body);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-pill);
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: inherit;
}
.filter-chip.is-active {
  background: var(--at-ink);
  color: var(--at-on-primary);
  border-color: var(--at-ink);
}
.filter-chip__count {
  font-size: 11px;
  background: rgba(255,255,255,0.15);
  padding: 1px 7px;
  border-radius: var(--at-r-pill);
}
.filter-chip:not(.is-active) .filter-chip__count {
  background: var(--at-surface-soft);
  color: var(--at-muted);
}

.bc-list {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--at-s-sm);
}
.bc-card {
  background: var(--at-canvas);
  border: 1px solid var(--at-hairline);
  border-radius: var(--at-r-md);
  padding: var(--at-s-md);
}
.bc-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--at-s-sm);
  margin-bottom: var(--at-s-xs);
}
.bc-card__title-block { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bc-card__title {
  font-size: 16px;
  font-weight: 500;
  margin: 0;
  color: var(--at-ink);
}
.bc-card__desc {
  font-size: 13px;
  color: var(--at-muted);
  margin: 4px 0 var(--at-s-sm);
}
.bc-card__actions { display: flex; gap: 4px; flex-wrap: wrap; }

.bc-state {
  display: inline-flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 3px 8px;
  border-radius: var(--at-r-sm);
}
.bc-state--draft     { background: var(--at-surface-soft); color: var(--at-muted); }
.bc-state--scheduled { background: #fdf3df; color: #7a5818; }
.bc-state--running   { background: #e3ede4; color: #0a2e0e; }
.bc-state--paused    { background: var(--at-cream); color: #7a5818; }
.bc-state--completed { background: #dfeafc; color: var(--at-link-active); }
.bc-state--cancelled { background: #fbe6dc; color: #7a2000; }

.bc-stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--at-s-sm);
  padding: var(--at-s-sm) 0;
}
.bc-stat {
  background: var(--at-surface-soft);
  padding: 10px 12px;
  border-radius: var(--at-r-sm);
}
.bc-stat__label {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--at-muted);
}
.bc-stat__value {
  font-size: 18px;
  font-weight: 500;
  color: var(--at-ink);
  margin-top: 2px;
}
.bc-stat__value--small { font-size: 13px; font-weight: 500; }
.bc-stat__divider { color: var(--at-muted); font-size: 13px; }

.bc-progress {
  height: 4px;
  background: var(--at-surface-soft);
  border-radius: var(--at-r-pill);
  overflow: hidden;
  margin-top: var(--at-s-xs);
}
.bc-progress__fill {
  height: 100%;
  background: var(--at-forest);
  transition: width 0.3s ease;
}

/* Editor */
.editor-card { background: var(--at-canvas); border-radius: var(--at-r-md); overflow: hidden; }
.editor-card__head { display: flex; align-items: center; gap: var(--at-s-sm); padding: var(--at-s-md); }
.editor-card__close { margin-left: auto; background: transparent; border: 0; cursor: pointer; padding: 6px; min-width: 44px; min-height: 44px; }
.editor-card__body { padding: var(--at-s-md); display: flex; flex-direction: column; gap: var(--at-s-sm); }
.editor-card__foot { padding: var(--at-s-md); display: flex; justify-content: flex-end; gap: var(--at-s-xs); }

.form-field { display: flex; flex-direction: column; gap: 6px; }
.form-label { font-size: 13px; font-weight: 500; color: var(--at-ink); }
.form-hint { margin-top: 2px; color: var(--at-muted); }
.form-row { display: grid; grid-template-columns: 1fr 1fr; gap: var(--at-s-sm); }

.form-error {
  padding: 10px 12px;
  background: rgba(170, 45, 0, 0.08);
  border: 1px solid rgba(170, 45, 0, 0.3);
  border-radius: var(--at-r-sm);
  font-size: 13px;
  color: var(--at-coral);
}

@media (max-width: 767px) {
  .bc-stats { grid-template-columns: repeat(2, 1fr); }
  .bc-card__head { flex-direction: column; }
  .bc-card__actions { width: 100%; }
  .form-row { grid-template-columns: 1fr; }
}
</style>
