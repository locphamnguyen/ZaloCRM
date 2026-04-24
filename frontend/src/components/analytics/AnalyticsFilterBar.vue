<template>
  <div class="d-flex align-center flex-wrap gap-2">
    <v-select
      :model-value="zaloAccountId"
      :items="accountItems"
      item-title="label"
      item-value="value"
      label="Tài khoản Zalo"
      density="compact"
      variant="outlined"
      style="max-width: 200px; min-width: 160px;"
      hide-details
      clearable
      @update:model-value="(v: string | null) => emit('update:zaloAccountId', v)"
    />
    <v-select
      :model-value="assignedUserId"
      :items="userItems"
      item-title="label"
      item-value="value"
      label="Nhân viên"
      density="compact"
      variant="outlined"
      style="max-width: 200px; min-width: 160px;"
      hide-details
      clearable
      @update:model-value="(v: string | null) => emit('update:assignedUserId', v)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ZaloAccount } from '@/composables/use-zalo-accounts';
import type { OrgUser } from '@/composables/use-users';

const props = defineProps<{
  zaloAccountId: string | null;
  assignedUserId: string | null;
  accounts: ZaloAccount[];
  users: OrgUser[];
}>();

const emit = defineEmits<{
  'update:zaloAccountId': [value: string | null];
  'update:assignedUserId': [value: string | null];
}>();

const accountItems = computed(() => [
  { label: 'Tất cả', value: null },
  ...props.accounts.map((a) => ({
    label: a.displayName ?? a.zaloUid ?? a.id,
    value: a.id,
  })),
]);

const userItems = computed(() => [
  { label: 'Tất cả', value: null },
  ...props.users.map((u) => ({ label: u.fullName, value: u.id })),
]);
</script>
