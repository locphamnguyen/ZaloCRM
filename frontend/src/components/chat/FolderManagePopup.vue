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
              <div class="fc-name">ALL — Toàn bộ</div>
              <div class="fc-meta">{{ allAccountsCount || 0 }} nick</div>
            </button>

            <!-- User folders -->
            <button
              v-for="folder in folders"
              :key="`view-${folder.id}`"
              type="button"
              class="folder-card"
              :class="{ selected: viewFolderId === folder.id && viewAccountId === null }"
              @click="onApplyFolder(folder.id)"
              :title="folder.name"
            >
              <div class="fc-thumb">
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
              <div class="fc-name">{{ folder.name }}</div>
              <div class="fc-meta">{{ folder.members.length }} nick</div>
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
              class="nick-pick-row"
              :class="{ selected: viewAccountId === acc.id && viewFolderId === null }"
            >
              <button type="button" class="np-main" @click="onApplyAccount(acc.id)">
                <img v-if="acc.avatarUrl" :src="acc.avatarUrl" class="np-avatar-img" :alt="acc.displayName || ''" />
                <div v-else class="np-avatar" :style="{ background: accountGradient(acc.id) }">{{ initials(acc.displayName) }}</div>
                <div class="np-body">
                  <div class="np-name">{{ acc.displayName || 'Chưa đặt tên' }}</div>
                  <div class="np-sub">
                    <span class="status-dot" :class="{ off: acc.status !== 'connected' }"></span>
                    {{ acc.status === 'connected' ? 'Active' : 'Offline' }}<span v-if="acc.phone"> · {{ acc.phone }}</span>
                  </div>
                </div>
                <div v-if="viewAccountId === acc.id && viewFolderId === null" class="np-check">✓</div>
              </button>
              <div class="np-actions" @click.stop>
                <button type="button" class="np-act" title="Sync danh bạ" @click="onSyncContacts(acc.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                </button>
                <button type="button" class="np-act" title="Sync lịch sử chat" @click="onSyncHistory(acc.id)" :disabled="acc.status !== 'connected'">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                </button>
                <button type="button" class="np-act" title="Reconnect" :disabled="acc.status === 'connected'" @click="onReconnect(acc.id)">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/></svg>
                </button>
                <button type="button" class="np-act" title="Đăng nhập QR" :disabled="acc.status === 'connected'" @click="onQRLogin(acc.id)">
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
            v-for="folder in folders"
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
                  placeholder="Vd: Hot leads, B2B Enterprise..."
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
              <div class="ml-nick-search">
                <span class="ic">🔍</span>
                <input v-model="nickSearch" type="text" placeholder="Tìm nick..." />
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
                :class="{ selected: formAccountIds.has(acc.id) }"
                @click="toggleAccount(acc.id)"
              >
                <div class="nick-check"><span v-if="formAccountIds.has(acc.id)">✓</span></div>
                <img v-if="acc.avatarUrl" :src="acc.avatarUrl" class="nick-avatar-img" :alt="acc.displayName || ''" />
                <div v-else class="nick-avatar" :style="{ background: accountGradient(acc.id) }">{{ initials(acc.displayName) }}</div>
                <div class="nick-name" :title="acc.displayName || ''">{{ acc.displayName || 'Chưa đặt tên' }}</div>
                <div class="nick-meta">
                  <span class="dot" :class="{ red: acc.status !== 'connected' }"></span>
                  {{ acc.status === 'connected' ? 'Active' : 'Offline' }}
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
import { useToast } from '@/composables/use-toast';
import { api } from '@/api/index';

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
const loadingAccounts = ref(false);

// Default to "view" tab — daily use case
const activeTab = ref<'view' | 'manage'>('view');

const folders = computed<AccountFolder[]>(() => props.filters.folders.value);

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

