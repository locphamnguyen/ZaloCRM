<template>
  <div class="tag-crm-bar" v-if="contactId">
    <!-- Label prefix -->
    <span class="bar-label">🏷</span>

    <!-- Assigned pills — Zalo-managed FIRST (theo managedBy), sau đó CrmTag.order.
         Zalo-managed: monochromatic chip (icon + bg + border + text cùng tone từ ZaloLabel.color
         qua color-mix). CRM tag: chip gray neutral hoặc tinted theo CrmTag.color. -->
    <span
      v-for="tag in sortedTags"
      :key="tag"
      class="tag-pill"
      :class="{ 'tag-zalo': isZaloManaged(tag), 'tag-crm': !isZaloManaged(tag) }"
      :style="{ '--tag-color': tagColor(tag) }"
      :title="isZaloManaged(tag)
        ? `Tag Zalo Real — đổi/gỡ trên app Zalo, hệ thống tự cập nhật. ${findDef(tag)?.description || ''}`
        : (findDef(tag)?.description || 'Click × để xoá')"
    >
      <TagIcon v-if="isZaloManaged(tag)" :size="13" />
      <span v-else-if="findDef(tag)?.emoji">{{ findDef(tag)?.emoji }} </span>{{ cleanTagName(tag) }}
      <button
        v-if="!isZaloManaged(tag)"
        class="tag-x"
        title="Xoá tag"
        @click="removeTag(tag)"
      >×</button>
    </span>

    <!-- "+ Thêm tag" dropdown — xổ lên (location top) chứa list system tags + settings link -->
    <v-menu v-model="dropdownOpen" :close-on-content-click="false" location="top start" offset="6">
      <template #activator="{ props: actProps }">
        <button v-bind="actProps" class="tag-add-btn">
          + Thêm tag
        </button>
      </template>

      <div class="tag-dropdown">
        <!-- Search input -->
        <div class="dd-search">
          <input
            ref="searchInput"
            v-model="search"
            name="tag-crm-search"
            autocomplete="off"
            placeholder="Tìm tag…"
            @keydown.enter.prevent="onEnterSearch"
            @keydown.escape="dropdownOpen = false"
          />
        </div>

        <!-- Tag list -->
        <div v-if="loading && !tagDefs.length" class="dd-state">Đang tải…</div>
        <div v-else-if="!filteredDefs.length && !search" class="dd-state">
          <p>Chưa có tag CRM nào trong hệ thống.</p>
          <button class="dd-create-inline" @click="goToSettings">+ Tạo tag mới</button>
        </div>
        <div v-else class="dd-list">
          <button
            v-for="def in filteredDefs"
            :key="def.id"
            class="dd-option"
            :class="{ active: tags.includes(def.name) }"
            @click="onPickTag(def)"
          >
            <span class="dd-color-dot" :style="`background: ${def.color}`"></span>
            <span class="dd-tag-name">
              <span v-if="def.emoji">{{ def.emoji }} </span>{{ def.name }}
              <span v-if="def.category" class="dd-category">· {{ def.category }}</span>
            </span>
            <span v-if="tags.includes(def.name)" class="dd-check">✓</span>
          </button>

          <!-- Free-text option khi search không match exact -->
          <button
            v-if="search.trim() && !filteredDefs.some(d => d.name.toLowerCase() === search.trim().toLowerCase())"
            class="dd-option dd-option-create"
            @click="onCreateNewTag"
          >
            <span class="dd-color-dot" style="background: #90A4AE; border: 1px dashed #90A4AE;"></span>
            <span class="dd-tag-name">Tạo tag mới: <strong>{{ search.trim() }}</strong></span>
          </button>
        </div>

        <!-- Footer settings link -->
        <div class="dd-footer">
          <button class="dd-settings-link" @click="goToSettings">
            <span class="settings-icon">⚙</span>
            Cài đặt tag CRM
          </button>
        </div>
      </div>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { api } from '@/api/index';
import { useToast } from '@/composables/use-toast';
import TagIcon from '@/components/icons/TagIcon.vue';
import { tagColor as lookupTagColor, cleanTagName } from '@/composables/use-crm-tag-defs';

interface CrmTagDef {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
  description: string | null;
  category: string | null;
  order: number;
  isActive: boolean;
  managedBy?: string | null;   // 'zalo_sync' | null — Zalo-managed read-only
}

const props = defineProps<{
  contactId: string | null;
  modelValue: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [tags: string[]];
}>();

const toast = useToast();

// CrmTag master list — fetch khi cần
const tagDefs = ref<CrmTagDef[]>([]);
const loading = ref(false);
let fetchedOnce = false;

