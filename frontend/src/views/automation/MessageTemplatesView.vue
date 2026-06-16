<!--
  Mẫu tin nhắn (MessageTemplates) — sub-view Marketing. Anh chốt 2026-06-09.
  Câu mẫu sale gửi tay trong chat (gõ "/"). Cơ chế đồng bộ Khối: folder Công khai/Riêng tư
  + tag dự án + soạn rich {text,styles[]} (đậm/màu Zalo). Quyền GỘP CHUNG 'block' + mô hình
  "là chủ HOẶC có grant" (chủ tạo/sửa mẫu riêng không cần grant; công khai cần grant block.create).
  Token + class tái dùng hs-crm-theme.css (.btn/.chip/.field/.card), style giống BlocksView.
-->
<template>
  <div class="tpl-view">
    <!-- ================== TOPBAR ================== -->
    <div class="mkt-top">
      <div>
        <div class="mtt">Mẫu tin nhắn</div>
        <div class="mts">Câu mẫu soạn sẵn — sale gõ "/" trong khung chat để chèn nhanh</div>
      </div>
      <div class="actions">
        <!-- Thư mục luôn cần quyền (cấu trúc chung org) → ẩn nếu không có grant block.create -->
        <button v-if="canCreatePublic" class="btn btn-ghost btn-sm" @click="openFolderCreate">
          <v-icon size="16">mdi-folder-plus-outline</v-icon> Tạo thư mục
        </button>
        <!-- Mẫu riêng: ai cũng tạo được (mô hình "là chủ HOẶC có grant") -->
        <button class="btn btn-primary btn-sm" @click="openCreate()">
          <v-icon size="16">mdi-plus-circle-outline</v-icon> Tạo mẫu
        </button>
      </div>
    </div>

    <!-- ================== LAYOUT ================== -->
    <div class="tpl-layout">
      <!-- ---- Sidebar folder ---- -->
      <aside class="bv-sidebar">
        <button class="bv-folder-item" :class="{ 'is-active': !selectedFolderId }" @click="selectedFolderId = null">
          <v-icon size="15">mdi-view-grid-outline</v-icon>
          <span class="bv-folder-label">Tất cả mẫu</span>
          <span class="bv-folder-count num">{{ templates.length }}</span>
        </button>

        <div v-if="publicFolders.length" class="bv-sidebar-section">
          <div class="bv-sidebar-head">
            <v-icon size="13" class="vis-public">mdi-lock-open-variant-outline</v-icon>
            <span>Công khai</span><span class="bv-sidebar-hint">cả công ty</span>
          </div>
          <button v-for="f in publicFolders" :key="f.id" class="bv-folder-item"
            :class="{ 'is-active': selectedFolderId === f.id }" @click="selectedFolderId = f.id">
            <v-icon size="14">mdi-folder-outline</v-icon>
            <span class="bv-folder-label">{{ f.name }}</span>
            <span class="bv-folder-count num">{{ f._count?.templates ?? 0 }}</span>
          </button>
        </div>

        <div v-if="privateFolders.length" class="bv-sidebar-section">
          <div class="bv-sidebar-head">
            <v-icon size="13" class="vis-private">mdi-lock-outline</v-icon>
            <span>Riêng tư</span><span class="bv-sidebar-hint">chỉ tôi</span>
          </div>
          <button v-for="f in privateFolders" :key="f.id" class="bv-folder-item"
            :class="{ 'is-active': selectedFolderId === f.id }" @click="selectedFolderId = f.id">
            <v-icon size="14">mdi-folder-outline</v-icon>
            <span class="bv-folder-label">{{ f.name }}</span>
            <span class="bv-folder-count num">{{ f._count?.templates ?? 0 }}</span>
          </button>
        </div>
      </aside>

      <!-- ================== BODY ================== -->
      <main class="mkt-body tpl-main">
        <!-- Filter bar -->
        <div class="filter-bar">
          <div class="field sm search-wrap">
            <v-icon size="16">mdi-magnify</v-icon>
            <input v-model="searchQuery" type="text" placeholder="Tìm mẫu theo tên, nội dung..." />
          </div>
          <div class="chips">
            <span class="filter-lbl">Dự án:</span>
            <button v-for="tag in PROJECT_TAGS" :key="tag" class="fchip"
              :class="{ active: selectedTags.includes(tag) }" @click="toggleTag(tag)">
              {{ tag }}<span class="count">{{ tagCounts[tag] || 0 }}</span>
            </button>
          </div>
        </div>

        <!-- Loading / Empty -->
        <div v-if="loading" class="tpl-empty"><v-progress-circular indeterminate size="28" /></div>
        <div v-else-if="!filteredTemplates.length" class="tpl-empty">
          <v-icon size="40" color="grey">mdi-message-text-outline</v-icon>
          <p>Chưa có mẫu tin nhắn nào</p>
        </div>

        <!-- Card grid -->
        <div v-else class="blk-grid">
          <div v-for="t in filteredTemplates" :key="t.id" class="blk tpl-card" @click="openEdit(t)">
            <div class="tpl-card-top">
              <span class="chip chip-grey tpl-cat">{{ t.category || 'Mẫu' }}</span>
              <span v-if="t.shortcut" class="tpl-shortcut-chip" title="Gõ tắt trong chat">/{{ t.shortcut }}</span>
              <span class="tpl-foot-spacer"></span>
              <span class="tpl-vis" :title="t.visibility === 'private' ? 'Riêng tư' : 'Công khai'">
                <v-icon size="13">{{ t.visibility === 'private' ? 'mdi-lock-outline' : 'mdi-lock-open-variant-outline' }}</v-icon>
              </span>
            </div>
            <div class="tpl-name">{{ t.name }}</div>
            <div class="tpl-preview">{{ previewPlain(t) }}</div>
            <div class="tpl-foot">
              <span v-for="tag in (t.tagIds || []).slice(0, 2)" :key="tag" class="bk-tag" :class="tagColor(tag)">{{ tag }}</span>
              <span class="tpl-foot-spacer"></span>
              <span v-if="!canEditTemplate(t)" class="tpl-readonly"><v-icon size="12">mdi-eye-outline</v-icon> Chỉ xem</span>
            </div>
          </div>
        </div>
      </main>
    </div>

    <!-- ================== EDITOR DIALOG ================== -->
    <v-dialog v-model="editorOpen" max-width="640" persistent>
      <div class="tpl-editor card">
        <div class="tpl-ed-top">
          <div class="tpl-ed-title">{{ isEdit ? 'Sửa mẫu tin nhắn' : 'Tạo mẫu tin nhắn' }}</div>
          <span v-if="!canSave" class="tpl-readonly"><v-icon size="13">mdi-eye-outline</v-icon> Chỉ xem</span>
          <button class="btn btn-ghost btn-icon btn-sm" @click="closeEditor"><v-icon size="18">mdi-close</v-icon></button>
        </div>

        <div class="tpl-ed-body">
          <!-- Tên + Từ khóa gõ tắt -->
          <div class="tpl-ed-row">
            <div class="field tpl-ed-name">
              <input v-model="draft.name" :disabled="!canSave" type="text" placeholder="Tên mẫu (vd: Báo giá EGV)" />
            </div>
            <div class="field tpl-ed-shortcut" :title="'Sale gõ /' + (normalizedShortcut || 'từkhóa') + ' trong chat để chèn nhanh mẫu này'">
              <span class="tpl-shortcut-slash">/</span>
              <input v-model="draft.shortcut" :disabled="!canSave" type="text" placeholder="từ khóa gõ tắt (vd: giaegv)" />
            </div>
          </div>
          <div v-if="normalizedShortcut" class="tpl-shortcut-hint">
            Trong chat gõ <b>/{{ normalizedShortcut }}</b> để chèn nhanh mẫu này
          </div>

          <!-- Subbar: folder + visibility + category -->
          <div class="tpl-ed-meta">
            <select v-model="draft.folderId" :disabled="!canSave" class="tpl-ed-select">
              <option :value="null">— Không thư mục —</option>
              <option v-for="f in allFolders" :key="f.id" :value="f.id">{{ f.name }}</option>
            </select>
            <select v-model="draft.category" :disabled="!canSave" class="tpl-ed-select">
              <option :value="null">— Loại —</option>
              <option v-for="c in CATEGORIES" :key="c" :value="c">{{ c }}</option>
            </select>
            <div class="tpl-vis-toggle">
              <button class="bed-vis-opt" :class="{ active: draft.visibility === 'private' }"
                :disabled="!canSave" @click="draft.visibility = 'private'">
                <v-icon size="13">mdi-lock-outline</v-icon> Riêng tư
              </button>
              <button class="bed-vis-opt" :class="{ active: draft.visibility === 'public' }"
                :disabled="!canSave || !canCreatePublic"
                :title="canCreatePublic ? '' : 'Cần quyền tạo nội dung để công khai cho cả công ty'"
                @click="canCreatePublic && (draft.visibility = 'public')">
                <v-icon size="13">mdi-lock-open-variant-outline</v-icon> Công khai
              </button>
            </div>
          </div>

          <!-- Tag dự án -->
          <div class="tpl-ed-tags">
            <span class="filter-lbl">Dự án:</span>
            <button v-for="tag in PROJECT_TAGS" :key="tag" class="fchip" :class="{ active: draft.tagIds.includes(tag) }"
              :disabled="!canSave" @click="toggleDraftTag(tag)">{{ tag }}</button>
          </div>

          <!-- Var chips -->
          <div class="tpl-ed-vars">
            <button v-for="v in PERSONALIZE_VARS" :key="v.code" class="bed-var-chip"
              :disabled="!canSave" @click="insertVar(v.code)">
              <v-icon size="13">{{ v.icon }}</v-icon><span class="bed-var-chip-label">{{ v.label }}</span>
            </button>
          </div>

          <!-- Rich editor -->
          <div class="tpl-ed-editor">
            <RichTextEditor ref="editorRef" v-model="draftText" :disabled="!canSave"
              placeholder="Soạn nội dung mẫu… dùng nút biến để chèn {gender}/{name}/{sale}" />
          </div>
        </div>

        <div class="tpl-ed-foot">
          <button v-if="isEdit && canSave" class="btn btn-ghost btn-sm tpl-del" @click="onDelete">
            <v-icon size="15">mdi-trash-can-outline</v-icon> Xóa
          </button>
          <span class="tpl-foot-spacer"></span>
          <button class="btn btn-ghost btn-sm" @click="closeEditor">Đóng</button>
          <button v-if="canSave" class="btn btn-primary btn-sm" :disabled="saving || !draft.name.trim()" @click="onSave">
            <v-icon size="15">mdi-content-save-outline</v-icon> Lưu
          </button>
        </div>
      </div>
    </v-dialog>

    <!-- ================== FOLDER CREATE DIALOG ================== -->
    <v-dialog v-model="folderDialogOpen" max-width="380">
      <div class="tpl-editor card">
        <div class="tpl-ed-top">
          <div class="tpl-ed-title">Tạo thư mục</div>
          <button class="btn btn-ghost btn-icon btn-sm" @click="folderDialogOpen = false"><v-icon size="18">mdi-close</v-icon></button>
        </div>
        <div class="tpl-ed-body">
          <div class="field"><input v-model="folderDraft.name" type="text" placeholder="Tên thư mục" /></div>
          <div class="tpl-vis-toggle">
            <button class="bed-vis-opt" :class="{ active: folderDraft.visibility === 'public' }" @click="folderDraft.visibility = 'public'">
              <v-icon size="13">mdi-lock-open-variant-outline</v-icon> Công khai
            </button>
            <button class="bed-vis-opt" :class="{ active: folderDraft.visibility === 'private' }" @click="folderDraft.visibility = 'private'">
              <v-icon size="13">mdi-lock-outline</v-icon> Riêng tư
            </button>
          </div>
        </div>
        <div class="tpl-ed-foot">
          <span class="tpl-foot-spacer"></span>
          <button class="btn btn-ghost btn-sm" @click="folderDialogOpen = false">Đóng</button>
          <button class="btn btn-primary btn-sm" :disabled="!folderDraft.name.trim()" @click="onCreateFolder">Tạo</button>
        </div>
      </div>
    </v-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch, nextTick } from 'vue';
