<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!-- Copyright (C) 2026 Nguyễn Tiến Lộc -->
<template>
  <!-- Refactor 2026-06-01 — thanh tag Friend-row cấp (per-pair sale-nick × KH).
       /office-hours 2026-06-06 — gom auto-tag 3→2 nhóm (BỎ Auto Score Tier khỏi thanh;
       điểm Lead vẫn ở ScoreBanner). Layout tách bằng "|":
       [Zalo Real (R/O)] | [Auto Detect: trạng thái] | [Auto Engagement: độ chăm] | [Manual]
       Auto Detect + Auto Engagement đều SỐNG (tự cập nhật). Nút "+ Thêm tag" CHỈ gắn manual. -->
  <div class="tag-crm-bar" v-if="friendId">
    <span class="bar-label"><TagIcon :size="14" :stroke-width="2" /></span>

    <!-- 1. Zalo Real (ưu tiên 1, đầu tiên, READ-ONLY) -->
    <template v-if="zaloRealTags.length">
      <span
        v-for="tag in zaloRealTags"
        :key="'zalo-' + tag.id"
        class="t2-tag-pill is-zalo-real"
        :style="{ '--tag-color': tag.color }"
        :title="'Tag Zalo Real — đổi/gỡ trên app Zalo, hệ thống tự cập nhật.'"
      >
        <ZaloBrandIcon class="t2-pill-zalo-icon" />
        <span class="t2-pill-text">{{ tag.name }}</span>
      </span>
      <span class="tag-divider">|</span>
    </template>

    <!-- 2. Auto Detect — trạng thái KH (🔥 hoạt động / ⏰ đình trệ / 📅 có hẹn / 🧊 nguội), READ-ONLY.
         2026-06-06: nền THỐNG NHẤT màu VÀNG (giống Lead score). Chữ = bản đậm của tag.color. -->
    <template v-if="detectTags.length">
      <span
        v-for="tag in detectTags"
        :key="'detect-' + tag.id"
        class="t2-tag-pill is-auto group-detect"
        :style="{ '--tag-color': tag.color, '--bar-bg': DETECT_BG }"
        :title="'Auto Detect — trạng thái KH, hệ thống tự cập nhật'"
      >
        <span v-if="tag.emoji" class="t2-pill-emoji">{{ tag.emoji }}</span>
        <span class="t2-pill-text">{{ tag.name }}</span>
      </span>
      <span class="tag-divider">|</span>
    </template>

    <!-- 3. Auto Engagement — độ chăm chat 28 ngày (Hot/Champion/Cooling/Cold), READ-ONLY.
         2026-06-06: nền THỐNG NHẤT màu XANH DƯƠNG (khớp Engagement score). Chữ = bản đậm tag.color. -->
    <template v-if="engagementTags.length">
      <span
        v-for="tag in engagementTags"
        :key="'engagement-' + tag.id"
        class="t2-tag-pill is-auto group-engagement"
        :style="{ '--tag-color': tag.color, '--bar-bg': ENGAGEMENT_BG }"
        :title="'Auto Engagement — mức độ tương tác 28 ngày, hệ thống tự cập nhật'"
      >
        <span v-if="tag.emoji" class="t2-pill-emoji">{{ tag.emoji }}</span>
        <span class="t2-pill-text">{{ tag.name }}</span>
      </span>
      <span class="tag-divider">|</span>
    </template>

    <!-- 3. Manual per Nick (sale gắn được, có nút "X" remove) -->
    <span
      v-for="tag in manualTags"
      :key="'manual-' + tag.id"
      class="t2-tag-pill is-manual"
      :style="{ '--tag-color': tag.color }"
      :title="'Tag riêng cặp nick × KH. Click X để gỡ.'"
    >
      <span v-if="tag.emoji" class="t2-pill-emoji">{{ tag.emoji }}</span>
      <span class="t2-pill-text">{{ tag.name }}</span>
      <button class="tag-x" title="Gỡ tag" @click="removeManualTag(tag)"><XIcon :size="12" :stroke-width="2.2" /></button>
    </span>

    <!-- "+ Thêm tag" dropdown CHỈ load + gắn Manual per Nick -->
    <v-menu v-model="dropdownOpen" :close-on-content-click="false" location="top start" offset="6">
      <template #activator="{ props: actProps }">
        <button v-bind="actProps" class="tag-add-btn">+ Thêm tag</button>
      </template>

      <div class="tag-dropdown">
        <div class="dd-search">
          <input
            ref="searchInput"
            v-model="search"
            name="tag-manual-search"
            autocomplete="off"
            placeholder="Tìm tag riêng cho nick này..."
            @keydown.enter.prevent="onEnterSearch"
            @keydown.escape="dropdownOpen = false"
          />
        </div>

        <div v-if="defsLoading && !manualTagDefs.length" class="dd-state">Đang tải…</div>
        <div v-else-if="!filteredDefs.length && !search" class="dd-state">
          <p>Chưa có tag thủ công nào.</p>
          <p class="dd-hint">Gõ tên tag rồi Enter để tạo mới.</p>
        </div>
        <div v-else class="dd-list">
          <button
            v-for="def in filteredDefs"
            :key="def.id"
            class="dd-option"
            :class="{ active: manualTags.some(t => t.id === def.id) }"
            @click="onPickTag(def)"
          >
            <span class="dd-color-dot" :style="{ background: def.color }"></span>
            <span class="dd-name">{{ def.name }}</span>
            <span v-if="manualTags.some(t => t.id === def.id)" class="dd-check"><CheckIcon :size="14" :stroke-width="2.2" /></span>
          </button>
          <button
            v-if="search.trim() && !filteredDefs.some(d => d.name.toLowerCase() === search.trim().toLowerCase())"
            class="dd-create-inline"
            @click="onCreateNewTag"
          >
            + Tạo "{{ search.trim() }}"
          </button>
        </div>

        <div class="dd-footer">
          <button class="dd-settings-link" @click="goToSettings">
            <span class="settings-icon"><SettingsIcon :size="14" :stroke-width="2" /></span>
            Cài đặt Tag v2
          </button>
        </div>
      </div>
    </v-menu>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, nextTick, watch } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
