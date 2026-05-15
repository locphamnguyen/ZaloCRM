<template>
  <section class="timeline-section">
    <!-- Header: title + count + today badge + filter chip + ⚙ settings -->
    <div class="tl-header">
      <div class="tl-title">
        📋 Timeline KH
        <span v-if="rootNoteCount" class="tl-count">#{{ rootNoteCount }}</span>
        <button
          v-if="todayCount > 0"
          class="today-badge"
          :title="`${todayCount} hoạt động hôm nay — click để xem chi tiết`"
          @click="goToFullPage"
        >🕐 {{ todayCount }} hôm nay</button>
      </div>
      <div class="tl-controls">
        <div class="filter-chips">
          <button
            v-for="opt in FILTER_OPTIONS"
            :key="opt.value"
            class="chip"
            :class="{ active: filter === opt.value }"
            @click="setFilter(opt.value as 'all' | 'notes' | 'activity')"
          >{{ opt.label }}</button>
        </div>
        <v-menu :close-on-content-click="false" location="bottom end">
          <template #activator="{ props: actProps }">
            <button v-bind="actProps" class="settings-btn" title="Cài đặt categories hiển thị">⚙</button>
          </template>
          <div class="settings-dropdown">
            <div class="sd-title">Hiển thị loại hoạt động</div>
            <label
              v-for="cat in ALL_CATEGORIES"
              :key="cat"
              class="sd-row"
            >
              <input
                type="checkbox"
                :checked="visibleCategoriesSet.has(cat)"
                @change="toggleCategory(cat)"
              />
              <span class="sd-icon" :style="`color: ${CATEGORY_META[cat].color}`">{{ CATEGORY_META[cat].icon }}</span>
              <span class="sd-label">{{ CATEGORY_META[cat].label }}</span>
            </label>
            <div class="sd-foot">
              <button class="sd-reset" @click="resetDefaults">⟲ Mặc định</button>
              <button class="sd-link" @click="goToFullPage">Xem đầy đủ →</button>
            </div>
          </div>
        </v-menu>
      </div>
    </div>

    <!-- Note composer — luôn hiện ở đầu. Enter = lưu, Shift+Enter = xuống dòng (mặc định) -->
    <div class="note-composer">
      <textarea
        v-model="rootDraft"
        class="note-input"
        placeholder="Nhập ghi chú..."
        rows="1"
        @keydown="onComposerKeydown"
      />
      <button
        class="send-btn"
        :disabled="!rootDraft.trim() || saving"
        title="Enter để lưu · Shift+Enter để xuống dòng"
        @click="submitRoot"
      >
        <span v-if="saving">…</span>
        <span v-else>➤</span>
      </button>
    </div>

    <!-- Loading + Empty -->
    <div v-if="loading && !items.length" class="tl-state">Đang tải…</div>
    <div v-else-if="!items.length" class="tl-state empty">
      <span class="empty-icon">📋</span>
      <p>Chưa có hoạt động nào. Thêm ghi chú đầu tiên ở trên!</p>
    </div>

    <!-- Unified stream -->
    <div v-else class="tl-list">
      <template v-for="item in items" :key="item.type + ':' + (item.type === 'note' ? (item.data as any).id : (item.data as any).id)">
        <!-- Note item — render giống NotesSection (root note + reactions + replies) -->
        <article
          v-if="item.type === 'note'"
          class="note-card"
          :data-note-id="(item.data as Note).id"
        >
          <NoteRow
            :note="item.data as Note"
            :current-user-id="currentUserId"
            :ai-disabled="aiDisabled.has((item.data as Note).id)"
            @react="onReact"
            @reply="openReply((item.data as Note).id)"
            @edit="onEdit"
            @delete="onDelete"
            @ai-parse="onAiParse"
          />
          <!-- AI parse banner -->
          <div
            v-if="aiResult.get((item.data as Note).id) || aiNoIntent.has((item.data as Note).id)"
            class="ai-suggestion-banner"
            :class="{ muted: aiNoIntent.has((item.data as Note).id) }"
          >
            <template v-if="aiResult.get((item.data as Note).id)">
              <span class="ai-icon">{{ aiResult.get((item.data as Note).id)?.source === 'fallback' ? '⚙️' : '🤖' }}</span>
              <span class="ai-text">
                <strong v-if="aiResult.get((item.data as Note).id)?.date">{{ formatAiDate(aiResult.get((item.data as Note).id)!) }}</strong>
                <span v-else class="needs-input">cần điền thời gian</span>
                · {{ aiResult.get((item.data as Note).id)?.summary }}
              </span>
              <button class="ai-create-btn" @click="openAptDialog(item.data as Note)">✏ Sửa & Tạo</button>
              <button class="ai-dismiss" @click="aiResult.delete((item.data as Note).id)">×</button>
            </template>
            <template v-else>
              <span class="ai-icon">🤖</span>
              <span class="ai-text muted">Không phát hiện thời gian rõ ràng.</span>
            </template>
          </div>

          <!-- Replies -->
          <div v-if="(item.data as Note).replies?.length" class="note-replies">
            <NoteRow
              v-for="reply in (item.data as Note).replies"
              :key="reply.id"
              :note="reply"
              :is-reply="true"
              :current-user-id="currentUserId"
              @react="onReact"
              @edit="onEdit"
              @delete="onDelete"
            />
          </div>

          <!-- Reply composer -->
          <div v-if="replyTarget === (item.data as Note).id" class="note-composer reply-composer">
            <textarea
              ref="replyInput"
              v-model="replyDraft"
              class="note-input"
              placeholder="Trả lời..."
              rows="1"
              @keydown="onReplyKeydown"
            />
            <button class="send-btn small" :disabled="!replyDraft.trim() || saving" @click="submitReply">
              <span v-if="saving">…</span><span v-else>➤</span>
            </button>
            <button class="btn-x" @click="cancelReply">×</button>
          </div>
        </article>

        <!-- Activity item — compact 1 line -->
        <ActivityItem
          v-else
          :item="item.data as ActivityLogItem"
        />
      </template>

      <!-- Load more / end -->
      <div v-if="hasMore" class="load-more">
        <button :disabled="loadingMore" @click="onLoadMore">
          {{ loadingMore ? 'Đang tải…' : '↓ Xem thêm' }}
        </button>
      </div>
      <div v-else-if="items.length > 0" class="end-marker">─ Hết ─</div>
    </div>

    <!-- Appointment dialog (shared) -->
    <AppointmentQuickDialog
      v-model="showAptDialog"
      :contact-id="props.contactId"
      :contact-name="props.contactName"
      :prefill="aptPrefill"
      header="🤖 Xác nhận tạo lịch hẹn"
      @created="onAppointmentCreated"
    />
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import { useTimeline, type ActivityLogItem } from '@/composables/use-timeline';
import { useNotes, type Note, type ParsedAppointment } from '@/composables/use-notes';
import { useUserPreferences } from '@/composables/use-user-preferences';
import { useAuthStore } from '@/stores/auth';
import { useToast } from '@/composables/use-toast';
import NoteRow from './NoteRow.vue';
import ActivityItem from './ActivityItem.vue';
import AppointmentQuickDialog from './AppointmentQuickDialog.vue';
import {
  CATEGORY_META,
  ALL_CATEGORIES,
  getDefaultVisibleCategories,
  type ActivityCategory,
} from '@/constants/activity-types';

