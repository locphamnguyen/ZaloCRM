<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <Transition name="panel-slide">
    <div v-if="open" class="panel-backdrop" @click.self="$emit('close')">
      <aside class="panel">
        <header class="panel-head">
          <div class="head-left">
            <div class="head-accent" :style="{ background: accentColor }"></div>
            <div>
              <div class="head-eyebrow">Nhóm quyền</div>
              <h2 class="head-title">{{ localName || '...' }}</h2>
            </div>
          </div>
          <button class="panel-close" @click="$emit('close')">×</button>
        </header>

        <div class="panel-body">
          <!-- ── Info section ─────────────────────── -->
          <section class="section">
            <h3 class="section-title">Thông tin</h3>
            <label class="field-label">Tên nhóm quyền</label>
            <input
              v-model="localName"
              class="field-input"
              :disabled="isSystem || busy"
              @blur="saveName"
              @keyup.enter="saveName"
            />
            <div v-if="isSystem" class="parent-hint hint-warning">
              <span class="hint-label">Hệ thống:</span>
              <strong>Nhóm mặc định — chỉ sửa được ô tick quyền, không đổi tên/xóa.</strong>
            </div>
            <div v-else-if="parentName" class="parent-hint">
              <span class="hint-label">Thuộc:</span>
              <strong>{{ parentName }}</strong>
            </div>
          </section>

          <!-- ── Permission matrix ─────────────────── -->
          <section class="section">
            <div class="section-title-row">
              <h3 class="section-title">Ma trận quyền</h3>
              <div class="matrix-stats">
                <span class="stat-chip stat-on">{{ totalChecked }} / {{ totalSlots }} bật</span>
              </div>
            </div>

            <!-- Bulk actions -->
            <div class="bulk-row">
              <button class="btn-bulk" :disabled="busy" @click="bulkAll(true)">✓ Tick tất cả</button>
              <button class="btn-bulk" :disabled="busy" @click="bulkAll(false)">× Bỏ tất cả</button>
              <span class="bulk-sep">|</span>
              <span class="bulk-hint">Click checkbox để toggle từng ô. Tick header để bật cả cột.</span>
            </div>

            <div class="matrix-wrap">
              <table class="matrix">
                <thead>
                  <tr>
                    <th class="th-resource">Chức năng</th>
                    <th
                      v-for="a in actions"
                      :key="a"
                      class="th-action"
                      :title="`Click để tick / bỏ cả cột ${actionLabel(a)}`"
                      @click="!busy && bulkColumn(a, !isColumnAllOn(a))"
                    >
                      <span class="th-label">{{ actionLabel(a) }}</span>
                      <span class="th-toggle">{{ isColumnAllOn(a) ? '✓' : '·' }}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="r in resources" :key="r" class="resource-row">
                    <td class="td-resource">
                      <span class="resource-name">{{ resourceLabel(r) }}</span>
                      <button
                        class="btn-row-toggle"
                        :disabled="busy"
                        :title="`Tick / bỏ cả dòng ${resourceLabel(r)}`"
                        @click="bulkRow(r, !isRowAllOn(r))"
                      >
                        {{ isRowAllOn(r) ? '✓' : '·' }}
                      </button>
                    </td>
                    <td v-for="a in actions" :key="a" class="td-check">
                      <input
                        v-if="(resourceActions[r] ?? []).includes(a)"
                        type="checkbox"
                        :checked="!!localGrants[r]?.[a]"
                        :disabled="busy"
                        @change="toggleGrant(r, a, ($event.target as HTMLInputElement).checked)"
                      />
                      <span v-else class="dash">—</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <!-- ── Members list ─────────────────────── -->
          <section class="section">
            <div class="section-title-row">
              <h3 class="section-title">Thành viên ({{ members.length }})</h3>
            </div>
            <ul v-if="members.length" class="member-list">
              <li v-for="m in members" :key="m.id" class="member-row">
                <span class="member-avatar" :style="{ background: avatarColor(m.fullName) }">
                  {{ initials(m.fullName) }}
                </span>
                <div class="member-info">
                  <div class="member-name">{{ m.fullName }}</div>
                  <div class="member-email">{{ m.email }}</div>
                </div>
                <button
                  class="btn-remove-member"
                  :disabled="busy"
                  title="Bỏ gán nhóm này"
                  @click="unassignUser(m.id)"
                >×</button>
              </li>
            </ul>
            <div v-else class="empty-members">
              Chưa có user nào dùng nhóm quyền này.
            </div>
          </section>

          <!-- ── Danger zone ─────────────────────── -->
          <section v-if="!isSystem" class="section section-danger">
            <h3 class="section-title danger-title">Vùng nguy hiểm</h3>
            <p class="danger-desc">
              Xóa nhóm quyền — chỉ khi không còn user nào đang gán. Khôi phục bằng cách tạo lại.
            </p>
            <button class="btn-danger" :disabled="busy || members.length > 0" @click="confirmArchive">
              🗑 Xóa nhóm quyền
            </button>
            <p v-if="members.length > 0" class="danger-warn">
              Còn {{ members.length }} user — bỏ gán hết trước khi xóa.
            </p>
          </section>
        </div>

        <p v-if="error" class="panel-error">{{ error }}</p>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRbacStore, type PermissionGroupNode, type RbacUser } from '@/stores/rbac';
