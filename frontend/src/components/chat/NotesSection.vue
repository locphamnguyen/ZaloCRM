<template>
  <section class="notes-section">
    <!-- Header: title + count + Enter-mode toggle -->
    <div class="notes-header">
      <div class="notes-title">
        📝 Ghi chú
        <span v-if="rootCount" class="notes-count">#{{ rootCount }}</span>
      </div>
      <label class="enter-toggle" :title="enterToSave ? 'Enter = Lưu · Shift+Enter = xuống dòng' : 'Enter = xuống dòng · Ctrl+Enter = Lưu'">
        <input type="checkbox" v-model="enterToSave" />
        <span>Enter để lưu</span>
      </label>
    </div>

    <!-- Composer (always visible at top) -->
    <div class="note-composer always-on">
      <textarea
        ref="composerInput"
        v-model="rootDraft"
        class="note-input"
        name="notes-root-draft"
        autocomplete="off"
        :placeholder="rootPlaceholder"
        rows="1"
        @keydown="onComposerKeydown"
        @input="autoGrow"
      />
      <button
        class="send-btn"
        :disabled="!rootDraft.trim() || saving"
        :title="enterToSave ? 'Enter để lưu' : 'Ctrl+Enter để lưu'"
        @click="submitRoot"
      >
        <span v-if="saving">…</span>
        <span v-else>➤</span>
      </button>
    </div>

    <!-- Scroll area -->
    <div v-if="loading && !notes.length" class="notes-loading">Đang tải…</div>
    <div v-else-if="!notes.length" class="notes-empty">
      <span class="empty-icon">💭</span>
      <p>Chưa có ghi chú. Thử: <em>"Thứ 6 gọi lại khách báo giá"</em> — AI có thể đề xuất lịch hẹn.</p>
    </div>

    <div v-else class="notes-list">
      <article v-for="note in notes" :key="note.id" class="note-card" :data-note-id="note.id">
        <!-- Root note -->
        <NoteRow
          :note="note"
          :current-user-id="currentUserId"
          :ai-disabled="aiDisabled.has(note.id)"
          @react="onReact"
          @reply="openReply(note.id)"
          @edit="onEdit"
          @delete="onDelete"
          @ai-parse="onAiParse"
        />

        <!-- AI parse result banner -->
        <div v-if="aiResult.get(note.id) || aiNoIntent.has(note.id)" class="ai-suggestion-banner" :class="{ muted: aiNoIntent.has(note.id) }">
          <template v-if="aiResult.get(note.id)">
            <span class="ai-icon">{{ aiResult.get(note.id)?.source === 'fallback' ? '⚙️' : '🤖' }}</span>
            <span class="ai-text">
              <span v-if="aiResult.get(note.id)?.source === 'fallback'" class="source-badge" title="Đoán bằng quy tắc (AI hết quota)">local</span>
              <strong v-if="aiResult.get(note.id)?.date">{{ formatAiDate(aiResult.get(note.id)!) }}</strong>
              <span v-else class="needs-input">cần điền thời gian</span>
              · {{ aiResult.get(note.id)?.summary }}
              <span v-if="aiResult.get(note.id)?.missingFields?.length" class="missing-hint">
                ⚠ thiếu: {{ aiResult.get(note.id)?.missingFields.join(', ') }}
              </span>
            </span>
            <button class="ai-create-btn" @click="openEditDialog(note)">
              ✏ Sửa & Tạo
            </button>
            <button class="ai-dismiss" title="Bỏ qua" @click="aiResult.delete(note.id)">×</button>
          </template>
          <template v-else>
            <span class="ai-icon">🤖</span>
            <span class="ai-text muted">Không phát hiện thời gian rõ ràng trong ghi chú này.</span>
          </template>
        </div>

        <!-- Replies (1 level, flat) -->
        <div v-if="note.replies?.length" class="note-replies">
          <NoteRow
            v-for="reply in note.replies"
            :key="reply.id"
            :note="reply"
            :is-reply="true"
            :current-user-id="currentUserId"
            @react="onReact"
            @edit="onEdit"
            @delete="onDelete"
          />
        </div>

        <!-- Reply composer (when this note is the active reply target) -->
        <div v-if="replyTarget === note.id" class="note-composer reply-composer">
          <textarea
            ref="replyInput"
            v-model="replyDraft"
            class="note-input"
            name="notes-reply-draft"
            autocomplete="off"
            placeholder="Trả lời…"
            rows="1"
            @keydown="onReplyKeydown"
          />
          <button class="send-btn small" :disabled="!replyDraft.trim() || saving" @click="submitReply">
            <span v-if="saving">…</span>
            <span v-else>➤</span>
          </button>
          <button class="btn-link small-x" @click="cancelReply" title="Hủy">×</button>
        </div>
      </article>
    </div>

    <!-- Edit appointment dialog before save -->
    <Teleport to="body">
      <div v-if="editDialog.open" class="apt-dialog-backdrop" @click.self="closeEditDialog">
        <div class="apt-dialog">
          <div class="apt-dialog-head">
            <span>🤖 Xác nhận tạo lịch hẹn</span>
            <button class="dialog-close" @click="closeEditDialog">×</button>
          </div>
          <div class="apt-dialog-body">
            <!-- Title -->
            <div class="apt-form-row col">
              <label>Tiêu đề</label>
              <input type="text" v-model="editDialog.summary" placeholder="Mô tả ngắn việc cần làm" />
            </div>

            <!-- Date with quick-shortcut chips -->
            <div class="apt-form-row col">
              <label>Ngày hẹn</label>
              <div class="date-row">
                <input type="date" v-model="editDialog.date" class="date-input" />
                <div class="quick-chips">
                  <button v-for="opt in DATE_QUICK" :key="opt.label" class="chip" :class="{ active: editDialog.date === opt.value }" @click="editDialog.date = opt.value">
                    {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Time picker — hour + minute separate, no continuous input -->
            <div class="apt-form-row col">
              <label>Giờ hẹn</label>
              <div class="time-row">
                <div class="time-picker">
                  <select v-model="timeHour" class="time-select">
                    <option v-for="h in HOURS" :key="h" :value="h">{{ h }}h</option>
                  </select>
                  <span class="time-colon">:</span>
                  <select v-model="timeMinute" class="time-select">
                    <option v-for="m in MINUTES" :key="m" :value="m">{{ m }}</option>
                  </select>
                  <button v-if="editDialog.time" class="clear-time" title="Xoá giờ (cả ngày)" @click="clearTime">×</button>
                </div>
                <div class="quick-chips">
                  <button v-for="opt in TIME_QUICK" :key="opt.label" class="chip" :class="{ active: editDialog.time === opt.value }" @click="setQuickTime(opt.value)">
                    {{ opt.icon }} {{ opt.label }}
                  </button>
                </div>
              </div>
            </div>

            <!-- Type chip-style selector -->
            <div class="apt-form-row col">
              <label>Loại lịch hẹn</label>
              <div class="type-chips">
                <button v-for="opt in TYPE_OPTIONS" :key="opt.value" class="type-chip" :class="{ active: editDialog.type === opt.value }" @click="editDialog.type = opt.value">
                  <span class="type-icon">{{ opt.icon }}</span>
                  <span>{{ opt.label }}</span>
                </button>
              </div>
            </div>

            <!-- Location -->
            <div class="apt-form-row col">
              <label>Địa điểm <span class="optional">(tuỳ chọn)</span></label>
              <input type="text" v-model="editDialog.location" placeholder="VP / Showroom / dự án…" />
            </div>
          </div>

          <div class="apt-dialog-foot">
            <button class="btn-link" @click="closeEditDialog">Huỷ</button>
            <button class="btn-primary" :disabled="!editDialog.date || creatingApt.has(editDialog.noteId)" @click="confirmCreate">
              {{ creatingApt.has(editDialog.noteId) ? 'Đang tạo…' : '📅 Lên lịch' }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Flying calendar emoji animation (note → activity tab badge) -->
    <Teleport to="body">
      <div
        v-if="flyAnim"
        class="fly-calendar"
        :style="{ left: flyAnim.x + 'px', top: flyAnim.y + 'px', '--tx': flyAnim.dx + 'px', '--ty': flyAnim.dy + 'px' }"
      >📅</div>
    </Teleport>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useNotes, type Note, type ParsedAppointment } from '@/composables/use-notes';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api/index';
import NoteRow from './NoteRow.vue';

const props = defineProps<{
  contactId: string | null;
  contactName?: string | null;  // dùng để inject [Tên KH] vào title appointment
}>();

const auth = useAuthStore();
const toast = useToast();
const currentUserId = computed(() => auth.user?.id || '');

const { notes, loading, saving, rootCount, fetch, create, update, remove, toggleReaction, aiParse, linkAppointment } =
  useNotes(() => props.contactId);

// Enter behavior — persist preference in localStorage. Default = TRUE (Enter để lưu).
const ENTER_KEY = 'zalocrm.notes.enterToSave';
const enterToSave = ref<boolean>(localStorage.getItem(ENTER_KEY) !== '0');
watch(enterToSave, (v) => { localStorage.setItem(ENTER_KEY, v ? '1' : '0'); });

const rootDraft = ref('');
const composerInput = ref<HTMLTextAreaElement | null>(null);
const rootPlaceholder = computed(() =>
  enterToSave.value
    ? 'Nhập ghi chú… (Enter để lưu, Shift+Enter xuống dòng)'
    : 'Nhập ghi chú… (Ctrl+Enter để lưu)',
);

const replyTarget = ref<string | null>(null);
const replyDraft = ref('');
const replyInput = ref<HTMLTextAreaElement | null>(null);

const aiResult = ref(new Map<string, ParsedAppointment>());
const aiNoIntent = ref(new Set<string>());   // notes where AI didn't detect intent → show banner, hide in 5s
const aiDisabled = ref(new Set<string>());   // notes where AI parsed and got no intent → disable button forever this session
const creatingApt = ref(new Set<string>());

const editDialog = ref<{
  open: boolean;
  noteId: string;
  date: string;
  time: string;
  type: string;
  location: string;
  summary: string;
}>({ open: false, noteId: '', date: '', time: '', type: 'follow_up', location: '', summary: '' });

// Quick chip options — date relative shortcuts
function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
const DATE_QUICK = computed(() => [
  { label: 'Hôm nay', value: isoDate(0) },
  { label: 'Mai', value: isoDate(1) },
  { label: 'Kia', value: isoDate(2) },
  { label: '3 ngày', value: isoDate(3) },
  { label: '1 tuần', value: isoDate(7) },
]);

// Time picker — chỉ 06:00 → 23:00, phút step 15 (00 / 15 / 30 / 45)
const HOURS = Array.from({ length: 18 }, (_, i) => String(i + 6).padStart(2, '0'));
const MINUTES = ['00', '15', '30', '45'];

const TIME_QUICK = [
  { icon: '☀️', label: 'Sáng', value: '09:00' },
  { icon: '🌤', label: 'Trưa', value: '12:00' },
  { icon: '🌇', label: 'Chiều', value: '14:00' },
  { icon: '🌆', label: 'Tối', value: '19:00' },
];

const TYPE_OPTIONS = [
  { value: 'call', label: 'Gọi điện', icon: '📞' },
  { value: 'message', label: 'Nhắn tin', icon: '💬' },
  { value: 'meeting', label: 'Gặp mặt', icon: '🤝' },
  { value: 'follow_up', label: 'Theo dõi', icon: '🔁' },
];

// Computed hour/minute split — đồng bộ 2 chiều với editDialog.time (HH:MM)
const timeHour = computed<string>({
  get: () => {
    const t = editDialog.value.time;
    if (!t) return '09';
    const h = t.slice(0, 2);
    return HOURS.includes(h) ? h : '09';
  },
  set: (h) => {
    const m = editDialog.value.time ? editDialog.value.time.slice(3, 5) : '00';
    const validM = MINUTES.includes(m) ? m : '00';
    editDialog.value.time = `${h}:${validM}`;
  },
});
const timeMinute = computed<string>({
  get: () => {
    const t = editDialog.value.time;
    if (!t) return '00';
    const m = t.slice(3, 5);
    return MINUTES.includes(m) ? m : '00';
  },
  set: (m) => {
    const h = editDialog.value.time ? editDialog.value.time.slice(0, 2) : '09';
    const validH = HOURS.includes(h) ? h : '09';
    editDialog.value.time = `${validH}:${m}`;
  },
});
function setQuickTime(val: string) {
  editDialog.value.time = val;
}
function clearTime() {
  editDialog.value.time = '';
}

const flyAnim = ref<{ x: number; y: number; dx: number; dy: number } | null>(null);

const emit = defineEmits<{
  'appointment-created': [];
  'animate-target-rect': [];
}>();

watch(() => props.contactId, (id) => {
  rootDraft.value = '';
  replyDraft.value = '';
  replyTarget.value = null;
  aiResult.value.clear();
  if (id) void fetch();
  else notes.value = [];
}, { immediate: true });

function autoGrow(e: Event) {
  const t = e.target as HTMLTextAreaElement;
  t.style.height = 'auto';
  t.style.height = Math.min(t.scrollHeight, 120) + 'px';
}

function onComposerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { rootDraft.value = ''; return; }
  if (e.key !== 'Enter') return;
  if (enterToSave.value) {
    if (e.shiftKey) return; // xuống dòng
    e.preventDefault();
    void submitRoot();
  } else {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      void submitRoot();
    }
  }
}

function onReplyKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { cancelReply(); return; }
  if (e.key !== 'Enter') return;
  if (enterToSave.value) {
    if (e.shiftKey) return;
    e.preventDefault();
    void submitReply();
  } else if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    void submitReply();
  }
}

async function submitRoot() {
  if (!rootDraft.value.trim()) return;
  const created = await create(rootDraft.value, null);
  if (created) {
    toast.success('Đã thêm ghi chú');
    rootDraft.value = '';
    nextTick(() => {
      if (composerInput.value) composerInput.value.style.height = 'auto';
    });
  } else {
    toast.error('Không thể lưu ghi chú');
  }
}

function openReply(parentId: string) {
  replyTarget.value = parentId;
  replyDraft.value = '';
  nextTick(() => replyInput.value?.focus());
}

function cancelReply() {
  replyTarget.value = null;
  replyDraft.value = '';
}

async function submitReply() {
  if (!replyDraft.value.trim() || !replyTarget.value) return;
  const created = await create(replyDraft.value, replyTarget.value);
  if (created) {
    toast.success('Đã trả lời');
    cancelReply();
  } else {
    toast.error('Không thể gửi trả lời');
  }
}

function onReact(noteId: string, emoji: string) {
  if (!currentUserId.value) return;
  void toggleReaction(noteId, emoji, currentUserId.value);
}

