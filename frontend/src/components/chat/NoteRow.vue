<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="note-row" :class="{ 'is-reply': isReply }">
    <div class="note-avatar">
      <span class="avatar-letter">{{ authorInitial }}</span>
    </div>
    <div class="note-body-wrap">
      <div class="note-bubble">
        <div class="note-meta">
          <span class="author-name">{{ note.author?.fullName || 'Người dùng' }}</span>
          <span class="meta-dot">·</span>
          <time class="meta-time" :title="absTime">{{ relTime }}</time>
          <span v-if="note.suggestedAppointmentId" class="apt-badge" title="Đã tạo lịch hẹn">
            ✓ lịch hẹn
          </span>
        </div>

        <!-- Body: read or edit -->
        <p v-if="!editing" class="note-text">{{ note.body }}</p>
        <textarea
          v-else
          ref="editInput"
          v-model="editDraft"
          class="edit-input"
          name="note-edit-draft"
          autocomplete="off"
          rows="2"
          @keydown.ctrl.enter.prevent="commitEdit"
          @keydown.meta.enter.prevent="commitEdit"
          @keydown.escape="cancelEdit"
        />
        <div v-if="editing" class="edit-actions">
          <button class="btn-link" @click="cancelEdit">Hủy</button>
          <button class="btn-primary" @click="commitEdit">Lưu</button>
        </div>

        <!-- Reactions strip (clustered) -->
        <div v-if="clusteredReactions.length" class="reactions-strip">
          <button
            v-for="r in clusteredReactions"
            :key="r.emoji"
            class="reaction-chip"
            :class="{ mine: r.mine }"
            :title="r.users.join(', ')"
            @click="$emit('react', note.id, r.emoji)"
          >
            <span>{{ r.emoji }}</span>
            <span class="reaction-count">{{ r.count }}</span>
          </button>
        </div>
      </div>

      <!-- Actions row -->
      <div v-if="!editing" class="note-actions">
        <button class="action-btn" @click="showEmojiPicker = !showEmojiPicker">
          😊
        </button>
        <div v-if="showEmojiPicker" class="emoji-picker">
          <button v-for="e in EMOJI_PALETTE" :key="e" class="emoji-pick" @click="pickEmoji(e)">
            {{ e }}
          </button>
        </div>
        <button v-if="!isReply" class="action-btn text" @click="$emit('reply', note.id)">
          💬 Trả lời
        </button>
        <button
          v-if="!isReply && !note.suggestedAppointmentId"
          class="action-btn ai"
          :disabled="aiDisabled"
          :title="aiDisabled ? 'AI đã phân tích — không có ý định hẹn' : 'AI phân tích thời gian/địa điểm → đề xuất lịch hẹn'"
          @click="!aiDisabled && $emit('ai-parse', note.id)"
        >
          🤖 AI lịch hẹn
        </button>
        <button v-if="isMine" class="action-btn text small" @click="startEdit">Sửa</button>
        <button v-if="isMine" class="action-btn text small danger" @click="$emit('delete', note.id)">Xoá</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import type { Note } from '@/composables/use-notes';
import { formatInOrgTz, getOrgParts } from '@/composables/use-org-timezone';

const props = defineProps<{
  note: Note;
  currentUserId: string;
  isReply?: boolean;
  aiDisabled?: boolean;
}>();

const emit = defineEmits<{
  react: [noteId: string, emoji: string];
  reply: [noteId: string];
  edit: [noteId: string, newBody: string];
  delete: [noteId: string];
  'ai-parse': [noteId: string];
}>();

const EMOJI_PALETTE = ['👍', '❤️', '😂', '😮', '😢', '🎉'];

const editing = ref(false);
const editDraft = ref('');
const editInput = ref<HTMLTextAreaElement | null>(null);
const showEmojiPicker = ref(false);

const isMine = computed(() => props.note.authorUserId === props.currentUserId);
const authorInitial = computed(() => {
  const name = props.note.author?.fullName || props.note.author?.email || '?';
  return name.charAt(0).toUpperCase();
});

