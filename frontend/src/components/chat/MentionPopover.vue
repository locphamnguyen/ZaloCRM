<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="mention-popover">
    <div class="mp-header">
      <div class="mp-avatar" :class="actorTypeClass">
        <span v-if="actorType === 'user'">{{ initial }}</span>
        <span v-else-if="actorType === 'bot'">🤖</span>
        <span v-else>⚙️</span>
      </div>
      <div class="mp-info">
        <div class="mp-name">{{ displayName }}</div>
        <div class="mp-role">{{ roleLabel }}</div>
      </div>
    </div>
    <div v-if="email" class="mp-row">
      <span class="mp-icon">✉</span>
      <span class="mp-text">{{ email }}</span>
    </div>
    <div v-if="extra" class="mp-row">
      <span class="mp-icon">ℹ</span>
      <span class="mp-text">{{ extra }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  actorType: 'user' | 'bot' | 'system';
  user?: { id: string; fullName: string | null; email: string } | null;
  botName?: string | null;
  systemSource?: string | null;
}>();

const displayName = computed(() => {
  if (props.actorType === 'user') return props.user?.fullName || props.user?.email || 'Người dùng';
  if (props.actorType === 'bot') return props.botName || 'Bot';
  return 'Hệ thống';
});

const email = computed(() => props.actorType === 'user' ? props.user?.email || '' : '');

const extra = computed(() => {
  if (props.actorType === 'bot') return props.botName ? `Bot ID: ${props.botName}` : '';
  if (props.actorType === 'system') return props.systemSource ? `Source: ${props.systemSource}` : '';
  return '';
});

const roleLabel = computed(() => {
  if (props.actorType === 'user') return 'Sale / Admin';
  if (props.actorType === 'bot') return 'Automation Bot';
  return 'System Source';
});

const initial = computed(() => {
  const name = props.user?.fullName || props.user?.email || '?';
  return name.charAt(0).toUpperCase();
});

const actorTypeClass = computed(() => `type-${props.actorType}`);
</script>

<style scoped>
.mention-popover {
  background: #fff;
  border-radius: 10px;
  padding: 12px 14px;
  min-width: 240px;
  max-width: 320px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.15);
}
.mp-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--smax-grey-100);
}
.mp-avatar {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}
.mp-avatar.type-user {
  background: linear-gradient(135deg, var(--smax-primary, #2962ff), #5e92ff);
}
.mp-avatar.type-bot {
  background: linear-gradient(135deg, #00897b, #4db6ac);
  font-size: 22px;
}
.mp-avatar.type-system {
  background: linear-gradient(135deg, #546e7a, #90a4ae);
  font-size: 20px;
}
.mp-info { flex: 1; min-width: 0; }
.mp-name {
  font-size: 14px;
  font-weight: 700;
  color: var(--smax-text);
}
.mp-role {
  font-size: 11px;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  margin-top: 2px;
}

.mp-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
  font-size: 12.5px;
  color: var(--smax-grey-700);
}
.mp-icon {
  color: var(--smax-grey-500);
  width: 16px;
  text-align: center;
}
.mp-text {
  flex: 1;
  word-break: break-all;
}
</style>
