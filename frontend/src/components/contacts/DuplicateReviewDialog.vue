<template>
  <v-dialog v-model="show" :max-width="900" :fullscreen="$vuetify.display.smAndDown" scrollable>
    <v-card class="dup-dialog">
      <!-- ════════ Header — fixed ════════ -->
      <header class="dup-header">
        <div class="dup-title">
          <v-icon size="22" color="warning">mdi-account-multiple-check-outline</v-icon>
          <div>
            <div class="dup-h1">Khách hàng trùng lặp</div>
            <div class="dup-sub">
              <span v-if="duplicateTotal > 0">{{ duplicateTotal }} nhóm cần review</span>
              <span v-else>Không còn nhóm nào</span>
            </div>
          </div>
        </div>
        <button class="dup-close" @click="show = false">×</button>
      </header>

      <!-- Filter chips by match type -->
      <div class="dup-filters" v-if="duplicateTotal > 0">
        <button
          v-for="opt in matchTypeOptions"
          :key="opt.value"
          class="filter-chip"
          :class="{ active: matchTypeFilter === opt.value }"
          @click="setMatchTypeFilter(opt.value)"
        >
          <span class="chip-icon">{{ opt.icon }}</span>
          {{ opt.label }}
          <span v-if="(typeCounts[opt.value] ?? 0) > 0" class="chip-count">{{ typeCounts[opt.value] }}</span>
        </button>
      </div>

      <!-- ════════ Body — scroll ════════ -->
      <v-card-text class="dup-body">
        <v-progress-linear v-if="loadingDuplicates" indeterminate color="warning" />

        <div v-if="!loadingDuplicates && filteredGroups.length === 0" class="dup-empty">
          <v-icon size="56" color="grey-lighten-1">mdi-check-circle-outline</v-icon>
          <p class="empty-title">Không có nhóm trùng nào</p>
          <p class="empty-sub">
            {{ matchTypeFilter ? 'Đổi bộ lọc khác hoặc' : 'Hệ thống đã xử lý hết.' }}
            <button v-if="matchTypeFilter" class="link-btn" @click="setMatchTypeFilter('')">xem tất cả</button>
          </p>
        </div>

        <!-- Group cards -->
        <div v-else class="dup-groups">
          <article
            v-for="group in filteredGroups"
            :key="group.id"
            class="dup-group"
            :class="{ 'is-conflict': isConflict(group.matchType) }"
          >
            <header class="group-head">
              <span class="match-badge" :class="badgeClass(group.matchType)">
                {{ matchTypeIcon(group.matchType) }} {{ matchTypeLabel(group.matchType) }}
              </span>
              <span class="group-count">{{ group.contacts.length }} KH</span>
              <span v-if="isConflict(group.matchType)" class="conflict-warn" :title="conflictTooltip(group.matchType)">
                ⚠ Cần xem kỹ
              </span>
              <span class="group-spacer"></span>
              <span class="group-similarity" v-if="group.confidence">
                {{ Math.round(group.confidence * 100) }}% chắc chắn
              </span>
            </header>

            <!-- Comparison cards side-by-side -->
            <div class="compare-grid">
              <label
                v-for="contact in group.contacts"
                :key="contact.id"
                class="compare-card"
                :class="{ selected: selectedPrimary[group.id] === contact.id }"
              >
                <input
                  type="radio"
                  :name="`primary-${group.id}`"
                  :value="contact.id"
                  v-model="selectedPrimary[group.id]"
                  class="card-radio"
                />
                <div class="card-header">
                  <Avatar
                    :src="contact.avatarUrl"
                    :name="contact.fullName || contact.crmName || '?'"
                    :size="40"
                    :gradient-seed="contact.id"
                  />
                  <div class="card-name-block">
                    <div class="card-name" :title="contact.fullName || ''">
                      {{ contact.crmName || contact.fullName || '— chưa đặt tên —' }}
                    </div>
                    <div v-if="contact.fullName && contact.crmName && contact.fullName !== contact.crmName" class="card-zalo-name">
                      Zalo: {{ contact.fullName }}
                    </div>
                  </div>
                  <div class="card-radio-visual">
                    <v-icon
                      :color="selectedPrimary[group.id] === contact.id ? 'primary' : 'grey-lighten-1'"
                      size="22"
                    >
                      {{ selectedPrimary[group.id] === contact.id ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank' }}
                    </v-icon>
                  </div>
                </div>

                <div class="card-fields">
                  <Field icon="📞" label="SĐT" :value="contact.phone" :highlight="fieldDiffers(group, 'phone', contact.phone)" />
                  <Field icon="🌐" label="Zalo UID" :value="contact.zaloUid" mono :highlight="fieldDiffers(group, 'zaloUid', contact.zaloUid)" />
                  <Field icon="🆔" label="Global ID" :value="shortId(contact.zaloGlobalId)" mono :highlight="fieldDiffers(group, 'zaloGlobalId', contact.zaloGlobalId)" />
                  <Field icon="@" label="Username" :value="contact.zaloUsername" mono :highlight="fieldDiffers(group, 'zaloUsername', contact.zaloUsername)" />
                  <Field icon="📅" label="Tạo lúc" :value="formatDate(contact.createdAt)" />
                  <Field icon="⭐" label="Score" :value="String(contact.leadScore ?? 0)" />
                </div>

                <div v-if="contact.tags?.length" class="card-tags">
                  <span v-for="t in contact.tags.slice(0, 4)" :key="t" class="tag-chip">{{ t }}</span>
                  <span v-if="contact.tags.length > 4" class="tag-chip more">+{{ contact.tags.length - 4 }}</span>
                </div>

                <div class="card-source" v-if="contact.source">
                  <v-icon size="13" color="grey">mdi-source-branch</v-icon>
                  Nguồn: <strong>{{ contact.source }}</strong>
                </div>
              </label>
            </div>

            <!-- Footer actions -->
            <footer class="group-actions">
              <div class="action-hint" v-if="!selectedPrimary[group.id]">
                <v-icon size="14" color="grey">mdi-information-outline</v-icon>
                Chọn 1 KH làm <b>CHÍNH</b> — các KH còn lại sẽ gộp vào KH này
              </div>
              <div class="action-hint primary-set" v-else>
                <v-icon size="14" color="success">mdi-check-circle</v-icon>
                KH chính: <b>{{ primaryName(group) }}</b>. {{ group.contacts.length - 1 }} KH con sẽ gộp vào.
              </div>
              <span class="group-spacer"></span>
              <button class="btn-dismiss" :disabled="dismissing === group.id" @click="onDismiss(group.id)">
                <v-icon size="14">mdi-eye-off-outline</v-icon>
                Bỏ qua
              </button>
              <button
                class="btn-merge"
                :disabled="!selectedPrimary[group.id] || merging"
                @click="onMerge(group.id)"
              >
                <v-icon size="14">mdi-merge</v-icon>
                Gộp {{ group.contacts.length - 1 }} KH
              </button>
            </footer>
          </article>
        </div>
      </v-card-text>

      <!-- Pagination footer -->
      <footer v-if="totalPages > 1" class="dup-pagination">
        <button class="page-btn" :disabled="page <= 1" @click="changePage(page - 1)">← Trước</button>
        <span class="page-info">Trang {{ page }} / {{ totalPages }} ({{ duplicateTotal }} nhóm)</span>
        <button class="page-btn" :disabled="page >= totalPages" @click="changePage(page + 1)">Sau →</button>
      </footer>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive, h, type FunctionalComponent } from 'vue';
import Avatar from '@/components/ui/Avatar.vue';
import { useContactIntelligence } from '@/composables/use-contacts';
import { useToast } from '@/composables/use-toast';

const show = defineModel<boolean>({ default: false });
const emit = defineEmits<{ merged: [] }>();

const {
  duplicateGroups, duplicateTotal, loadingDuplicates, merging,
  fetchDuplicateGroups, mergeDuplicateGroup, dismissDuplicateGroup,
} = useContactIntelligence();
const toast = useToast();

const selectedPrimary = reactive<Record<string, string>>({});
const matchTypeFilter = ref('');
const page = ref(1);
const limit = 20;
const dismissing = ref<string | null>(null);

const totalPages = computed(() => Math.max(1, Math.ceil(duplicateTotal.value / limit)));

// Match type config — single source of truth
const matchTypeOptions = [
  { value: '',                                  label: 'Tất cả',          icon: '◉' },
  { value: 'zalo_global_id',                    label: 'GlobalId trùng',  icon: '🌐' },
  { value: 'zalo_username_conflict_globalId',   label: 'Username xung đột', icon: '⚠' },
  { value: 'phone',                             label: 'SĐT trùng',       icon: '📞' },
  { value: 'phone_conflict_username',           label: 'SĐT xung đột',    icon: '⚠' },
  { value: 'zalo_uid',                          label: 'UID trùng',       icon: '🆔' },
  { value: 'name_with_soft_match',              label: 'Tên gần giống',   icon: '👤' },
];

const typeCounts = computed(() => {
  const m: Record<string, number> = {};
  for (const g of duplicateGroups.value) m[g.matchType] = (m[g.matchType] || 0) + 1;
  return m;
});

const filteredGroups = computed(() =>
  matchTypeFilter.value
    ? duplicateGroups.value.filter(g => g.matchType === matchTypeFilter.value)
    : duplicateGroups.value,
);

function matchTypeLabel(t: string) {
  return matchTypeOptions.find(o => o.value === t)?.label || t;
}
function matchTypeIcon(t: string) {
  return matchTypeOptions.find(o => o.value === t)?.icon || '◉';
}
function badgeClass(t: string) {
  if (t === 'zalo_global_id') return 'badge-strong';
  if (t.includes('conflict')) return 'badge-warn';
  if (t === 'phone' || t === 'zalo_uid') return 'badge-info';
  return 'badge-soft';
}
function isConflict(t: string) {
  return t.includes('conflict');
}
function conflictTooltip(t: string) {
  if (t === 'zalo_username_conflict_globalId') return 'Cùng username Zalo nhưng khác globalId — có thể 2 người khác hoặc đổi tài khoản. KHÔNG auto merge.';
  if (t === 'phone_conflict_username') return 'Cùng SĐT nhưng username Zalo khác — có thể đổi chủ SĐT.';
  return 'Cần review thủ công.';
}

function shortId(id: string | null) {
  if (!id) return '';
  return id.length > 12 ? id.slice(0, 12) + '…' : id;
}
function formatDate(d: string | Date | undefined) {
  if (!d) return '';
  const date = new Date(d);
  return date.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Field comparison — highlight differences across contacts in same group
function fieldDiffers(group: { contacts: Record<string, unknown>[] }, key: string, value: unknown): boolean {
  if (!value) return false;
  const values = group.contacts.map(c => c[key]).filter(Boolean);
  const distinct = new Set(values);
  return distinct.size > 1;
}

function primaryName(group: { contacts: { id: string; crmName?: string | null; fullName?: string | null }[] }) {
  const c = group.contacts.find(x => x.id === selectedPrimary[group.id]);
  return c?.crmName || c?.fullName || 'KH';
}

watch(show, (open) => {
  if (open) {
    page.value = 1;
    matchTypeFilter.value = '';
    fetchDuplicateGroups(1, limit);
  }
});

function setMatchTypeFilter(t: string) {
  matchTypeFilter.value = t;
}

async function changePage(p: number) {
  page.value = p;
  await fetchDuplicateGroups(p, limit);
}

async function onMerge(groupId: string) {
  const primaryId = selectedPrimary[groupId];
  if (!primaryId) return;
  const ok = await mergeDuplicateGroup(groupId, primaryId);
  if (ok) {
    delete selectedPrimary[groupId];
    toast.success('Đã gộp KH thành công');
    await fetchDuplicateGroups(page.value, limit);
    emit('merged');
  } else {
    toast.error('Gộp thất bại');
  }
}

async function onDismiss(groupId: string) {
  if (!confirm('Bỏ qua nhóm này — đánh dấu KH không phải trùng?')) return;
  dismissing.value = groupId;
  const ok = await dismissDuplicateGroup(groupId);
  dismissing.value = null;
  if (ok) {
    delete selectedPrimary[groupId];
    toast.success('Đã bỏ qua nhóm');
    await fetchDuplicateGroups(page.value, limit);
    emit('merged');
  } else {
    toast.error('Bỏ qua thất bại');
  }
}

// Field component — small inline render
const Field: FunctionalComponent<{ icon: string; label: string; value: string | null | undefined; mono?: boolean; highlight?: boolean }> = (props) => {
  return h('div', { class: ['field', { mono: props.mono, highlight: props.highlight }] }, [
    h('span', { class: 'field-icon' }, props.icon),
    h('span', { class: 'field-label' }, props.label + ':'),
    h('span', { class: 'field-value' }, props.value || '—'),
  ]);
};
Field.props = ['icon', 'label', 'value', 'mono', 'highlight'];
</script>

<style scoped>
.dup-dialog {
  display: flex; flex-direction: column;
  max-height: 90vh;
  background: var(--smax-bg);
}

/* Header */
.dup-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--smax-grey-200);
  background: linear-gradient(135deg, rgba(255,193,7,0.06), rgba(255,87,34,0.04));
  flex-shrink: 0;
}
.dup-title { display: flex; align-items: center; gap: 12px; }
.dup-h1 { font-size: 17px; font-weight: 600; color: var(--smax-text); }
.dup-sub { font-size: 12.5px; color: var(--smax-grey-700); margin-top: 2px; }
.dup-close {
  width: 32px; height: 32px;
  border: none; background: transparent;
  font-size: 24px; line-height: 1;
  color: var(--smax-grey-700); cursor: pointer;
  border-radius: 50%;
}
.dup-close:hover { background: var(--smax-grey-100); color: var(--smax-text); }