// Icon chrome — Lucide line (anh chốt 2026-06-08, bỏ ký tự/emoji nút).
import { Tag as TagIcon, X as XIcon, Check as CheckIcon, Settings as SettingsIcon } from 'lucide-vue-next';
import { useToast } from '@/composables/use-toast';
import { useFriendSocket } from '@/composables/use-friend-socket';
import { refreshTagTaxonomy } from '@/composables/use-tag-taxonomy';
import ZaloBrandIcon from '@/components/icons/ZaloBrandIcon.vue';

interface TagV2 {
  id: string;
  name: string;
  slug: string;
  color: string;
  emoji: string | null;
  scope: 'friend' | 'crm';
  source: string;
  priority: number;
}

interface FriendTagAssignment {
  id: string;
  tag: TagV2;
  addedAt: string;
  removedAt: string | null;
}

const props = defineProps<{
  friendId: string | null;
  /** contactId — legacy kept cho backward compat, không dùng trong refactor mới */
  contactId?: string | null;
}>();

const toast = useToast();
const router = useRouter();

const friendTags = ref<FriendTagAssignment[]>([]);
const manualTagDefs = ref<TagV2[]>([]);
const loading = ref(false);
const defsLoading = ref(false); // riêng cho fetch dropdown defs (tách khỏi loadFriendTags)

// Load FriendTag junction (active) cho friendId hiện tại.
async function loadFriendTags() {
  if (!props.friendId) return;
  loading.value = true;
  try {
    const { data } = await api.get(`/friends/${props.friendId}/tags`);
    friendTags.value = data.friendTags || [];
  } catch (err) {
    console.warn('[TagCrmBar] loadFriendTags failed', err);
  } finally {
    loading.value = false;
  }
}

