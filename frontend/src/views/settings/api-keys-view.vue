<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h6">Khóa API</h2>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="createDialog = true">
        Tạo khóa
      </v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />

    <v-card rounded="lg" variant="outlined">
      <v-data-table
        :headers="headers"
        :items="keys"
        :loading="loading"
        density="compact"
        no-data-text="Chưa có khóa API nào"
        items-per-page="25"
      >
        <template #item.prefix="{ item }">
          <code class="text-caption">{{ item.prefix }}...</code>
        </template>
        <template #item.scopes="{ item }">
          <v-chip v-for="s in item.scopes" :key="s" size="x-small" variant="tonal" class="mr-1">{{ s }}</v-chip>
        </template>
        <template #item.createdAt="{ item }">
          <span class="text-caption">{{ formatDate(item.createdAt) }}</span>
        </template>
        <template #item.lastUsedAt="{ item }">
          <span class="text-caption">{{ item.lastUsedAt ? formatDate(item.lastUsedAt) : '—' }}</span>
        </template>
        <template #item.actions="{ item }">
          <v-btn v-if="authStore.isAdmin" icon size="x-small" variant="text" color="error" @click="confirmRevoke(item.id)">
            <v-icon size="16">mdi-delete-outline</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create dialog -->
    <v-dialog v-model="createDialog" max-width="440">
      <v-card>
        <v-card-title class="text-body-1 pa-4">Tạo khóa API mới</v-card-title>
        <v-card-text class="pa-4 pt-0">
          <v-text-field v-model="newKeyName" label="Tên khóa *" variant="outlined" density="compact" hide-details />
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn variant="text" @click="createDialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="creating" :disabled="!newKeyName.trim()" @click="doCreate">Tạo</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Show full key once -->
    <v-dialog v-model="revealDialog" max-width="500" persistent>
      <v-card>
        <v-card-title class="text-body-1 pa-4 d-flex align-center">
          <v-icon color="warning" class="mr-2">mdi-alert</v-icon>
          Lưu ngay! Khóa chỉ hiển thị 1 lần
        </v-card-title>
        <v-card-text class="pa-4 pt-0">
          <v-alert type="warning" variant="tonal" density="compact" class="mb-3 text-caption">
            Sau khi đóng hộp thoại này, khóa sẽ không thể xem lại.
          </v-alert>
          <div class="d-flex align-center ga-2">
            <code class="text-caption flex-grow-1 pa-2 rounded" style="background: rgba(0,0,0,0.05); word-break: break-all;">
              {{ revealKey }}
            </code>
            <v-btn icon size="small" variant="tonal" @click="copyKey">
              <v-icon size="18">mdi-content-copy</v-icon>
            </v-btn>
          </div>
          <div v-if="copied" class="text-caption text-success mt-1">Đã sao chép!</div>
        </v-card-text>
        <v-card-actions class="pa-4 pt-0">
          <v-spacer />
          <v-btn color="primary" @click="revealDialog = false">Đã lưu, đóng</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Revoke confirm -->
    <v-dialog v-model="revokeDialog" max-width="400">
      <v-card>
        <v-card-title>Thu hồi khóa API?</v-card-title>
        <v-card-text>Tất cả ứng dụng dùng khóa này sẽ mất quyền truy cập ngay lập tức.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="revokeDialog = false">Hủy</v-btn>
          <v-btn color="error" :loading="revoking" @click="doRevoke">Thu hồi</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000">{{ snack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { listApiKeys, createApiKey, deleteApiKey, type ApiKey } from '@/api/api-keys-api';
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();

const keys = ref<ApiKey[]>([]);
const loading = ref(false);
const createDialog = ref(false);
const newKeyName = ref('');
const creating = ref(false);
const revealDialog = ref(false);
const revealKey = ref('');
const copied = ref(false);
const revokeDialog = ref(false);
const revoking = ref(false);
const pendingRevokeId = ref<string | null>(null);
const snack = ref({ show: false, text: '', color: 'success' });

const headers = [
  { title: 'Tên', key: 'name' },
  { title: 'Tiền tố', key: 'prefix' },
  { title: 'Quyền', key: 'scopes' },
  { title: 'Tạo lúc', key: 'createdAt' },
  { title: 'Dùng lần cuối', key: 'lastUsedAt' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

onMounted(() => load());

async function load() {
  loading.value = true;
  try {
    keys.value = await listApiKeys();
  } catch {
    snack.value = { show: true, text: 'Không thể tải danh sách khóa', color: 'error' };
  } finally {
    loading.value = false;
  }
}

async function doCreate() {
  creating.value = true;
  try {
    const created = await createApiKey({ name: newKeyName.value.trim() });
    await load();
    createDialog.value = false;
    newKeyName.value = '';
    revealKey.value = created.key;
    copied.value = false;
    revealDialog.value = true;
  } catch {
    snack.value = { show: true, text: 'Tạo khóa thất bại', color: 'error' };
  } finally {
    creating.value = false;
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(revealKey.value);
    copied.value = true;
  } catch {
    snack.value = { show: true, text: 'Không thể sao chép', color: 'error' };
  }
}

function confirmRevoke(id: string) {
  pendingRevokeId.value = id;
  revokeDialog.value = true;
}

async function doRevoke() {
  if (!pendingRevokeId.value) return;
  revoking.value = true;
  try {
    await deleteApiKey(pendingRevokeId.value);
    await load();
    revokeDialog.value = false;
    snack.value = { show: true, text: 'Đã thu hồi khóa', color: 'success' };
  } catch {
    snack.value = { show: true, text: 'Thu hồi thất bại', color: 'error' };
  } finally {
    revoking.value = false;
  }
}

function formatDate(d: string) {
  return new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
</script>
