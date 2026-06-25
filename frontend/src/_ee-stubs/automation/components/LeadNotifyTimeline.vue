<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  Community-edition stub cho thanh timeline 24h "lead đã báo" (open-core).
  Render rỗng — tính năng Extension (lead-notify), vắng ở bản này.
  Khớp API component thật (listId / @open-entry) để @ee import resolve được.
-->
<template>
  <span />
</template>

<script setup lang="ts">
defineProps<{ listId?: string }>();
defineEmits<{ (e: 'open-entry', id: string): void }>();
</script>
