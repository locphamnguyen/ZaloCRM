<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<!--
  OwnerReassignDrawer — Phase 4 ZaloAccounts redesign 2026-05-22.

  Slide-from-right 420px. Reassign owner cho nick (chuyển nhượng chính chủ).
  Permission: org admin/owner HOẶC current owner. BE đã enforce, FE gate cũng disable
  nút submit nếu user không có quyền (canManage=false).

  Side effect (BE): revokeAllSessions(oldOwner) — owner cũ mất privacy unlock ngay.
  FE hiển thị warning rõ.
-->
<template>
  <Teleport to="body">
    <transition name="drawer">
      <div v-if="modelValue" class="orad-backdrop" @click.self="$emit('update:modelValue', false)">
        <div class="orad-panel" role="dialog" aria-labelledby="orad-title">
          <header class="orad-head">
            <h3 id="orad-title">Chuyển nhượng Owner nick</h3>
            <button class="orad-x" @click="$emit('update:modelValue', false)">✕</button>
          </header>

          <div class="orad-body">
            <!-- Nick info -->
            <div class="orad-nick" v-if="account">
              <div class="orad-avatar" :style="{ background: avatarColor(account.displayName || '?') }">
                {{ initials(account.displayName || '?') }}
              </div>
              <div class="orad-nick-info">
                <div class="orad-nick-name">{{ account.displayName || 'Nick chưa đặt tên' }}</div>
                <div class="orad-nick-uid">
                  <span v-if="account.zaloUid">UID {{ account.zaloUid }}</span>
                  <span v-if="account.privacyMode === 'main'" class="orad-priv">🔒 Riêng tư</span>
                </div>
              </div>
            </div>

            <!-- Current owner -->
            <div class="orad-field">
              <label>Owner hiện tại</label>
              <div class="orad-current-owner">
                <span class="orad-avatar-mini" :style="{ background: avatarColor((account?.owner?.fullName || account?.owner?.email) || '?') }">
                  {{ shortName(account?.owner?.fullName || account?.owner?.email || '') }}
                </span>
                <div>
                  <div class="orad-owner-name">{{ account?.owner?.fullName || account?.owner?.email }}</div>
                  <div class="orad-owner-meta" v-if="account?.ownerDepartment">
                    {{ account.ownerDepartment.name }}
                    <span v-if="account.ownerDeptRole === 'leader'" class="orad-dept-role">Trưởng phòng</span>
                    <span v-else-if="account.ownerDeptRole === 'deputy'" class="orad-dept-role">Phó phòng</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- New owner picker -->
            <div class="orad-field">
              <label for="orad-new-owner">Chuyển sang user</label>
              <input
                v-model="searchQuery"
                placeholder="Tìm theo tên hoặc email..."
                class="orad-search"
              />
              <div class="orad-user-list">
                <button
                  v-for="u in filteredUsers"
                  :key="u.id"
                  type="button"
                  class="orad-user-item"
                  :class="{ selected: selectedUserId === u.id, current: u.id === account?.ownerUserId }"
                  :disabled="u.id === account?.ownerUserId"
                  @click="selectedUserId = u.id"
                >
                  <span class="orad-avatar-mini" :style="{ background: avatarColor(u.fullName || u.email) }">
                    {{ shortName(u.fullName || u.email) }}
                  </span>
                  <div class="orad-user-info">
                    <div class="orad-user-name">{{ u.fullName || u.email }}</div>
                    <div class="orad-user-email">{{ u.email }}</div>
                  </div>
                  <span v-if="u.id === account?.ownerUserId" class="orad-tag-current">Hiện tại</span>
                </button>
                <div v-if="!filteredUsers.length" class="orad-empty">Không tìm thấy user</div>
              </div>
            </div>

            <!-- Privacy warning -->
            <div class="orad-warning">
              <span class="orad-warn-icon">⚠️</span>
              <div>
                <div class="orad-warn-title">Side effect</div>
                <div class="orad-warn-body">
                  Khi đổi owner, mọi <b>session Riêng tư của owner cũ sẽ bị revoke</b> ngay lập tức.
                  Owner cũ sẽ phải nhập PIN lại nếu muốn xem nội dung nick này (nếu privacyMode='main').
                </div>
              </div>
            </div>

            <div v-if="errorMsg" class="orad-error">{{ errorMsg }}</div>
          </div>

          <footer class="orad-foot">
            <button class="orad-btn-ghost" @click="$emit('update:modelValue', false)">Huỷ</button>
            <button
              class="orad-btn-primary"
              :disabled="!canSubmit || submitting"
              @click="onSubmit"
            >
              {{ submitting ? 'Đang chuyển...' : 'Chuyển nhượng' }}
            </button>
          </footer>
        </div>
      </div>
    </transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { api } from '@/api/index';
