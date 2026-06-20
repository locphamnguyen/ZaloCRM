<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-dialog v-model="open" max-width="520">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2" color="#0E445A">mdi-shield-account</v-icon>
        Phân quyền truy cập — {{ accountName }}
      </v-card-title>

      <v-card-text>
        <v-progress-linear v-if="loading" indeterminate color="#1786BE" class="mb-3" />

        <!-- Current access list -->
        <div v-if="accessList.length" class="mb-4">
          <div class="text-subtitle-2 mb-2">Người có quyền truy cập</div>
          <v-list density="compact" rounded="lg" class="access-vlist">
            <v-list-item v-for="a in accessList" :key="a.id" class="access-vrow">
              <template #prepend>
                <Avatar :name="a.user?.fullName || a.user?.email || '?'" :size="34" :platform="null" class="mr-3" />
              </template>
              <v-list-item-title class="access-name">{{ a.user?.fullName || '(Chưa có tên)' }}</v-list-item-title>
              <v-list-item-subtitle class="access-email">{{ a.user?.email }}</v-list-item-subtitle>
              <template #append>
                <v-select
                  :model-value="a.permission"
                  :items="permissionOptions"
                  item-title="label"
                  item-value="value"
                  density="compact"
                  hide-details
                  variant="outlined"
                  style="min-width: 120px;"
                  class="mr-2"
                  @update:model-value="handleUpdatePermission(a.id, $event)"
                />
                <v-btn icon size="x-small" color="error" variant="text" @click="handleRemoveAccess(a.id)">
                  <v-icon>mdi-delete</v-icon>
                </v-btn>
              </template>
            </v-list-item>
          </v-list>
        </div>
        <div v-else-if="!loading" class="text-medium-emphasis text-body-2 mb-4">
          Chưa có người dùng nào được cấp quyền
        </div>

        <!-- Add access section -->
        <v-divider class="mb-3" />
        <div class="text-subtitle-2 mb-2">Thêm người dùng</div>
        <div class="d-flex gap-2 align-start">
          <v-autocomplete
            v-model="newUserId"
            :items="availableUsers"
            item-title="fullName"
            item-value="id"
            label="Chọn nhân viên"
            placeholder="Gõ tên để tìm…"
            density="compact"
            hide-details
            variant="outlined"
            no-data-text="Không tìm thấy nhân viên"
            :custom-filter="filterUser"
            auto-select-first
            class="flex-grow-1"
          >
            <template #item="{ props: itemProps, item }">
              <!-- itemProps đã mang title=fullName (item-title). Chỉ thêm email làm subtitle.
                   item có thể là InternalItem (.raw) hoặc raw object tùy version → đọc cả hai. -->
              <v-list-item v-bind="itemProps" :subtitle="(item as any).raw?.email ?? (item as any).email" />
            </template>
          </v-autocomplete>
          <v-select
            v-model="newPermission"
            :items="permissionOptions"
            item-title="label"
            item-value="value"
            label="Quyền"
            density="compact"
            hide-details
            variant="outlined"
            style="min-width: 130px;"
          />
          <v-btn color="primary" :loading="saving" :disabled="!newUserId" @click="handleAddAccess">
            Thêm
          </v-btn>
        </div>
        <v-alert v-if="dialogError" type="error" density="compact" class="mt-3">{{ dialogError }}</v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn @click="open = false">Đóng</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';

import { api } from '@/api/index';
import { useUsers } from '@/composables/use-users';
import Avatar from '@/components/ui/Avatar.vue';

interface AccessEntry {
  id: string;
  userId: string;
  permission: string;
  // Backend trả user lồng: include { user: { id, fullName, email, role } }.
  user?: { id: string; fullName: string | null; email: string | null; role?: string | null };
}

// Search nhân viên theo tên HOẶC email (nhiều nhân viên → autocomplete).
function filterUser(_value: string, query: string, item?: { raw?: { fullName?: string | null; email?: string | null } }): boolean {
  const q = (query || '').trim().toLowerCase();
  if (!q) return true;
  const name = (item?.raw?.fullName || '').toLowerCase();
  const email = (item?.raw?.email || '').toLowerCase();
  return name.includes(q) || email.includes(q);
}

const props = defineProps<{
  modelValue: boolean;
  accountId: string;
  accountName: string;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void;
}>();

const { users, fetchUsers } = useUsers();

// Writable computed to allow v-model on the dialog
const open = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val),
});

const accessList = ref<AccessEntry[]>([]);
const loading = ref(false);
const saving = ref(false);
const dialogError = ref('');
const newUserId = ref('');
const newPermission = ref('read');

const permissionOptions = [
  { label: 'Xem', value: 'read' },
  { label: 'Chat', value: 'chat' },
  { label: 'Quản lý', value: 'admin' },
];

const availableUsers = computed(() => {
  const grantedIds = new Set(accessList.value.map((a) => a.userId));
  return users.value.filter((u) => !grantedIds.has(u.id));
});

async function fetchAccess() {
  if (!props.accountId) return;
  loading.value = true;
  try {
    const res = await api.get(`/zalo-accounts/${props.accountId}/access`);
    accessList.value = res.data.access ?? res.data;
  } catch {
    accessList.value = [];
  } finally {
    loading.value = false;
  }
}

async function handleAddAccess() {
  if (!newUserId.value) return;
  saving.value = true;
  dialogError.value = '';
  try {
    await api.post(`/zalo-accounts/${props.accountId}/access`, {
      userId: newUserId.value,
      permission: newPermission.value,
    });
    newUserId.value = '';
    newPermission.value = 'read';
    await fetchAccess();
  } catch (err: any) {
    dialogError.value = err.response?.data?.error || 'Lỗi thêm quyền truy cập';
  } finally {
    saving.value = false;
  }
}

async function handleUpdatePermission(accessId: string, permission: string) {
  try {
    await api.put(`/zalo-accounts/${props.accountId}/access/${accessId}`, { permission });
    await fetchAccess();
  } catch (err: any) {
    dialogError.value = err.response?.data?.error || 'Lỗi cập nhật quyền';
  }
}

async function handleRemoveAccess(accessId: string) {
  try {
    await api.delete(`/zalo-accounts/${props.accountId}/access/${accessId}`);
    await fetchAccess();
  } catch (err: any) {
    dialogError.value = err.response?.data?.error || 'Lỗi xóa quyền truy cập';
  }
}

watch(() => props.modelValue, (val) => {
  if (val) {
    dialogError.value = '';
    fetchAccess();
    fetchUsers();
  }
});
</script>

<style scoped>
/* Brand guide (DESIGN.md): Surface-2 nền nhạt, border Line, ink names — KHÔNG cyan. */
.access-vlist {
  background: #F7F9FC;
  border: 1px solid #E7EAF0;
  padding: 4px;
}
.access-vrow:not(:last-child) {
  border-bottom: 1px solid #EEF1F6;
}
.access-name {
  font-weight: 600;
  color: #141A24;
}
.access-email {
  font-size: 12px;
  color: #6B7488;
}
</style>
