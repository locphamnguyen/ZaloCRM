<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-card variant="outlined" class="mb-3">
    <v-card-title class="d-flex align-center text-body-1">
      <v-icon class="mr-2">mdi-text-box-search-outline</v-icon>
      Tóm tắt AI
      <v-spacer />
      <v-btn size="small" variant="text" :loading="loading" @click="$emit('refresh')">Làm mới</v-btn>
    </v-card-title>
    <v-card-text>
      <div v-if="summary" class="text-body-2" style="white-space: pre-wrap;">{{ summary }}</div>
      <div v-else class="text-body-2 text-grey">Chưa có tóm tắt.</div>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
defineProps<{ summary: string; loading: boolean }>();
defineEmits<{ refresh: [] }>();
</script>