import type { EnrichedAccount } from '@/composables/use-zalo-accounts-dashboard';

const props = defineProps<{
  modelValue: boolean;
  account: EnrichedAccount | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  reassigned: [accountId: string, newOwnerUserId: string];
}>();

interface OrgUser {
  id: string;
  fullName: string | null;
  email: string;
}

const users = ref<OrgUser[]>([]);
const searchQuery = ref('');
const selectedUserId = ref<string | null>(null);
const submitting = ref(false);
const errorMsg = ref('');

async function fetchUsers() {
  try {
    // BE trả { users: OrgUser[] } chứ không phải array thuần.
    // Fix 2026-06-02: trước gán data trực tiếp → sort() crash → unmount click handlers.
    const { data } = await api.get<{ users: OrgUser[] } | OrgUser[]>('/users');
    const list = Array.isArray(data) ? data : (data as { users: OrgUser[] }).users ?? [];
    users.value = list;
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || 'Không tải được danh sách user';
  }
}

onMounted(fetchUsers);

watch(() => props.modelValue, (open) => {
  if (open) {
    searchQuery.value = '';
    selectedUserId.value = null;
    errorMsg.value = '';
    // Refresh user list mỗi lần mở (org có thể có user mới)
    fetchUsers();
  }
});

const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  let list = users.value;
  if (q) {
    list = list.filter((u) =>
      (u.fullName?.toLowerCase().includes(q) ?? false) || u.email.toLowerCase().includes(q),
    );
  }
  // Sort: current owner last, rest by name
  return list.sort((a, b) => {
    if (a.id === props.account?.ownerUserId) return 1;
    if (b.id === props.account?.ownerUserId) return -1;
    return (a.fullName ?? a.email).localeCompare(b.fullName ?? b.email);
  });
});

const canSubmit = computed(() =>
  !!selectedUserId.value && selectedUserId.value !== props.account?.ownerUserId,
);

async function onSubmit() {
  if (!canSubmit.value || !props.account) return;
  submitting.value = true;
  errorMsg.value = '';
  try {
    await api.patch(`/zalo-accounts/${props.account.id}/owner`, {
      newOwnerUserId: selectedUserId.value,
    });
    emit('reassigned', props.account.id, selectedUserId.value!);
    emit('update:modelValue', false);
  } catch (err: any) {
    errorMsg.value = err?.response?.data?.error || 'Chuyển nhượng thất bại';
  } finally {
    submitting.value = false;
  }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[parts.length - 1][0] || '?').toUpperCase();
}
function avatarColor(name: string): string {
  const palettes = [
    'linear-gradient(135deg,#f59e0b,#ef4444)',
    'linear-gradient(135deg,#3b82f6,#1e40af)',
    'linear-gradient(135deg,#10b981,#059669)',
    'linear-gradient(135deg,#8b5cf6,#6d28d9)',
    'linear-gradient(135deg,#ec4899,#be185d)',
  ];
  const h = name.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return palettes[h % palettes.length];
}
</script>

<style scoped>
.orad-backdrop {
  position: fixed; inset: 0;
  background: rgba(15, 23, 42, 0.4);
  z-index: 1100;
  display: flex; justify-content: flex-end;
}
.orad-panel {
  width: 420px; max-width: 100vw;
  background: white;
  display: flex; flex-direction: column;
  height: 100vh;
  box-shadow: -8px 0 32px rgba(15, 23, 42, 0.15);
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
}
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.2s ease; }
.drawer-enter-active .orad-panel, .drawer-leave-active .orad-panel { transition: transform 0.2s ease; }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .orad-panel, .drawer-leave-to .orad-panel { transform: translateX(100%); }

