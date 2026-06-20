<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="dept-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">Phân quyền</h1>
        <p class="hero-sub">
          Ma trận {{ resources.length }} chức năng × {{ actions.length }} hành động ·
          Chọn nhóm bên trái → tích chọn quyền bên phải · Có thể sao chép quyền giữa các nhóm
        </p>
      </div>
      <div class="hero-actions">
        <button class="btn-ghost" :disabled="seeding" @click="seedDefaults">
          {{ seeding ? 'Đang seed...' : '⚙ Seed 7 nhóm mặc định' }}
        </button>
        <button class="btn-primary" @click="openCreate(null)">
          <span class="btn-icon">+</span> Thêm nhóm
        </button>
      </div>
    </header>

    <section class="stats-row" v-if="!loading && stats.total > 0">
      <div class="stat-card stat-primary">
        <div class="stat-label">Tổng nhóm</div>
        <div class="stat-value">{{ stats.total }}</div>
      </div>
      <div class="stat-card stat-forest">
        <div class="stat-label">Nhóm hệ thống</div>
        <div class="stat-value">{{ stats.system }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
      <div class="stat-card stat-mustard">
        <div class="stat-label">Tổng user đã gán</div>
        <div class="stat-value">{{ stats.totalMembers }}</div>
      </div>
      <div class="stat-card stat-cream">
        <div class="stat-label">Slot quyền tối đa</div>
        <div class="stat-value">{{ totalSlots }}<span class="stat-unit"> / nhóm</span></div>
      </div>
    </section>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 3" :key="i" style="height: 60px"></div>
    </div>

    <div v-else-if="store.permissionGroups.length === 0" class="empty-state">
      <div class="empty-icon">🛡</div>
      <h3>Chưa có nhóm quyền nào</h3>
      <p>Bắt đầu bằng seed 7 nhóm mặc định (CEO, Trưởng phòng, Sale Senior, Sale, Marketing, Kế toán, Khách).</p>
      <button class="btn-primary" :disabled="seeding" @click="seedDefaults">
        {{ seeding ? 'Đang seed...' : '⚙ Seed 7 nhóm mặc định' }}
      </button>
    </div>

    <!-- 2-COLUMN LAYOUT: list groups + matrix -->
    <div v-else class="pg-layout">
      <!-- LEFT: groups list -->
      <aside class="pg-sidebar">
        <div class="pg-sidebar-head">
          <div class="search-box at-search">
            <span class="search-icon">🔍</span>
            <input v-model="searchQ" placeholder="Tìm nhóm..." />
            <button v-if="searchQ" class="search-clear" @click="searchQ = ''">×</button>
          </div>
        </div>
        <ul class="pg-group-list">
          <li
            v-for="g in filteredGroups"
            :key="g.id"
            class="pg-group-item"
            :class="{ active: selectedId === g.id }"
            @click="selectedId = g.id"
          >
            <span class="pg-accent-strip" :style="{ background: accentByDepth(g._depth) }"></span>
            <div class="pg-group-body">
              <div class="pg-group-name">
                <span v-if="g._depth > 0" class="pg-indent-arrow">└</span>{{ g.name }}
              </div>
              <div class="pg-group-meta">
                <span v-if="g.isSystem" class="at-chip chip-system chip-xs">🛡 Hệ thống</span>
                <span v-else class="at-chip chip-custom chip-xs">✎ Tùy chỉnh</span>
                <span class="pg-count">👥 {{ memberCountsLive[g.id] ?? 0 }}</span>
                <span class="pg-grants-mini" :style="{ color: grantsColor(grantsPct(g)) }">
                  {{ grantsActive(g) }}/{{ totalSlots }}
                </span>
              </div>
            </div>
          </li>
        </ul>
        <button class="pg-add-btn" @click="openCreate(null)">+ Thêm nhóm quyền</button>
      </aside>

      <!-- RIGHT: matrix -->
      <section class="pg-main">
        <div v-if="!selected" class="empty-state" style="margin: 0">
          <div class="empty-icon">⬅</div>
          <h3>Chọn nhóm quyền bên trái</h3>
          <p>Click vào 1 nhóm để xem và chỉnh sửa ma trận quyền.</p>
        </div>

        <template v-else>
          <!-- Matrix header bar -->
          <div class="pg-matrix-head">
            <div class="pg-matrix-title">
              <span class="pg-accent-strip" :style="{ background: accentByDepth(selected._depth ?? 0) }"></span>
              <div>
                <h2 class="pg-name-big">{{ selected.name }}</h2>
                <div class="pg-name-meta">
                  <span v-if="selected.isSystem" class="at-chip chip-system">🛡 Hệ thống</span>
                  <span v-else class="at-chip chip-custom">✎ Tùy chỉnh</span>
                  <span class="at-chip chip-dept">👥 {{ memberCountsLive[selected.id] ?? 0 }} user</span>
                  <span class="at-chip chip-active">✓ {{ grantsActive(selected) }} / {{ totalSlots }} quyền</span>
                </div>
              </div>
            </div>
            <div class="pg-matrix-actions">
              <select class="filter-select pg-copy-select" v-model="copyFromId">
                <option value="">📋 Sao chép quyền từ...</option>
                <option v-for="g in copyableGroups" :key="g.id" :value="g.id">
                  {{ '— '.repeat(g._depth) }}{{ g.name }} ({{ grantsActive(g) }}/{{ totalSlots }})
                </option>
              </select>
              <button class="btn-ghost btn-sm" :disabled="!copyFromId" @click="doCopyFrom">
                ↓ Áp dụng
              </button>
              <button class="btn-ghost btn-sm" @click="tickAll(true)">✓ Tick tất cả</button>
              <button class="btn-ghost btn-sm" @click="tickAll(false)">✗ Bỏ tất cả</button>
            </div>
          </div>

          <!-- Matrix table -->
          <div class="pg-matrix-wrap">
            <table class="pg-matrix">
              <thead>
                <tr>
                  <th class="th-resource">Chức năng</th>
                  <th v-for="a in actions" :key="a" class="th-action">
                    <div class="th-action-label">{{ actionLabel(a) }}</div>
                    <button
                      class="th-bulk-btn"
                      :title="`Tick toàn bộ cột ${actionLabel(a)}`"
                      @click="tickColumn(a)"
                    >⇧ All</button>
                  </th>
                  <th class="th-row-bulk">Tất cả</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in resources" :key="r" :class="{ 'row-full': rowFull(r), 'row-empty': rowEmpty(r) }">
                  <td class="cell-resource">
                    <span class="resource-icon">{{ resourceIcon(r) }}</span>
                    <span class="resource-label">{{ resourceLabel(r) }}</span>
                    <span class="resource-count">{{ rowCount(r) }}/{{ (resourceActions[r] ?? []).length }}</span>
                  </td>
                  <td v-for="a in actions" :key="a" class="cell-check">
                    <label
                      v-if="(resourceActions[r] ?? []).includes(a)"
                      class="at-checkbox"
                      :class="{ checked: !!selected.grants?.[r]?.[a] }"
                    >
                      <input
                        type="checkbox"
                        :checked="!!selected.grants?.[r]?.[a]"
                        :disabled="saving"
                        @change="toggleGrant(r, a, ($event.target as HTMLInputElement).checked)"
                      />
                      <span class="at-checkbox-box">✓</span>
                    </label>
                    <span v-else class="cell-na">—</span>
                  </td>
                  <td class="cell-row-bulk">
                    <button class="th-bulk-btn" :title="`Tick toàn bộ hàng ${resourceLabel(r)}`" @click="tickRow(r)">⇨ All</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- Save indicator -->
          <div class="pg-save-bar" :class="{ 'is-saving': saving, 'is-saved': justSaved }">
            <span v-if="saving">💾 Đang lưu...</span>
            <span v-else-if="justSaved">✅ Đã lưu</span>
            <span v-else class="pg-save-hint">Mọi thay đổi được tự động lưu</span>
          </div>

          <!-- Danger zone for custom groups -->
          <div v-if="!selected.isSystem" class="pg-danger-zone">
            <div>
              <strong>Xóa nhóm "{{ selected.name }}"</strong>
              <p class="pg-danger-hint">Chỉ xóa được khi nhóm rỗng (không user, không nhóm con).</p>
            </div>
            <button class="btn-danger" @click="confirmArchive">🗑 Xóa nhóm</button>
          </div>
        </template>
      </section>
    </div>

    <!-- Create modal -->
    <Transition name="modal-fade">
      <div v-if="showCreate" class="modal-backdrop" @click.self="showCreate = false">
        <div class="modal-card">
          <header class="modal-head">
            <h3>{{ createParentId ? 'Thêm nhóm con' : 'Thêm nhóm quyền gốc' }}</h3>
            <button class="modal-close" @click="showCreate = false">×</button>
          </header>
          <div class="modal-body">
            <p v-if="createParentName" class="parent-hint">
              <span class="hint-label">Thuộc:</span><strong>{{ createParentName }}</strong>
            </p>
            <label class="form-label">Tên nhóm quyền</label>
            <input
              ref="nameInput"
              v-model="newName"
              placeholder="VD: Sale Cấp Cao"
              class="form-input"
              @keyup.enter="submitCreate"
            />
            <label class="form-label" style="margin-top: 14px">Sao chép quyền từ</label>
            <select v-model="cloneFromId" class="form-input">
              <option value="">— Tạo mới (chưa có quyền) —</option>
              <option v-for="g in flatGroupsList" :key="g.id" :value="g.id">
                {{ '— '.repeat(g._depth) }}{{ g.name }} ({{ grantsActive(g) }}/{{ totalSlots }})
              </option>
            </select>
            <p v-if="createError" class="form-error">{{ createError }}</p>
          </div>
          <footer class="modal-foot">
            <button class="btn-ghost" @click="showCreate = false">Hủy</button>
            <button class="btn-primary" :disabled="!newName.trim()" @click="submitCreate">
              Tạo nhóm
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRbacStore, type PermissionGroupNode, type RbacUser } from '@/stores/rbac';
import { api } from '@/api/index';

