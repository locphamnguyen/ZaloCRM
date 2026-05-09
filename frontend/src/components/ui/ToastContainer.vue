<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="t in items"
          :key="t.id"
          class="toast"
          :class="t.type"
          @click="dismiss(t.id)"
        >
          {{ t.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useToast } from '@/composables/use-toast';

const { items, dismiss } = useToast();
</script>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 20px; right: 20px;
  display: flex; flex-direction: column-reverse; gap: 7px;
  z-index: 9999;
  pointer-events: none;
}
.toast {
  background: #2c3441;
  color: white;
  padding: 9px 17px;
  border-radius: 7px;
  font-size: 13px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.18);
  cursor: pointer;
  pointer-events: auto;
  max-width: 380px;
  border-left: 3px solid var(--smax-grey-300);
  word-wrap: break-word;
}
.toast.success { border-left-color: var(--smax-success); }
.toast.warning { border-left-color: var(--smax-warning); }
.toast.error   { border-left-color: var(--smax-error); }

.toast-enter-active,
.toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from   { opacity: 0; transform: translateX(60%); }
.toast-leave-to     { opacity: 0; transform: translateX(60%); }
</style>
