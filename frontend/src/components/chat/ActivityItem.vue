<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="activity-item" :class="`cat-${item.category || 'system'}`">
    <span class="act-icon" :style="`color: ${categoryColor}`">{{ icon }}</span>
    <div class="act-body">
      <div class="act-text">
        <strong>{{ actionLabel }}</strong>
        <span v-if="detailsLine" class="act-details" v-html="detailsLine"></span>
      </div>

      <!-- Diff view 2-line cho field text dài (customer_update changes object) -->
      <div v-if="diffEntries.length" class="diff-block">
        <div v-for="entry in diffEntries" :key="entry.field" class="diff-entry">
          <span class="diff-field">{{ fieldLabel(entry.field) }}:</span>
          <div class="diff-vals">
            <span v-if="entry.old !== null && entry.old !== ''" class="diff-val old">{{ entry.old }}</span>
            <span v-else class="diff-val null">— trống —</span>
            <span class="diff-arrow">→</span>
            <span v-if="entry.new !== null && entry.new !== ''" class="diff-val new">{{ entry.new }}</span>
            <span v-else class="diff-val null">— trống —</span>
          </div>
        </div>
      </div>

      <!-- Auto-tag change: render chips added/removed với format giống TagCrmBar
           (icon + label + màu tonal + AUTO badge). Read-only, no remove. -->
      <div v-if="autoTagDiff.added.length || autoTagDiff.removed.length" class="autotag-diff">
        <div v-if="autoTagDiff.added.length" class="autotag-row">
          <span class="autotag-arrow added">＋ Gắn:</span>
          <span
            v-for="key in autoTagDiff.added"
            :key="'add-' + key"
            class="autotag-chip"
            :style="{ '--tag-color': autoTagInfo(key).color }"
            :title="autoTagInfo(key).tooltip"
          >
            <span class="autotag-emoji">{{ autoTagInfo(key).icon }}</span>{{ autoTagInfo(key).label }}
          </span>
        </div>
        <div v-if="autoTagDiff.removed.length" class="autotag-row">
          <span class="autotag-arrow removed">− Gỡ:</span>
          <span
            v-for="key in autoTagDiff.removed"
            :key="'rm-' + key"
            class="autotag-chip removed"
            :style="{ '--tag-color': autoTagInfo(key).color }"
            :title="autoTagInfo(key).tooltip"
          >
            <span class="autotag-emoji">{{ autoTagInfo(key).icon }}</span>{{ autoTagInfo(key).label }}
          </span>
        </div>
        <div v-if="autoTagContext" class="autotag-context">{{ autoTagContext }}</div>
      </div>
      <div class="act-meta">
        <v-menu open-on-hover location="bottom start" :open-delay="200" :close-delay="100">
          <template #activator="{ props: actProps }">
            <span v-bind="actProps" class="act-actor" :title="actorTooltip">{{ actorLabel }}</span>
          </template>
          <MentionPopover
            :actor-type="item.actorType"
            :user="item.user"
            :bot-name="item.botName"
            :system-source="item.systemSource"
          />
        </v-menu>
        <span class="act-sep">·</span>
        <time class="act-time" :title="absTime">{{ relTime }}</time>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { ActivityLogItem } from '@/composables/use-timeline';
import { formatInOrgTz, getOrgParts } from '@/composables/use-org-timezone';
import { CATEGORY_META, ACTION_META, categoryOf, type ActivityCategory } from '@/constants/activity-types';
import { CARE_STATUSES } from '@/constants/care-status';
import { getAutoTagDef } from '@/constants/auto-tags';
import { loadTagDefs, findTagDef, isZaloManaged, cleanTagName, tagColor as lookupTagColor } from '@/composables/use-crm-tag-defs';
import MentionPopover from './MentionPopover.vue';

// Ensure CrmTag defs loaded — module-level cache, only fetches once.
void loadTagDefs();

/* Care status meta map: code → { label VN, color hex từ chip class } */
const CHIP_TO_HEX: Record<string, string> = {
  'chip-grey':    '#6B7280',
  'chip-cyan':    '#00838F',
  'chip-info':    '#1976D2',
  'chip-purple':  '#7B1FA2',
  'chip-warning': '#F57C00',
  'chip-error':   '#C62828',
  'chip-success': '#2E7D32',
};
function statusMeta(code: string): { label: string; color: string } | null {
  const s = CARE_STATUSES.find(x => x.value === code);
  if (!s) return null;
  return { label: s.label, color: CHIP_TO_HEX[s.chip] || '#6B7280' };
}
function escape(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}