.orad-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 22px; border-bottom: 1px solid #E5E7EB;
  flex-shrink: 0;
}
.orad-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: #0F172A; }
.orad-x {
  background: transparent; border: none; cursor: pointer; font-size: 18px;
  color: #6B7280; width: 28px; height: 28px; border-radius: 6px;
}
.orad-x:hover { background: #F3F4F6; color: #111827; }

.orad-body {
  flex: 1; overflow-y: auto; padding: 18px 22px;
  display: flex; flex-direction: column; gap: 18px;
}

.orad-nick {
  display: flex; align-items: center; gap: 12px;
  padding: 14px; background: #F9FAFB; border-radius: 10px;
  border: 1px solid #E5E7EB;
}
.orad-avatar {
  width: 44px; height: 44px; border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 14px;
  flex-shrink: 0;
}
.orad-nick-info { min-width: 0; }
.orad-nick-name { font-size: 14px; font-weight: 600; color: #0F172A; }
.orad-nick-uid { font-size: 11px; color: #6B7280; margin-top: 2px; display: flex; gap: 6px; align-items: center; }
.orad-priv { background: #FEF3C7; color: #92400E; padding: 1px 6px; border-radius: 4px; font-weight: 600; font-size: 10px; }

.orad-field { display: flex; flex-direction: column; gap: 6px; }
.orad-field label { font-size: 11px; color: #6B7280; text-transform: uppercase; letter-spacing: .04em; font-weight: 600; }

.orad-current-owner {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; background: #EFF6FF; border-radius: 8px;
  border: 1px solid #DBEAFE;
}
.orad-avatar-mini {
  width: 32px; height: 32px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 12px;
  flex-shrink: 0;
}
.orad-owner-name { font-size: 13px; font-weight: 600; color: #0F172A; }
.orad-owner-meta { font-size: 11px; color: #6B7280; margin-top: 2px; display: flex; gap: 6px; align-items: center; }
.orad-dept-role { background: #DBEAFE; color: #1D4ED8; padding: 1px 6px; border-radius: 4px; font-weight: 600; font-size: 9.5px; }

.orad-search {
  width: 100%; padding: 9px 12px; border: 1px solid #E5E7EB;
  border-radius: 8px; font-size: 13px; font-family: inherit;
  margin-bottom: 4px;
}
.orad-search:focus { outline: none; border-color: #5E6AD2; box-shadow: 0 0 0 2px rgba(94,106,210,0.15); }

.orad-user-list {
  max-height: 280px; overflow-y: auto;
  border: 1px solid #E5E7EB; border-radius: 8px;
  display: flex; flex-direction: column;
}
.orad-user-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px;
  background: white; border: none; border-bottom: 1px solid #F3F4F6;
  cursor: pointer; text-align: left; font-family: inherit;
  width: 100%;
  transition: background 0.1s;
}
.orad-user-item:last-child { border-bottom: none; }
.orad-user-item:hover:not(:disabled) { background: #F9FAFB; }
.orad-user-item.selected { background: #EEF0FF; }
.orad-user-item.current { opacity: 0.55; cursor: not-allowed; }
.orad-user-info { flex: 1; min-width: 0; }
.orad-user-name { font-size: 13px; font-weight: 600; color: #0F172A; }
.orad-user-email { font-size: 11px; color: #9CA3AF; margin-top: 1px; }
.orad-tag-current { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #E5E7EB; color: #6B7280; font-weight: 600; }
.orad-empty { padding: 20px; text-align: center; color: #9CA3AF; font-size: 12px; }

.orad-warning {
  display: flex; gap: 10px;
  padding: 12px 14px;
  background: #FFFBEB; border: 1px solid #FDE68A; border-radius: 8px;
}
.orad-warn-icon { font-size: 18px; line-height: 1; flex-shrink: 0; }
.orad-warn-title { font-size: 12px; font-weight: 700; color: #92400E; margin-bottom: 2px; }
.orad-warn-body { font-size: 11.5px; color: #78350F; line-height: 1.5; }

.orad-error {
  background: #FEF2F2; border: 1px solid #FCA5A5; color: #B91C1C;
  padding: 10px 12px; border-radius: 8px; font-size: 12px;
}

.orad-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 14px 22px; border-top: 1px solid #E5E7EB; flex-shrink: 0;
  background: #FAFAFB;
}
.orad-btn-ghost {
  background: white; border: 1px solid #E5E7EB; color: #374151;
  padding: 9px 16px; border-radius: 7px; cursor: pointer; font-weight: 600; font-size: 13px;
}
.orad-btn-ghost:hover { background: #F9FAFB; }
.orad-btn-primary {
  background: linear-gradient(135deg, #5E6AD2, #4C57B8); color: white;
  border: none; padding: 9px 18px; border-radius: 7px; cursor: pointer; font-weight: 600; font-size: 13px;
}
.orad-btn-primary:hover:not(:disabled) { background: linear-gradient(135deg, #4C57B8, #3F4AA0); }
.orad-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
