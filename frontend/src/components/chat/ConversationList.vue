<template>
  <div class="conv-list">
    <!-- ════════ Header: search + label chip + tabs ════════ -->
    <div class="cl-header">
      <input
        class="cl-search"
        :value="search"
        placeholder="Tìm theo tên, SĐT, nội dung tin nhắn…"
        @input="onSearchInput"
      />

      <!-- Label chip bar (filter theo tag CRM) -->
      <div v-if="availableTags.length" class="cl-label-bar">
        <span
          v-for="tag in availableTags"
          :key="tag"
          class="cl-label-chip"
          :class="{ active: filters.tags.includes(tag) }"
          :data-color="colorOfTag(tag)"
          @click="toggleTag(tag)"
        >{{ tag }}</span>

        <button
          v-if="filters.tags.length"
          class="clear-tags"
          @click="filters.tags = []"
          title="Xoá lọc tag"
        >×</button>
      </div>

      <!-- Tab Main / Other (giữ business logic) -->
      <div class="cl-tabs">
        <button
          class="cl-tab"
          :class="{ active: activeTab === 'main' }"
          @click="activeTab = 'main'"
        >Chính<span class="cl-tab-count">{{ counts.total - 0 }}</span></button>
        <button
          class="cl-tab"
          :class="{ active: activeTab === 'other' }"
          @click="activeTab = 'other'"
        >Khác</button>
      </div>
    </div>

    <!-- ════════ Conv items ════════ -->
    <div class="conv-scroll">
      <div v-if="loading" class="loading">Đang tải…</div>

      <div
        v-for="conv in conversations"
        :key="conv.id"
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
              <span v-if="conv.unreadCount > 9" class="badge-9plus">9+</span>
            </div>
            <div class="ci-time">{{ formatTime(conv.lastMessageAt) }}</div>
          </div>

          <div class="ci-preview">{{ lastMessagePreview(conv) }}</div>

          <div v-if="conv.contact?.tags?.length || friendshipStatus(conv)" class="ci-tag-row">
            <span
              v-for="tag in (conv.contact?.tags || []).slice(0, 2)"
              :key="tag"
              class="tag-mini"
              :style="`background:${tagBgColor(tag)}`"
            >{{ tag }}</span>
            <span v-if="friendshipStatus(conv)" :class="['status-pill', friendshipPillClass(conv)]">
              {{ friendshipStatus(conv) }}
            </span>
          </div>
        </div>

        <div v-if="conv.unreadCount > 0 && conv.id !== selectedId" class="unread-dot" />
        <AiSentimentBadge v-if="parseSentiment(conv)" :sentiment="parseSentiment(conv)" class="sentiment" />
      </div>

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
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue';
import type { Conversation, AiSentiment } from '@/composables/use-chat';
import { api } from '@/api/index';
import AiSentimentBadge from '@/components/ai/ai-sentiment-badge.vue';
import Avatar from '@/components/ui/Avatar.vue';

const props = defineProps<{
  conversations: Conversation[];
  selectedId: string | null;
  loading: boolean;
  search: string;
}>();

const emit = defineEmits<{
  select: [id: string];
  'update:search': [value: string];
  'filter-account': [accountId: string | null];
  'update:filters': [params: Record<string, string>];
  'tab-changed': [tab: string];
  'conversation-moved': [id: string, tab: string];
}>();

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

function toggleTag(tag: string) {
  if (filters.tags.includes(tag)) {
    filters.tags = filters.tags.filter(t => t !== tag);
  } else {
    filters.tags.push(tag);
  }
}

function buildFilterParams(): Record<string, string> {
  const params: Record<string, string> = { tab: activeTab.value };
  if (filters.tags.length > 0) params.tags = filters.tags.join(',');
  return params;
}

// CRM label color map (từ mockup chat-smax-v3)
const TAG_COLOR_MAP: Record<string, string> = {
  'TTAVIO': 'red',
  'EGD': 'purple',
  'EBV': 'blue',
  'phiền': 'orange',
  'ấm': 'yellow',
  'nóng': 'red',
  'có tương tác': 'green',
  'lạnh': 'blue',
  'đàm phán': 'green',
  'vip': 'orange',
};
function colorOfTag(tag: string): string {
  return TAG_COLOR_MAP[tag] || TAG_COLOR_MAP[tag.toLowerCase()] || 'grey';
}
function tagBgColor(tag: string): string {
  const color = colorOfTag(tag);
  const map: Record<string, string> = {
    red: '#ef5350', purple: '#6f48d9', orange: '#ff9800',
    yellow: '#f9a825', green: '#43a047', blue: '#1976d2', grey: '#9e9e9e',
  };
  return map[color] || '#9e9e9e';
}