/* Render tag chip HTML — match TagCrmBar.tag-pill style (Zalo monochromatic / CRM tinted).
 * forceZalo=true cho action tag_add_zalo/tag_remove_zalo (action type cho biết là Zalo)
 * khi tag name có thể chưa có 🔵 prefix mà CrmTag def cũng không tìm thấy. */
function tagChipHtml(rawName: string, forceZalo = false): string {
  const zaloManaged = forceZalo || isZaloManaged(rawName)
    || findTagDef(`🔵 ${rawName}`)?.managedBy === 'zalo_sync'; // CrmTag stored with prefix
  const cleaned = cleanTagName(rawName);
  const def = findTagDef(cleaned) || findTagDef(rawName) || findTagDef(`🔵 ${cleaned}`);
  const color = def?.color || (zaloManaged ? '#0068FF' : lookupTagColor(rawName));
  const emoji = !zaloManaged && def?.emoji ? `${def.emoji} ` : '';
  // Zalo tags hiện logo Zalo thật (SVG) thay vì chấm tròn — match brand identity.
  const leading = zaloManaged ? '<img src="/brand/zalo-icon.svg" alt="Zalo" class="zalo-icon-inline"/>' : '';
  const cls = zaloManaged ? 'inline-tag tag-zalo' : 'inline-tag tag-crm';
  return `<span class="${cls}" style="--tag-color:${color}">${leading}${escape(emoji)}${escape(cleaned)}</span>`;
}
/* Render 1 status pill HTML — label VN + bg-color theo chip */
function statusPillHtml(code: string | null | undefined): string {
  if (!code) return '<span class="status-pill empty">— chưa có —</span>';
  const meta = statusMeta(String(code));
  if (!meta) return `<span class="status-pill empty">${escape(String(code))}</span>`;
  // Background mờ 15%, color đậm
  return `<span class="status-pill" style="background:${meta.color}22;color:${meta.color};border-color:${meta.color}66">${escape(meta.label)}</span>`;
}

const props = defineProps<{ item: ActivityLogItem }>();

const cat = computed<ActivityCategory>(() =>
  (props.item.category as ActivityCategory) || categoryOf(props.item.action),
);
const categoryMeta = computed(() => CATEGORY_META[cat.value]);
const actionMeta = computed(() => ACTION_META[props.item.action] || { label: props.item.action });
const icon = computed(() => actionMeta.value.icon || categoryMeta.value.icon);
const categoryColor = computed(() => categoryMeta.value.color);
const actionLabel = computed(() => actionMeta.value.label);

const actorLabel = computed(() => {
  const it = props.item;
  if (it.actorType === 'user' && it.user) return it.user.fullName || it.user.email || 'Người dùng';
  if (it.actorType === 'bot') return `🤖 ${it.botName || 'Bot'}`;
  if (it.actorType === 'system') return `⚙️ ${it.systemSource || 'Hệ thống'}`;
  return '—';
});
const actorTooltip = computed(() => {
  const it = props.item;
  if (it.actorType === 'user' && it.user) return `User · ${it.user.email}`;
  if (it.actorType === 'bot') return `Bot · ${it.botName || ''}`;
  return `System · ${it.systemSource || ''}`;
});

const relTime = computed(() => {
  const d = new Date(props.item.createdAt).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m}p`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}n`;
  const p = getOrgParts(props.item.createdAt);
  if (!p) return '';
  return `${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')}`;
});

const absTime = computed(() => formatInOrgTz(props.item.createdAt));

