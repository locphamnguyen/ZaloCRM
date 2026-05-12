<template>
  <div class="special-message" :data-type="type">
    <!-- Bank Account card (Zalo zinstant.bankcard) — render UI riêng dùng VietQR API
         Backend parse VietQR EMVCo string từ Zalo HTML → trả {bankCode, accountNumber, color, ...} -->
    <div
      v-if="type === 'bank_transfer' && bankCardData"
      class="bank-card-v2"
      :style="`background: linear-gradient(135deg, ${bankCardData.color} 0%, ${bankCardData.color}dd 100%);`"
    >
      <div class="bank-card-left">
        <div class="bank-card-header">
          <img v-if="bankCardData.logoUrl" :src="bankCardData.logoUrl" alt="bank" class="bank-card-logo" />
          <span class="bank-card-bank-name">{{ bankCardData.bankName }}</span>
        </div>
        <div class="bank-card-account">{{ bankCardData.accountNumber }}</div>
        <div class="bank-card-tagline">Quét để chuyển khoản nhanh</div>
        <div class="bank-card-actions">
          <button class="bank-card-btn" @click.prevent="copyAccount(bankCardData.accountNumber)">
            <v-icon size="11">mdi-content-copy</v-icon> Sao chép STK
          </button>
        </div>
      </div>
      <img
        v-if="bankCardData.qrImageUrl"
        :src="bankCardData.qrImageUrl"
        alt="QR"
        class="bank-card-qr"
        loading="lazy"
      />
    </div>

    <!-- Loading state khi đang fetch data -->
    <div v-else-if="type === 'bank_transfer' && bankCardUrl && bankCardLoading" class="bank-card-loading">
      <v-progress-circular indeterminate size="20" width="2" />
      <span class="ml-2">Đang tải card ngân hàng...</span>
    </div>

    <!-- Fallback nếu không parse được — click để mở Zalo URL -->
    <a
      v-else-if="type === 'bank_transfer' && bankCardUrl"
      :href="bankCardUrl"
      target="_blank"
      rel="noopener"
      class="bank-card-fallback"
    >
      <v-icon size="20" color="success">mdi-bank-transfer</v-icon>
      <span>{{ bankCardLabel || 'Tài khoản ngân hàng' }}</span>
      <v-icon size="14" color="grey">mdi-open-in-new</v-icon>
    </a>

    <!-- Bank Transfer (legacy: có bankCode/amount inline) -->
    <v-card v-else-if="type === 'bank_transfer'" variant="tonal" color="success" class="pa-3" rounded="lg">
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

    <!-- QR Code: render ảnh QR thật từ content.description (Zalo lưu JSON string ở đó) -->
    <a
      v-else-if="type === 'qr_code'"
      :href="qrImageUrl || '#'"
      target="_blank"
      rel="noopener"
      class="qr-card"
    >
      <img v-if="qrImageUrl" :src="qrImageUrl" alt="QR Code" class="qr-image" />
      <div v-else class="qr-fallback">
        <v-icon icon="mdi-qrcode" size="48" color="primary" />
      </div>
      <div class="qr-label">
        <v-icon size="14" class="mr-1">mdi-qrcode</v-icon>
        {{ title || 'Mã QR' }}
      </div>
    </a>

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

    <!-- Location / Map share — pinned or live location -->
    <div v-else-if="type === 'location' && locationCoords" class="location-card">
      <!-- Google Maps embed: no API key, reliable, works VN. iframe pointer-events disabled
           để click bất kì đâu trong card → mở map full ở tab mới qua overlay <a>. -->
      <div class="location-map-wrap">
        <iframe
          :src="`https://maps.google.com/maps?q=${locationCoords.lat},${locationCoords.lng}&z=16&output=embed`"
          class="location-map"
          loading="lazy"
          referrerpolicy="no-referrer-when-downgrade"
          allowfullscreen
        ></iframe>
        <a
          :href="`https://www.google.com/maps?q=${locationCoords.lat},${locationCoords.lng}`"
          target="_blank"
          rel="noopener"
          class="location-map-overlay"
          :aria-label="locationTitle || 'Mở bản đồ'"
        ></a>
      </div>
      <div class="location-body">
        <div class="location-title">
          <v-icon size="16" class="mr-1" color="error">mdi-map-marker</v-icon>
          <strong>{{ locationTitle || 'Vị trí được chia sẻ' }}</strong>
          <span v-if="locationIsLive" class="location-live-chip">🟢 LIVE</span>
        </div>
        <div v-if="locationAddress" class="location-address">{{ locationAddress }}</div>
        <div class="location-coords">{{ locationCoords.lat.toFixed(5) }}, {{ locationCoords.lng.toFixed(5) }}</div>
      </div>
    </div>

    <!-- Link preview — card 2 cột với thumb + title/desc/domain -->
    <a
      v-else-if="type === 'link' && richHref"
      :href="richHref"
      target="_blank"
      rel="noopener"
      class="link-preview-card"
    >
      <img v-if="richThumb" :src="richThumb" :alt="title || 'preview'" class="link-thumb" />
      <div class="link-meta">
        <div v-if="title" class="link-title">{{ title }}</div>
        <div v-if="linkDescription" class="link-desc">{{ linkDescription }}</div>
        <div v-if="linkDomain" class="link-domain">
          <v-icon size="11">mdi-link-variant</v-icon> {{ linkDomain }}
        </div>
      </div>
    </a>

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
import { computed, ref, watch } from 'vue';

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

