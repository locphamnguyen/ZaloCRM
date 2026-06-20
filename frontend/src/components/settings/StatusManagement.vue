<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div>
    <div class="d-flex align-center mb-4">
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Thêm Trạng thái</v-btn>
      <v-spacer />
      <span class="text-caption text-grey">Order ↑ = Cao hơn (Cha aggregate = MAX của Con)</span>
    </div>

    <v-card>
      <v-data-table
        :headers="headers"
        :items="statuses"
        :loading="loading"
        no-data-text="Chưa có status"
        items-per-page="50"
      >
        <template #item.color="{ item }">
          <div class="d-flex align-center">
            <span class="status-swatch" :style="{ background: item.color || '#999' }"></span>
            <code class="ml-2 text-caption">{{ item.color || '—' }}</code>
          </div>
        </template>
        <template #item.name="{ item }">
          <span
            class="status-chip-preview"
            :style="{
              background: chipBg(item.color),
              color: chipFg(item.color),
            }"
          >{{ item.name }}</span>
        </template>
        <template #item.isTerminal="{ item }">
          <v-icon v-if="item.isTerminal" color="warning" size="18">mdi-flag-checkered</v-icon>
          <span v-else class="text-grey">—</span>
        </template>
        <template #item.isDefault="{ item }">
          <v-icon v-if="item.isDefault" color="success" size="18">mdi-star</v-icon>
          <span v-else class="text-grey">—</span>
        </template>
        <template #item.actions="{ item }">
          <v-btn icon size="small" title="Lên 1 bước" @click="moveStatus(item, -1)" :disabled="item.order <= 1"><v-icon>mdi-arrow-up</v-icon></v-btn>
          <v-btn icon size="small" title="Xuống 1 bước" @click="moveStatus(item, 1)" :disabled="item.order >= statuses.length"><v-icon>mdi-arrow-down</v-icon></v-btn>
          <v-btn icon size="small" title="Chỉnh sửa" @click="openEdit(item)"><v-icon>mdi-pencil</v-icon></v-btn>
          <v-btn icon size="small" color="error" title="Xóa" @click="confirmDelete(item)"><v-icon>mdi-delete</v-icon></v-btn>
        </template>
      </v-data-table>
    </v-card>

    <!-- Create / Edit dialog -->
    <v-dialog v-model="showForm" max-width="440">
      <v-card>
        <v-card-title>{{ editing ? 'Chỉnh sửa Trạng thái' : 'Thêm Trạng thái' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="form.name" label="Tên *" />
          <v-text-field v-model.number="form.order" type="number" label="Order (ưu tiên)" hint="Càng cao càng ưu tiên khi Cha aggregate" persistent-hint />
          <div class="d-flex align-center mt-3 mb-2">
            <span class="text-body-2 mr-3">Màu chip:</span>
            <input type="color" v-model="form.color" class="color-input" />
            <code class="ml-2">{{ form.color }}</code>
          </div>
          <v-checkbox v-model="form.isTerminal" label="Trạng thái kết thúc (terminal — Chốt/Mất/Thất Bại)" density="compact" hide-details />
          <v-checkbox v-model="form.isDefault" label="Default cho KH mới" density="compact" hide-details />
          <v-alert v-if="formError" type="error" density="compact" class="mt-3">{{ formError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showForm = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" @click="handleSubmit">{{ editing ? 'Lưu' : 'Tạo' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm -->
    <v-dialog v-model="showDelete" max-width="400">
      <v-card>
        <v-card-title>Xóa Trạng thái</v-card-title>
        <v-card-text>
          Bạn có chắc muốn xóa <strong>{{ selected?.name }}</strong>?
          <v-alert v-if="deleteError" type="error" density="compact" class="mt-3">{{ deleteError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showDelete = false">Hủy</v-btn>
          <v-btn color="error" :loading="saving" @click="handleDelete">Xóa</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '@/api';
import { useToast } from '@/composables/use-toast';

interface Status {
  id: string;
  name: string;
  order: number;
  color: string | null;
  isTerminal: boolean;
  isDefault: boolean;
}

const statuses = ref<Status[]>([]);
const loading = ref(false);
const saving = ref(false);
const showForm = ref(false);
const showDelete = ref(false);
const editing = ref<Status | null>(null);
const selected = ref<Status | null>(null);
const formError = ref('');
const deleteError = ref('');
const toast = useToast();

const form = ref({ name: '', order: 1, color: '#9CA3AF', isTerminal: false, isDefault: false });

const headers = [
  { title: 'Order', key: 'order', sortable: true, width: 80 },
  { title: 'Tên', key: 'name' },
  { title: 'Màu', key: 'color', sortable: false },
  { title: 'Terminal', key: 'isTerminal', sortable: false, width: 100 },
  { title: 'Default', key: 'isDefault', sortable: false, width: 100 },
  { title: 'Hành động', key: 'actions', sortable: false, align: 'end' as const, width: 200 },
];

async function fetchStatuses() {
  loading.value = true;
  try {
    const res = await api.get<{ statuses: Status[] }>('/settings/statuses');
    statuses.value = res.data.statuses || [];
  } catch (err) {
    console.error('[status] fetch error:', err);
  } finally {
    loading.value = false;
  }
}

function openCreate() {
  editing.value = null;
  form.value = { name: '', order: (statuses.value.length || 0) + 1, color: '#9CA3AF', isTerminal: false, isDefault: false };
  formError.value = '';
  showForm.value = true;
}

function openEdit(s: Status) {
  editing.value = s;
  form.value = { name: s.name, order: s.order, color: s.color || '#9CA3AF', isTerminal: s.isTerminal, isDefault: s.isDefault };
  formError.value = '';
  showForm.value = true;
}

async function handleSubmit() {
  if (!form.value.name.trim()) { formError.value = 'Tên không được trống'; return; }
  saving.value = true;
  formError.value = '';
  try {
    if (editing.value) {
      await api.put(`/settings/statuses/${editing.value.id}`, form.value);
      toast.success('Đã cập nhật');
    } else {
      await api.post('/settings/statuses', form.value);
      toast.success('Đã tạo Trạng thái');
    }
    showForm.value = false;
    await fetchStatuses();
  } catch (err) {
    formError.value = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Lưu thất bại';
  } finally {
    saving.value = false;
  }
}

function confirmDelete(s: Status) {
  selected.value = s;
  deleteError.value = '';
  showDelete.value = true;
}

async function handleDelete() {
  if (!selected.value) return;
  saving.value = true;
  try {
    await api.delete(`/settings/statuses/${selected.value.id}`);
    toast.success('Đã xóa');
    showDelete.value = false;
    await fetchStatuses();
  } catch (err) {
    deleteError.value = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Xóa thất bại';
  } finally {
    saving.value = false;
  }
}

async function moveStatus(s: Status, delta: number) {
  // Swap order với neighbor
  const sorted = [...statuses.value].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex(x => x.id === s.id);
  const targetIdx = idx + delta;
  if (targetIdx < 0 || targetIdx >= sorted.length) return;
  const target = sorted[targetIdx];
  try {
    await api.post('/settings/statuses/reorder', {
      items: [
        { id: s.id, order: target.order },
        { id: target.id, order: s.order },
      ],
    });
    await fetchStatuses();
  } catch (err) {
    console.error('[status] reorder error:', err);
    toast.error('Reorder thất bại');
  }
}

function chipBg(hex: string | null): string {
  if (!hex) return 'rgba(90,100,120,0.10)';
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return 'rgba(90,100,120,0.10)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},0.15)`;
}
function chipFg(hex: string | null): string {
  return hex || 'var(--smax-grey-700)';
}

onMounted(fetchStatuses);
</script>

<style scoped>
.status-swatch { display: inline-block; width: 16px; height: 16px; border-radius: 4px; border: 1px solid rgba(0,0,0,0.1); }
.status-chip-preview { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 500; }
.color-input { width: 40px; height: 28px; border: 1px solid var(--smax-grey-300); border-radius: 4px; cursor: pointer; padding: 0; }
</style>