const props = defineProps<{
  contactId: string | null;
  contactName?: string | null;
}>();

const emit = defineEmits<{
  'appointment-created': [];
}>();

const auth = useAuthStore();
const toast = useToast();
const currentUserId = computed(() => auth.user?.id || '');

const FILTER_OPTIONS = [
  { value: 'notes',    label: '📝 Ghi chú' },
  { value: 'activity', label: '⚡ Hoạt động' },
  { value: 'all',      label: 'Tất cả' },
];
// Default 'notes' — ghi chú là tác vụ user thường xuyên nhất khi mở panel KH
const filter = ref<'all' | 'notes' | 'activity'>('notes');

const { getPref, setPref, loadPrefs } = useUserPreferences();
const PREF_KEY = 'timeline.categories.visible';
const visibleCategories = ref<ActivityCategory[]>(getDefaultVisibleCategories());
const visibleCategoriesSet = computed(() => new Set(visibleCategories.value));

const timeline = useTimeline(() => props.contactId);
const { items, loading, loadingMore, hasMore } = timeline;
const rootNoteCount = computed(() => timeline.rootNoteCount.value);

// Today badge: count items có createdAt = hôm nay
const todayCount = computed(() => {
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return items.value.filter(i => new Date(i.createdAt).getTime() >= startOfDay).length;
});

