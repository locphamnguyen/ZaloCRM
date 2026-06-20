<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div class="roles-page">
    <div class="page-head">
      <div>
        <h2 class="page-title">Vai trò & Phân quyền</h2>
        <p class="page-desc">Cấu hình vai trò và quyền hạn chi tiết cho từng nhân viên.</p>
      </div>
      <v-btn color="primary" prepend-icon="mdi-plus" disabled>
        Tạo vai trò tuỳ chỉnh
      </v-btn>
    </div>

    <!-- Roles list (system + custom) -->
    <section class="roles-section">
      <div class="section-head">
        <h3>Vai trò hệ thống</h3>
        <span class="hint">Không thể xoá, chỉ có thể chỉnh permission của Custom role</span>
      </div>

      <div class="roles-grid">
        <article v-for="role in SYSTEM_ROLES" :key="role.id" class="role-card" :class="`role-${role.id}`">
          <header class="rc-head">
            <div class="rc-badge">
              <span class="rc-icon">{{ role.icon }}</span>
              <span class="rc-label">{{ role.label }}</span>
            </div>
            <div class="rc-count">{{ getUserCount(role.id) }} người</div>
          </header>
          <p class="rc-desc">{{ role.description }}</p>
          <div class="rc-perms">
            <div class="rc-perm-label">Quyền nổi bật:</div>
            <ul>
              <li v-for="perm in role.highlights" :key="perm">{{ perm }}</li>
            </ul>
          </div>
          <button type="button" class="rc-detail-btn" @click="selectedRole = role.id">
            Xem chi tiết →
          </button>
        </article>
      </div>
    </section>

    <!-- Permission matrix (scaffold) -->
    <section class="perm-section">
      <div class="section-head">
        <h3>Ma trận phân quyền</h3>
        <span class="hint">Bảng phân quyền theo module — xem nhanh ai có quyền gì</span>
      </div>

      <div class="perm-table-wrap">
        <table class="perm-table">
          <thead>
            <tr>
              <th class="th-module">Module</th>
              <th v-for="role in SYSTEM_ROLES" :key="role.id" class="th-role">
                <span class="th-role-icon">{{ role.icon }}</span>
                {{ role.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="module in PERMISSION_MATRIX" :key="module.id">
              <td class="td-module">
                <span class="td-module-icon">{{ module.icon }}</span>
                <div>
                  <div class="td-module-label">{{ module.label }}</div>
                  <div class="td-module-desc">{{ module.description }}</div>
                </div>
              </td>
              <td v-for="role in SYSTEM_ROLES" :key="role.id" class="td-perm">
                <span class="perm-icon" :class="permClass(module.perms[role.id])">
                  {{ permIcon(module.perms[role.id]) }}
                </span>
                <span class="perm-label">{{ permLabel(module.perms[role.id]) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="perm-legend">
        <span class="legend-item"><span class="perm-icon full">✓</span> Full</span>
        <span class="legend-item"><span class="perm-icon read">👁</span> Read-only</span>
        <span class="legend-item"><span class="perm-icon own">👤</span> Own only</span>
        <span class="legend-item"><span class="perm-icon none">✕</span> No access</span>
      </div>
    </section>

    <!-- Coming soon banner -->
    <div class="cs-banner">
      <div class="cs-icon">🚧</div>
      <div>
        <div class="cs-title">Tính năng nâng cao đang phát triển</div>
        <ul class="cs-list">
          <li>Tạo vai trò tuỳ chỉnh (Custom role) với permission scope chi tiết</li>
          <li>Phân quyền theo module (Chat, Friends, Contacts, Reports, Settings)</li>
          <li>Permission inheritance từ Team / Department</li>
          <li>Audit log cho thay đổi permission</li>
          <li>Override per-user (vd: 1 sale được xem báo cáo của team khác)</li>
        </ul>
        <div class="cs-foot">Phase tiếp theo: backend role schema + permission middleware → UI editor.</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useUsers } from '@/composables/use-users';

const { users, fetchUsers } = useUsers();

interface SystemRole {
  id: string;
  label: string;
  icon: string;
  description: string;
  highlights: string[];
}

const SYSTEM_ROLES: SystemRole[] = [
  {
    id: 'owner',
    label: 'Chủ sở hữu',
    icon: '👑',
    description: 'Quyền cao nhất, có thể chuyển nhượng tổ chức và thực hiện mọi thao tác.',
    highlights: [
      'Toàn quyền tất cả module',
      'Quản lý billing + xoá tổ chức',
      'Chuyển nhượng owner',
      'Truy cập Audit log',
    ],
  },
  {
    id: 'admin',
    label: 'Quản trị viên',
    icon: '🛡',
    description: 'Quản lý cấu hình tổ chức, nhân viên, dữ liệu CRM nhưng không xoá được tổ chức.',
    highlights: [
      'CRUD nhân viên, đội nhóm',
      'Cấu hình Tag, Stage, Lead scoring',
      'Quản lý Tài khoản Zalo',
      'Không truy cập Billing + Audit log',
    ],
  },
  {
    id: 'member',
    label: 'Nhân viên',
    icon: '👤',
    description: 'Sale/CSKH, sử dụng tool hàng ngày để chăm sóc khách hàng.',
    highlights: [
      'Quản lý chat + contact của mình',
      'Gắn tag, đổi stage cho KH mình phụ trách',
      'Xem báo cáo của bản thân',
      'Không cấu hình tổ chức',
    ],
  },
];

type PermLevel = 'full' | 'read' | 'own' | 'none';

interface PermModule {
  id: string;
  label: string;
  icon: string;
  description: string;
  perms: Record<string, PermLevel>;
}

const PERMISSION_MATRIX: PermModule[] = [
  {
    id: 'chat', label: 'Chat / Hộp thư', icon: '💬',
    description: 'Xem và gửi tin nhắn',
    perms: { owner: 'full', admin: 'full', member: 'own' },
  },
  {
    id: 'contacts', label: 'Danh bạ KH', icon: '📇',
    description: 'CRUD khách hàng + friends',
    perms: { owner: 'full', admin: 'full', member: 'own' },
  },
  {
    id: 'tags', label: 'Tag CRM', icon: '🏷',
    description: 'Tạo/sửa/xoá tag definition',
    perms: { owner: 'full', admin: 'full', member: 'read' },
  },
  {
    id: 'reports', label: 'Báo cáo', icon: '📊',
    description: 'Xem analytics + báo cáo',
    perms: { owner: 'full', admin: 'full', member: 'own' },
  },
  {
    id: 'automation', label: 'Automation', icon: '🤖',
    description: 'Cấu hình rules + campaign',
    perms: { owner: 'full', admin: 'full', member: 'none' },
  },
  {
    id: 'zalo-accounts', label: 'Tài khoản Zalo', icon: '📱',
    description: 'Quản lý nick zalo',
    perms: { owner: 'full', admin: 'full', member: 'own' },
  },
  {
    id: 'team', label: 'Nhân sự', icon: '👥',
    description: 'CRUD nhân viên + đội nhóm',
    perms: { owner: 'full', admin: 'full', member: 'none' },
  },
  {
    id: 'org', label: 'Tổ chức', icon: '🏢',
    description: 'Hồ sơ tổ chức + cấu hình',
    perms: { owner: 'full', admin: 'read', member: 'none' },
  },
  {
    id: 'billing', label: 'Billing', icon: '💳',
    description: 'Gói cước + invoice',
    perms: { owner: 'full', admin: 'none', member: 'none' },
  },
  {
    id: 'audit', label: 'Audit log', icon: '📜',
    description: 'Lịch sử thao tác',
    perms: { owner: 'full', admin: 'read', member: 'none' },
  },
  {
    id: 'api', label: 'API & Webhook', icon: '🔌',
    description: 'API key, webhook config',
    perms: { owner: 'full', admin: 'none', member: 'none' },
  },
];

const selectedRole = ref<string | null>(null);

function getUserCount(roleId: string): number {
  return users.value.filter((u) => u.role === roleId).length;
}

function permIcon(level: PermLevel): string {
  if (level === 'full') return '✓';
  if (level === 'read') return '👁';
  if (level === 'own') return '👤';
  return '✕';
}

function permLabel(level: PermLevel): string {
  if (level === 'full') return 'Full';
  if (level === 'read') return 'Read';
  if (level === 'own') return 'Own';
  return 'No';
}

function permClass(level: PermLevel): string {
  return level;
}

onMounted(fetchUsers);
</script>

<style scoped>
.roles-page {
  font-family: inherit;
  max-width: 1080px;
}
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  color: #1F2D3D;
  margin: 0 0 4px;
}
.page-desc {
  font-size: 13px;
  color: #6B7785;
  margin: 0;
}

.roles-section,
.perm-section {
  margin-bottom: 32px;
}
.section-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}
.section-head h3 {
  font-size: 14px;
  font-weight: 700;
  color: #1F2D3D;
  margin: 0;
}
.hint {
  font-size: 11.5px;
  color: #97A0AC;
  font-style: italic;
}

/* Role cards */
.roles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.role-card {
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 12px;
  padding: 18px 18px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.role-card.role-owner { border-left: 3px solid #F59E0B; }
.role-card.role-admin { border-left: 3px solid #5E6AD2; }
.role-card.role-member { border-left: 3px solid #10B981; }
.rc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.rc-badge {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 700;
}
.rc-icon { font-size: 18px; }
.rc-count {
  font-size: 11px;
  font-weight: 600;
  color: #6B7785;
  background: #F4F4F7;
  padding: 2px 8px;
  border-radius: 999px;
}
.rc-desc {
  font-size: 12.5px;
  color: #6B7785;
  margin: 0;
  line-height: 1.5;
}
.rc-perms {
  background: #FAFAFC;
  border-radius: 8px;
  padding: 10px 12px;
}
.rc-perm-label {
  font-size: 10.5px;
  font-weight: 600;
  color: #97A0AC;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 6px;
}
.rc-perms ul {
  list-style: none;
  padding: 0;
  margin: 0;
}
.rc-perms li {
  font-size: 12px;
  color: #1F2D3D;
  padding: 2px 0 2px 18px;
  position: relative;
  line-height: 1.5;
}
.rc-perms li::before {
  content: '✓';
  position: absolute;
  left: 0;
  top: 2px;
  color: #10B981;
  font-weight: 700;
}
.rc-detail-btn {
  margin-top: auto;
  padding: 7px 12px;
  background: transparent;
  border: 1px solid #E4E5E9;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #5E6AD2;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.rc-detail-btn:hover { background: #EEF0FF; border-color: #5E6AD2; }

/* Permission matrix */
.perm-table-wrap {
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 12px;
  overflow: hidden;
}
.perm-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.perm-table th {
  background: #FAFAFC;
  text-align: left;
  padding: 12px 14px;
  font-weight: 700;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-size: 11px;
  border-bottom: 1px solid #E4E5E9;
}
.th-module { width: 30%; }
.th-role {
  text-align: center;
  font-size: 12px;
  width: 23%;
}
.th-role-icon {
  display: block;
  font-size: 16px;
  margin-bottom: 2px;
}
.perm-table tbody tr {
  border-bottom: 1px solid #F4F4F7;
}
.perm-table tbody tr:last-child {
  border-bottom: none;
}
.perm-table tbody tr:hover {
  background: #FAFAFC;
}
.td-module {
  padding: 12px 14px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.td-module-icon {
  font-size: 16px;
  margin-top: 1px;
}
.td-module-label {
  font-size: 13px;
  font-weight: 600;
  color: #1F2D3D;
}
.td-module-desc {
  font-size: 11.5px;
  color: #97A0AC;
  margin-top: 1px;
}
.td-perm {
  text-align: center;
  padding: 12px 8px;
}
.perm-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  margin-right: 5px;
}
.perm-icon.full { background: #DCFCE7; color: #166534; }
.perm-icon.read { background: #DBEAFE; color: #1E40AF; }
.perm-icon.own { background: #FEF3C7; color: #92400E; }
.perm-icon.none { background: #F4F4F7; color: #97A0AC; }
.perm-label {
  font-size: 11.5px;
  font-weight: 500;
  color: #6B7785;
}

.perm-legend {
  display: flex;
  gap: 16px;
  padding: 12px 16px;
  margin-top: 8px;
  font-size: 11.5px;
  color: #6B7785;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend-item .perm-icon {
  margin-right: 2px;
}

/* Coming soon banner */
.cs-banner {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding: 18px 20px;
  background: linear-gradient(135deg, #FAFAFC 0%, #EEF0FF 100%);
  border: 1px dashed rgba(94, 106, 210, 0.4);
  border-radius: 12px;
}
.cs-icon {
  font-size: 32px;
  flex-shrink: 0;
}
.cs-title {
  font-size: 14px;
  font-weight: 700;
  color: #1F2D3D;
  margin-bottom: 8px;
}
.cs-list {
  margin: 0;
  padding-left: 20px;
  font-size: 12.5px;
  color: #1F2D3D;
  line-height: 1.7;
}
.cs-foot {
  margin-top: 10px;
  font-size: 11.5px;
  color: #6B7785;
  font-style: italic;
}
</style>
