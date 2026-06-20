<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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

    <!-- Call (E14–E19) — 6 variant phân theo isCaller (1=sale, 0=KH) + calltype + missed.
         Anh chốt 2026-05-21: KH gọi đến nhỡ (E17) = ALERT đỏ + bold; sale gọi ko trả lời
         (E18) = muted xám. Nút "Gọi lại" emit event → parent (MessageThread) handle. -->
    <div
      v-else-if="type === 'call'"
      class="call-card"
      :class="{
        missed: isMissed,
        video: isVideo,
        'inbound-missed': isMissed && !isCaller,
        'outbound-noanswer': isMissed && isCaller,
      }"
    >
      <div class="call-icon">
        <v-icon :size="22">{{ callIconName }}</v-icon>
      </div>
      <div class="call-meta">
        <div class="call-title">{{ callLabel }}</div>
        <div v-if="!isMissed && callDuration > 0" class="call-duration">{{ formatDuration(callDuration) }}</div>
        <div v-else-if="isMissed && !isCaller" class="call-subtitle">KH đã gọi nhưng bạn chưa bắt máy</div>
        <div v-else-if="isMissed && isCaller" class="call-subtitle">KH chưa bắt máy</div>
      </div>
      <button
        v-if="isMissed"
        type="button"
        class="call-action"
        :class="{ 'call-action-danger': !isCaller }"
        @click="onCallback"
      >
        <v-icon size="14">{{ isVideo ? 'mdi-video' : 'mdi-phone' }}</v-icon>
        Gọi lại
      </button>
    </div>

    <!-- E21 Danh thiếp / E22 Gợi ý bạn bè (contact_card với action show.profile / recommened.user) -->
    <div
      v-else-if="type === 'contact_card_profile' || type === 'user_suggest'"
      class="profile-card"
      :class="{ 'is-suggest': type === 'user_suggest' }"
    >
      <div v-if="type === 'user_suggest'" class="profile-suggest-chip">
        <v-icon size="11">mdi-account-plus</v-icon> Gợi ý kết bạn
      </div>
      <div class="profile-body">
        <div class="profile-avatar">
          <img v-if="profileAvatar" :src="profileAvatar" alt="avatar" class="profile-avatar-img" />
          <v-icon v-else size="32" color="primary">mdi-account</v-icon>
        </div>
        <div class="profile-info">
          <div class="profile-name">{{ profileName || 'Người liên hệ' }}</div>
          <div v-if="profilePhone" class="profile-phone">
            <v-icon size="12">mdi-phone</v-icon> {{ profilePhone }}
          </div>
          <div v-else-if="profileSubtitle" class="profile-phone">{{ profileSubtitle }}</div>
        </div>
      </div>
      <div class="profile-actions">
        <button
          type="button"
          class="profile-btn primary"
          :title="type === 'user_suggest' ? 'Kết bạn (chưa hỗ trợ qua CRM)' : 'Mở chat với người này'"
          @click="onOpenProfile"
        >
          <v-icon size="13">{{ type === 'user_suggest' ? 'mdi-account-plus-outline' : 'mdi-message-outline' }}</v-icon>
          {{ type === 'user_suggest' ? 'Xem thông tin' : 'Mở chat' }}
        </button>
        <button
          v-if="profilePhone"
          type="button"
          class="profile-btn"
          title="Copy SĐT"
          @click="copyAccount(profilePhone)"
        >
          <v-icon size="13">mdi-content-copy</v-icon>
          Copy SĐT
        </button>
      </div>
    </div>

    <!-- E27 QR Code — anh chốt 2026-05-21: ảnh QR + 2 action button -->
    <div v-else-if="type === 'qr_code'" class="qr-card-v2">
      <div class="qr-card-header">
        <v-icon size="14">mdi-qrcode</v-icon>
        <span>{{ title || 'Mã QR' }}</span>
      </div>
      <a v-if="qrImageUrl" :href="qrImageUrl" target="_blank" rel="noopener" class="qr-image-wrap">
        <img :src="qrImageUrl" alt="QR Code" class="qr-image" />
      </a>
      <div v-else class="qr-fallback">
        <v-icon icon="mdi-qrcode" size="56" color="primary" />
      </div>
      <div class="qr-actions">
        <a v-if="qrImageUrl" :href="qrImageUrl" :download="`qr-${Date.now()}.png`" class="qr-btn">
          <v-icon size="12">mdi-download</v-icon> Tải QR
        </a>
        <button v-if="qrImageUrl" type="button" class="qr-btn" @click="copyAccount(qrImageUrl)">
          <v-icon size="12">mdi-link-variant</v-icon> Copy link
        </button>
      </div>
    </div>

    <!-- E28 Reminder / Nhắc hẹn — anh chốt 2026-05-21: chip vàng + title + body -->
    <div v-else-if="type === 'reminder'" class="reminder-card-v2">
      <div class="reminder-header">
        <v-icon size="14" color="warning">mdi-bell-ring-outline</v-icon>
        <span>Nhắc hẹn / Thông báo</span>
      </div>
      <div v-if="title" class="reminder-title">{{ title }}</div>
      <div v-if="reminderBody && reminderBody !== title" class="reminder-body">{{ reminderBody }}</div>
    </div>

    <!-- E29-E32 Poll / Bình chọn — phân biệt 4 action create/vote/update/close -->
    <div v-else-if="type === 'poll'" class="poll-card-v2">
      <div class="poll-header">
        <v-icon size="14" color="info">mdi-poll</v-icon>
        <strong>{{ pollHeaderText }}</strong>
        <span v-if="pollClosed" class="poll-status-badge closed">ĐÃ ĐÓNG</span>
        <span v-else-if="pollUpdated" class="poll-status-badge updated">CẬP NHẬT</span>
      </div>
      <div v-if="title" class="poll-title">"{{ title }}"</div>
      <ul v-if="pollOptions.length" class="poll-options-v2">
        <li
          v-for="(o, i) in pollOptions"
          :key="i"
          class="poll-option"
          :class="{ 'is-selected': pollVotedIndex === i }"
        >
          <v-icon size="13">{{ pollVotedIndex === i ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank' }}</v-icon>
          <span class="poll-option-text">{{ o }}</span>
        </li>
      </ul>
      <div v-if="pollOptions.length" class="poll-footer">
        {{ pollOptions.length }} lựa chọn{{ pollClosed ? ' · đã đóng' : '' }}
      </div>
    </div>

    <!-- E33 Note / Ghi chú — header chip cam + title bold + body styled -->
    <div v-else-if="type === 'note'" class="note-card-v2">
      <div class="note-header">
        <v-icon size="14" color="warning">mdi-note-text-outline</v-icon>
        <span>Ghi chú</span>
      </div>
      <div v-if="title" class="note-title">{{ title }}</div>
      <div v-if="noteBody" class="note-body-v2" v-html="noteBody" />
    </div>

    <!-- E34 Forwarded / Chuyển tiếp — left-border tím + nội dung gốc -->
    <div v-else-if="type === 'forwarded'" class="forwarded-card">
      <div class="forwarded-header">
        <v-icon size="13" class="mr-1">mdi-share</v-icon>
        Đã chuyển tiếp
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

// Emit "callback" cho cuộc gọi nhỡ (E17/E18) / "open-profile" cho danh thiếp E21/E22.
const emit = defineEmits<{
  (e: 'callback'): void;
  (e: 'open-profile', uid: string): void;
}>();
function onCallback() { emit('callback'); }
function onOpenProfile() {
  const uid = profileUid.value;
  if (uid) emit('open-profile', uid);
}

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

// ── Generic title (reminder/poll/note) ───────────────────────────────────
const title = computed<string>(() => props.content?.title || props.content?.name || '');

// ── E21/E22 Profile card (action='show.profile' hoặc 'recommened.user') ──
// Zalo lưu danh thiếp dưới contact_card với params chứa userInfo. Best-effort extract.
const profileUid = computed<string>(() => {
  const p = paramsObj.value;
  return String(
    p?.uid || p?.userId || props.content?.uid || props.content?.userId || '',
  );
});
const profileName = computed<string>(() => {
  const p = paramsObj.value;
  return String(
    p?.zaloName || p?.displayName || p?.userName || p?.name || title.value || '',
  ).trim();
});
const profileAvatar = computed<string>(() => {
  const p = paramsObj.value;
  const a = p?.avatar || p?.avatarUrl || props.content?.thumb;
  return typeof a === 'string' && a.startsWith('http') ? a : '';
});
const profilePhone = computed<string>(() => {
  const p = paramsObj.value;
  return String(p?.phone || p?.phoneNumber || '').trim();
});
const profileSubtitle = computed<string>(() => {
  const desc = props.content?.description;
  return typeof desc === 'string' ? desc.trim() : '';
});

// ── E28 Reminder body — Zalo lưu phần mô tả ở description hoặc params.description ──
const reminderBody = computed<string>(() => {
  const d = props.content?.description || paramsObj.value?.description || '';
  return typeof d === 'string' ? d.trim() : '';
});

// ── Poll options + 4-action state (E29-E32) ─────────────────────────────
const pollOptions = computed<string[]>(() => {
  const opts = props.content?.options || props.content?.choices || paramsObj.value?.options;
  if (!Array.isArray(opts)) return [];
  return (opts as unknown[])
    .map((o) => (typeof o === 'string' ? o : (o as { text?: string; label?: string; content?: string })?.text || (o as { label?: string })?.label || (o as { content?: string })?.content || ''))
    .filter(Boolean);
});
const pollAction = computed<string>(() => {
  return String(props.content?.action || '').toLowerCase();
});
const pollClosed = computed<boolean>(() => pollAction.value === 'close');
const pollUpdated = computed<boolean>(() => pollAction.value === 'update');
const pollHeaderText = computed<string>(() => {
  if (pollAction.value === 'create') return 'Đã tạo bình chọn';
  if (pollAction.value === 'vote') return 'Đã bình chọn';
  if (pollAction.value === 'update') return 'Cập nhật bình chọn';
  if (pollAction.value === 'close') return 'Bình chọn đã đóng';
  return 'Bình chọn';
});
// Index option mà user vừa vote (action=vote). Zalo gửi qua params.selectedOptionIds hoặc votedIdx.
const pollVotedIndex = computed<number>(() => {
  if (pollAction.value !== 'vote') return -1;
  const p = paramsObj.value;
  const arr = p?.selectedOptionIds || p?.selectedOptions || p?.optionIds;
  if (Array.isArray(arr) && arr.length > 0) return Number(arr[0]);
  const idx = p?.votedIdx ?? p?.selectedIdx;
  return typeof idx === 'number' ? idx : -1;
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

// 2026-05-21: Zalo TextStyle enum mapping. Full reference:
//   b / i / u / s = bold/italic/underline/strikethrough
//   c_RRGGBB      = color (vd c_db342e = red, c_f27806 = orange)
//   f_NN          = font size (Zalo: f_13 small, f_18 big — default ~14)
//   s_NN          = font size (BACK-COMPAT — code cũ dùng s_ trước khi biết Zalo enum)
//   lst_1 / lst_2 = bullet / numbered list
function openTagFor(st: string): string {
  if (st === 'b') return '<strong>';
  if (st === 'i') return '<em>';
  if (st === 'u') return '<u>';
  if (st === 's') return '<s>';
  if (st.startsWith('c_')) return `<span style="color:#${st.slice(2)}">`;
  if (st.startsWith('f_')) return `<span style="font-size:${st.slice(2)}px">`;
  if (st.startsWith('s_')) return `<span style="font-size:${st.slice(2)}px">`;
  return '';
}
function closeTagFor(st: string): string {
  if (st === 'b') return '</strong>';
  if (st === 'i') return '</em>';
  if (st === 'u') return '</u>';
  if (st === 's') return '</s>';
  if (st.startsWith('c_') || st.startsWith('f_') || st.startsWith('s_')) return '</span>';
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

/** Fallback: format raw text without style marks — just escape + mention regex + linebreak.
 * Fix 2026-06-03 (Anh báo): sync với message-bubble.vue highlightText().
 * Tên có separator " - " (vd "Trung Trường - Hs Holding") phải bôi đầy đủ.
 * Pattern: @ + 1-3 chữ hoa + (optional " - " + 1-3 chữ hoa).
 * Ràng buộc chữ hoa để loại từ thường VN (vd "@Đại Khánh thể" → chỉ bôi "@Đại Khánh"). */
function plainFormat(text: string): string {
  if (!text) return '';
  let s = escapeHtml(text);
  s = s.replace(
    /@(\p{Lu}[\p{L}0-9._]*(?:\s\p{Lu}[\p{L}0-9._]*){0,2}(?:\s[-–—]\s\p{Lu}[\p{L}0-9._]*(?:\s\p{Lu}[\p{L}0-9._]*){0,2})?)/gu,
    '<span class="mention">@$1</span>',
  );
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

/* ════════ E21/E22 Profile / Suggest user card ════════ */
.profile-card {
  display: block;
  padding: 12px;
  border-radius: 10px;
  background: var(--smax-grey-50, #fafbfc);
  border: 1px solid var(--smax-grey-200, #e5e7eb);
  max-width: 320px;
  position: relative;
}
.profile-card.is-suggest { border-color: rgba(33, 150, 243, 0.35); background: rgba(33, 150, 243, 0.04); }
.profile-suggest-chip {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  color: #1976d2; background: rgba(33, 150, 243, 0.12);
  padding: 2px 7px; border-radius: 4px;
  margin-bottom: 8px;
}
.profile-body { display: flex; align-items: center; gap: 12px; }
.profile-avatar {
  width: 48px; height: 48px; border-radius: 50%;
  background: var(--smax-grey-100, #f1f3f5);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden; flex-shrink: 0;
}
.profile-avatar-img { width: 100%; height: 100%; object-fit: cover; }
.profile-info { flex: 1; min-width: 0; }
.profile-name {
  font-weight: 600; font-size: 14px; color: var(--smax-text);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.profile-phone {
  font-size: 12px; color: var(--smax-grey-700);
  display: flex; align-items: center; gap: 3px;
  margin-top: 2px;
}
.profile-actions {
  display: flex; gap: 6px; margin-top: 10px;
}
.profile-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px; border-radius: 6px;
  border: 1px solid var(--smax-grey-300, #d1d5db);
  background: white; color: var(--smax-text);
  font-size: 12px; font-weight: 500; cursor: pointer;
  transition: background 0.15s ease;
}
.profile-btn:hover { background: var(--smax-grey-100, #f3f4f6); }
.profile-btn.primary {
  border-color: var(--smax-primary, #2962ff);
  background: var(--smax-primary, #2962ff);
  color: white;
}
.profile-btn.primary:hover { filter: brightness(0.95); }

/* ════════ E27 QR Code v2 ════════ */
.qr-card-v2 {
  display: block;
  padding: 10px;
  border-radius: 10px;
  background: white;
  border: 1px solid var(--smax-grey-200, #e5e7eb);
  max-width: 220px;
}
.qr-card-header {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; font-weight: 600; color: var(--smax-grey-700);
  margin-bottom: 8px;
}
.qr-image-wrap { display: block; }
.qr-actions {
  display: flex; gap: 6px; margin-top: 8px;
}
.qr-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 4px 8px; border-radius: 5px;
  border: 1px solid var(--smax-grey-300);
  background: var(--smax-grey-50);
  font-size: 11px; color: var(--smax-text);
  cursor: pointer; text-decoration: none;
  transition: background 0.15s ease;
}
.qr-btn:hover { background: var(--smax-grey-100); }

/* ════════ E28 Reminder v2 ════════ */
.reminder-card-v2 {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 152, 0, 0.06);
  border-left: 3px solid #ff9800;
  max-width: 400px;
}
.reminder-header {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 700;
  color: #f57c00; text-transform: uppercase;
  margin-bottom: 6px;
}
.reminder-title {
  font-weight: 600; font-size: 13.5px; color: var(--smax-text);
  margin-bottom: 4px;
  word-break: break-word;
}
.reminder-body {
  font-size: 12.5px; color: var(--smax-grey-700);
  line-height: 1.4; word-break: break-word; white-space: pre-wrap;
}

/* ════════ E29-E32 Poll v2 ════════ */
.poll-card-v2 {
  padding: 12px;
  border-radius: 10px;
  background: rgba(33, 150, 243, 0.05);
  border: 1px solid rgba(33, 150, 243, 0.25);
  max-width: 340px;
}
.poll-header {
  display: flex; align-items: center; gap: 4px;
  font-size: 12px; color: var(--smax-grey-700);
  margin-bottom: 6px;
}
.poll-header strong { font-weight: 600; color: var(--smax-text); flex: 1; }
.poll-status-badge {
  font-size: 9px; font-weight: 700; text-transform: uppercase;
  padding: 2px 6px; border-radius: 4px;
}
.poll-status-badge.closed { color: #6b7280; background: rgba(107, 114, 128, 0.15); }
.poll-status-badge.updated { color: #1976d2; background: rgba(33, 150, 243, 0.15); }
.poll-title {
  font-size: 13px; font-weight: 500; color: var(--smax-text);
  margin-bottom: 8px; font-style: italic;
}
.poll-options-v2 {
  list-style: none; padding: 0; margin: 0 0 6px;
}
.poll-option {
  display: flex; align-items: center; gap: 6px;
  padding: 4px 0; font-size: 12.5px;
  color: var(--smax-text);
}
.poll-option.is-selected {
  color: var(--smax-primary, #2962ff); font-weight: 600;
}
.poll-option-text { flex: 1; }
.poll-footer {
  font-size: 11px; color: var(--smax-grey-500);
  margin-top: 4px;
}

/* ════════ E33 Note v2 ════════ */
.note-card-v2 {
  padding: 10px 12px;
  border-radius: 8px;
  background: rgba(255, 152, 0, 0.05);
  border-left: 3px solid #ff9800;
  max-width: 400px;
}
.note-header {
  display: flex; align-items: center; gap: 4px;
  font-size: 11px; font-weight: 700;
  color: #f57c00; text-transform: uppercase;
  margin-bottom: 6px;
}
.note-title {
  font-weight: 700; font-size: 13.5px; color: var(--smax-text);
  margin-bottom: 4px;
  word-break: break-word;
}
.note-body-v2 {
  font-size: 13px; color: var(--smax-text);
  line-height: 1.45; word-break: break-word; white-space: pre-wrap;
}

/* ════════ Call card — E14–E19 ════════
   inbound-missed (E17) = KH gọi đến NHỠ, sale chưa bắt → đỏ nổi bật, font-weight cao
   outbound-noanswer (E18) = sale gọi đi KH ko trả lời → xám nhạt, không alert */
.call-card {
  display: inline-flex; align-items: center; gap: 11px;
  padding: 9px 13px;
  border-radius: 9px;
  background: rgba(33, 150, 243, 0.08);
  border: 1px solid rgba(33, 150, 243, 0.25);
  min-width: 220px;
}
/* E17: KH gọi đến NHỠ — đỏ rõ, border đậm, sale phải thấy */
.call-card.inbound-missed {
  background: rgba(220, 38, 38, 0.08);
  border-color: #dc2626;
  border-width: 1.5px;
}
.call-card.inbound-missed .call-title {
  color: #dc2626;
  font-weight: 700;
}
.call-card.inbound-missed .call-icon { background: #dc2626; }

/* E18: sale gọi đi KH ko trả lời — xám muted, sale đã biết */
.call-card.outbound-noanswer {
  background: rgba(107, 114, 128, 0.06);
  border-color: rgba(107, 114, 128, 0.30);
}
.call-card.outbound-noanswer .call-title { color: #6b7280; }
.call-card.outbound-noanswer .call-icon { background: #9ca3af; }

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
.call-card.video:not(.missed) .call-icon { background: #9c27b0; }

.call-meta { display: flex; flex-direction: column; gap: 2px; flex: 1; }
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

/* Nút "Gọi lại" — chỉ show ở missed/no-answer */
.call-action {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--smax-primary, #2962ff);
  background: white;
  color: var(--smax-primary, #2962ff);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s ease, transform 0.15s ease;
}
.call-action:hover { background: var(--smax-primary-soft, #e3f2fd); }
.call-action:active { transform: scale(0.97); }
.call-action-danger {
  border-color: #dc2626;
  color: #dc2626;
}
.call-action-danger:hover { background: rgba(220, 38, 38, 0.08); }

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
