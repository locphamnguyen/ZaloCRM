<template>
  <div class="special-message" :data-type="type">
    <!-- Bank Transfer -->
    <v-card v-if="type === 'bank_transfer'" variant="tonal" color="success" class="pa-3" rounded="lg">
      <div class="d-flex align-center">
        <v-icon icon="mdi-bank-transfer" size="28" class="mr-3" />
        <div>
          <div class="font-weight-bold">{{ bankName || 'Chuyển khoản' }}</div>
          <div v-if="amount" class="text-h6">{{ formatAmount(amount) }}</div>
          <div v-if="description" class="text-caption text-medium-emphasis">{{ description }}</div>
        </div>
      </div>
    </v-card>

    <!-- Call (voice/video, incoming/outgoing, missed) — proper card -->
    <div v-else-if="type === 'call'" class="call-card" :class="{ missed: isMissed, video: isVideo }">
      <div class="call-icon">
        <v-icon :size="22">{{ callIconName }}</v-icon>
      </div>
      <div class="call-meta">
        <div class="call-title">{{ callLabel }}</div>
        <div v-if="!isMissed && callDuration > 0" class="call-duration">{{ formatDuration(callDuration) }}</div>
        <div v-else-if="isMissed" class="call-subtitle">{{ isCaller ? 'Bạn đã gọi nhỡ' : 'Cuộc gọi nhỡ' }}</div>
      </div>
    </div>

    <!-- QR Code -->
    <v-card v-else-if="type === 'qr_code'" variant="outlined" class="pa-3 text-center" rounded="lg" style="max-width: 140px;">
      <v-icon icon="mdi-qrcode" size="48" color="primary" />
      <div class="text-caption mt-1">Mã QR</div>
    </v-card>

    <!-- Reminder / Calendar -->
    <v-card v-else-if="type === 'reminder'" variant="tonal" color="warning" class="pa-3" rounded="lg">
      <div class="d-flex align-center">
        <v-icon icon="mdi-calendar-clock" class="mr-2" />
        <span>{{ title || 'Nhắc hẹn' }}</span>
      </div>
    </v-card>

    <!-- Poll / Vote -->
    <v-card v-else-if="type === 'poll'" variant="tonal" color="info" class="pa-3" rounded="lg">
      <div class="d-flex align-center mb-2">
        <v-icon icon="mdi-poll" class="mr-2" />
        <strong>{{ title || 'Bình chọn' }}</strong>
      </div>
      <ul v-if="pollOptions.length" class="poll-options">
        <li v-for="(o, i) in pollOptions" :key="i">○ {{ o }}</li>
      </ul>
    </v-card>

    <!-- Note -->
    <v-card v-else-if="type === 'note'" variant="tonal" color="orange" class="pa-3" rounded="lg">
      <div class="d-flex align-center">
        <v-icon icon="mdi-note-text" class="mr-2" />
        <strong>{{ title || 'Ghi chú' }}</strong>
      </div>
      <div v-if="noteBody" class="note-body mt-2" v-html="noteBody" />
    </v-card>

    <!-- Forwarded -->
    <div v-else-if="type === 'forwarded'" class="forwarded-card">
      <div class="forwarded-header">
        <v-icon size="13" class="mr-1">mdi-share</v-icon>
        Tin nhắn chuyển tiếp
      </div>
      <div v-if="forwardedText" class="forwarded-body" v-html="forwardedText" />
    </div>

    <!-- Generic rich content — best-effort render -->
    <div v-else class="rich-card">
      <!-- Title (multi-line + Zalo params.styles bold/italic/color applied) -->
      <div v-if="richTitleHtml" class="rich-title" v-html="richTitleHtml" />

      <!-- Body text -->
      <div v-if="richBodyHtml" class="rich-body" v-html="richBodyHtml" />

      <!-- Link -->
      <a v-if="richHref" :href="richHref" target="_blank" rel="noopener" class="rich-link">
        🔗 {{ richHrefLabel }}
      </a>

      <!-- Thumbnail image -->
      <img v-if="richThumb" :src="richThumb" :alt="title || 'preview'" class="rich-thumb" />

      <!-- Fallback khi không extract được gì có ý nghĩa -->
      <div v-if="!richTitleHtml && !richBodyHtml && !richHref && !richThumb" class="rich-fallback">
        <v-icon size="14" class="mr-1">mdi-message-text</v-icon>
        Tin nhắn đặc biệt
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  content: any;
}>();

