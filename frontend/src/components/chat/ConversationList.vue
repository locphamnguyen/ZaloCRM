<template>
  <div class="conv-list">
    <!-- ════════ Header: search + label chip + tabs ════════ -->
    <div class="cl-header">
      <div class="cl-search-row">
        <input
          class="cl-search"
          name="conv-list-search"
          ref="searchInputEl"
          autocomplete="off"
          :value="search"
          :class="{ 'cl-search--flash': searchFlash }"
          placeholder="Tìm theo tên, SĐT, nội dung tin nhắn…"
          @input="onSearchInput"
          @animationend="searchFlash = false"
        />
        <button
          class="cl-new-msg"
          ref="newMsgBtnEl"
          data-nick-picker-trigger
          title="Bắt đầu cuộc trò chuyện mới"
          @click="onClickNewMessage"
        >
          <v-icon size="18">mdi-message-plus</v-icon>
          <span>Tin nhắn mới</span>
          <span v-if="newMsgPickerOpen" class="cl-new-msg-caret">▴</span>
        </button>

        <!-- Wedge A 2026-05-28: NickPickerPopup xổ từ nút Tin nhắn mới
             Chỉ mở khi search có SĐT (>= 9 digits) -->
        <NickPickerPopup
          v-model="newMsgPickerOpen"
          :accounts="composeAccounts as any"
          :trigger-el="newMsgBtnEl"
          title="📤 Chọn nick gửi tin nhắn"
          @pick="onPickNickForNewMsg"
        />
      </div>

      <!-- Label chip bar (filter theo tag CRM) — SINGLE-SELECT.
           Khi 1 tag active → ẩn tag khác. Click lại để clear (show all). -->
      <div v-if="visibleTags.length" class="cl-label-bar">
        <span
          v-for="tag in visibleTags"
          :key="tag"
          class="cl-label-chip"
          :class="{ active: filters.tags.includes(tag), 'is-zalo': isZaloManaged(tag) }"
          :style="{ '--tag-color': tagColor(tag) || '#6B7280' }"
          @click="toggleTag(tag)"
        >{{ cleanTagName(tag) }}</span>

        <button
          v-if="filters.tags.length"
          class="clear-tags"
          @click="filters.tags = []"
          title="Bỏ lọc tag · hiển thị lại tất cả"
        >×</button>
      </div>

      <!-- Phase 6+ Inbox Triage Filter Bar (Pills + 4 tabs + Mini counter) -->
      <!-- Old "Chính/Khác" tabs replaced by 4-tab single-active trong slot này. -->
      <slot name="filters" />
    </div>

    <!-- ════════ Conv items ════════ -->
    <div ref="scrollContainer" class="conv-scroll">
      <div v-if="loading && conversations.length === 0" class="loading">Đang tải…</div>

      <!-- Phase A perf fix v2 (2026-05-21) — Re-thêm TransitionGroup nhưng với
           :key="activeTabKey" → tab switch tạo TransitionGroup INSTANCE MỚI,
           Vue ko so sánh position cũ vs mới (vì khác instance), tab switch instant.
           Trong cùng tab, key giữ nguyên → reorder (tin mới đến) animate mượt. -->
      <TransitionGroup :key="activeTabKey || 'default'" name="conv-list" tag="div" class="conv-list-inner">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        :ref="(el) => registerRow(conv.id, el as HTMLElement | null)"
        class="conv-item"
        :class="{
          active: conv.id === selectedId,
          unread: conv.unreadCount > 0 && conv.id !== selectedId,
          'is-group': conv.threadType === 'group',
          'is-virtual': conv.isVirtual,
        }"
        @click="$emit('select', conv.id)"
        @contextmenu.prevent="openContextMenu($event, conv)"
      >
        <div class="ci-avatar-wrap">
          <Avatar
            :src="avatarSrcOf(conv)"
            :name="displayName(conv)"
            :size="41"
            :is-group="conv.threadType === 'group'"
            :platform="conv.threadType === 'user' ? 'zalo' : null"
            :gradient-seed="conv.id"
          />
          <!-- Mini nick avatar — góc dưới-trái cho biết conv thuộc nick Zalo nào.
               Anh chốt 2026-05-28: tránh phải click vào conv mới biết nick. -->
          <img
            v-if="conv.zaloAccount?.avatarUrl"
            :src="conv.zaloAccount.avatarUrl"
            :alt="conv.zaloAccount.displayName || ''"
            :title="conv.zaloAccount.displayName ? `Nick: ${conv.zaloAccount.displayName}` : 'Nick Zalo'"
            class="ci-nick-mini"
          />
          <span
            v-else-if="conv.zaloAccount?.displayName"
            class="ci-nick-mini ci-nick-mini--initial"
            :title="`Nick: ${conv.zaloAccount.displayName}`"
          >{{ (conv.zaloAccount.displayName || '?').charAt(0).toUpperCase() }}</span>

          <!-- M55 2026-05-30: Badge cùng chăm — góc trên-phải avatar KH.
               Chỉ hiện khi có >=2 sale chăm KH này (avoid noise khi chỉ 1 sale).
               Tooltip = list collaborators. Click conv để vào panel chi tiết. -->
          <span
            v-if="cungChamCount(conv) >= 2"
            class="ci-cung-cham-badge"
            :title="cungChamTooltip(conv)"
          >🤝 {{ cungChamCount(conv) }}</span>
        </div>


        <div class="ci-body">
          <div class="ci-name-row">
            <div class="ci-name">
              <span v-if="conv.threadType === 'group'" class="group-icon">👥</span>
              <span v-if="conv.isVirtual" class="virtual-chip" title="Chat nội bộ — KH chưa có Zalo, tin nhắn KHÔNG gửi đi">🔒</span>
              {{ displayName(conv) }}
            </div>
            <div class="ci-meta-right">
              <div class="ci-time">{{ formatTime(conv.lastMessageAt) }}</div>
              <div
                v-if="conv.unreadCount > 0 && conv.id !== selectedId"
                class="ci-unread-count"
              >{{ conv.unreadCount > 5 ? '5+' : conv.unreadCount }}</div>
              <!-- Phase 8 — Engagement pattern badge (tooltip teleport to body) -->
              <span
                v-if="(conv as any).contact?.engagementPattern && (conv as any).contact?.engagementPattern !== 'noise'"
                class="engagement-badge"
                :class="`pattern-${(conv as any).contact?.engagementPattern}`"
                @mouseenter="onPatternHover($event, (conv as any).contact)"
                @mouseleave="onPatternLeave"
              >
                {{ patternIcon((conv as any).contact?.engagementPattern) }}
              </span>
            </div>
          </div>

          <div class="ci-preview" :class="`tone-${lastMessagePreviewTone(conv) ?? 'normal'}`">
            <!-- Privacy: click blur preview KHÔNG redirect (tránh nhầm khi click chuyển hội thoại).
                 Blur thuần visual, không bắt event riêng. -->
            <PrivateBlur v-if="privacyVisibility.shouldBlurConv(conv)" :redacted="true" mode="inline" />
            <template v-else>{{ lastMessagePreview(conv) }}</template>
          </div>

          <!-- Tag row luôn render (kể cả rỗng) để giữ layout cố định.
               Merge Contact.tags + Friend.crmTagsPerNick (Zalo-mirrored 🔵 X).
               Show 3 tag đầu + "+N" chip click xem rest qua v-menu. -->
          <div class="ci-tag-row">
            <span
              v-for="tag in mergedTags(conv).slice(0, 3)"
              :key="tag"
              class="tag-mini"
              :class="{ 'tag-zalo': isZaloManaged(tag), 'tag-crm': !isZaloManaged(tag) }"
              :style="{ '--tag-color': tagColor(tag) }"
            >
              <ZaloBrandIcon v-if="isZaloManaged(tag)" :size="11" />{{ cleanTagName(tag) }}
            </span>

            <v-menu
              v-if="mergedTags(conv).length > 3"
              :close-on-content-click="false"
              location="top start"
              open-on-hover
            >
              <template #activator="{ props: actProps }">
                <span
                  v-bind="actProps"
                  class="tag-overflow"
                  :title="`Còn ${mergedTags(conv).length - 3} tag khác`"
                  @click.stop
                >+{{ mergedTags(conv).length - 3 }}</span>
              </template>
              <div class="tag-overflow-popup">
                <span
                  v-for="tag in mergedTags(conv).slice(3)"
                  :key="tag"
                  class="tag-popup-pill"
                  :class="{ 'tag-zalo': isZaloManaged(tag), 'tag-crm': !isZaloManaged(tag) }"
                  :style="{ '--tag-color': tagColor(tag) }"
                >
                  <ZaloBrandIcon v-if="isZaloManaged(tag)" :size="11" />{{ cleanTagName(tag) }}
                </span>
              </div>
            </v-menu>

            <span v-if="friendshipStatus(conv)" :class="['status-pill', friendshipPillClass(conv)]">
              {{ friendshipStatus(conv) }}
            </span>
          </div>
        </div>

        <AiSentimentBadge v-if="parseSentiment(conv)" :sentiment="parseSentiment(conv)" class="sentiment" />
      </div>
      </TransitionGroup>

      <div v-if="!loading && conversations.length === 0" class="empty-state">
        Chưa có hội thoại nào
      </div>
    </div>

    <!-- Context menu (right-click) -->
    <v-menu v-model="contextMenu.show" :target="[contextMenu.x, contextMenu.y]" location="end">
      <v-list density="compact">
        <v-list-item
          v-if="activeTab === 'main'"
          prepend-icon="mdi-archive-arrow-down-outline"
          @click="moveConversation(contextMenu.convId, 'other')"
        >
          <v-list-item-title>Chuyển sang tab Khác</v-list-item-title>
        </v-list-item>
        <v-list-item
          v-else
          prepend-icon="mdi-archive-arrow-up-outline"
          @click="moveConversation(contextMenu.convId, 'main')"
        >
          <v-list-item-title>Chuyển sang tab Chính</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-menu>

    <!-- Compose new message dialog — chỉ mở SAU khi chọn nick từ NickPickerPopup -->
    <NewMessageDialog
      v-model="newMsgOpen"
      :accounts="composeAccounts"
      :default-account-id="composeDefaultAccountId"
      :initial-query="newMsgInitialQuery"
      @opened="onComposeOpened"
    />

    <!-- Phase 8 — Engagement pattern tooltip (teleport ra body để escape overflow:hidden) -->
    <Teleport to="body">
      <div
        v-if="patternTipVisible && patternTipData"
        class="engagement-pattern-tip-portal"
        :style="patternTipStyle"
        role="tooltip"
      >
        <strong class="ept-title">{{ patternIcon(patternTipData.pattern) }} {{ patternLabel(patternTipData.pattern) }}</strong>
        <span class="ept-meaning">{{ patternMeaning(patternTipData.pattern) }}</span>
        <span v-if="patternTipData.score != null" class="ept-detail">
          Điểm {{ patternTipData.score }}/100
          <template v-if="patternTipData.trend != null">
            · trend {{ patternTipData.trend > 0 ? '+' : '' }}{{ patternTipData.trend }}%
          </template>
        </span>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted, computed, nextTick } from 'vue';