/* Filter chips */
.dup-filters {
  display: flex; gap: 6px; flex-wrap: wrap;
  padding: 10px 18px;
  border-bottom: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
  flex-shrink: 0;
}
.filter-chip {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 11px;
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-300);
  border-radius: 14px;
  font-size: 12px; font-weight: 500;
  color: var(--smax-grey-700);
  cursor: pointer; font-family: inherit;
}
.filter-chip:hover { border-color: var(--smax-primary); color: var(--smax-primary); }
.filter-chip.active {
  background: var(--smax-primary-soft);
  border-color: var(--smax-primary);
  color: var(--smax-primary); font-weight: 600;
}
.chip-icon { font-size: 14px; }
.chip-count {
  background: var(--smax-grey-200);
  padding: 1px 6px; border-radius: 8px;
  font-size: 10.5px; font-weight: 700;
  margin-left: 2px;
}
.filter-chip.active .chip-count { background: white; color: var(--smax-primary); }

/* Body */
.dup-body {
  flex: 1; min-height: 0;
  padding: 16px 18px !important;
  background: var(--smax-grey-50);
}

/* Empty state */
.dup-empty {
  display: flex; flex-direction: column; align-items: center;
  padding: 48px 18px; text-align: center;
}
.empty-title { font-size: 15px; font-weight: 600; color: var(--smax-text); margin-top: 12px; }
.empty-sub { font-size: 13px; color: var(--smax-grey-700); margin-top: 4px; }
.link-btn {
  background: none; border: none; padding: 0;
  color: var(--smax-primary); cursor: pointer;
  font-family: inherit; font-size: 13px; text-decoration: underline;
}

