<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <div v-if="modelValue" class="modal-backdrop" @click.self="onClose" @keydown.esc="onClose">
    <div class="modal" role="dialog" aria-labelledby="folder-modal-title" aria-modal="true">

      <!-- Header: chỉ có tabs -->
      <div class="modal-header">
        <div class="tabs" role="tablist">
          <button
            type="button"
            class="tab"
            :class="{ active: activeTab === 'view' }"
            role="tab"
            :aria-selected="activeTab === 'view'"
            @click="activeTab = 'view'"
          >📂 Chọn xem</button>
          <button
            type="button"
            class="tab"
            :class="{ active: activeTab === 'manage' }"
            role="tab"
            :aria-selected="activeTab === 'manage'"
            @click="activeTab = 'manage'"
          >⚙ Quản lý</button>
        </div>
        <button class="modal-close" type="button" @click="onClose" aria-label="Đóng">✕</button>
      </div>

      <!-- ═════════ TAB 1: CHỌN XEM (auto-apply on click) ═════════ -->
      <div v-if="activeTab === 'view'" class="modal-body view-body">

        <!-- Folder gridcards -->
        <div class="view-section">
          <div class="view-section-label">📁 Theo thư mục</div>
          <div class="folder-grid">
            <!-- ALL card -->
            <button
              type="button"
              class="folder-card"
              :class="{ selected: viewFolderId === null && viewAccountId === null }"
              @click="onApplyFolder(null)"
            >
              <div class="fc-thumb-all">🌐</div>
              <div class="fc-body">
                <div class="fc-name">ALL — Toàn bộ</div>
                <div class="fc-meta">
                  <span class="nk-dot on"></span>{{ allNickCounts.online }} online
                  <span class="nk-sep">·</span>
                  <span class="nk-dot off"></span>{{ allNickCounts.offline }} offline
                </div>
              </div>
            </button>

            <!-- User folders: avatar sale · tên · online/offline (sort theo last name) -->
            <button
              v-for="folder in sortedFolders"
              :key="`view-${folder.id}`"
              type="button"
              class="folder-card"
              :class="{ selected: viewFolderId === folder.id && viewAccountId === null }"
              @click="onApplyFolder(folder.id)"
              :title="folder.name"
            >
              <div class="fc-thumb">
                <template v-if="folder.members.length >= 1">
                  <div class="single" :style="memberAvatarStyle(folder.members[0], 0)">
                    <span v-if="!folder.members[0].avatarUrl">{{ initials(folder.members[0].displayName) }}</span>
                  </div>
                </template>
                <template v-else>
                  <div class="single empty">?</div>
                </template>
              </div>
              <div class="fc-body">
                <div class="fc-name">{{ folder.name }}</div>
                <div class="fc-meta">
                  <span class="nk-dot on"></span>{{ nickCounts(folder.members).online }} online
                  <span class="nk-sep">·</span>
                  <span class="nk-dot off"></span>{{ nickCounts(folder.members).offline }} offline
                </div>
              </div>
            </button>
          </div>
        </div>

        <!-- Nick scroll list -->
        <div class="view-section">
          <div class="view-section-label">👤 Hoặc chọn 1 nick</div>
          <div class="nick-search">
            <span class="ic">🔍</span>
            <input v-model="viewNickSearch" type="text" placeholder="Tìm nick..." />
            <button v-if="viewNickSearch" type="button" class="ns-clear" @click="viewNickSearch = ''" aria-label="Xoá tìm kiếm">✕</button>
          </div>
          <div class="nick-pickbox">
            <div v-if="loadingAccounts" class="nick-empty">Đang tải nick...</div>
            <div v-else-if="filteredAllAccounts.length === 0" class="nick-empty">
              {{ viewNickSearch ? `Không tìm thấy nick "${viewNickSearch}"` : 'Chưa có nick Zalo nào' }}
            </div>
            <div
              v-for="acc in filteredAllAccounts"
              :key="`np-${acc.id}`"
              class="nick-pick-rowwrap"
            >
              <button
                type="button"
                class="nick-pick-row"
                :class="{ selected: viewAccountId === acc.id && viewFolderId === null }"
                @click="onApplyAccount(acc.id)"
              >
                <img v-if="acc.avatarUrl" :src="acc.avatarUrl" class="np-avatar-img" :alt="acc.displayName || ''" />
                <div v-else class="np-avatar" :style="{ background: accountGradient(acc.id) }">{{ initials(acc.displayName) }}</div>
                <div class="np-body">
                  <div class="np-name">{{ acc.displayName || 'Chưa đặt tên' }}</div>
                  <div class="np-sub">
                    <span class="status-dot" :class="{ off: (acc.liveStatus || acc.status) !== 'connected' }"></span>
                    {{ (acc.liveStatus || acc.status) === 'connected' ? 'Active' : 'Offline' }}<span v-if="acc.phone"> · {{ acc.phone }}</span>
                  </div>
                </div>
                <div v-if="viewAccountId === acc.id && viewFolderId === null" class="np-check">✓</div>
              </button>
              <!-- 2026-06-11: nút nhanh per-nick (port main): Sync danh bạ / Sync lịch sử /
                   Kết nối lại / Đăng nhập QR. Mờ theo liveStatus cho nhất quán. -->
              <div class="np-actions" @click.stop>
                <button type="button" class="np-act" title="Sync danh bạ" @click="onSyncContacts(acc.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                </button>
                <button type="button" class="np-act" title="Sync lịch sử chat" :disabled="(acc.liveStatus || acc.status) !== 'connected'" @click="onSyncHistory(acc.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button type="button" class="np-act" title="Kết nối lại" :disabled="(acc.liveStatus || acc.status) === 'connected'" @click="onReconnect(acc.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
                </button>
                <button type="button" class="np-act" title="Đăng nhập QR" :disabled="(acc.liveStatus || acc.status) === 'connected'" @click="onQRLogin(acc.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- ═════════ TAB 2: QUẢN LÝ ═════════ -->
      <div v-else class="modal-body manage-body">

        <!-- LEFT: folder list -->
        <div class="ml-list">
          <div class="ml-list-label">Thư mục hiện có ({{ folders.length }})</div>

          <button
            v-for="folder in sortedFolders"
            :key="folder.id"
            type="button"
            class="ml-folder-item"
            :class="{ selected: selectedFolderId === folder.id }"
            @click="selectFolder(folder.id)"
          >
            <div class="ml-thumb">
              <template v-if="folder.members.length >= 2">
                <div class="av av-0" :style="memberAvatarStyle(folder.members[0], 0)">
                  <span v-if="!folder.members[0].avatarUrl">{{ initials(folder.members[0].displayName) }}</span>
                </div>
                <div class="av av-1" :style="memberAvatarStyle(folder.members[1], 1)">
                  <span v-if="!folder.members[1].avatarUrl">{{ initials(folder.members[1].displayName) }}</span>
                </div>
              </template>
              <template v-else-if="folder.members.length === 1">
                <div class="single" :style="memberAvatarStyle(folder.members[0], 0)">
                  <span v-if="!folder.members[0].avatarUrl">{{ initials(folder.members[0].displayName) }}</span>
                </div>
              </template>
              <template v-else>
                <div class="single empty">?</div>
              </template>
            </div>
            <div class="ml-body">
              <div class="ml-name">{{ folder.name }}</div>
              <div class="ml-sub">{{ folder.members.length }} nick chăm</div>
            </div>
            <div class="ml-count">{{ folder.totalCount }}</div>
          </button>

          <button class="ml-create-btn" type="button" @click="startCreate">
            <span>＋</span> Tạo thư mục mới
          </button>

          <!-- Mục 2: nút nhỏ gọn tự tạo thư mục theo nick — tooltip rê chuột -->
          <button
            class="ml-sync-btn"
            type="button"
            :disabled="syncing"
            title="Tự tạo một thư mục cho mỗi người dùng có nick Zalo, gom các nick của họ. Đồng bộ thông minh — không xoá thư mục bạn đã chỉnh tay."
            @click="onSyncByOwner"
          >
            <svg v-if="!syncing" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17v-6h-6"/><path d="M21 7a9 9 0 0 0-15-3M3 17a9 9 0 0 0 15 3"/></svg>
            <span v-else class="ml-sync-spin">⟳</span>
            {{ syncing ? 'Đang cập nhật…' : 'Cập nhật thư mục theo nick' }}
          </button>
          <div v-if="syncMsg" class="ml-sync-msg">{{ syncMsg }}</div>
        </div>

        <!-- RIGHT: nick grid + edit -->
        <div class="ml-edit">
          <div v-if="!editingFolder && !creating" class="ml-empty">
            <div class="ml-empty-icon">📂</div>
            <div class="ml-empty-title">Chọn 1 thư mục bên trái</div>
            <div class="ml-empty-sub">hoặc tạo mới để bắt đầu</div>
          </div>

          <template v-else>
            <div class="ml-edit-head">
              <div class="ml-name-input">
                <label for="folder-name-input">Tên thư mục</label>
                <input
                  id="folder-name-input"
                  type="text"
                  v-model="formName"
                  placeholder="Vd: Hot leads, B2B Extension..."
                  maxlength="64"
                />
              </div>
              <button v-if="editingFolder" type="button" class="ml-delete-btn" @click="onDeleteFolder">🗑 Xoá</button>
            </div>

            <div class="ml-nick-section-head">
              <div class="title">
                <span>Chọn nick thuộc thư mục</span>
                <span class="selected-count">{{ formAccountIds.size }} đã chọn</span>
              </div>
              <div class="ml-nick-controls">
                <!-- Mục 3: lọc nick grid theo user -->
                <select v-model="nickOwnerFilter" class="ml-owner-select">
                  <option value="all">Tất cả người dùng</option>
                  <option v-for="o in ownerOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
                </select>
                <div class="ml-nick-search">
                  <span class="ic">🔍</span>
                  <input v-model="nickSearch" type="text" placeholder="Tìm nick..." />
                </div>
              </div>
            </div>

            <div v-if="loadingAccounts" class="ml-loading">Đang tải nick...</div>
            <div v-else-if="filteredAccounts.length === 0" class="ml-loading">
              {{ nickSearch ? `Không tìm thấy nick "${nickSearch}"` : 'Chưa có nick Zalo nào' }}
            </div>
            <div v-else class="nick-grid">
              <button
                v-for="acc in filteredAccounts"
                :key="acc.id"
                type="button"
                class="nick-card"
                :class="[nickStateClass(acc), { selected: formAccountIds.has(acc.id) }]"
                @click="toggleAccount(acc.id)"
              >
                <div class="nick-check"><span v-if="formAccountIds.has(acc.id)">✓</span></div>
                <div class="nick-head">
                  <img v-if="acc.avatarUrl" :src="acc.avatarUrl" class="nick-avatar-img" :alt="acc.displayName || ''" />
                  <div v-else class="nick-avatar" :style="{ background: accountGradient(acc.id) }">{{ initials(acc.displayName) }}</div>
                  <div class="nick-id">
                    <div class="nick-name" :title="acc.displayName || ''">{{ acc.displayName || 'Chưa đặt tên' }}</div>
                    <div class="nick-phone">{{ acc.phone || '— chưa có SĐT' }}</div>
                  </div>
                </div>
                <div class="nick-foot">
                  <span class="nick-status" :class="nickStateClass(acc)">
                    <span class="dot"></span>{{ nickStateLabel(acc) }}
                  </span>
                  <span v-if="acc.owner" class="nick-owner" :title="acc.owner.fullName || acc.owner.email">{{ lastWord(acc.owner.fullName || acc.owner.email) }}</span>
                </div>
              </button>
            </div>
          </template>
        </div>

      </div>

      <!-- ═════════ FOOTER ═════════ -->
      <!-- Tab 1 không cần footer (auto-apply on click). Tab 2 có footer Save -->
      <div v-if="activeTab === 'manage'" class="modal-footer">
        <div class="mf-status">
          <template v-if="editingFolder || creating">
            <strong>{{ formAccountIds.size }} nick</strong> sẽ gom vào
            <strong v-if="formName.trim()">{{ formName }}</strong>
            <span v-else class="muted">(chưa đặt tên)</span>
          </template>
          <template v-else>
            <span class="muted">Chưa chọn thư mục</span>
          </template>
        </div>
        <div class="mf-actions">
          <button class="btn" type="button" @click="onClose">Đóng</button>
          <button
            class="btn primary"
            type="button"
            :disabled="!canSave || saving"
            @click="onSave"
          >
            <span v-if="saving">Đang lưu...</span>
            <span v-else-if="creating">💾 Tạo thư mục</span>
            <span v-else>💾 Lưu thay đổi</span>
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import type { AccountFolder } from '@/composables/use-inbox-filters';
import { useZaloAccounts, type ZaloAccount } from '@/composables/use-zalo-accounts';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';

const toast = useToast();

const props = defineProps<{
  modelValue: boolean;
  filters: any;
  allAccountsCount?: number;
  totalUnread?: number;
  currentAccountId?: string | null;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: boolean];
  'view-applied': [payload: { folderId: string | null; accountId: string | null }];
}>();

