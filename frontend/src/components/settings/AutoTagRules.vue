<template>
  <div>
    <div class="d-flex align-center mb-4">
      <h2 class="text-h6">Quy tắc tự gắn tag</h2>
      <v-spacer />
      <v-btn v-if="authStore.isAdmin" color="primary" prepend-icon="mdi-plus" @click="openCreate">
        Tạo rule
      </v-btn>
    </div>

    <v-progress-linear v-if="store.loading" indeterminate color="primary" class="mb-3" />

    <v-card rounded="lg" variant="outlined">
      <v-data-table
        :headers="headers"
        :items="store.rules"
        :loading="store.loading"
        density="compact"
        no-data-text="Chưa có quy tắc nào"
        items-per-page="25"
      >
        <template #item.event="{ item }">
          <v-chip size="x-small" color="secondary" variant="tonal">{{ eventLabel(item.event) }}</v-chip>
        </template>
        <template #item.tag="{ item }">
          <v-chip
            v-if="item.tag"
            size="x-small"
            :color="item.tag.color ?? 'grey'"
            variant="tonal"
          >
            {{ item.tag.name }}
          </v-chip>
        </template>
        <template #item.enabled="{ item }">
          <v-switch
            :model-value="item.enabled"
            density="compact"
            hide-details
            color="success"
            @update:model-value="(v) => toggleEnabled(item, v as boolean)"
          />
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
    <v-dialog v-model="dialog" max-width="560" :persistent="saving">
      <v-card>
        <v-card-title>{{ editTarget ? 'Sửa quy tắc' : 'Tạo quy tắc mới' }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="form.name" label="Tên quy tắc" density="compact" variant="outlined" class="mb-3" hide-details />

          <v-select
            v-model="form.event"
            :items="eventOptions"
            item-title="text"
            item-value="value"
            label="Sự kiện kích hoạt"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />

          <v-select
            v-model="form.tagId"
            :items="allTags"
            item-title="name"
            item-value="id"
            label="Tag áp dụng"
            density="compact"
            variant="outlined"
            class="mb-3"
            hide-details
          />

          <!-- Simple condition builder -->
          <div class="text-subtitle-2 mb-2">Điều kiện (tùy chọn)</div>
          <div v-for="(cond, idx) in form.conditions" :key="idx" class="d-flex gap-2 align-center mb-2">
            <v-select
              v-model="cond.field"
              :items="fieldOptions"
              item-title="text"
              item-value="value"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width:140px"
            />
            <v-select
              v-model="cond.operator"
              :items="operatorOptions"
              item-title="text"
              item-value="value"
              density="compact"
              variant="outlined"
              hide-details
              style="max-width:130px"
            />
            <v-text-field
              v-model="cond.value"
              placeholder="Giá trị"
              density="compact"
              variant="outlined"
              hide-details
              class="flex-grow-1"
            />
            <v-btn icon size="x-small" variant="text" color="error" @click="removeCond(idx)">
              <v-icon size="14">mdi-close</v-icon>
            </v-btn>
          </div>
          <v-btn size="small" variant="text" prepend-icon="mdi-plus" @click="addCond">Thêm điều kiện</v-btn>

          <!-- Dry-run -->
          <v-divider class="my-3" />
          <div class="text-subtitle-2 mb-2">Thử nghiệm (dry-run)</div>
          <v-textarea
            v-model="dryRunInput"
            label="Sample payload (JSON)"
            rows="3"
            density="compact"
            variant="outlined"
            hide-details
            class="mb-2"
            font-family="monospace"
          />
          <v-btn size="small" variant="outlined" :loading="testing" :disabled="!editTarget" @click="runTest">
            Chạy thử
          </v-btn>
          <v-alert v-if="testResult !== null" :type="testResult.matched ? 'success' : 'warning'" density="compact" class="mt-2">
            {{ testResult.matched ? 'Khớp!' : 'Không khớp' }}
            <span v-if="testResult.reason" class="ml-1">({{ testResult.reason }})</span>
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog = false">Hủy</v-btn>
          <v-btn color="primary" :loading="saving" :disabled="!form.name.trim() || !form.tagId" @click="save">Lưu</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Delete confirm -->
    <v-dialog v-model="deleteDialog" max-width="360">
      <v-card>
        <v-card-title>Xóa quy tắc?</v-card-title>
        <v-card-text>Xóa quy tắc "{{ deleteTarget?.name }}"?</v-card-text>
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
import { useTagsStore, type AutoTagRule } from '@/stores/tags';
import { useAuthStore } from '@/stores/auth';
import type { RuleCondition } from '@/api/tags';

const store = useTagsStore();
const authStore = useAuthStore();

const headers = [
  { title: 'Tên', key: 'name' },
  { title: 'Sự kiện', key: 'event' },
  { title: 'Tag', key: 'tag' },
  { title: 'Bật', key: 'enabled', sortable: false },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
];

const eventOptions = [
  { text: 'Tin nhắn đến', value: 'message_received' },
  { text: 'Tin nhắn đi', value: 'message_sent' },
  { text: 'Thay đổi trạng thái', value: 'status_changed' },
];

const fieldOptions = [
  { text: 'Nội dung', value: 'content' },
  { text: 'Trạng thái', value: 'status' },
];

const operatorOptions = [
  { text: 'Chứa', value: 'contains' },
  { text: 'Trong danh sách', value: 'in' },
  { text: '≥', value: 'gte' },
];

const allTags = computed(() => [...store.crmTags, ...store.zaloTags]);

function eventLabel(e: string) {
  return eventOptions.find((o) => o.value === e)?.text ?? e;
}

// ── Dialog form ─────────────────────────────────────────────────────────────
const dialog = ref(false);
const editTarget = ref<AutoTagRule | null>(null);
const saving = ref(false);

interface FormCond { field: string; operator: string; value: string }
const form = reactive({
  name: '',
  event: 'message_received' as AutoTagRule['event'],
  tagId: '',
  conditions: [] as FormCond[],
});

const dryRunInput = ref('{}');
const testing = ref(false);
const testResult = ref<{ matched: boolean; reason?: string } | null>(null);

const deleteDialog = ref(false);
const deleteTarget = ref<AutoTagRule | null>(null);
const deleting = ref(false);
const snack = ref({ show: false, text: '', color: 'success' });

function openCreate() {
  editTarget.value = null;
  form.name = '';
  form.event = 'message_received';
  form.tagId = '';
  form.conditions = [];
  testResult.value = null;
  dialog.value = true;
}

function openEdit(rule: AutoTagRule) {
  editTarget.value = rule;
  form.name = rule.name;
  form.event = rule.event;
  form.tagId = rule.tagId;
  form.conditions = rule.conditions.map((c) => ({
    field: c.field,
    operator: c.operator,
    value: String(c.value),
  }));
  testResult.value = null;
  dialog.value = true;
}

function addCond() {
  form.conditions.push({ field: 'content', operator: 'contains', value: '' });
}

function removeCond(idx: number) {
  form.conditions.splice(idx, 1);
}

function buildConditions(): RuleCondition[] {
  return form.conditions
    .filter((c) => c.value.trim())
    .map((c) => ({ field: c.field, operator: c.operator as RuleCondition['operator'], value: c.value }));
}

async function save() {
  saving.value = true;
  try {
    const payload = {
      name: form.name,
      event: form.event,
      tagId: form.tagId,
      conditions: buildConditions(),
    };
    if (editTarget.value) {
      await store.updateRule(editTarget.value.id, payload);
    } else {
      await store.createRule({ ...payload, enabled: true });
    }
    dialog.value = false;
    snack.value = { show: true, text: 'Đã lưu', color: 'success' };
  } catch {
    snack.value = { show: true, text: 'Lưu thất bại', color: 'error' };
  } finally {
    saving.value = false;
  }
}

async function toggleEnabled(rule: AutoTagRule, enabled: boolean) {
  await store.updateRule(rule.id, { enabled });
}

async function runTest() {
  if (!editTarget.value) return;
  testing.value = true;
  try {
    const parsed = JSON.parse(dryRunInput.value);
    testResult.value = await store.testRule(editTarget.value.id, parsed);
  } catch {
    testResult.value = { matched: false, reason: 'JSON không hợp lệ' };
  } finally {
    testing.value = false;
  }
}

function confirmDelete(rule: AutoTagRule) {
  deleteTarget.value = rule;
  deleteDialog.value = true;
}

async function doDelete() {
  if (!deleteTarget.value) return;
  deleting.value = true;
  const ok = await store.deleteRule(deleteTarget.value.id);
  deleting.value = false;
  deleteDialog.value = false;
  snack.value = { show: true, text: ok ? 'Đã xóa' : 'Xóa thất bại', color: ok ? 'success' : 'error' };
}

onMounted(() => store.loadAll());
</script>
