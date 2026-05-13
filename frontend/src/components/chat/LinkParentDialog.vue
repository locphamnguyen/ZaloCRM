<template>
  <v-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" max-width="500">
    <v-card>
      <v-card-title>🔗 Gắn KH này vào KH Cha (merge: KH hiện tại sẽ trở thành Friend của Cha)</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="search"
          label="Tìm KH Cha theo tên hoặc SĐT"
          prepend-inner-icon="mdi-magnify"
          variant="outlined"
          density="compact"
          autofocus
          @input="onSearch"
        />
        <div v-if="loading" class="text-center pa-3">Đang tìm…</div>
        <div v-else-if="results.length === 0 && search.length > 1" class="text-center pa-3 text-grey">
          Không tìm thấy KH nào
        </div>
        <div v-else class="result-list">
          <div
            v-for="r in results"
            :key="r.id"
            class="result-row"
            :class="{ selected: selectedId === r.id }"
            @click="selectedId = r.id"
          >
            <Avatar :src="r.avatarUrl" :name="r.fullName || '?'" :size="32" :gradient-seed="r.id" />
            <div class="info">
              <div class="name">{{ r.fullName || '— chưa đặt —' }}</div>
              <div class="meta">
                <span v-if="r.phone">📞 {{ r.phone }}</span>
                <span v-if="r.childrenCount && r.childrenCount > 0">👥 {{ r.childrenCount }} con</span>
              </div>
            </div>
          </div>
        </div>
        <v-alert v-if="error" type="error" density="compact" class="mt-3">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="close">Hủy</v-btn>
        <v-btn color="primary" :disabled="!selectedId" :loading="submitting" @click="submit">Gắn</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { api } from '@/api';
import Avatar from '@/components/ui/Avatar.vue';

interface Candidate {
  id: string;
  fullName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  childrenCount?: number;
}

const props = defineProps<{ modelValue: boolean; childContactId: string }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; linked: [string] }>();

const search = ref('');
const results = ref<Candidate[]>([]);
const loading = ref(false);
const selectedId = ref<string | null>(null);
const submitting = ref(false);
const error = ref('');
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  selectedId.value = null;
  if (search.value.trim().length < 2) { results.value = []; return; }
  searchTimer = setTimeout(async () => {
    loading.value = true;
    try {
      const res = await api.get<{ contacts: Candidate[] }>('/contacts', {
        params: { search: search.value, limit: 20 },
      });
      // Exclude self + những KH đã là con (parentContactId !== null)
      results.value = (res.data.contacts || []).filter(r => r.id !== props.childContactId);
    } catch (err) {
      console.error('[link-parent] search error:', err);
      results.value = [];
    } finally {
      loading.value = false;
    }
  }, 300);
}

async function submit() {
  if (!selectedId.value) return;
  submitting.value = true;
  error.value = '';
  try {
    await api.post(`/contacts/${props.childContactId}/merge-into`, { parentContactId: selectedId.value });
    emit('linked', selectedId.value);
    close();
  } catch (err) {
    error.value = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Gắn thất bại';
  } finally {
    submitting.value = false;
  }
}

function close() {
  search.value = '';
  results.value = [];
  selectedId.value = null;
  error.value = '';
  emit('update:modelValue', false);
}
</script>

<style scoped>
.result-list { max-height: 320px; overflow-y: auto; border: 1px solid var(--smax-grey-200); border-radius: 6px; }
.result-row { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; border-bottom: 1px solid var(--smax-grey-100); }
.result-row:last-child { border-bottom: none; }
.result-row:hover { background: rgba(0,0,0,0.03); }
.result-row.selected { background: rgba(0,242,255,0.10); }
.info { flex: 1; min-width: 0; }
.name { font-weight: 500; font-size: 13px; }
.meta { display: flex; gap: 10px; font-size: 11px; color: var(--smax-grey-600); }
</style>
