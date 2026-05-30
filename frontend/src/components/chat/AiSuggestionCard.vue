<template>
  <!-- M53 2026-05-30: AI suggestion card — hiện dưới bubble AI nếu có entities.
       Sale tick từng field rồi bấm Áp dụng. Default UN-checked tránh AI hallucinate. -->
  <div class="ai-suggest-card">
    <div class="ai-suggest-header">
      <div class="ai-suggest-title">💡 Em đề xuất cập nhật thông tin KH</div>
      <span v-if="confidencePercent !== null" class="confidence-badge">
        Độ tin cậy {{ confidencePercent }}%
      </span>
    </div>

    <table class="suggest-table">
      <tr v-for="row in rows" :key="row.field">
        <td>
          <input
            type="checkbox"
            v-model="checked[row.field]"
            :disabled="applying || row.isExisting"
            :title="row.isExisting ? 'KH đã có giá trị này — không cần cập nhật' : ''"
          />
        </td>
        <td class="field-label">{{ row.label }}</td>
        <td class="field-value">
          <span v-if="row.isExisting" class="existing-pill">✓ Đã có</span>
          {{ row.displayValue }}
        </td>
      </tr>
      <tr v-if="!rows.length">
        <td colspan="3" class="empty-row">Không có thông tin để gợi ý</td>
      </tr>
    </table>

    <div class="suggest-actions">
      <button class="btn-skip" :disabled="applying" @click="onSkip">✗ Bỏ qua</button>
      <button
        class="btn-apply"
        :disabled="!hasChecked || applying"
        @click="onApply"
      >
        <span v-if="applying">⏳ Đang áp dụng...</span>
        <span v-else>✓ Áp dụng ({{ checkedCount }} chọn)</span>
      </button>
    </div>

    <div v-if="errorMessage" class="error-row">{{ errorMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import { api } from '@/api/index';

interface PropertyNeed {
  type?: string;
  budgetMin?: number;
  budgetMax?: number;
  purpose?: string;
  decisionTimeline?: string;
  area?: string;
}

interface Entities {
  fullName?: string;
  gender?: 'M' | 'F' | null;
  birthYear?: number;
  occupation?: string;
  incomeRange?: string | null;
  province?: string;
  district?: string;
  ward?: string;
  propertyNeed?: PropertyNeed;
  leadSource?: string;
  tags?: string[];
  confidenceScore?: number;
  missingFields?: string[];
}

const props = defineProps<{
  entities: Entities | Record<string, unknown>;
  contactId: string;
  messageId: string;
  existingContact?: Record<string, unknown> | null;
}>();

const emit = defineEmits<{
  applied: [acceptedFields: Array<{ field: string; value: unknown }>];
}>();

const entities = computed(() => props.entities as Entities);

const confidencePercent = computed(() => {
  const s = entities.value.confidenceScore;
  return typeof s === 'number' ? Math.round(s * 100) : null;
});

const PROPERTY_TYPE_LABEL: Record<string, string> = {
  '1PN': 'Căn 1PN',
  '2PN': 'Căn 2PN',
  '3PN': 'Căn 3PN',
  biet_thu: 'Biệt thự',
  nha_pho: 'Nhà phố',
  shophouse: 'Shophouse',
};
const PROPERTY_PURPOSE_LABEL: Record<string, string> = {
  o_lien: 'Ở liền',
  dau_tu: 'Đầu tư',
  vua_o_vua_thue: 'Vừa ở vừa cho thuê',
};
const TIMELINE_LABEL: Record<string, string> = {
  '1_thang': '1 tháng',
  '3_thang': '3 tháng',
  '6_thang': '6 tháng',
  chua_ro: 'Chưa rõ',
};
const LEAD_SOURCE_LABEL: Record<string, string> = {
  facebook: 'Facebook',
  zalo: 'Zalo',
  gioi_thieu: 'Giới thiệu',
  hotline: 'Hotline',
  website: 'Website',
  khac: 'Khác',
};
const INCOME_LABEL: Record<string, string> = {
  '0-10': '0-10 triệu',
  '10-20': '10-20 triệu',
  '20-50': '20-50 triệu',
  '50+': '50 triệu+',
};

interface SuggestionRow {
  field: string;
  label: string;
  value: unknown;
  displayValue: string;
  isExisting: boolean;
}

const rows = computed<SuggestionRow[]>(() => {
  const e = entities.value;
  const existing = props.existingContact ?? {};
  const result: SuggestionRow[] = [];

  const add = (field: string, label: string, value: unknown, display?: string) => {
    if (value === undefined || value === null || value === '') return;
    const isExisting = Boolean((existing as Record<string, unknown>)[field]);
    result.push({
      field,
      label,
      value,
      displayValue: display ?? String(value),
      isExisting,
    });
  };

  if (e.fullName) add('fullName', 'Họ tên', e.fullName);
  if (e.gender === 'M') add('gender', 'Giới tính', 'male', 'Nam (Anh)');
  if (e.gender === 'F') add('gender', 'Giới tính', 'female', 'Nữ (Chị)');
  if (e.birthYear) {
    const age = new Date().getFullYear() - e.birthYear;
    add('birthYear', 'Năm sinh', e.birthYear, `${e.birthYear} (${age} tuổi)`);
  }
  if (e.occupation) add('occupation', 'Nghề nghiệp', e.occupation);
  if (e.incomeRange) add('incomeRange', 'Thu nhập', e.incomeRange, INCOME_LABEL[e.incomeRange] ?? e.incomeRange);
  if (e.province) add('province', 'Tỉnh/TP', e.province);
  if (e.district) add('district', 'Quận/Huyện', e.district);
  if (e.ward) add('ward', 'Phường/Xã', e.ward);
  if (e.leadSource) add('source', 'Nguồn lead', e.leadSource, LEAD_SOURCE_LABEL[e.leadSource] ?? e.leadSource);

  // propertyNeed — render summary nhưng KHÔNG có field mapping 1-1 → readonly
  if (e.propertyNeed) {
    const pn = e.propertyNeed;
    const parts: string[] = [];
    if (pn.type) parts.push(PROPERTY_TYPE_LABEL[pn.type] ?? pn.type);
    if (pn.budgetMin || pn.budgetMax) {
      const b = pn.budgetMax ? `${pn.budgetMin}-${pn.budgetMax} tỷ` : `${pn.budgetMin} tỷ`;
      parts.push(b);
    }
    if (pn.purpose) parts.push(PROPERTY_PURPOSE_LABEL[pn.purpose] ?? pn.purpose);
    if (pn.area) parts.push(`tại ${pn.area}`);
    if (pn.decisionTimeline) parts.push(`(quyết định ${TIMELINE_LABEL[pn.decisionTimeline] ?? pn.decisionTimeline})`);
    if (parts.length > 0) {
      // Property need lưu vào notes — chưa map field riêng, hiện info-only
      result.push({
        field: '_propertyNeed_info',
        label: 'Nhu cầu (chỉ xem)',
        value: parts.join(' '),
        displayValue: parts.join(' '),
        isExisting: true, // disable checkbox
      });
    }
  }

  return result;
});

const checked = reactive<Record<string, boolean>>({});

const checkedCount = computed(() => Object.values(checked).filter(Boolean).length);
const hasChecked = computed(() => checkedCount.value > 0);

const applying = ref(false);
const errorMessage = ref<string | null>(null);
const collapsed = ref(false);

async function onApply() {
  if (!hasChecked.value || applying.value) return;
  applying.value = true;
  errorMessage.value = null;
  try {
    const acceptedFields = rows.value
      .filter((r) => checked[r.field] && r.field !== '_propertyNeed_info')
      .map((r) => ({ field: r.field, value: r.value }));

    await api.patch(`/contacts/${props.contactId}/apply-ai-suggestion`, {
      messageId: props.messageId,
      acceptedFields,
    });
    emit('applied', acceptedFields);
    collapsed.value = true;
    // Reset checked
    for (const k of Object.keys(checked)) checked[k] = false;
  } catch (e: any) {
    errorMessage.value = e?.response?.data?.error || e?.message || 'Lỗi áp dụng';
  } finally {
    applying.value = false;
  }
}

function onSkip() {
  // Just collapse for now — TODO: log rejected to BE for AI tuning
  collapsed.value = true;
  for (const k of Object.keys(checked)) checked[k] = false;
}
</script>

<style scoped>
.ai-suggest-card {
  margin-top: 6px;
  background: #fff;
  border: 1px solid #c7d2fe;
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.1);
}
.ai-suggest-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px dashed #e0e7ff;
}
.ai-suggest-title {
  font-weight: 600;
  color: #4338ca;
}
.confidence-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #dcfce7;
  color: #166534;
  font-weight: 600;
}
.suggest-table {
  width: 100%;
  border-collapse: collapse;
}
.suggest-table tr { border-bottom: 1px solid #f1f5f9; }
.suggest-table tr:last-child { border-bottom: none; }
.suggest-table td { padding: 5px 4px; vertical-align: middle; }
.suggest-table td:first-child { width: 22px; }
.field-label { color: #64748b; width: 110px; font-size: 11px; }
.field-value { font-weight: 500; color: #1f2937; }
.existing-pill {
  display: inline-block;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 6px;
  background: #f1f5f9;
  color: #64748b;
  margin-right: 6px;
}
.empty-row {
  color: #94a3b8;
  text-align: center;
  font-style: italic;
  padding: 12px !important;
}
.suggest-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px dashed #e0e7ff;
  justify-content: flex-end;
}
.btn-apply {
  padding: 5px 12px;
  border-radius: 6px;
  border: none;
  background: #6366f1;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.btn-apply:disabled {
  background: #c7d2fe;
  cursor: not-allowed;
}
.btn-skip {
  padding: 5px 12px;
  border-radius: 6px;
  background: #fff;
  color: #64748b;
  font-size: 12px;
  border: 1px solid #e2e8f0;
  cursor: pointer;
}
.error-row {
  margin-top: 6px;
  padding: 4px 8px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 4px;
  font-size: 11px;
}
</style>
