<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- Community stub — automation block preview (open-core). Renders nothing. -->
<template>
  <span />
</template>

<script setup lang="ts">
import type { Block } from '@ee/automation/api/types';
defineProps<{
  visible: boolean;
  block: Block;
  contactName?: string;
  nickName?: string;
  previewOnly?: boolean;
}>();
defineEmits<{
  send: [blockId: string];
  close: [];
}>();
</script>