// ── Location / Map share ─────────────────────────────────────────────────
// Zalo content shape: { title, description, params: "{latitude,longitude,isUserLocation?}" }
const locationCoords = computed<{ lat: number; lng: number } | null>(() => {
  const p = paramsObj.value;
  if (!p) return null;
  const lat = Number(p.latitude ?? p.lat);
  const lng = Number(p.longitude ?? p.lng ?? p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
});
const locationTitle = computed<string>(() => String(props.content?.title || '').trim());
const locationAddress = computed<string>(() => String(props.content?.description || '').trim());
const locationIsLive = computed<boolean>(() => {
  const p = paramsObj.value;
  return Number(p?.isUserLocation || 0) === 1;
});

// ── QR Code ───────────────────────────────────────────────────────────────
// Zalo lưu qrCodeUrl trong content.description (JSON string), không phải plain text
const qrImageUrl = computed<string>(() => {
  const desc = props.content?.description;
  if (typeof desc !== 'string') return String(props.content?.qrCodeUrl || '');
  try {
    const parsed = JSON.parse(desc);
    return String(parsed?.qrCodeUrl || '');
  } catch { return ''; }
});

// ── Bank account card (Zalo zinstant.bankcard) ───────────────────────────
// params.pcItem.data_url là URL HTML render cho PC web (đã có ?data=html)
// params.item.data_url là cho mobile, ưu tiên pcItem nếu có.
const bankCardUrl = computed<string>(() => {
  const params = paramsObj.value;
  if (!params) return '';
  const pcUrl = (params.pcItem as Record<string, unknown> | undefined)?.data_url;
  if (typeof pcUrl === 'string' && pcUrl) return pcUrl;
  const itemUrl = (params.item as Record<string, unknown> | undefined)?.data_url;
  if (typeof itemUrl === 'string' && itemUrl) return itemUrl;
  return '';
});
// Backend parse VietQR EMVCo từ Zalo HTML → trả structured bank data
interface BankCardData {
  bankBin: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  color: string;
  logoUrl: string;
  qrImageUrl: string;
}
const bankCardData = ref<BankCardData | null>(null);
const bankCardLoading = ref(false);

async function fetchBankCardData(url: string) {
  bankCardLoading.value = true;
  bankCardData.value = null;
  try {
    const res = await fetch(`/api/v1/zalo-bankcard?url=${encodeURIComponent(url)}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data?.accountNumber && data?.bankCode) {
      bankCardData.value = data as BankCardData;
    }
  } catch (err) {
    console.error('[bank-card] fetch error:', err);
  } finally {
    bankCardLoading.value = false;
  }
}

watch(bankCardUrl, (url) => {
  if (url) void fetchBankCardData(url);
  else bankCardData.value = null;
}, { immediate: true });

function copyAccount(account: string) {
  navigator.clipboard?.writeText(account).catch(() => {
    /* clipboard API có thể fail trên non-HTTPS — bỏ qua */
  });
}
const bankCardLabel = computed<string>(() => {
  const params = paramsObj.value;
  const customMsg = params?.customMsg as Record<string, unknown> | undefined;
  const msg = customMsg?.msg as Record<string, unknown> | undefined;
  return String(msg?.vi || msg?.en || 'Tài khoản ngân hàng');
});

// ── Link preview ─────────────────────────────────────────────────────────
// Domain hiển thị nhỏ ở footer card
const linkDomain = computed<string>(() => {
  try {
    return new URL(richHref.value).hostname.replace(/^www\./, '');
  } catch { return ''; }
});
const linkDescription = computed<string>(() => {
  const d = props.content?.description;
  return typeof d === 'string' ? d.trim() : '';
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

/* Location / Map share card */
.location-card {
  display: block;
  border: 1px solid var(--smax-grey-200, #e0e0e0);
  border-radius: 12px;
  overflow: hidden;
  background: var(--smax-bg, #fff);
  max-width: 300px;
  transition: box-shadow 0.15s ease, transform 0.15s ease;
}
.location-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}
/* iframe map + click overlay để không bị "kẹt" tương tác trong iframe */
.location-map-wrap {
  position: relative;
  width: 100%;
  height: 160px;
  background: #e9eef3;
}
.location-map {
  display: block;
  width: 100%;
  height: 100%;
  border: 0;
}
.location-map-overlay {
  position: absolute;
  inset: 0;
  cursor: pointer;
}
.location-body {
  padding: 10px 12px;
}
.location-title {
  display: flex;
  align-items: center;
  font-size: 14px;
  line-height: 1.3;
  margin-bottom: 4px;
}
.location-live-chip {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 700;
  color: #2e7d32;
  background: rgba(46, 125, 50, 0.12);
  padding: 1px 6px;
  border-radius: 6px;
}
.location-address {
  font-size: 12px;
  color: var(--smax-grey-700, #5a6478);
  line-height: 1.4;
}
.location-coords {
  font-size: 10px;
  color: var(--smax-grey-500, #9e9e9e);
  font-family: monospace;
  margin-top: 4px;
}

/* Bank card v2 — render UI riêng với data từ backend (parse VietQR EMVCo) */
.bank-card-v2 {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 14px;
  max-width: 360px;
  color: white;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.12);
}
.bank-card-left {
  flex: 1;
  min-width: 0;
}
.bank-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}
.bank-card-logo {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: white;
  padding: 3px;
  object-fit: contain;
}
.bank-card-bank-name {
  font-size: 13px;
  font-weight: 600;
  opacity: 0.95;
}
.bank-card-account {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.5px;
  line-height: 1.1;
  word-break: break-all;
}
.bank-card-tagline {
  font-size: 11px;
  margin-top: 4px;
  opacity: 0.85;
}
.bank-card-actions {
  margin-top: 8px;
}
.bank-card-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: 0;
  border-radius: 6px;
  padding: 4px 8px;
  cursor: pointer;
  transition: background 0.15s ease;
}
.bank-card-btn:hover { background: rgba(255, 255, 255, 0.32); }
.bank-card-qr {
  width: 100px;
  height: 100px;
  border-radius: 8px;
  background: white;
  padding: 4px;
  flex-shrink: 0;
  object-fit: contain;
}
.bank-card-loading {
  display: flex;
  align-items: center;
  padding: 12px 14px;
  background: #f5f5f5;
  border-radius: 10px;
  font-size: 12px;
  color: var(--smax-grey-700);
}
.bank-card-fallback {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1px solid #c8e6c9;
  border-radius: 10px;
  background: rgba(76, 175, 80, 0.06);
  text-decoration: none;
  color: #2e7d32;
  font-size: 13px;
}
.bank-card-fallback:hover { background: rgba(76, 175, 80, 0.12); }

/* QR Code card */
.qr-card {
  display: block;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--smax-grey-200, #e0e0e0);
  border-radius: 12px;
  overflow: hidden;
  background: white;
  max-width: 220px;
  transition: box-shadow 0.15s ease;
}
.qr-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.qr-image {
  display: block;
  width: 100%;
  height: auto;
  background: #f5f5f5;
}
.qr-fallback {
  padding: 40px;
  text-align: center;
  background: #f5f5f5;
}
.qr-label {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--smax-grey-700);
  display: flex; align-items: center;
  background: rgba(0,0,0,0.02);
  border-top: 1px solid var(--smax-grey-200);
}

/* Link preview card */
.link-preview-card {
  display: flex;
  text-decoration: none;
  color: inherit;
  border: 1px solid var(--smax-grey-200, #e0e0e0);
  border-radius: 12px;
  overflow: hidden;
  background: white;
  max-width: 320px;
  transition: box-shadow 0.15s ease;
}
.link-preview-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
.link-thumb {
  width: 80px;
  height: 80px;
  flex-shrink: 0;
  object-fit: cover;
  background: #e9eef3;
}
.link-meta {
  padding: 8px 10px;
  display: flex; flex-direction: column;
  justify-content: center;
  min-width: 0;
  flex: 1;
}
.link-title {
  font-size: 13px;
  font-weight: 600;
  color: #212121;
  line-height: 1.3;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.link-desc {
  font-size: 11px;
  color: var(--smax-grey-700);
  line-height: 1.3;
  margin-top: 2px;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.link-domain {
  font-size: 10px;
  color: var(--smax-primary, #2962ff);
  margin-top: 4px;
  display: flex; align-items: center; gap: 2px;
}
</style>