/* Details rendering — pick out common fields based on action type */
const detailsLine = computed(() => {
  const d = props.item.details || {};
  const action = props.item.action;

  // Status change: hiển thị label VN + icon + màu theo CARE_STATUSES (không raw code)
  if (action === 'status_change' && (d.old || d.new)) {
    return `: ${statusPillHtml(d.old as string)} → ${statusPillHtml(d.new as string)}`;
  }
  // Score change: delta
  if (action === 'score_change') {
    const delta = typeof d.delta === 'number' ? d.delta : 0;
    const sign = delta > 0 ? '+' : '';
    const color = delta > 0 ? 'green' : 'red';
    return `: <span class="diff-${color}">${sign}${delta}</span> (${d.old} → ${d.new})`;
  }
  // Tag add/remove — render chip màu giống TagCrmBar (zalo monochromatic / crm tinted).
  // detailsLine dùng v-html nên embed HTML chip trực tiếp với inline style.
  // forceZalo cho action *_zalo (action type là source of truth — không phụ thuộc tag name prefix).
  if ((action === 'tag_add_crm' || action === 'tag_remove_crm') && d.tag) {
    return `: ${tagChipHtml(String(d.tag), false)}`;
  }
  if ((action === 'tag_add_zalo' || action === 'tag_remove_zalo') && d.tag) {
    return `: ${tagChipHtml(String(d.tag), true)}`;
  }
  // Tag change (gộp remove+add cùng sync): A → B — luôn forceZalo
  if (action === 'tag_change_zalo' && (d.from || d.to)) {
    const from = d.from ? tagChipHtml(String(d.from), true) : '<span class="diff-val null">—</span>';
    const to = d.to ? tagChipHtml(String(d.to), true) : '<span class="diff-val null">—</span>';
    return `: ${from} → ${to}`;
  }
  // Appointment: show date
  if (action === 'appointment_create' && d.appointmentDate) {
    const time = d.appointmentTime ? ` lúc ${escape(String(d.appointmentTime))}` : '';
    return `: <strong>${formatInOrgTz(String(d.appointmentDate), undefined, { dateOnly: true })}${time}</strong>`;
  }
  if (action === 'appointment_reschedule' && d.oldDate && d.newDate) {
    return `: ${formatInOrgTz(String(d.oldDate), undefined, { dateOnly: true })} → ${formatInOrgTz(String(d.newDate), undefined, { dateOnly: true })}`;
  }
  // Customer update: KHÔNG show inline ở đây — render qua diff-block 2-line bên dưới
  // Friend alias change
  if (action === 'friend_alias_change' && (d.old !== undefined || d.new !== undefined)) {
    return `: "${escape(String(d.old || ''))}" → "${escape(String(d.new || ''))}"`;
  }
  // Generic fallback 2026-05-29: BE pass details.summary tiếng Việt đẹp
  // (vd Lead Pool: "Phạm Chí Thành đã nhận lead từ Pool · Nguồn: Tệp khách hàng · Điểm 12 · Hạn note: 30 phút").
  // Em dùng cho mọi action có summary thay vì raw JSON details.
  if (typeof d.summary === 'string' && d.summary.trim()) {
    return ` — ${escape(d.summary)}`;
  }
  return '';
});

/* Diff entries — render block 2-line cho customer_update changes (field text dài).
 * Format: birthday/date theo locale VN, các field khác giữ raw. */
const FIELD_LABELS: Record<string, string> = {
  fullName: 'Tên đầy đủ',
  crmName: 'Tên gợi nhớ',
  phone: 'SĐT',
  email: 'Email',
  gender: 'Giới tính',
  birthDate: 'Ngày sinh',
  addressLine: 'Địa chỉ',
  occupation: 'Nghề nghiệp',
  assignedUserId: 'Người phụ trách',
};
function fieldLabel(field: string): string {
  return FIELD_LABELS[field] || field;
}
function formatVal(field: string, val: unknown): string {
  if (val === null || val === undefined) return '';
  if (field === 'birthDate' && typeof val === 'string') {
    try {
      return formatInOrgTz(val, undefined, { dateOnly: true });
    } catch { return String(val); }
  }
  if (field === 'gender') {
    const map: Record<string, string> = { male: 'Nam', female: 'Nữ', other: 'Khác' };
    return map[String(val)] || String(val);
  }
  return String(val);
}
const diffEntries = computed<Array<{ field: string; old: string; new: string }>>(() => {
  if (props.item.action !== 'customer_update') return [];
  const changes = (props.item.details?.changes || {}) as Record<string, { old: unknown; new: unknown }>;
  return Object.entries(changes).map(([field, v]) => ({
    field,
    old: formatVal(field, v.old),
    new: formatVal(field, v.new),
  }));
});

