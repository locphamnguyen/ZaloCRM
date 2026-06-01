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
type BadgeKind = 'user_crm' | 'user_native' | 'bot_automation' | 'bot_ai' | 'bot_system' | null;

const badgeKind = computed<BadgeKind>(() => {
  const meta = props.message.metadata?.sender;
  if (meta?.kind) return meta.kind;

  const via = props.message.sentVia;
  if (via === 'user') return 'user_crm';
  if (via === 'user_native') return 'user_native';
  if (via === 'automation') return 'bot_automation';
  if (via === 'ai_assistant') return 'bot_ai';
  if (via === 'system') return 'bot_system';
  return null; // tin sale CRM mặc định KHÔNG badge nếu repliedByUserId === currentUser
});

// Group consecutive logic: ẩn badge nếu prev cùng kind + same sender + gap < 60s
const showBadge = computed(() => {
  if (!badgeKind.value) return false;

  // Bot variants ALWAYS render (audit critical)
  if (badgeKind.value.startsWith('bot_')) return true;

  // User variants — group consecutive
  if (!props.prevMessage) return true;

  const prev = props.prevMessage;
  const prevKind: BadgeKind = (prev.metadata?.sender?.kind as BadgeKind) ??
    (prev.sentVia === 'user' ? 'user_crm' : prev.sentVia === 'user_native' ? 'user_native' : null);

  if (prevKind !== badgeKind.value) return true;

  // Same kind — check name match + gap
  const currName = props.message.metadata?.sender?.name ?? props.message.senderName ?? '';
  const prevName = prev.metadata?.sender?.name ?? prev.senderName ?? '';
  if (currName !== prevName) return true;

  // Gap < 60s → ẩn
  const currTs = new Date(props.message.sentAt).getTime();
  const prevTs = new Date(prev.sentAt).getTime();
  if (currTs - prevTs > 60_000) return true; // > 60s → show lại

  return false;
});

// Render labels (Section 25.2 format)
const labelData = computed(() => {
  if (!badgeKind.value) return null;
  const meta = props.message.metadata?.sender;
  const name = meta?.name ?? props.message.senderName ?? '';

  switch (badgeKind.value) {
    case 'user_crm':
      return {
        icon: '👤',
        label: `Sale CRM · ${name || 'Sale'}`,
        tooltip: 'Tin sale gõ trên CRM',
        clickable: true,
      };
    case 'user_native':
      return {
        icon: '📱',
        label: `Gửi từ Zalo · ${name || 'nick'}`,
        tooltip: 'Tin gõ trên app Zalo, sync về CRM',
        clickable: true,
      };
    case 'bot_automation': {
      const detail = meta?.detail ?? '';
      const seqName = name && detail ? `${name} · ${detail}` : (name || detail || 'Sequence');
      return {
        icon: '⚙️',
        label: `Tự động · ${seqName}`,
        tooltip: 'Tin gửi tự động bởi Sequence — click xem chi tiết',
        clickable: true,
      };
    }
    case 'bot_ai':
      return {
        icon: '✨',
        label: `Trợ lý AI · ${meta?.detail ?? 'phản hồi tự động'}`,
        tooltip: 'AI Trợ lý reply tự động — click audit',
        clickable: true,
      };
    case 'bot_system':
      return {
        icon: '🔔',
        label: `Hệ thống · ${meta?.detail ?? 'CRM thông báo'}`,
        tooltip: 'Tin tự động do CRM gửi',
        clickable: false,
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
      // emit user id (M3.5 sẽ wire repliedByUserId)
      // For now: noop
      break;
    case 'user_native':
      emit('explain-native');
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
  </div>
</template>

<style scoped>
.source-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 10px;
  font-weight: 600;
  border-radius: 6px;
  padding: 1px 6px;
  margin-bottom: 4px;
  border: 1px solid transparent;
  line-height: 1.4;
  user-select: none;
  white-space: nowrap;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-badge-icon {
  font-size: 11px;
  line-height: 1;
}

.source-badge-label {
  font-weight: 600;
}

/* 1. User CRM — cam M55 (giữ palette legacy) */
.source-badge--user_crm {
  color: #7c2d12;
  background: rgba(254, 215, 170, 0.6);
  border-color: rgba(251, 146, 60, 0.4);
}

/* 2. User Native — sky (Zalo app brand-adjacent) */
.source-badge--user_native {
  color: #075985;
  background: rgba(186, 230, 253, 0.6);
  border-color: rgba(56, 189, 248, 0.4);
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
</style>