async function loadTagDefs() {
  if (fetchedOnce) return;
  loading.value = true;
  try {
    const { data } = await api.get('/crm-tags');
    tagDefs.value = (data.tags || []).filter((t: CrmTagDef) => t.isActive);
    fetchedOnce = true;
  } catch (err) {
    console.warn('[crm-tags] Cannot load master list', err);
  } finally {
    loading.value = false;
  }
}

const tags = computed(() => props.modelValue || []);

// Sort: Zalo-managed tags FIRST, sau đó theo priority CrmTag.order, cuối là alphabetical
const sortedTags = computed(() => {
  const list = tags.value;
  return [...list].sort((a, b) => {
    const da = findDef(a);
    const db = findDef(b);
    // Zalo-managed luôn đứng trước
    const aZalo = da?.managedBy === 'zalo_sync' ? 0 : 1;
    const bZalo = db?.managedBy === 'zalo_sync' ? 0 : 1;
    if (aZalo !== bZalo) return aZalo - bZalo;
    if (da && db) return da.order - db.order;
    if (da) return -1;
    if (db) return 1;
    return a.localeCompare(b);
  });
});

function isZaloManaged(name: string): boolean {
  return findDef(name)?.managedBy === 'zalo_sync';
}

function findDef(name: string): CrmTagDef | null {
  return tagDefs.value.find(d => d.name === name) || null;
}

function tagColor(name: string): string {
  // Ưu tiên CrmTag.color local, fallback shared composable (Zalo-mirror, color cache)
  return findDef(name)?.color || lookupTagColor(name);
}

// Dropdown state
const dropdownOpen = ref(false);
const search = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

watch(dropdownOpen, (v) => {
  if (v) {
    search.value = '';
    nextTick(() => searchInput.value?.focus());
  }
});

const filteredDefs = computed(() => {
  if (!search.value.trim()) return tagDefs.value;
  const q = search.value.toLowerCase().trim();
  return tagDefs.value.filter(d =>
    d.name.toLowerCase().includes(q) ||
    (d.description || '').toLowerCase().includes(q) ||
    (d.category || '').toLowerCase().includes(q),
  );
});

function onEnterSearch() {
  // Enter trên search: nếu match 1 def → assign; nếu không → create new
  const exact = tagDefs.value.find(d => d.name.toLowerCase() === search.value.trim().toLowerCase());
  if (exact) {
    onPickTag(exact);
  } else if (search.value.trim()) {
    onCreateNewTag();
  }
}

async function onPickTag(def: CrmTagDef) {
  // Toggle: nếu đã gắn → bỏ; chưa gắn → thêm
  if (tags.value.includes(def.name)) {
    await persist(tags.value.filter(t => t !== def.name));
  } else {
    await persist([...tags.value, def.name]);
  }
  search.value = '';
  // Giữ dropdown mở để chọn nhiều tag liên tiếp
}

async function onCreateNewTag() {
  const name = search.value.trim();
  if (!name) return;
  if (tags.value.includes(name)) {
    toast.warning('Tag đã tồn tại trên KH này');
    return;
  }
  try {
    const { data } = await api.post('/crm-tags', { name, category: 'Khác' });
    tagDefs.value.push(data.tag);
    await persist([...tags.value, name]);
    search.value = '';
    toast.success(`✓ Đã tạo tag "${name}" + gắn cho KH`);
  } catch (err: any) {
    // Tag có thể đã tồn tại trong DB (legacy) — vẫn assign vào Contact.tags
    if (err?.response?.status === 409) {
      await persist([...tags.value, name]);
      search.value = '';
    } else {
      toast.error('Không tạo được tag');
    }
  }
}

async function removeTag(tag: string) {
  const newTags = tags.value.filter(t => t !== tag);
  await persist(newTags);
  // Undo 5s — restore tag vào đúng vị trí cũ
  toast.undo(`Đã gỡ tag "${tag}"`, async () => {
    if (!tags.value.includes(tag)) {
      await persist([...tags.value, tag]);
    }
  });
}

async function persist(next: string[]) {
  if (!props.contactId) return;
  emit('update:modelValue', next); // optimistic
  try {
    // Backend dùng PUT /contacts/:id/tags (endpoint chuyên cho tags), KHÔNG phải PATCH.
    await api.put(`/contacts/${props.contactId}/tags`, { tags: next });
    // Trigger timeline refresh + highlight entry "tag_*_crm" mới
    window.dispatchEvent(new CustomEvent('timeline-updated', { detail: { contactId: props.contactId } }));
  } catch (err: any) {
    const msg = err?.response?.data?.error || `Lưu tag thất bại (${err?.response?.status || 'network'})`;
    toast.error(msg);
  }
}

function goToSettings() {
  dropdownOpen.value = false;
  window.location.assign('/settings?tab=crm-tags');
}

onMounted(() => { void loadTagDefs(); });
</script>