import RichTextEditor from '@/components/chat/rich-text-editor.vue';
import { TEMPLATE_VARIABLES } from '@/constants/template-variables';
import { useAuthStore } from '@/stores/auth';
import {
  useMessageTemplates, type MessageTemplate, type RichPayload,
} from '@/composables/use-message-templates';
import { useToast } from '@/composables/use-toast';
import { useConfirm } from '@/composables/use-confirm';

const toast = useToast();
const { confirm } = useConfirm();

const PROJECT_TAGS = ['Emerald Garden View', 'Emerald Boulevard', 'Emerald River Park', 'Monrei Sài Gòn'];
const CATEGORIES = ['FAQ', 'Chào', 'Khơi gợi', 'Chốt'];
// 8 biến cá nhân hóa dùng chung (anh chốt 2026-06-15) — gom về template-variables.ts.
const PERSONALIZE_VARS = TEMPLATE_VARIABLES;

const auth = useAuthStore();
const {
  templates, folders, loading, saving,
  fetchTemplates, fetchFolders,
  createTemplate, updateTemplate, deleteTemplate, createFolder,
} = useMessageTemplates();

const selectedFolderId = ref<string | null>(null);
const selectedTags = ref<string[]>([]);
const searchQuery = ref('');

const allFolders = computed(() => folders.value);
const publicFolders = computed(() => folders.value.filter((f) => f.visibility === 'public'));
const privateFolders = computed(() => folders.value.filter((f) => f.visibility === 'private'));