/* Auto-tag diff render — action='auto_tag_change' từ scoring/auto-tag.ts.
 * details: { added: AutoTagKey[], removed: AutoTagKey[], context: {leadScore, daysSilent, ...} } */
const autoTagDiff = computed<{ added: string[]; removed: string[] }>(() => {
  if (props.item.action !== 'auto_tag_change') return { added: [], removed: [] };
  const d = props.item.details || {};
  return {
    added: Array.isArray(d.added) ? (d.added as string[]) : [],
    removed: Array.isArray(d.removed) ? (d.removed as string[]) : [],
  };
});
const autoTagInfo = getAutoTagDef;
/* Subline context: sale hiểu LÝ DO bot gắn/gỡ — "score 85, im 12d, lịch hẹn 1" */
const autoTagContext = computed<string>(() => {
  if (props.item.action !== 'auto_tag_change') return '';
  const ctx = (props.item.details?.context || {}) as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof ctx.leadScore === 'number') parts.push(`score ${ctx.leadScore}`);
  if (typeof ctx.daysSilent === 'number') parts.push(`im ${ctx.daysSilent}d`);
  if (ctx.stuckSince) parts.push('stuck');
  if (typeof ctx.futureAppointmentCount === 'number' && ctx.futureAppointmentCount > 0) {
    parts.push(`${ctx.futureAppointmentCount} lịch hẹn`);
  }
  return parts.length ? `(${parts.join(' · ')})` : '';
});
</script>