// ── Conversation display ───────────────────────────────────────────────────
function displayName(conv: Conversation): string {
  if (conv.threadType === 'group') {
    return (conv as Conversation & { groupName?: string }).groupName
      || conv.contact?.fullName
      || 'Nhóm Zalo';
  }
  return conv.contact?.crmName || conv.contact?.fullName || 'Unknown';
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
  await Promise.all([fetchCounts(), fetchAvailableTags()]);
});

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
    case 'bank_transfer': return prefix + '🏦 Chuyển khoản';
    case 'call': return prefix + '📞 Cuộc gọi';
    case 'qr_code': return prefix + '📱 Mã QR';
    case 'reminder': return prefix + '📅 ' + (titleText ? truncate(titleText, 40) : 'Nhắc hẹn');
    case 'poll': return prefix + '📊 ' + (titleText ? truncate(titleText, 40) : 'Bình chọn');
    case 'note': return prefix + '📝 ' + (titleText ? truncate(titleText, 40) : 'Ghi chú');
    case 'forwarded': return prefix + '↩️ ' + (titleText ? truncate(titleText, 40) : 'Chuyển tiếp');
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
  return date.toLocaleDateString('vi-VN');
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
.cl-search {
  width: 100%;
  padding: 9px 11px 9px 36px;
  border: 1.5px solid var(--smax-grey-200);
  border-radius: 9px;
  font-size: 13px;
  background: var(--smax-bg) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='%235a6478' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='M21 21l-4.35-4.35'/%3E%3C/svg%3E") no-repeat 11px center;
  outline: none;
  font-family: inherit;
}
.cl-search:focus { border-color: var(--smax-primary); }

.cl-label-bar {
  display: flex; gap: 4px; margin-top: 7px;
  overflow-x: auto;
  padding-bottom: 3px;
  align-items: center;
}
.cl-label-bar::-webkit-scrollbar { height: 4px; }
.cl-label-chip {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 3px 9px;
  border-radius: 11px;
  font-size: 11px; font-weight: 500;
  border: 1px solid;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
  background: var(--smax-bg);
}
.cl-label-chip[data-color="red"]    { color: #c62828; border-color: #ef5350; }
.cl-label-chip[data-color="red"].active    { background: #ef5350; color: white; }
.cl-label-chip[data-color="purple"] { color: #6a1b9a; border-color: #ab47bc; }
.cl-label-chip[data-color="purple"].active { background: #6a1b9a; color: white; }
.cl-label-chip[data-color="orange"] { color: #ef6c00; border-color: #ffa726; }
.cl-label-chip[data-color="orange"].active { background: #ff9800; color: white; }
.cl-label-chip[data-color="yellow"] { color: #f57f17; border-color: #fbc02d; }
.cl-label-chip[data-color="yellow"].active { background: #f9a825; color: white; }
.cl-label-chip[data-color="green"]  { color: #2e7d32; border-color: #66bb6a; }
.cl-label-chip[data-color="green"].active  { background: #43a047; color: white; }
.cl-label-chip[data-color="blue"]   { color: #1565c0; border-color: #42a5f5; }
.cl-label-chip[data-color="blue"].active   { background: #1976d2; color: white; }
.cl-label-chip[data-color="grey"]   { color: var(--smax-grey-700); border-color: var(--smax-grey-300); }
.cl-label-chip[data-color="grey"].active   { background: var(--smax-grey-700); color: white; }
.clear-tags {
  background: transparent; border: none;
  color: var(--smax-grey-700);
  cursor: pointer;
  font-size: 16px; line-height: 1; padding: 0 5px;
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
.loading {
  padding: 20px; text-align: center;
  color: var(--smax-grey-700); font-size: 12px; font-style: italic;
}

.conv-item {
  padding: 11px 13px;
  display: flex; gap: 11px;
  cursor: pointer;
  border-bottom: 1px solid var(--smax-grey-100);
  position: relative;
  user-select: none;
}
.conv-item:hover { background: var(--smax-grey-50); }
.conv-item.active { background: var(--smax-primary-soft); }
.conv-item.active::before {
  content: ''; position: absolute;
  left: 0; top: 0; bottom: 0; width: 3px;
  background: var(--smax-primary);
}
.conv-item.unread .ci-name { font-weight: 700; }
.conv-item.is-group { background: var(--smax-group-bg); }
.conv-item.is-group:hover { background: rgba(255,234,227,0.78); }

.unread-dot {
  width: 9px; height: 9px;
  background: var(--smax-primary);
  border-radius: 50%;
  position: absolute; right: 13px; top: 17px;
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

.ci-body { flex: 1; min-width: 0; }
.ci-name-row {
  display: flex; justify-content: space-between; align-items: baseline;
}
.ci-name {
  font-size: 14px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  display: inline-flex; align-items: center; gap: 4px;
}
.group-icon { font-size: 11px; }
.badge-9plus {
  background: var(--smax-error); color: white;
  font-size: 10px; font-weight: 600;
  padding: 0 5px; border-radius: 9px;
  margin-left: 3px;
}
.ci-time {
  font-size: 11px; color: var(--smax-grey-700);
  flex-shrink: 0; margin-left: 4px;
}
.ci-preview {
  font-size: 12px; color: var(--smax-grey-700);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  margin-top: 2px;
}
.ci-tag-row {
  display: flex; gap: 4px; margin-top: 4px; align-items: center;
  flex-wrap: wrap;
}
.tag-mini {
  display: inline-block;
  padding: 1px 7px; border-radius: 4px;
  font-size: 10px; font-weight: 600;
  color: white;
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
