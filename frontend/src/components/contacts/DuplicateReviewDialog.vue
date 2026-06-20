<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <v-dialog v-model="show" :max-width="1100" :fullscreen="$vuetify.display.smAndDown" scrollable>
    <v-card class="dup-dialog">
      <!-- ════════ Header ════════ -->
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

      <!-- Filter chips -->
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

      <!-- ════════ Body ════════ -->
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

        <!-- Group cards: 3-column layout (Primary | Duplicate | Action) when 2 KH -->
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

            <!-- 3-column layout (chỉ khi 2 KH — common case) -->
            <div v-if="group.contacts.length === 2" class="three-col">
              <!-- LEFT: KH gốc (primary đề xuất) -->
              <ContactCard
                :contact="primaryOf(group)"
                role="primary"
                :selected="selectedPrimary[group.id] === primaryOf(group).id"
                :group-contacts="group.contacts"
                @click="selectedPrimary[group.id] = primaryOf(group).id"
              />

              <!-- CENTER: Arrow + action -->
              <div class="action-col">
                <div class="merge-arrow">
                  <v-icon size="24" color="warning">mdi-arrow-left-bold</v-icon>
                  <div class="arrow-label">Gộp vào</div>
                </div>
                <div class="action-summary">
                  <div class="summary-title">{{ matchTypeIcon(group.matchType) }} Trùng theo</div>
                  <div class="summary-type">{{ matchTypeLabel(group.matchType) }}</div>
                  <div v-if="differentFields(group).length > 0" class="summary-diff">
                    <div class="diff-label">Khác nhau:</div>
                    <span v-for="f in differentFields(group)" :key="f" class="diff-chip">{{ f }}</span>
                  </div>
                </div>
                <div class="action-buttons">
                  <button
                    class="btn-merge"
                    :disabled="merging"
                    @click="onMerge(group.id)"
                    :title="`Gộp '${secondaryOf(group).fullName || 'KH dup'}' VÀO '${primaryOf(group).fullName || 'KH gốc'}'`"
                  >
                    <v-icon size="14">mdi-merge</v-icon>
                    Gộp ngay
                  </button>
                  <button class="btn-dismiss" :disabled="dismissing === group.id" @click="onDismiss(group.id)">
                    <v-icon size="14">mdi-eye-off-outline</v-icon>
                    Bỏ qua
                  </button>
                  <button class="btn-swap" @click="swapPrimary(group)" :title="'Đổi vai trò: KH bên phải làm gốc'">
                    <v-icon size="14">mdi-swap-horizontal</v-icon>
                    Đổi vai trò
                  </button>
                </div>
              </div>

              <!-- RIGHT: KH dup (secondary) -->
              <ContactCard
                :contact="secondaryOf(group)"
                role="duplicate"
                :selected="false"
                :group-contacts="group.contacts"
              />
            </div>

            <!-- Grid layout (3+ KH) — fallback chọn radio -->
            <div v-else class="compare-grid">
              <label
                v-for="(contact, idx) in group.contacts"
                :key="contact.id"
                class="compare-card compact"
                :class="{ selected: selectedPrimary[group.id] === contact.id, 'is-primary-suggestion': idx === 0 }"
              >
                <input
                  type="radio"
                  :name="`primary-${group.id}`"
                  :value="contact.id"
                  v-model="selectedPrimary[group.id]"
                  class="card-radio"
                />
                <div v-if="idx === 0" class="role-badge primary">🏆 KH gốc đề xuất</div>
                <div v-else class="role-badge secondary">↘ KH dup #{{ idx }}</div>
                <ContactCardInner :contact="contact" :group-contacts="group.contacts" />
              </label>
              <div class="multi-actions">
                <div class="action-hint">
                  <v-icon size="14" color="warning">mdi-information-outline</v-icon>
                  Chọn 1 KH chính. {{ group.contacts.length - 1 }} KH còn lại sẽ gộp vào.
                </div>
                <button class="btn-dismiss" @click="onDismiss(group.id)">
                  <v-icon size="14">mdi-eye-off-outline</v-icon>
                  Bỏ qua
                </button>
                <button class="btn-merge" :disabled="!selectedPrimary[group.id] || merging" @click="onMerge(group.id)">
                  <v-icon size="14">mdi-merge</v-icon>
                  Gộp {{ group.contacts.length - 1 }} KH
                </button>
              </div>
            </div>
          </article>
        </div>
      </v-card-text>

      <!-- Pagination -->
      <footer v-if="totalPages > 1" class="dup-pagination">
        <button class="page-btn" :disabled="page <= 1" @click="changePage(page - 1)">← Trước</button>
        <span class="page-info">Trang {{ page }} / {{ totalPages }} ({{ duplicateTotal }} nhóm)</span>
        <button class="page-btn" :disabled="page >= totalPages" @click="changePage(page + 1)">Sau →</button>
      </footer>
    </v-card>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, reactive, h, defineComponent, type PropType } from 'vue';