import { api } from '@/api/index';

const props = defineProps<{
  open: boolean;
  node: (PermissionGroupNode & { _depth?: number }) | null;
  parentName?: string | null;
  allUsers: RbacUser[];
}>();
const emit = defineEmits<{ close: []; archived: [] }>();

const store = useRbacStore();
const busy = ref(false);
const error = ref('');

const localName = ref('');
const localGrants = ref<Record<string, Record<string, boolean>>>({});

const isSystem = computed(() => !!props.node?.isSystem);

const accentColor = computed(() => {
  const depth = props.node?._depth ?? 0;
  return ['#181d26', '#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9'][Math.min(depth, 4)];
});

const resources = computed(() => store.matrixMeta?.resources ?? []);
const actions = computed(() => store.matrixMeta?.actions ?? []);
const resourceActions = computed(() => store.matrixMeta?.resourceActions ?? {});

const members = computed(() =>
  props.allUsers.filter((u) => u.permissionGroupId === props.node?.id)
);

const totalSlots = computed(() => {
  let total = 0;
  for (const r of resources.value) total += (resourceActions.value[r] ?? []).length;
  return total;
});

const totalChecked = computed(() => {
  let total = 0;
  for (const r of resources.value) {
    for (const a of resourceActions.value[r] ?? []) {
      if (localGrants.value[r]?.[a]) total++;
    }
  }
  return total;
});

function isRowAllOn(r: string) {
  const acts = resourceActions.value[r] ?? [];
  if (acts.length === 0) return false;
  return acts.every((a) => localGrants.value[r]?.[a]);
}

function isColumnAllOn(a: string) {
  const validResources = resources.value.filter((r) => (resourceActions.value[r] ?? []).includes(a));
  if (validResources.length === 0) return false;
  return validResources.every((r) => localGrants.value[r]?.[a]);
}

watch(
  () => [props.open, props.node?.id],
  () => {
    if (!props.open || !props.node) return;
    localName.value = props.node.name;
    localGrants.value = JSON.parse(JSON.stringify(props.node.grants ?? {}));
    error.value = '';
  },
  { immediate: true }
);

async function saveName() {
  if (!props.node || isSystem.value) return;
  if (!localName.value.trim() || localName.value === props.node.name) return;
  busy.value = true;
  try {
    await api.patch(`/permission-groups/${props.node.id}`, { name: localName.value.trim() });
    await store.loadPermissionGroups();
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi tên';
    localName.value = props.node.name;
  } finally {
    busy.value = false;
  }
}

async function persistGrants() {
  if (!props.node) return;
  busy.value = true;
  error.value = '';
  try {
    await store.updateGroupGrants(props.node.id, localGrants.value);
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi cập nhật quyền';
  } finally {
    busy.value = false;
  }
}

async function toggleGrant(resource: string, action: string, value: boolean) {
  if (!localGrants.value[resource]) localGrants.value[resource] = {};
  localGrants.value[resource][action] = value;
  await persistGrants();
}

async function bulkAll(value: boolean) {
  for (const r of resources.value) {
    if (!localGrants.value[r]) localGrants.value[r] = {};
    for (const a of resourceActions.value[r] ?? []) {
      localGrants.value[r][a] = value;
    }
  }
  await persistGrants();
}

async function bulkRow(r: string, value: boolean) {
  if (!localGrants.value[r]) localGrants.value[r] = {};
  for (const a of resourceActions.value[r] ?? []) {
    localGrants.value[r][a] = value;
  }
  await persistGrants();
}

async function bulkColumn(a: string, value: boolean) {
  for (const r of resources.value) {
    if (!(resourceActions.value[r] ?? []).includes(a)) continue;
    if (!localGrants.value[r]) localGrants.value[r] = {};
    localGrants.value[r][a] = value;
  }
  await persistGrants();
}

async function unassignUser(userId: string) {
  busy.value = true;
  try {
    await store.setUserPermissionGroup(userId, null);
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi bỏ gán';
  } finally {
    busy.value = false;
  }
}