async function onEdit(noteId: string, newBody: string) {
  const ok = await update(noteId, newBody);
  if (ok) toast.success('Đã sửa ghi chú');
}

async function onDelete(noteId: string) {
  if (!confirm('Xoá ghi chú này?')) return;
  const ok = await remove(noteId);
  if (ok) toast.success('Đã xoá');
}

async function onAiParse(noteId: string) {
  if (aiDisabled.value.has(noteId)) return;
  toast.push('🤖 AI đang phân tích…');
  const parsed = await aiParse(noteId);
  if (parsed && parsed.hasIntent) {
    aiResult.value.set(noteId, parsed);
    aiNoIntent.value.delete(noteId);
  } else {
    // Không phát hiện → disable AI button cho note này + show banner 5s rồi auto-hide
    aiDisabled.value.add(noteId);
    aiNoIntent.value.add(noteId);
    setTimeout(() => {
      aiNoIntent.value.delete(noteId);
      // Force reactivity refresh
      aiNoIntent.value = new Set(aiNoIntent.value);
    }, 5000);
  }
}

function formatAiDate(p: ParsedAppointment): string {
  if (!p.date) return '';
  const d = new Date(`${p.date}T${p.time || '09:00'}:00`);
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const time = p.time ? ` · ${p.time}` : '';
  return `${weekday} ${dd}/${mm}${time}`;
}

