<template>
  <!-- Picker giai đoạn KH (Status table — Wave 3 lazy gate source of truth).
       Ghi `contact.statusId` (FK) qua PUT /contacts/:id { statusId } để
       evaluateStatusGate BE đọc đúng cột. Thay <CareStatusBadge> legacy enum.
       Anh chốt 2026-05-30 — Mission Fix 2. -->
  <!-- 2026-06-20 (anh chốt: text dài khó hiểu → "Trống"): org chưa có giai đoạn nào → pill "Trống"
       (lý do đầy đủ ở tooltip). -->
  <span v-if="loadError" class="cds-pill cds-pill-empty" :title="loadError">
    <span class="cds-dot" :style="`background: ${UNASSIGNED_COLOR}`" />
    <span class="cds-label">Trống</span>
  </span>

  <v-menu
    v-else
    v-model="open"
    :close-on-content-click="true"
    location="bottom start"
  >
    <template #activator="{ props: act }">
      <span
        v-bind="act"
        class="cds-pill"
        :style="pillStyle"
        :title="loading ? 'Đang tải giai đoạn…' : 'Click để đổi giai đoạn KH'"
      >
        <span class="cds-dot" :style="dotStyle" />
        <span class="cds-label">{{ currentLabel }}</span>
        <span class="cds-caret">▾</span>
      </span>
    </template>
    <v-list density="compact" min-width="220">
      <v-list-item
        v-if="loading"
        title="Đang tải…"
        :disabled="true"
      />
      <template v-else>
        <v-list-item
          :title="UNASSIGNED_LABEL"
          :class="{ 'is-selected': !current?.id }"
          @click="select(null)"
        >
          <template #prepend>
            <span class="cds-list-dot" :style="`background: ${UNASSIGNED_COLOR}`" />
          </template>
        </v-list-item>
        <v-list-item
          v-for="opt in options"
          :key="opt.id"
          :title="opt.name"
          :class="{ 'is-selected': opt.id === current?.id }"
          @click="select(opt.id)"
        >
          <template #prepend>
            <span class="cds-list-dot" :style="`background: ${opt.color || '#9CA3AF'}`" />
          </template>
        </v-list-item>
        <v-divider />
        <v-list-item
          title="⚙ Quản lý giai đoạn…"
          @click="goToSettings"
        />
      </template>
    </v-list>
  </v-menu>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

interface Status {
  id: string;
  name: string;
  color: string | null;
  order: number;
  isTerminal: boolean;
  isDefault: boolean;
}

const props = defineProps<{
  contactId: string;
  currentStatusId: string | null;
  orgId?: string | null;
}>();

const emit = defineEmits<{ updated: [value: string | null] }>();

const toast = useToast();
const open = ref(false);
const loading = ref(false);
const loadError = ref<string | null>(null);
const options = ref<Status[]>([]);
// Local state — optimistic update, không lệ thuộc prop sau khi sale chọn.
const localStatusId = ref<string | null>(props.currentStatusId);

const UNASSIGNED_LABEL = 'Trống';
const UNASSIGNED_COLOR = '#9CA3AF';

watch(() => props.currentStatusId, (v) => {
  localStatusId.value = v;
});

const current = computed<Status | null>(() => {
  if (!localStatusId.value) return null;
  return options.value.find(s => s.id === localStatusId.value) || null;
});

const currentLabel = computed(() => {
  if (loading.value && !options.value.length) return 'Đang tải…';
  return current.value?.name || UNASSIGNED_LABEL;
});

const pillStyle = computed(() => {
  const color = current.value?.color || UNASSIGNED_COLOR;
  return {
    'border-color': color,
    'background': hexToSoft(color),
    'color': color,
  } as Record<string, string>;
});

const dotStyle = computed(() => ({
  background: current.value?.color || UNASSIGNED_COLOR,
}));

