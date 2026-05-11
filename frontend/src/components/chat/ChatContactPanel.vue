<template>
  <aside class="info-panel">
    <!-- Header: avatar + ID + care-status -->
    <header class="ip-header">
      <button class="ip-close" title="Đóng" @click="$emit('close')">×</button>
      <div class="ip-avatar-big">
        {{ initials }}
        <div v-if="props.contact?.gender" class="gender-badge-big" :class="genderClass">
          {{ genderSymbol }}
        </div>
      </div>
      <div v-if="props.contact?.zaloUid" class="ip-id">UID: {{ props.contact.zaloUid }}</div>
      <div class="ip-care-row">
        <button class="care-status-select" @click="onCycleCareStatus">
          {{ careStatusLabel }} ▾
        </button>
      </div>
    </header>

    <!-- Inline form: 9 rows -->
    <section class="ip-form">
      <div class="ip-form-row">
        <span class="ip-icon">👤</span>
        <span class="ip-label">Tên Zalo</span>
        <input v-model="form.fullName" placeholder="Tên Zalo cung cấp" @blur="saveContact" />
      </div>
      <div class="ip-form-row">
        <span class="ip-icon">✏</span>
        <span class="ip-label">Tên Alias</span>
        <input v-model="form.crmName" placeholder="Sale tự đặt" @blur="saveContact" />
      </div>
      <div class="ip-form-row">
        <span class="ip-icon">📅</span>
        <span class="ip-label">Ngày sinh</span>
        <input type="date" v-model="form.birthDate" @blur="saveContact" />
      </div>
      <div class="ip-form-row">
        <span class="ip-icon">⚧</span>
        <span class="ip-label">Giới tính</span>
        <select v-model="form.gender" @change="saveContact">
          <option :value="null">Không rõ</option>
          <option value="female">Nữ</option>
          <option value="male">Nam</option>
          <option value="other">Khác</option>
        </select>
      </div>

      <div class="ip-form-row">
        <span class="ip-icon">📞</span>
        <span class="ip-label">SĐT</span>
        <div class="phone-cell">
          <input v-model="form.phone" placeholder="SĐT chính" @blur="saveContact" />
          <button class="show-extra-phones" @click="showExtraPhones = !showExtraPhones">
            {{ showExtraPhones ? '−' : '+' }} {{ filledExtras }}/2
          </button>
        </div>
      </div>
      <template v-if="showExtraPhones">
        <div class="ip-form-row sub">
          <span class="ip-label">SĐT 2</span>
          <input v-model="form.phone2" placeholder="SĐT phụ 1" @blur="saveContact" />
        </div>
        <div class="ip-form-row sub">
          <span class="ip-label">SĐT 3</span>
          <input v-model="form.phone3" placeholder="SĐT phụ 2" @blur="saveContact" />
        </div>
      </template>

      <div class="ip-form-row">
        <span class="ip-icon">✉</span>
        <span class="ip-label">Email</span>
        <input v-model="form.email" placeholder="email@example.com" @blur="saveContact" />
      </div>
      <div class="ip-form-row">
        <span class="ip-icon">📍</span>
        <span class="ip-label">Địa chỉ</span>
        <input v-model="form.addressLine" placeholder="Địa chỉ chi tiết" @blur="saveContact" />
      </div>
      <div class="ip-form-row">
        <span class="ip-icon">💼</span>
        <span class="ip-label">Nghề</span>
        <input v-model="form.occupation" placeholder="Nghề nghiệp" @blur="saveContact" />
      </div>

      <v-alert v-if="saveSuccess" type="success" density="compact" class="mt-2 mx-3" closable
        @click:close="saveSuccess = false">
        Đã lưu thành công!
      </v-alert>
      <v-alert v-if="saveError" type="error" density="compact" class="mt-2 mx-3" closable
        @click:close="saveError = false">
        Lưu thất bại, thử lại.
      </v-alert>
    </section>

    <!-- Lead score + last activity (compute từ Contact) -->
    <section v-if="props.contact" class="ip-section">
      <div class="ip-section-title">
        <span class="accent" style="background: var(--smax-success)" />
        ⭐ Lead score
      </div>
      <div class="metrics-row">
        <span class="metric-num">{{ props.contact.leadScore ?? 0 }}</span>
        <span class="metric-label">điểm</span>
        <span v-if="props.contact.lastActivity" class="metric-aux">
          · cập nhật {{ relativeTime(props.contact.lastActivity) }}
        </span>
      </div>
    </section>

    <!-- Tag CRM hệ thống (cấp KH) -->
    <section class="ip-section">
      <div class="ip-section-title">
        <span class="accent" style="background: var(--smax-info)" />
        🏷 Tag CRM hệ thống
        <span class="scope-tag global">cấp KH</span>
      </div>
      <div class="tag-list">
        <span v-for="tag in form.tags" :key="tag" class="tag-chip">
          {{ tag }}
          <span class="x" @click="removeTag(tag)">×</span>
        </span>
        <input
          v-if="addingTag"
          v-model="newTag"
          ref="newTagInput"
          class="tag-input"
          placeholder="Tag mới…"
          @keydown.enter="confirmAddTag"
          @blur="confirmAddTag"
        />
        <button v-else class="tag-chip add" @click="startAddTag">+ Thêm</button>
      </div>
    </section>

    <!-- AI Summary + Sentiment -->
    <section v-if="aiSummary || aiSummaryLoading" class="ip-section">
      <div class="ip-section-title">
        <span class="accent" style="background: #9c27b0" />
        ✨ AI Tóm tắt
        <button class="refresh-mini" :disabled="aiSummaryLoading" @click="$emit('refresh-ai-summary')">↻</button>
      </div>
      <AiSummaryCard :summary="aiSummary" :loading="aiSummaryLoading" />
    </section>

    <section v-if="aiSentiment || aiSentimentLoading" class="ip-section">
      <div class="ip-section-title">
        <span class="accent" style="background: #ec407a" />
        💗 Cảm xúc khách hàng
        <button class="refresh-mini" :disabled="aiSentimentLoading" @click="$emit('refresh-ai-sentiment')">↻</button>
      </div>
      <AiSentimentBadge :sentiment="aiSentiment" />
      <div v-if="aiSentiment?.reason" class="text-body-2 mt-2 px-1">{{ aiSentiment.reason }}</div>
    </section>

    <!-- Automation cards (per-nick — backend chưa có schema, ẩn nếu rỗng) -->
    <AutomationCardList :cards="automationCards" @action="onAutomationAction" @attach="onAttachAutomation" />

    <!-- Lịch hẹn -->
    <ChatAppointments
      v-if="props.contactId"
      :contact-id="props.contactId"
      :appointments="contactAppointments"
      @refresh="reloadAppointments"
    />
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, nextTick } from 'vue';
import type { Contact } from '@/composables/use-contacts';
import type { AiSentiment } from '@/composables/use-chat';
import { useChatContactPanel } from '@/composables/use-chat-contact-panel';
import ChatAppointments from './ChatAppointments.vue';
import AiSummaryCard from '@/components/ai/ai-summary-card.vue';
import AiSentimentBadge from '@/components/ai/ai-sentiment-badge.vue';
import AutomationCardList, { type AutomationCard } from './AutomationCardList.vue';