// ─── Nick row actions (Sync danh bạ / Sync lịch sử chat / Reconnect / QR login) ───
async function onSyncContacts(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/sync-contacts`);
    toast.success('Đồng bộ danh bạ thành công');
    await fetchAccounts();
  } catch (e: any) {
    toast.error('Đồng bộ danh bạ thất bại: ' + (e.response?.data?.error || e.message));
  }
}
async function onSyncHistory(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/sync-history`);
    toast.success('Đồng bộ lịch sử chat thành công');
  } catch (e: any) {
    toast.error('Đồng bộ lịch sử chat thất bại: ' + (e.response?.data?.error || e.message));
  }
}
async function onReconnect(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/reconnect`);
    toast.success('Đang kết nối lại nick...');
    await fetchAccounts();
  } catch (e: any) {
    toast.error('Reconnect thất bại: ' + (e.response?.data?.error || e.message));
  }
}
async function onQRLogin(id: string) {
  try {
    await api.post(`/zalo-accounts/${id}/login`);
    toast.success('Đã khởi tạo QR login, mở trang Quản lý nick để quét');
  } catch (e: any) {
    toast.error('Khởi tạo QR thất bại: ' + (e.response?.data?.error || e.message));
  }
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

const filteredAccounts = computed<ZaloAccount[]>(() => {
  const q = nickSearch.value.trim().toLowerCase();
  if (!q) return accounts.value;
  return accounts.value.filter((a) =>
    (a.displayName || '').toLowerCase().includes(q) ||
    (a.phone || '').toLowerCase().includes(q)
  );
});

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

/* Folder gridcards — fixed-size cards, flow rows */
.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 10px;
}
.folder-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 14px 10px;
  background: white;
  border: 1.5px solid #E4E5E9;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
  height: 124px;
  min-width: 0;
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
  width: 28px;
  height: 28px;
}
.fc-thumb .av-0 { top: 0; left: 0; }
.fc-thumb .av-1 { bottom: 0; right: 0; }
.fc-thumb .single {
  width: 42px;
  height: 42px;
  font-size: 14px;
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
  font-size: 12.5px;
  font-weight: 600;
  color: #1F2D3D;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.folder-card.selected .fc-name { color: #5E6AD2; }
.fc-meta {
  font-size: 10.5px;
  font-weight: 600;
  color: #6B7785;
  background: #F4F4F7;
  padding: 2px 8px;
  border-radius: 999px;
}
.folder-card.selected .fc-meta {
  background: #5E6AD2;
  color: white;
}

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
  gap: 6px;
  padding: 4px 6px;
  background: white;
  border: 1px solid transparent;
  border-radius: 8px;
  transition: all 0.12s;
}
.nick-pick-row:hover { border-color: #E4E5E9; }
.nick-pick-row.selected {
  background: #EEF0FF;
  border-color: rgba(94, 106, 210, 0.4);
}
.np-main {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 4px;
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
}
.np-main:focus-visible { outline: 2px solid #5E6AD2; outline-offset: 1px; border-radius: 6px; }
.np-actions { display: flex; gap: 2px; flex-shrink: 0; }
.np-act {
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
  padding: 0;
  color: #6B7280;
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

.nick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 720px) {
  .nick-grid { grid-template-columns: repeat(3, 1fr); }
}

.nick-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 14px 8px 12px;
  background: white;
  border: 1.5px solid #E4E5E9;
  border-radius: 8px;
  cursor: pointer;
  position: relative;
  transition: all 0.12s;
  text-align: center;
  font-family: inherit;
}
.nick-card:hover {
  border-color: #D4D6DB;
  transform: translateY(-1px);
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.05);
}
.nick-card.selected {
  border-color: #5E6AD2;
  background: #EEF0FF;
  box-shadow: 0 0 0 2px rgba(94, 106, 210, 0.15);
}
.nick-card .nick-check {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 18px;
  height: 18px;
  border: 1.5px solid #E4E5E9;
  border-radius: 5px;
  background: white;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 11px;
  font-weight: 700;
}
.nick-card.selected .nick-check { background: #5E6AD2; border-color: #5E6AD2; }
.nick-card .nick-avatar,
.nick-card .nick-avatar-img {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
  font-weight: 700;
  font-family: inherit;
  object-fit: cover;
}
.nick-card .nick-name {
  font-size: 12px;
  font-weight: 600;
  color: #1F2D3D;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: 100%;
}
.nick-card .nick-meta {
  font-size: 10px;
  color: #97A0AC;
  display: flex;
  align-items: center;
  gap: 4px;
}
.nick-card .nick-meta .dot { width: 4px; height: 4px; border-radius: 50%; background: #10B981; }
.nick-card .nick-meta .dot.red { background: #EF4444; }

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