<style scoped>
.activity-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  padding: 4px 8px;
  border-radius: 6px;
  font-size: 12.5px;
  line-height: 1.45;
  transition: background 0.12s;
}
.activity-item:hover {
  background: var(--smax-grey-50, #fafbfc);
}
.act-icon {
  font-size: 14px;
  flex-shrink: 0;
  margin-top: 2px;
  width: 18px;
  text-align: center;
}
.act-body {
  flex: 1;
  min-width: 0;
}
.act-text {
  color: var(--smax-text, #212121);
  word-break: break-word;
}
.act-text strong {
  font-weight: 600;
}
.act-details {
  color: var(--smax-grey-700);
  margin-left: 2px;
}
.act-meta {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--smax-grey-500);
  margin-top: 1px;
}
.act-sep { color: var(--smax-grey-300); }
.act-actor {
  font-weight: 500;
  cursor: pointer;
  border-radius: 3px;
  padding: 0 3px;
  transition: background 0.12s;
}
.act-actor:hover {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #2962ff);
}

/* Diff block 2-line cho customer_update */
.diff-block {
  margin-top: 4px;
  background: var(--smax-grey-50, #fafbfc);
  border-left: 2px solid var(--smax-grey-200);
  padding: 4px 8px;
  border-radius: 0 4px 4px 0;
}
.diff-entry {
  display: flex;
  gap: 6px;
  align-items: flex-start;
  font-size: 11.5px;
  padding: 2px 0;
}
.diff-field {
  font-weight: 600;
  color: var(--smax-grey-700);
  flex-shrink: 0;
  min-width: 80px;
}
.diff-vals {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  flex-wrap: wrap;
}
.diff-val {
  padding: 1px 6px;
  border-radius: 4px;
  word-break: break-word;
}
.diff-val.old {
  background: rgba(244, 67, 54, 0.08);
  color: #c62828;
  text-decoration: line-through;
}
.diff-val.new {
  background: rgba(0, 200, 83, 0.1);
  color: #00897b;
  font-weight: 600;
}
.diff-val.null {
  font-style: italic;
  color: var(--smax-grey-400);
}
.diff-arrow {
  color: var(--smax-grey-400);
  font-size: 11px;
  flex-shrink: 0;
}

/* Diff styling cho inline (act-details — status/score/tag) */
.act-details :deep(.diff-old) {
  text-decoration: line-through;
  color: var(--smax-grey-500);
}
.act-details :deep(.diff-new) {
  font-weight: 600;
  color: var(--smax-primary, #2962ff);
}
.act-details :deep(.diff-green) {
  color: #00897b;
  font-weight: 700;
}
.act-details :deep(.diff-red) {
  color: #c62828;
  font-weight: 700;
}
.act-details :deep(em) {
  font-style: normal;
  background: var(--smax-grey-100, #f5f6fa);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

/* Inline tag chip — match TagCrmBar nhưng size nhỏ hơn cho activity context.
 * Sync màu/style với TagCrmBar.tag-pill (tag-zalo monochromatic, tag-crm tinted). */
.act-details :deep(.inline-tag) {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 9px;
  font-size: 10.5px;
  font-weight: 500;
  border: 1px solid;
  white-space: nowrap;
  margin: 0 1px;
  line-height: 1.5;
}
.act-details :deep(.inline-tag.tag-zalo) {
  --tag-color: #0068FF;
  background: color-mix(in srgb, var(--tag-color) 12%, white);
  border-color: color-mix(in srgb, var(--tag-color) 80%, white);
  color: color-mix(in srgb, var(--tag-color) 75%, black);
  position: relative;
  margin-right: 6px; /* chừa cho Zalo badge nhô ra phải */
}
.act-details :deep(.inline-tag.tag-zalo .zalo-icon-inline) {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  display: inline-block;
  vertical-align: -2px; /* visual baseline align với text */
}
/* "Zalo" badge nhỏ hơn để fit context inline activity timeline */
.act-details :deep(.inline-tag.tag-zalo::before) {
  content: 'Zalo';
  position: absolute;
  top: -5px;
  right: -3px;
  background: #0068FF;
  color: white;
  font-size: 6.5px;
  font-weight: 800;
  letter-spacing: 0.02em;
  padding: 0 3px;
  border-radius: 99px;
  line-height: 1.3;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.act-details :deep(.inline-tag.tag-crm) {
  --tag-color: #546E7A;
  background: color-mix(in srgb, var(--tag-color) 8%, white);
  border-color: color-mix(in srgb, var(--tag-color) 70%, white);
  color: color-mix(in srgb, var(--tag-color) 80%, black);
}

/* Auto-tag diff block — chip giống TagCrmBar.tag-auto (tonal + AUTO badge) */
.autotag-diff {
  margin-top: 4px;
  background: var(--smax-grey-50, #fafbfc);
  border-left: 2px solid var(--smax-grey-200);
  padding: 7px 8px 4px; /* top hơi lớn để chừa AUTO badge nhô lên */
  border-radius: 0 4px 4px 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.autotag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
  font-size: 11px;
}
.autotag-arrow {
  font-weight: 600;
  font-size: 11px;
  margin-right: 2px;
  flex-shrink: 0;
}
.autotag-arrow.added { color: #059669; }
.autotag-arrow.removed { color: #b91c1c; }
/* Auto-tag chip nhỏ gọn để fit context activity timeline (không cần bằng TagCrmBar) */
.autotag-chip {
  --tag-color: #6B7280;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px 1px 6px;
  border-radius: 10px;
  font-size: 10.5px;
  font-weight: 600;
  border: 1px solid;
  background: color-mix(in srgb, var(--tag-color) 10%, white);
  border-color: color-mix(in srgb, var(--tag-color) 60%, white);
  color: color-mix(in srgb, var(--tag-color) 85%, black);
  cursor: help;
  position: relative;
  white-space: nowrap;
  line-height: 1.4;
}
.autotag-chip .autotag-emoji { font-size: 11px; }
.autotag-chip::before {
  content: 'AUTO';
  position: absolute;
  top: -5px;
  right: -3px;
  background: var(--tag-color);
  color: white;
  font-size: 6.5px;
  font-weight: 800;
  letter-spacing: 0.04em;
  padding: 0 3px;
  border-radius: 99px;
  line-height: 1.3;
}
/* Removed chip: dim + strikethrough để rõ "tag bị gỡ" */
.autotag-chip.removed {
  opacity: 0.65;
  text-decoration: line-through;
  text-decoration-thickness: 1px;
}
.autotag-chip.removed::before {
  opacity: 0.7;
}
.autotag-context {
  font-size: 10.5px;
  color: var(--smax-grey-500);
  margin-top: 1px;
  font-style: italic;
}

/* Status pill inline trong activity details — match CareStatusBadge style */
.act-details :deep(.status-pill) {
  display: inline-block;
  padding: 1px 9px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  border: 1px solid;
  white-space: nowrap;
}
.act-details :deep(.status-pill.empty) {
  background: var(--smax-grey-100, #f5f6fa);
  color: var(--smax-grey-500);
  border-color: var(--smax-grey-200);
  font-style: italic;
  font-weight: 500;
}
</style>
