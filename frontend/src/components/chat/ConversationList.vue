<template>
  <div class="conv-list">
    <!-- ════════ Header: search + label chip + tabs ════════ -->
    <div class="cl-header">
      <div class="cl-search-row">
        <input
          class="cl-search"
          name="conv-list-search"
          autocomplete="off"
          :value="search"
          placeholder="Tìm theo tên, SĐT, nội dung tin nhắn…"
          @input="onSearchInput"
        />
        <button class="cl-new-msg" title="Bắt đầu cuộc trò chuyện mới" @click="newMsgOpen = true">
          <v-icon size="18">mdi-message-plus</v-icon>
          <span>Tin nhắn mới</span>
        </button>
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

      <TransitionGroup name="conv-list" tag="div" class="conv-list-inner">
      <div
        v-for="conv in conversations"
        :key="conv.id"
        :ref="(el) => registerRow(conv.id, el as HTMLElement | null)"
        class="conv-item"
        :class="{
          active: conv.id === selectedId,
          unread: conv.unreadCount > 0 && conv.id !== selectedId,
          'is-group': conv.threadType === 'group',
        }"
        @click="$emit('select', conv.id)"
        @contextmenu.prevent="openContextMenu($event, conv)"
      >
        <Avatar
          :src="avatarSrcOf(conv)"
          :name="displayName(conv)"
          :size="41"
          :is-group="conv.threadType === 'group'"
          :platform="conv.threadType === 'user' ? 'zalo' : null"
          :gradient-seed="conv.id"
        />


        <div class="ci-body">
          <div class="ci-name-row">
            <div class="ci-name">
              <span v-if="conv.threadType === 'group'" class="group-icon">👥</span>
              {{ displayName(conv) }}
            </div>
            <div class="ci-meta-right">
              <div class="ci-time">{{ formatTime(conv.lastMessageAt) }}</div>
              <div
                v-if="conv.unreadCount > 0 && conv.id !== selectedId"
                class="ci-unread-count"
              >{{ conv.unreadCount > 5 ? '5+' : conv.unreadCount }}</div>
            </div>
          </div>

          <div class="ci-preview">{{ lastMessagePreview(conv) }}</div>

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
              <TagIcon v-if="isZaloManaged(tag)" :size="11" />{{ cleanTagName(tag) }}
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
                  <TagIcon v-if="isZaloManaged(tag)" :size="11" />{{ cleanTagName(tag) }}
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

    <!-- Compose new message dialog -->
    <NewMessageDialog
      v-model="newMsgOpen"
      :accounts="composeAccounts"
      :default-account-id="composeDefaultAccountId"
      @opened="onComposeOpened"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted, computed, nextTick } from 'vue';
import type { Conversation, AiSentiment } from '@/composables/use-chat';
import { api } from '@/api/index';
import AiSentimentBadge from '@/components/ai/ai-sentiment-badge.vue';
import Avatar from '@/components/ui/Avatar.vue';
import NewMessageDialog from '@/components/chat/NewMessageDialog.vue';
import TagIcon from '@/components/icons/TagIcon.vue';
import { loadTagDefs, isZaloManaged, cleanTagName, tagColor } from '@/composables/use-crm-tag-defs';