const { accounts, fetchAccounts } = useZaloAccounts();

// ─── Nút nhanh per-nick (port main 2026-06-11) ──────────────────────────────
async function onSyncContacts(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/sync-contacts`);
    toast.push('Đồng bộ danh bạ thành công', 'success');
    await fetchAccounts();
  } catch (e: any) {
    const m = e.response?.data?.error || e.message;
    toast.push(/429|giới hạn/i.test(m) ? m : 'Đồng bộ danh bạ thất bại: ' + m, 'error');
  }
}
async function onSyncHistory(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/sync-history`);
    toast.push('Đồng bộ lịch sử chat thành công', 'success');
  } catch (e: any) {
    toast.push('Đồng bộ lịch sử chat thất bại: ' + (e.response?.data?.error || e.message), 'error');
  }
}
async function onReconnect(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/reconnect`);
    toast.push('Đang kết nối lại nick…', 'success');
    await fetchAccounts();
  } catch (e: any) {
    toast.push('Kết nối lại thất bại: ' + (e.response?.data?.error || e.message), 'error');
  }
}
async function onQRLogin(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/login`);
    toast.push('Đã khởi tạo QR — mở Cài đặt → Tài khoản Zalo để quét', 'success');
  } catch (e: any) {
    toast.push('Khởi tạo QR thất bại: ' + (e.response?.data?.error || e.message), 'error');
  }
}
const loadingAccounts = ref(false);