const relTime = computed(() => {
  const d = new Date(props.note.createdAt).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m}p`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}n`;
  const p = getOrgParts(props.note.createdAt);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`;
});

const absTime = computed(() => formatInOrgTz(props.note.createdAt));

const clusteredReactions = computed(() => {
  const map = new Map<string, { emoji: string; count: number; mine: boolean; users: string[] }>();
  for (const r of props.note.reactions) {
    const entry = map.get(r.emoji) || { emoji: r.emoji, count: 0, mine: false, users: [] };
    entry.count++;
    if (r.userId === props.currentUserId) entry.mine = true;
    if (r.user?.fullName) entry.users.push(r.user.fullName);
    map.set(r.emoji, entry);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
});

function pickEmoji(e: string) {
  emit('react', props.note.id, e);
  showEmojiPicker.value = false;
}

function startEdit() {
  editing.value = true;
  editDraft.value = props.note.body;
  nextTick(() => editInput.value?.focus());
}
function cancelEdit() { editing.value = false; editDraft.value = ''; }
function commitEdit() {
  if (!editDraft.value.trim() || editDraft.value === props.note.body) {
    cancelEdit();
    return;
  }
  emit('edit', props.note.id, editDraft.value.trim());
  editing.value = false;
}
</script>

<style scoped>
.note-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.note-avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--smax-primary, #2962ff), #5e92ff);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  margin-top: 2px;
}
.note-row.is-reply .note-avatar {
  width: 24px;
  height: 24px;
  font-size: 11px;
}

.note-body-wrap {
  flex: 1;
  min-width: 0;
}

.note-bubble {
  background: var(--smax-grey-100, #f5f6fa);
  border-radius: 12px;
  padding: 6px 10px;
}
.note-row.is-reply .note-bubble {
  background: var(--smax-grey-50, #f9fafb);
  border: 1px solid var(--smax-grey-100);
}

.note-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  margin-bottom: 2px;
  flex-wrap: wrap;
}
.author-name {
  font-weight: 600;
  color: var(--smax-grey-800, #2c2f33);
  font-size: 12px;
}
.meta-dot { color: var(--smax-grey-400); }
.meta-time {
  color: var(--smax-grey-500);
  cursor: help;
}
.apt-badge {
  background: rgba(0,200,83,0.12);
  color: #00897b;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  margin-left: 4px;
}

.note-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: var(--smax-text, #212121);
  white-space: pre-wrap;
  word-break: break-word;
}

.edit-input {
  width: 100%;
  border: 1px solid var(--smax-primary);
  border-radius: 5px;
  padding: 5px 7px;
  font-family: inherit;
  font-size: 13px;
  resize: vertical;
  outline: none;
}
.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 4px;
}

/* ── Reaction strip ──────────────────────────────────────────────────── */
.reactions-strip {
  display: flex;
  gap: 4px;
  margin-top: 5px;
  flex-wrap: wrap;
}
.reaction-chip {
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 11px;
  padding: 1px 7px;
  font-size: 11px;
  display: flex;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: transform 0.1s, background 0.15s;
}
.reaction-chip:hover { transform: scale(1.06); }
.reaction-chip.mine {
  background: var(--smax-primary-soft, #e3f2fd);
  border-color: var(--smax-primary, #2962ff);
}
.reaction-count {
  color: var(--smax-grey-700);
  font-weight: 600;
}

/* ── Actions row ─────────────────────────────────────────────────────── */
/* Actions collapse to zero height by default — note bubbles sit sát nhau (chỉ 4px gap).
 * Hover trên note-row → actions expand → các note bên dưới TỤT XUỐNG theo (no overlay).
 * Cả root + reply đều áp dụng. Touch device không hover → luôn hiện. */
.note-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-left: 4px;
  font-size: 11px;
  position: relative;
  max-height: 0;
  margin-top: 0;
  overflow: visible; /* visible để emoji-picker absolute không bị cắt */
  opacity: 0;
  pointer-events: none;
  transition: max-height 0.18s ease, opacity 0.15s, margin-top 0.18s;
}
.note-row:hover .note-actions,
.note-row:focus-within .note-actions {
  max-height: 26px;
  margin-top: 3px;
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none) {
  .note-actions {
    max-height: 26px;
    margin-top: 3px;
    opacity: 1;
    pointer-events: auto;
  }
}
.action-btn {
  background: none;
  border: none;
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--smax-grey-600);
  transition: background 0.12s;
}
.action-btn:hover { background: var(--smax-grey-100); }
.action-btn.text { font-size: 11px; font-weight: 500; }
.action-btn.small { font-size: 10px; }
.action-btn.danger:hover { color: #c62828; background: rgba(255,82,82,0.08); }
.action-btn.ai { color: #f57c00; }
.action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  text-decoration: line-through;
}

.emoji-picker {
  position: absolute;
  top: -28px;
  left: 0;
  background: #fff;
  border: 1px solid var(--smax-grey-200);
  border-radius: 18px;
  padding: 2px 4px;
  display: flex;
  gap: 2px;
  box-shadow: 0 3px 9px rgba(0,0,0,0.12);
  z-index: 20;
}
.emoji-pick {
  background: none;
  border: none;
  font-size: 16px;
  padding: 3px 5px;
  cursor: pointer;
  border-radius: 50%;
  transition: transform 0.1s, background 0.1s;
}
.emoji-pick:hover {
  transform: scale(1.25);
  background: var(--smax-grey-100);
}

.btn-link {
  background: none;
  border: none;
  color: var(--smax-grey-600);
  font-size: 12px;
  cursor: pointer;
  padding: 3px 6px;
}
.btn-primary {
  background: var(--smax-primary);
  color: #fff;
  border: none;
  border-radius: 5px;
  padding: 3px 9px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
</style>