const props = defineProps<{
  contactId: string | null;
  contact: Contact | null;
  aiSummary: string;
  aiSummaryLoading: boolean;
  aiSentiment: AiSentiment | null;
  aiSentimentLoading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  'refresh-ai-summary': [];
  'refresh-ai-sentiment': [];
}>();

const {
  form, saveSuccess, saveError,
  contactAppointments,
  saveContact, reloadAppointments,
} = useChatContactPanel(
  () => props.contactId,
  () => props.contact,
  () => emit('saved'),
);

// ════════ Care status (status field — cycle through preset) ════════
const CARE_STATUSES = [
  { value: 'new',          label: '🆕 Mới' },
  { value: 'interested',   label: '💬 Quan tâm' },
  { value: 'caring',       label: '🤝 Chăm sóc' },
  { value: 'negotiating',  label: '⚡ Đàm phán giá' },
  { value: 'hot',          label: '🔥 Nóng' },
  { value: 'cold',         label: '❄ Lạnh' },
  { value: 'won',          label: '✅ Đã chốt' },
];
const careStatusLabel = computed(() => {
  const found = CARE_STATUSES.find(s => s.value === form.status);
  return found?.label || '🆕 Đặt trạng thái';
});
function onCycleCareStatus() {
  const idx = CARE_STATUSES.findIndex(s => s.value === form.status);
  const next = CARE_STATUSES[(idx + 1) % CARE_STATUSES.length];
  form.status = next.value;
  saveContact();
}

