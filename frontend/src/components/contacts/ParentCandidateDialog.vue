<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div v-if="modelValue" class="pc-overlay" @click.self="close">
    <div class="pc-dialog">
      <div class="pc-header">
        <h3>💡 Gợi ý gắn KH Cha</h3>
        <button class="pc-close" @click="close">×</button>
      </div>
      <div class="pc-body">
        <div v-if="loading" class="pc-empty">Đang tải…</div>
        <div v-else-if="candidates.length === 0" class="pc-empty">
          Không còn gợi ý nào. Detector cron chạy 02:30 UTC daily — quay lại sau.
        </div>
        <div v-else class="pc-list">
          <div v-for="c in candidates" :key="c.id" class="pc-card">
            <div class="pc-card-head">
              <span class="pc-match">{{ matchLabel(c.matchType) }}</span>
              <span class="pc-conf">confidence {{ (c.confidence * 100).toFixed(0) }}%</span>
            </div>
            <div class="pc-contacts">
              <label v-for="ct in c.contacts" :key="ct.id" class="pc-radio">
                <input type="radio" :name="'parent-' + c.id" :value="ct.id" v-model="selected[c.id]" />
                <Avatar :src="ct.avatarUrl" :name="ct.fullName || '?'" :size="28" :gradient-seed="ct.id" />
                <div class="pc-info">
                  <div class="pc-name">{{ ct.fullName || '— chưa đặt —' }}</div>
                  <div class="pc-meta">
                    <span v-if="ct.phone">📞 {{ ct.phone }}</span>
                    <span v-if="ct.zaloUid">UID: {{ ct.zaloUid }}</span>
                  </div>
                </div>
              </label>
            </div>
            <div class="pc-actions">
              <button class="btn" @click="dismiss(c.id)">Bỏ qua</button>
              <button class="btn btn-primary" :disabled="!selected[c.id]" @click="accept(c.id, selected[c.id])">
                Duyệt — gắn KH Con vào Cha đã chọn
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { api } from '@/api';
import Avatar from '@/components/ui/Avatar.vue';
import { useToast } from '@/composables/use-toast';

interface CandidateContact {
  id: string;
  fullName: string | null;
  phone: string | null;
  zaloUid: string | null;
  zaloGlobalId: string | null;
  avatarUrl: string | null;
  parentContactId: string | null;
}
interface Candidate {
  id: string;
  matchType: string;
  confidence: number;
  contactIds: string[];
  contacts: CandidateContact[];
}

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [boolean]; resolved: [] }>();

const candidates = ref<Candidate[]>([]);
const loading = ref(false);
const selected = ref<Record<string, string>>({});
const toast = useToast();

watch(() => props.modelValue, async (open) => {
  if (open) await load();
});

async function load() {
  loading.value = true;
  try {
    const res = await api.get<{ candidates: Candidate[] }>('/contacts/parent-candidates');
    candidates.value = res.data.candidates || [];
    // Default chọn contact đầu tiên trong mỗi cụm làm parent gợi ý
    for (const c of candidates.value) {
      if (!selected.value[c.id] && c.contactIds.length > 0) {
        selected.value[c.id] = c.contactIds[0];
      }
    }
  } catch (err) {
    console.error('[parent-candidate] load error:', err);
    toast.error('Không tải được gợi ý');
  } finally {
    loading.value = false;
  }
}

async function accept(candidateId: string, parentContactId: string) {
  try {
    const res = await api.post<{ accepted: boolean; childrenCount: number }>(
      `/contacts/parent-candidates/${candidateId}/accept`,
      { parentContactId },
    );
    toast.success(`Đã gắn ${res.data.childrenCount} KH con vào Cha`);
    candidates.value = candidates.value.filter(c => c.id !== candidateId);
    emit('resolved');
  } catch (err) {
    console.error('[parent-candidate] accept error:', err);
    toast.error('Duyệt thất bại');
  }
}

async function dismiss(candidateId: string) {
  try {
    await api.post(`/contacts/parent-candidates/${candidateId}/dismiss`);
    candidates.value = candidates.value.filter(c => c.id !== candidateId);
    emit('resolved');
  } catch (err) {
    console.error('[parent-candidate] dismiss error:', err);
    toast.error('Bỏ qua thất bại');
  }
}

function matchLabel(t: string): string {
  if (t === 'name_phone') return '🔗 Cùng tên + cùng SĐT';
  if (t === 'name_birthDate') return '🎂 Cùng tên + cùng ngày sinh';
  if (t === 'name_email') return '✉️ Cùng tên + cùng email';
  return t;
}

function close() { emit('update:modelValue', false); }
</script>

<style scoped>
.pc-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 1100; display: flex; align-items: center; justify-content: center; }
.pc-dialog { background: var(--smax-bg); border-radius: 12px; max-width: 720px; width: 90vw; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column; }
.pc-header { padding: 16px 20px; border-bottom: 1px solid var(--smax-grey-200); display: flex; justify-content: space-between; align-items: center; }
.pc-header h3 { margin: 0; font-size: 16px; }
.pc-close { background: none; border: none; font-size: 24px; cursor: pointer; color: var(--smax-grey-600); }
.pc-body { padding: 16px 20px; overflow-y: auto; }
.pc-empty { text-align: center; padding: 40px 0; color: var(--smax-grey-600); }
.pc-list { display: flex; flex-direction: column; gap: 16px; }
.pc-card { border: 1px solid var(--smax-grey-200); border-radius: 8px; padding: 12px; }
.pc-card-head { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 12px; color: var(--smax-grey-600); }
.pc-match { font-weight: 600; }
.pc-contacts { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; }
.pc-radio { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 6px; cursor: pointer; }
.pc-radio:hover { background: rgba(0,0,0,0.03); }
.pc-info { flex: 1; }
.pc-name { font-weight: 500; font-size: 13px; }
.pc-meta { font-size: 11px; color: var(--smax-grey-600); display: flex; gap: 10px; }
.pc-actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>
