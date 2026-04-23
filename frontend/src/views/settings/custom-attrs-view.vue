<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h6">Thuộc tính tùy chỉnh</h2>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="openCreate">
        Tạo mới
      </v-btn>
    </div>

    <v-progress-linear v-if="store.loading" indeterminate color="primary" class="mb-3" />

    <v-card rounded="lg" variant="outlined">
      <v-data-table
        :headers="headers"
        :items="store.defs"
        :loading="store.loading"
        density="compact"
        no-data-text="Chưa có thuộc tính nào"
        items-per-page="25"
      >
        <template #item.dataType="{ item }">
          <v-chip size="x-small" variant="tonal">{{ dtLabel(item.dataType) }}</v-chip>
        </template>
        <template #item.required="{ item }">
          <v-icon :color="item.required ? 'success' : 'grey'" size="18">
            {{ item.required ? 'mdi-check-circle' : 'mdi-minus-circle-outline' }}
          </v-icon>
        </template>
        <template #item.enumValues="{ item }">
          <span v-if="item.enumValues?.length" class="text-caption">{{ item.enumValues.join(', ') }}</span>
          <span v-else class="text-grey text-caption">—</span>
        </template>
        <template #item.actions="{ item }">
          <v-btn v-if="authStore.isAdmin" icon size="x-small" variant="text" color="primary" @click="openEdit(item)">
            <v-icon size="16">mdi-pencil-outline</v-icon>
          </v-btn>
          <v-btn v-if="authStore.isAdmin" icon size="x-small" variant="text" color="error" @click="confirmDelete(item.id)">
            <v-icon size="16">mdi-delete-outline</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <CustomAttrsDialog
      v-model="dialog"
      :edit-def="editDef"
      @saved="store.fetch(true)"
    />

    <!-- Delete confirm -->
    <v-dialog v-model="deleteDialog" max-width="400">
      <v-card>
        <v-card-title>Xóa thuộc tính?</v-card-title>
        <v-card-text>Dữ liệu thuộc tính trên các khách hàng sẽ không bị xóa ngay lập tức.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="deleteDialog = false">Hủy</v-btn>
          <v-btn color="error" :loading="deleting" @click="doDelete">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="3000">{{ snack.text }}</v-snackbar>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useCustomAttrsStore } from '@/stores/custom-attrs';
import { useAuthStore } from '@/stores/auth';
import type { AttrDef } from '@/api/custom-attrs-api';
import CustomAttrsDialog from './custom-attrs-dialog.vue';

const store = useCustomAttrsStore();
const authStore = useAuthStore();

const dialog = ref(false);
const editDef = ref<AttrDef | null>(null);
const deleteDialog = ref(false);
const deleting = ref(false);
const pendingDeleteId = ref<string | null>(null);
const snack = ref({ show: false, text: '', color: 'success' });

const headers = [
  { title: 'Khóa', key: 'key' },
  { title: 'Nhãn', key: 'label' },
  { title: 'Kiểu', key: 'dataType' },
  { title: 'Giá trị', key: 'enumValues' },
  { title: 'Bắt buộc', key: 'required' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

const DT_LABELS: Record<string, string> = {
  string: 'Văn bản', number: 'Số', date: 'Ngày', boolean: 'Đúng/Sai', enum: 'Danh sách',
};
function dtLabel(t: string) { return DT_LABELS[t] ?? t; }

onMounted(() => store.fetch());

function openCreate() { editDef.value = null; dialog.value = true; }
function openEdit(def: AttrDef) { editDef.value = def; dialog.value = true; }

function confirmDelete(id: string) {
  pendingDeleteId.value = id;
  deleteDialog.value = true;
}

async function doDelete() {
  if (!pendingDeleteId.value) return;
  deleting.value = true;
  const ok = await store.remove(pendingDeleteId.value);
  deleting.value = false;
  deleteDialog.value = false;
  snack.value = { show: true, text: ok ? 'Đã xóa' : 'Xóa thất bại', color: ok ? 'success' : 'error' };
}
</script>