import Avatar from '@/components/ui/Avatar.vue';
import { useContactIntelligence } from '@/composables/use-contacts';
import { useToast } from '@/composables/use-toast';
import { formatInOrgTz } from '@/composables/use-org-timezone';

interface ContactInGroup {
  id: string;
  fullName?: string | null;
  crmName?: string | null;
  phone?: string | null;
  email?: string | null;
  zaloUid?: string | null;
  zaloGlobalId?: string | null;
  zaloUsername?: string | null;
  avatarUrl?: string | null;
  source?: string | null;
  status?: string | null;
  tags?: unknown;
  createdAt?: string;
  leadScore?: number;
  lastActivity?: string | null;
  hasZalo?: boolean | null;
  lastInboundAt?: string | null;
  lastOutboundAt?: string | null;
  totalInbound?: number;
  totalOutbound?: number;
  assignedUser?: { id: string; fullName: string | null } | null;
  statusRef?: { id: string; name: string; color: string | null } | null;
  _count?: { conversations?: number; appointments?: number; friends?: number };
  _richness?: number;
}

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

// Cast composable groups (Contact[]) → DupGroup[] (ContactInGroup[]). Structurally
// compatible (subset fields); TS không narrow tự, cast tường minh ở 1 chỗ.
const filteredGroups = computed<(DupGroup & { matchType: string; confidence?: number })[]>(() => {
  const all = duplicateGroups.value as unknown as (DupGroup & { matchType: string; confidence?: number })[];
  return matchTypeFilter.value
    ? all.filter(g => g.matchType === matchTypeFilter.value)
    : all;
});

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
  if (t === 'zalo_username_conflict_globalId') return 'Cùng username Zalo nhưng khác globalId — có thể 2 người khác hoặc đổi tài khoản.';
  if (t === 'phone_conflict_username') return 'Cùng SĐT nhưng username Zalo khác — có thể đổi chủ SĐT.';
  return 'Cần review thủ công.';
}

// Primary/Secondary resolver — backend sort by richness DESC. Override khi swap.
// Group type accepts any contacts shape (composable DuplicateGroup.contacts là full
// Contact interface 71+ fields, ContactInGroup là subset; TS không narrow tự được).
type DupGroup = { id: string; contacts: ContactInGroup[] };
const swappedGroups = reactive<Record<string, boolean>>({});
function primaryOf(group: DupGroup): ContactInGroup {
  const swapped = swappedGroups[group.id];
  return swapped ? group.contacts[1] : group.contacts[0];
}
function secondaryOf(group: DupGroup): ContactInGroup {
  const swapped = swappedGroups[group.id];
  return swapped ? group.contacts[0] : group.contacts[1];
}
function swapPrimary(group: DupGroup) {
  swappedGroups[group.id] = !swappedGroups[group.id];
  selectedPrimary[group.id] = primaryOf(group).id;
}