import type { Conversation, AiSentiment } from '@/composables/use-chat';
import { api } from '@/api/index';
import AiSentimentBadge from '@/components/ai/ai-sentiment-badge.vue';
import Avatar from '@/components/ui/Avatar.vue';
import NewMessageDialog from '@/components/chat/NewMessageDialog.vue';
import NickPickerPopup from '@/components/zalo-accounts/NickPickerPopup.vue';
import ZaloBrandIcon from '@/components/icons/ZaloBrandIcon.vue';
import { loadTagDefs, isZaloManaged, cleanTagName, tagColor } from '@/composables/use-crm-tag-defs';
import { getOrgParts } from '@/composables/use-org-timezone';
import PrivateBlur from '@/components/privacy/PrivateBlur.vue';
import { usePrivacyVisibility } from '@/composables/use-privacy-visibility';

const privacyVisibility = usePrivacyVisibility();

const props = defineProps<{
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  search: string;
  accounts?: Array<{
    id: string;
    displayName: string | null;
    avatarUrl?: string | null;
    ownerUserId?: string | null;
    privacyMode?: string | null;
    isOwnedByMe?: boolean;
    owner?: { id: string; fullName: string | null } | null;
    zaloUid?: string | null;
  }>;
  selectedAccountIds?: string[];
  /** Phase A perf (2026-05-21) — tab key (personal/group/main/other). Dùng làm
   *  :key cho TransitionGroup → tab switch tạo instance MỚI → bỏ qua FLIP
   *  animation cross-tab. Reorder trong cùng tab (tin mới đến) vẫn animate.
   *  Không bắt buộc; nếu missing thì TransitionGroup hoạt động như trước. */
  activeTabKey?: string;
}>();

const emit = defineEmits<{
  select: [id: string];
  'update:search': [value: string];
  'filter-account': [accountId: string | null];
  'update:filters': [params: Record<string, string>];
  'tab-changed': [tab: string];
  'conversation-moved': [id: string, tab: string];
  'compose-opened': [conversationId: string];
}>();

