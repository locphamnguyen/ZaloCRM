<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    :width="size"
    :height="size"
    fill="currentColor"
    class="tag-icon"
    aria-hidden="true"
  >
    <!-- Horizontal price tag pointing left, hole tròn đầu trái. -->
    <path d="M2.5 12L9.5 5h11a1.5 1.5 0 011.5 1.5v11a1.5 1.5 0 01-1.5 1.5h-11L2.5 12z" />
    <circle cx="8.5" cy="12" r="1.4" fill="white" />
  </svg>
</template>

<script setup lang="ts">
defineProps<{
  size?: number | string;
}>();
</script>

<script lang="ts">
export default { name: 'TagIcon' };
</script>

<style scoped>
.tag-icon {
  display: inline-block;
  vertical-align: -2px;
  flex-shrink: 0;
}
</style>