// Load Tag(scope=friend, source=manual_per_nick) cho dropdown picker.
// 2026-06-17 FIX: lọc source=manual_per_nick NGAY ở server. Trước đây kéo limit tag rồi
// mới filter ở client → nếu org có ≥200 nhãn zalo_real (priority 1) thì manual_per_nick
// (priority 2) bị đẩy khỏi response → dropdown rỗng dù tag manual có tồn tại.
let fetchedDefsOnce = false;
async function loadManualTagDefs() {
  if (fetchedDefsOnce) return;
  defsLoading.value = true;
  try {
    const { data } = await api.get('/tags', { params: { scope: 'friend', source: 'manual_per_nick', limit: 200 } });
    manualTagDefs.value = (data.tags || []).filter((t: TagV2) => t.source === 'manual_per_nick');
    fetchedDefsOnce = true;
  } catch (err) {
    console.warn('[TagCrmBar] loadManualTagDefs failed', err);
  } finally {
    defsLoading.value = false;
  }
}

onMounted(() => {
  loadFriendTags();
});

watch(() => props.friendId, () => {
  loadFriendTags();
});

// 2026-06-06 (Anh chốt) — Realtime sync tag Zalo Real: khi BE emit friend:updated{zaloLabels}
// (sale đổi tag trên app Zalo / từ header CRM / sync) cho ĐÚNG friend đang mở → reload junction
// để pill Zalo Real ở thanh này khớp header + cột 2. Lọc theo friendId tránh reload thừa.
// useFriendSocket tự cleanup khi unmount.
useFriendSocket((p) => {
  if (!props.friendId || p.friendId !== props.friendId) return;
  if (p.patch && 'zaloLabels' in p.patch) {
    loadFriendTags();
  }
});

// Màu NỀN thống nhất theo nhóm (đồng bộ ScoreBanner để dễ phân biệt ở UI Chat — Anh chốt
// 2026-06-06). Nền cố định theo nhóm; CHỮ = bản đậm của tag.color (đổi được trong setting).
//   Auto Detect    → vàng giống Lead score   (#F59E0B)
//   Auto Engagement→ xanh dương Engagement   (#3B82F6)
//   Zalo Real      → tự do theo tag.color (đồng bộ Zalo)
const DETECT_BG = '#F59E0B';
const ENGAGEMENT_BG = '#3B82F6';

// Group tags theo source — render order: zalo_real → Auto Detect → Auto Engagement → manual_per_nick
// /office-hours 2026-06-06: gom auto-tag 3→2 nhóm. BỎ auto_score (Tier) khỏi thanh.
// 2 nhóm SỐNG (tự cập nhật): Auto Detect (trạng thái) + Auto Engagement (độ chăm 28 ngày).
const zaloRealTags = computed(() => friendTags.value.filter(ft => ft.tag.source === 'zalo_real').map(ft => ft.tag));
const detectTags = computed(() => friendTags.value.filter(ft => ft.tag.source === 'auto_detect').map(ft => ft.tag));
const engagementTags = computed(() => friendTags.value.filter(ft => ft.tag.source === 'auto_engagement').map(ft => ft.tag));
const manualTags = computed(() => friendTags.value.filter(ft => ft.tag.source === 'manual_per_nick').map(ft => ft.tag));

// Dropdown state
const dropdownOpen = ref(false);
const search = ref('');
const searchInput = ref<HTMLInputElement | null>(null);

watch(dropdownOpen, (v) => {
  if (v) {
    search.value = '';
    loadManualTagDefs();
    nextTick(() => searchInput.value?.focus());
  }
});

const filteredDefs = computed(() => {
  if (!search.value.trim()) return manualTagDefs.value;
  const q = search.value.toLowerCase().trim();
  return manualTagDefs.value.filter(d => d.name.toLowerCase().includes(q) || d.slug.includes(q));
});

