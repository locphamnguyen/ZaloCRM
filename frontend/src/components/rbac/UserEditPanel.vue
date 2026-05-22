<template>
  <Transition name="panel-slide">
    <div v-if="open" class="panel-backdrop" @click.self="$emit('close')">
      <aside class="panel">
        <header class="panel-head">
          <div class="head-left">
            <span class="card-avatar-lg" :style="{ background: avatarColor(user?.fullName ?? user?.email ?? '') }">
              {{ initials(user?.fullName ?? user?.email ?? '?') }}
            </span>
            <div>
              <div class="head-eyebrow">Nhân viên</div>
              <h2 class="head-title">{{ user?.fullName || user?.email || '...' }}</h2>
            </div>
          </div>
          <button class="panel-close" @click="$emit('close')">×</button>
        </header>

        <div class="panel-body">
          <!-- ── Info section ─────────────────────── -->
          <section class="section">
            <h3 class="section-title">Thông tin</h3>
            <label class="field-label">Họ tên</label>
            <input
              v-model="localFullName"
              class="field-input"
              :disabled="!canEditInfo || busy"
              @blur="saveFullName"
              @keyup.enter="saveFullName"
            />
            <label class="field-label">Email</label>
            <input
              v-model="localEmail"
              type="email"
              class="field-input"
              :disabled="!canEditInfo || busy"
              @blur="saveEmail"
              @keyup.enter="saveEmail"
            />
            <div class="info-status-row">
              <span class="role-tag" :class="user?.isActive ? 'role-deputy' : 'role-empty-tag'">
                {{ user?.isActive ? '🟢 Đang hoạt động' : '⚪ Đã vô hiệu hóa' }}
              </span>
              <span class="role-tag" :class="`role-legacy-${user?.role}`">
                {{ legacyRoleLabel(user?.role) }}
              </span>
            </div>
          </section>

          <!-- ── Department ──────────────────────── -->
          <section class="section">
            <h3 class="section-title">Phòng ban</h3>
            <label class="field-label">Phòng ban</label>
            <select v-model="deptIdLocal" class="field-input" :disabled="busy" @change="onDeptChange">
              <option value="">— Không thuộc phòng nào —</option>
              <option v-for="d in flatDepts" :key="d.id" :value="d.id">
                {{ '— '.repeat(d._depth) }}{{ d.name }}
              </option>
            </select>
            <label v-if="deptIdLocal" class="field-label">Vai trò trong phòng</label>
            <select
              v-if="deptIdLocal"
              v-model="deptRoleLocal"
              class="field-input"
              :disabled="busy"
              @change="onDeptRoleChange"
            >
              <option value="member">👤 Nhân viên</option>
              <option value="deputy">🎖️ Phó phòng</option>
              <option value="leader">👑 Trưởng phòng</option>
            </select>
            <p v-if="deptIdLocal" class="hint-soft">
              <strong>Lưu ý:</strong> Mỗi phòng chỉ có 1 Trưởng phòng + 1 Phó phòng. Nếu vị trí đã có người giữ, bạn phải bỏ chức vụ của họ trước (tại trang Sơ đồ tổ chức) rồi mới gán cho người khác.
            </p>
          </section>

          <!-- ── Permission group ──────────────────── -->
          <section class="section">
            <h3 class="section-title">Nhóm quyền</h3>
            <label class="field-label">Gán nhóm quyền</label>
            <select v-model="pgIdLocal" class="field-input" :disabled="busy" @change="onPgChange">
              <option value="">— Chưa gán —</option>
              <option v-for="g in flatGroups" :key="g.id" :value="g.id">
                {{ '— '.repeat(g._depth) }}{{ g.name }}{{ g.isSystem ? ' (hệ thống)' : '' }}
              </option>
            </select>
            <div v-if="currentGroup" class="group-preview">
              <div class="preview-head">
                <span class="role-tag role-leader">🛡 {{ currentGroup.name }}</span>
                <span class="preview-stat">{{ activeGrantsCount }} quyền active</span>
              </div>
              <p class="preview-desc">
                Xem chi tiết quyền của nhóm này tại
                <RouterLink class="link" to="/settings/rbac/permission-groups">Phân quyền</RouterLink>.
              </p>
            </div>
          </section>

          <!-- ── Nicks owned ─────────────────────── -->
          <section class="section">
            <div class="section-title-row">
              <h3 class="section-title">Nick Zalo sở hữu ({{ ownedNicks.length }})</h3>
            </div>
            <ul v-if="ownedNicks.length" class="member-list">
              <li v-for="n in ownedNicks" :key="n.id" class="member-row">
                <span class="member-avatar" :style="{ background: avatarColor(n.displayName || 'Nick') }">
                  {{ initials(n.displayName || 'Nick') }}
                </span>
                <div class="member-info">
                  <div class="member-name">{{ n.displayName || '(chưa đặt tên)' }}</div>
                  <div class="member-email">{{ n.phone || n.zaloUid || '—' }} · {{ statusLabel(n.status) }}</div>
                </div>
                <span class="member-role-tag role-tag-leader">Owner</span>
              </li>
            </ul>
            <div v-else class="empty-members">
              User này chưa sở hữu nick Zalo nào.
            </div>
            <p class="hint-soft">
              Quản lý quyền truy cập nick khác qua trang
              <RouterLink class="link" to="/zalo-accounts">Nick Zalo</RouterLink>.
            </p>
          </section>

          <!-- ── Danger zone ─────────────────────── -->
          <section v-if="canDeactivate" class="section section-danger">
            <h3 class="section-title danger-title">Vùng nguy hiểm</h3>
            <p class="danger-desc" v-if="user?.isActive">
              Vô hiệu hóa user — user sẽ không thể đăng nhập. Có thể khôi phục sau bằng cách kích hoạt lại từ DB.
            </p>
            <p class="danger-desc" v-else>
              User đang ở trạng thái <strong>vô hiệu hóa</strong>. Nhấn 'Kích hoạt lại' để cho phép đăng nhập.
            </p>
            <button
              v-if="user?.isActive"
              class="btn-danger"
              :disabled="busy"
              @click="confirmDeactivate"
            >
              🚫 Vô hiệu hóa user
            </button>
            <button v-else class="btn-primary-sm" :disabled="busy" @click="confirmReactivate">
              ✓ Kích hoạt lại
            </button>
          </section>
        </div>

        <p v-if="error" class="panel-error">{{ error }}</p>
      </aside>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  useRbacStore,
  type RbacUser,
  type DepartmentNode,
  type PermissionGroupNode,
} from '@/stores/rbac';
import { api } from '@/api/index';