/** Mở edit dialog với prefilled từ AI parse — user xác nhận/sửa trước khi tạo lịch.
 *  Tự động inject [Tên KH] vào cuối summary nếu chưa có. */
function openEditDialog(note: Note) {
  const p = aiResult.value.get(note.id);
  if (!p) return;
  const today = new Date().toISOString().slice(0, 10);
  const baseSummary = p.summary || note.body.slice(0, 160);
  const name = (props.contactName || '').trim();
  const summaryWithName = name && !baseSummary.includes(`[${name}]`)
    ? `${baseSummary} [${name}]`
    : baseSummary;
  editDialog.value = {
    open: true,
    noteId: note.id,
    date: p.date || today,
    time: p.time || '09:00',  // default 09:00 để picker hiển thị, user có thể clear
    type: p.type || 'follow_up',
    location: p.location || '',
    summary: summaryWithName,
  };
}

function closeEditDialog() {
  editDialog.value.open = false;
}

async function confirmCreate() {
  const d = editDialog.value;
  if (!d.date || !d.noteId || !props.contactId) return;
  creatingApt.value.add(d.noteId);
  try {
    // Time optional: nếu user clear → dùng 09:00 default; nếu set thì giữ
    const time = d.time && /^\d{2}:\d{2}$/.test(d.time) ? d.time : '09:00';
    const isoDate = new Date(`${d.date}T${time}:00`).toISOString();
    // Location optional: chỉ inject vào summary nếu có nội dung trim non-empty
    const loc = (d.location || '').trim();
    const summary = loc ? `${d.summary} (📍 ${loc})` : d.summary;
    const { data } = await api.post('/appointments', {
      contactId: props.contactId,
      appointmentDate: isoDate,
      appointmentTime: d.time || null,
      type: d.type || 'follow_up',
      notes: summary,
    });
    const aptId = data.id || data.appointment?.id;
    if (aptId) {
      await linkAppointment(d.noteId, aptId);
      triggerFlyAnimation(d.noteId);
      toast.success('📅 Đã tạo lịch hẹn');
      aiResult.value.delete(d.noteId);
      closeEditDialog();
    }
  } catch (err: any) {
    console.error(err);
    // Hiển thị message thực từ backend (vd 409 dedup conflict)
    const status = err?.response?.status;
    const msg = err?.response?.data?.error;
    if (status === 409) {
      toast.error(msg || 'Đã có lịch hẹn trùng giờ với KH này — đổi giờ hoặc xem trong Hoạt động');
    } else {
      toast.error(msg || `Không tạo được lịch hẹn (${status || 'unknown'})`);
    }
  } finally {
    creatingApt.value.delete(d.noteId);
  }
}