function differentFields(group: { contacts: ContactInGroup[] }): string[] {
  const keys: { key: keyof ContactInGroup; label: string }[] = [
    { key: 'fullName', label: 'Tên' },
    { key: 'phone', label: 'SĐT' },
    { key: 'zaloUid', label: 'UID' },
    { key: 'zaloGlobalId', label: 'GlobalId' },
    { key: 'zaloUsername', label: 'Username' },
    { key: 'email', label: 'Email' },
  ];
  return keys.filter(k => {
    const vals = group.contacts.map(c => c[k.key]).filter(Boolean);
    return new Set(vals).size > 1;
  }).map(k => k.label);
}


watch(show, (open) => {
  if (open) {
    page.value = 1;
    matchTypeFilter.value = '';
    fetchDuplicateGroups(1, limit);
  }
});
// Pre-select primary cho mỗi group khi data load
watch(duplicateGroups, (groups) => {
  const cast = groups as unknown as DupGroup[];
  for (const g of cast) {
    if (!selectedPrimary[g.id] && g.contacts.length > 0) {
      selectedPrimary[g.id] = primaryOf(g).id;
    }
  }
});

function setMatchTypeFilter(t: string) { matchTypeFilter.value = t; }
async function changePage(p: number) { page.value = p; await fetchDuplicateGroups(p, limit); }

async function onMerge(groupId: string) {
  const group = filteredGroups.value.find(g => g.id === groupId);
  if (!group) return;
  const primaryId = selectedPrimary[groupId] || primaryOf(group).id;
  const primary = group.contacts.find(c => c.id === primaryId);
  const secondaries = group.contacts.filter(c => c.id !== primaryId);
  const confirmMsg = `Gộp ${secondaries.length} KH vào "${primary?.fullName || 'KH gốc'}"?\n\n`
    + `Tất cả Friend (nick chăm), Hội thoại, Lịch hẹn của KH dup sẽ chuyển sang KH gốc.\n`
    + `KH dup sẽ ẩn (soft delete — data vẫn truy được).`;
  if (!confirm(confirmMsg)) return;
  const ok = await mergeDuplicateGroup(groupId, primaryId);
  if (ok) {
    delete selectedPrimary[groupId];
    delete swappedGroups[groupId];
    toast.success(`Đã gộp ${secondaries.length} KH thành công`);
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
    delete swappedGroups[groupId];
    toast.success('Đã bỏ qua nhóm');
    await fetchDuplicateGroups(page.value, limit);
    emit('merged');
  } else {
    toast.error('Bỏ qua thất bại');
  }
}

