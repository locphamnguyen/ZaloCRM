<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  NickAvatarLock — overlay 🔒 badge ở góc avatar nick có privacyMode='main'.
  Anh chốt 2026-05-22: mọi giao diện có tên nick mà setup Riêng tư → hiện
  ổ khóa ngay phía trên góc avatar.

  Usage: wrap quanh avatar element bất kỳ:
    <NickAvatarLock :privacy-mode="acc.privacyMode">
      <Avatar :src="acc.avatarUrl" :name="acc.displayName" />
    </NickAvatarLock>
-->
<template>
  <span class="nick-avatar-lock-wrap">
    <slot />
    <span
      v-if="privacyMode === 'main'"
      class="nick-lock-badge"
      :title="lockTitle"
    >🔒</span>
  </span>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    privacyMode?: string | null;
    /** tooltip override */
    lockTitle?: string;
  }>(),
  { lockTitle: 'Nick đang bật chế độ Riêng tư' },
);
</script>

<style scoped>
.nick-avatar-lock-wrap {
  position: relative;
  display: inline-block;
  line-height: 0;
}
.nick-lock-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 18px;
  height: 18px;
  background: #aa2d00;
  color: white;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  border: 2px solid white;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  line-height: 1;
  z-index: 2;
  cursor: help;
}
</style>