async function confirmArchive() {
  if (!props.node) return;
  if (!confirm(`Xóa nhóm quyền "${props.node.name}"?`)) return;
  busy.value = true;
  try {
    await api.delete(`/permission-groups/${props.node.id}`);
    await store.loadPermissionGroups();
    emit('archived');
    emit('close');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi xóa';
  } finally {
    busy.value = false;
  }
}

const ACTION_LABELS: Record<string, string> = {
  access: 'Truy cập',
  create: 'Thêm',
  edit: 'Sửa',
  delete: 'Xóa',
  approve: 'Duyệt',
  pay: 'TT',
  view_all: 'Xem all',
};
function actionLabel(a: string) {
  return ACTION_LABELS[a] ?? a;
}

const RESOURCE_LABELS: Record<string, string> = {
  department: 'Quản lý phòng ban',
  user: 'Quản lý người dùng',
  permission_group: 'Quản lý quyền',
  conversation: 'Hội thoại',
  contact: 'Khách hàng',
  friend: 'Friends Zalo',
  customer_list: 'Tệp khách hàng',
  broadcast: 'Chiến dịch',
  sequence: 'Sequence',
  trigger: 'Trigger',
  block: 'Message Block',
  zalo_account: 'Nick Zalo',
  webhook: 'Webhook',
  engagement_score: 'Engagement / Score',
  audit_log: 'Audit Log',
  settings: 'Cài đặt',
};
function resourceLabel(r: string) {
  return RESOURCE_LABELS[r] ?? r;
}

function initials(name: string): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function avatarColor(name: string): string {
  const colors = ['#aa2d00', '#0a2e0e', '#d9a441', '#1b61c9', '#7a2000', '#1a3866'];
  const h = (name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[h % colors.length];
}
</script>

<style>
/* PermissionGroupEditPanel — reuse pattern from DepartmentEditPanel */
/* Most classes shared via DepartmentEditPanel's non-scoped styles. */
/* Adds matrix-specific styles only. */

.matrix-stats { display: flex; gap: 6px; }
.stat-chip {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 9999px;
  background: #f0f1f3;
  color: #41454d;
}
.stat-chip.stat-on { background: #e3ede4; color: #0a2e0e; }

.bulk-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.btn-bulk {
  background: white;
  border: 1px dashed #9297a0;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  color: #41454d;
}
.btn-bulk:hover { background: #181d26; color: white; border-color: #181d26; border-style: solid; }
.btn-bulk:disabled { opacity: 0.4; cursor: not-allowed; }
.bulk-sep { color: #d6d8dc; font-size: 11px; }
.bulk-hint { font-size: 10px; color: #9297a0; font-style: italic; }

.matrix-wrap {
  border: 1px solid #e0e2e6;
  border-radius: 8px;
  overflow: hidden;
  background: white;
}
.matrix {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}
.matrix th, .matrix td {
  border-bottom: 1px solid #f0f1f3;
  border-right: 1px solid #f0f1f3;
}
.matrix th:last-child, .matrix td:last-child { border-right: 0; }
.matrix tr:last-child td { border-bottom: 0; }

.th-resource {
  background: #f8fafc;
  padding: 8px 10px;
  text-align: left;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #41454d;
  position: sticky;
  left: 0;
  z-index: 1;
}
.th-action {
  background: #f8fafc;
  padding: 6px 4px;
  text-align: center;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s;
}
.th-action:hover { background: #f0f1f3; }
.th-label {
  display: block;
  font-size: 10px;
  font-weight: 600;
  color: #41454d;
  margin-bottom: 2px;
}
.th-toggle {
  display: inline-block;
  font-size: 11px;
  font-weight: 700;
  color: #0a2e0e;
  width: 14px;
  height: 14px;
  line-height: 14px;
}

.resource-row:hover { background: #fafbfc; }
.td-resource {
  padding: 6px 10px;
  background: white;
  position: sticky;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.resource-name {
  font-size: 12px;
  color: #181d26;
  font-weight: 500;
}
.btn-row-toggle {
  background: white;
  border: 1px solid #e0e2e6;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  color: #0a2e0e;
  line-height: 1;
  flex-shrink: 0;
}
.btn-row-toggle:hover { background: #0a2e0e; color: white; border-color: #0a2e0e; }
.btn-row-toggle:disabled { opacity: 0.4; cursor: not-allowed; }
.td-check {
  padding: 6px 4px;
  text-align: center;
}
.td-check input[type="checkbox"] {
  width: 14px;
  height: 14px;
  cursor: pointer;
  accent-color: #0a2e0e;
}
.dash { color: #d6d8dc; font-size: 11px; }

.hint-warning { background: #fbe6dc !important; border-left-color: #aa2d00 !important; color: #7a2000 !important; }

.danger-warn {
  margin: 8px 0 0;
  font-size: 11px;
  color: #7a2000;
  font-style: italic;
}
</style>