// ────────── Sub-components ──────────
const ContactCardInner = defineComponent({
  props: {
    contact: { type: Object as PropType<ContactInGroup>, required: true },
    groupContacts: { type: Array as PropType<ContactInGroup[]>, required: true },
  },
  setup(props) {
    function differs(key: keyof ContactInGroup): boolean {
      const v = props.contact[key];
      if (!v) return false;
      const others = props.groupContacts
        .filter(c => c.id !== props.contact.id)
        .map(c => c[key])
        .filter(Boolean);
      return others.length > 0 && !others.includes(v);
    }
    function shortId(id: string | null | undefined): string {
      if (!id) return '';
      return id.length > 12 ? id.slice(0, 12) + '…' : id;
    }
    function formatDate(d: string | undefined): string {
      if (!d) return '';
      return formatInOrgTz(d, undefined, { dateOnly: true });
    }
    function richness(c: ContactInGroup): { friends: number; convs: number; apts: number } {
      return {
        friends: c._count?.friends ?? 0,
        convs: c._count?.conversations ?? 0,
        apts: c._count?.appointments ?? 0,
      };
    }
    return () => {
      const c = props.contact;
      const r = richness(c);
      return h('div', { class: 'card-inner' }, [
        h('div', { class: 'card-header' }, [
          h(Avatar, {
            src: c.avatarUrl,
            name: c.fullName || c.crmName || '?',
            size: 44,
            'gradient-seed': c.id,
          }),
          h('div', { class: 'card-name-block' }, [
            h('div', { class: 'card-name', title: c.fullName || '' },
              c.crmName || c.fullName || '— chưa đặt tên —'),
            c.fullName && c.crmName && c.fullName !== c.crmName
              ? h('div', { class: 'card-zalo-name' }, `Zalo: ${c.fullName}`)
              : null,
          ]),
        ]),
        h('div', { class: 'card-richness' }, [
          h('span', { class: ['richness-pill', r.friends > 0 ? 'has' : 'none'] },
            [h('b', null, r.friends), ' nick chăm']),
          h('span', { class: ['richness-pill', r.convs > 0 ? 'has' : 'none'] },
            [h('b', null, r.convs), ' hội thoại']),
          h('span', { class: ['richness-pill', r.apts > 0 ? 'has' : 'none'] },
            [h('b', null, r.apts), ' lịch hẹn']),
        ]),
        h('div', { class: 'card-fields' }, [
          h('div', { class: ['field', differs('phone') && 'highlight'].filter(Boolean) }, [
            h('span', { class: 'field-icon' }, '📞'),
            h('span', { class: 'field-label' }, 'SĐT:'),
            h('span', { class: 'field-value' }, c.phone || '—'),
          ]),
          h('div', { class: ['field', 'mono', differs('zaloUid') && 'highlight'].filter(Boolean) }, [
            h('span', { class: 'field-icon' }, '🌐'),
            h('span', { class: 'field-label' }, 'Zalo UID:'),
            h('span', { class: 'field-value' }, shortId(c.zaloUid)),
          ]),
          h('div', { class: ['field', 'mono', differs('zaloGlobalId') && 'highlight'].filter(Boolean) }, [
            h('span', { class: 'field-icon' }, '🆔'),
            h('span', { class: 'field-label' }, 'Global ID:'),
            h('span', { class: 'field-value' }, shortId(c.zaloGlobalId) || '—'),
          ]),
          h('div', { class: ['field', 'mono', differs('zaloUsername') && 'highlight'].filter(Boolean) }, [
            h('span', { class: 'field-icon' }, '@'),
            h('span', { class: 'field-label' }, 'Username:'),
            h('span', { class: 'field-value' }, c.zaloUsername || '—'),
          ]),
          c.assignedUser ? h('div', { class: 'field' }, [
            h('span', { class: 'field-icon' }, '👤'),
            h('span', { class: 'field-label' }, 'Sale:'),
            h('span', { class: 'field-value' }, c.assignedUser.fullName || '—'),
          ]) : null,
          h('div', { class: 'field' }, [
            h('span', { class: 'field-icon' }, '📅'),
            h('span', { class: 'field-label' }, 'Tạo lúc:'),
            h('span', { class: 'field-value' }, formatDate(c.createdAt)),
          ]),
          c.source ? h('div', { class: 'field' }, [
            h('span', { class: 'field-icon' }, '🔖'),
            h('span', { class: 'field-label' }, 'Nguồn:'),
            h('span', { class: 'field-value' }, c.source),
          ]) : null,
        ]),
        Array.isArray(c.tags) && c.tags.length > 0
          ? h('div', { class: 'card-tags' },
              (c.tags as string[]).slice(0, 4).map(t =>
                h('span', { key: t, class: 'tag-chip' }, t)))
          : null,
      ]);
    };
  },
});