function onEnterSearch() {
  const exact = manualTagDefs.value.find(d => d.name.toLowerCase() === search.value.trim().toLowerCase());
  if (exact) {
    onPickTag(exact);
  } else if (search.value.trim()) {
    onCreateNewTag();
  }
}

// Sau khi gắn/gỡ tag manual → báo timeline KH refresh (BE đã log tag_add_crm/remove
// với entityType=contact). CustomerTimelineSection nghe event này, lọc theo contactId.
function notifyTimeline() {
  if (props.contactId) {
    window.dispatchEvent(new CustomEvent('timeline-updated', { detail: { contactId: props.contactId } }));
  }
}

// 2026-06-10 — Sau khi gắn/gỡ tag manual, BE mirror SLUG vào Friend.crmTagsPerNick (dual-write).
// Cột 2 (ConversationList) đọc field này → bắn event để ChatView patch conv trong list NGAY,
// không bắt sale F5. Gửi slug manual hiện tại (zalo_real/auto KHÔNG vào crmTagsPerNick).
function notifyConvListTags() {
  if (!props.friendId) return;
  const slugs = friendTags.value
    .filter(ft => ft.tag.source === 'manual_per_nick' && !ft.removedAt)
    .map(ft => ft.tag.slug);
  window.dispatchEvent(new CustomEvent('friend-crm-tags-changed', {
    detail: { friendId: props.friendId, slugs },
  }));
}

async function onPickTag(def: TagV2) {
  if (!props.friendId) return;
  // Toggle: nếu đã có → remove, chưa có → add
  const existing = friendTags.value.find(ft => ft.tag.id === def.id && !ft.removedAt);
  if (existing) {
    await removeManualTag(def);
    return;
  }
  try {
    await api.post(`/friends/${props.friendId}/tags`, {
      tagId: def.id,
      source: 'manual_per_nick',
    });
    await loadFriendTags();
    notifyTimeline();
    notifyConvListTags();
    dropdownOpen.value = false;
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Gắn tag thất bại';
    toast.error(msg);
  }
}

async function onCreateNewTag() {
  if (!props.friendId || !search.value.trim()) return;
  try {
    await api.post(`/friends/${props.friendId}/tags`, {
      tagName: search.value.trim(),
      source: 'manual_per_nick',
      autoCreate: true,
    });
    fetchedDefsOnce = false; // refetch defs để dropdown thấy tag mới
    await loadManualTagDefs();
    await loadFriendTags();
    // Refresh taxonomy slug→name để cột 2 resolve được tag vừa tạo (không hiện slug thô).
    await refreshTagTaxonomy();
    notifyTimeline();
    notifyConvListTags();
    search.value = '';
    dropdownOpen.value = false;
    toast.success('Đã tạo và gắn tag mới');
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Tạo tag thất bại';
    toast.error(msg);
  }
}

async function removeManualTag(tag: TagV2) {
  if (!props.friendId) return;
  try {
    await api.delete(`/friends/${props.friendId}/tags/${tag.id}`);
    await loadFriendTags();
    notifyTimeline();
    notifyConvListTags();
  } catch (err) {
    toast.error('Gỡ tag thất bại');
  }
}

function goToSettings() {
  dropdownOpen.value = false;
  router.push('/settings/crm/tags-v2');
}
</script>

<style scoped>
.tag-crm-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  padding: 6px 8px;
  font-size: 12px;
  min-height: 32px;
}
.bar-label { font-size: 14px; flex-shrink: 0; }

.tag-divider {
  color: #c0c4cc;
  font-weight: 300;
  margin: 0 2px;
  user-select: none;
}