/** Animation cuốn lịch bay từ note → tab Hoạt động badge. Sau ~750ms emit
 * 'appointment-created' để parent (ChatContactPanel) tăng badge count +1. */
function triggerFlyAnimation(noteId: string) {
  // Source: note card position
  const noteEl = document.querySelector(`[data-note-id="${noteId}"]`) as HTMLElement | null;
  const targetEl = document.querySelector('[data-fly-target="activity-tab"]') as HTMLElement | null;
  if (!noteEl || !targetEl) {
    // Fallback: emit immediately
    emit('appointment-created');
    return;
  }
  const src = noteEl.getBoundingClientRect();
  const tgt = targetEl.getBoundingClientRect();
  const startX = src.right - 24;
  const startY = src.top + 8;
  flyAnim.value = {
    x: startX,
    y: startY,
    dx: tgt.left + tgt.width / 2 - startX,
    dy: tgt.top + tgt.height / 2 - startY,
  };
  // Khi animation đến đích (750ms) → emit để badge +1 + clear
  setTimeout(() => {
    flyAnim.value = null;
    emit('appointment-created');
  }, 750);
}

defineExpose({ rootCount });
</script>

<style scoped>
.notes-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 8px;
}

.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
}
.notes-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--smax-grey-700);
  display: flex;
  align-items: center;
  gap: 6px;
  letter-spacing: 0.3px;
  text-transform: uppercase;
}
.notes-count {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: none;
}
.enter-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--smax-grey-600);
  cursor: pointer;
  user-select: none;
}
.enter-toggle input { margin: 0; cursor: pointer; }

