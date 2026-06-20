<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  SequencePreviewDialog — Xem trước tin nhắn Sequence sẽ gửi cho 1-2 KH (2026-06-18).
  Bong bóng PHÍA NGƯỜI GỬI (sale gửi đi) + GIỜ GỬI cụ thể từng bước (qua ngày ghi rõ mai/ngày)
  + dòng cuối "luồng kết thúc lúc …". Dùng ở: SequencesView + AddFlowModal (nút Xem trước).
  BE render bong bóng SẴN (resolveBlockContent + thay đủ ~36 biến) → preview = đúng tin gửi thật.
  POST /automation/sequences/:id/preview {contactIds:[1-2], nickId?} → steps[].bubbles + sendAt.
-->
<template>
  <div v-if="visible" class="spd-overlay" @click.self="close">
    <div class="spd-modal">
      <!-- Header -->
      <div class="spd-head">
        <div class="spd-title">
          <v-icon size="18" color="#1786be">mdi-eye-outline</v-icon>
          Xem trước luồng <strong>{{ sequenceName }}</strong>
        </div>
        <button class="spd-x" @click="close"><v-icon size="18">mdi-close</v-icon></button>
      </div>

      <!-- Chọn KH (tối đa 2) -->
      <div class="spd-picker">
        <span class="spd-picker-lb">Xem như KH:</span>
        <span v-for="c in selected" :key="c.id" class="spd-chip">
          {{ c.name }}
          <button class="spd-chip-x" @click="removeContact(c.id)"><v-icon size="12">mdi-close</v-icon></button>
        </span>
        <div v-if="selected.length < 2" class="spd-search-wrap">
          <input
            v-model="searchQ"
            class="spd-search"
            placeholder="+ Thêm KH (gõ tên/SĐT)…"
            @input="onSearch"
          />
          <div v-if="searchResults.length" class="spd-search-pop">
            <button v-for="r in searchResults" :key="r.id" class="spd-search-item" @click="addContact(r)">
              {{ r.name }} <span v-if="r.phone" class="spd-muted">· {{ r.phone }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Body -->
      <div class="spd-body">
        <div v-if="loading" class="spd-loading"><v-icon class="spin" size="22">mdi-loading</v-icon> Đang dựng bản xem trước…</div>
        <div v-else-if="error" class="spd-error">{{ error }}</div>
        <div v-else-if="!data || !data.contacts.length" class="spd-empty">Chọn ít nhất 1 khách hàng để xem trước.</div>

        <template v-else>
          <div class="spd-cols" :class="{ two: data.contacts.length === 2 }">
            <div v-for="pc in data.contacts" :key="pc.contactId" class="spd-col">
              <div class="spd-col-head">💬 Sale gửi cho <strong>{{ pc.name }}</strong></div>
              <div class="spd-chat">
                <div v-for="st in pc.steps" :key="st.stepIdx" class="spd-step">
                  <div class="spd-step-time">
                    <v-icon size="12">mdi-clock-outline</v-icon>
                    Bước {{ st.stepIdx + 1 }}/{{ data.sequence.totalSteps }} · gửi {{ formatSendTime(st.sendAt) }}
                  </div>
                  <template v-for="(b, bi) in st.bubbles" :key="bi">
                    <div v-if="b.type === 'text'" class="spd-bubble-text" v-html="bubbleHtml(b)"></div>
                    <template v-else-if="b.type === 'image'">
                      <img :src="b.url" class="spd-bubble-img" alt="" loading="lazy" />
                      <div v-if="b.caption" class="spd-bubble-text">{{ b.caption }}</div>
                    </template>
                    <div v-else-if="b.type === 'video'" class="spd-bubble-file"><v-icon size="14">mdi-play-circle-outline</v-icon> Video{{ b.caption ? ' · ' + b.caption : '' }}</div>
                    <div v-else-if="b.type === 'file'" class="spd-bubble-file"><v-icon size="14">mdi-file-outline</v-icon> {{ b.filename || 'Tệp đính kèm' }}</div>
                    <div v-else-if="b.type === 'album'" class="spd-bubble-file"><v-icon size="14">mdi-image-multiple-outline</v-icon> Album {{ b.items.length }} ảnh</div>
                  </template>
                  <div v-if="!st.bubbles.length" class="spd-bubble-empty">(bước này không gửi tin text)</div>
                </div>
                <div v-if="pc.etaCompleteAt" class="spd-done">
                  <v-icon size="13" color="#157f3c">mdi-flag-checkered</v-icon>
                  Luồng kết thúc lúc <strong>{{ formatSendTime(pc.etaCompleteAt) }}</strong>
                </div>
              </div>
            </div>
          </div>

          <!-- Footer meta -->
          <div class="spd-meta">
            <span><strong>{{ data.sequence.totalSteps }}</strong> bước</span>
            <span v-if="firstEta">· dự kiến xong <strong>{{ formatSendTime(firstEta) }}</strong></span>
            <span>· Giờ gửi <strong>{{ data.sequence.windowLabel }}</strong></span>
            <span v-if="data.sequence.gapLabel !== '—'">· Giãn cách <strong>{{ data.sequence.gapLabel }}</strong></span>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue';
import { api } from '@/api/index';
import { applyRichFormat, plainFormat, type StyleMark } from '@/composables/use-rich-format';

interface PickContact { id: string; name: string; phone?: string }
type Bubble =
  | { type: 'text'; text: string; styles: StyleMark[] }
  | { type: 'image'; url: string; caption: string }
  | { type: 'album'; items: Array<{ url: string; caption: string }> }
  | { type: 'file'; url: string; filename: string; caption: string }
  | { type: 'video'; url: string; thumbnailUrl: string; caption: string };
interface PreviewStep { stepIdx: number; delayMinutes: number; sendAt: string; blockName: string | null; bubbles: Bubble[] }
interface PreviewContact { contactId: string; name: string; steps: PreviewStep[]; etaCompleteAt: string | null }
interface PreviewData { sequence: { id: string; name: string; totalSteps: number; windowLabel: string; gapLabel: string }; contacts: PreviewContact[] }

const props = defineProps<{
  visible: boolean;
  sequenceId: string;
  sequenceName: string;
  initialContacts?: PickContact[]; // 0-2 KH gắn sẵn (vd KH đang chat) → auto xem trước
  nickId?: string;                 // nick đang chat → render {sale}/{crm_*} đúng
}>();
const emit = defineEmits<{ (e: 'close'): void }>();

const selected = ref<PickContact[]>([]);
const data = ref<PreviewData | null>(null);
const loading = ref(false);
const error = ref('');
const searchQ = ref('');
const searchResults = ref<PickContact[]>([]);

const firstEta = computed(() => data.value?.contacts[0]?.etaCompleteAt ?? null);

watch(() => props.visible, (v) => {
  if (v) {
    // Mở từ hội thoại 1 KH → gắn sẵn + xem trước ngay, KHÔNG bắt sale chọn lại (anh chốt).
    selected.value = (props.initialContacts ?? []).slice(0, 2);
    searchQ.value = '';
    searchResults.value = [];
    error.value = '';
    void loadPreview();
  }
}, { immediate: true });

watch(selected, () => { if (props.visible) void loadPreview(); }, { deep: true });

function close(): void { emit('close'); }
function removeContact(id: string): void { selected.value = selected.value.filter((c) => c.id !== id); }
function addContact(c: PickContact): void {
  if (selected.value.length >= 2 || selected.value.some((x) => x.id === c.id)) return;
  selected.value = [...selected.value, c];
  searchQ.value = ''; searchResults.value = [];
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;
function onSearch(): void {
  if (searchTimer) clearTimeout(searchTimer);
  const q = searchQ.value.trim();
  if (q.length < 2) { searchResults.value = []; return; }
  searchTimer = setTimeout(async () => {
    try {
      const r = await api.get('/contacts', { params: { search: q, limit: 8 } });
      const rows = (r.data?.contacts ?? r.data?.items ?? []) as any[];
      searchResults.value = rows.map((x) => ({
        id: x.id,
        name: x.fullName ?? x.crmName ?? x.zaloUsername ?? 'KH',
        phone: x.phoneE164 ?? x.phone ?? undefined,
      }));
    } catch { searchResults.value = []; }
  }, 250);
}

async function loadPreview(): Promise<void> {
  if (!selected.value.length) { data.value = null; return; }
  loading.value = true; error.value = '';
  try {
    const r = await api.post(`/automation/sequences/${props.sequenceId}/preview`, {
      contactIds: selected.value.map((c) => c.id),
      nickId: props.nickId || undefined,
    });
    data.value = r.data as PreviewData;
  } catch (e: any) {
    error.value = e?.response?.data?.message || e?.response?.data?.error || 'Không dựng được bản xem trước.';
    data.value = null;
  } finally {
    loading.value = false;
  }
}

// Bong bóng text đã render SẴN ở BE (đủ biến + style dịch offset) → chỉ áp rich-format thành HTML.
function bubbleHtml(b: Bubble & { type: 'text' }): string {
  return b.styles && b.styles.length > 0 ? applyRichFormat(b.text, b.styles, []) : plainFormat(b.text);
}

// ── Giờ gửi: "11:15 hôm nay" / "08:00 mai" / "08:00 ngày 21/06" ──
function formatSendTime(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diffDays = Math.round((that.getTime() - today.getTime()) / 86400000);
  if (diffDays <= 0) return `${hh} hôm nay`;
  if (diffDays === 1) return `${hh} mai`;
  return `${hh} ngày ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}
</script>

<style scoped>
.spd-overlay { position: fixed; inset: 0; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; z-index: 2000; }
.spd-modal { background: #fff; border-radius: 12px; width: min(760px, 94vw); max-height: 88vh; display: flex; flex-direction: column; box-shadow: 0 12px 40px rgba(0,0,0,.25); }
.spd-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; border-bottom: 1px solid var(--line, #e6e8eb); }
.spd-title { display: flex; align-items: center; gap: 7px; font-size: 15px; }
.spd-x { border: none; background: transparent; cursor: pointer; color: #6b7280; }
.spd-picker { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 18px; border-bottom: 1px solid var(--line, #e6e8eb); }
.spd-picker-lb { font-size: 13px; color: #6b7280; }
.spd-chip { display: inline-flex; align-items: center; gap: 4px; background: #e7f3fb; color: #1786be; border-radius: 14px; padding: 3px 6px 3px 10px; font-size: 13px; font-weight: 500; }
.spd-chip-x { border: none; background: transparent; cursor: pointer; color: #1786be; display: inline-flex; }
.spd-search-wrap { position: relative; }
.spd-search { border: 1px solid var(--line, #d6dade); border-radius: 14px; padding: 4px 12px; font-size: 13px; min-width: 200px; }
.spd-search-pop { position: absolute; top: 110%; left: 0; background: #fff; border: 1px solid var(--line, #e6e8eb); border-radius: 8px; box-shadow: 0 6px 20px rgba(0,0,0,.12); min-width: 240px; max-height: 240px; overflow-y: auto; z-index: 10; }
.spd-search-item { display: block; width: 100%; text-align: left; border: none; background: transparent; padding: 8px 12px; font-size: 13px; cursor: pointer; }
.spd-search-item:hover { background: #f2f6f8; }
.spd-muted { color: #9ca3af; }
.spd-body { padding: 14px 18px; overflow-y: auto; }
.spd-loading, .spd-empty, .spd-error { text-align: center; color: #6b7280; padding: 28px; font-size: 14px; }
.spd-error { color: var(--danger, #de350b); }
.spin { animation: spd-spin 1s linear infinite; }
@keyframes spd-spin { to { transform: rotate(360deg); } }
.spd-cols { display: grid; grid-template-columns: 1fr; gap: 16px; }
.spd-cols.two { grid-template-columns: 1fr 1fr; }
.spd-col-head { font-size: 13px; font-weight: 600; color: #42526e; margin-bottom: 8px; }
.spd-chat { background: #f4f6f8; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 14px; }

/* Mỗi bước: bong bóng dồn về PHẢI (phía người gửi / sale) */
.spd-step { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.spd-step-time { display: flex; align-items: center; gap: 4px; font-size: 11.5px; color: #974f00; font-weight: 500; align-self: flex-end; }
/* Bong bóng gửi đi — xanh nhạt, đuôi bên phải (giống tin mình gửi trên Zalo) */
.spd-bubble-text { background: #cfe9fb; color: #0f2533; border-radius: 12px 12px 3px 12px; padding: 8px 12px; font-size: 13.5px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; max-width: 90%; }
.spd-bubble-img { max-width: 72%; border-radius: 10px; display: block; }
.spd-bubble-file { display: inline-flex; align-items: center; gap: 5px; background: #fff; border: 1px solid var(--line,#e6e8eb); border-radius: 10px; padding: 6px 10px; font-size: 13px; color: #42526e; }
.spd-bubble-empty { font-size: 12px; color: #9ca3af; font-style: italic; align-self: flex-end; }
/* Dòng kết thúc luồng */
.spd-done { align-self: center; display: inline-flex; align-items: center; gap: 5px; margin-top: 4px; padding: 5px 12px; background: #e7f6ec; color: #157f3c; border-radius: 14px; font-size: 12px; font-weight: 500; }
.spd-meta { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--line, #e6e8eb); display: flex; flex-wrap: wrap; gap: 8px; font-size: 12.5px; color: #6b7280; }
</style>