// Note composer state — Enter để lưu, Shift+Enter để xuống dòng (mặc định, không cần toggle)
const rootDraft = ref('');

const replyTarget = ref<string | null>(null);
const replyDraft = ref('');
const replyInput = ref<HTMLTextAreaElement | null>(null);

const notesComposable = useNotes(() => props.contactId);
const { create, update, remove, toggleReaction, aiParse, linkAppointment, saving } = notesComposable;

const aiResult = ref(new Map<string, ParsedAppointment>());
const aiNoIntent = ref(new Set<string>());
const aiDisabled = ref(new Set<string>());

const showAptDialog = ref(false);
const aptPrefillNoteId = ref<string | null>(null);
const aptPrefill = ref<{ date?: string | null; time?: string | null; type?: string | null; location?: string | null; summary?: string | null }>({});

/* ── Effective filter: derive categories param for backend ──────────── */
const effectiveCategories = computed<string[] | undefined>(() => {
  if (filter.value === 'notes') return ['note'];
  if (filter.value === 'activity') return visibleCategories.value;
  // 'all' → include 'note' + all visible activity categories
  return ['note', ...visibleCategories.value];
});

function setFilter(v: 'all' | 'notes' | 'activity') {
  filter.value = v;
  void timeline.refresh(effectiveCategories.value);
}

function toggleCategory(cat: ActivityCategory) {
  const set = new Set(visibleCategories.value);
  if (set.has(cat)) set.delete(cat);
  else set.add(cat);
  visibleCategories.value = Array.from(set);
  void setPref(PREF_KEY, visibleCategories.value);
  void timeline.refresh(effectiveCategories.value);
}

function resetDefaults() {
  visibleCategories.value = getDefaultVisibleCategories();
  void setPref(PREF_KEY, visibleCategories.value);
  void timeline.refresh(effectiveCategories.value);
}

function goToFullPage() {
  if (props.contactId) window.location.assign(`/customers/${props.contactId}/activity`);
}

async function onLoadMore() {
  await timeline.loadMore(effectiveCategories.value);
}

/* ── Init: load prefs + fetch first page khi đổi contact ──────────── */
async function bootstrap() {
  await loadPrefs();
  const saved = await getPref<ActivityCategory[] | null>(PREF_KEY, null);
  if (saved && Array.isArray(saved) && saved.length) {
    visibleCategories.value = saved;
  }
  await timeline.fetchFirstPage(effectiveCategories.value);
}

watch(() => props.contactId, (id) => {
  // Reset state
  rootDraft.value = '';
  replyDraft.value = '';
  replyTarget.value = null;
  aiResult.value.clear();
  aiNoIntent.value.clear();
  aiDisabled.value.clear();
  if (id) void bootstrap();
  else timeline.items.value = [];
}, { immediate: true });

onMounted(() => loadPrefs());

/* ── Note composer logic ─────────────────────────────────────────── */
// Enter = lưu, Shift+Enter = xuống dòng (mặc định, không cần toggle)
function onComposerKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { rootDraft.value = ''; return; }
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  void submitRoot();
}
function onReplyKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') { cancelReply(); return; }
  if (e.key !== 'Enter' || e.shiftKey) return;
  e.preventDefault();
  void submitReply();
}
async function submitRoot() {
  if (!rootDraft.value.trim()) return;
  const created = await create(rootDraft.value, null);
  if (created) {
    toast.success('Đã thêm ghi chú');
    rootDraft.value = '';
    await timeline.refresh(effectiveCategories.value);
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
    await timeline.refresh(effectiveCategories.value);
  }
}