// ── Compose new message ─────────────────────────────────────────────────────
// Wedge A 2026-05-28 (anh chốt): nút "Tin nhắn mới" hành xử theo 2 state.
//  - Search empty → flash đỏ cam viền search + focus, KHÔNG mở dialog.
//  - Search có nội dung → mở NickPickerPopup xổ từ nút này (Teleport + anchored).
//  - Pick nick từ popup → đóng popup + mở NewMessageDialog với
//    defaultAccountId + initialQuery=search box.
const newMsgOpen = ref(false);
const newMsgPickerOpen = ref(false);
const newMsgBtnEl = ref<HTMLElement | null>(null);
const searchInputEl = ref<HTMLInputElement | null>(null);
const searchFlash = ref(false);
const newMsgInitialQuery = ref('');
const newMsgPickedAccountId = ref<string | null>(null);

const composeAccounts = computed(() => props.accounts || []);
const composeDefaultAccountId = computed<string | null>(() => {
  // Sau khi chọn nick từ popup → ưu tiên dùng cái đó
  if (newMsgPickedAccountId.value) return newMsgPickedAccountId.value;
  const ids = props.selectedAccountIds || [];
  if (ids.length === 1) return ids[0];
  if (composeAccounts.value.length === 1) return composeAccounts.value[0].id;
  return null;
});

function onClickNewMessage() {
  const q = (props.search || '').trim();
  if (!q) {
    // State A: hint sale nhập SĐT vào search trước
    searchFlash.value = true;
    nextTick(() => searchInputEl.value?.focus());
    return;
  }
  // State B: mở NickPickerPopup xổ từ button "Tin nhắn mới"
  newMsgPickerOpen.value = !newMsgPickerOpen.value;
}

function onPickNickForNewMsg(nick: { id: string }) {
  newMsgPickedAccountId.value = nick.id;
  newMsgInitialQuery.value = (props.search || '').trim();
  newMsgPickerOpen.value = false;
  newMsgOpen.value = true;
}

function onComposeOpened(conversationId: string) {
  // M55.3 2026-05-30: đóng dialog NewMessageDialog NGAY khi opened — defensive,
  // tránh sale phải bấm X thủ công nếu child dialog quên emit update:modelValue.
  newMsgOpen.value = false;
  emit('compose-opened', conversationId);
  // Reset picked state sau khi dialog đã open + emit (dùng cho lần next)
  newMsgPickedAccountId.value = null;
  // Wedge A 2026-05-28 anh chốt: clear search SĐT sau khi mở chat thành công.
  // Trước fix: sale gõ SĐT vào search → chọn nick → mở chat → conv mở nhưng
  // conv list vẫn filter SĐT → conv mới biến mất → phải xoá search thủ công.
  emit('update:search', '');
}

// ── Tab state ──────────────────────────────────────────────────────────────
const activeTab = ref<'main' | 'other'>('main');

// ── Context menu state ─────────────────────────────────────────────────────
const contextMenu = reactive({ show: false, x: 0, y: 0, convId: '' });

// ── Filter state ────────────────────────────────────────────────────────────
const filters = reactive({
  tags: [] as string[],
});

const counts = reactive({ unread: 0, unreplied: 0, total: 0 });
const availableTags = ref<string[]>([]);

// ── Helpers ────────────────────────────────────────────────────────────────
function onSearchInput(e: Event) {
  emit('update:search', (e.target as HTMLInputElement).value);
}

// Single-select: click tag → set ONLY tag đó. Click tag đang active → clear.
// Khi đã có 1 tag active → tag khác ẩn (visibleTags computed).
function toggleTag(tag: string) {
  if (filters.tags.includes(tag)) {
    filters.tags = [];          // deselect → clear filter, show all tags lại
  } else {
    filters.tags = [tag];        // single-select chỉ giữ 1 tag
  }
}

// visibleTags: nếu có tag active → chỉ hiện tag đó. Còn lại → show all.
const visibleTags = computed(() => {
  if (filters.tags.length > 0) {
    return availableTags.value.filter((t: string) => filters.tags.includes(t));
  }
  return availableTags.value;
});

function buildFilterParams(): Record<string, string> {
  // LUÔN include key 'tags' (empty string khi không có tag).
  // Lý do: ChatView onFiltersUpdate merge với extraFilters cũ — nếu không
  // gửi 'tags' key, giá trị cũ vẫn tồn tại → list không clear filter khi
  // user bấm × hoặc click tag để untag. Empty string → backend skip filter.
  const params: Record<string, string> = {
    tab: activeTab.value,
    tags: filters.tags.length > 0 ? filters.tags.join(',') : '',
  };
  return params;
}

// Tag color logic giờ qua composable use-crm-tag-defs (tagColor lookup từ CrmTag.color).
// Legacy TAG_COLOR_MAP + colorOfTag + tagBgColor đã removed sau refactor TagIcon monochromatic.

/* Merge Contact.tags + Friend.crmTagsPerNick (Zalo-mirrored "🔵 X").
 * Dedup, Zalo tags hiển thị đầu (priority cho per-pair context). */
function mergedTags(conv: Conversation): string[] {
  const contactTags = Array.isArray(conv.contact?.tags) ? (conv.contact!.tags as string[]) : [];
  const friendTagsRaw = (conv.friendship as { crmTagsPerNick?: string[] } | null | undefined)?.crmTagsPerNick;
  const friendTags = Array.isArray(friendTagsRaw) ? friendTagsRaw : [];
  // Dedup, Zalo-managed (🔵 prefix) lên trước
  const seen = new Set<string>();
  const result: string[] = [];
  for (const t of friendTags) if (t.startsWith('🔵 ') && !seen.has(t)) { seen.add(t); result.push(t); }
  for (const t of friendTags) if (!t.startsWith('🔵 ') && !seen.has(t)) { seen.add(t); result.push(t); }
  for (const t of contactTags) if (!seen.has(t)) { seen.add(t); result.push(t); }
  return result;
}

// ── Conversation display ───────────────────────────────────────────────────
// B7 fix — Contact stub "Unknown" (tạo bởi friend-event-handler khi event đến
// trước message, no name payload) phải fallback sang zaloDisplayName của Friend
// để không hiện "Unknown" dù sync đã pull về tên Zalo thật.
function isUsableName(s: string | null | undefined): s is string {
  return !!s && s.trim().length > 0 && s.trim().toLowerCase() !== 'unknown';
}
// M55 2026-05-30 — Cùng chăm counter cho ConversationList badge
function cungChamCount(conv: Conversation): number {
  return (conv.contact as { contactAccess?: unknown[] } | null | undefined)?.contactAccess?.length ?? 0;
}
function cungChamTooltip(conv: Conversation): string {
  const list = ((conv.contact as { contactAccess?: Array<{
    role: string;
    user: { fullName: string | null; email: string | null } | null;
  }> } | null | undefined)?.contactAccess) ?? [];
  if (!list.length) return '';
  const names = list.map((a) => {
    const n = a.user?.fullName || a.user?.email || 'Sale';
    return a.role === 'primary' ? `⭐ ${n} (chính)` : `🤝 ${n}`;
  });
  return `${list.length} sale đang/đã chăm KH này:\n${names.join('\n')}`;
}

