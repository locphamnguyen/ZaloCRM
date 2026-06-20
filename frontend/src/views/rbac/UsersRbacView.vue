<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="dept-page">
    <header class="page-hero">
      <div class="hero-left">
        <h1 class="hero-title">Nhân viên</h1>
        <p class="hero-sub">Quản lý người dùng tổ chức · Phân phòng ban · Gán nhóm quyền · Vô hiệu hóa khi nghỉ việc</p>
      </div>
      <div class="hero-right" v-if="canCreateUser">
        <!-- 2026-06-07 anh chốt: DUY NHẤT 1 kênh tạo user qua Zalo (bỏ "Tạo nhanh"). -->
        <button class="btn-primary" @click="openCreateWithZaloDialog" title="Tạo nhân viên gộp Zalo handshake — tự gửi tin login qua Zalo">
          <span class="btn-icon">＋</span> Thêm nhân viên
        </button>
      </div>
    </header>

    <section class="stats-row" v-if="!loading && stats.total > 0">
      <div class="stat-card stat-primary">
        <div class="stat-label">Tổng nhân viên</div>
        <div class="stat-value">{{ stats.total }}</div>
      </div>
      <div class="stat-card stat-forest">
        <div class="stat-label">🟢 Hoạt động</div>
        <div class="stat-value">{{ stats.statusActive }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
      <div class="stat-card stat-mustard">
        <div class="stat-label">🟡 Chưa kích hoạt</div>
        <div class="stat-value">{{ stats.statusPending }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
      <div class="stat-card stat-cream">
        <div class="stat-label">💤 Im lặng</div>
        <div class="stat-value">{{ stats.statusSilent }}<span class="stat-unit"> / {{ stats.total }}</span></div>
      </div>
    </section>

    <!-- Filter bar -->
    <div class="at-toolbar" v-if="!loading && store.users.length > 0">
      <div class="search-box at-search">
        <span class="search-icon">🔍</span>
        <input v-model="searchQ" placeholder="Tìm tên / SĐT / email..." @input="applyFilter" />
        <button v-if="searchQ" class="search-clear" @click="searchQ = ''; applyFilter()">×</button>
      </div>
      <select class="filter-select" v-model="filterDept" @change="applyFilter">
        <option value="">🏢 Mọi phòng ban</option>
        <option v-for="d in flatDepts" :key="d.id" :value="d.id">
          {{ '— '.repeat(d._depth) }}{{ d.name }}
        </option>
      </select>
      <select class="filter-select" v-model="filterGroup" @change="applyFilter">
        <option value="">🛡 Mọi nhóm quyền</option>
        <option v-for="g in flatGroups" :key="g.id" :value="g.id">
          {{ '— '.repeat(g._depth) }}{{ g.name }}
        </option>
      </select>
      <!-- 2026-06-09 (anh chốt): chip MULTI-SELECT — tích nhiều trạng thái xem cùng lúc.
           Tách đúng 4 trạng thái. Mặc định 'Hoạt động'. "Tất cả" = bỏ chọn hết. -->
      <div class="status-chips" role="group" aria-label="Lọc theo trạng thái">
        <button
          type="button"
          class="status-chip"
          :class="{ active: selectedStatuses.size === 0 }"
          @click="clearStatusFilter()"
        >Tất cả</button>
        <button
          v-for="opt in STATUS_CHIPS"
          :key="opt.value"
          type="button"
          class="status-chip"
          :class="{ active: selectedStatuses.has(opt.value) }"
          @click="toggleStatus(opt.value)"
        >{{ opt.label }}</button>
      </div>
      <div class="at-toolbar-spacer"></div>
      <button class="filter-select toggle-email-btn" @click="showEmailColumn = !showEmailColumn" :title="showEmailColumn ? 'Ẩn cột email' : 'Hiện cột email'">
        {{ showEmailColumn ? '✉️ Ẩn email' : '✉️ Hiện email' }}
      </button>
      <span class="at-count">{{ filteredUsers.length }} / {{ stats.total }} nhân viên</span>
    </div>

    <!-- 2026-06-09 (anh chốt FN4): thanh thao tác hàng loạt — hiện khi chọn ≥1 nhân viên. -->
    <div v-if="canBulk && selectedIds.size > 0" class="bulk-bar">
      <span class="bulk-count">Đã chọn {{ selectedIds.size }} nhân viên</span>
      <select v-model="bulkDept" class="bulk-select">
        <option value="__none__">— Gán phòng ban —</option>
        <option value="">(Bỏ phòng ban)</option>
        <option v-for="d in flatDepts" :key="d.id" :value="d.id">{{ d.name }}</option>
      </select>
      <select v-model="bulkGroup" class="bulk-select">
        <option value="__none__">— Gán nhóm quyền —</option>
        <option value="">(Bỏ nhóm quyền)</option>
        <option v-for="g in flatGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
      </select>
      <button class="bulk-apply" :disabled="bulkBusy || (bulkDept==='__none__' && bulkGroup==='__none__')" @click="applyBulk">
        {{ bulkBusy ? 'Đang gán…' : 'Áp dụng' }}
      </button>
      <button class="bulk-clear" @click="clearSelection">Bỏ chọn</button>
    </div>

    <div v-if="loading" class="loading-state">
      <div class="skel-card" v-for="i in 4" :key="i" style="height: 44px"></div>
    </div>

    <div v-else-if="filteredUsers.length === 0 && store.users.length === 0" class="empty-state">
      <div class="empty-icon">👥</div>
      <h3>Chưa có nhân viên nào</h3>
      <p>Bấm "Thêm nhân viên" ở góc phải trên để tạo tài khoản đầu tiên.</p>
      <button v-if="canCreateUser" class="btn-primary mt-3" @click="openCreateWithZaloDialog">
        <span class="btn-icon">＋</span> Thêm nhân viên đầu tiên
      </button>
    </div>

    <div v-else-if="filteredUsers.length === 0" class="empty-state">
      <div class="empty-icon">🔍</div>
      <h3>Không tìm thấy nhân viên phù hợp</h3>
      <p>Thử bỏ bớt bộ lọc hoặc đổi từ khóa tìm kiếm.</p>
    </div>

    <!-- AIRTABLE-STYLE TABLE -->
    <section v-else class="at-table-wrap">
      <table class="at-table">
        <thead>
          <tr>
            <th v-if="canBulk" class="th-check">
              <input type="checkbox" :checked="allSelected" @change="toggleAll" @click.stop title="Chọn tất cả" />
            </th>
            <th class="th-num">#</th>
            <th class="th-name">Nhân viên</th>
            <th class="th-phone">📱 SĐT</th>
            <th v-if="showEmailColumn" class="th-email">Email</th>
            <th class="th-dept">Phòng ban</th>
            <th class="th-role">Chức vụ</th>
            <th class="th-group">Nhóm quyền</th>
            <th class="th-internal">🏠 Liên lạc nội bộ</th>
            <th class="th-onboarding">🎯 Onboarding</th>
            <th class="th-status">Trạng thái</th>
            <th class="th-actions"></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(u, i) in filteredUsers"
            :key="u.id"
            :class="{ 'row-active': selectedUser?.id === u.id, 'row-inactive': !u.isActive, 'row-checked': selectedIds.has(u.id) }"
            @click="openPanel(u)"
          >
            <td v-if="canBulk" class="cell-check" @click.stop>
              <input type="checkbox" :checked="selectedIds.has(u.id)" @change="toggleOne(u.id)" />
            </td>
            <td class="cell-num">{{ i + 1 }}</td>
            <td class="cell-name">
              <img
                v-if="u.avatarUrl"
                :src="u.avatarUrl"
                :alt="u.fullName"
                class="at-avatar at-avatar-img"
                referrerpolicy="no-referrer"
                @error="onAvatarError"
              />
              <span v-else class="at-avatar" :style="{ background: avatarColor(u.fullName || u.email || u.phone || '?') }">
                {{ initials(u.fullName || u.email || u.phone || '?') }}
              </span>
              <div class="cell-name-text">
                <div class="cell-name-main">{{ u.fullName || '(chưa đặt tên)' }}</div>
                <div v-if="u.role === 'owner'" class="cell-name-sub owner-tag">👑 Chủ tổ chức</div>
              </div>
            </td>
            <td class="cell-phone">
              <code v-if="u.phone">{{ formatPhoneDisplay(u.phone) }}</code>
              <span v-else class="at-empty">—</span>
            </td>
            <td v-if="showEmailColumn" class="cell-email">{{ u.email || '—' }}</td>
            <td class="cell-dept">
              <span v-if="u.departmentMember" class="at-chip chip-dept">
                🏢 {{ u.departmentMember.department.name }}
              </span>
              <span v-else class="at-empty">—</span>
            </td>
            <td class="cell-role">
              <template v-if="u.departmentMember">
                <span v-if="u.departmentMember.deptRole === 'leader'" class="at-chip chip-leader">
                  👑 Trưởng phòng
                </span>
                <span v-else-if="u.departmentMember.deptRole === 'deputy'" class="at-chip chip-deputy">
                  🎖️ Phó phòng
                </span>
                <span v-else class="at-chip chip-member">👤 Nhân viên</span>
              </template>
              <span v-else class="at-empty">—</span>
            </td>
            <td class="cell-group">
              <template v-if="u.permissionGroup">
                <span class="at-chip" :class="u.permissionGroup.isSystem ? 'chip-system' : 'chip-custom'">
                  🛡 {{ u.permissionGroup.name }}
                </span>
              </template>
              <span v-else class="at-empty">—</span>
            </td>
            <td class="cell-internal">
              <!-- UI 2026-05-27 — 7 trạng thái Liên lạc nội bộ:
                   1. crm_nick + ready                       → SĐT nick CRM
                   2. personal_phone + ready                 → SĐT + tag "Zalo ngoài"
                   3. recipientStatus=ready, method=null     → SĐT user (handshake admin tạo)
                   4. recipientStatus=pending_friend_request → "⏳ Chờ KB"
                   5. recipientStatus=pending_user_confirm   → "🔐 Chờ mã verify"
                   6. recipientStatus=invalid/error          → "⚠ Lỗi"
                   7. else                                   → "—" -->
              <!-- Case 1: nick CRM (đã verify ready) -->
              <RouterLink
                v-if="u.internalContactNick && u.recipientStatus === 'ready'"
                :to="'/settings/channels/zalo?tab=internal-contact'"
                class="at-chip chip-internal"
                @click.stop
                :title="`Nick CRM: ${u.internalContactNick.displayName || '(chưa đặt tên)'} · Đã verify`"
              >
                <code>{{ formatPhoneDisplay(u.internalContactNick.phone) || '(thiếu SĐT)' }}</code>
              </RouterLink>
              <!-- Case 2: personal phone (Zalo ngoài) đã ready -->
              <span
                v-else-if="u.internalContactMethod === 'personal_phone' && u.internalContactPhone && u.recipientStatus === 'ready'"
                class="at-chip chip-internal-external"
                :title="`Zalo cá nhân của sale, không có nick trong CRM · Đã verify`"
                @click.stop
              >
                <code>{{ formatPhoneDisplay(u.internalContactPhone) }}</code>
                <span class="tag-zalo-ngoai">Zalo ngoài</span>
              </span>
              <!-- Case 3: handshake admin tạo (recipient=ready nhưng User.method=null) -->
              <span
                v-else-if="u.recipientStatus === 'ready' && u.phone"
                class="at-chip chip-internal-instant"
                :title="`Admin tạo qua Zalo · Handshake xong, sẵn sàng nhận thông báo`"
                @click.stop
              >
                <code>{{ formatPhoneDisplay(u.phone) }}</code>
                <span class="tag-instant">✓ Sẵn sàng</span>
              </span>
              <!-- Case 4: chờ accept friend request -->
              <span
                v-else-if="u.recipientStatus === 'pending_friend_request'"
                class="at-chip chip-internal-pending"
                :title="`Đã gửi yêu cầu kết bạn từ nick CRM, chờ sale accept`"
                @click.stop
              >
                ⏳ Chờ KB
              </span>
              <!-- Case 5: chờ verify code 4 số -->
              <span
                v-else-if="u.recipientStatus === 'pending_user_confirm'"
                class="at-chip chip-internal-verifying"
                :title="`Sale đã accept, đang chờ gõ mã verify 4 số`"
                @click.stop
              >
                🔐 Chờ mã
              </span>
              <!-- Case 6: lỗi -->
              <span
                v-else-if="u.recipientStatus && u.recipientStatus !== 'missing_internal_contact' && u.recipientError"
                class="at-chip chip-internal-error"
                :title="u.recipientError || 'Lỗi setup liên lạc nội bộ'"
                @click.stop
              >
                ⚠ Lỗi
              </span>
              <!-- Case 7: chưa setup -->
              <span v-else class="at-empty" :title="`Sale chưa thiết lập liên lạc nội bộ`">—</span>
            </td>
            <td class="cell-onboarding">
              <!-- Phase Onboarding v1 2026-05-24 — admin theo dõi % setup của sale -->
              <span
                v-if="u.onboarding"
                class="at-chip"
                :class="onboardingChipClass(u.onboarding)"
                :title="onboardingTooltip(u.onboarding)"
              >
                {{ onboardingIcon(u.onboarding) }} {{ u.onboarding.completedCount }}/{{ u.onboarding.totalCount }}
              </span>
              <span v-else class="at-empty">—</span>
            </td>
            <td class="cell-status">
              <span :class="['at-chip', statusInfo(u).chipClass]" :title="statusInfo(u).tooltip">
                {{ statusInfo(u).icon }} {{ statusInfo(u).label }}
              </span>
            </td>
            <td class="cell-actions">
              <button class="at-btn-icon" title="Mở chi tiết" @click.stop="openPanel(u)">✎</button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <!-- Side panel -->
    <UserEditPanel
      :open="panelOpen"
      :user="selectedUser"
      :current-user-id="currentUserId"
      :current-user-role="currentUserRole"
      @close="closePanel"
      @changed="onChanged"
    />

    <!-- Phase user-create-with-zalo 2026-05-27 — create user gộp Zalo handshake -->
    <CreateUserWithZaloModal
      v-model:open="createWithZaloOpen"
      :departments="flatDepts"
      :permission-groups="flatGroups"
      @created="onCreatedWithZalo"
    />

  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import {
  useRbacStore,
  type RbacUser,
  type DepartmentNode,
  type PermissionGroupNode,
  type OnboardingSummary,
} from '@/stores/rbac';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/api/index';
import UserEditPanel from '@/components/rbac/UserEditPanel.vue';
import CreateUserWithZaloModal from '@/components/users/CreateUserWithZaloModal.vue';

const store = useRbacStore();
const authStore = useAuthStore();

const searchQ = ref('');
// UI refactor 2026-05-27 — toggle hiện/ẩn cột email. Persist localStorage để admin
// chọn 1 lần là nhớ luôn (default = false = ẩn vì sale VN ít dùng email).
const showEmailColumn = ref<boolean>(localStorage.getItem('rbac.showEmailColumn') === '1');
watch(showEmailColumn, (v) => localStorage.setItem('rbac.showEmailColumn', v ? '1' : '0'));
const filterDept = ref('');
const filterGroup = ref('');
// 2026-06-09 (anh chốt) — bộ lọc trạng thái dạng chip MULTI-SELECT (tích nhiều cùng lúc):
//   - Tách ĐÚNG 4 trạng thái (KHÔNG gom im lặng vào hoạt động).
//   - Chọn ≥1 chip → xem nhiều trạng thái cùng lúc (vd Im lặng + Vô hiệu).
//   - Mặc định = chỉ 'Hoạt động'. Bỏ chọn hết (chip "Tất cả") = hiện tất cả.
const STATUS_CHIPS: Array<{ value: 'active' | 'silent' | 'pending' | 'disabled'; label: string }> = [
  { value: 'active', label: '🟢 Hoạt động' },
  { value: 'silent', label: '💤 Im lặng' },
  { value: 'pending', label: '🟡 Chưa kích hoạt' },
  { value: 'disabled', label: '⚪ Vô hiệu' },
];
const selectedStatuses = ref<Set<'active' | 'silent' | 'pending' | 'disabled'>>(new Set(['active'] as Array<'active'>));
function toggleStatus(s: 'active' | 'silent' | 'pending' | 'disabled') {
  const next = new Set(selectedStatuses.value);
  if (next.has(s)) next.delete(s); else next.add(s);
  selectedStatuses.value = next;
}
function clearStatusFilter() {
  selectedStatuses.value = new Set();
}

const panelOpen = ref(false);
const selectedUser = ref<RbacUser | null>(null);

const currentUserId = computed(() => authStore.user?.id ?? '');
const currentUserRole = computed(() => authStore.user?.role ?? 'member');

// Phase user-create-with-zalo 2026-05-27 — DUY NHẤT 1 kênh tạo user (qua Zalo).
// 2026-06-07 anh chốt: bỏ "Tạo nhanh" (POST /users) — credentials tổng hợp 1 text copy ở bước 3 modal.
const canCreateUser = computed(() => ['owner', 'admin'].includes(currentUserRole.value));

// 2026-06-09 (anh chốt FN4) — chọn nhiều + gán phòng/nhóm hàng loạt (owner/admin).
const canBulk = computed(() => ['owner', 'admin'].includes(currentUserRole.value));
const selectedIds = ref<Set<string>>(new Set());
const bulkDept = ref('__none__');   // __none__ = không đổi; '' = bỏ phòng ban
const bulkGroup = ref('__none__');
const bulkBusy = ref(false);
const allSelected = computed(() =>
  filteredUsers.value.length > 0 && filteredUsers.value.every((u) => selectedIds.value.has(u.id)),
);
function toggleOne(id: string) {
  const next = new Set(selectedIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  selectedIds.value = next;
}
function toggleAll() {
  if (allSelected.value) { selectedIds.value = new Set(); }
  else { selectedIds.value = new Set(filteredUsers.value.map((u) => u.id)); }
}
function clearSelection() {
  selectedIds.value = new Set();
  bulkDept.value = '__none__';
  bulkGroup.value = '__none__';
}
async function applyBulk() {
  if (selectedIds.value.size === 0) return;
  const payload: Record<string, unknown> = { userIds: [...selectedIds.value] };
  if (bulkDept.value !== '__none__') payload.departmentId = bulkDept.value || null;
  if (bulkGroup.value !== '__none__') payload.permissionGroupId = bulkGroup.value || null;
  if (!('departmentId' in payload) && !('permissionGroupId' in payload)) return;
  bulkBusy.value = true;
  try {
    const { data } = await api.post('/users/bulk-assign', payload);
    await store.loadUsers();
    clearSelection();
    alert(`Đã gán cho ${data.affected} nhân viên.`);
  } catch (e: any) {
    alert(e?.response?.data?.error || e?.response?.data?.message || 'Lỗi thao tác hàng loạt');
  } finally {
    bulkBusy.value = false;
  }
}
const createWithZaloOpen = ref(false);
function openCreateWithZaloDialog() { createWithZaloOpen.value = true; }
async function onCreatedWithZalo() {
  await store.loadUsers();
}

onMounted(async () => {
  await Promise.all([
    store.loadUsers(),
    store.loadDepartments(),
    store.loadPermissionGroups(),
  ]);
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

const filteredUsers = computed(() => {
  return store.users.filter((u) => {
    // Multi-select: bỏ chọn hết = hiện tất cả; chọn ≥1 = chỉ hiện status thuộc tập đã chọn.
    if (selectedStatuses.value.size > 0 && !selectedStatuses.value.has(computeStatusKey(u))) return false;
    return true;
  });
});

const stats = computed(() => {
  const total = store.users.length;
  let statusActive = 0, statusPending = 0, statusSilent = 0, statusDisabled = 0;
  for (const u of store.users) {
    const k = computeStatusKey(u);
    if (k === 'active') statusActive++;
    else if (k === 'pending') statusPending++;
    else if (k === 'silent') statusSilent++;
    else statusDisabled++;
  }
  return { total, statusActive, statusPending, statusSilent, statusDisabled };
});

const loading = computed(() => store.loading);

let debounceTimer: any;
function applyFilter() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    store.loadUsers({
      q: searchQ.value || undefined,
      departmentId: filterDept.value || undefined,
      permissionGroupId: filterGroup.value || undefined,
    });
  }, 300);
}

function openPanel(u: RbacUser) {
  selectedUser.value = u;
  panelOpen.value = true;
}
function closePanel() {
  panelOpen.value = false;
  selectedUser.value = null;
}
async function onChanged() {
  await store.loadUsers({
    q: searchQ.value || undefined,
    departmentId: filterDept.value || undefined,
    permissionGroupId: filterGroup.value || undefined,
  });
  if (selectedUser.value) {
    const updated = store.users.find((u) => u.id === selectedUser.value!.id);
    if (updated) selectedUser.value = updated;
  }
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

// Phase status 4-state 2026-05-27 — compute 4 trạng thái từ user fields:
//   - isActive=false → 'disabled' (Vô hiệu)
//   - isActive=true && passwordChangedAt=null → 'pending' (Chưa kích hoạt)
//   - isActive=true && passwordChangedAt!=null && lastLoginAt > now-3d → 'active' (Hoạt động)
//   - else → 'silent' (Im lặng — đã login nhưng > 3 ngày không vào, hoặc chưa login bao giờ dù đã đổi pw)
const SILENT_THRESHOLD_MS = 3 * 24 * 3600 * 1000;
type StatusKey = 'pending' | 'active' | 'silent' | 'disabled';

function computeStatusKey(u: RbacUser): StatusKey {
  if (!u.isActive) return 'disabled';
  if (!u.passwordChangedAt) return 'pending';
  if (!u.lastLoginAt) return 'silent';
  const lastLogin = new Date(u.lastLoginAt).getTime();
  return Date.now() - lastLogin <= SILENT_THRESHOLD_MS ? 'active' : 'silent';
}

function statusInfo(u: RbacUser): { icon: string; label: string; chipClass: string; tooltip: string } {
  const key = computeStatusKey(u);
  switch (key) {
    case 'pending':
      return {
        icon: '🟡',
        label: 'Chưa kích hoạt',
        chipClass: 'chip-status-pending',
        tooltip: 'Sale chưa từng đăng nhập + đổi mật khẩu lần đầu',
      };
    case 'active':
      return {
        icon: '🟢',
        label: 'Hoạt động',
        chipClass: 'chip-status-active',
        tooltip: `Login lần cuối: ${u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('vi-VN') : '—'}`,
      };
    case 'silent':
      return {
        icon: '💤',
        label: 'Im lặng',
        chipClass: 'chip-status-silent',
        tooltip: u.lastLoginAt
          ? `Hơn 3 ngày chưa login. Login cuối: ${new Date(u.lastLoginAt).toLocaleString('vi-VN')}`
          : 'Đã đổi mật khẩu lần đầu nhưng chưa từng login lại',
      };
    case 'disabled':
      return { icon: '⚪', label: 'Vô hiệu', chipClass: 'chip-status-disabled', tooltip: 'Tài khoản đã bị vô hiệu — không cho đăng nhập' };
  }
}

// UI refactor 2026-05-27 — format SĐT 84xxx → 0xxx xxx xxx cho dễ đọc.
function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return '';
  let s = phone.replace(/\D/g, '');
  if (s.startsWith('84') && s.length === 11) s = '0' + s.slice(2);
  if (s.length === 10) return s.slice(0, 4) + ' ' + s.slice(4, 7) + ' ' + s.slice(7);
  return phone;
}

// Khi Zalo CDN từ chối ảnh avatar (referer, expire, etc.) → fallback initials
function onAvatarError(event: Event) {
  const img = event.target as HTMLImageElement;
  // Ẩn ảnh + reveal initials sibling. Cách đơn giản nhất: gán display:none cho img.
  img.style.display = 'none';
}

// Phase Onboarding v1 2026-05-24 — chip màu theo % setup
function onboardingChipClass(s: OnboardingSummary): string {
  if (s.percent === 100) return 'chip-onboarding-done';
  if (s.percent >= 50) return 'chip-onboarding-progress';
  return 'chip-onboarding-pending';
}
function onboardingIcon(s: OnboardingSummary): string {
  if (s.percent === 100) return '✅';
  if (s.changePassword === false) return '🔒'; // ưu tiên cảnh báo chưa đổi pw
  return '🎯';
}
const STEP_LABEL_VI: Record<string, string> = {
  change_password: 'Đổi mật khẩu',
  connect_nick: 'Kết nối nick Zalo',
  pin: 'Đặt PIN bảo mật (tuỳ chọn)',
};
function onboardingTooltip(s: OnboardingSummary): string {
  if (s.percent === 100) return 'Setup hoàn tất — sẵn sàng dùng CRM';
  const pending = s.pendingSteps.map((k) => `• ${STEP_LABEL_VI[k] ?? k}`).join('\n');
  return `Còn ${s.pendingSteps.length} bước:\n${pending}`;
}
</script>

<style>
/* UsersRbacView — Airtable-style table */

.at-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.at-search {
  min-width: 260px;
  max-width: 340px;
  flex: 1;
}
.at-toolbar-spacer { flex: 1; }
.at-count {
  font-size: 12px;
  color: #41454d;
  background: #f0f1f3;
  padding: 6px 12px;
  border-radius: 9999px;
  font-weight: 500;
  white-space: nowrap;
}

/* 2026-06-09 — bộ lọc trạng thái dạng chip bấm (multi-select, thay select dropdown) */
.status-chips {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.status-chip {
  font-size: 12.5px;
  font-weight: 500;
  color: #41454d;
  background: #f0f1f3;
  border: 1px solid transparent;
  padding: 6px 13px;
  border-radius: 9999px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s;
  font-family: inherit;
}
.status-chip:hover { background: #e4e6e9; }
.status-chip.active {
  background: var(--smax-primary-soft, #e4f1f8);
  border-color: var(--smax-primary, #1786be);
  color: var(--smax-primary, #1786be);
  font-weight: 600;
}
.status-chip:focus-visible { outline: 2px solid var(--smax-primary, #1786be); outline-offset: 1px; }

/* 2026-06-09 — Thao tác hàng loạt */
.bulk-bar {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  background: #e4f1f8; border: 1px solid #1786be; border-radius: 10px;
  padding: 10px 14px; margin-bottom: 12px;
}
.bulk-count { font-weight: 600; color: #0e6491; font-size: 13px; }
.bulk-select {
  font-size: 13px; padding: 6px 10px; border: 1px solid #bae6fd; border-radius: 8px;
  background: #fff; color: #2b2f36;
}
.bulk-apply {
  background: #1786be; color: #fff; border: none; font-weight: 600;
  padding: 7px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.bulk-apply:hover:not(:disabled) { background: #0e6491; }
.bulk-apply:disabled { opacity: 0.5; cursor: not-allowed; }
.bulk-clear {
  background: none; border: none; color: #0e6491; cursor: pointer;
  font-size: 13px; text-decoration: underline; margin-left: auto;
}
.th-check, .cell-check { width: 34px; text-align: center; }
.cell-check input, .th-check input { cursor: pointer; }
.row-checked td { background: #f0f9ff !important; }

/* Airtable table */
.at-table-wrap {
  background: white;
  border: 1px solid #e0e2e6;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(24,29,38,0.04);
}
.at-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  table-layout: auto;
}

/* Header — sticky, Airtable gray */
.at-table thead th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  padding: 12px 14px;
  text-align: left;
  font-weight: 600;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.6px;
  color: #41454d;
  border-bottom: 2px solid #e0e2e6;
  white-space: nowrap;
}
.th-num { width: 46px; text-align: center !important; }
.th-name { min-width: 200px; }
.th-email { min-width: 180px; }
.th-dept { min-width: 140px; }
.th-role { width: 140px; }
.th-group { min-width: 130px; }
.th-status { width: 130px; }
.th-actions { width: 48px; }

/* Rows */
.at-table tbody tr {
  cursor: pointer;
  transition: background 0.1s;
  border-bottom: 1px solid #f0f1f3;
}
.at-table tbody tr:hover { background: #f8fafc; }
.at-table tbody tr.row-active { background: #fdf3df; }
.at-table tbody tr.row-active:hover { background: #fceec5; }
.at-table tbody tr.row-inactive .cell-name-main,
.at-table tbody tr.row-inactive .cell-email {
  color: #9297a0;
  text-decoration: line-through;
  text-decoration-color: #c9ccd1;
}
.at-table tbody tr:last-child { border-bottom: 0; }
.at-table tbody td {
  padding: 12px 14px;
  vertical-align: middle;
}

/* Cells */
.cell-num {
  text-align: center;
  color: #9297a0;
  font-size: 11px;
  font-weight: 500;
}
.cell-name {
  display: flex;
  align-items: center;
  gap: 10px;
}
.at-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: white;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.at-avatar-img {
  object-fit: cover;
  background: #e8e8e8;
  border: 1px solid rgba(0, 0, 0, 0.08);
}
.cell-name-text { min-width: 0; }
.cell-name-main {
  font-size: 13px;
  font-weight: 500;
  color: #181d26;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cell-name-sub {
  font-size: 10px;
  font-weight: 600;
  margin-top: 2px;
  text-transform: uppercase;
  letter-spacing: 0.4px;
}
.owner-tag { color: #7a5818; }
.admin-tag { color: #0a2e0e; }

.cell-email {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 12px;
  color: #41454d;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 260px;
}
.th-phone { min-width: 130px; }
.cell-phone {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  font-size: 13px;
  color: #181d26;
  white-space: nowrap;
}
.cell-phone code {
  background: rgba(0, 0, 0, 0.04);
  padding: 2px 7px;
  border-radius: 5px;
}

.chip-internal-external {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  background: #fef3e2;
  border: 1px solid #fbc02d55;
  font-size: 12px;
}
.chip-internal-external code {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  background: transparent;
  color: #8a6300;
}
.tag-zalo-ngoai {
  font-size: 10px;
  font-weight: 600;
  background: #fbc02d;
  color: #4a3500;
  padding: 1px 6px;
  border-radius: 4px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

/* UI 2026-05-27 — 4 chip mới cho 7 trạng thái Liên lạc nội bộ */
.chip-internal-instant {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  border-radius: 6px;
  background: #ECFDF5;
  border: 1px solid #10B98155;
  font-size: 12px;
}
.chip-internal-instant code {
  font-family: 'JetBrains Mono', 'SF Mono', Menlo, monospace;
  background: transparent;
  color: #047857;
}
.tag-instant {
  font-size: 10px;
  font-weight: 600;
  background: #10B981;
  color: white;
  padding: 1px 6px;
  border-radius: 4px;
  letter-spacing: 0.2px;
}

.chip-internal-pending {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 6px;
  background: #FEF3C7;
  border: 1px solid #F59E0B55;
  color: #92400E;
  font-size: 12px;
  font-weight: 600;
}

.chip-internal-verifying {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 6px;
  background: #DBEAFE;
  border: 1px solid #3B82F655;
  color: #1E40AF;
  font-size: 12px;
  font-weight: 600;
}

.chip-internal-error {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 6px;
  background: #FEE2E2;
  border: 1px solid #EF444455;
  color: #B91C1C;
  font-size: 12px;
  font-weight: 600;
  cursor: help;
}

.toggle-email-btn {
  font-size: 12px;
  padding: 6px 12px;
  cursor: pointer;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: white;
  border-radius: 7px;
}
.toggle-email-btn:hover { background: #f5f5f5; }

/* Airtable chips */
.at-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 9999px;
  font-size: 11px;
  font-weight: 500;
  white-space: nowrap;
  line-height: 1.2;
}
.chip-dept { background: #e3ede4; color: #0a2e0e; }
.chip-leader { background: #fdf3df; color: #7a5818; }
.chip-deputy { background: #f5e9d4; color: #aa2d00; }
.chip-member { background: #f0f1f3; color: #41454d; }
.chip-system { background: #fdf3df; color: #7a5818; }
.chip-custom { background: #e0e9f5; color: #1b61c9; }
/* Phase Privacy v2 2026-05-23 — Nick liên lạc nội bộ chip */
.chip-internal {
  background: #FEF3C7; color: #92400E;
  text-decoration: none; cursor: pointer;
}
.chip-internal:hover { background: #FDE68A; }
.chip-active { background: #d8ecda; color: #0a2e0e; }
.chip-inactive { background: #f0f1f3; color: #9297a0; }

/* Phase status 4-state 2026-05-27 — 4 màu chip cho 4 trạng thái */
.chip-status-active   { background: #d8ecda; color: #0a2e0e; font-weight: 500; }
.chip-status-pending  { background: #fff4d6; color: #7a5818; font-weight: 500; }
.chip-status-silent   { background: #e8eaef; color: #5a6470; font-weight: 500; }
.chip-status-disabled { background: #f0f1f3; color: #9297a0; font-weight: 500; }
/* Phase Onboarding v1 2026-05-24 — chip % setup */
.chip-onboarding-done     { background: #ECFDF5; color: #047857; }
.chip-onboarding-progress { background: #FEF3C7; color: #92400E; }
.chip-onboarding-pending  { background: #FEE2E2; color: #B91C1C; }
.cell-onboarding { white-space: nowrap; }
.th-onboarding   { white-space: nowrap; }

.at-empty {
  color: #c9ccd1;
  font-size: 12px;
}

.cell-actions { text-align: right; }
.at-btn-icon {
  background: white;
  border: 1px solid #dddddd;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  color: #41454d;
  font-size: 12px;
  transition: all 0.1s;
}
.at-btn-icon:hover {
  background: #181d26;
  color: white;
  border-color: #181d26;
}

/* Phase Onboarding v1 2026-05-24 — Create user dialog + hero button */
.page-hero { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.hero-right { flex-shrink: 0; }

.btn-primary {
  background: #5E6AD2; color: white; border: none;
  padding: 10px 18px; border-radius: 10px;
  font-weight: 700; font-size: 13.5px; cursor: pointer; font-family: inherit;
  display: inline-flex; align-items: center; gap: 6px;
  transition: background 0.15s;
}
.btn-primary:hover:not(:disabled) { background: #4F46E5; }
.btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
.btn-icon { font-size: 16px; font-weight: 700; }
.mt-3 { margin-top: 12px; }

.btn-cancel {
  background: white; color: #374151; border: 1px solid #D1D5DB;
  padding: 10px 18px; border-radius: 10px;
  font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit;
}
.btn-cancel:hover:not(:disabled) { background: #F9FAFB; }
.btn-cancel:disabled { opacity: 0.5; cursor: not-allowed; }

.create-overlay {
  position: fixed; inset: 0; z-index: 1000;
  background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
}
.create-dialog {
  background: white; border-radius: 16px;
  max-width: 480px; width: 100%;
  box-shadow: 0 24px 64px rgba(15, 23, 42, 0.25);
  max-height: 90vh; overflow: auto;
}
.create-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; border-bottom: 1px solid #E5E7EB;
}
.create-head h2 { margin: 0; font-size: 17px; font-weight: 700; color: #0F172A; }
.create-close {
  background: transparent; border: none; cursor: pointer;
  color: #6B7280; font-size: 18px; font-weight: 700; font-family: inherit;
  padding: 4px 10px; border-radius: 6px;
}
.create-close:hover { background: #F3F4F6; color: #DC2626; }

.create-form { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; }
.create-label {
  display: flex; flex-direction: column; gap: 5px;
  font-size: 12.5px; font-weight: 600; color: #374151;
}
.create-label input, .create-label select {
  padding: 10px 12px; border: 1.5px solid #E5E7EB; border-radius: 9px;
  font-size: 14px; font-family: inherit; outline: none; transition: border-color 0.15s;
}
.create-label input:focus, .create-label select:focus { border-color: #5E6AD2; }
.req { color: #DC2626; }

.pw-row { display: flex; gap: 6px; align-items: center; }
.pw-row input { flex: 1; }
.pw-toggle, .pw-gen {
  background: white; border: 1.5px solid #E5E7EB; border-radius: 8px;
  width: 38px; height: 38px; cursor: pointer; font-size: 15px; font-family: inherit;
  display: flex; align-items: center; justify-content: center;
}
.pw-toggle:hover, .pw-gen:hover { background: #F9FAFB; border-color: #C7D2FE; }

.hint { color: #6B7280; font-size: 11.5px; font-weight: 400; line-height: 1.5; }

.create-error {
  background: #FEF2F2; color: #B91C1C; border: 1px solid #FCA5A5;
  padding: 9px 13px; border-radius: 8px; font-size: 12.5px;
}

.create-actions { display: flex; gap: 10px; justify-content: flex-end; padding-top: 6px; }

.create-success {
  padding: 22px; display: flex; flex-direction: column; gap: 12px; align-items: center;
  text-align: center;
}
.cs-icon {
  width: 64px; height: 64px;
  background: linear-gradient(135deg, #D1FAE5, #6EE7B7);
  border-radius: 18px;
  display: flex; align-items: center; justify-content: center;
  font-size: 32px;
}
.create-success h3 { margin: 0; font-size: 18px; font-weight: 700; color: #047857; }
.create-success p { margin: 0; font-size: 13.5px; color: #374151; }
.cs-credentials {
  width: 100%; background: #F9FAFB; border: 1px solid #E5E7EB; border-radius: 10px;
  padding: 12px 16px; display: flex; flex-direction: column; gap: 8px;
}
.cs-row { display: flex; align-items: baseline; gap: 10px; font-size: 12.5px; flex-wrap: wrap; }
.cs-row span { color: #6B7280; min-width: 110px; }
.cs-row code {
  background: white; padding: 3px 9px; border-radius: 5px;
  border: 1px solid #E5E7EB; font-family: ui-monospace, monospace; font-size: 12px;
  word-break: break-all; flex: 1;
}
.cs-note { font-size: 11.5px; color: #6B7280; font-style: italic; }
.cs-actions { display: flex; gap: 10px; width: 100%; margin-top: 4px; }
.cs-actions button { flex: 1; }
</style>