// Default to "view" tab — daily use case
const activeTab = ref<'view' | 'manage'>('view');

const folders = computed<AccountFolder[]>(() => props.filters.folders.value);

// Sắp xếp theo "tên" (last name = từ cuối của tên thư mục, vd "Phạm Chí Thanh" → "Thanh").
// Tên thư mục = fullName của owner (xem sync-by-owner) nên đây là cách sort kiểu VN.
function lastNameKey(name: string): string {
  const parts = (name || '').trim().split(/\s+/);
  return (parts[parts.length - 1] || '').toLocaleLowerCase('vi');
}
const sortedFolders = computed<AccountFolder[]>(() =>
  [...folders.value].sort((a, b) => {
    const cmp = lastNameKey(a.name).localeCompare(lastNameKey(b.name), 'vi');
    return cmp !== 0 ? cmp : (a.name || '').localeCompare(b.name || '', 'vi');
  })
);

// Đếm nick online/offline trong 1 folder (online = status 'connected', khớp nick rows).
function nickCounts(members: Array<{ status: string }>): { online: number; offline: number } {
  let online = 0;
  for (const m of members) if (m.status === 'connected') online++;
  return { online, offline: members.length - online };
}
// Card ALL: gộp online/offline toàn bộ nick (ưu tiên liveStatus realtime).
const allNickCounts = computed(() => {
  let online = 0;
  for (const a of accounts.value) {
    if ((((a as any).liveStatus ?? a.status) as string) === 'connected') online++;
  }
  return { online, offline: accounts.value.length - online };
});

