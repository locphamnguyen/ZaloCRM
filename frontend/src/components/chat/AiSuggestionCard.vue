<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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
      <tr
        v-for="row in rows"
        :key="row.field"
        :class="{ 'row-will-overwrite': row.isExisting && checked[row.field] }"
      >
        <td>
          <input
            type="checkbox"
            v-model="checked[row.field]"
            :disabled="applying"
            :title="row.isExisting ? 'KH đã có giá trị này — tick để GHI ĐÈ bằng giá trị AI mới' : 'Tick để áp dụng lên Contact'"
          />
        </td>
        <td class="field-label">{{ row.label }}</td>
        <td class="field-value">
          <span class="value-inline">
            <span v-if="row.isExisting" class="existing-pill">✓ Đã có</span>
            <span v-if="row.isExisting && checked[row.field]" class="overwrite-pill" title="Sẽ ghi đè giá trị cũ">⚠ Sẽ ghi đè</span>
            <span class="value-text">{{ row.displayValue }}</span>
          </span>
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

  // M55.3 2026-05-30: tags AI → row checkable, BE merge với tags hiện có (dedup)
  if (e.tags && Array.isArray(e.tags) && e.tags.length > 0) {
    add('tags', 'Tags', e.tags, e.tags.join(', '));
  }

  // M55.3 2026-05-30: propertyNeed → row checkable, BE lưu vào Contact.metadata.propertyNeed
  // + tóm tắt vào Contact.notes. KHÔNG còn info-only nữa.
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
    if (pn.decisionTimeline) parts.push(`(${TIMELINE_LABEL[pn.decisionTimeline] ?? pn.decisionTimeline})`);
    if (parts.length > 0) {
      result.push({
        field: 'propertyNeed',
        label: 'Nhu cầu BĐS',
        value: pn, // gửi nguyên object cho BE serialize vào metadata
        displayValue: parts.join(' '),
        isExisting: false, // checkable, default UN-checked như field khác
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
      .filter((r) => checked[r.field] && !r.field.startsWith('_'))
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
/* M55.5 2026-05-30 — Airtable-native AI suggestion card
   Tokens: phase7/design-tokens.ts (AT.ink #181d26, hairline #dddddd,
   muted #41454d, body #333840, surfaceSoft #f8fafc, signatureForest tint).
   Anh chốt: text + checkbox to hơn, spacing thoáng, border subtle, font-weight 500. */

.ai-suggest-card {
  margin-top: 8px;
  background: #ffffff;
  border: 1px solid #dddddd;            /* AT.hairline — bỏ indigo */
  border-radius: 10px;                  /* RADIUS.md */
  padding: 12px 14px;                   /* M55.10: 16x18 → 12x14 (-25%) cùng nhịp với row -15% */
  font-size: 13px;                      /* M55.10: 14→13px (-1 size) anh chốt */
  line-height: 1.4;
  color: #333840;                       /* AT.body */
  box-shadow: none;                     /* Airtable: flat */
}

.ai-suggest-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;                   /* M55.10: 12→8px */
  padding-bottom: 8px;                  /* M55.10: 10→8px */
  border-bottom: 1px solid #eeeeee;     /* solid hairline — bỏ dashed indigo */
}
.ai-suggest-title {
  font-size: 14px;                      /* M55.10: 15→14px (-1 size) */
  font-weight: 500;                     /* Airtable: 500, never 600/700 */
  color: #181d26;                       /* AT.ink */
  letter-spacing: 0;
}

.confidence-badge {
  font-size: 10.5px;                    /* M55.10: 11.5→10.5px (-1 size) */
  padding: 2px 9px;
  border-radius: 9999px;                /* RADIUS.pill */
  background: #e3ede4;                  /* AT signatureForest tint */
  color: #0a2e0e;
  font-weight: 500;
  border: 1px solid #c8dccc;
}

/* ── Table ── */
.suggest-table {
  width: 100%;
  border-collapse: collapse;
}
.suggest-table tr {
  border-bottom: 1px solid #f0f1f3;
  transition: background 0.12s ease;
}
.suggest-table tr:last-child { border-bottom: none; }
.suggest-table tr:hover { background: #f8fafc; }   /* AT.surfaceSoft */

.suggest-table td {
  padding: 7px 8px;                     /* M55.10: giảm 10→7px (-15% row height) anh chốt */
  vertical-align: middle;               /* M55.6: căn giữa toàn bộ cells trong row */
  font-size: 13px;                      /* M55.10: 14→13px (-1 size) anh chốt */
  line-height: 1.4;                     /* M55.6: line-height đồng nhất tránh lệch dòng */
}
.suggest-table td:first-child {
  width: 44px;                          /* M55.6: tăng từ 36 để chứa checkbox 22px + padding */
  padding-right: 0;
  text-align: center;                   /* M55.6: checkbox căn giữa cột */
}

/* M55.6 2026-05-30: Checkbox 18→22px (25% bigger) anh chốt — dễ tick + cân với font 14px.
   Vẫn accent-color AT.ink. Align middle với row qua vertical-align kế thừa từ td. */
.suggest-table input[type="checkbox"] {
  width: 22px;
  height: 22px;
  accent-color: #181d26;                /* AT.ink — tick màu đen brand */
  cursor: pointer;
  margin: 0;
  border-radius: 4px;
  vertical-align: middle;               /* M55.6: thẳng hàng với text 14px line-height 1.4 */
  display: inline-block;
}
.suggest-table input[type="checkbox"]:disabled { cursor: not-allowed; opacity: 0.5; }

.field-label {
  width: 140px;                         /* tăng để Vietnamese label không wrap */
  font-size: 13px;                      /* M55.10: 14→13px (-1 size) */
  font-weight: 500;
  color: #41454d;                       /* AT.muted */
  letter-spacing: 0.16px;
  /* M55.6: line-height đồng nhất + vertical align middle */
  line-height: 1.4;
  vertical-align: middle;
}
.field-value {
  font-size: 13px;                      /* M55.10: 14→13px (-1 size) */
  font-weight: 400;                     /* bodyMd — bỏ 500 để không quá đậm */
  color: #181d26;                       /* AT.ink */
  line-height: 1.4;
  vertical-align: middle;
  /* M55.8 2026-05-30: GIỮ td bình thường (display: table-cell), KHÔNG flex trên td
     vì làm bể table layout (label rớt dòng). Dùng span.value-inline bên trong
     để flex align center. */
}
/* M55.8 2026-05-30: inline wrapper flex để pill + text visually center */
.value-inline {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  vertical-align: middle;
}
.value-inline .existing-pill,
.value-inline .overwrite-pill {
  margin-right: 0;                      /* gap đã handle khoảng cách */
}
.value-text {
  /* text giá trị inline với pills */
  line-height: 1.4;
}

/* ── Pills ── */
.existing-pill {
  display: inline-block;
  font-size: 10px;                      /* M55.10: 11→10px (-1 size) */
  padding: 2px 8px;
  border-radius: 9999px;
  background: #f0f1f3;                  /* AT neutral tint */
  color: #41454d;
  margin-right: 8px;
  font-weight: 500;
}
.overwrite-pill {
  display: inline-block;
  font-size: 10px;                      /* M55.10: 11→10px (-1 size) */
  padding: 2px 8px;
  border-radius: 9999px;
  background: #fdf3df;                  /* AT signatureMustard tint */
  color: #7a5818;
  margin-right: 8px;
  font-weight: 500;
  border: 1px solid #f0dca8;
}
.suggest-table tr.row-will-overwrite {
  background: #fdf8e0;                  /* AT yellow tint nhạt */
}

.empty-row {
  color: #9297a0;
  text-align: center;
  font-style: normal;                   /* bỏ italic — Airtable không dùng */
  padding: 18px !important;             /* M55.10: 22→18px */
  font-size: 13px;                      /* M55.10: 14→13px */
}

/* ── Actions ── */
.suggest-actions {
  display: flex;
  gap: 8px;                             /* M55.10: 10→8px */
  margin-top: 10px;                     /* M55.10: 14→10px */
  padding-top: 10px;                    /* M55.10: 12→10px */
  border-top: 1px solid #eeeeee;
  justify-content: flex-end;
}

.btn-apply {
  padding: 7px 15px;                    /* M55.10: 9x18 → 7x15 (-22% size) */
  border-radius: 6px;                   /* RADIUS.sm */
  border: none;
  background: #181d26;                  /* AT.primary — bỏ indigo */
  color: #ffffff;
  font-size: 12px;                      /* M55.10: 13→12px (-1 size) */
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s ease;
}
.btn-apply:hover:not(:disabled) { background: #0d1218; }
.btn-apply:disabled {
  background: #e0e2e6;                  /* AT.surfaceStrong */
  color: #9297a0;
  cursor: not-allowed;
}

.btn-skip {
  padding: 7px 15px;                    /* M55.10: 9x18 → 7x15 */
  border-radius: 6px;
  background: #ffffff;
  color: #181d26;                       /* dark text, không xám */
  font-size: 12px;                      /* M55.10: 13→12px (-1 size) */
  font-weight: 500;
  border: 1px solid #dddddd;            /* AT.hairline */
  cursor: pointer;
  transition: background 0.12s ease;
}
.btn-skip:hover:not(:disabled) { background: #f8fafc; }

.error-row {
  margin-top: 10px;
  padding: 8px 12px;
  background: #fde8e8;
  color: #991b1b;
  border-radius: 6px;
  font-size: 13px;
  border: 1px solid #fbd2d2;
}
</style>