const store = useRbacStore();
const allUsers = ref<RbacUser[]>([]);
const searchQ = ref('');
const seeding = ref(false);
const saving = ref(false);
const justSaved = ref(false);
const copyFromId = ref('');

const selectedId = ref<string | null>(null);

onMounted(async () => {
  await Promise.all([
    store.loadPermissionGroups(),
    api.get('/rbac/users').then((r) => { allUsers.value = r.data.users ?? []; }).catch(() => {}),
  ]);
  // Auto-select first group
  if (store.permissionGroups.length > 0 && !selectedId.value) {
    selectedId.value = flatGroupsList.value[0]?.id ?? null;
  }
});

const resources = computed(() => store.matrixMeta?.resources ?? []);
const actions = computed(() => store.matrixMeta?.actions ?? []);
const resourceActions = computed(() => store.matrixMeta?.resourceActions ?? {});
const totalSlots = computed(() => {
  let total = 0;
  for (const r of resources.value) total += (resourceActions.value[r] ?? []).length;
  return total;
});

const memberCountsLive = computed(() => {
  const m: Record<string, number> = {};
  for (const u of allUsers.value) {
    if (u.permissionGroupId) m[u.permissionGroupId] = (m[u.permissionGroupId] ?? 0) + 1;
  }
  return m;
});

