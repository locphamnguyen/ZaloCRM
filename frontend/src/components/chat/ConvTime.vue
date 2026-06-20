<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>{{ label }}</template>

<script setup lang="ts">
// ConvTime — hiển thị thời gian tương đối 1 hàng hội thoại (cột 2), TỰ cập nhật mỗi 30s.
// 2026-06-11 (perf): tách khỏi ConversationList để khi ticker đổi CHỈ component này
// re-render, KHÔNG ép cả hàng (avatar/tag/badge) tính lại → hết giật chu kỳ.
import { computed } from 'vue';
import { useSharedNow, formatConvTime } from '@/composables/use-relative-time';

const props = defineProps<{ at: string | null }>();
const now = useSharedNow();
const label = computed(() => formatConvTime(props.at, now.value));
</script>
