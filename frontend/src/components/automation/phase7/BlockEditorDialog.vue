<template>
  <v-dialog :model-value="modelValue" max-width="720" persistent @update:model-value="$emit('update:modelValue', $event)">
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon class="mr-2">{{ ACTION_TYPE_ICONS[draft.actionType] }}</v-icon>
        {{ isEdit ? 'Sửa Block' : 'Tạo Block mới' }}
        <v-spacer />
        <v-btn icon variant="text" @click="$emit('update:modelValue', false)"><v-icon>mdi-close</v-icon></v-btn>
      </v-card-title>

      <v-card-text>
        <v-text-field v-model="draft.name" label="Tên block" variant="outlined" density="comfortable" class="mb-3" />

        <v-select
          v-model="draft.actionType"
          :items="actionTypeItems"
          item-title="label"
          item-value="value"
          label="Loại action"
          variant="outlined"
          density="comfortable"
          class="mb-3"
          :disabled="isEdit"
          :hint="isEdit ? 'Không đổi action type khi edit để giữ snapshot nhất quán' : 'Phase này: 3 loại action'"
          persistent-hint
        />

        <v-select
          v-model="draft.folderId"
          :items="folderItems"
          item-title="name"
          item-value="id"
          label="Folder (tổ chức)"
          variant="outlined"
          density="comfortable"
          clearable
          class="mb-3"
        />

        <!-- request_friend: greetingVariants -->
        <template v-if="draft.actionType === 'request_friend'">
          <div class="text-subtitle-2 mb-2">Lời chào kết bạn (nhiều variant để tránh detect spam)</div>
          <v-textarea
            v-for="(v, idx) in greetingVariants"
            :key="idx"
            :model-value="v"
            :label="`Variant ${idx + 1}`"
            variant="outlined"
            rows="2"
            class="mb-2"
            @update:model-value="updateGreeting(idx, $event)"
          >
            <template #append-inner>
              <v-btn v-if="greetingVariants.length > 1" icon variant="text" size="small" @click="removeGreeting(idx)">
                <v-icon size="small">mdi-close</v-icon>
              </v-btn>
            </template>
          </v-textarea>
          <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="addGreeting">Thêm variant</v-btn>
        </template>

        <!-- send_message: textVariants + attachments -->
        <template v-else-if="draft.actionType === 'send_message'">
          <div class="text-subtitle-2 mb-2">Nội dung tin (variants)</div>
          <v-textarea
            v-for="(v, idx) in textVariants"
            :key="idx"
            :model-value="v"
            :label="`Variant ${idx + 1}`"
            variant="outlined"
            rows="3"
            class="mb-2"
            @update:model-value="updateText(idx, $event)"
          >
            <template #append-inner>
              <v-btn v-if="textVariants.length > 1" icon variant="text" size="small" @click="removeText(idx)">
                <v-icon size="small">mdi-close</v-icon>
              </v-btn>
            </template>
          </v-textarea>
          <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="addText">Thêm variant</v-btn>

          <div class="text-subtitle-2 mt-4 mb-2">Đính kèm (optional)</div>
          <div v-for="(att, idx) in attachments" :key="idx" class="d-flex gap-2 mb-2 align-center">
            <v-select :model-value="att.kind" :items="['image','video','file','link']" label="Kiểu" variant="outlined" density="compact" style="max-width: 110px" @update:model-value="att.kind = $event" />
            <v-text-field :model-value="att.url" label="URL" variant="outlined" density="compact" @update:model-value="att.url = $event" />
            <v-text-field :model-value="att.caption" label="Caption" variant="outlined" density="compact" @update:model-value="att.caption = $event" />
            <v-btn icon variant="text" size="small" @click="attachments.splice(idx, 1)"><v-icon size="small">mdi-close</v-icon></v-btn>
          </div>
          <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="attachments.push({ kind: 'image', url: '', caption: '' })">Thêm đính kèm</v-btn>
        </template>

        <!-- update_status -->
        <template v-else-if="draft.actionType === 'update_status'">
          <v-select
            v-model="statusId"
            :items="statusItems"
            item-title="name"
            item-value="id"
            label="Đổi sang trạng thái"
            variant="outlined"
            density="comfortable"
          />
          <div class="text-caption text-medium-emphasis mt-2">
            Chỉ áp dụng khi KH đang ở 1 trong các trạng thái sau (để trống = áp dụng mọi trạng thái):
          </div>
          <v-select
            v-model="onlyFromStatusIds"
            :items="statusItems"
            item-title="name"
            item-value="id"
            label="Chỉ áp dụng khi đang ở (allowlist)"
            variant="outlined"
            density="comfortable"
            multiple
            chips
            class="mt-2"
          />
        </template>

        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>

      <v-card-actions class="px-4 pb-4">
        <v-spacer />
        <v-btn variant="text" @click="$emit('update:modelValue', false)">Huỷ</v-btn>
        <v-btn color="primary" :loading="saving" @click="onSave">{{ isEdit ? 'Lưu' : 'Tạo' }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { ACTION_TYPE_LABELS, ACTION_TYPE_ICONS, SUPPORTED_ACTION_TYPES, type Block, type BlockActionType, type BlockFolder } from '@/api/automation/types';
import { blocksApi } from '@/api/automation';

const props = defineProps<{
  modelValue: boolean;
  block?: Block | null;
  folders: BlockFolder[];
  statusItems: Array<{ id: string; name: string }>;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  saved: [block: Block];
}>();

const isEdit = computed(() => Boolean(props.block));

interface Draft {
  name: string;
  actionType: BlockActionType;
  folderId: string | null;
}
const draft = ref<Draft>({ name: '', actionType: 'send_message', folderId: null });
const greetingVariants = ref<string[]>(['']);
const textVariants = ref<string[]>(['']);
const attachments = ref<Array<{ kind: string; url: string; caption: string }>>([]);
const statusId = ref<string>('');
const onlyFromStatusIds = ref<string[]>([]);
const saving = ref(false);
const error = ref<string>('');

const actionTypeItems = SUPPORTED_ACTION_TYPES.map((value) => ({ value, label: ACTION_TYPE_LABELS[value] }));
const folderItems = computed(() => [{ id: null as string | null, name: '— Không folder —' }, ...props.folders.map((f) => ({ id: f.id, name: f.name }))]);

watch(() => props.modelValue, (open) => {
  if (!open) return;
  error.value = '';
  if (props.block) {
    draft.value = {
      name: props.block.name,
      actionType: props.block.actionType,
      folderId: props.block.folderId,
    };
    const c = props.block.content as Record<string, unknown>;
    greetingVariants.value = Array.isArray(c.greetingVariants) ? [...c.greetingVariants as string[]] : [''];
    textVariants.value = Array.isArray(c.textVariants) ? [...c.textVariants as string[]] : [''];
    attachments.value = Array.isArray(c.attachments)
      ? (c.attachments as Array<{ kind: string; url: string; caption?: string }>).map((a) => ({ kind: a.kind, url: a.url, caption: a.caption ?? '' }))
      : [];
    statusId.value = typeof c.statusId === 'string' ? c.statusId : '';
    onlyFromStatusIds.value = Array.isArray(c.onlyFromStatusIds) ? [...c.onlyFromStatusIds as string[]] : [];
  } else {
    draft.value = { name: '', actionType: 'send_message', folderId: null };
    greetingVariants.value = [''];
    textVariants.value = [''];
    attachments.value = [];
    statusId.value = '';
    onlyFromStatusIds.value = [];
  }
});

function updateGreeting(idx: number, val: string) { greetingVariants.value[idx] = val; }
function addGreeting() { greetingVariants.value.push(''); }
function removeGreeting(idx: number) { greetingVariants.value.splice(idx, 1); }

function updateText(idx: number, val: string) { textVariants.value[idx] = val; }
function addText() { textVariants.value.push(''); }
function removeText(idx: number) { textVariants.value.splice(idx, 1); }

function buildContent(): Record<string, unknown> {
  switch (draft.value.actionType) {
    case 'request_friend':
      return { greetingVariants: greetingVariants.value.filter((s) => s.trim()) };
    case 'send_message': {
      const out: Record<string, unknown> = { textVariants: textVariants.value.filter((s) => s.trim()) };
      const valid = attachments.value.filter((a) => a.url.trim());
      if (valid.length > 0) {
        out.attachments = valid.map((a) => ({
          kind: a.kind,
          url: a.url,
          ...(a.caption ? { caption: a.caption } : {}),
        }));
      }
      return out;
    }
    case 'update_status':
      return {
        statusId: statusId.value,
        ...(onlyFromStatusIds.value.length > 0 ? { onlyFromStatusIds: onlyFromStatusIds.value } : {}),
      };
    default:
      return {};
  }
}

async function onSave() {
  error.value = '';
  if (!draft.value.name.trim()) { error.value = 'Tên block không được rỗng'; return; }
  saving.value = true;
  try {
    const content = buildContent();
    let block: Block;
    if (props.block) {
      block = await blocksApi.updateBlock(props.block.id, {
        name: draft.value.name.trim(),
        folderId: draft.value.folderId,
        content,
      });
    } else {
      block = await blocksApi.createBlock({
        name: draft.value.name.trim(),
        actionType: draft.value.actionType,
        folderId: draft.value.folderId,
        content,
      });
    }
    emit('saved', block);
    emit('update:modelValue', false);
  } catch (err: any) {
    error.value = err?.response?.data?.detail || err?.response?.data?.error || err?.message || 'Lỗi không xác định';
  } finally {
    saving.value = false;
  }
}
</script>