const flatGroupsList = computed(() => {
  const out: Array<PermissionGroupNode & { _depth: number }> = [];
  function walk(nodes: PermissionGroupNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.permissionGroups, 0);
  return out;
});

const filteredGroups = computed(() => {
  const q = searchQ.value.trim().toLowerCase();
  if (!q) return flatGroupsList.value;
  return flatGroupsList.value.filter((g) => g.name.toLowerCase().includes(q));
});

const selected = computed(() => flatGroupsList.value.find((g) => g.id === selectedId.value));

const copyableGroups = computed(() =>
  flatGroupsList.value.filter((g) => g.id !== selectedId.value)
);

const stats = computed(() => {
  let total = 0, system = 0, totalMembers = 0;
  for (const g of flatGroupsList.value) {
    total++;
    if (g.isSystem) system++;
    totalMembers += memberCountsLive.value[g.id] ?? 0;
  }
  return { total, system, totalMembers };
});

const loading = computed(() => store.loading);

watch(
  () => store.permissionGroups,
  async () => {
    try {
      const { data } = await api.get('/rbac/users');
      allUsers.value = data.users ?? [];
    } catch {}
  }
);

// ─── Labels ───
const ACTION_LABELS: Record<string, string> = {
  access: 'Truy cập',
  create: 'Thêm mới',
  edit: 'Chỉnh sửa',
  delete: 'Xóa',
  approve: 'Duyệt',
  pay: 'Thanh toán',
  view_all: 'Xem tất cả',
};
function actionLabel(a: string) { return ACTION_LABELS[a] ?? a; }