// ════════ Avatar + gender ════════
const initials = computed(() => {
  const name = props.contact?.fullName || props.contact?.crmName || '?';
  const parts = name.trim().split(/\s+/);
  return (parts[parts.length - 1]?.[0] || '').toUpperCase()
    + (parts.length > 1 ? (parts[parts.length - 2]?.[0] || '').toUpperCase() : '');
});
const genderSymbol = computed(() =>
  form.gender === 'female' ? '♀' : form.gender === 'male' ? '♂' : '',
);
const genderClass = computed(() =>
  form.gender === 'female' ? 'smax-gender-female' : 'smax-gender-male',
);

// ════════ Phones extras ════════
const showExtraPhones = ref(false);
const filledExtras = computed(() => [form.phone2, form.phone3].filter(Boolean).length);

// ════════ Tag list ════════
const addingTag = ref(false);
const newTag = ref('');
const newTagInput = ref<HTMLInputElement | null>(null);
function startAddTag() {
  addingTag.value = true;
  nextTick(() => newTagInput.value?.focus());
}
function confirmAddTag() {
  const t = newTag.value.trim();
  if (t && !form.tags.includes(t)) {
    form.tags.push(t);
    saveContact();
  }
  newTag.value = '';
  addingTag.value = false;
}
function removeTag(tag: string) {
  form.tags = form.tags.filter(t => t !== tag);
  saveContact();
}

// ════════ Automation cards (placeholder — chờ backend) ════════
const automationCards = computed<AutomationCard[]>(() => {
  // Khi backend bổ sung endpoint /contacts/:id/automations sẽ map vào đây.
  // Tạm thời ẩn (allowEmpty=false) — section sẽ không hiện.
  return [];
});
function onAutomationAction(_id: string, _kind: string) { /* TODO wire to API */ }
function onAttachAutomation() { /* TODO open dialog chọn template automation */ }

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  return `${days} ngày trước`;
}
</script>

<style scoped>
.info-panel {
  background: var(--smax-bg);
  border-left: 1px solid var(--smax-grey-200);
  display: flex; flex-direction: column;
  height: 100%; overflow-y: auto;
  flex-shrink: 0;
}

/* ════════ Header ════════ */
.ip-header {
  padding: 17px 17px 11px;
  text-align: center;
  border-bottom: 1px solid var(--smax-grey-200);
  position: relative;
}
.ip-close {
  position: absolute; top: 9px; right: 11px;
  width: 28px; height: 28px;
  background: transparent; border: none;
  font-size: 22px; cursor: pointer;
  color: var(--smax-grey-700);
  border-radius: 50%;
}
.ip-close:hover { background: var(--smax-grey-100); }

.ip-avatar-big {
  width: 65px; height: 65px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ff7043, #bf360c);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 24px;
  margin: 0 auto;
  position: relative;
}
.gender-badge-big {
  position: absolute; bottom: 0; right: -4px;
  width: 24px; height: 24px;
  border-radius: 50%;
  border: 3px solid var(--smax-bg);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 12px;
}
.smax-gender-female { background: var(--smax-female); }
.smax-gender-male   { background: var(--smax-male); }

