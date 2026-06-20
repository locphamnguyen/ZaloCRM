<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
═══════════════════════════════════════════════════════════════════════
 Luồng Mục Tiêu M11 — Source Identity Badge 5 variant (2026-06-01)
═══════════════════════════════════════════════════════════════════════

 Pattern clone từ M55 `.other-sale-tag` (`message-bubble.vue:38-45 + CSS 780-792`).
 Mở rộng thành 5 variant CSS modifier theo Section 25.2 design doc.

 Vị trí: TRÊN content bubble, inline-block padding 1px 6px, radius 6px,
 font 10px weight 600, margin-bottom 4px.

 5 variant (Section 25.2):
   user_crm        → 👤 Sale CRM · {fullName}      | cam (#7c2d12 / #fed7aa)
   user_native     → 📱 Gửi từ Zalo · {nickName}   | sky (#075985 / #bae6fd)
   bot_automation  → ⚙️ Tự động · {seqName} N/M    | violet (#5b21b6 / #ddd6fe)
   bot_ai          → ✨ Trợ lý AI · {trigger}      | blue (#1e3a8a / #eff6ff)
   bot_system      → 🔔 Hệ thống · {notice}        | gray (#374151 / #e5e7eb)

 Group consecutive (Section 25.3):
   - user_crm + user_native: GROUP (ẩn nếu prev cùng sender < 60s)
   - bot_*: KHÔNG group (cần audit/alert từng tin)
   - Inbound xen giữa 2 outbound → re-show

 Click action:
   - user_crm → open profile sale (emit 'open-user', userId)
   - user_native → open dialog explain (emit 'explain-native')
   - bot_automation → open sequence detail (emit 'open-sequence', sequenceId)
   - bot_ai → open AI audit dialog (emit 'audit-ai')
   - bot_system → cursor:help (no action)
-->

<script setup lang="ts">
import { computed } from 'vue';
import type { Message } from '@/composables/use-chat';

const props = defineProps<{
  message: Message;
  /** Message liền trước trong list (cho group consecutive logic). */
  prevMessage?: Message | null;
}>();

const emit = defineEmits<{
  'open-user': [userId: string];
  'explain-native': [];
  'open-sequence': [sequenceId: string];
  'audit-ai': [];
}>();

// Derive kind từ sentVia + metadata.sender
// ✨ Anh chốt 2026-06-02: hợp nhất user_native vào user_crm (icon 🔄 trailing).
// Variants còn lại: user_crm (CRM hoặc Native sync) | bot_automation | bot_ai | bot_system.
type BadgeKind = 'user_crm' | 'bridge' | 'bot_automation' | 'bot_ai' | 'bot_system' | null;

const badgeKind = computed<BadgeKind>(() => {
  // ── Fix 2026-06-03 (Anh báo bug ảnh 2 chat nhóm + Minh Pháp) ──
  // Badge "Sale CRM" / "Tự động" / "Trợ lý AI" / "Hệ thống" CHỈ áp dụng cho
  // tin OUTBOUND (senderType='self'). Tin INBOUND từ KH (senderType='contact')
  // hoặc system (senderType='ai_assistant' với meta.kind=bot_ai là exception)
  // KHÔNG được render badge này — đã có pill "tên người gửi" riêng ở
  // message-bubble.vue cho tin inbound.
  //
  // Trước fix: tin INBOUND có sent_via='user' (default schema) → badgeKind
  // trả 'user_crm' → render chip 'Sale CRM · {tên nick}' bên cạnh pill tím
  // gây nhầm lẫn (anh thấy 2 chip trong 1 dòng).
  if (props.message.senderType !== 'self') {
    return null;
  }

  const meta = props.message.metadata?.sender;
  if (meta?.kind) {
    // Legacy 'user_native' → map về 'user_crm' (giữ syncedFromNative flag)
    if (meta.kind === 'user_native') return 'user_crm';
    return meta.kind as BadgeKind;
  }

  const via = props.message.sentVia;
  // 'user' + 'user_native' đều map về 'user_crm', distinguish qua syncedFromNative
  if (via === 'user' || via === 'user_native') return 'user_crm';
  if (via === 'automation') return 'bot_automation';
  if (via === 'ai_assistant') return 'bot_ai';
  if (via === 'system') return 'bot_system';

  // Tin self mà không có sentVia/metadata.sender → vẫn show user_crm
  // (Anh chốt 2026-06-02: LUÔN show badge cho mọi tin outbound)
  return 'user_crm';
});

// Determine syncedFromNative flag (cho icon 🔄 trailing)
const syncedFromNative = computed<boolean>(() => {
  const meta = props.message.metadata?.sender;
  if (meta?.syncedFromNative === true) return true;
  if (meta?.kind === 'user_native') return true;
  if (props.message.sentVia === 'user_native') return true;
  // Heuristic: tin self không có repliedByUserId → coi như Native sync
  // (sale gõ app Zalo → echo về không có FK user CRM)
  if (
    props.message.senderType === 'self' &&
    !props.message.repliedByUserId &&
    props.message.sentVia !== 'automation' &&
    props.message.sentVia !== 'ai_assistant' &&
    props.message.sentVia !== 'system'
  ) {
    return true;
  }
  return false;
});

// Group consecutive logic: ẩn badge nếu prev cùng kind + same sender + same sync flag + gap < 60s
// ✨ NEW: nếu sync flag khác → re-show badge (Native vs CRM = sender khác)
const showBadge = computed(() => {
  if (!badgeKind.value) return false;

  // Bot variants ALWAYS render (audit critical)
  if (badgeKind.value.startsWith('bot_')) return true;

  // User variants — group consecutive
  if (!props.prevMessage) return true;

  const prev = props.prevMessage;
  // Map prev kind theo logic mới (user/user_native → user_crm)
  let prevKind: BadgeKind = null;
  const prevMeta = prev.metadata?.sender;
  if (prevMeta?.kind) {
    prevKind = (prevMeta.kind === 'user_native' ? 'user_crm' : prevMeta.kind) as BadgeKind;
  } else if (prev.sentVia === 'user' || prev.sentVia === 'user_native') {
    prevKind = 'user_crm';
  } else if (prev.sentVia === 'automation') {
    prevKind = 'bot_automation';
  } else if (prev.sentVia === 'ai_assistant') {
    prevKind = 'bot_ai';
  } else if (prev.sentVia === 'system') {
    prevKind = 'bot_system';
  } else if (prev.senderType === 'self') {
    prevKind = 'user_crm';
  }

  if (prevKind !== badgeKind.value) return true;

  // Check sync flag prev
  const prevSynced =
    prevMeta?.syncedFromNative === true ||
    prevMeta?.kind === 'user_native' ||
    prev.sentVia === 'user_native' ||
    (prev.senderType === 'self' &&
      !prev.repliedByUserId &&
      prev.sentVia !== 'automation' &&
      prev.sentVia !== 'ai_assistant' &&
      prev.sentVia !== 'system');

  // Sync flag khác → coi như sender khác, re-show badge
  if (prevSynced !== syncedFromNative.value) return true;

  // Same kind + same sync — check name match + gap
  const currName = props.message.metadata?.sender?.name ?? props.message.senderName ?? '';
  const prevName = prev.metadata?.sender?.name ?? prev.senderName ?? '';
  if (currName !== prevName) return true;

  // Gap < 60s → ẩn
  const currTs = new Date(props.message.sentAt).getTime();
  const prevTs = new Date(prev.sentAt).getTime();
  if (currTs - prevTs > 60_000) return true; // > 60s → show lại

  return false;
});

// Render labels (Section 25.2 format — updated 2026-06-02)
const labelData = computed(() => {
  if (!badgeKind.value) return null;
  const meta = props.message.metadata?.sender;
  // Ưu tiên: metadata.sender.name (M11 explicit) → repliedBy.fullName (user CRM)
  // → senderName (Zalo dName fallback).
  //
  // Fix 2026-06-03: tin CŨ trước commit M11 7f968e9 có metadata=NULL, senderName
  // mang giá trị displayName của NICK (vd "Thành Phạm HS Trợ Lý") thay vì tên
  // sale thật. → Phải ưu tiên repliedBy.fullName (relation tới User CRM) TRƯỚC
  // senderName để tin cũ vẫn hiện đúng tên sale. Tin mới đã có metadata.name.
  // Áp DỤNG CHỈ cho variant user_crm (sale gõ); bot_* dùng meta.name làm tên
  // sequence/AI/system nên không hoán vị.
  const name = badgeKind.value === 'user_crm'
    ? (meta?.name ?? props.message.repliedBy?.fullName ?? props.message.senderName ?? 'Sale')
    : (meta?.name ?? props.message.senderName ?? 'Sale');

  switch (badgeKind.value) {
    case 'user_crm':
      return {
        icon: '👤',
        label: `Sale CRM · ${name}`,
        tooltip: syncedFromNative.value
          ? 'Tin sale gõ trên app Zalo, sync về CRM'
          : 'Tin sale gõ trên CRM',
        clickable: true,
        showSyncIcon: syncedFromNative.value,
      };
    case 'bot_automation': {
      const detail = meta?.detail ?? '';
      const seqName = name && detail ? `${name} · ${detail}` : (name || detail || 'Sequence');
      return {
        icon: '⚙️',
        label: `Tự động · ${seqName}`,
        tooltip: 'Tin gửi tự động bởi Sequence — click xem chi tiết',
        clickable: true,
        showSyncIcon: false,
      };
    }
    case 'bot_ai':
      return {
        icon: '✨',
        label: `Trợ lý AI · ${meta?.detail ?? 'phản hồi tự động'}`,
        tooltip: 'AI Trợ lý reply tự động — click audit',
        clickable: true,
        showSyncIcon: false,
      };
    case 'bot_system':
      return {
        icon: '🔔',
        label: `Hệ thống · ${meta?.detail ?? 'CRM thông báo'}`,
        tooltip: 'Tin tự động do CRM gửi',
        clickable: false,
        showSyncIcon: false,
      };
    case 'bridge':
      return {
        icon: '📱',
        label: `Telegram · ${name}`,
        tooltip: 'Tin sale gửi từ Telegram (qua cầu Zalo↔Telegram)',
        clickable: false,
        showSyncIcon: false,
      };
    default:
      return null;
  }
});

function handleClick(): void {
  if (!labelData.value?.clickable) return;
  const meta = props.message.metadata?.sender;
  switch (badgeKind.value) {
    case 'user_crm':
      // Nếu là Sale Native sync → emit explain dialog
      if (syncedFromNative.value) {
        emit('explain-native');
        return;
      }
      // Sale gõ trên CRM → emit open-user nếu có repliedByUserId
      if (props.message.repliedByUserId) {
        emit('open-user', props.message.repliedByUserId);
      }
      break;
    case 'bot_automation':
      if (meta?.sequenceId) emit('open-sequence', meta.sequenceId);
      break;
    case 'bot_ai':
      emit('audit-ai');
      break;
  }
}
</script>

<template>
  <div
    v-if="showBadge && labelData"
    class="source-badge"
    :class="`source-badge--${badgeKind}`"
    :title="labelData.tooltip"
    :style="{ cursor: labelData.clickable ? 'pointer' : 'help' }"
    @click="handleClick"
  >
    <span class="source-badge-icon">{{ labelData.icon }}</span>
    <span class="source-badge-label">{{ labelData.label }}</span>
    <!-- Icon sync trailing cho Sale gõ trên Zalo Real (Anh chốt 2026-06-02) -->
    <span
      v-if="labelData.showSyncIcon"
      class="source-badge-sync"
      title="Tin sync từ app Zalo Real"
    >🔄</span>
  </div>
</template>

<style scoped>
.source-badge {
  display: inline-flex;
  align-items: flex-start;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 6px;
  padding: 1px 6px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  line-height: 1.4;
  user-select: none;
  /* 2026-06-15 (anh báo): badge tên luồng bị CẮT NGẮN "...". Bỏ nowrap+ellipsis →
     cho XUỐNG DÒNG hiện ĐỦ tên luồng. max-width theo bong bóng (100%), không cắt. */
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.source-badge-icon {
  font-size: 11px;
  line-height: 1.4;
  flex-shrink: 0;
}

.source-badge-label {
  font-weight: 600;
  min-width: 0;
}

/* Icon sync trailing — Sale gõ trên Zalo Real (Anh chốt 2026-06-02) */
.source-badge-sync {
  font-size: 10px;
  line-height: 1;
  margin-left: 2px;
  opacity: 0.75;
}

/* 1. User CRM — cam M55 (giữ palette legacy)
   ✨ Anh chốt 2026-06-02: bao gồm cả tin sync từ Zalo Real (icon 🔄 trailing).
   Phân biệt với CSS: tin sync có .source-badge-sync child. */
.source-badge--user_crm {
  color: #7c2d12;
  background: rgba(254, 215, 170, 0.6);
  border-color: rgba(251, 146, 60, 0.4);
}

/* 3. Bot Automation — violet (sequence/marketing) */
.source-badge--bot_automation {
  color: #5b21b6;
  background: rgba(221, 214, 254, 0.6);
  border-color: rgba(167, 139, 250, 0.4);
}

/* 4. Bot AI — blue-50 (khớp AiAssistantMessage palette) */
.source-badge--bot_ai {
  color: #1e3a8a;
  background: #eff6ff;
  border-color: rgba(59, 130, 246, 0.45);
}

/* 5. Bot System — gray (system/infrastructure trung tính) */
.source-badge--bot_system {
  color: #374151;
  background: rgba(229, 231, 235, 0.85);
  border-color: rgba(156, 163, 175, 0.5);
}

/* 6. Telegram bridge — xanh Telegram (tin sale gửi từ Telegram qua cầu) */
.source-badge--bridge {
  color: #0369a1;
  background: rgba(224, 242, 254, 0.8);
  border-color: rgba(56, 189, 248, 0.45);
}
</style>