function displayName(conv: Conversation): string {
  if (conv.threadType === 'group') {
    const groupName = (conv as Conversation & { groupName?: string }).groupName;
    if (isUsableName(groupName)) return groupName!;
    if (isUsableName(conv.contact?.fullName)) return conv.contact!.fullName!;
    return 'Nhóm Zalo';
  }
  // Ưu tiên Tên gợi nhớ Zalo (Friend.aliasInNick) — sync 2-way với Zalo Real.
  // Fallback fullName (tên Zalo gốc). KHÔNG dùng Contact.crmName để UI khớp Zalo Real.
  if (isUsableName(conv.friendship?.aliasInNick)) return conv.friendship!.aliasInNick!;
  if (isUsableName(conv.contact?.fullName)) return conv.contact!.fullName!;
  // B7 — fallback zaloDisplayName của Friend nếu Contact stub
  const friendship = conv.friendship as { zaloDisplayName?: string | null } | undefined;
  if (isUsableName(friendship?.zaloDisplayName)) return friendship!.zaloDisplayName!;
  return 'Unknown';
}
function avatarSrcOf(conv: Conversation): string | null {
  if (conv.threadType === 'group') {
    return (conv as Conversation & { groupAvatarUrl?: string }).groupAvatarUrl || null;
  }
  return conv.contact?.avatarUrl || null;
}

function friendshipStatus(conv: Conversation): string | null {
  // Best-effort heuristic until we expose friendshipKind on conversation payload.
  // Mockup chip values: ✓ Bạn bè / 📤 Đã gửi mời / 💬 Đang nhắn (lạ).
  if (!conv.contact?.zaloUid) return null;
  // Treat groups as no chip
  if (conv.threadType === 'group') return null;
  return null;
}
function friendshipPillClass(_conv: Conversation): string {
  return 'pill-success';
}

// ── Context menu ───────────────────────────────────────────────────────────
function openContextMenu(event: MouseEvent, conv: Conversation) {
  contextMenu.x = event.clientX;
  contextMenu.y = event.clientY;
  contextMenu.convId = conv.id;
  contextMenu.show = true;
}

async function moveConversation(convId: string, targetTab: string) {
  contextMenu.show = false;
  try {
    await api.patch(`/conversations/${convId}/tab`, { tab: targetTab });
    emit('conversation-moved', convId, targetTab);
  } catch (err) {
    console.error('Failed to move conversation:', err);
  }
}

// ── Counts fetch ────────────────────────────────────────────────────────────
async function fetchCounts() {
  try {
    const params: Record<string, string> = { tab: activeTab.value };
    const res = await api.get('/conversations/counts', { params });
    counts.unread = res.data.unread ?? 0;
    counts.unreplied = res.data.unreplied ?? 0;
    counts.total = res.data.total ?? 0;
  } catch {
    /* non-critical */
  }
}

async function fetchAvailableTags() {
  try {
    const res = await api.get('/contacts', { params: { limit: '200', fields: 'tags' } });
    const contacts: Array<{ tags?: string[] }> = Array.isArray(res.data) ? res.data : res.data.contacts || [];
    const tagSet = new Set<string>();
    for (const c of contacts) {
      (c.tags || []).forEach(t => tagSet.add(t));
    }
    // Whitelist: bỏ tag system mặc định (Tag N), prefix auto:, độ dài < 2, hoặc rỗng.
    // Sale chỉ thấy tag có nghĩa.
    const SYSTEM_TAG_RE = /^(Tag\s*\d+|tag\d+)$/i;
    availableTags.value = Array.from(tagSet)
      .filter(t => {
        const trimmed = t.trim();
        if (trimmed.length < 2) return false;
        if (SYSTEM_TAG_RE.test(trimmed)) return false;
        if (trimmed.startsWith('auto:')) return false;
        return true;
      })
      .sort();
  } catch {
    /* non-critical */
  }
}

watch(filters, () => emit('update:filters', buildFilterParams()), { deep: true });
watch(activeTab, () => {
  emit('tab-changed', activeTab.value);
  emit('update:filters', buildFilterParams());
  fetchCounts();
});

onMounted(async () => {
  // Load CrmTag defs (color + managedBy) cho TagIcon render — share cache toàn app
  await Promise.all([fetchCounts(), fetchAvailableTags(), loadTagDefs()]);
});

/* ── Auto-scroll selected row vào viewport ──────────────────────────────────
 * Khi user nav từ ContactsView/GroupsView (router.push /chat/:convId) HOẶC khi
 * BE đẩy conv lên đầu list (do new message), row đang được select phải scroll
 * lên top viewport — sale không phải tự kéo tìm. Cũng cover case row mới
 * append (first-time chat ensure-conversation).
 * Ref map: convId → row HTMLElement (registerRow gọi mỗi lần Vue mount row). */
const scrollContainer = ref<HTMLElement | null>(null);
const rowRefs = new Map<string, HTMLElement>();

function registerRow(id: string, el: HTMLElement | null) {
  if (el) rowRefs.set(id, el);
  else rowRefs.delete(id);
}

function scrollSelectedIntoView() {
  if (!props.selectedId) return;
  const row = rowRefs.get(props.selectedId);
  const container = scrollContainer.value;
  if (!row || !container) return;
  const rowRect = row.getBoundingClientRect();
  const ctnRect = container.getBoundingClientRect();
  if (rowRect.top < ctnRect.top || rowRect.bottom > ctnRect.bottom) {
    row.scrollIntoView({ behavior: 'auto', block: 'nearest' });
  }
}

watch(() => props.selectedId, async () => {
  await nextTick();
  scrollSelectedIntoView();
}, { immediate: true });

// ── Utility functions ───────────────────────────────────────────────────────
// Tone gắn vào preview để CSS render màu theo trạng thái:
//   danger = đỏ  (E17 KH gọi đến nhỡ — sale CHƯA bắt, cần alert)
//   muted  = xám (E18 sale gọi không trả lời / E04 recall — không cấp bách)
//   undefined = normal (text đen mặc định)
interface PreviewResult { text: string; tone?: 'danger' | 'muted' }