function hexToSoft(hex: string | null | undefined): string {
  if (!hex) return 'rgba(156,163,175,0.12)';
  // Convert #RRGGBB → rgba với 0.12 alpha. Fallback nếu format khác.
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.replace('#', ''));
  if (!m) return 'rgba(156,163,175,0.12)';
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  return `rgba(${r},${g},${b},0.12)`;
}

async function fetchStatuses() {
  loading.value = true;
  loadError.value = null;
  try {
    // BE hiện expose GET /api/v1/settings/statuses (org-scope qua JWT).
    // Nếu route đổi thành /api/v1/statuses?orgId=... thì swap path ở đây.
    const res = await api.get<{ statuses: Status[] }>('/settings/statuses');
    const list = res.data?.statuses || [];
    if (!list.length) {
      loadError.value = 'Tổ chức chưa có giai đoạn nào — vào /settings/statuses để tạo';
    }
    options.value = list.sort((a, b) => a.order - b.order);
  } catch (err: any) {
    const msg = err?.response?.data?.error || err?.message || 'Không tải được danh sách giai đoạn';
    loadError.value = msg;
    console.error('[ContactDealStageSelector] fetch statuses error', err);
  } finally {
    loading.value = false;
  }
}

async function select(newId: string | null) {
  if (newId === (localStatusId.value ?? null)) {
    open.value = false;
    return;
  }
  const prev = localStatusId.value;
  // Optimistic
  localStatusId.value = newId;
  open.value = false;

  try {
    // PUT /contacts/:id { statusId } — BE Wave 3 evaluateStatusGate đọc cột này.
    await api.put(`/contacts/${props.contactId}`, { statusId: newId });
    const labelName = newId
      ? (options.value.find(s => s.id === newId)?.name || 'giai đoạn mới')
      : UNASSIGNED_LABEL;
    toast.success(`Đã đổi giai đoạn → ${labelName}`);
    emit('updated', newId);
    // Trigger timeline refresh
    window.dispatchEvent(new CustomEvent('timeline-updated', { detail: { contactId: props.contactId } }));
  } catch (err: any) {
    // Rollback
    localStatusId.value = prev;
    const msg = err?.response?.data?.error
      || `Lưu giai đoạn thất bại (${err?.response?.status || 'network'})`;
    toast.error(msg);
    console.error('[ContactDealStageSelector] update statusId error', err);
  }
}

function goToSettings() {
  window.location.assign('/settings/statuses');
}

onMounted(() => {
  void fetchStatuses();
});
</script>

<style scoped>
.cds-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border-radius: 12px;
  border: 1px solid rgba(156, 163, 175, 0.4);
  background: rgba(156, 163, 175, 0.08);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
  transition: filter 0.15s ease, transform 0.05s ease;
}
.cds-pill:hover { filter: brightness(0.97); }
.cds-pill:active { transform: translateY(0.5px); }
/* 2026-06-20 — pill "Trống" khi org chưa có giai đoạn (không bấm được). */
.cds-pill-empty { cursor: default; color: #6b7280; }
.cds-pill-empty:hover { filter: none; }
.cds-pill-empty:active { transform: none; }

.cds-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 1.5px rgba(255, 255, 255, 0.7) inset;
}

.cds-label {
  max-width: 140px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cds-caret {
  font-size: 9px;
  opacity: 0.7;
  margin-left: 1px;
}

.cds-empty {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 8px;
  border-radius: 12px;
  border: 1px dashed rgba(156, 163, 175, 0.5);
  background: rgba(254, 252, 232, 0.6);
  font-size: 11px;
  color: #92400e;
  white-space: nowrap;
}
.cds-empty-text { opacity: 0.85; }
.cds-empty-link {
  color: #b45309;
  text-decoration: underline;
  font-weight: 500;
}
.cds-empty-link:hover { color: #78350f; }

.cds-list-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 8px;
  vertical-align: middle;
}

.is-selected {
  background: var(--smax-primary-soft, rgba(59, 130, 246, 0.08)) !important;
  color: var(--smax-primary, #1d4ed8);
  font-weight: 600;
}
</style>