const tagCounts = computed(() => {
  const m: Record<string, number> = {};
  for (const t of templates.value) for (const tag of t.tagIds || []) m[tag] = (m[tag] || 0) + 1;
  return m;
});

const filteredTemplates = computed(() => {
  let list = templates.value;
  if (selectedFolderId.value) list = list.filter((t) => t.folderId === selectedFolderId.value);
  if (selectedTags.value.length) list = list.filter((t) => (t.tagIds || []).some((tg) => selectedTags.value.includes(tg)));
  const q = searchQuery.value.trim().toLowerCase();
  if (q) list = list.filter((t) =>
    t.name.toLowerCase().includes(q) || t.content.toLowerCase().includes(q) || (t.shortcut || '').includes(q));
  return list;
});

// Chuẩn hóa từ khóa gõ tắt phía FE (preview + gửi lên BE chuẩn). Khớp normalizeShortcut backend.
function normShortcut(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.trim().replace(/^\/+/, '')
    .replace(/đ/g, 'd').replace(/Đ/g, 'D')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function toggleTag(tag: string) {
  const i = selectedTags.value.indexOf(tag);
  if (i >= 0) selectedTags.value.splice(i, 1); else selectedTags.value.push(tag);
}
function tagColor(tag: string): string {
  const palette = ['tag-sky', 'tag-purple', 'tag-teal', 'tag-pink', 'tag-amber'];
  let h = 0; for (let i = 0; i < tag.length; i++) h = (h * 31 + tag.charCodeAt(i)) >>> 0;
  return palette[h % palette.length];
}

function previewPlain(t: MessageTemplate): string {
  const raw = t.contentRich?.text ?? t.content ?? '';
  return raw.length > 160 ? raw.slice(0, 160) + '…' : raw;
}

// ── RBAC: "là chủ HOẶC có grant" ──
// Đăng công khai / tạo thư mục cần grant block.create.
const canCreatePublic = computed(() => auth.canAccess('block', 'create'));
function canEditTemplate(t: MessageTemplate): boolean {
  if (t.isMine) return true;
  return auth.canAccess('block', 'edit');
}

// ── Editor state ──
const editorOpen = ref(false);
const isEdit = ref(false);
const editingId = ref<string | null>(null);
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const draftText = ref(''); // plain text v-model của RichTextEditor
const draft = ref<{
  name: string; shortcut: string; folderId: string | null; category: string | null;
  visibility: 'public' | 'private'; tagIds: string[];
}>({ name: '', shortcut: '', folderId: null, category: null, visibility: 'private', tagIds: [] });

const normalizedShortcut = computed(() => normShortcut(draft.value.shortcut));

// canSave: tạo mới luôn được (mẫu riêng); sửa = isMine HOẶC có grant
const canSave = computed(() => {
  if (!isEdit.value) return true; // tạo mẫu riêng: ai cũng được
  const t = templates.value.find((x) => x.id === editingId.value);
  return t ? canEditTemplate(t) : true;
});

function resetDraft() {
  draft.value = { name: '', shortcut: '', folderId: selectedFolderId.value, category: null, visibility: 'private', tagIds: [] };
  draftText.value = '';
}

function openCreate() {
  isEdit.value = false; editingId.value = null; resetDraft();
  editorOpen.value = true;
  nextTick(() => editorRef.value?.applyRichPayload({ text: '', styles: [] }));
}

function openEdit(t: MessageTemplate) {
  isEdit.value = true; editingId.value = t.id;
  draft.value = {
    name: t.name, shortcut: t.shortcut ?? '', folderId: t.folderId ?? null, category: t.category ?? null,
    visibility: t.visibility ?? 'private', tagIds: [...(t.tagIds || [])],
  };
  const rich: RichPayload = t.contentRich?.text ? t.contentRich : { text: t.content, styles: [] };
  draftText.value = rich.text;
  editorOpen.value = true;
  nextTick(() => editorRef.value?.applyRichPayload(rich));
}

function closeEditor() { editorOpen.value = false; }

function toggleDraftTag(tag: string) {
  const i = draft.value.tagIds.indexOf(tag);
  if (i >= 0) draft.value.tagIds.splice(i, 1); else draft.value.tagIds.push(tag);
}
function insertVar(code: string) { editorRef.value?.insertText(code); }

async function onSave() {
  const rich = editorRef.value?.getRichPayload?.() || { text: draftText.value, styles: [] };
  if (!rich.text.trim()) return;
  const payload = {
    name: draft.value.name.trim(),
    shortcut: draft.value.shortcut,
    contentRich: rich,
    folderId: draft.value.folderId,
    category: draft.value.category,
    visibility: draft.value.visibility,
    tagIds: draft.value.tagIds,
  };
  try {
    if (isEdit.value && editingId.value) await updateTemplate(editingId.value, payload);
    else await createTemplate(payload);
    editorOpen.value = false;
    await reload();
  } catch (e: any) {
    toast.error(e?.response?.data?.error || 'Có lỗi xảy ra, thử lại sau.', 5000);
  }
}

async function onDelete() {
  if (!editingId.value) return;
  if (!(await confirm({ title: 'Xóa mẫu này?', tone: 'danger', confirmText: 'Xóa', cancelText: 'Hủy' }))) return;
  await deleteTemplate(editingId.value);
  editorOpen.value = false;
  await reload();
}

// ── Folder create ──
const folderDialogOpen = ref(false);
const folderDraft = ref<{ name: string; visibility: 'public' | 'private' }>({ name: '', visibility: 'public' });
function openFolderCreate() { folderDraft.value = { name: '', visibility: 'public' }; folderDialogOpen.value = true; }
async function onCreateFolder() {
  try {
    await createFolder({ name: folderDraft.value.name.trim(), visibility: folderDraft.value.visibility });
    folderDialogOpen.value = false;
    await fetchFolders();
  } catch (e: any) {
    toast.error(e?.response?.data?.error || 'Có lỗi xảy ra, thử lại sau.', 5000);
  }
}

async function reload() {
  await Promise.all([fetchTemplates(), fetchFolders()]);
}
onMounted(reload);
watch(selectedFolderId, () => { /* client-side filter, no refetch needed */ });
</script>

<style scoped>
.tpl-view { display: flex; flex-direction: column; height: 100%; background: var(--surface-2, #f7f9fc); }
.mkt-top {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; background: var(--surface, #fff); border-bottom: 1px solid var(--line, #e7eaf0);
  position: sticky; top: 0; z-index: 5;
}
.mtt { font-size: 17px; font-weight: 700; color: var(--ink, #141a24); }
.mts { font-size: 12.5px; color: var(--ink-3, #6b7280); margin-top: 2px; }
.mkt-top .actions { display: flex; gap: 8px; }

.tpl-layout { display: flex; flex: 1; min-height: 0; }

/* Sidebar (copy BlocksView .bv-*) */
.bv-sidebar { width: 220px; flex-shrink: 0; background: var(--surface, #fff); border-right: 1px solid var(--line, #e7eaf0); padding: 10px 8px; overflow-y: auto; }
.bv-folder-item { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; border: none; background: none; border-radius: 8px; cursor: pointer; color: var(--ink-2, #374151); font-size: 13px; text-align: left; }
.bv-folder-item:hover { background: var(--surface-2, #f7f9fc); }
.bv-folder-item.is-active { background: var(--brand-soft, #e6f3fb); color: var(--brand-700, #0f6ea3); font-weight: 600; }
.bv-folder-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bv-folder-count { font-size: 11.5px; color: var(--ink-4, #9ca3af); }
.bv-sidebar-section { margin-top: 12px; }
.bv-sidebar-head { display: flex; align-items: center; gap: 5px; padding: 4px 9px; font-size: 11px; font-weight: 600; color: var(--ink-3, #6b7280); text-transform: uppercase; }
.bv-sidebar-hint { font-weight: 400; font-size: 10px; color: var(--ink-4, #9ca3af); margin-left: auto; }
.vis-public { color: var(--success, #12b76a); }
.vis-private { color: var(--warning, #f5a524); }

/* Body */
.tpl-main { flex: 1; min-width: 0; overflow-y: auto; padding: 14px 18px; }
.filter-bar { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.field.sm.search-wrap { display: flex; align-items: center; gap: 6px; background: var(--surface, #fff); border: 1px solid var(--line, #e7eaf0); border-radius: 8px; padding: 5px 10px; min-width: 260px; }
.field.sm.search-wrap input { border: none; outline: none; font-size: 13px; width: 100%; background: none; }
.chips { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.filter-lbl { font-size: 12px; color: var(--ink-3, #6b7280); font-weight: 500; }
.fchip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--line, #e7eaf0); background: var(--surface, #fff); border-radius: 999px; font-size: 12px; color: var(--ink-2, #374151); cursor: pointer; }
.fchip:hover { border-color: var(--brand, #1786be); }
.fchip.active { background: var(--brand-soft, #e6f3fb); border-color: var(--brand, #1786be); color: var(--brand-700, #0f6ea3); font-weight: 600; }
.fchip .count { font-size: 10.5px; color: var(--ink-4, #9ca3af); }

/* Card grid */
.blk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.tpl-card { background: var(--surface, #fff); border: 1px solid var(--line, #e7eaf0); border-radius: 14px; padding: 12px 13px; cursor: pointer; transition: all .12s; display: flex; flex-direction: column; gap: 6px; }
.tpl-card:hover { border-color: var(--brand, #1786be); box-shadow: 0 2px 10px rgba(23,134,190,.1); transform: translateY(-1px); }
.tpl-card-top { display: flex; align-items: center; justify-content: space-between; }
.tpl-cat { font-size: 11px; padding: 2px 8px; }
.tpl-vis { color: var(--ink-4, #9ca3af); display: inline-flex; }
.tpl-name { font-size: 14px; font-weight: 600; color: var(--ink, #141a24); line-height: 1.3; }
.tpl-preview { font-size: 12px; color: var(--ink-3, #6b7280); line-height: 1.45; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; }
.tpl-foot { display: flex; align-items: center; gap: 5px; margin-top: 2px; }
.tpl-foot-spacer { flex: 1; }
.bk-tag { font-size: 10.5px; padding: 2px 7px; border-radius: 6px; font-weight: 500; }
.tag-sky { background: #e0f2fe; color: #0369a1; } .tag-purple { background: #ede9fe; color: #6d28d9; }
.tag-teal { background: #cffafe; color: #0e7490; } .tag-pink { background: #fce7f3; color: #be185d; }
.tag-amber { background: #fef3c7; color: #b45309; }
.tpl-readonly { display: inline-flex; align-items: center; gap: 3px; font-size: 11px; color: var(--warning, #f5a524); font-weight: 500; }

.tpl-empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 56px; color: var(--ink-3, #6b7280); }
.tpl-empty p { font-style: italic; }

/* Editor dialog */
.tpl-editor { background: var(--surface, #fff); border-radius: 14px; overflow: hidden; }
.tpl-ed-top { display: flex; align-items: center; gap: 10px; padding: 14px 18px; border-bottom: 1px solid var(--line, #e7eaf0); }
.tpl-ed-title { font-size: 15px; font-weight: 700; color: var(--ink, #141a24); flex: 1; }
.tpl-ed-body { padding: 16px 18px; display: flex; flex-direction: column; gap: 12px; max-height: 70vh; overflow-y: auto; }
.field input { width: 100%; padding: 8px 11px; border: 1px solid var(--line, #e7eaf0); border-radius: 8px; font-size: 13.5px; outline: none; }
.field input:focus { border-color: var(--brand, #1786be); }
.tpl-ed-row { display: flex; gap: 8px; }
.tpl-ed-name { flex: 1.6; }
.tpl-ed-shortcut { flex: 1; display: flex; align-items: center; border: 1px solid var(--line, #e7eaf0); border-radius: 8px; padding-left: 9px; background: #fff; }
.tpl-ed-shortcut:focus-within { border-color: var(--brand, #1786be); }
.tpl-shortcut-slash { color: #9ca3af; font-weight: 700; font-size: 14px; }
.tpl-ed-shortcut input { border: none; padding: 8px 9px 8px 3px; }
.tpl-ed-shortcut input:focus { border: none; }
.tpl-shortcut-hint { font-size: 11.5px; color: var(--ink-3, #6b7280); margin-top: -4px; }
.tpl-shortcut-hint b { color: var(--brand-700, #0f6ea3); }
.tpl-shortcut-chip { font-size: 11px; font-weight: 600; padding: 2px 7px; border-radius: 6px; background: #eef6fb; color: #0f6ea3; font-family: ui-monospace, monospace; }
.tpl-ed-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.tpl-ed-select { padding: 6px 9px; border: 1px solid var(--line, #e7eaf0); border-radius: 8px; font-size: 12.5px; background: var(--surface, #fff); color: var(--ink-2, #374151); }
.tpl-vis-toggle { display: inline-flex; border: 1px solid var(--line, #e7eaf0); border-radius: 8px; overflow: hidden; margin-left: auto; }
.bed-vis-opt { display: inline-flex; align-items: center; gap: 4px; padding: 6px 12px; border: none; background: var(--surface, #fff); font-size: 12px; color: var(--ink-2, #374151); cursor: pointer; }
.bed-vis-opt + .bed-vis-opt { border-left: 1px solid var(--line, #e7eaf0); }
.bed-vis-opt:hover { background: var(--surface-2, #f7f9fc); }
.bed-vis-opt.active { background: var(--brand-soft, #e6f3fb); color: var(--brand-700, #0f6ea3); font-weight: 600; }
.tpl-ed-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.tpl-ed-vars { display: flex; gap: 6px; flex-wrap: wrap; }
.bed-var-chip { display: inline-flex; align-items: center; gap: 4px; padding: 4px 10px; border: 1px solid var(--brand, #1786be); background: var(--brand-soft, #e6f3fb); color: var(--brand-700, #0f6ea3); border-radius: 999px; font-size: 12px; cursor: pointer; }
.bed-var-chip:hover { background: var(--brand, #1786be); color: #fff; }
.bed-var-chip-label { font-weight: 500; }
.tpl-ed-editor { border: 1px solid var(--line, #e7eaf0); border-radius: 10px; overflow: hidden; min-height: 180px; }
.tpl-ed-foot { display: flex; align-items: center; gap: 8px; padding: 12px 18px; border-top: 1px solid var(--line, #e7eaf0); }
.tpl-del { color: var(--error, #f04438); }
</style>
