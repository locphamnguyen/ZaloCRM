<template>
  <transition name="bulk-slide">
    <div v-if="count > 0" class="bulk-bar">
      <span class="ct"><em>{{ count }}</em> đã chọn</span>
      <span class="div"></span>
      <button @click="$emit('action', 'reconnect')" :disabled="loading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
        Reconnect đồng loạt
      </button>
      <button @click="$emit('action', 'sync-contacts')" :disabled="loading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        Sync danh bạ
      </button>
      <span class="spacer"></span>
      <button class="danger" @click="$emit('action', 'disable')" :disabled="loading">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
        Disable
      </button>
      <button class="x" @click="$emit('clear')" title="Bỏ chọn tất cả">✕</button>
    </div>
  </transition>
</template>

<script setup lang="ts">
defineProps<{
  count: number;
  loading?: boolean;
}>();

defineEmits<{
  (e: 'action', action: 'reconnect' | 'sync-contacts' | 'disable'): void;
  (e: 'clear'): void;
}>();
</script>

<style scoped>
.bulk-bar {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  background: #111827;
  color: white;
  border-radius: 12px;
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 14px;
  box-shadow: 0 10px 28px rgba(17, 24, 39, 0.30);
  z-index: 90;
  min-width: 480px;
}
.ct {
  font-weight: 600;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.ct em {
  color: #A5B4FC;
  font-style: normal;
  margin-right: 4px;
  font-weight: 700;
}
.div {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.18);
}
.bulk-bar button {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: white;
  font-size: 12px;
  font-weight: 500;
  padding: 6px 11px;
  border-radius: 7px;
  cursor: pointer;
  display: inline-flex;
  gap: 5px;
  align-items: center;
  transition: background 0.12s;
}
.bulk-bar button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.18) }
.bulk-bar button:disabled { opacity: 0.5; cursor: not-allowed }
.bulk-bar button.danger {
  background: rgba(239, 68, 68, 0.16);
  border-color: rgba(239, 68, 68, 0.35);
  color: #FCA5A5;
}
.bulk-bar button.danger:hover:not(:disabled) { background: rgba(239, 68, 68, 0.28) }
.bulk-bar button svg { width: 13px; height: 13px }
.bulk-bar .x {
  background: transparent;
  border: none;
  opacity: 0.55;
  font-size: 14px;
  padding: 2px 6px;
}
.bulk-bar .x:hover:not(:disabled) { opacity: 1; background: transparent }

.spacer { flex: 1 }

.bulk-slide-enter-active,
.bulk-slide-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}
.bulk-slide-enter-from,
.bulk-slide-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(12px);
}
</style>
