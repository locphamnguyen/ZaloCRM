<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- Community stub — automation blocks panel in chat (open-core). Renders nothing. -->
<template>
  <span />
</template>

<script setup lang="ts">
defineProps<{
  conversationId: string | null;
  contact?: unknown;
  ownerNickId?: string | null;
  nickName?: string | null;
}>();
</script>
