<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-row dense class="mb-2 align-center">
    <!-- Search -->
    <v-col cols="12" sm="4">
      <v-text-field
        v-model="filters.search"
        prepend-inner-icon="mdi-magnify"
        label="Tìm kiếm tên / SĐT / email"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>

    <!-- Source filter -->
    <v-col cols="6" sm="4">
      <v-select
        v-model="filters.source"
        :items="sourceOptions"
        item-title="text"
        item-value="value"
        label="Nguồn"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>

    <!-- Status filter -->
    <v-col cols="6" sm="4">
      <v-select
        v-model="filters.status"
        :items="statusOptions"
        item-title="text"
        item-value="value"
        label="Trạng thái"
        clearable
        hide-details
        @update:model-value="emit('search')"
      />
    </v-col>
  </v-row>
</template>

<script setup lang="ts">
import type { ContactFilters } from '@/composables/use-contacts';
import { SOURCE_OPTIONS, STATUS_OPTIONS } from '@/composables/use-contacts';

defineProps<{ filters: ContactFilters }>();
const emit = defineEmits<{ search: [] }>();

const sourceOptions = SOURCE_OPTIONS;
const statusOptions = STATUS_OPTIONS;
</script>