interface OwnedNick {
  id: string;
  displayName: string | null;
  phone: string | null;
  status: string;
  zaloUid: string | null;
}

const props = defineProps<{
  open: boolean;
  user: RbacUser | null;
  currentUserId: string;
  currentUserRole: string;
}>();
const emit = defineEmits<{ close: []; changed: [] }>();

const store = useRbacStore();
const busy = ref(false);
const error = ref('');

const localFullName = ref('');
const localEmail = ref('');
const deptIdLocal = ref<string>('');
const deptRoleLocal = ref<'leader' | 'deputy' | 'member'>('member');
const pgIdLocal = ref<string>('');
const ownedNicks = ref<OwnedNick[]>([]);

const canEditInfo = computed(() => {
  const u = props.user;
  if (!u) return false;
  // Owner edits self always; owner/admin edits anyone
  if (u.id === props.currentUserId) return true;
  return ['owner', 'admin'].includes(props.currentUserRole);
});
const canDeactivate = computed(() => {
  return props.currentUserRole === 'owner' && props.user?.id !== props.currentUserId;
});

const flatDepts = computed(() => {
  const out: Array<DepartmentNode & { _depth: number }> = [];
  function walk(nodes: DepartmentNode[], depth: number) {
    for (const n of nodes) {
      out.push({ ...n, _depth: depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  }
  walk(store.departments, 0);
  return out;
});
const flatGroups = computed(() => {
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

const currentGroup = computed(() =>
  pgIdLocal.value ? flatGroups.value.find((g) => g.id === pgIdLocal.value) : null
);
const activeGrantsCount = computed(() => {
  const grp = currentGroup.value;
  if (!grp || !store.matrixMeta) return 0;
  let n = 0;
  for (const r of store.matrixMeta.resources) {
    for (const a of store.matrixMeta.resourceActions[r] ?? []) {
      if (grp.grants[r]?.[a]) n++;
    }
  }
  return n;
});

watch(
  () => [props.open, props.user?.id],
  async () => {
    if (!props.open || !props.user) return;
    localFullName.value = props.user.fullName ?? '';
    localEmail.value = props.user.email ?? '';
    deptIdLocal.value = props.user.departmentMember?.departmentId ?? '';
    deptRoleLocal.value = props.user.departmentMember?.deptRole ?? 'member';
    pgIdLocal.value = props.user.permissionGroupId ?? '';
    error.value = '';
    ownedNicks.value = [];
    // Load owned nicks
    try {
      const { data } = await api.get('/zalo-accounts');
      const all: any[] = Array.isArray(data) ? data : data.accounts ?? [];
      ownedNicks.value = all
        .filter((a) => a.owner?.id === props.user!.id || a.ownerUserId === props.user!.id)
        .map((a) => ({
          id: a.id,
          displayName: a.displayName,
          phone: a.phone,
          status: a.liveStatus || a.status,
          zaloUid: a.zaloUid,
        }));
    } catch {
      ownedNicks.value = [];
    }
  },
  { immediate: true }
);

async function saveFullName() {
  if (!props.user || !canEditInfo.value) return;
  const trimmed = localFullName.value.trim();
  if (!trimmed || trimmed === props.user.fullName) return;
  busy.value = true;
  try {
    await api.put(`/users/${props.user.id}`, { fullName: trimmed });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi họ tên';
    localFullName.value = props.user.fullName;
  } finally {
    busy.value = false;
  }
}

async function saveEmail() {
  if (!props.user || !canEditInfo.value) return;
  const trimmed = localEmail.value.trim();
  if (!trimmed || trimmed === props.user.email) return;
  busy.value = true;
  try {
    await api.put(`/users/${props.user.id}`, { email: trimmed });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi email';
    localEmail.value = props.user.email;
  } finally {
    busy.value = false;
  }
}

async function onDeptChange() {
  if (!props.user) return;
  // Empty = remove from current dept (no API support for explicit remove without endpoint).
  // Workaround: if user had a dept and selected '' → call DELETE on /departments/:old/members/:userId
  const oldDeptId = props.user.departmentMember?.departmentId;
  busy.value = true;
  try {
    if (!deptIdLocal.value && oldDeptId) {
      await api.delete(`/departments/${oldDeptId}/members/${props.user.id}`);
      await store.loadUsers();
      emit('changed');
    } else if (deptIdLocal.value) {
      await store.assignMember(deptIdLocal.value, props.user.id, deptRoleLocal.value);
      emit('changed');
    }
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi phòng ban';
  } finally {
    busy.value = false;
  }
}

async function onDeptRoleChange() {
  if (!props.user || !deptIdLocal.value) return;
  busy.value = true;
  try {
    await store.assignMember(deptIdLocal.value, props.user.id, deptRoleLocal.value);
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi chức vụ';
  } finally {
    busy.value = false;
  }
}

async function onPgChange() {
  if (!props.user) return;
  busy.value = true;
  try {
    await store.setUserPermissionGroup(props.user.id, pgIdLocal.value || null);
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi nhóm quyền';
  } finally {
    busy.value = false;
  }
}

async function confirmDeactivate() {
  if (!props.user) return;
  if (!confirm(`Vô hiệu hóa user "${props.user.fullName || props.user.email}"? User sẽ không đăng nhập được.`)) return;
  busy.value = true;
  try {
    await api.delete(`/users/${props.user.id}`);
    emit('changed');
    emit('close');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi vô hiệu hóa';
  } finally {
    busy.value = false;
  }
}

async function confirmReactivate() {
  if (!props.user) return;
  busy.value = true;
  try {
    await api.put(`/users/${props.user.id}`, { isActive: true });
    emit('changed');
    emit('close');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi kích hoạt';
  } finally {
    busy.value = false;
  }
}

function legacyRoleLabel(r?: string) {
  return r === 'owner' ? 'Chủ tổ chức' : r === 'admin' ? 'Quản trị' : 'Thành viên';
}

function statusLabel(s: string): string {
  if (s === 'connected') return '🟢 Đã kết nối';
  if (s === 'disconnected') return '⚪ Ngắt';
  if (s === 'qr_pending') return '🟡 Chờ QR';
  return s;
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
.info-status-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.role-empty-tag { background: #f0f1f3; color: #6b7280; }
.role-legacy-owner { background: #fdf3df; color: #7a5818; }
.role-legacy-admin { background: #e3ede4; color: #0a2e0e; }
.role-legacy-member { background: #f0f1f3; color: #41454d; }

.hint-soft {
  margin-top: 10px;
  font-size: 11px;
  color: #41454d;
  background: #f8fafc;
  border-left: 3px solid #d6d8dc;
  padding: 8px 12px;
  border-radius: 6px;
  line-height: 1.45;
}
.hint-soft strong { color: #181d26; }
.link { color: #1b61c9; text-decoration: none; font-weight: 500; }
.link:hover { text-decoration: underline; }

.group-preview {
  margin-top: 12px;
  padding: 12px;
  background: #f8fafc;
  border: 1px solid #e0e2e6;
  border-radius: 8px;
}
.preview-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  gap: 8px;
  flex-wrap: wrap;
}
.preview-stat {
  font-size: 11px;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 9999px;
  background: #e3ede4;
  color: #0a2e0e;
}
.preview-desc { font-size: 11px; color: #41454d; margin: 0; line-height: 1.5; }
</style>
