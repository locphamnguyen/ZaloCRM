<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  Community-edition stub cho drawer cấu hình "Tự động giao & báo lead" (open-core).
  Render rỗng — đây là tính năng Extension (lead-notify), vắng ở bản này.
  Khớp API component thật (modelValue / listId / @saved) để @ee import resolve được.
-->
<template>
  <span />
</template>

<script setup lang="ts">
defineProps<{ modelValue?: boolean; listId?: string }>();
defineEmits<{ (e: 'update:modelValue', v: boolean): void; (e: 'saved'): void }>();
</script>