/* ── Composer (input + send inline) ───────────────────────────────────── */
.note-composer {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 8px;
  padding: 5px 5px 5px 8px;
  background: var(--smax-bg, #fff);
  transition: border-color 0.15s;
}
.note-composer:focus-within {
  border-color: var(--smax-primary, #2962ff);
  box-shadow: 0 0 0 3px rgba(33,150,243,0.08);
}
.reply-composer {
  margin-top: 6px;
  margin-left: 24px;
}
.note-input {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.45;
  background: transparent;
  color: var(--smax-text);
  min-height: 22px;
  max-height: 120px;
  padding: 4px 0;
}
.send-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--smax-primary, #2962ff);
  color: #fff;
  border: none;
  font-size: 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, transform 0.1s;
}
.send-btn.small { width: 26px; height: 26px; font-size: 12px; }
.send-btn:hover:not(:disabled) { background: #1e4cc7; }
.send-btn:active:not(:disabled) { transform: scale(0.92); }
.send-btn:disabled { background: var(--smax-grey-300); cursor: not-allowed; }
.btn-link {
  background: none;
  border: none;
  color: var(--smax-grey-500);
  cursor: pointer;
}
.btn-link.small-x {
  font-size: 18px;
  padding: 0 4px;
  line-height: 1;
}

/* ── List / scroll ─────────────────────────────────────────────────────── */
.notes-list {
  display: flex;
  flex-direction: column;
  gap: 4px;          /* sát nhau — actions ẩn collapse, hover sẽ push các note dưới xuống */
  max-height: 420px;
  overflow-y: auto;
  padding-right: 4px;
}
.notes-list::-webkit-scrollbar { width: 5px; }
.notes-list::-webkit-scrollbar-thumb { background: var(--smax-grey-200); border-radius: 3px; }

.note-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.note-replies {
  margin-left: 24px;
  padding-left: 10px;
  border-left: 2px solid var(--smax-grey-100);
  display: flex;
  flex-direction: column;
  gap: 3px;          /* reply cũng sát nhau */
  margin-top: 2px;
}

/* ── States ────────────────────────────────────────────────────────────── */
.notes-loading, .notes-empty {
  padding: 16px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--smax-grey-500);
}
.notes-empty .empty-icon { font-size: 22px; display: block; margin-bottom: 4px; }
.notes-empty em { color: var(--smax-grey-700); font-style: italic; }

/* ── AI suggestion banner ──────────────────────────────────────────────── */
.ai-suggestion-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(90deg, #fff3e0 0%, #fff8e1 100%);
  border: 1px solid #ffb74d;
  border-radius: 7px;
  padding: 6px 10px;
  margin-top: 4px;
  font-size: 12px;
}
.ai-icon { font-size: 14px; }
.ai-text { flex: 1; color: #6d4c00; }
.ai-text.muted { color: var(--smax-grey-500); font-style: italic; }
.ai-text strong { color: #c43a00; }
.ai-create-btn {
  background: #f57c00;
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}
.ai-create-btn:disabled { opacity: 0.6; }
.ai-dismiss {
  background: none;
  border: none;
  color: var(--smax-grey-500);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.ai-suggestion-banner.muted {
  background: var(--smax-grey-50, #f9fafb);
  border-color: var(--smax-grey-200);
  animation: fadeOutBanner 5s ease forwards;
}
@keyframes fadeOutBanner {
  0%, 80% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-4px); }
}
.needs-input {
  color: #f57c00;
  font-style: italic;
  font-weight: 500;
}
.missing-hint {
  color: #c43a00;
  font-size: 11px;
  margin-left: 6px;
  font-weight: 500;
}
.source-badge {
  display: inline-block;
  background: var(--smax-grey-200);
  color: var(--smax-grey-700);
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 1px 5px;
  border-radius: 4px;
  margin-right: 4px;
}

/* ── Edit appointment dialog ───────────────────────────────────────────── */
.apt-dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
}
.apt-dialog {
  background: #fff;
  border-radius: 14px;
  min-width: 460px;
  max-width: 520px;
  width: 92vw;
  box-shadow: 0 12px 36px rgba(0,0,0,0.22);
  overflow: hidden;
}
.apt-dialog-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--smax-grey-200);
  font-weight: 700;
  font-size: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: linear-gradient(90deg, #fff3e0, #fffde7);
  color: #6d4c00;
}
.dialog-close {
  background: none;
  border: none;
  font-size: 20px;
  cursor: pointer;
  color: var(--smax-grey-600);
  line-height: 1;
}
.apt-dialog-body {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.apt-form-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.apt-form-row.col {
  flex-direction: column;
  align-items: stretch;
}
.apt-form-row label {
  font-size: 11px;
  font-weight: 700;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-bottom: 5px;
}
.apt-form-row .optional {
  font-weight: 400;
  text-transform: none;
  font-size: 11px;
  color: var(--smax-grey-400);
  margin-left: 4px;
  letter-spacing: 0;
}
.apt-form-row input[type="text"],
.apt-form-row input[type="date"] {
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 8px 11px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.apt-form-row input:focus { border-color: var(--smax-primary); box-shadow: 0 0 0 3px rgba(33,150,243,0.1); }

/* ── Date row with quick chips ─────────────────────────────────────────── */
.date-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.date-input {
  font-weight: 600;
  color: var(--smax-text);
}

.quick-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.chip {
  background: var(--smax-grey-100, #f5f6fa);
  border: 1px solid var(--smax-grey-200);
  border-radius: 14px;
  font-size: 11.5px;
  font-weight: 500;
  padding: 4px 11px;
  cursor: pointer;
  color: var(--smax-grey-700);
  transition: all 0.12s;
}
.chip:hover { background: var(--smax-primary-soft); color: var(--smax-primary); border-color: var(--smax-primary); }
.chip.active {
  background: var(--smax-primary);
  color: #fff;
  border-color: var(--smax-primary);
  font-weight: 600;
}

/* ── Time row ──────────────────────────────────────────────────────────── */
.time-row {
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.time-picker {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--smax-grey-50, #f9fafb);
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 8px;
  padding: 4px 6px;
  width: fit-content;
}
.time-select {
  border: none;
  outline: none;
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  color: var(--smax-text);
  font-family: inherit;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 4px;
}
.time-select:hover { background: #fff; }
.time-colon {
  font-size: 18px;
  font-weight: 700;
  color: var(--smax-grey-500);
  line-height: 1;
}
.clear-time {
  background: transparent;
  border: none;
  color: var(--smax-grey-500);
  font-size: 18px;
  cursor: pointer;
  padding: 2px 7px;
  border-radius: 4px;
  line-height: 1;
}
.clear-time:hover { background: var(--smax-grey-200); color: #c62828; }

/* ── Type chips ────────────────────────────────────────────────────────── */
.type-chips {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}
.type-chip {
  background: #fff;
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 8px;
  padding: 7px 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  font-weight: 500;
  color: var(--smax-grey-700);
  transition: all 0.12s;
}
.type-chip:hover { border-color: var(--smax-primary); color: var(--smax-primary); }
.type-chip.active {
  background: var(--smax-primary-soft);
  border-color: var(--smax-primary);
  color: var(--smax-primary);
  font-weight: 600;
}
.type-icon { font-size: 17px; }
.apt-dialog-foot {
  padding: 10px 16px;
  border-top: 1px solid var(--smax-grey-100);
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  background: var(--smax-grey-50);
}
.apt-dialog-foot .btn-primary {
  background: var(--smax-primary);
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.apt-dialog-foot .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.apt-dialog-foot .btn-link {
  background: none;
  border: none;
  color: var(--smax-grey-600);
  cursor: pointer;
  padding: 6px 10px;
}

/* ── Fly-to-tab calendar animation ─────────────────────────────────────── */
.fly-calendar {
  position: fixed;
  font-size: 28px;
  z-index: 10000;
  pointer-events: none;
  animation: flyCal 750ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,0.18));
}
@keyframes flyCal {
  0% {
    transform: translate(0, 0) scale(1) rotate(0deg);
    opacity: 1;
  }
  35% {
    transform: translate(calc(var(--tx) * 0.35), calc(var(--ty) * 0.2 - 30px)) scale(1.3) rotate(180deg);
    opacity: 1;
  }
  70% {
    transform: translate(calc(var(--tx) * 0.75), calc(var(--ty) * 0.7 - 18px)) scale(1.1) rotate(540deg);
    opacity: 0.95;
  }
  100% {
    transform: translate(var(--tx), var(--ty)) scale(0.3) rotate(720deg);
    opacity: 0;
  }
}
</style>
