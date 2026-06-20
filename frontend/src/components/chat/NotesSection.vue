<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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

        <!-- AI no-intent banner — 5s auto-hide, chỉ hiện khi cả rule-based + AI fail -->
        <div v-if="aiNoIntent.has(note.id)" class="ai-suggestion-banner muted">
          <span class="ai-icon">🤖</span>
          <span class="ai-text muted">Không phát hiện ý định hẹn rõ ràng — đã ẩn nút AI.</span>
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

    <!-- Unified AppointmentEditor — pre-fill từ AI parse result (chốt 2026-05-21).
         Thay editDialog cũ (chỉ có date/time/type/location/summary) bằng full editor
         (title, durationMin, ... cùng giao diện với trang /appointments + chat tab). -->
    <AppointmentEditor
      v-model="showAptEditor"
      :prefill-contact="aiEditorContact"
      :ai-prefill="aiEditorPrefill"
      :current-user-id="currentUserId"
      @created="onAptEditorCreated"
    />

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
import { useNotes } from '@/composables/use-notes';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import NoteRow from './NoteRow.vue';
import AppointmentEditor from '@/components/appointments/AppointmentEditor.vue';
import type { AiPrefill } from '@/composables/appointment-helpers';

const props = defineProps<{
  contactId: string | null;
  contactName?: string | null;  // dùng để inject [Tên KH] vào title appointment
}>();

const auth = useAuthStore();
const toast = useToast();
const currentUserId = computed(() => auth.user?.id || '');

const { notes, loading, saving, rootCount, fetch, create, update, remove, toggleReaction, aiParse, linkAppointment } =
  useNotes(() => props.contactId);

// AppointmentEditor unified modal — pre-fill từ AI parse, kế thừa toàn bộ UX
// trang /appointments (title, durationMin, type chips, location preset, ...)
const showAptEditor = ref(false);
const aiEditorPrefill = ref<AiPrefill | null>(null);
const aiEditorContact = ref<{ id: string; fullName: string | null; phone: string | null } | null>(null);
const aiEditorNoteId = ref<string | null>(null);

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

const aiNoIntent = ref(new Set<string>());   // notes where parse fail → banner 5s
const aiDisabled = ref(new Set<string>());   // notes where parse fail → hide button forever this session

const flyAnim = ref<{ x: number; y: number; dx: number; dy: number } | null>(null);

const emit = defineEmits<{
  'appointment-created': [];
  'animate-target-rect': [];
}>();

watch(() => props.contactId, (id) => {
  rootDraft.value = '';
  replyDraft.value = '';
  replyTarget.value = null;
  aiNoIntent.value.clear();
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

/**
 * Click 🤖 AI lịch hẹn → backend chạy cascade:
 *   Step 1: rule-based regex (parseAppointmentRuleBased) — fast local, no AI cost
 *   Step 2: AI provider (Gemini) — kích hoạt nếu rule-based confidence thấp HOẶC để
 *           cross-check. Fallback ngược về rule-based nếu AI quota/network fail.
 * Cả 2 step fail (hasIntent=false) → ẩn nút AI forever cho note này (per-session).
 * Step nào đó thành công (hasIntent=true) → popup unified AppointmentEditor pre-fill.
 */
async function onAiParse(noteId: string) {
  if (aiDisabled.value.has(noteId)) return;
  toast.push('🤖 AI đang phân tích…');
  const parsed = await aiParse(noteId);
  if (parsed && parsed.hasIntent) {
    // Build prefill cho AppointmentEditor + note body làm reference field notes
    const note = notes.value.find((n) => n.id === noteId)
      || notes.value.flatMap((n) => n.replies ?? []).find((r) => r.id === noteId);
    const name = (props.contactName || '').trim();
    // Title: AI summary > rule fallback. Inject [Tên KH] nếu thiếu.
    let title = (parsed.summary || '').trim();
    if (title && name && !title.toLowerCase().includes(name.toLowerCase())) {
      title = `${title} [${name}]`;
    }
    aiEditorPrefill.value = {
      date: parsed.date,
      time: parsed.time,
      type: parsed.type,
      location: parsed.location,
      title: title || null,
      notes: note?.body || null,
    };
    aiEditorContact.value = props.contactId
      ? { id: props.contactId, fullName: props.contactName || null, phone: null }
      : null;
    aiEditorNoteId.value = noteId;
    showAptEditor.value = true;

    // Toast badge nếu fallback (AI hết quota) để sale biết
    if (parsed.source === 'fallback') {
      toast.push('⚙️ AI hết quota — đã phân tích bằng quy tắc local');
    }
  } else {
    // Cả rule-based + AI đều fail → ẩn nút + banner 5s
    aiDisabled.value.add(noteId);
    aiNoIntent.value.add(noteId);
    setTimeout(() => {
      aiNoIntent.value.delete(noteId);
      aiNoIntent.value = new Set(aiNoIntent.value);
    }, 5000);
  }
}

/** AppointmentEditor emit('created') sau khi save xong → link note + animation + toast */
async function onAptEditorCreated(apt: { id: string }) {
  const noteId = aiEditorNoteId.value;
  if (noteId && apt?.id) {
    await linkAppointment(noteId, apt.id);
    triggerFlyAnimation(noteId);
  }
  toast.success('📅 Đã tạo lịch hẹn');
  showAptEditor.value = false;
  aiEditorPrefill.value = null;
  aiEditorContact.value = null;
  aiEditorNoteId.value = null;
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