// ── Bank transfer ────────────────────────────────────────────────────────
const bankName = computed<string>(() => props.content?.bankName || props.content?.bankCode || '');
const amount = computed<number | null>(() => {
  const v = props.content?.amount ?? props.content?.transferAmount;
  return v != null ? Number(v) : null;
});
const description = computed<string>(() => props.content?.description || props.content?.content || '');

function formatAmount(value: number): string {
  return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

// ── Call ─────────────────────────────────────────────────────────────────
const isMissed = computed<boolean>(() => {
  if (typeof props.content?.isMissed === 'boolean') return props.content.isMissed;
  const action = (props.content?.action || '').toLowerCase();
  if (action.includes('misscall')) return true;
  const t = (props.content?.callType || '').toLowerCase();
  return t.includes('miss') || props.content?.duration === 0;
});
const isVideo = computed<boolean>(() => {
  const t = (props.content?.callType || '').toString().toLowerCase();
  return t === 'video' || t.includes('video');
});
const isCaller = computed<boolean>(() => !!props.content?.isCaller);
const callDuration = computed<number>(() =>
  Number(props.content?.callDuration ?? props.content?.duration ?? 0),
);
const callLabel = computed<string>(() => {
  if (isMissed.value) {
    if (isCaller.value) return isVideo.value ? 'Cuộc gọi video không trả lời' : 'Cuộc gọi không trả lời';
    return isVideo.value ? 'Cuộc gọi video nhỡ' : 'Cuộc gọi nhỡ';
  }
  if (isCaller.value) return isVideo.value ? 'Cuộc gọi video đi' : 'Cuộc gọi đi';
  return isVideo.value ? 'Cuộc gọi video đến' : 'Cuộc gọi đến';
});
const callIconName = computed<string>(() => {
  if (isVideo.value) return isMissed.value ? 'mdi-video-off' : 'mdi-video';
  if (isMissed.value) return 'mdi-phone-missed';
  return isCaller.value ? 'mdi-phone-outgoing' : 'mdi-phone-incoming';
});
function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} giây`;
  if (s === 0) return `${m} phút`;
  return `${m} phút ${s} giây`;
}

// ── Generic title (reminder/poll) ────────────────────────────────────────
const title = computed<string>(() => props.content?.title || props.content?.name || '');

// ── Poll options ─────────────────────────────────────────────────────────
const pollOptions = computed<string[]>(() => {
  const opts = props.content?.options || props.content?.choices;
  if (!Array.isArray(opts)) return [];
  return opts
    .map((o: unknown) => (typeof o === 'string' ? o : (o as { text?: string; label?: string })?.text || (o as { label?: string })?.label || ''))
    .filter(Boolean);
});

// ════════════════════════════════════════════════════════════════════════
// Zalo "rtf" rich-text format
//   content.title — multi-line string với \n
//   content.params (JSON string) — { styles: [{ st, start, len }], mentions: [...] }
//     st: 'b' bold | 'i' italic | 'u' underline | 'c_FFXXXX' hex color | 'f_NN' size
// ════════════════════════════════════════════════════════════════════════
interface StyleMark { st: string; start: number; len: number }
interface MentionMark { pos?: number; start?: number; len: number; uid?: string; user_name?: string }

const paramsObj = computed<Record<string, unknown> | null>(() => {
  const raw = props.content?.params;
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw); } catch { return null; }
  }
  return null;
});

const styles = computed<StyleMark[]>(() => {
  const s = paramsObj.value?.styles;
  return Array.isArray(s) ? (s as StyleMark[]) : [];
});

const mentions = computed<MentionMark[]>(() => {
  const m = paramsObj.value?.mentions;
  return Array.isArray(m) ? (m as MentionMark[]) : [];
});

// ── HTML helpers ─────────────────────────────────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function openTagFor(st: string): string {
  if (st === 'b') return '<strong>';
  if (st === 'i') return '<em>';
  if (st === 'u') return '<u>';
  if (st.startsWith('c_')) return `<span style="color:#${st.slice(2)}">`;
  if (st.startsWith('s_')) return `<span style="font-size:${st.slice(2)}px">`;
  return '';
}
function closeTagFor(st: string): string {
  if (st === 'b') return '</strong>';
  if (st === 'i') return '</em>';
  if (st === 'u') return '</u>';
  if (st.startsWith('c_')) return '</span>';
  if (st.startsWith('s_')) return '</span>';
  return '';
}

/**
 * Apply style marks to plain text → escaped HTML with bold/italic/color spans.
 * Walks text char-by-char, opens/closes tags at style boundaries.
 * Linebreaks (\n) get converted to <br>. Mentions positions get wrapped in mention spans.
 */
function applyRichFormat(text: string, sList: StyleMark[], mList: MentionMark[]): string {
  if (!text) return '';

  // Build active-styles per character index
  const len = text.length;
  const activePerChar: string[][] = Array.from({ length: len }, () => []);
  for (const m of sList) {
    const start = Math.max(0, m.start | 0);
    const end = Math.min(len, start + (m.len | 0));
    for (let i = start; i < end; i++) activePerChar[i].push(m.st);
  }
  const mentionRanges: Set<number>[] = mList
    .map(m => {
      const start = Math.max(0, (m.pos ?? m.start ?? 0) | 0);
      const end = Math.min(len, start + (m.len | 0));
      const set = new Set<number>();
      for (let i = start; i < end; i++) set.add(i);
      return set;
    });
  const isMentionStart = (i: number) => mentionRanges.some(s => s.has(i) && !s.has(i - 1));
  const isMentionEnd = (i: number) => mentionRanges.some(s => s.has(i) && !s.has(i + 1));

  let out = '';
  let prevKey = '';

  function emitOpen(keys: string[]) {
    return keys.map(openTagFor).filter(Boolean).join('');
  }
  function emitClose(keys: string[]) {
    return [...keys].reverse().map(closeTagFor).filter(Boolean).join('');
  }

  let prevList: string[] = [];
  for (let i = 0; i < len; i++) {
    const cur = activePerChar[i].slice().sort();
    const curKey = cur.join(',');
    if (curKey !== prevKey) {
      out += emitClose(prevList);
      out += emitOpen(cur);
      prevList = cur;
      prevKey = curKey;
    }

    // Mention boundary
    if (isMentionStart(i)) out += '<span class="mention">';

    const ch = text[i];
    if (ch === '\n') out += '<br>';
    else if (ch === '\r') { /* ignore */ }
    else out += escapeHtml(ch);

    if (isMentionEnd(i)) out += '</span>';
  }
  out += emitClose(prevList);
  return out;
}

/** Fallback: format raw text without style marks — just escape + mention regex + linebreak. */
function plainFormat(text: string): string {
  if (!text) return '';
  let s = escapeHtml(text);
  s = s.replace(/@([\p{L}][\p{L}0-9._-]+(?:\s[\p{L}][\p{L}0-9._-]+){0,2})/gu, '<span class="mention">@$1</span>');
  s = s.replace(/\r?\n/g, '<br>');
  return s;
}

// ── Rich card extraction with full formatting ────────────────────────────
const richTitleHtml = computed<string>(() => {
  const t = props.content?.title || props.content?.subject;
  if (typeof t !== 'string' || !t.trim()) return '';
  return styles.value.length || mentions.value.length
    ? applyRichFormat(t, styles.value, mentions.value)
    : plainFormat(t);
});

const richBodyHtml = computed<string>(() => {
  const raw = props.content?.text
    || props.content?.description
    || props.content?.body
    || props.content?.content
    || props.content?.caption
    || '';
  if (typeof raw !== 'string' || !raw.trim()) return '';
  // Body uses simpler format (Zalo styles thường chỉ apply trên title)
  return plainFormat(raw);
});

const richHref = computed<string>(() => {
  const h = props.content?.href || props.content?.url || props.content?.link;
  return typeof h === 'string' ? h : '';
});
const richHrefLabel = computed<string>(() => {
  if (!richHref.value) return '';
  try {
    const u = new URL(richHref.value);
    return u.hostname + (u.pathname.length > 1 ? u.pathname.slice(0, 30) : '');
  } catch {
    return richHref.value;
  }
});
const richThumb = computed<string>(() => {
  const t = props.content?.thumb || props.content?.thumbnail || props.content?.imageUrl;
  return typeof t === 'string' && t.startsWith('http') ? t : '';
});

// Note + forwarded reuse plainFormat
const noteBody = computed<string>(() => {
  const raw = props.content?.body || props.content?.content || props.content?.text || '';
  return plainFormat(typeof raw === 'string' ? raw : '');
});
const forwardedText = computed<string>(() => {
  const raw = props.content?.content || props.content?.text || props.content?.title || '';
  return plainFormat(typeof raw === 'string' ? raw : '');
});
</script>

<style scoped>
.special-message {
  display: block;
  max-width: 100%;
}

.rich-card {
  background: var(--smax-grey-50, #fafbfc);
  border: 1px solid var(--smax-grey-200, #ebedf0);
  border-radius: 9px;
  padding: 9px 11px;
  font-size: 13.5px;
  line-height: 1.5;
}
.rich-title {
  font-weight: 600;
  margin-bottom: 4px;
  color: var(--smax-text, #212121);
  white-space: pre-wrap;
  word-break: break-word;
}
.rich-body {
  color: var(--smax-text, #212121);
  white-space: pre-wrap;
  word-break: break-word;
}
.rich-link {
  display: inline-flex; align-items: center;
  color: var(--smax-primary, #2962ff);
  text-decoration: none;
  margin-top: 4px;
  font-size: 12.5px;
}
.rich-link:hover { text-decoration: underline; }
.rich-thumb {
  display: block;
  max-width: 100%;
  max-height: 180px;
  margin-top: 6px;
  border-radius: 6px;
  object-fit: cover;
}
.rich-fallback {
  display: inline-flex; align-items: center;
  font-size: 12px;
  color: var(--smax-grey-700, #5a6478);
  font-style: italic;
}

.forwarded-card {
  border-left: 3px solid #9c27b0;
  background: rgba(156, 39, 176, 0.06);
  padding: 7px 11px;
  border-radius: 0 7px 7px 0;
  font-size: 13px;
}
.forwarded-header {
  display: flex; align-items: center;
  font-size: 11px; font-weight: 600;
  color: #9c27b0;
  margin-bottom: 4px;
}
.forwarded-body {
  color: var(--smax-text, #212121);
  word-break: break-word;
  white-space: pre-wrap;
}

.note-body {
  font-size: 13px;
  color: var(--smax-text, #212121);
  word-break: break-word;
  white-space: pre-wrap;
}

.poll-options {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  font-size: 13px;
}
.poll-options li { padding: 2px 0; }

/* ════════ Call card ════════ */
.call-card {
  display: inline-flex; align-items: center; gap: 11px;
  padding: 9px 13px;
  border-radius: 9px;
  background: rgba(33, 150, 243, 0.08);
  border: 1px solid rgba(33, 150, 243, 0.25);
  min-width: 200px;
}
.call-card.missed {
  background: rgba(255, 82, 82, 0.07);
  border-color: rgba(255, 82, 82, 0.30);
}
.call-card.video:not(.missed) {
  background: rgba(156, 39, 176, 0.07);
  border-color: rgba(156, 39, 176, 0.25);
}
.call-icon {
  width: 36px; height: 36px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: var(--smax-primary, #2962ff);
  color: white;
  flex-shrink: 0;
}
.call-card.missed .call-icon { background: var(--smax-error, #ff3d00); }
.call-card.video:not(.missed) .call-icon { background: #9c27b0; }

.call-meta { display: flex; flex-direction: column; gap: 2px; }
.call-title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--smax-text);
}
.call-duration {
  font-size: 12px;
  color: var(--smax-grey-700);
}
.call-subtitle {
  font-size: 11.5px;
  color: var(--smax-grey-700);
  font-style: italic;
}

/* Rich styling — preserve normal-weight inside body, only emphasize via tags */
:deep(.rich-title strong),
:deep(.rich-body strong),
:deep(.note-body strong),
:deep(.forwarded-body strong) {
  font-weight: 700;
}
:deep(.rich-title em),
:deep(.rich-body em) { font-style: italic; }
:deep(.rich-title u),
:deep(.rich-body u) { text-decoration: underline; }

/* Mention highlight - styled across all rich/note/forwarded contents */
:deep(.mention) {
  color: var(--smax-primary, #2962ff);
  font-weight: 500;
  background: var(--smax-primary-soft, #e3f2fd);
  padding: 0 4px;
  border-radius: 3px;
}
</style>
