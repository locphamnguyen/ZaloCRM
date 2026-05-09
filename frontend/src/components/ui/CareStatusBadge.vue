<template>
  <span
    class="care-pill"
    :class="chipClass"
    :title="readonly ? '' : 'Click để đổi trạng thái'"
    @click.stop="onClick"
  >
    {{ current.label }}<span v-if="!readonly" class="caret">▾</span>

    <v-menu v-if="!readonly" v-model="open" activator="parent" :close-on-content-click="true" location="bottom start">
      <v-list density="compact" min-width="200">
        <v-list-item
          v-for="opt in CARE_STATUSES"
          :key="opt.value"
          :title="opt.label"
          :class="{ 'is-selected': opt.value === current.value }"
          @click="select(opt.value)"
        />
      </v-list>
    </v-menu>
  </span>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

/**
 * 9 enum care status đề xuất theo Dev Spec mockup contacts-approach-b-v3.
 * Đây là per-nick care status (Friend.customerCareStatus). Khác với
 * contact.status (pipeline cấp KH).
 */
export const CARE_STATUSES = [
  { value: 'new',           label: '🆕 Mới',          chip: 'chip-grey' },
  { value: 'new_stranger',  label: '🆕 Mới (lạ)',     chip: 'chip-cyan' },
  { value: 'interested',    label: '💬 Quan tâm',     chip: 'chip-info' },
  { value: 'nurturing',     label: '🤝 Chăm sóc',     chip: 'chip-purple' },
  { value: 'negotiating',   label: '⚡ Đàm phán',     chip: 'chip-warning' },
  { value: 'hot',           label: '🔥 Nóng',         chip: 'chip-error' },
  { value: 'cold',          label: '❄ Lạnh',          chip: 'chip-grey' },
  { value: 'closed',        label: '✅ Đã chốt',      chip: 'chip-success' },
  { value: 'lost',          label: '❌ Mất',          chip: 'chip-error' },
] as const;

export type CareStatusValue = typeof CARE_STATUSES[number]['value'];

const props = defineProps<{
  modelValue: CareStatusValue | string | null | undefined;
  readonly?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: CareStatusValue] }>();

const open = ref(false);

const current = computed(() => {
  return CARE_STATUSES.find(s => s.value === props.modelValue) || CARE_STATUSES[0];
});
const chipClass = computed(() => `chip ${current.value.chip}`);

function onClick() {
  if (props.readonly) return;
  open.value = true;
}
function select(value: CareStatusValue) {
  emit('update:modelValue', value);
  open.value = false;
}
</script>

<style scoped>
.care-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 8px;
  border-radius: 11px;
  font-size: 11px; font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  position: relative;
}
.care-pill .caret { font-size: 9px; opacity: 0.65; margin-left: 2px; }
.care-pill:hover { filter: brightness(0.97); }

/* Chip color variants — mirror cross-page palette */
.chip-grey    { background: rgba(90,100,120,0.12); color: var(--smax-grey-700); }
.chip-cyan    { background: rgba(0,188,212,0.13);  color: #00838f; }
.chip-info    { background: rgba(33,150,243,0.13); color: #1565c0; }
.chip-purple  { background: rgba(156,39,176,0.13); color: #6a1b9a; }
.chip-warning { background: rgba(255,145,0,0.18);  color: #ef6c00; }
.chip-error   { background: rgba(255,82,82,0.13);  color: #c62828; }
.chip-success { background: rgba(0,200,83,0.13);   color: #00897b; }

.is-selected { background: var(--smax-primary-soft) !important; color: var(--smax-primary); }
</style>