const ContactCard = defineComponent({
  props: {
    contact: { type: Object as PropType<ContactInGroup>, required: true },
    groupContacts: { type: Array as PropType<ContactInGroup[]>, required: true },
    role: { type: String as PropType<'primary' | 'duplicate'>, required: true },
    selected: { type: Boolean, default: false },
  },
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('div', {
      class: ['contact-col', `role-${props.role}`, { selected: props.selected, primary: props.role === 'primary' }],
      onClick: () => emit('click'),
    }, [
      h('div', { class: ['col-role-badge', props.role] }, [
        props.role === 'primary' ? '🏆 KH GỐC (sẽ giữ lại)' : '↘ KH DUP (sẽ gộp vào)',
      ]),
      h(ContactCardInner, { contact: props.contact, groupContacts: props.groupContacts }),
    ]);
  },
});
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
.conflict-warn { color: #ef6c00; font-weight: 600; font-size: 11.5px; cursor: help; }
.group-spacer { flex: 1; }
.group-similarity {
  font-size: 11px; color: var(--smax-grey-700);
  background: var(--smax-grey-100);
  padding: 1px 7px; border-radius: 9px;
}

/* ════════ 3-column layout (2 KH common case) ════════ */
.three-col {
  display: grid;
  grid-template-columns: 1fr 220px 1fr;
  gap: 0;
}
.contact-col {
  padding: 13px;
  background: var(--smax-bg);
  border-right: 1px solid var(--smax-grey-100);
}
.contact-col.role-primary {
  background: linear-gradient(135deg, rgba(76,175,80,0.04), rgba(76,175,80,0.01));
  border-left: 4px solid #4caf50;
}
.contact-col.role-duplicate {
  background: linear-gradient(135deg, rgba(255,152,0,0.04), rgba(255,152,0,0.01));
  border-right: none;
  border-left: 1px solid var(--smax-grey-100);
}
.col-role-badge {
  display: inline-block;
  padding: 3px 9px;
  border-radius: 11px;
  font-size: 11px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.3px;
  margin-bottom: 9px;
}
.col-role-badge.primary {
  background: rgba(76,175,80,0.15); color: #2e7d32;
}
.col-role-badge.duplicate {
  background: rgba(255,152,0,0.18); color: #ef6c00;
}

/* Action column (center) */
.action-col {
  display: flex; flex-direction: column;
  align-items: stretch; justify-content: center;
  padding: 14px 11px;
  background: var(--smax-grey-50);
  border-left: 1px solid var(--smax-grey-200);
  border-right: 1px solid var(--smax-grey-200);
  gap: 10px;
}
.merge-arrow {
  display: flex; flex-direction: column; align-items: center;
  gap: 2px;
}
.arrow-label {
  font-size: 11px; font-weight: 700;
  color: #ef6c00;
  text-transform: uppercase; letter-spacing: 0.4px;
}
.action-summary {
  text-align: center;
  padding: 9px;
  background: var(--smax-bg);
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  font-size: 11.5px;
}
.summary-title { color: var(--smax-grey-700); font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.3px; }
.summary-type { font-weight: 600; color: var(--smax-text); margin-top: 2px; }
.summary-diff { margin-top: 6px; padding-top: 6px; border-top: 1px dashed var(--smax-grey-200); }
.diff-label { font-size: 10px; color: var(--smax-grey-700); margin-bottom: 3px; }
.diff-chip {
  display: inline-block;
  background: rgba(255,193,7,0.15);
  color: #ef6c00;
  padding: 1px 6px;
  border-radius: 7px;
  font-size: 10.5px; font-weight: 500;
  margin: 1px;
}
.action-buttons {
  display: flex; flex-direction: column; gap: 5px;
}
.action-buttons button {
  width: 100%;
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  padding: 7px 11px;
  border-radius: 6px;
  font-size: 12.5px; font-weight: 500;
  cursor: pointer; font-family: inherit;
  border: 1px solid;
}
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
.btn-dismiss {
  background: var(--smax-bg);
  border-color: var(--smax-grey-300);
  color: var(--smax-grey-700);
}
.btn-dismiss:hover:not(:disabled) { border-color: var(--smax-grey-700); color: var(--smax-text); }
.btn-swap {
  background: transparent;
  border-color: transparent;
  color: var(--smax-grey-700);
  font-size: 11.5px;
}
.btn-swap:hover { color: var(--smax-primary); text-decoration: underline; }

/* Card inner content */
.card-inner { display: flex; flex-direction: column; gap: 9px; }
.card-header {
  display: flex; align-items: center; gap: 9px;
}
.card-name-block { flex: 1; min-width: 0; }
.card-name {
  font-weight: 700; font-size: 14.5px;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.card-zalo-name {
  font-size: 11px; color: var(--smax-grey-700);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 2px;
}
.card-richness {
  display: flex; gap: 4px; flex-wrap: wrap;
}
.richness-pill {
  font-size: 10.5px;
  padding: 2px 7px;
  border-radius: 9px;
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
}
.richness-pill.has { background: rgba(33,150,243,0.10); color: #1565c0; font-weight: 500; }
.richness-pill.has b { color: var(--smax-primary); margin-right: 2px; }
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
.card-tags { display: flex; flex-wrap: wrap; gap: 3px; }
.tag-chip {
  background: var(--smax-grey-100);
  padding: 1px 7px; border-radius: 9px;
  font-size: 10.5px;
  color: var(--smax-grey-700);
}

/* Grid layout (3+ KH) */
.compare-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 9px;
  padding: 12px;
}
.compare-card.compact {
  position: relative;
  background: var(--smax-bg);
  border: 2px solid var(--smax-grey-200);
  border-radius: 9px;
  padding: 11px;
  cursor: pointer;
}
.compare-card.compact:hover { border-color: var(--smax-primary); }
.compare-card.compact.selected {
  border-color: var(--smax-primary);
  background: var(--smax-primary-soft);
}
.compare-card.compact.is-primary-suggestion {
  border-color: #4caf50;
  background: rgba(76,175,80,0.03);
}
.compare-card.compact.is-primary-suggestion.selected {
  border-color: var(--smax-primary);
  background: var(--smax-primary-soft);
}
.compare-card .card-radio { position: absolute; opacity: 0; pointer-events: none; }
.role-badge {
  display: inline-block;
  padding: 2px 7px;
  border-radius: 9px;
  font-size: 10px; font-weight: 700;
  margin-bottom: 7px;
  text-transform: uppercase; letter-spacing: 0.3px;
}
.role-badge.primary { background: rgba(76,175,80,0.15); color: #2e7d32; }
.role-badge.secondary { background: rgba(255,152,0,0.18); color: #ef6c00; }

.multi-actions {
  grid-column: 1 / -1;
  display: flex; align-items: center; gap: 9px;
  padding: 10px 14px;
  border-top: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
  flex-wrap: wrap;
}
.multi-actions .action-hint {
  flex: 1;
  display: flex; align-items: center; gap: 6px;
  font-size: 12.5px; color: var(--smax-grey-700);
}
.multi-actions button {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 7px 13px;
  border-radius: 6px;
  font-size: 12.5px;
  cursor: pointer; font-family: inherit;
  border: 1px solid;
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

/* Responsive */
@media (max-width: 900px) {
  .three-col { grid-template-columns: 1fr; }
  .contact-col {
    border-right: none;
    border-bottom: 1px solid var(--smax-grey-100);
  }
  .action-col {
    border-left: none; border-right: none;
    border-top: 1px solid var(--smax-grey-200);
    border-bottom: 1px solid var(--smax-grey-200);
  }
  .merge-arrow { flex-direction: row; }
  .action-buttons { flex-direction: row; flex-wrap: wrap; }
}
@media (max-width: 600px) {
  .dup-dialog { max-height: 100vh; height: 100vh; border-radius: 0; }
  .compare-grid { grid-template-columns: 1fr; padding: 9px; }
  .dup-header { padding: 11px 13px; }
  .dup-filters { padding: 8px 13px; }
  .dup-body { padding: 12px 13px !important; }
}
</style>