// ─── TAB 1: VIEW state ───────────────────────────────
const viewFolderId = ref<string | null>(null);
const viewAccountId = ref<string | null>(null);
const viewNickSearch = ref('');

const filteredAllAccounts = computed<ZaloAccount[]>(() => {
  const q = viewNickSearch.value.trim().toLowerCase();
  const list = q
    ? accounts.value.filter((a) =>
        (a.displayName || '').toLowerCase().includes(q) ||
        (a.phone || '').toLowerCase().includes(q)
      )
    : accounts.value;
  // Pin currently selected nick to top
  const selectedId = viewAccountId.value;
  if (!selectedId) return list;
  return [...list].sort((a, b) => {
    if (a.id === selectedId) return -1;
    if (b.id === selectedId) return 1;
    return 0;
  });
});

function onApplyFolder(id: string | null) {
  // Click folder → folder view (mutually exclusive with nick)
  viewFolderId.value = id;
  viewAccountId.value = null;
  emit('view-applied', { folderId: id, accountId: null });
  emit('update:modelValue', false);
}

function onApplyAccount(id: string) {
  // Click nick → single-nick view (clears folder)
  viewFolderId.value = null;
  viewAccountId.value = id;
  emit('view-applied', { folderId: null, accountId: id });
  emit('update:modelValue', false);
}

// ─── TAB 2: MANAGE state ─────────────────────────────
const selectedFolderId = ref<string | null>(null);
const creating = ref(false);
const formName = ref('');
const formAccountIds = ref<Set<string>>(new Set());
const nickSearch = ref('');
const saving = ref(false);

const editingFolder = computed<AccountFolder | null>(() => {
  if (!selectedFolderId.value) return null;
  return folders.value.find((x) => x.id === selectedFolderId.value) || null;
});

