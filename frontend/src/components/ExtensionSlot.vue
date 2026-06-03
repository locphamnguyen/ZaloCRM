<!--
  ExtensionSlot — render các component plugin đã đăng ký vào 1 slot theo tên.
  Core đặt <ExtensionSlot name="..."/> ở vị trí cần mở rộng; rỗng nếu không có plugin.
-->
<script setup lang="ts">
import { getSlot } from '@/plugin-api/slot-registry';
import { useLicense } from '@/plugin-api/use-license';

const props = defineProps<{ name: string }>();
const { has } = useLicense();
</script>

<template>
  <template v-for="(entry, i) in getSlot(props.name)" :key="i">
    <component
      :is="entry.component"
      v-if="!entry.requiresFeature || has(entry.requiresFeature)"
      v-bind="$attrs"
    />
  </template>
</template>