function fmtDuration(sec: number): string {
  if (!sec || sec < 0) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function lastMessagePreviewResult(conv: Conversation): PreviewResult {
  const msg = conv.messages?.[0];
  if (!msg) return { text: '' };

  // E04 Tin thu hồi — anh chốt icon 🔂 (proposal 2026-05-21), tone muted
  if (msg.isDeleted) return { text: '🔂 Tin nhắn đã thu hồi', tone: 'muted' };

  const prefix = msg.senderType === 'self' ? 'Bạn: ' : '';
  const isInbound = msg.senderType !== 'self';

  // Parse JSON content (nếu có) để extract title / action
  let parsed: Record<string, unknown> | null = null;
  if (msg.content?.startsWith('{')) {
    try { parsed = JSON.parse(msg.content); } catch { /* not JSON */ }
  }
  const action = typeof parsed?.action === 'string' ? parsed.action : '';
  const titleText = typeof parsed?.title === 'string' ? parsed.title.trim() : '';
  const params = typeof parsed?.params === 'string'
    ? safeParseLocal(parsed.params as string)
    : (parsed?.params as Record<string, unknown> | undefined);

  // E14-E19 Cuộc gọi — tách 6 variant theo isCaller + calltype + misscall
  if (action.includes('calltime') || action.includes('misscall')) {
    const isVideo = params?.calltype === 1;
    const isMissed = action.includes('misscall');
    // isCaller=1 nghĩa là bên SDK đang dùng là CALLER. Map sang sender ZaloCRM:
    // senderType='self' (sale gửi) đồng nghĩa sale là caller.
    const icon = isVideo ? '📹' : '📞';
    const kind = isVideo ? 'video' : 'gọi';

    if (isMissed) {
      // E17/E19: KH gọi đến NHỠ (sale chưa bắt) — DANGER đỏ
      if (isInbound) return { text: `${icon} Cuộc ${kind} nhỡ`, tone: 'danger' };
      // E18: sale gọi đi KH không trả lời — muted xám
      return { text: `${prefix}${icon} KH không trả lời`, tone: 'muted' };
    }

    // E14/E15/E16: đã nghe — bình thường
    const dur = Number(params?.duration ?? 0);
    const durStr = dur > 0 ? ` · ${fmtDuration(dur)}` : '';
    const dirLabel = isInbound ? 'đến' : 'đi';
    return { text: `${prefix}${icon} Cuộc ${kind} ${dirLabel}${durStr}` };
  }

  // E28 Reminder
  if (action === 'msginfo.actionlist' && titleText) {
    return { text: prefix + '⏰ ' + truncate(titleText, 50) };
  }

  // E20 Link share có preview (sau khi P1 reclassify thì content_type='link' rồi)
  // Vẫn để fallback nếu rows mới chưa reclassify.
  if (action === 'recommened.link' || action === 'recommended.link') {
    return { text: prefix + '🔗 ' + truncate(titleText || 'Liên kết', 40) };
  }

  // E22 Gợi ý bạn bè (action recommened.user) — khác E21 show.profile (danh thiếp)
  if (action === 'recommened.user' || action === 'recommended.user') {
    return { text: prefix + '👥 Gợi ý bạn bè' + (titleText ? `: ${truncate(titleText, 30)}` : '') };
  }
  // E21 Danh thiếp profile thực
  if (action === 'show.profile') {
    return { text: prefix + '👤 Danh thiếp' + (titleText ? `: ${truncate(titleText, 30)}` : '') };
  }

  // E25 Bank transfer — extract tên bank từ title hoặc description
  if (msg.contentType === 'bank_transfer' || action === 'zinstant.bankcard') {
    const desc = typeof parsed?.description === 'string' ? parsed.description : '';
    const bankName = titleText || desc.split('\n')[0] || '';
    return {
      text: prefix + '💳 Chuyển khoản' + (bankName ? ` · ${truncate(bankName, 25)}` : ''),
    };
  }

  // Rich content có title → preview bằng title thật, không phải "rich" raw
  if (msg.contentType === 'rich' && titleText) {
    return { text: prefix + (action === 'rtf' ? '✨ ' : '') + truncate(titleText.replace(/\n/g, ' · '), 60) };
  }

  // Per content-type chuẩn
  switch (msg.contentType) {
    case 'image': {
      // E06: nếu có caption (title) → hiện caption, không có → "Hình ảnh"
      if (titleText) return { text: prefix + '📷 ' + truncate(titleText, 40) };
      // E07 Album — sẽ override ở MessageThread khi group; preview vẫn theo msg cuối
      const albumTotal = (msg as { albumTotal?: number | null }).albumTotal;
      if (albumTotal && albumTotal > 1) return { text: prefix + `🖼️ Bộ ảnh (${albumTotal})` };
      return { text: prefix + '📷 Hình ảnh' };
    }
    case 'sticker': return { text: prefix + '🎴 Sticker' };
    case 'video': {
      // E08: kèm duration nếu lấy được từ params
      const vdur = Number(params?.duration ?? 0);
      return { text: prefix + '🎥 Video' + (vdur > 0 ? ` (${fmtDuration(vdur)})` : '') };
    }
    case 'voice':
    case 'audio': {
      // E10/E11: tin thoại có duration
      const adur = Number(params?.duration ?? 0);
      return { text: prefix + '🎤 Tin thoại' + (adur > 0 ? ` (${fmtDuration(adur)})` : '') };
    }
    case 'gif': return { text: prefix + '🎞 GIF' };
    case 'file': return { text: prefix + '📎 ' + (titleText ? truncate(titleText, 40) : 'Tệp đính kèm') };
    case 'link': return { text: prefix + '🔗 ' + (titleText ? truncate(titleText, 40) : 'Liên kết') };
    case 'call': return { text: prefix + '📞 Cuộc gọi' };
    case 'qr_code': return { text: prefix + '🔲 Mã QR' };
    case 'reminder': return { text: prefix + '⏰ ' + (titleText ? truncate(titleText, 40) : 'Nhắc hẹn') };
    case 'poll': {
      // E29-E32 phân biệt 4 action
      const label =
        action === 'create' ? 'Tạo bình chọn'
        : action === 'vote' ? 'Đã bình chọn'
        : action === 'update' ? 'Cập nhật bình chọn'
        : action === 'close' ? 'Đã đóng bình chọn'
        : 'Bình chọn';
      return { text: prefix + '📊 ' + label + (titleText ? `: ${truncate(titleText, 25)}` : '') };
    }
    case 'note': return { text: prefix + '📝 Ghi chú' + (titleText ? `: ${truncate(titleText, 30)}` : '') };
    case 'forwarded': return { text: prefix + '↪️ Chuyển tiếp' + (titleText ? `: ${truncate(titleText, 30)}` : '') };
    case 'location': {
      const desc = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
      const label = titleText || desc || 'Vị trí';
      return { text: prefix + '📍 ' + truncate(label, 50) };
    }
    case 'contact_card': return { text: prefix + (titleText ? truncate(titleText, 40) : '👤 Danh thiếp') };
    case 'rich': return { text: prefix + '✨ Tin có định dạng' };
  }

  // Plain text — E01
  const text = msg.content || '';
  return { text: prefix + truncate(text, 50) };
}

// Wrapper giữ chữ ký cũ cho template (chỉ trả text)
function lastMessagePreview(conv: Conversation): string {
  return lastMessagePreviewResult(conv).text;
}

function lastMessagePreviewTone(conv: Conversation): 'danger' | 'muted' | undefined {
  return lastMessagePreviewResult(conv).tone;
}

function safeParseLocal(s: string): Record<string, unknown> | null {
  try { return JSON.parse(s); } catch { return null; }
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function parseSentiment(conv: Conversation): AiSentiment | null {
  const raw = (conv.contact as { metadata?: { aiSentiment?: AiSentiment | string } } | null)?.metadata?.aiSentiment;
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

// Time format theo spec user (tăng độ rộng tên conv):
//   < 1 phút     → "Vừa xong"
//   < 60 phút    → "Xp"   (vd "5p")
//   < 24h        → "HH:mm"
//   = 1 ngày     → "Hôm qua"
//   < 7 ngày     → "Xd"   (vd "3d")
//   ≥ 7 ngày cùng năm → "DD/MM" (vd "12/05") — không hiện năm
//   năm cũ (≠ năm nay) → "MM/YYYY" (vd "11/2025") — không hiện ngày
function formatTime(dateStr: string | null): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'Vừa xong';
  if (diffMins < 60) return `${diffMins}p`;
  const diffHours = Math.floor(diffMins / 60);
  // 2026-05-21 Phase B-5: hour/date/year đọc theo org TZ thay vì browser local.
  // diffMs/diffMins/diffHours/diffDays là delta UTC → TZ-agnostic, OK giữ nguyên.
  const p = getOrgParts(date);
  const nowP = getOrgParts(now);
  if (!p || !nowP) return '';
  if (diffHours < 24) {
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays}d`;
  // ≥ 7 ngày — phân biệt cùng năm vs năm cũ (so theo org TZ)
  const dd = String(p.day).padStart(2, '0');
  const mm = String(p.month).padStart(2, '0');
  if (p.year === nowP.year) return `${dd}/${mm}`;
  return `${mm}/${p.year}`;
}

// ─── Phase 8 — Engagement pattern badge ──────────────────
function patternIcon(pattern: string | null | undefined): string {
  switch (pattern) {
    case 'hot': return '🔥';
    case 'champion': return '💎';
    case 'stable': return '📈';
    case 'cooling': return '⚠';
    case 'cold': return '😴';
    default: return '';
  }
}

function patternLabel(pattern: string | null | undefined): string {
  const labels: Record<string, string> = {
    hot: 'Đang nóng lên',
    champion: 'Champion',
    stable: 'Ổn định',
    cooling: 'Đang nguội',
    cold: 'Lạnh',
  };
  return pattern ? (labels[pattern] || pattern) : '';
}

function patternMeaning(pattern: string | null | undefined): string {
  const meanings: Record<string, string> = {
    hot: 'Tương tác tăng mạnh tuần này — ưu tiên gọi/chốt sớm.',
    champion: 'Tương tác đều cao 4 tuần qua — KH chất lượng cao.',
    stable: 'Tương tác đều ở mức trung bình — nuôi lâu dài.',
    cooling: 'Tương tác giảm tuần này — cần ping để giữ KH.',
    cold: 'Gần như không tương tác 4 tuần qua — cân nhắc bỏ qua.',
  };
  return pattern ? (meanings[pattern] || '') : '';
}

// ─── Phase 8 — Teleport tooltip for pattern badge ─────────
interface PatternTipData {
  pattern: string;
  score: number | null;
  trend: number | null;
}
const patternTipVisible = ref(false);
const patternTipData = ref<PatternTipData | null>(null);
const patternTipStyle = ref<Record<string, string>>({});
let patternTipTimer: ReturnType<typeof setTimeout> | null = null;

function onPatternHover(event: MouseEvent, contact: any) {
  if (!contact?.engagementPattern) return;
  const target = event.currentTarget as HTMLElement;
  const rect = target.getBoundingClientRect();

  // Position tooltip ABOVE badge, right-aligned to badge right edge.
  // 200px wide tooltip; if too close to viewport edge, flip to below.
  const tipWidth = 220;
  const tipEstimatedHeight = 80;
  const margin = 8;

  let top = rect.top - tipEstimatedHeight - margin;
  // Flip below if too close to top
  if (top < 8) top = rect.bottom + margin;

  let left = rect.right - tipWidth;
  // Don't go off left edge
  if (left < 8) left = 8;
  // Don't go off right edge
  if (left + tipWidth > window.innerWidth - 8) {
    left = window.innerWidth - tipWidth - 8;
  }

  patternTipStyle.value = {
    top: `${top}px`,
    left: `${left}px`,
    width: `${tipWidth}px`,
  };
  patternTipData.value = {
    pattern: contact.engagementPattern,
    score: contact.engagementScore ?? null,
    trend: contact.engagementTrend ?? null,
  };

  // Slight delay to avoid flashing on quick mouseovers when scrolling list
  if (patternTipTimer) clearTimeout(patternTipTimer);
  patternTipTimer = setTimeout(() => {
    patternTipVisible.value = true;
  }, 180);
}

function onPatternLeave() {
  if (patternTipTimer) {
    clearTimeout(patternTipTimer);
    patternTipTimer = null;
  }
  patternTipVisible.value = false;
}
</script>

<style scoped>
.conv-list {
  background: var(--smax-bg);
  display: flex; flex-direction: column;
  height: 100%; overflow: hidden;
}

.cl-header {
  padding: 11px 13px;
  border-bottom: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
}
.cl-search-row {
  display: flex; gap: 6px; align-items: center;
  position: relative; /* anchor cho NickPickerPopup */
}
.cl-search {
  flex: 1; min-width: 0;
  padding: 9px 11px 9px 36px;
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 9px;
  font-size: 13px;
  background: var(--smax-bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='%235a6478' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E") no-repeat 11px center;
  outline: none;
  font-family: inherit;
}
.cl-search:focus { border-color: var(--smax-primary); }

/* Wedge A 2026-05-28: flash đỏ cam khi sale click "Tin nhắn mới" mà search trống */
.cl-search--flash {
  animation: cl-search-flash 1.1s ease-in-out 1;
}
@keyframes cl-search-flash {
  0%   { border-color: #d97706; box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.55); background-color: #fffaf0; }
  35%  { border-color: #ea580c; box-shadow: 0 0 0 6px rgba(217, 119, 6, 0.18); background-color: #fff5e6; }
  70%  { border-color: #d97706; box-shadow: 0 0 0 0 rgba(217, 119, 6, 0.0); background-color: #fffaf0; }
  100% { border-color: var(--smax-grey-200); box-shadow: none; background-color: var(--smax-bg); }
}

.cl-new-msg-caret {
  font-size: 11px;
  margin-left: 2px;
  line-height: 1;
}
.cl-new-msg {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 8px 10px;
  border: 1.5px solid var(--smax-primary);
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  border-radius: 9px;
  font-size: 12px; font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  flex-shrink: 0;
}
.cl-new-msg:hover {
  background: var(--smax-primary);
  color: white;
}

.cl-label-bar {
  display: flex; gap: 4px; margin-top: 7px;
  overflow-x: auto;
  padding-bottom: 3px;
  align-items: center;
}
.cl-label-bar::-webkit-scrollbar { height: 4px; }
/* Chip tag CRM — dùng --tag-color từ tagColor() lookup (sync system color).
   Text + border ăn theo --tag-color, active state fill background. */
.cl-label-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px;
  border-radius: 11px;
  font-size: 11px; font-weight: 500;
  border: 1px solid var(--tag-color, #D1D5DB);
  color: var(--tag-color, #4B5563);
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
  background: var(--smax-bg);
  transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}
.cl-label-chip:hover {
  background: color-mix(in srgb, var(--tag-color, #6B7280) 12%, transparent);
}
.cl-label-chip.active {
  background: var(--tag-color, #6B7280);
  color: white;
  border-color: var(--tag-color, #6B7280);
  font-weight: 600;
}
/* Nút × clear tag filter — to hơn + có border để dễ click */
.clear-tags {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  background: #FEF2F2;
  border: 1px solid #FCA5A5;
  color: #DC2626;
  cursor: pointer;
  font-size: 15px;
  font-weight: 700;
  line-height: 1;
  padding: 0;
  border-radius: 11px;
  margin-left: 4px;
  transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}
.clear-tags:hover {
  background: #FEE2E2;
  border-color: #F87171;
  color: #B91C1C;
}
.clear-tags:active {
  background: #FECACA;
}

.cl-tabs {
  display: flex; gap: 3px;
  margin-top: 7px;
  border-bottom: 1px solid var(--smax-grey-200);
  margin-left: -13px; margin-right: -13px;
  padding: 0 13px;
}
.cl-tab {
  background: transparent; border: none;
  padding: 7px 11px;
  cursor: pointer;
  font-size: 12px; font-weight: 500;
  color: var(--smax-grey-700);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: inline-flex; align-items: center; gap: 5px;
  font-family: inherit;
}
.cl-tab.active {
  color: var(--smax-primary);
  border-bottom-color: var(--smax-primary);
}
.cl-tab-count {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  padding: 1px 6px; border-radius: 9px;
  font-size: 10px;
}
.cl-tab.active .cl-tab-count {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
}

.conv-scroll { flex: 1; overflow-y: auto; }
.conv-list-inner { display: flex; flex-direction: column; }
/* Reorder animation Phase A v2 (2026-05-21) — rút 0.25s → 0.15s cho feel snappier.
   Enter/leave vẫn none vì conv mới (filter match) ko cần animate fade-in. */
.conv-list-move { transition: transform 0.15s ease; }
.conv-list-leave-active { transition: none; }
.conv-list-enter-active { transition: none; }
.loading {
  padding: 20px; text-align: center;
  color: var(--smax-grey-700); font-size: 12px; font-style: italic;
}

.conv-item {
  padding: 11px 13px;
  display: flex; gap: 11px;
  align-items: flex-start;
  cursor: pointer;
  border-bottom: 1px solid var(--smax-grey-100);
  position: relative;
  user-select: none;
  /* Cố định chiều cao mỗi item — name + preview + tag row reserved */
  min-height: 78px;
  box-sizing: border-box;
}
/* Avatar dịch xuống nhẹ để canh giữa với name + preview (bỏ qua tag row) */
.conv-item :deep(.smax-av) { margin-top: 2px; flex-shrink: 0; }

/* Wrapper để position mini avatar nick Zalo overlay góc dưới-trái */
.ci-avatar-wrap {
  position: relative;
  flex-shrink: 0;
  margin-top: 2px;
}

/* M55 2026-05-30 — Cùng chăm badge góc trên-phải avatar KH */
.ci-cung-cham-badge {
  position: absolute;
  top: -4px;
  right: -6px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 9px;
  border: 1.5px solid #fff;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
  white-space: nowrap;
  cursor: help;
  z-index: 2;
  line-height: 1.2;
}
.ci-nick-mini {
  position: absolute;
  bottom: -2px;
  left: -2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 2px solid #fff;
  background: var(--smax-grey-100, #f3f4f6);
  object-fit: cover;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  z-index: 1;
}
.ci-nick-mini--initial {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #2962ff, #6366f1);
}
.conv-item.active .ci-nick-mini { border-color: var(--smax-primary-soft, #e3f2fd); }
.conv-item:hover { background: var(--smax-grey-50); }
.conv-item.unread .ci-name { font-weight: 700; }
/* Active: nền xanh nhạt đồng nhất + bo góc + viền xanh nhẹ */
.conv-item.active,
.conv-item.is-group.active {
  background: var(--smax-primary-soft) !important;
  border-radius: 12px;
  margin: 2px 6px;
  border-bottom-color: transparent !important;
  box-shadow: inset 0 0 0 1.5px #64b5f6 !important;
}
.conv-item.active:hover,
.conv-item.is-group.active:hover {
  background: var(--smax-primary-soft) !important;
}

/* M53 2026-05-30: Virtual conversation — nền cam nhạt + chip 🔒 */
.conv-item.is-virtual {
  background: #fff7ed;
  border-left: 3px solid #fb923c;
  padding-left: calc(var(--ci-padding-x, 9px) - 3px);
}
.conv-item.is-virtual:hover { background: #ffedd5; }
.conv-item.is-virtual.active {
  background: #ffedd5 !important;
  box-shadow: inset 0 0 0 1.5px #f97316 !important;
}
.virtual-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: #ffedd5;
  color: #c2410c;
  font-size: 10px;
  padding: 0 5px;
  border-radius: 8px;
  font-weight: 700;
  margin-right: 4px;
  line-height: 16px;
  height: 16px;
}

/* Unread count badge — pill xám mờ dưới timestamp */
.ci-meta-right {
  display: flex; flex-direction: column;
  align-items: flex-end; gap: 4px;
  flex-shrink: 0;
}
.ci-unread-count {
  min-width: 20px; height: 18px;
  padding: 0 6px;
  background: #b8bfc9;
  color: white;
  font-size: 10px; font-weight: 700;
  border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center;
  line-height: 1;
}

/* Phase 8 — Engagement pattern badge */
.engagement-badge {
  font-size: 14px;
  line-height: 1;
  width: 22px; height: 22px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 50%;
  cursor: help;
  position: relative;
  /* Re-enable pointer events (parent .ci-meta-right có pointer-events:none để
     click vùng meta vẫn bubble lên conv-item). Badge cần nhận hover cho tooltip. */
  pointer-events: auto;
}
.engagement-badge.pattern-hot { background: #FEF2F2; }
.engagement-badge.pattern-champion { background: #FFFBEB; }
.engagement-badge.pattern-stable { background: #EFF6FF; }
.engagement-badge.pattern-cooling { background: #FFF7ED; }
.engagement-badge.pattern-cold { background: #F4F4F7; }

/* Teleport tooltip lives in body — use :global to escape scoped CSS */

.ci-avatar {
  width: 41px; height: 41px;
  border-radius: 50%;
  background: linear-gradient(135deg, #90caf9, #1976d2);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 600; font-size: 14px;
  flex-shrink: 0; position: relative;
}
.ci-avatar.is-group {
  background: linear-gradient(135deg, #ff7043, #d84315);
}
.platform-mark {
  position: absolute; bottom: -2px; right: -2px;
  width: 15px; height: 15px;
  background: #0068ff; border-radius: 50%;
  border: 2px solid var(--smax-bg);
  color: white; font-size: 9px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}

.ci-body {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
  position: relative;
}
.ci-name-row {
  display: flex; align-items: center;
  height: 20px;
  /* Giảm 50% padding-right (64px → 38px) để tăng width tên KH.
     Time format ngắn: "DD/MM" (5 ký tự) hoặc "MM/YYYY" (7 ký tự) ~28px. */
  padding-right: 38px;
}
.ci-name {
  font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 4px;
  min-width: 0; flex: 1;
  line-height: 20px;
}
.ci-name > * { flex-shrink: 0; }
.ci-name :first-child + * { /* tên thật sự — cho phép shrink */
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.group-icon { font-size: 11px; }
/* Meta-right float ra góc phải, không nằm trong flex flow → badge không phá height */
.ci-meta-right {
  position: absolute; top: 0; right: 0;
  display: flex; flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  pointer-events: none;
}
.ci-time {
  font-size: 11px; color: var(--smax-grey-700);
  line-height: 1;
}
.ci-preview {
  font-size: 12px; color: var(--smax-grey-700);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 2px;
  height: 16px; line-height: 16px;
  padding-right: 30px; /* chừa chỗ cho unread badge float trên */
}
/* Tone preview cho cuộc gọi & recall (proposal E04, E17, E18) */
.ci-preview.tone-danger {
  color: #dc2626; /* đỏ — KH gọi đến NHỠ chưa bắt, cần alert */
  font-weight: 600;
}
.ci-preview.tone-muted {
  color: var(--smax-grey-500); /* xám — sale gọi ko trả lời / tin recall */
  font-style: italic;
}
/* Tag row luôn reserve khoảng nhỏ — kể cả khi không có tag */
.ci-tag-row {
  display: flex; gap: 4px; margin-top: 3px; align-items: center;
  flex-wrap: nowrap; overflow: hidden;
  height: 16px;
}
.tag-mini {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  flex-shrink: 0;
  max-width: 100px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  border: 1px solid;
}
/* Monochromatic chip — bg/border/text derive từ --tag-color via color-mix.
 * Zalo-managed: icon + clean name. CRM: chỉ name. */
.tag-mini.tag-zalo {
  --tag-color: #0068FF;
  background: color-mix(in srgb, var(--tag-color) 12%, white);
  border-color: color-mix(in srgb, var(--tag-color) 70%, white);
  color: color-mix(in srgb, var(--tag-color) 75%, black);
}
/* KHÔNG có "Zalo" text badge trong conv list — .ci-tag-row có overflow:hidden +
 * height:16px sẽ clip badge. Icon brand Zalo đứng trước tên đã đủ phân biệt. */
.tag-mini.tag-crm {
  --tag-color: #546E7A;
  background: color-mix(in srgb, var(--tag-color) 10%, white);
  border-color: color-mix(in srgb, var(--tag-color) 60%, white);
  color: color-mix(in srgb, var(--tag-color) 80%, black);
}
/* Overflow "+N" chip — hover/click hiện popup các tag còn lại */
.tag-overflow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 16px;
  padding: 0 6px;
  border-radius: 4px;
  background: var(--smax-grey-200, #ebedf0);
  color: var(--smax-grey-700, #4a5468);
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s;
}
.tag-overflow:hover {
  background: var(--smax-primary, #2962ff);
  color: #fff;
}
.tag-overflow-popup {
  background: #fff;
  padding: 8px 10px;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  max-width: 280px;
}
.tag-popup-pill {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 10px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid;
}
.tag-popup-pill.tag-zalo {
  --tag-color: #0068FF;
  background: color-mix(in srgb, var(--tag-color) 12%, white);
  border-color: color-mix(in srgb, var(--tag-color) 70%, white);
  color: color-mix(in srgb, var(--tag-color) 75%, black);
  position: relative;
  margin-right: 5px;
}
.tag-popup-pill.tag-zalo::before {
  content: 'Zalo';
  position: absolute;
  top: -6px;
  right: -3px;
  background: #0068FF;
  color: white;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: 0.02em;
  padding: 1px 4px;
  border-radius: 99px;
  line-height: 1;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.tag-popup-pill.tag-crm {
  --tag-color: #546E7A;
  background: color-mix(in srgb, var(--tag-color) 10%, white);
  border-color: color-mix(in srgb, var(--tag-color) 60%, white);
  color: color-mix(in srgb, var(--tag-color) 80%, black);
}
.status-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px; border-radius: 9px;
  font-size: 10px; font-weight: 500;
}
.pill-success { background: rgba(0,200,83,0.12); color: #00897b; }
.pill-warning { background: rgba(255,145,0,0.12); color: #ef6c00; }
.pill-info    { background: rgba(33,150,243,0.12); color: #1565c0; }

.sentiment {
  position: absolute;
  top: 11px; right: 28px;
}

.empty-state {
  text-align: center; padding: 40px 13px;
  color: var(--smax-grey-700); font-size: 12px;
}
</style>

<!-- Unscoped style cho teleport tooltip (đặt body, không reach được scoped CSS) -->
<style>
.engagement-pattern-tip-portal {
  position: fixed;
  background: #1F2D3D;
  color: white;
  padding: 9px 11px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.5;
  text-align: left;
  z-index: 9999;
  pointer-events: none;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22), 0 0 0 1px rgba(255,255,255,0.04);
  display: flex;
  flex-direction: column;
  gap: 3px;
  letter-spacing: -0.005em;
  font-family: 'Inter', -apple-system, 'Segoe UI', sans-serif;
  animation: ept-fade 0.15s ease;
}
@keyframes ept-fade {
  from { opacity: 0; transform: translateY(-3px); }
  to { opacity: 1; transform: translateY(0); }
}
.engagement-pattern-tip-portal .ept-title {
  font-size: 12px;
  font-weight: 700;
  color: white;
}
.engagement-pattern-tip-portal .ept-meaning {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.86);
  line-height: 1.45;
}
.engagement-pattern-tip-portal .ept-detail {
  font-size: 10px;
  color: #FBBF24;
  font-weight: 600;
  margin-top: 2px;
}
</style>
