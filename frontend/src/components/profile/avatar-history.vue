<template>
  <v-card>
    <v-card-title class="d-flex align-center justify-space-between">
      <span>Lịch sử ảnh đại diện</span>
      <v-btn icon size="small" variant="text" :loading="loading" @click="emit('refresh')">
        <v-icon>mdi-refresh</v-icon>
      </v-btn>
    </v-card-title>

    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mb-3">
        {{ error }}
      </v-alert>

      <div v-if="avatars.length === 0 && !loading" class="text-center text-medium-emphasis py-4">
        Chưa có ảnh đại diện nào
      </div>

      <v-row v-else dense>
        <v-col
          v-for="avatar in avatars"
          :key="avatar.id"
          cols="4"
          sm="3"
        >
          <div class="avatar-card rounded-lg overflow-hidden">
            <v-img
              :src="avatar.hdUrl ?? avatar.url ?? ''"
              :alt="`Avatar ${avatar.id}`"
              aspect-ratio="1"
              cover
            >
              <template #placeholder>
                <div class="d-flex align-center justify-center fill-height">
                  <v-icon color="grey-lighten-2">mdi-image</v-icon>
                </div>
              </template>
            </v-img>

            <!-- Actions overlay -->
            <div class="avatar-actions d-flex justify-center pa-1 gap-1">
              <v-btn
                icon
                size="x-small"
                color="primary"
                :title="'Dùng lại ảnh này'"
                :loading="saving && activeId === avatar.id"
                @click="onReuse(avatar.id)"
              >
                <v-icon size="14">mdi-restore</v-icon>
              </v-btn>
              <v-btn
                icon
                size="x-small"
                color="error"
                :title="'Xóa ảnh này'"
                :loading="saving && activeId === avatar.id"
                @click="onDelete(avatar.id)"
              >
                <v-icon size="14">mdi-delete</v-icon>
              </v-btn>
            </div>
          </div>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import type { AvatarItem } from '@/composables/use-profile';

defineProps<{
  avatars: AvatarItem[];
  loading: boolean;
  saving: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: 'reuse', avatarId: string): void;
  (e: 'delete', avatarId: string): void;
  (e: 'refresh'): void;
}>();

const activeId = ref('');

function onReuse(id: string) {
  activeId.value = id;
  emit('reuse', id);
}

function onDelete(id: string) {
  activeId.value = id;
  emit('delete', id);
}
</script>

<style scoped>
.avatar-card {
  position: relative;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.avatar-actions {
  background: rgba(0, 0, 0, 0.6);
}
</style>
