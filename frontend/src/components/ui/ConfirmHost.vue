<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  ConfirmHost — mount 1 lần ở App.vue. Render hộp xác nhận dùng chung (useConfirm())
  qua ConfirmActionModal HS theme. Thay window.confirm/prompt toàn app.
-->
<template>
  <ConfirmActionModal
    v-model:open="openProxy"
    :title="confirmState.title"
    :message="confirmState.message"
    :tone="confirmState.tone"
    :confirm-text="confirmState.confirmText"
    :cancel-text="confirmState.cancelText"
    :require-reason="confirmState.requireReason"
    :reason-label="confirmState.reasonLabel"
    :reason-placeholder="confirmState.reasonPlaceholder"
    @confirm="(reason) => resolveConfirm(true, reason)"
    @cancel="resolveConfirm(false, '')"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import ConfirmActionModal from '@/components/chat/ConfirmActionModal.vue';
import { confirmState, resolveConfirm } from '@/composables/use-confirm';

// v-model:open — đóng bằng click nền/✕ cũng coi như hủy.
const openProxy = computed({
  get: () => confirmState.value.open,
  set: (v: boolean) => { if (!v) resolveConfirm(false, ''); },
});
</script>
