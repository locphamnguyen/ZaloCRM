<template>
  <v-banner v-if="!isOnline" color="warning" icon="mdi-wifi-off" lines="one" density="compact" style="position: fixed; top: 0; left: 0; right: 0; z-index: 200;">
    <template #text>
      Mất kết nối — tin nhắn sẽ gửi khi có mạng
    </template>
  </v-banner>
</template>

<script setup lang="ts">
import { useMobile } from '@/composables/use-mobile';
const { isOnline } = useMobile();
</script>