function onReact(noteId: string, emoji: string) {
  if (!currentUserId.value) return;
  void toggleReaction(noteId, emoji, currentUserId.value).then(() => {
    void timeline.refresh(effectiveCategories.value);
  });
}
async function onEdit(noteId: string, newBody: string) {
  const ok = await update(noteId, newBody);
  if (ok) {
    toast.success('Đã sửa ghi chú');
    await timeline.refresh(effectiveCategories.value);
  }
}
async function onDelete(noteId: string) {
  // Backup nội dung trước khi xoá để hoàn tác (re-create note với same body + parentId)
  const targetNote = items.value.find(i => i.type === 'note' && (i.data as Note).id === noteId)?.data as Note | undefined;
  const ok = await remove(noteId);
  if (ok) {
    await timeline.refresh(effectiveCategories.value);
    // Undo 5s — re-create note với original body + parentId
    if (targetNote) {
      toast.undo('Đã xoá ghi chú', async () => {
        const restored = await create(targetNote.body, targetNote.parentNoteId);
        if (restored) {
          toast.success('✓ Đã khôi phục');
          await timeline.refresh(effectiveCategories.value);
        } else {
          toast.error('Khôi phục thất bại');
        }
      });
    }
  }
}

async function onAiParse(noteId: string) {
  if (aiDisabled.value.has(noteId)) return;
  toast.push('🤖 AI đang phân tích…');
  const parsed = await aiParse(noteId);
  if (parsed && parsed.hasIntent) {
    aiResult.value.set(noteId, parsed);
    aiNoIntent.value.delete(noteId);
  } else {
    aiDisabled.value.add(noteId);
    aiNoIntent.value.add(noteId);
    setTimeout(() => {
      aiNoIntent.value.delete(noteId);
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

function openAptDialog(note: Note) {
  const p = aiResult.value.get(note.id);
  if (!p) return;
  aptPrefillNoteId.value = note.id;
  aptPrefill.value = {
    date: p.date,
    time: p.time,
    type: p.type,
    location: p.location,
    summary: p.summary || note.body.slice(0, 160),
  };
  showAptDialog.value = true;
}

async function onAppointmentCreated(aptId: string) {
  if (aptPrefillNoteId.value) {
    await linkAppointment(aptPrefillNoteId.value, aptId);
    aiResult.value.delete(aptPrefillNoteId.value);
  }
  aptPrefillNoteId.value = null;
  emit('appointment-created');
  await timeline.refresh(effectiveCategories.value);
}

defineExpose({ rootCount: rootNoteCount });
</script>

<style scoped>
.timeline-section {
  display: flex;
  flex-direction: column;
  min-height: 0;
  gap: 6px;
}

.tl-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 2px;
  gap: 8px;
  flex-wrap: wrap;
}
.tl-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--smax-grey-700);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.tl-count {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  text-transform: none;
}
.today-badge {
  background: linear-gradient(90deg, #fff3e0, #fff8e1);
  color: #c43a00;
  border: 1px solid #ffb74d;
  border-radius: 11px;
  font-size: 10.5px;
  font-weight: 700;
  padding: 1px 9px;
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  transition: filter 0.12s;
}
.today-badge:hover { filter: brightness(0.96); }
.tl-controls {
  display: flex;
  align-items: center;
  gap: 6px;
}
.filter-chips {
  display: inline-flex;
  background: var(--smax-grey-100, #f5f6fa);
  border-radius: 8px;
  padding: 2px;
  gap: 1px;
}
.chip {
  background: transparent;
  border: none;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  cursor: pointer;
  color: var(--smax-grey-700);
  transition: all 0.1s;
}
.chip:hover { color: var(--smax-primary); }
.chip.active {
  background: #fff;
  color: var(--smax-primary, #2962ff);
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.settings-btn {
  background: var(--smax-grey-100);
  border: none;
  width: 26px;
  height: 26px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  color: var(--smax-grey-700);
}
.settings-btn:hover { background: var(--smax-primary-soft); color: var(--smax-primary); }

.settings-dropdown {
  background: #fff;
  border-radius: 10px;
  padding: 8px 4px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  min-width: 220px;
}
.sd-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 4px 12px 6px;
}
.sd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  border-radius: 6px;
}
.sd-row:hover { background: var(--smax-grey-50); }
.sd-row input { cursor: pointer; }
.sd-icon { width: 18px; text-align: center; }
.sd-label { color: var(--smax-text); flex: 1; }
.sd-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  border-top: 1px solid var(--smax-grey-100);
  margin-top: 4px;
}
.sd-reset, .sd-link {
  background: none;
  border: none;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  color: var(--smax-grey-600);
}
.sd-reset:hover { color: var(--smax-grey-800); }
.sd-link { color: var(--smax-primary); }
.sd-link:hover { text-decoration: underline; }

/* Note composer */
.note-composer {
  display: flex;
  align-items: flex-end;
  gap: 5px;
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 8px;
  padding: 5px 5px 5px 8px;
  background: #fff;
  transition: border-color 0.15s;
}
.note-composer:focus-within {
  border-color: var(--smax-primary);
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
  white-space: nowrap;        /* placeholder không wrap */
  overflow-x: hidden;
  text-overflow: ellipsis;
}
.note-input::placeholder {
  color: var(--smax-grey-400, #b0b8c1);   /* mờ rõ ràng */
  font-style: italic;
  opacity: 1;                              /* override browser default */
}
/* Khi user gõ text → bỏ nowrap để xuống dòng bình thường */
.note-input:focus,
.note-input:not(:placeholder-shown) {
  white-space: pre-wrap;
  overflow-x: visible;
}
.send-btn {
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: var(--smax-primary);
  color: #fff;
  border: none;
  font-size: 14px;
  cursor: pointer;
}
.send-btn.small { width: 26px; height: 26px; font-size: 12px; }
.send-btn:disabled { background: var(--smax-grey-300); cursor: not-allowed; }
.btn-x {
  background: none;
  border: none;
  color: var(--smax-grey-500);
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.tl-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 460px;
  overflow-y: auto;
  padding-right: 4px;
}
.tl-list::-webkit-scrollbar { width: 5px; }
.tl-list::-webkit-scrollbar-thumb { background: var(--smax-grey-200); border-radius: 3px; }

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
  gap: 3px;
  margin-top: 2px;
}

.tl-state {
  padding: 16px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--smax-grey-500);
}
.tl-state.empty .empty-icon {
  font-size: 26px;
  display: block;
  margin-bottom: 4px;
}

.load-more {
  text-align: center;
  padding: 8px;
}
.load-more button {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  border: none;
  padding: 5px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.load-more button:hover:not(:disabled) { background: var(--smax-primary-soft); color: var(--smax-primary); }
.end-marker {
  text-align: center;
  padding: 8px;
  font-size: 11px;
  color: var(--smax-grey-400);
}

/* AI banner reuse từ NotesSection */
.ai-suggestion-banner {
  display: flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(90deg, #fff3e0 0%, #fff8e1 100%);
  border: 1px solid #ffb74d;
  border-radius: 7px;
  padding: 5px 10px;
  margin-top: 3px;
  font-size: 12px;
}
.ai-suggestion-banner.muted {
  background: var(--smax-grey-50);
  border-color: var(--smax-grey-200);
  animation: fadeOutBanner 5s ease forwards;
}
@keyframes fadeOutBanner {
  0%, 80% { opacity: 1; }
  100% { opacity: 0; }
}
.ai-icon { font-size: 14px; }
.ai-text { flex: 1; color: #6d4c00; }
.ai-text.muted { color: var(--smax-grey-500); font-style: italic; }
.ai-text strong { color: #c43a00; }
.needs-input { color: #f57c00; font-style: italic; font-weight: 500; }
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
.ai-dismiss {
  background: none;
  border: none;
  color: var(--smax-grey-500);
  font-size: 16px;
  cursor: pointer;
  padding: 0 4px;
}
</style>