/* Group card */
.dup-groups { display: flex; flex-direction: column; gap: 14px; }
.dup-group {
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-200);
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.dup-group.is-conflict {
  border-color: var(--smax-warning, #ff9800);
  box-shadow: 0 1px 6px rgba(255,152,0,0.15);
}
.group-head {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--smax-grey-100);
  background: var(--smax-grey-50);
  font-size: 12.5px;
}
.match-badge {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px;
  border-radius: 11px;
  font-weight: 600; font-size: 11.5px;
}
.badge-strong { background: rgba(76,175,80,0.15); color: #2e7d32; }
.badge-warn   { background: rgba(255,152,0,0.18); color: #ef6c00; }
.badge-info   { background: rgba(33,150,243,0.15); color: #1565c0; }
.badge-soft   { background: var(--smax-grey-100); color: var(--smax-grey-700); }
.group-count { font-weight: 600; color: var(--smax-grey-700); }
.conflict-warn {
  color: #ef6c00; font-weight: 600; font-size: 11.5px;
  cursor: help;
}
.group-spacer { flex: 1; }
.group-similarity {
  font-size: 11px; color: var(--smax-grey-700);
  background: var(--smax-grey-100);
  padding: 1px 7px; border-radius: 9px;
}

/* Compare grid */
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 9px;
  padding: 12px;
}
.compare-card {
  position: relative;
  background: var(--smax-bg);
  border: 2px solid var(--smax-grey-200);
  border-radius: 9px;
  padding: 11px;
  cursor: pointer;
  transition: all 0.15s;
}
.compare-card:hover { border-color: var(--smax-primary); background: rgba(33,150,243,0.02); }
.compare-card.selected {
  border-color: var(--smax-primary);
  background: var(--smax-primary-soft);
  box-shadow: 0 0 0 3px rgba(33,150,243,0.15);
}
.card-radio { position: absolute; opacity: 0; pointer-events: none; }
.card-header {
  display: flex; align-items: center; gap: 9px;
  margin-bottom: 9px;
}
.card-name-block { flex: 1; min-width: 0; }
.card-name {
  font-weight: 600; font-size: 13.5px;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-zalo-name {
  font-size: 11px; color: var(--smax-grey-700);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 2px;
}
.card-radio-visual { flex-shrink: 0; }

.card-fields {
  display: flex; flex-direction: column; gap: 3px;
}
.field {
  display: flex; align-items: center; gap: 6px;
  font-size: 11.5px;
  padding: 2px 0;
}
.field-icon { width: 16px; flex-shrink: 0; opacity: 0.7; }
.field-label { color: var(--smax-grey-700); flex-shrink: 0; }
.field-value {
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}
.field.mono .field-value {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  font-size: 10.5px;
  background: var(--smax-grey-100);
  padding: 1px 5px; border-radius: 3px;
}
.field.highlight {
  background: rgba(255,193,7,0.08);
  border-radius: 4px;
  padding: 2px 5px;
}
.field.highlight .field-value { font-weight: 600; color: #ef6c00; }

.card-tags { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 7px; }
.tag-chip {
  background: var(--smax-grey-100);
  padding: 1px 7px; border-radius: 9px;
  font-size: 10.5px;
  color: var(--smax-grey-700);
}
.tag-chip.more { background: var(--smax-primary-soft); color: var(--smax-primary); }
.card-source {
  margin-top: 6px;
  font-size: 11px; color: var(--smax-grey-700);
  display: flex; align-items: center; gap: 4px;
}

/* Group footer actions */
.group-actions {
  display: flex; align-items: center; gap: 9px;
  padding: 10px 14px;
  border-top: 1px solid var(--smax-grey-100);
  background: var(--smax-grey-50);
  font-size: 12.5px;
  flex-wrap: wrap;
}
.action-hint {
  display: flex; align-items: center; gap: 5px;
  color: var(--smax-grey-700);
}
.action-hint.primary-set { color: var(--smax-success, #00897b); }
.btn-dismiss, .btn-merge {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12.5px; font-weight: 500;
  cursor: pointer; font-family: inherit;
  border: 1px solid;
}
.btn-dismiss {
  background: var(--smax-bg);
  border-color: var(--smax-grey-300);
  color: var(--smax-grey-700);
}
.btn-dismiss:hover { border-color: var(--smax-grey-700); color: var(--smax-text); }
.btn-dismiss:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-merge {
  background: var(--smax-primary);
  border-color: var(--smax-primary);
  color: white;
  font-weight: 600;
}
.btn-merge:hover:not(:disabled) { background: var(--smax-primary-hover, #1976d2); }
.btn-merge:disabled {
  background: var(--smax-grey-200);
  border-color: var(--smax-grey-200);
  color: var(--smax-grey-700);
  cursor: not-allowed;
}

/* Pagination */
.dup-pagination {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  padding: 11px 18px;
  border-top: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
  font-size: 12.5px;
  flex-shrink: 0;
}
.page-btn {
  padding: 5px 11px;
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-300);
  border-radius: 6px;
  cursor: pointer; font-family: inherit; font-size: 12.5px;
  color: var(--smax-text);
}
.page-btn:hover:not(:disabled) { border-color: var(--smax-primary); color: var(--smax-primary); }
.page-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.page-info { color: var(--smax-grey-700); }

/* Responsive: mobile fullscreen */
@media (max-width: 600px) {
  .dup-dialog { max-height: 100vh; height: 100vh; border-radius: 0; }
  .compare-grid { grid-template-columns: 1fr; padding: 9px; }
  .group-head, .group-actions { padding: 9px 11px; }
  .dup-header { padding: 11px 13px; }
  .dup-filters { padding: 8px 13px; }
  .dup-body { padding: 12px 13px !important; }
}
</style>