// 2026-06-11 (mục 3) — lọc nick grid theo user (owner). Dropdown phía trên grid.
const nickOwnerFilter = ref<string>('all');
const ownerOptions = computed(() => {
  const map = new Map<string, string>();
  for (const a of accounts.value) {
    const oid = (a as any).ownerUserId ?? a.owner?.id;
    if (oid && !map.has(oid)) map.set(oid, a.owner?.fullName || a.owner?.email || 'Không tên');
  }
  return Array.from(map.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((x, y) => x.name.localeCompare(y.name));
});

const filteredAccounts = computed<ZaloAccount[]>(() => {
  const q = nickSearch.value.trim().toLowerCase();
  const owner = nickOwnerFilter.value;
  return accounts.value.filter((a) => {
    if (owner !== 'all') {
      const oid = (a as any).ownerUserId ?? a.owner?.id;
      if (oid !== owner) return false;
    }
    if (!q) return true;
    return (
      (a.displayName || '').toLowerCase().includes(q) ||
      (a.phone || '').toLowerCase().includes(q)
    );
  });
});

// Trạng thái nick → class viền + nhãn (atlas v2). connected=online, qr_pending=pending, còn lại=offline.
function nickStateClass(a: ZaloAccount): string {
  const s = (a as any).liveStatus ?? a.status;
  if (s === 'connected') return 'is-online';
  if (s === 'qr_pending') return 'is-pending';
  return 'is-offline';
}
function nickStateLabel(a: ZaloAccount): string {
  const s = (a as any).liveStatus ?? a.status;
  if (s === 'connected') return 'Online';
  if (s === 'qr_pending') return 'Chờ đăng nhập';
  return 'Offline';
}

// ─── Mục 2: nút Cập nhật thư mục theo nick (sync-by-owner) ───────────────
const syncing = ref(false);
const syncMsg = ref('');
async function onSyncByOwner() {
  if (syncing.value) return;
  syncing.value = true;
  syncMsg.value = '';
  try {
    const r = await props.filters.syncFoldersByOwner();
    syncMsg.value = `Đã tạo ${r.createdFolders} thư mục, thêm ${r.addedMembers} nick (${r.ownersWithNicks} người dùng có nick).`;
    setTimeout(() => { syncMsg.value = ''; }, 6000);
  } catch {
    syncMsg.value = 'Cập nhật thất bại, vui lòng thử lại.';
  } finally {
    syncing.value = false;
  }
}

const canSave = computed(() => {
  if (!formName.value.trim()) return false;
  if (creating.value) return true;
  if (!editingFolder.value) return false;
  const existingIds = new Set(editingFolder.value.members.map((m) => m.id));
  const sameMembers =
    existingIds.size === formAccountIds.value.size &&
    [...formAccountIds.value].every((id) => existingIds.has(id));
  return !sameMembers || formName.value !== editingFolder.value.name;
});

function selectFolder(id: string) {
  creating.value = false;
  selectedFolderId.value = id;
  const f = folders.value.find((x) => x.id === id);
  if (f) {
    formName.value = f.name;
    formAccountIds.value = new Set(f.members.map((m) => m.id));
  }
}

function startCreate() {
  creating.value = true;
  selectedFolderId.value = null;
  formName.value = '';
  formAccountIds.value = new Set();
}

function toggleAccount(id: string) {
  if (formAccountIds.value.has(id)) formAccountIds.value.delete(id);
  else formAccountIds.value.add(id);
  formAccountIds.value = new Set(formAccountIds.value);
}

async function onSave() {
  if (!canSave.value) return;
  saving.value = true;
  try {
    if (creating.value) {
      await props.filters.createFolder({
        name: formName.value.trim(),
        accountIds: [...formAccountIds.value],
      });
      creating.value = false;
    } else if (editingFolder.value) {
      const f = editingFolder.value;
      if (formName.value.trim() !== f.name) {
        await props.filters.updateFolder(f.id, { name: formName.value.trim() });
      }
      const existingIds = new Set(f.members.map((m) => m.id));
      const newIds = formAccountIds.value;
      const sameMembers =
        existingIds.size === newIds.size &&
        [...newIds].every((id) => existingIds.has(id));
      if (!sameMembers) {
        await props.filters.setFolderMembers(f.id, [...newIds]);
      }
    }
  } catch (err) {
    console.error('[FolderManagePopup] save failed', err);
    alert('Lưu thất bại. Vui lòng thử lại.');
  } finally {
    saving.value = false;
  }
}

async function onDeleteFolder() {
  if (!editingFolder.value) return;
  if (!window.confirm(`Xoá thư mục "${editingFolder.value.name}"? Hành động này không thể hoàn tác.`)) return;
  saving.value = true;
  try {
    await props.filters.deleteFolder(editingFolder.value.id);
    selectedFolderId.value = null;
    formName.value = '';
    formAccountIds.value = new Set();
  } catch (err) {
    console.error('[FolderManagePopup] delete failed', err);
    alert('Xoá thất bại. Vui lòng thử lại.');
  } finally {
    saving.value = false;
  }
}

function onClose() {
  emit('update:modelValue', false);
}

// ─── Helpers ──────────────────────────────────────────
function initials(name: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '?';
  return (parts[0][0] + (parts[parts.length - 1][0] || '')).toUpperCase();
}

// Tên ngắn của owner cho chip góc card (vd "Phạm Chí Thành" → "Thành").
function lastWord(name: string | null | undefined): string {
  if (!name) return '';
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #6366F1, #8B5CF6)',
  'linear-gradient(135deg, #EF4444, #F59E0B)',
  'linear-gradient(135deg, #10B981, #14B8A6)',
  'linear-gradient(135deg, #F472B6, #EC4899)',
  'linear-gradient(135deg, #3B82F6, #0EA5E9)',
  'linear-gradient(135deg, #A78BFA, #7C3AED)',
  'linear-gradient(135deg, #FB923C, #F97316)',
  'linear-gradient(135deg, #06B6D4, #0891B2)',
];
function hashIdx(s: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % mod;
}
function accountGradient(id: string): string {
  return AVATAR_GRADIENTS[hashIdx(id, AVATAR_GRADIENTS.length)];
}
function memberAvatarStyle(member: AccountFolder['members'][number], idx: number) {
  if (member.avatarUrl) {
    return { backgroundImage: `url(${member.avatarUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' };
  }
  return { background: AVATAR_GRADIENTS[(hashIdx(member.id, AVATAR_GRADIENTS.length) + idx) % AVATAR_GRADIENTS.length] };
}

// ─── Lifecycle ────────────────────────────────────────
watch(() => props.modelValue, async (open) => {
  if (open) {
    loadingAccounts.value = true;
    try {
      await Promise.all([fetchAccounts(), props.filters.fetchFolders()]);
    } finally {
      loadingAccounts.value = false;
    }
    // Sync view state from current filter
    viewFolderId.value = props.filters.state.folderId;
    viewAccountId.value = props.currentAccountId ?? null;
    viewNickSearch.value = '';

    // Default to view tab
    activeTab.value = 'view';

    // Pre-select folder in manage tab if any
    const currentId = props.filters.state.folderId;
    if (currentId) {
      selectFolder(currentId);
    } else {
      selectedFolderId.value = null;
      creating.value = false;
    }
  }
});

onMounted(() => {
  if (props.modelValue) fetchAccounts();
});
</script>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

.modal {
  background: white;
  border-radius: 12px;
  box-shadow: 0 24px 56px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(15, 23, 42, 0.06);
  width: 100%;
  max-width: 880px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: #1F2D3D;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
}

.modal-header {
  padding: 8px 16px 0;
  border-bottom: 1px solid #E4E5E9;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: linear-gradient(135deg, #FAFAFC 0%, #F4F4F7 100%);
  flex-shrink: 0;
}

/* Tabs */
.tabs {
  display: flex;
  gap: 4px;
  flex: 1;
}
.tab {
  padding: 8px 16px 10px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  font-size: 13px;
  font-weight: 500;
  color: #6B7785;
  cursor: pointer;
  font-family: inherit;
  margin-bottom: -1px;
}
.tab:hover { color: #1F2D3D; }
.tab.active {
  color: #5E6AD2;
  border-bottom-color: #5E6AD2;
  font-weight: 600;
}

.modal-close {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: #6B7785;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
  margin-bottom: 6px;
  flex-shrink: 0;
}
.modal-close:hover { background: #F4F4F7; color: #1F2D3D; }

.modal-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

/* ═════════ TAB 1: VIEW BODY (gridcard + nick scroll) ═════════ */
.view-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px 24px;
  overflow-y: auto;
}
.view-body::-webkit-scrollbar { width: 6px; }
.view-body::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 3px; }

.view-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.view-section-label {
  font-size: 11px;
  font-weight: 700;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Folder gridcards — card ngang: avatar trái · tên · online/offline. 4 cột × 3 hàng rồi cuộn. */
.folder-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
  /* 3 hàng card (68px) + 2 gap (8px) + padding → đúng 3 dòng, còn lại cuộn dọc */
  max-height: 228px;
  overflow-y: auto;
  padding: 2px 2px 6px;
}
.folder-grid::-webkit-scrollbar { width: 6px; }
.folder-grid::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 3px; }
.folder-card {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  gap: 11px;
  padding: 11px 13px;
  background: white;
  border: 1.5px solid #E4E5E9;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
  text-align: left;
  height: 68px;
  min-width: 0;
}
.fc-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}
.folder-card:hover {
  border-color: #D4D6DB;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.05);
}
.folder-card.selected {
  border-color: #5E6AD2;
  background: #EEF0FF;
  box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.15);
}
.folder-card:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 2px; }

.fc-thumb {
  width: 42px;
  height: 42px;
  position: relative;
  flex-shrink: 0;
}
.fc-thumb .av,
.fc-thumb .single {
  border: 2px solid white;
  border-radius: 50%;
  color: white;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
  overflow: hidden;
}
.fc-thumb .av {
  position: absolute;
  width: 26px;
  height: 26px;
}
.fc-thumb .av-0 { top: 0; left: 0; }
.fc-thumb .av-1 { bottom: 0; right: 0; }
.fc-thumb .single {
  width: 42px;
  height: 42px;
  font-size: 15px;
  border: none;
}
.fc-thumb .single.empty {
  background: #E5E7EB;
  color: #9CA3AF;
}
.fc-thumb-all {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: linear-gradient(135deg, #5E6AD2, #8B5CF6);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.fc-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #1F2D3D;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.folder-card.selected .fc-name { color: #5E6AD2; }
/* Dòng online/offline dưới tên sale */
.fc-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10.5px;
  font-weight: 600;
  color: #6B7785;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}
.nk-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}
.nk-dot.on { background: #22C55E; }
.nk-dot.off { background: #C4C8CF; }
.nk-sep { color: #C9CDD4; font-weight: 700; }

/* Nick search */
.nick-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  background: #F4F4F7;
  border: 1px solid transparent;
  border-radius: 8px;
}
.nick-search:focus-within {
  background: white;
  border-color: #5E6AD2;
  box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.12);
}
.nick-search .ic { color: #97A0AC; font-size: 12px; }
.nick-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  font-family: inherit;
  color: #1F2D3D;
  min-width: 0;
}
.ns-clear {
  background: transparent;
  border: none;
  color: #97A0AC;
  font-size: 10px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 3px;
  font-family: inherit;
}
.ns-clear:hover { color: #EF4444; background: #FEF2F2; }

/* Nick pickbox — fixed height, scroll inside */
.nick-pickbox {
  background: #FAFAFC;
  border: 1px solid #E4E5E9;
  border-radius: 10px;
  padding: 6px;
  height: 260px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nick-pickbox::-webkit-scrollbar { width: 5px; }
.nick-pickbox::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 2px; }

.nick-pick-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: white;
  border: 1px solid transparent;
  border-radius: 8px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  width: 100%;
  transition: all 0.12s;
}
.nick-pick-row:hover { border-color: #E4E5E9; }
.nick-pick-row.selected {
  background: #EEF0FF;
  border-color: rgba(94, 106, 210, 0.4);
}
.nick-pick-row:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; }
/* 2026-06-11: wrapper row + nút nhanh per-nick (port main) */
.nick-pick-rowwrap { display: flex; align-items: center; gap: 4px; }
.nick-pick-rowwrap > .nick-pick-row { flex: 1; min-width: 0; }
.np-actions { display: flex; gap: 2px; flex-shrink: 0; }
.np-act {
  background: transparent; border: 1px solid transparent; border-radius: 6px;
  width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; padding: 0; color: #6B7280;
}
.np-act:hover:not(:disabled) { background: #F3F4F6; border-color: #E5E7EB; color: #111827; }
.np-act:disabled { opacity: 0.3; cursor: not-allowed; }
.np-act svg { width: 14px; height: 14px; }

.np-avatar-img,
.np-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 11px;
  font-weight: 700;
  font-family: inherit;
  flex-shrink: 0;
  object-fit: cover;
}
.np-body { flex: 1; min-width: 0; }
.np-name {
  font-size: 13px;
  font-weight: 600;
  color: #1F2D3D;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nick-pick-row.selected .np-name { color: #5E6AD2; }
.np-sub {
  font-size: 11px;
  color: #97A0AC;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 1px;
}
.np-sub .status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #10B981;
  display: inline-block;
}
.np-sub .status-dot.off { background: #B0B5BD; }
.np-check {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #5E6AD2;
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

.nick-empty {
  padding: 24px;
  text-align: center;
  font-size: 12px;
  color: #97A0AC;
  font-style: italic;
}

/* ═════════ TAB 2: MANAGE BODY ═════════ */
.manage-body {
  display: grid;
  grid-template-columns: 260px 1fr;
}

.ml-list {
  border-right: 1px solid #E4E5E9;
  background: #FAFAFC;
  padding: 14px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}
.ml-list::-webkit-scrollbar { width: 5px; }
.ml-list::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 2px; }

.ml-list-label {
  font-size: 10.5px;
  font-weight: 600;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 10px;
  padding-left: 8px;
}

.ml-folder-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 8px;
  cursor: pointer;
  margin-bottom: 3px;
  border: 1px solid transparent;
  background: transparent;
  font-family: inherit;
  text-align: left;
  width: 100%;
  transition: all 0.12s;
}
.ml-folder-item:hover { background: white; border-color: #E4E5E9; }
.ml-folder-item.selected {
  background: white;
  border-color: rgba(94, 106, 210, 0.4);
  box-shadow: 0 1px 2px rgba(94, 106, 210, 0.08);
}

.ml-thumb { width: 32px; height: 32px; position: relative; flex-shrink: 0; }
.ml-thumb .av,
.ml-thumb .single {
  border: 2px solid white;
  border-radius: 50%;
  color: white;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  background-size: cover;
  background-position: center;
}
.ml-thumb .av { position: absolute; width: 20px; height: 20px; }
.ml-thumb .av-0 { top: 0; left: 0; }
.ml-thumb .av-1 { bottom: 0; right: 0; }
.ml-thumb .single { width: 32px; height: 32px; font-size: 12px; border: none; }
.ml-thumb .single.empty { background: #E5E7EB; color: #9CA3AF; }

.ml-body { flex: 1; min-width: 0; }
.ml-name {
  font-size: 13px;
  font-weight: 600;
  color: #1F2D3D;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ml-folder-item.selected .ml-name { color: #5E6AD2; }
.ml-sub { font-size: 11px; color: #97A0AC; }
.ml-count {
  font-size: 11px;
  font-weight: 600;
  color: #6B7785;
  background: #F4F4F7;
  padding: 2px 7px;
  border-radius: 999px;
  flex-shrink: 0;
}
.ml-folder-item.selected .ml-count { background: #5E6AD2; color: white; }

.ml-create-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  margin-top: 8px;
  background: white;
  border: 1px dashed #D4D6DB;
  border-radius: 8px;
  color: #5E6AD2;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  justify-content: center;
}
.ml-create-btn:hover { border-color: #5E6AD2; background: #EEF0FF; }

/* Mục 2 — nút Cập nhật thư mục theo nick (nhỏ gọn, atlas v2 indigo) */
.ml-sync-btn {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 9px 12px;
  margin-top: 6px;
  background: #5E6AD2;
  border: none;
  border-radius: 8px;
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  justify-content: center;
  transition: background 0.12s;
}
.ml-sync-btn:hover:not(:disabled) { background: #4f5bc4; }
.ml-sync-btn:disabled { opacity: 0.7; cursor: default; }
.ml-sync-spin { display: inline-block; animation: ml-spin 0.8s linear infinite; }
@keyframes ml-spin { to { transform: rotate(360deg); } }
.ml-sync-msg {
  margin-top: 7px;
  font-size: 11.5px;
  color: #047857;
  background: #e6f7ef;
  border: 1px solid #a7f3d0;
  border-radius: 7px;
  padding: 6px 9px;
  line-height: 1.4;
}

/* Mục 3 — dropdown lọc nick theo user */
.ml-nick-controls { display: flex; align-items: center; gap: 8px; }
.ml-owner-select {
  border: 1px solid #E4E5E9;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12.5px;
  color: #374151;
  background: #fff;
  font-family: inherit;
  max-width: 170px;
}

.ml-edit {
  padding: 20px 24px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 400px;
}
.ml-edit::-webkit-scrollbar { width: 6px; }
.ml-edit::-webkit-scrollbar-thumb { background: #D4D6DB; border-radius: 3px; }

.ml-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #97A0AC;
  text-align: center;
}
.ml-empty-icon { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }
.ml-empty-title { font-size: 14px; font-weight: 600; color: #6B7785; }
.ml-empty-sub { font-size: 12px; margin-top: 4px; }

.ml-edit-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 14px;
  border-bottom: 1px solid #E4E5E9;
}
.ml-name-input { display: flex; flex-direction: column; gap: 6px; flex: 1; }
.ml-name-input label {
  font-size: 10.5px;
  font-weight: 600;
  color: #6B7785;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.ml-name-input input {
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  color: #1F2D3D;
  padding: 8px 12px;
  border: 1px solid #E4E5E9;
  border-radius: 8px;
  outline: none;
  max-width: 360px;
  background: white;
}
.ml-name-input input:focus {
  border-color: #5E6AD2;
  box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.12);
}
.ml-delete-btn {
  padding: 7px 12px;
  font-size: 11.5px;
  font-weight: 500;
  background: white;
  border: 1px solid #E4E5E9;
  border-radius: 8px;
  color: #EF4444;
  cursor: pointer;
  font-family: inherit;
}
.ml-delete-btn:hover { background: #FEF2F2; border-color: #EF4444; }

.ml-nick-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.ml-nick-section-head .title {
  font-size: 13px;
  font-weight: 600;
  color: #1F2D3D;
  display: flex;
  align-items: center;
  gap: 8px;
}
.ml-nick-section-head .title .selected-count {
  background: #5E6AD2;
  color: white;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
  border-radius: 999px;
}
.ml-nick-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: #F4F4F7;
  border-radius: 8px;
  width: 240px;
}
.ml-nick-search .ic { color: #97A0AC; font-size: 12px; }
.ml-nick-search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12.5px;
  font-family: inherit;
  color: #1F2D3D;
}

.ml-loading {
  padding: 40px 20px;
  text-align: center;
  color: #97A0AC;
  font-size: 13px;
  font-style: italic;
}

/* Mục 3 — picker grid 3 ô/hàng (atlas v2): avatar + tên + SĐT + status + viền màu */
.nick-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
@media (max-width: 720px) {
  .nick-grid { grid-template-columns: repeat(2, 1fr); }
}

.nick-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 11px 12px;
  background: white;
  border: 2px solid #E4E5E9;
  border-radius: 12px;
  cursor: pointer;
  position: relative;
  transition: box-shadow 0.12s, transform 0.12s;
  text-align: left;
  font-family: inherit;
}
.nick-card:hover {
  transform: translateY(-1px);
  box-shadow: 0 3px 10px rgba(15, 23, 42, 0.08);
}
/* Viền theo trạng thái (atlas v2 thật) */
.nick-card.is-online  { border-color: #12b76a; }
.nick-card.is-pending { border-color: #f5a524; }
.nick-card.is-offline { border-color: #f04438; }
.nick-card.selected { background: #f5f7ff; box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.18); }

.nick-card .nick-check {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  border: 2px solid #cbd5e1;
  border-radius: 6px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 12px;
  font-weight: 700;
}
.nick-card.selected .nick-check { background: #5E6AD2; border-color: #5E6AD2; }

.nick-card .nick-head { display: flex; align-items: center; gap: 9px; min-width: 0; }
.nick-card .nick-avatar,
.nick-card .nick-avatar-img {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 13px;
  font-weight: 700;
  font-family: inherit;
  object-fit: cover;
}
.nick-card .nick-id { min-width: 0; }
.nick-card .nick-name {
  font-size: 13.5px;
  font-weight: 600;
  color: #1F2D3D;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nick-card .nick-phone {
  font-size: 12px;
  color: #6b7280;
  font-variant-numeric: tabular-nums;
}
.nick-card .nick-foot { display: flex; align-items: center; justify-content: space-between; gap: 6px; }
.nick-card .nick-status {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
}
.nick-card .nick-status .dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.nick-card .nick-status.is-online  { background: #e6f7ef; color: #047857; }
.nick-card .nick-status.is-pending { background: #fef4e6; color: #b45309; }
.nick-card .nick-status.is-offline { background: #fde8e6; color: #b42318; }
.nick-card .nick-owner { font-size: 10.5px; color: #94a3b8; white-space: nowrap; }

/* ═════════ FOOTER ═════════ */
.modal-footer {
  padding: 12px 24px;
  border-top: 1px solid #E4E5E9;
  background: #FAFAFC;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  gap: 12px;
}
.mf-status { font-size: 12.5px; color: #6B7785; }
.mf-status strong { color: #5E6AD2; font-weight: 700; }
.mf-status .muted { font-style: italic; opacity: 0.7; }
.mf-actions { display: flex; gap: 8px; }
.btn {
  padding: 8px 18px;
  font-size: 13px;
  font-weight: 500;
  border-radius: 8px;
  border: 1px solid #E4E5E9;
  background: white;
  color: #1F2D3D;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover { background: #F4F4F7; }
.btn.primary {
  background: #5E6AD2;
  border-color: #5E6AD2;
  color: white;
}
.btn.primary:hover { background: #4E5AB8; }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