/* Tag pill — đồng nhất style /settings/crm/tags-v2 (color-mix derive bg/border/text) */
.t2-tag-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 12px;
  font-size: 12px;
  font-weight: 500;
  border: 1.4px solid;
  --tag-color: #546E7A;
  background: color-mix(in srgb, var(--tag-color) 12%, white);
  border-color: color-mix(in srgb, var(--tag-color) 75%, white);
  color: color-mix(in srgb, var(--tag-color) 78%, black);
  white-space: nowrap;
  flex-shrink: 0;
}
.t2-tag-pill.is-zalo-real {
  background: color-mix(in srgb, var(--tag-color) 14%, white);
  border-color: color-mix(in srgb, var(--tag-color) 80%, white);
  cursor: help;
}
.t2-tag-pill.is-auto {
  background: color-mix(in srgb, var(--tag-color) 10%, white);
  border-color: color-mix(in srgb, var(--tag-color) 60%, white);
  font-weight: 600;
  cursor: help;
}

/* Nền THỐNG NHẤT theo nhóm (Anh chốt 2026-06-06): nền + viền lấy từ --bar-bg (màu nhóm),
   CHỮ vẫn lấy từ --tag-color (màu tag trong setting) nhưng làm ĐẬM để luôn đọc rõ trên nền nhạt. */
.t2-tag-pill.group-detect,
.t2-tag-pill.group-engagement {
  background: color-mix(in srgb, var(--bar-bg) 14%, white);
  border-color: color-mix(in srgb, var(--bar-bg) 55%, white);
  color: color-mix(in srgb, var(--tag-color) 82%, black);
}
.t2-tag-pill.is-manual {
  /* Sale gắn được — hiển thị X button */
}
.t2-pill-zalo-icon { width: 12px; height: 12px; flex-shrink: 0; }
.t2-pill-emoji { font-size: 13px; flex-shrink: 0; }
.t2-pill-text { white-space: nowrap; }

.tag-x {
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 0 0 0 4px;
  opacity: 0.6;
}
.tag-x:hover { opacity: 1; }

.tag-add-btn {
  background: white;
  border: 1px dashed #b0bec5;
  color: #546E7A;
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  cursor: pointer;
  flex-shrink: 0;
}
.tag-add-btn:hover {
  background: #f5f7fa;
  border-color: #546E7A;
}

/* Dropdown picker */
.tag-dropdown {
  background: white;
  border: 1px solid #dddddd;
  border-radius: 8px;
  min-width: 280px;
  max-width: 360px;
  max-height: 360px;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.dd-search {
  padding: 8px 8px 6px;
  border-bottom: 1px solid #eef0f3;
}
.dd-search input {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid #dddddd;
  border-radius: 6px;
  font-size: 13px;
  box-sizing: border-box;
}
.dd-list {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.dd-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: white;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: #181d26;
  text-align: left;
}
.dd-option:hover { background: #f5f7fa; }
.dd-option.active { background: #e8f3ff; }
.dd-color-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dd-name { flex: 1; }
.dd-check { color: #0068FF; font-weight: 700; }
.dd-state, .dd-hint {
  padding: 12px;
  text-align: center;
  color: #999;
  font-size: 12px;
}
.dd-hint { font-size: 11px; padding-top: 0; }
.dd-create-inline {
  display: block;
  width: 100%;
  padding: 8px 12px;
  background: white;
  border: none;
  border-top: 1px dashed #dddddd;
  cursor: pointer;
  font-size: 12px;
  color: #0068FF;
  font-weight: 500;
  text-align: left;
}
.dd-create-inline:hover { background: #f5f7fa; }
.dd-footer {
  border-top: 1px solid #eef0f3;
  padding: 6px;
}
.dd-settings-link {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 11px;
  color: #41454d;
}
.dd-settings-link:hover { background: #f5f7fa; }
.settings-icon { font-size: 12px; display: inline-flex; align-items: center; }
/* Icon Lucide chrome — căn giữa (2026-06-08). */
.bar-label, .tag-x, .dd-check { display: inline-flex; align-items: center; justify-content: center; }
.bar-label svg, .tag-x svg, .dd-check svg, .settings-icon svg { display: block; }
</style>
