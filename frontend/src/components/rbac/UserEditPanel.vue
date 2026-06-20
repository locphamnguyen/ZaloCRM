<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
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
            <!-- 2026-06-09: cho phép sửa SĐT (anh báo không giải phóng được số trùng).
                 Để trống = xoá số → giải phóng cho nhân viên khác dùng. -->
            <label class="field-label">Số điện thoại</label>
            <input
              v-model="localPhone"
              type="tel"
              class="field-input"
              placeholder="Để trống = xoá số (giải phóng cho người khác)"
              :disabled="!canEditInfo || busy"
              @blur="savePhone"
              @keyup.enter="savePhone"
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

          <!-- ── Cấu hình Riêng tư — Phase Privacy v2 2026-05-23 ── -->
          <section class="section">
            <h3 class="section-title">Cấu hình Riêng tư</h3>
            <label class="field-label">Max nick riêng tư</label>
            <select v-model="maxPrivacyLocal" class="field-input" :disabled="busy" @change="onMaxPrivacyChange">
              <option v-for="n in 10" :key="n" :value="n">{{ n }} nick</option>
            </select>
            <p class="hint-soft" style="margin-top:6px">
              User được phép đánh dấu tối đa N nick là "Riêng tư". Default = 2.
              Vượt giới hạn → BE reject với message "liên hệ admin". Cho phép 1-10.
            </p>
          </section>

          <!-- ── Onboarding (Phase Onboarding v1 2026-05-24) ── -->
          <section v-if="user?.onboarding" class="section">
            <div class="section-title-row">
              <h3 class="section-title">Onboarding setup</h3>
              <span class="ob-pct" :class="onboardingPctClass">
                {{ user.onboarding.completedCount }}/{{ user.onboarding.totalCount }} · {{ user.onboarding.percent }}%
              </span>
            </div>
            <ul class="ob-steplist">
              <li class="ob-stepitem" :class="{ done: user.onboarding.changePassword }">
                <span class="ob-mark">{{ user.onboarding.changePassword ? '✅' : '⬜' }}</span>
                Đổi mật khẩu lần đầu
              </li>
              <li class="ob-stepitem" :class="{ done: user.onboarding.connectNick }">
                <span class="ob-mark">{{ user.onboarding.connectNick ? '✅' : '⬜' }}</span>
                Kết nối ≥ 1 nick Zalo
              </li>
              <li
                class="ob-stepitem"
                :class="{ done: user.onboarding.pin && !user.onboarding.pinSkipped, skipped: user.onboarding.pinSkipped }"
              >
                <span class="ob-mark">
                  {{ user.onboarding.pinSkipped ? '⊘' : (user.onboarding.pin ? '✅' : '⬜') }}
                </span>
                Đặt PIN bảo mật (tuỳ chọn)
                <span v-if="user.onboarding.pinSkipped" class="ob-tag-mini">đã bỏ qua</span>
              </li>
            </ul>
            <p v-if="user.onboarding.dismissed && user.onboarding.percent < 100" class="hint-soft" style="margin-top:8px">
              User đã ẩn checklist nhưng vẫn chưa setup xong.
            </p>
          </section>

          <!-- ── Danger zone ─────────────────────── -->
          <!-- 2026-06-09 (anh báo thiếu): admin đặt lại mật khẩu cho sale quên pw.
               BE PUT /users/:id/password đã có sẵn: hash + force đổi lần đầu + revoke JWT cũ. -->
          <section v-if="canResetPassword" class="section">
            <h3 class="section-title">Mật khẩu</h3>
            <p class="field-hint">
              Đặt lại mật khẩu cho nhân viên quên/mất mật khẩu. Hệ thống sinh mật khẩu mới,
              nhân viên sẽ phải đổi lại khi đăng nhập lần đầu.
            </p>
            <div v-if="resetPwResult" class="reset-pw-result">
              <div class="reset-pw-row">
                <span class="reset-pw-label">Mật khẩu mới:</span>
                <code class="reset-pw-code">{{ resetPwResult }}</code>
                <button class="btn-copy-sm" @click="copyResetPw" title="Copy">📋</button>
              </div>
              <p class="reset-pw-note">Gửi mật khẩu này cho nhân viên. Họ sẽ buộc đổi lại khi đăng nhập.</p>
            </div>
            <button class="btn-reset-pw" :disabled="busy" @click="confirmResetPassword">
              🔑 Đặt lại mật khẩu
            </button>
          </section>

          <!-- 2026-06-09 (anh chốt): BÀN GIAO khi sale nghỉ — chuyển KH + nick + lịch hẹn
               sang sale khác để không mất khách. Nên bàn giao TRƯỚC khi vô hiệu. -->
          <section v-if="canHandoff" class="section">
            <h3 class="section-title">Bàn giao khách hàng</h3>
            <p class="field-hint">
              Khi nhân viên nghỉ/chuyển việc: chuyển toàn bộ khách hàng, nick Zalo và lịch hẹn
              của họ sang một nhân viên khác. Nên làm trước khi vô hiệu hóa.
            </p>
            <label class="field-label">Chuyển sang nhân viên</label>
            <select v-model="handoffToId" class="field-input" :disabled="busy">
              <option value="">— Chọn người nhận —</option>
              <option v-for="o in handoffTargets" :key="o.id" :value="o.id">{{ o.fullName }}</option>
            </select>
            <div class="handoff-opts">
              <label class="handoff-check"><input type="checkbox" v-model="handoffTransfer.contacts" /> Khách hàng</label>
              <label class="handoff-check"><input type="checkbox" v-model="handoffTransfer.nicks" /> Nick Zalo</label>
              <label class="handoff-check"><input type="checkbox" v-model="handoffTransfer.appointments" /> Lịch hẹn</label>
            </div>
            <div v-if="handoffResult" class="handoff-result">
              ✅ Đã bàn giao sang <strong>{{ handoffResult.to }}</strong>:
              {{ handoffResult.contacts }} khách, {{ handoffResult.nicks }} nick, {{ handoffResult.appointments }} lịch hẹn.
            </div>
            <button class="btn-handoff" :disabled="busy || !handoffToId" @click="confirmHandoff">
              🔄 Bàn giao ngay
            </button>
          </section>

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

  <!-- 2026-06-09 (anh báo popup confirm() trình duyệt xấu): modal xác nhận in-app
       tái dùng cho reset pw / bàn giao / vô hiệu. Riêng reset pw có tùy chọn gửi Zalo. -->
  <Teleport to="body">
    <div v-if="confirmModal.open" class="ce-overlay" @click.self="closeConfirm">
      <div class="ce-modal" :class="{ 'ce-danger': confirmModal.danger }">
        <h3 class="ce-title">{{ confirmModal.title }}</h3>
        <p class="ce-msg">{{ confirmModal.message }}</p>
        <!-- Tùy chọn gửi mật khẩu mới qua Zalo (chỉ hiện cho reset pw) -->
        <label v-if="confirmModal.showZaloOpt" class="ce-zalo-opt">
          <input type="checkbox" v-model="sendPwViaZalo" />
          Gửi mật khẩu mới cho nhân viên qua Zalo (nick hệ thống) — có lưu ở Thông báo hệ thống
        </label>
        <div class="ce-actions">
          <button class="ce-cancel" :disabled="busy" @click="closeConfirm">Hủy</button>
          <button class="ce-ok" :class="{ 'ce-ok-danger': confirmModal.danger }" :disabled="busy" @click="runConfirm">
            {{ busy ? 'Đang xử lý…' : confirmModal.okLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
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
const localPhone = ref('');
const deptIdLocal = ref<string>('');
const deptRoleLocal = ref<'leader' | 'deputy' | 'member'>('member');
const pgIdLocal = ref<string>('');
const ownedNicks = ref<OwnedNick[]>([]);
// Phase Privacy v2 2026-05-23
const maxPrivacyLocal = ref<number>(2);

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

// 2026-06-09 — admin/owner đặt lại mật khẩu cho sale khác (không cho tự reset chính mình ở đây).
const canResetPassword = computed(() => {
  return ['owner', 'admin'].includes(props.currentUserRole ?? '') && props.user?.id !== props.currentUserId;
});
const resetPwResult = ref<string | null>(null);
const sendPwViaZalo = ref(true); // mặc định gửi pw mới qua Zalo cho tiện sale

// 2026-06-09 — modal xác nhận in-app (thay confirm() trình duyệt xấu).
const confirmModal = ref<{
  open: boolean; title: string; message: string; okLabel: string;
  danger: boolean; showZaloOpt: boolean; action: (() => Promise<void>) | null;
}>({ open: false, title: '', message: '', okLabel: 'Xác nhận', danger: false, showZaloOpt: false, action: null });
function openConfirm(opts: Partial<typeof confirmModal.value> & { action: () => Promise<void> }) {
  confirmModal.value = {
    open: true, title: opts.title ?? 'Xác nhận', message: opts.message ?? '',
    okLabel: opts.okLabel ?? 'Xác nhận', danger: opts.danger ?? false,
    showZaloOpt: opts.showZaloOpt ?? false, action: opts.action,
  };
}
function closeConfirm() { if (!busy.value) confirmModal.value.open = false; }
async function runConfirm() {
  const act = confirmModal.value.action;
  if (act) await act();
  if (!error.value) confirmModal.value.open = false; // giữ modal mở nếu lỗi để user thấy
}
// Sinh mật khẩu dễ đọc cho sale (không ký tự khó gõ): chữ thường + số, 8 ký tự.
function genPassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789'; // bỏ o/0/l/1/i gây nhầm
  let out = '';
  for (let i = 0; i < 8; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function confirmResetPassword() {
  if (!props.user || !canResetPassword.value) return;
  openConfirm({
    title: 'Đặt lại mật khẩu',
    message: `Đặt lại mật khẩu cho "${props.user.fullName}"? Mật khẩu cũ sẽ mất, nhân viên phải đăng nhập lại bằng mật khẩu mới.`,
    okLabel: '🔑 Đặt lại',
    showZaloOpt: true,
    action: doResetPassword,
  });
}
async function doResetPassword() {
  if (!props.user) return;
  const newPw = genPassword();
  busy.value = true;
  error.value = '';
  resetPwResult.value = null;
  try {
    // sendZalo: BE sẽ gửi mật khẩu mới qua nick hệ thống + lưu Thông báo hệ thống.
    await api.put(`/users/${props.user.id}/password`, { password: newPw, sendZalo: sendPwViaZalo.value });
    resetPwResult.value = newPw; // vẫn hiện cho admin copy (phòng khi Zalo gửi lỗi)
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.response?.data?.message || 'Lỗi đặt lại mật khẩu';
  } finally {
    busy.value = false;
  }
}
function copyResetPw() {
  if (resetPwResult.value) navigator.clipboard?.writeText(resetPwResult.value).catch(() => {});
}

// 2026-06-09 — Bàn giao khách hàng khi sale nghỉ.
const store2 = useRbacStore();
const canHandoff = computed(() =>
  ['owner', 'admin'].includes(props.currentUserRole ?? '') && props.user?.id !== props.currentUserId,
);
// Người nhận = user active khác (loại chính người đang bàn giao).
const handoffTargets = computed(() =>
  (store2.users || []).filter((u) => u.id !== props.user?.id && u.isActive),
);
const handoffToId = ref('');
const handoffTransfer = ref({ contacts: true, nicks: true, appointments: true });
const handoffResult = ref<{ to: string; contacts: number; nicks: number; appointments: number } | null>(null);
function confirmHandoff() {
  if (!props.user || !handoffToId.value) return;
  const toName = handoffTargets.value.find((u) => u.id === handoffToId.value)?.fullName ?? 'người nhận';
  openConfirm({
    title: 'Bàn giao khách hàng',
    message: `Bàn giao toàn bộ của "${props.user.fullName}" sang "${toName}"? Khách hàng, nick Zalo, lịch hẹn sẽ chuyển sang người nhận.`,
    okLabel: '🔄 Bàn giao',
    action: doHandoff,
  });
}
async function doHandoff() {
  if (!props.user || !handoffToId.value) return;
  busy.value = true;
  error.value = '';
  handoffResult.value = null;
  try {
    const { data } = await api.post(`/users/${props.user.id}/handoff`, {
      toUserId: handoffToId.value,
      transfer: handoffTransfer.value,
    });
    handoffResult.value = { to: data.to, contacts: data.contacts, nicks: data.nicks, appointments: data.appointments };
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.response?.data?.message || 'Lỗi bàn giao';
  } finally {
    busy.value = false;
  }
}

// Phase Onboarding v1 2026-05-24 — màu pill % setup trong section header
const onboardingPctClass = computed(() => {
  const p = props.user?.onboarding?.percent ?? 0;
  if (p === 100) return 'ob-pct-done';
  if (p >= 50) return 'ob-pct-progress';
  return 'ob-pct-pending';
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
    localPhone.value = (props.user as any).phone ?? '';
    resetPwResult.value = null; // ẩn mật khẩu vừa reset khi chuyển sang user khác
    handoffToId.value = '';
    handoffResult.value = null;
    handoffTransfer.value = { contacts: true, nicks: true, appointments: true };
    deptIdLocal.value = props.user.departmentMember?.departmentId ?? '';
    deptRoleLocal.value = props.user.departmentMember?.deptRole ?? 'member';
    pgIdLocal.value = props.user.permissionGroupId ?? '';
    maxPrivacyLocal.value = (props.user as any).maxPrivacyNicks ?? 2;
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
    localEmail.value = props.user.email ?? '';
  } finally {
    busy.value = false;
  }
}

// 2026-06-09 — sửa SĐT (để trống = xoá số, giải phóng cho user khác). BE check trùng.
async function savePhone() {
  if (!props.user || !canEditInfo.value) return;
  const trimmed = localPhone.value.trim();
  const current = (props.user as any).phone ?? '';
  if (trimmed === current) return;
  busy.value = true;
  try {
    await api.put(`/users/${props.user.id}`, { phone: trimmed || null });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || e?.response?.data?.message || 'Lỗi đổi số điện thoại';
    localPhone.value = current; // revert khi lỗi (vd trùng số)
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

// Phase Privacy v2 2026-05-23
async function onMaxPrivacyChange() {
  if (!props.user) return;
  busy.value = true;
  error.value = '';
  try {
    await api.patch(`/users/${props.user.id}/max-privacy-nicks`, { maxPrivacyNicks: maxPrivacyLocal.value });
    emit('changed');
  } catch (e: any) {
    error.value = e?.response?.data?.error || 'Lỗi đổi maxPrivacyNicks';
    maxPrivacyLocal.value = (props.user as any).maxPrivacyNicks ?? 2;
  } finally {
    busy.value = false;
  }
}

function confirmDeactivate() {
  if (!props.user) return;
  openConfirm({
    title: 'Vô hiệu hóa nhân viên',
    message: `Vô hiệu hóa "${props.user.fullName || props.user.email}"? Nhân viên sẽ không đăng nhập được. Nên bàn giao khách hàng trước.`,
    okLabel: '🚫 Vô hiệu hóa',
    danger: true,
    action: doDeactivate,
  });
}
async function doDeactivate() {
  if (!props.user) return;
  busy.value = true;
  error.value = '';
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
/* 2026-06-09 — Đặt lại mật khẩu */
.btn-reset-pw {
  background: #fff;
  border: 1px solid #1786be;
  color: #0e6491;
  font-weight: 600;
  padding: 8px 14px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}
.btn-reset-pw:hover:not(:disabled) { background: #e4f1f8; }
.btn-reset-pw:disabled { opacity: 0.5; cursor: not-allowed; }
.reset-pw-result {
  background: #f0fdf4;
  border: 1px solid #86efac;
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 10px;
}
.reset-pw-row { display: flex; align-items: center; gap: 8px; }
.reset-pw-label { font-size: 12.5px; color: #41454d; }
.reset-pw-code {
  font-family: ui-monospace, monospace;
  font-size: 15px; font-weight: 700; letter-spacing: 1px;
  color: #0e6491; background: #fff; padding: 3px 10px; border-radius: 6px;
  border: 1px solid #bae6fd;
}
.btn-copy-sm { background: none; border: none; cursor: pointer; font-size: 15px; padding: 2px; }
.reset-pw-note { font-size: 11.5px; color: #6b7280; margin: 6px 0 0; }
.field-hint { font-size: 12px; color: #6b7280; margin: 0 0 10px; line-height: 1.4; }

/* 2026-06-09 — Modal xác nhận in-app (thay confirm() trình duyệt) */
.ce-overlay {
  position: fixed; inset: 0; background: rgba(6, 34, 47, 0.45);
  display: flex; align-items: center; justify-content: center; z-index: 12000;
  backdrop-filter: blur(2px);
}
.ce-modal {
  background: #fff; border-radius: 14px; padding: 22px 24px; width: 420px; max-width: calc(100vw - 32px);
  box-shadow: 0 24px 60px -12px rgba(6, 34, 47, 0.4);
}
.ce-title { font-size: 17px; font-weight: 700; color: #0e445a; margin: 0 0 8px; }
.ce-danger .ce-title { color: #b91c1c; }
.ce-msg { font-size: 13.5px; color: #41454d; line-height: 1.5; margin: 0 0 14px; }
.ce-zalo-opt {
  display: flex; align-items: flex-start; gap: 8px; font-size: 13px; color: #2b2f36;
  background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 10px 12px;
  margin-bottom: 16px; cursor: pointer; line-height: 1.4;
}
.ce-zalo-opt input { margin-top: 2px; }
.ce-actions { display: flex; justify-content: flex-end; gap: 10px; }
.ce-cancel {
  background: #f0f1f3; border: none; color: #41454d; font-weight: 500;
  padding: 9px 18px; border-radius: 8px; cursor: pointer; font-size: 13.5px;
}
.ce-cancel:hover:not(:disabled) { background: #e4e6e9; }
.ce-ok {
  background: #1786be; border: none; color: #fff; font-weight: 600;
  padding: 9px 18px; border-radius: 8px; cursor: pointer; font-size: 13.5px;
}
.ce-ok:hover:not(:disabled) { background: #0e6491; }
.ce-ok-danger { background: #dc2626; }
.ce-ok-danger:hover:not(:disabled) { background: #b91c1c; }
.ce-ok:disabled, .ce-cancel:disabled { opacity: 0.55; cursor: not-allowed; }

/* 2026-06-09 — Bàn giao */
.handoff-opts { display: flex; gap: 14px; margin: 10px 0; flex-wrap: wrap; }
.handoff-check { display: flex; align-items: center; gap: 5px; font-size: 13px; color: #41454d; cursor: pointer; }
.btn-handoff {
  background: #1786be; color: #fff; border: none; font-weight: 600;
  padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;
}
.btn-handoff:hover:not(:disabled) { background: #0e6491; }
.btn-handoff:disabled { opacity: 0.5; cursor: not-allowed; }
.handoff-result {
  background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px;
  padding: 8px 12px; margin-bottom: 10px; font-size: 13px; color: #166534;
}

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

/* Phase Onboarding v1 2026-05-24 — section trong UserEditPanel */
.ob-pct {
  font-size: 11.5px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 9999px;
}
.ob-pct-done     { background: #ECFDF5; color: #047857; }
.ob-pct-progress { background: #FEF3C7; color: #92400E; }
.ob-pct-pending  { background: #FEE2E2; color: #B91C1C; }

.ob-steplist {
  list-style: none;
  padding: 0;
  margin: 8px 0 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ob-stepitem {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #41454d;
  padding: 6px 10px;
  border-radius: 6px;
  background: #f7f8fa;
}
.ob-stepitem.done { color: #0a2e0e; background: #ECFDF5; }
.ob-stepitem.skipped { color: #9297a0; background: #f0f1f3; font-style: italic; }
.ob-mark { width: 18px; text-align: center; }
.ob-tag-mini {
  margin-left: 6px;
  font-size: 10px;
  font-weight: 600;
  color: #9297a0;
  background: white;
  padding: 1px 6px;
  border-radius: 9999px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