const RESOURCE_LABELS: Record<string, { icon: string; label: string }> = {
  department: { icon: '🏢', label: 'Phòng ban' },
  user: { icon: '👤', label: 'Người dùng' },
  permission_group: { icon: '🛡', label: 'Nhóm quyền' },
  conversation: { icon: '💬', label: 'Hội thoại' },
  contact: { icon: '👥', label: 'Khách hàng' },
  friend: { icon: '🫂', label: 'Friends Zalo' },
  customer_list: { icon: '📋', label: 'Tệp khách hàng' },
  broadcast: { icon: '📢', label: 'Chiến dịch' },
  sequence: { icon: '🔁', label: 'Sequence' },
  trigger: { icon: '⚡', label: 'Trigger' },
  block: { icon: '🧱', label: 'Message Block' },
  zalo_account: { icon: '🟢', label: 'Nick Zalo' },
  webhook: { icon: '🔌', label: 'Webhook' },
  engagement_score: { icon: '📊', label: 'Engagement / Score' },
  audit_log: { icon: '📜', label: 'Audit Log' },
  settings: { icon: '⚙', label: 'Cài đặt' },
};
function resourceLabel(r: string) { return RESOURCE_LABELS[r]?.label ?? r; }
function resourceIcon(r: string) { return RESOURCE_LABELS[r]?.icon ?? '•'; }

// ─── Grants helpers ───
function grantsActive(g: PermissionGroupNode): number {
  let count = 0;
  for (const r of resources.value) {
    const row = g.grants?.[r];
    if (!row) continue;
    for (const a of resourceActions.value[r] ?? []) {
      if (row[a]) count++;
    }
  }
  return count;
}
function grantsPct(g: PermissionGroupNode): number {
  if (totalSlots.value === 0) return 0;
  return Math.round((grantsActive(g) / totalSlots.value) * 100);
}
function grantsColor(pct: number): string {
  if (pct >= 80) return '#aa2d00';
  if (pct >= 50) return '#d9a441';
  if (pct >= 20) return '#1b61c9';
  if (pct > 0) return '#0a2e0e';
  return '#9297a0';
}
function accentByDepth(d: number): string {
  return ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(d, 4)];
}

function rowCount(r: string): number {
  if (!selected.value) return 0;
  const row = selected.value.grants?.[r];
  if (!row) return 0;
  let c = 0;
  for (const a of resourceActions.value[r] ?? []) if (row[a]) c++;
  return c;
}
function rowFull(r: string): boolean {
  const max = (resourceActions.value[r] ?? []).length;
  return max > 0 && rowCount(r) === max;
}
function rowEmpty(r: string): boolean {
  return rowCount(r) === 0;
}

// ─── Grant mutations (auto-save) ───
let saveTimer: any;
async function saveGrants(newGrants: Record<string, Record<string, boolean>>) {
  if (!selected.value) return;
  clearTimeout(saveTimer);
  saving.value = true;
  justSaved.value = false;
  try {
    await store.updateGroupGrants(selected.value.id, newGrants);
    justSaved.value = true;
    saveTimer = setTimeout(() => { justSaved.value = false; }, 1500);
  } catch (e: any) {
    alert(e?.response?.data?.error || 'Lỗi cập nhật quyền');
  } finally {
    saving.value = false;
  }
}