<style scoped>
.tag-crm-bar {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 6px;
  margin: -7px -13px 7px;        /* extend full-width của .input-area */
  padding: 6px 13px;
  background: var(--smax-grey-50, #fafbfc);
  border-bottom: 1px solid var(--smax-grey-100);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.tag-crm-bar::-webkit-scrollbar { height: 4px; }
.tag-crm-bar::-webkit-scrollbar-thumb {
  background: var(--smax-grey-200);
  border-radius: 2px;
}
.tag-crm-bar::-webkit-scrollbar-track { background: transparent; }

.bar-label {
  font-size: 13px;
  color: var(--smax-grey-500);
  margin-right: 2px;
  flex-shrink: 0;
}

.tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1.4px solid;
  background: transparent;
  white-space: nowrap;
  flex-shrink: 0;
  transition: filter 0.12s;
}
.tag-pill:hover { filter: brightness(0.96); }

/* Zalo-managed: monochromatic chip dùng color-mix() derive 3 màu phụ từ --tag-color.
 * Hỗ trợ Chrome 111+, Safari 16.2+, Firefox 113+ — modern browsers OK cho CRM nội bộ. */
.tag-pill.tag-zalo {
  --tag-color: #0068FF;
  background: color-mix(in srgb, var(--tag-color) 12%, white);
  border-color: color-mix(in srgb, var(--tag-color) 80%, white);
  color: color-mix(in srgb, var(--tag-color) 75%, black);
  padding: 3px 10px;
  cursor: help;
}
.tag-pill.tag-zalo :deep(.tag-icon) {
  color: var(--tag-color);
}

/* CRM tag: dùng CrmTag.color qua --tag-color, render tinted chip nhẹ. */
.tag-pill.tag-crm {
  --tag-color: #546E7A;
  background: color-mix(in srgb, var(--tag-color) 8%, white);
  border-color: color-mix(in srgb, var(--tag-color) 70%, white);
  color: color-mix(in srgb, var(--tag-color) 80%, black);
}
.tag-x {
  background: none;
  border: none;
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
  color: inherit;
  opacity: 0.55;
  transition: opacity 0.1s;
}
.tag-x:hover { opacity: 1; }

.tag-add-btn {
  background: #fff;
  border: 1.4px dashed var(--smax-grey-300);
  color: var(--smax-grey-600);
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  padding: 3px 11px;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.12s;
}
.tag-add-btn:hover {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary);
  border-color: var(--smax-primary);
  border-style: solid;
}

/* ── Dropdown popup (Zalo-native style, opens upward) ────────────────── */
.tag-dropdown {
  width: 280px;
  max-height: 380px;
  background: #fff;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.15);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dd-search {
  padding: 8px 10px 6px;
  border-bottom: 1px solid var(--smax-grey-100);
}
.dd-search input {
  width: 100%;
  border: 1px solid var(--smax-grey-200);
  border-radius: 7px;
  padding: 6px 10px;
  font-size: 13px;
  font-family: inherit;
  outline: none;
  background: var(--smax-grey-50);
}
.dd-search input:focus { border-color: var(--smax-primary); background: #fff; }

.dd-state {
  padding: 16px;
  text-align: center;
  color: var(--smax-grey-500);
  font-size: 12.5px;
}
.dd-create-inline {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  border: none;
  margin-top: 6px;
  font-weight: 600;
  font-size: 12px;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
}

.dd-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
  min-height: 0;
}

.dd-option {
  display: flex;
  align-items: center;
  gap: 10px;
  background: transparent;
  border: none;
  padding: 7px 12px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  width: 100%;
  text-align: left;
  transition: background 0.1s;
}
.dd-option:hover { background: var(--smax-grey-50, #f5f6fa); }
.dd-option.active { background: rgba(33, 150, 243, 0.06); }
.dd-option.active .dd-tag-name { font-weight: 600; }
.dd-option-create {
  border-top: 1px dashed var(--smax-grey-200);
  font-style: italic;
  color: var(--smax-primary);
}
.dd-option-create:hover { background: var(--smax-primary-soft); }

.dd-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dd-tag-name {
  flex: 1;
  color: var(--smax-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dd-category {
  font-size: 11px;
  color: var(--smax-grey-500);
  font-weight: 400;
  margin-left: 2px;
}
.dd-check {
  color: var(--smax-primary);
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}

.dd-footer {
  border-top: 1px solid var(--smax-grey-100);
}
.dd-settings-link {
  width: 100%;
  background: transparent;
  border: none;
  padding: 9px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12.5px;
  color: var(--smax-grey-700);
  font-family: inherit;
  font-weight: 500;
  transition: background 0.1s, color 0.1s;
}
.dd-settings-link:hover {
  background: var(--smax-grey-50);
  color: var(--smax-primary);
}
.settings-icon { font-size: 14px; }
</style>
