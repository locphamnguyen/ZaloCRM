<template>
  <v-dialog
    :model-value="modelValue"
    max-width="500"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center pa-4">
        <v-icon class="mr-2">mdi-share-outline</v-icon>
        Chuyển tiếp tin nhắn
        <v-spacer />
        <v-btn icon size="small" variant="text" @click="emit('update:modelValue', false)">
          <v-icon>mdi-close</v-icon>
        </v-btn>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-3">
        <!-- Search -->
        <v-text-field
          v-model="query"
          placeholder="Tìm kiếm cuộc trò chuyện..."
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          hide-details
          class="mb-3"
          clearable
        />

        <!-- List -->
        <v-list
          class="forward-list overflow-y-auto"
          style="max-height: 320px;"
          density="compact"
        >
          <v-list-item
            v-for="conv in filtered"
            :key="conv.id"
            :value="conv.id"
            class="px-1"
          >
            <template #prepend>
              <v-checkbox-btn
                :model-value="selected.includes(conv.id)"
                color="primary"
                @update:model-value="toggleSelect(conv.id)"
              />
            </template>
            <v-list-item-title>
              {{ displayName(conv) }}
            </v-list-item-title>
            <template #append>
              <v-chip v-if="conv.threadType === 'group'" size="x-small" color="secondary" variant="tonal">
                Nhóm
              </v-chip>
            </template>
          </v-list-item>

          <v-list-item v-if="filtered.length === 0" class="text-center text-grey">
            Không tìm thấy cuộc trò chuyện
          </v-list-item>
        </v-list>
      </v-card-text>

      <v-divider />

      <v-card-actions class="pa-3">
        <span class="text-caption text-grey mr-auto">
          {{ selected.length > 0 ? `Đã chọn ${selected.length}` : 'Chưa chọn' }}
        </span>
        <v-btn variant="text" @click="emit('update:modelValue', false)">Huỷ</v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          :disabled="selected.length === 0"
          @click="onForward"
        >
          Chuyển tiếp
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

const props = defineProps<{
  modelValue: boolean;
  conversations: { id: string; contact: { fullName: string | null } | null; threadType: string }[];
}>();

const emit = defineEmits<{
  'update:modelValue': [val: boolean];
  forward: [targetIds: string[]];
}>();

const query = ref('');
const selected = ref<string[]>([]);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return props.conversations;
  return props.conversations.filter((c) =>
    displayName(c).toLowerCase().includes(q)
  );
});

function displayName(conv: { contact: { fullName: string | null } | null; threadType: string }): string {
  if (conv.contact?.fullName) return conv.contact.fullName;
  return conv.threadType === 'group' ? 'Nhóm' : 'Không rõ';
}

function toggleSelect(id: string) {
  const idx = selected.value.indexOf(id);
  if (idx === -1) selected.value.push(id);
  else selected.value.splice(idx, 1);
}

function onForward() {
  if (selected.value.length === 0) return;
  emit('forward', [...selected.value]);
  emit('update:modelValue', false);
  selected.value = [];
}
</script>

<style scoped>
.forward-list {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}
</style>