const props = defineProps<{
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  search: string;
  accounts?: { id: string; displayName: string | null }[];
  selectedAccountIds?: string[];
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
const newMsgOpen = ref(false);
const composeAccounts = computed(() => props.accounts || []);
const composeDefaultAccountId = computed<string | null>(() => {
  const ids = props.selectedAccountIds || [];
  if (ids.length === 1) return ids[0];
  if (composeAccounts.value.length === 1) return composeAccounts.value[0].id;
  return null;
});
function onComposeOpened(conversationId: string) {
  emit('compose-opened', conversationId);
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
function displayName(conv: Conversation): string {
  if (conv.threadType === 'group') {
    return (conv as Conversation & { groupName?: string }).groupName
      || conv.contact?.fullName
      || 'Nhóm Zalo';
  }
  // Ưu tiên Tên gợi nhớ Zalo (Friend.aliasInNick) — sync 2-way với Zalo Real.
  // Fallback fullName (tên Zalo gốc). KHÔNG dùng Contact.crmName để UI khớp Zalo Real.
  return conv.friendship?.aliasInNick || conv.contact?.fullName || 'Unknown';
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
function lastMessagePreview(conv: Conversation): string {
  const msg = conv.messages?.[0];
  if (!msg) return '';
  if (msg.isDeleted) return '(đã thu hồi)';
  const prefix = msg.senderType === 'self' ? 'Bạn: ' : '';

  // Parse JSON content (nếu có) để extract title / action
  let parsed: Record<string, unknown> | null = null;
  if (msg.content?.startsWith('{')) {
    try { parsed = JSON.parse(msg.content); } catch { /* not JSON */ }
  }
  const action = typeof parsed?.action === 'string' ? parsed.action : '';
  const titleText = typeof parsed?.title === 'string' ? parsed.title.trim() : '';

  // Call message (stored as contact_card + action recommened.calltime/misscall)
  if (action.includes('calltime') || action.includes('misscall')) {
    const params = typeof parsed?.params === 'string'
      ? safeParseLocal(parsed.params as string)
      : (parsed?.params as Record<string, unknown> | undefined);
    const isVideo = params?.calltype === 1;
    const isMissed = action.includes('misscall');
    const icon = isVideo ? '📹' : '📞';
    if (isMissed) return prefix + `${icon} Cuộc gọi nhỡ`;
    const dur = Number(params?.duration ?? 0);
    if (dur > 0) {
      const m = Math.floor(dur / 60);
      const s = dur % 60;
      return prefix + `${icon} Cuộc gọi ${m}:${s.toString().padStart(2, '0')}`;
    }
    return prefix + `${icon} Cuộc gọi`;
  }

  // Reminder (action-based)
  if (action === 'msginfo.actionlist' && titleText) {
    return prefix + '📅 ' + truncate(titleText, 50);
  }

  // Rich content có title → preview bằng title thật, không phải "Tin đặc biệt"
  if (msg.contentType === 'rich' && titleText) {
    return prefix + truncate(titleText.replace(/\n/g, ' · '), 60);
  }

  // Per content-type
  switch (msg.contentType) {
    case 'image': return prefix + '📷 Hình ảnh';
    case 'sticker': return prefix + '🎴 Sticker';
    case 'video': return prefix + '🎥 Video';
    case 'voice': return prefix + '🎤 Voice';
    case 'gif': return prefix + '🎞️ GIF';
    case 'file': return prefix + '📎 ' + (titleText ? truncate(titleText, 40) : 'Tệp đính kèm');
    case 'link': return prefix + '🔗 ' + (titleText ? truncate(titleText, 40) : 'Liên kết');
    case 'bank_transfer': return prefix + '🏦 Tài khoản ngân hàng';
    case 'call': return prefix + '📞 Cuộc gọi';
    case 'qr_code': return prefix + '📱 Mã QR';
    case 'reminder': return prefix + '📅 ' + (titleText ? truncate(titleText, 40) : 'Nhắc hẹn');
    case 'poll': return prefix + '📊 ' + (titleText ? truncate(titleText, 40) : 'Bình chọn');
    case 'note': return prefix + '📝 ' + (titleText ? truncate(titleText, 40) : 'Ghi chú');
    case 'forwarded': return prefix + '↩️ ' + (titleText ? truncate(titleText, 40) : 'Chuyển tiếp');
    case 'location': {
      const desc = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
      const label = titleText || desc || 'Vị trí';
      return prefix + '📍 ' + truncate(label, 50);
    }
    case 'contact_card': return prefix + (titleText ? truncate(titleText, 40) : '👤 Danh thiếp');
    case 'rich': return prefix + '📋 Tin đặc biệt';
  }

  // Plain text
  const text = msg.content || '';
  return prefix + truncate(text, 50);
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
  if (diffHours < 24) {
    const hh = date.getHours().toString().padStart(2, '0');
    const mm = date.getMinutes().toString().padStart(2, '0');
    return `${hh}:${mm}`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Hôm qua';
  if (diffDays < 7) return `${diffDays}d`;
  // ≥ 7 ngày — phân biệt cùng năm vs năm cũ
  const dd = date.getDate().toString().padStart(2, '0');
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  if (date.getFullYear() === now.getFullYear()) {
    // Cùng năm: "DD/MM" (vd "12/05")
    return `${dd}/${mm}`;
  }
  // Khác năm: "MM/YYYY" (vd "11/2025") — bỏ ngày, hiện tháng+năm
  return `${mm}/${date.getFullYear()}`;
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
.conv-list-move { transition: transform 0.25s ease; }
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
.tag-mini.tag-zalo :deep(.tag-icon) {
  color: var(--tag-color);
}
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
}
.tag-popup-pill.tag-zalo :deep(.tag-icon) {
  color: var(--tag-color);
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
