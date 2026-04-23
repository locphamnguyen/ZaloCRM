<template>
  <v-menu v-model="menuOpen" :close-on-content-click="false" location="bottom start" min-width="240">
    <template #activator="{ props: menuProps }">
      <v-chip
        v-bind="menuProps"
        :color="activeSelection ? activeSelection.color ?? 'primary' : undefined"
        :variant="activeSelection ? 'tonal' : 'outlined'"
        size="small"
        prepend-icon="mdi-account-group-outline"
        append-icon="mdi-chevron-down"
        class="mb-2"
        style="cursor: pointer;"
      >
        {{ activeLabel }}
      </v-chip>
    </template>

    <v-list density="compact">
      <!-- All accounts -->
      <v-list-item
        prepend-icon="mdi-account-multiple-outline"
        :active="modelValue === null"
        @click="select(null)"
      >
        <v-list-item-title>Tất cả tài khoản</v-list-item-title>
      </v-list-item>

      <v-divider v-if="accountOptions.length > 0" />

      <!-- Individual accounts -->
      <v-list-subheader v-if="accountOptions.length > 0">Tài khoản đơn</v-list-subheader>
      <v-list-item
        v-for="acc in accountOptions"
        :key="'acc-' + acc.id"
        :active="modelValue?.kind === 'account' && modelValue.id === acc.id"
        prepend-icon="mdi-account-circle-outline"
        @click="selectAccount(acc)"
      >
        <v-list-item-title>{{ acc.displayName }}</v-list-item-title>
      </v-list-item>

      <v-divider v-if="store.views.length > 0" />

      <!-- Group views -->
      <v-list-subheader v-if="store.views.length > 0">Nhóm tài khoản</v-list-subheader>
      <v-list-item
        v-for="view in store.views"
        :key="view.id"
        :active="modelValue?.kind === 'group-view' && modelValue.id === view.id"
        @click="selectView(view)"
      >
        <template #prepend>
          <v-avatar :color="view.color ?? 'grey'" size="20" class="mr-2">
            <v-icon size="12" color="white">mdi-account-group</v-icon>
          </v-avatar>
        </template>
        <v-list-item-title>{{ view.name }}</v-list-item-title>
        <template #append>
          <v-btn icon size="x-small" variant="text" @click.stop="openEdit(view)">
            <v-icon size="14">mdi-pencil-outline</v-icon>
          </v-btn>
          <v-btn icon size="x-small" variant="text" color="error" @click.stop="confirmDelete(view)">
            <v-icon size="14">mdi-delete-outline</v-icon>
          </v-btn>
        </template>
      </v-list-item>

      <v-divider />
      <v-list-item prepend-icon="mdi-plus" @click="openCreate">
        <v-list-item-title>Tạo nhóm tài khoản</v-list-item-title>
      </v-list-item>
    </v-list>
  </v-menu>

  <!-- Create/Edit dialog -->
  <v-dialog v-model="dialog" max-width="480" :persistent="saving">
    <v-card>
      <v-card-title>{{ editTarget ? 'Sửa nhóm' : 'Tạo nhóm tài khoản' }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="form.name"
          label="Tên nhóm"
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
        <v-autocomplete
          v-model="form.accountIds"
          :items="accountOptions"
          item-title="displayName"
          item-value="id"
          label="Tài khoản (tối đa 20)"
          density="compact"
          variant="outlined"
          multiple
          chips
          closable-chips
          hide-details
          :rules="[v => v.length <= 20 || 'Tối đa 20 tài khoản']"
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
      <v-card-title>Xóa nhóm?</v-card-title>
      <v-card-text>Xóa nhóm "{{ deleteTarget?.name }}"?</v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="deleteDialog = false">Hủy</v-btn>
        <v-btn color="error" :loading="deleting" @click="doDelete">Xóa</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import { useGroupViewStore, type GroupView } from '@/stores/group-view';
import { api } from '@/api/index';

export interface ActiveSelection {
  kind: 'account' | 'group-view';
  id: string;
  label: string;
  color?: string | null;
}

const props = defineProps<{
  modelValue: ActiveSelection | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: ActiveSelection | null];
  change: [value: ActiveSelection | null];
}>();

const store = useGroupViewStore();
const menuOpen = ref(false);

interface AccountOption { id: string; displayName: string }
const accountOptions = ref<AccountOption[]>([]);

const activeSelection = computed(() => props.modelValue);
const activeLabel = computed(() => {
  if (!activeSelection.value) return 'Tất cả tài khoản';
  return activeSelection.value.label;
});

// ── Dialog state ────────────────────────────────────────────────────────────
const dialog = ref(false);
const editTarget = ref<GroupView | null>(null);
const saving = ref(false);
const form = reactive({ name: '', color: null as string | null, accountIds: [] as string[] });

const deleteDialog = ref(false);
const deleteTarget = ref<GroupView | null>(null);
const deleting = ref(false);

// ── Selection ───────────────────────────────────────────────────────────────
function select(val: ActiveSelection | null) {
  emit('update:modelValue', val);
  emit('change', val);
  menuOpen.value = false;
}

function selectAccount(acc: AccountOption) {
  select({ kind: 'account', id: acc.id, label: acc.displayName });
}

function selectView(view: GroupView) {
  select({ kind: 'group-view', id: view.id, label: view.name, color: view.color });
}

// ── Create/Edit ─────────────────────────────────────────────────────────────
function openCreate() {
  editTarget.value = null;
  form.name = '';
  form.color = null;
  form.accountIds = [];
  dialog.value = true;
  menuOpen.value = false;
}

function openEdit(view: GroupView) {
  editTarget.value = view;
  form.name = view.name;
  form.color = view.color;
  form.accountIds = [...view.accountIds];
  dialog.value = true;
  menuOpen.value = false;
}

async function save() {
  if (!form.name.trim()) return;
  saving.value = true;
  try {
    if (editTarget.value) {
      await store.update(editTarget.value.id, { name: form.name, color: form.color, accountIds: form.accountIds });
    } else {
      await store.create({ name: form.name, color: form.color, accountIds: form.accountIds });
    }
    dialog.value = false;
  } finally {
    saving.value = false;
  }
}

// ── Delete ──────────────────────────────────────────────────────────────────
function confirmDelete(view: GroupView) {
  deleteTarget.value = view;
  deleteDialog.value = true;
  menuOpen.value = false;
}

async function doDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  try {
    await store.remove(deleteTarget.value.id);
    if (props.modelValue?.kind === 'group-view' && props.modelValue.id === deleteTarget.value.id) {
      select(null);
    }
    deleteDialog.value = false;
  } finally {
    deleting.value = false;
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────────
onMounted(async () => {
  await store.load();
  try {
    const res = await api.get('/zalo-accounts');
    const accounts = Array.isArray(res.data) ? res.data : res.data.accounts ?? [];
    accountOptions.value = accounts.map((a: Record<string, unknown>) => ({
      id: a.id as string,
      displayName: (a.displayName || a.zaloUid || a.id) as string,
    }));
  } catch {
    // Non-critical
  }
});
</script>
