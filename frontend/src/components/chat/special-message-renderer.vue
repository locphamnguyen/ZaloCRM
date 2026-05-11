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

    <!-- Call (voice or video) -->
    <v-chip
      v-else-if="type === 'call'"
      variant="tonal"
      :color="isMissed ? 'error' : 'primary'"
      label
    >
      <v-icon :icon="isVideo ? 'mdi-video' : 'mdi-phone'" class="mr-1" />
      {{ callLabel }}
    </v-chip>

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
      <!-- Title -->
      <div v-if="richTitle" class="rich-title">{{ richTitle }}</div>

      <!-- Body text (with @mention + bullet rendering) -->
      <div v-if="richBody" class="rich-body" v-html="richBody" />

      <!-- Link -->
      <a v-if="richHref" :href="richHref" target="_blank" rel="noopener" class="rich-link">
        🔗 {{ richHrefLabel }}
      </a>

      <!-- Thumbnail image -->
      <img v-if="richThumb" :src="richThumb" :alt="richTitle || 'preview'" class="rich-thumb" />

      <!-- Fallback khi không extract được gì có ý nghĩa -->
      <div v-if="!richTitle && !richBody && !richHref && !richThumb" class="rich-fallback">
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
  const t = (props.content?.callType || '').toLowerCase();
  return t.includes('miss') || props.content?.duration === 0;
});
const isVideo = computed<boolean>(() => {
  const t = (props.content?.callType || '').toLowerCase();
  return t.includes('video');
});
const callLabel = computed<string>(() => {
  if (isMissed.value) return isVideo.value ? 'Cuộc gọi video nhỡ' : 'Cuộc gọi nhỡ';
  const dur = props.content?.callDuration ?? props.content?.duration;
  if (dur) {
    const mins = Math.floor(dur / 60);
    const secs = dur % 60;
    const label = mins > 0 ? `${mins}p${secs}s` : `${secs}s`;
    return isVideo.value ? `Gọi video (${label})` : `Cuộc gọi (${label})`;
  }
  return isVideo.value ? 'Cuộc gọi video' : 'Cuộc gọi';
});

// ── Generic title (reminder/poll/note) ───────────────────────────────────
const title = computed<string>(() => props.content?.title || props.content?.name || '');

// ── Poll options ─────────────────────────────────────────────────────────
const pollOptions = computed<string[]>(() => {
  const opts = props.content?.options || props.content?.choices;
  if (!Array.isArray(opts)) return [];
  return opts
    .map((o: unknown) => (typeof o === 'string' ? o : (o as { text?: string; label?: string })?.text || (o as { label?: string })?.label || ''))
    .filter(Boolean);
});

// ── Note body ────────────────────────────────────────────────────────────
const noteBody = computed<string>(() => {
  const raw = props.content?.body || props.content?.content || props.content?.text || '';
  return formatHtml(raw);
});

// ── Forwarded text ───────────────────────────────────────────────────────
const forwardedText = computed<string>(() => {
  const raw = props.content?.content || props.content?.text || props.content?.title || '';
  return formatHtml(raw);
});

// ── Generic rich extraction ──────────────────────────────────────────────
const richTitle = computed<string>(() => {
  const t = props.content?.title || props.content?.subject;
  return typeof t === 'string' ? t : '';
});
const richBody = computed<string>(() => {
  const raw = props.content?.text
    || props.content?.description
    || props.content?.body
    || props.content?.content
    || props.content?.caption
    || '';
  return formatHtml(typeof raw === 'string' ? raw : '');
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

// ── HTML formatter: escape + @mention + bullet + linebreaks ──────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatHtml(raw: string): string {
  if (!raw) return '';
  let s = escapeHtml(raw);
  // @mention: ký tự @ + tên (Vietnamese-aware): @Tên có dấu hoặc Eng
  s = s.replace(/@([\p{L}][\p{L}0-9._-]+(?:\s[\p{L}][\p{L}0-9._-]+)?)/gu, '<span class="mention">@$1</span>');
  // Linebreak → <br>
  s = s.replace(/\r?\n/g, '<br>');
  return s;
}
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
}

.note-body {
  font-size: 13px;
  color: var(--smax-text, #212121);
  word-break: break-word;
}

.poll-options {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
  font-size: 13px;
}
.poll-options li { padding: 2px 0; }

/* Mention highlight - styled across all rich/note/forwarded contents */
:deep(.mention) {
  color: var(--smax-primary, #2962ff);
  font-weight: 500;
  background: var(--smax-primary-soft, #e3f2fd);
  padding: 0 4px;
  border-radius: 3px;
}
</style>
