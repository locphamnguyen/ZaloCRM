<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!-- Community stub — automation block picker (open-core). Renders nothing. -->
<template>
  <span />
</template>

<script setup lang="ts">
import type { Block } from '@ee/automation/api/types';
defineProps<{
  visible: boolean;
  contact?: { fullName?: string | null; gender?: string | null; phone?: string | null } | null;
  currentUserName?: string | null;
  ownerNickId?: string | null;
}>();
defineEmits<{
  preview: [block: Block];
  'send-direct': [block: Block];
  close: [];
}>();
</script>