.ip-id {
  font-size: 11px;
  color: var(--smax-grey-700);
  margin-top: 7px;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  word-break: break-all;
}
.ip-care-row { margin-top: 9px; }
.care-status-select {
  background: rgba(255,145,0,0.15);
  color: #ef6c00;
  border: 1px solid rgba(255,145,0,0.3);
  padding: 5px 11px;
  border-radius: 13px;
  font-size: 12px; font-weight: 500;
  cursor: pointer;
}
.care-status-select:hover { background: rgba(255,145,0,0.22); }

/* ════════ Inline form ════════ */
.ip-form { padding: 4px 0; border-bottom: 1px solid var(--smax-grey-200); }
.ip-form-row {
  display: grid;
  grid-template-columns: 22px 80px 1fr;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-bottom: 1px solid var(--smax-grey-100);
}
.ip-form-row.sub {
  grid-template-columns: 22px 80px 1fr;
  padding-left: 32px;
}
.ip-form-row:last-child { border-bottom: none; }
.ip-icon { font-size: 14px; opacity: 0.85; text-align: center; }
.ip-label { font-size: 12px; color: var(--smax-grey-700); }
.ip-form-row input,
.ip-form-row select {
  border: none; outline: none;
  font-size: 13px;
  background: transparent;
  width: 100%; min-width: 0;
  padding: 3px 4px;
  border-radius: 4px;
  font-family: inherit;
  color: var(--smax-text);
}
.ip-form-row input:hover,
.ip-form-row select:hover { background: var(--smax-grey-50); }
.ip-form-row input:focus,
.ip-form-row select:focus { background: var(--smax-primary-soft); }
.phone-cell {
  display: flex; align-items: center; gap: 5px;
  width: 100%;
}
.phone-cell input { flex: 1; }
.show-extra-phones {
  background: var(--smax-grey-100);
  border: 1px solid var(--smax-grey-300);
  border-radius: 9px;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--smax-grey-700);
  cursor: pointer;
  flex-shrink: 0;
}
.show-extra-phones:hover { background: var(--smax-primary-soft); color: var(--smax-primary); }

/* ════════ Section ════════ */
.ip-section {
  padding: 11px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.ip-section-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600;
  color: var(--smax-text);
  margin-bottom: 7px;
}
.ip-section-title .accent {
  width: 3px; height: 14px;
  border-radius: 2px;
  background: var(--smax-grey-300);
}
.scope-tag {
  font-size: 10px; padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500; letter-spacing: 0.3px;
}
.scope-tag.global {
  background: rgba(33,150,243,0.12);
  color: #1565c0;
}
.refresh-mini {
  margin-left: auto;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1px solid var(--smax-grey-300);
  background: var(--smax-bg);
  cursor: pointer;
  font-size: 12px; color: var(--smax-grey-700);
}
.refresh-mini:hover:not(:disabled) { background: var(--smax-grey-50); color: var(--smax-primary); }
.refresh-mini:disabled { opacity: 0.5; cursor: not-allowed; }

.tag-list {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.tag-chip {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  padding: 3px 7px;
  border-radius: 7px;
  font-size: 11px;
  display: inline-flex; align-items: center; gap: 4px;
  cursor: default;
}
.tag-chip .x {
  cursor: pointer;
  opacity: 0.55;
  font-weight: 700;
}
.tag-chip .x:hover { opacity: 1; color: var(--smax-error); }
.tag-chip.add {
  background: transparent;
  border: 1px dashed var(--smax-grey-300);
  cursor: pointer;
  color: var(--smax-grey-700);
}
.tag-chip.add:hover { background: var(--smax-grey-50); border-color: var(--smax-primary); color: var(--smax-primary); }
.tag-input {
  border: 1px solid var(--smax-primary);
  outline: none;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 11px;
  width: 110px;
  font-family: inherit;
}

.metrics-row {
  display: flex; align-items: baseline; gap: 5px;
  font-size: 13px;
}
.metric-num { font-size: 24px; font-weight: 700; color: var(--smax-success); }
.metric-label { color: var(--smax-grey-700); }
.metric-aux  { color: var(--smax-grey-700); font-size: 12px; }
</style>