async function toggleGrant(r: string, a: string, v: boolean) {
  if (!selected.value) return;
  const newGrants = JSON.parse(JSON.stringify(selected.value.grants ?? {}));
  if (!newGrants[r]) newGrants[r] = {};
  newGrants[r][a] = v;
  await saveGrants(newGrants);
}

async function tickAll(value: boolean) {
  if (!selected.value) return;
  if (value && !confirm(`Tick TẤT CẢ quyền cho nhóm "${selected.value.name}"?`)) return;
  if (!value && !confirm(`Bỏ tick TẤT CẢ quyền cho nhóm "${selected.value.name}"?`)) return;
  const newGrants: Record<string, Record<string, boolean>> = {};
  for (const r of resources.value) {
    newGrants[r] = {};
    for (const a of resourceActions.value[r] ?? []) {
      newGrants[r][a] = value;
    }
  }
  await saveGrants(newGrants);
}

async function tickRow(r: string) {
  if (!selected.value) return;
  const newGrants = JSON.parse(JSON.stringify(selected.value.grants ?? {}));
  const allOn = rowFull(r);
  newGrants[r] = newGrants[r] ?? {};
  for (const a of resourceActions.value[r] ?? []) {
    newGrants[r][a] = !allOn;
  }
  await saveGrants(newGrants);
}

async function tickColumn(a: string) {
  if (!selected.value) return;
  const newGrants = JSON.parse(JSON.stringify(selected.value.grants ?? {}));
  // Check if column fully on
  let allOn = true;
  for (const r of resources.value) {
    if (!(resourceActions.value[r] ?? []).includes(a)) continue;
    if (!newGrants[r]?.[a]) { allOn = false; break; }
  }
  for (const r of resources.value) {
    if (!(resourceActions.value[r] ?? []).includes(a)) continue;
    if (!newGrants[r]) newGrants[r] = {};
    newGrants[r][a] = !allOn;
  }
  await saveGrants(newGrants);
}

async function doCopyFrom() {
  if (!selected.value || !copyFromId.value) return;
  const src = flatGroupsList.value.find((g) => g.id === copyFromId.value);
  if (!src) return;
  if (!confirm(`Sao chép quyền từ "${src.name}" sang "${selected.value.name}"? Sẽ ghi đè quyền hiện tại của ${selected.value.name}.`)) return;
  const newGrants = JSON.parse(JSON.stringify(src.grants ?? {}));
  await saveGrants(newGrants);
  copyFromId.value = '';
}

async function confirmArchive() {
  if (!selected.value) return;
  if (!confirm(`Xóa nhóm "${selected.value.name}"? Chỉ xóa được khi nhóm rỗng.`)) return;
  try {
    await api.delete(`/permission-groups/${selected.value.id}`);
    await store.loadPermissionGroups();
    selectedId.value = flatGroupsList.value[0]?.id ?? null;
  } catch (e: any) {
    alert(e?.response?.data?.error || 'Lỗi xóa nhóm');
  }
}

// ─── Create modal ───
const showCreate = ref(false);
const createParentId = ref<string | null>(null);
const createParentName = ref('');
const newName = ref('');
const cloneFromId = ref('');
const createError = ref('');
const nameInput = ref<HTMLInputElement | null>(null);

function openCreate(parent: PermissionGroupNode | null) {
  createParentId.value = parent?.id ?? null;
  createParentName.value = parent?.name ?? '';
  newName.value = '';
  cloneFromId.value = '';
  createError.value = '';
  showCreate.value = true;
  setTimeout(() => nameInput.value?.focus(), 50);
}
async function submitCreate() {
  if (!newName.value.trim()) return;
  try {
    await store.createPermissionGroup({
      name: newName.value.trim(),
      parentId: createParentId.value,
      cloneFromId: cloneFromId.value || undefined,
    });
    showCreate.value = false;
    // Auto-select newly created group
    const newest = flatGroupsList.value[flatGroupsList.value.length - 1];
    if (newest) selectedId.value = newest.id;
  } catch (e: any) {
    createError.value = e?.response?.data?.error || 'Lỗi tạo nhóm';
  }
}

