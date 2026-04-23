<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h6">Quản lý Tags</h2>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="openCreate">
        Tạo tag
      </v-btn>
    </div>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="crm">Tags CRM</v-tab>
      <v-tab value="zalo">Tags Zalo</v-tab>
    </v-tabs>

    <v-progress-linear v-if="store.loading" indeterminate color="primary" class="mb-3" />

    <v-card rounded="lg" variant="outlined">
      <v-data-table
        :headers="headers"
        :items="activeList"
        :loading="store.loading"
        density="compact"
        no-data-text="Chưa có tag nào"
        items-per-page="25"
      >
        <template #item.color="{ item }">
          <v-avatar :color="item.color ?? 'grey'" size="20">
            <span style="font-size:8px;color:white">●</span>
          </v-avatar>
          <span class="ml-2 text-caption">{{ item.color ?? '—' }}</span>
        </template>
        <template #item.source="{ item }">
          <v-chip size="x-small" :color="item.source === 'zalo' ? 'blue' : 'grey'" variant="tonal">
            {{ item.source === 'zalo' ? 'Zalo' : 'CRM' }}
          </v-chip>
        </template>
        <template #item._count="{ item }">
          {{ item._count?.contactTags ?? 0 }}
        </template>
        <template #item.actions="{ item }">
          <v-btn v-if="authStore.isAdmin" icon size="x-small" variant="text" color="primary" @click="openEdit(item)">
            <v-icon size="16">mdi-pencil-outline</v-icon>
          </v-btn>
          <v-btn v-if="authStore.isAdmin" icon size="x-small" variant="text" color="error" @click="confirmDelete(item)">
            <v-icon size="16">mdi-delete-outline</v-icon>
          </v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create/Edit dialog -->
    <v-dialog v-model="dialog" max-width="420" :persistent="saving">
      <v-card>
        <v-card-title>{{ editTarget ? 'Sửa tag' : 'Tạo tag mới' }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="form.name"
            label="Tên tag"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />
          <div class="d-flex align-center gap-3 mb-3">
            <span class="text-body-2">Màu:</span>
            <v-menu :close-on-content-click="false">
              <template #activator="{ props: cp }">
                <v-chip v-bind="cp" :color="form.color ?? 'grey'" size="small" style="cursor:pointer">
                  {{ form.color ?? 'Chọn màu' }}
                </v-chip>
              </template>
              <v-color-picker v-model="form.color" mode="hex" hide-inputs />
            </v-menu>
          </div>
          <v-select
            v-if="!editTarget"
            v-model="form.source"
            :items="sourceOptions"
            item-title="text"
            item-value="value"
            label="Loại tag"
            density="compact"
            variant="outlined"
            hide-details
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" :disabled="!form.name.trim()" @click="save">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm -->
    <v-dialog v-model="deleteDialog" max-width="360">
      <v-card>
        <v-card-title>Xóa tag?</v-card-title>
        <v-card-text>Xóa tag "{{ deleteTarget?.name }}"?</v-card-text>
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
import { ref, computed, reactive, onMounted } from 'vue';
import { useTagsStore, type Tag } from '@/stores/tags';
import { useAuthStore } from '@/stores/auth';

const store = useTagsStore();
const authStore = useAuthStore();

const tab = ref<'crm' | 'zalo'>('crm');
const activeList = computed(() => tab.value === 'crm' ? store.crmTags : store.zaloTags);

const headers = [
  { title: 'Tên', key: 'name' },
  { title: 'Màu', key: 'color', sortable: false },
  { title: 'Loại', key: 'source' },
  { title: 'Số liên kết', key: '_count' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

const sourceOptions = [
  { text: 'CRM', value: 'crm' },
  { text: 'Zalo', value: 'zalo' },
];

const dialog = ref(false);
const editTarget = ref<Tag | null>(null);
const saving = ref(false);
const form = reactive({ name: '', color: null as string | null, source: 'crm' as 'crm' | 'zalo' });

const deleteDialog = ref(false);
const deleteTarget = ref<Tag | null>(null);
const deleting = ref(false);
const snack = ref({ show: false, text: '', color: 'success' });

function openCreate() {
  editTarget.value = null;
  form.name = '';
  form.color = null;
  form.source = tab.value;
  dialog.value = true;
}

function openEdit(tag: Tag) {
  editTarget.value = tag;
  form.name = tag.name;
  form.color = tag.color;
  form.source = tag.source;
  dialog.value = true;
}

async function save() {
  saving.value = true;
  try {
    if (editTarget.value) {
      await store.updateTag(editTarget.value.id, { name: form.name, color: form.color });
    } else {
      await store.createTag({ name: form.name, color: form.color, source: form.source });
    }
    dialog.value = false;
    snack.value = { show: true, text: 'Đã lưu', color: 'success' };
  } catch {
    snack.value = { show: true, text: 'Lưu thất bại', color: 'error' };
  } finally {
    saving.value = false;
  }
}

function confirmDelete(tag: Tag) {
  deleteTarget.value = tag;
  deleteDialog.value = true;
}

async function doDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  const ok = await store.deleteTag(deleteTarget.value.id);
  deleting.value = false;
  deleteDialog.value = false;
  snack.value = { show: true, text: ok ? 'Đã xóa' : 'Xóa thất bại', color: ok ? 'success' : 'error' };
}

onMounted(() => store.loadAll());
</script>