async function seedDefaults() {
  seeding.value = true;
  try {
    await store.seedDefaultGroups();
    const { data } = await api.get('/rbac/users');
    allUsers.value = data.users ?? [];
    if (!selectedId.value) selectedId.value = flatGroupsList.value[0]?.id ?? null;
  } catch (e: any) {
    alert(e?.response?.data?.error || 'Lỗi seed');
  } finally {
    seeding.value = false;
  }
}
</script>

<style>
/* PermissionGroupsView — Getfly-style 2-col layout + Airtable theme */

.hero-actions { display: flex; gap: 8px; }

.pg-layout {
  display: grid;
  grid-template-columns: 290px 1fr;
  gap: 16px;
  background: white;
  border: 1px solid #e0e2e6;
  border-radius: 12px;
  overflow: hidden;
  min-height: 600px;
  box-shadow: 0 1px 3px rgba(24,29,38,0.04);
}

/* ── Left sidebar ── */
.pg-sidebar {
  background: #f8fafc;
  border-right: 1px solid #e0e2e6;
  display: flex;
  flex-direction: column;
}
.pg-sidebar-head {
  padding: 14px 14px 10px;
  border-bottom: 1px solid #e0e2e6;
}
.pg-group-list {
  list-style: none;
  padding: 8px;
  margin: 0;
  flex: 1;
  overflow-y: auto;
}
.pg-group-item {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.1s;
  align-items: stretch;
  margin-bottom: 4px;
  background: white;
  border: 1px solid transparent;
}
.pg-group-item:hover { background: #fdfdfd; border-color: #e0e2e6; }
.pg-group-item.active {
  background: white;
  border-color: #181d26;
  box-shadow: 0 2px 8px rgba(24,29,38,0.08);
}
.pg-accent-strip {
  width: 4px;
  border-radius: 2px;
  flex-shrink: 0;
}
.pg-group-body { flex: 1; min-width: 0; }
.pg-group-name {
  font-size: 13px;
  font-weight: 600;
  color: #181d26;
  line-height: 1.3;
  margin-bottom: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pg-indent-arrow {
  color: #c9ccd1;
  font-family: 'JetBrains Mono', monospace;
  margin-right: 4px;
}
.pg-group-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.chip-xs { font-size: 9px !important; padding: 2px 6px !important; }
.pg-count { font-size: 10px; color: #41454d; font-weight: 500; }
.pg-grants-mini { font-size: 10px; font-weight: 700; font-variant-numeric: tabular-nums; }

.pg-add-btn {
  margin: 12px;
  background: white;
  border: 1px dashed #9297a0;
  color: #41454d;
  padding: 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.1s;
}
.pg-add-btn:hover { border-color: #181d26; color: #181d26; background: #f8fafc; }

/* ── Right pane ── */
.pg-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.pg-matrix-head {
  padding: 16px 20px;
  border-bottom: 1px solid #e0e2e6;
  background: white;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  flex-wrap: wrap;
}
.pg-matrix-title {
  display: flex;
  gap: 12px;
  align-items: stretch;
  min-width: 0;
}
.pg-matrix-title .pg-accent-strip { width: 5px; height: 44px; }
.pg-name-big {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 6px;
  color: #181d26;
  letter-spacing: -0.01em;
}
.pg-name-meta {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.pg-matrix-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
.pg-copy-select {
  min-width: 220px;
  font-size: 12px;
}
.btn-sm {
  font-size: 12px !important;
  padding: 7px 12px !important;
}

/* ── Matrix table ── */
.pg-matrix-wrap {
  overflow: auto;
  flex: 1;
  background: white;
}
.pg-matrix {
  width: 100%;
  border-collapse: separate;
  border-spacing: 0;
  font-size: 12px;
}
.pg-matrix thead th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  padding: 10px 8px;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #41454d;
  border-bottom: 2px solid #e0e2e6;
  text-align: center;
  white-space: nowrap;
  z-index: 2;
}
.pg-matrix thead .th-resource {
  text-align: left;
  padding-left: 20px;
  min-width: 220px;
  position: sticky;
  left: 0;
  z-index: 3;
  background: #f8fafc;
}
.pg-matrix thead .th-action {
  min-width: 96px;
}
.th-action-label {
  font-size: 11px;
  font-weight: 700;
  color: #181d26;
  margin-bottom: 4px;
}
.th-bulk-btn {
  background: white;
  border: 1px solid #dddddd;
  color: #41454d;
  font-size: 9px;
  font-weight: 500;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.3px;
  transition: all 0.1s;
}
.th-bulk-btn:hover { background: #181d26; color: white; border-color: #181d26; }
.pg-matrix thead .th-row-bulk { min-width: 70px; }

.pg-matrix tbody tr {
  transition: background 0.1s;
}
.pg-matrix tbody tr:hover { background: #f8fafc; }
.pg-matrix tbody tr.row-full { background: #f0f9f1; }
.pg-matrix tbody tr.row-full:hover { background: #e6f3e7; }
.pg-matrix tbody tr.row-empty .cell-resource { color: #9297a0; }

.pg-matrix tbody td {
  padding: 8px;
  border-bottom: 1px solid #f0f1f3;
  text-align: center;
  vertical-align: middle;
}
.pg-matrix tbody tr:last-child td { border-bottom: 0; }

.cell-resource {
  text-align: left !important;
  padding: 10px 20px !important;
  position: sticky;
  left: 0;
  background: white;
  font-weight: 500;
  color: #181d26;
  display: flex;
  align-items: center;
  gap: 8px;
  z-index: 1;
}
.pg-matrix tbody tr:hover .cell-resource { background: #f8fafc; }
.pg-matrix tbody tr.row-full .cell-resource { background: #f0f9f1; }
.pg-matrix tbody tr.row-full:hover .cell-resource { background: #e6f3e7; }
.resource-icon { font-size: 14px; width: 22px; text-align: center; flex-shrink: 0; }
.resource-label { flex: 1; }
.resource-count {
  font-size: 10px;
  color: #9297a0;
  font-variant-numeric: tabular-nums;
  background: #f0f1f3;
  padding: 2px 8px;
  border-radius: 9999px;
  font-weight: 500;
}
.pg-matrix tbody tr.row-full .resource-count {
  background: #d8ecda;
  color: #0a2e0e;
  font-weight: 600;
}

/* Airtable checkbox */
.at-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  position: relative;
}
.at-checkbox input { position: absolute; opacity: 0; pointer-events: none; }
.at-checkbox-box {
  width: 22px;
  height: 22px;
  border: 1.5px solid #c9ccd1;
  border-radius: 5px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  color: transparent;
  font-size: 14px;
  font-weight: 700;
  transition: all 0.1s;
}
.at-checkbox:hover .at-checkbox-box { border-color: #9297a0; }
.at-checkbox.checked .at-checkbox-box {
  background: #0a2e0e;
  border-color: #0a2e0e;
  color: white;
}
.at-checkbox.checked:hover .at-checkbox-box { background: #07210a; }
.at-checkbox input:disabled + .at-checkbox-box { opacity: 0.5; cursor: not-allowed; }
.cell-na { color: #c9ccd1; font-size: 14px; }

.cell-row-bulk { width: 70px; }

/* Save bar */
.pg-save-bar {
  padding: 10px 20px;
  border-top: 1px solid #e0e2e6;
  background: #f8fafc;
  font-size: 12px;
  color: #41454d;
  display: flex;
  align-items: center;
  gap: 8px;
}
.pg-save-bar.is-saving { color: #1b61c9; background: #eef4fc; }
.pg-save-bar.is-saved { color: #0a2e0e; background: #e3ede4; }
.pg-save-hint { color: #9297a0; font-style: italic; }

/* Danger zone */
.pg-danger-zone {
  margin: 0 20px 20px;
  padding: 16px;
  background: #fbe6dc;
  border: 1px solid rgba(170,45,0,0.2);
  border-radius: 10px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
}
.pg-danger-zone strong { color: #7a2000; font-size: 13px; }
.pg-danger-hint { font-size: 11px; color: #41454d; margin: 4px 0 0; }
.btn-danger {
  background: white;
  border: 1px solid #aa2d00;
  color: #aa2d00;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}
.btn-danger:hover { background: #aa2d00; color: white; }
</style>
