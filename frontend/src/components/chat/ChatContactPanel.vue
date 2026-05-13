<template>
  <aside class="info-panel">
    <!-- ════════ HEADER pinned (avatar + ID + care-status) ════════ -->
    <header class="ip-header">
      <button class="ip-close" title="Đóng" @click="$emit('close')">×</button>
      <Avatar
        :src="props.contact?.avatarUrl"
        :name="headerFullName"
        :size="64"
        :gender="form.gender"
        :gradient-seed="props.contact?.id || headerFullName"
        class="ip-avatar-big"
      />
      <div class="ip-name-line" :title="headerFullName">{{ headerFullName }}</div>
      <div v-if="props.contact?.zaloUid" class="ip-id">UID: {{ props.contact.zaloUid }}</div>
      <div class="ip-care-row">
        <button class="care-status-select" @click="onCycleCareStatus">
          {{ careStatusLabel }} ▾
        </button>
      </div>
    </header>

    <!-- ════════ Tab bar ════════ -->
    <nav class="ip-tabs">
      <button
        class="ip-tab"
        :class="{ active: activeTab === 'profile' }"
        @click="activeTab = 'profile'"
      >
        <span class="ic">👤</span> Hồ sơ
      </button>
      <button
        class="ip-tab"
        :class="{ active: activeTab === 'relations' }"
        @click="activeTab = 'relations'"
      >
        <span class="ic">🔗</span> Quan hệ
        <span v-if="relationBadgeCount" class="tab-badge">{{ relationBadgeCount }}</span>
      </button>
      <button
        class="ip-tab"
        :class="{ active: activeTab === 'activity' }"
        @click="activeTab = 'activity'"
      >
        <span class="ic">⚡</span> Hoạt động
        <span v-if="activityBadgeCount" class="tab-badge">{{ activityBadgeCount }}</span>
      </button>
    </nav>

    <!-- ════════ Tab content (scroll) ════════ -->
    <div class="ip-tab-content">

      <!-- ══════ TAB 1: HỒ SƠ ══════ -->
      <div v-show="activeTab === 'profile'" class="tab-pane">
        <!-- Inline form: 9 rows -->
        <section class="ip-form">
          <div class="ip-form-row">
            <span class="ip-icon">👤</span>
            <span class="ip-label">Tên Zalo</span>
            <input v-model="form.fullName" placeholder="Tên Zalo cung cấp" @blur="saveContact" />
          </div>
          <div class="ip-form-row">
            <span class="ip-icon">✏</span>
            <span class="ip-label">Tên Alias</span>
            <input v-model="form.crmName" placeholder="Sale tự đặt" @blur="saveContact" />
          </div>
          <div class="ip-form-row">
            <span class="ip-icon">📅</span>
            <span class="ip-label">Ngày sinh</span>
            <input type="date" v-model="form.birthDate" @blur="saveContact" />
          </div>
          <div class="ip-form-row">
            <span class="ip-icon">⚧</span>
            <span class="ip-label">Giới tính</span>
            <select v-model="form.gender" @change="saveContact">
              <option :value="null">Không rõ</option>
              <option value="female">Nữ</option>
              <option value="male">Nam</option>
              <option value="other">Khác</option>
            </select>
          </div>

          <div class="ip-form-row">
            <span class="ip-icon">📞</span>
            <span class="ip-label">SĐT</span>
            <div class="phone-cell">
              <input v-model="form.phone" placeholder="SĐT chính" @blur="saveContact" />
              <button
                v-if="form.phone"
                class="show-extra-phones"
                :title="showExtraPhones ? 'Ẩn SĐT phụ' : 'Hiện SĐT phụ'"
                @click="showExtraPhones = !showExtraPhones"
              >
                {{ showExtraPhones ? '−' : '+' }} {{ filledExtras }}/2
              </button>
            </div>
          </div>
          <template v-if="showExtraPhones">
            <div class="ip-form-row sub">
              <span class="ip-label">SĐT 2</span>
              <input v-model="form.phone2" placeholder="SĐT phụ 1" @blur="saveContact" />
            </div>
            <div class="ip-form-row sub">
              <span class="ip-label">SĐT 3</span>
              <input v-model="form.phone3" placeholder="SĐT phụ 2" @blur="saveContact" />
            </div>
          </template>

          <div class="ip-form-row">
            <span class="ip-icon">✉</span>
            <span class="ip-label">Email</span>
            <input v-model="form.email" placeholder="Chưa có email" @blur="saveContact" />
          </div>
          <div class="ip-form-row">
            <span class="ip-icon">📍</span>
            <span class="ip-label">Địa chỉ</span>
            <input v-model="form.addressLine" placeholder="Địa chỉ chi tiết" @blur="saveContact" />
          </div>
          <div class="ip-form-row">
            <span class="ip-icon">💼</span>
            <span class="ip-label">Nghề</span>
            <input v-model="form.occupation" placeholder="Nghề nghiệp" @blur="saveContact" />
          </div>
        </section>

        <v-alert v-if="saveSuccess" type="success" density="compact" class="mx-3 my-2" closable
          @click:close="saveSuccess = false">
          Đã lưu thành công!
        </v-alert>
        <v-alert v-if="saveError" type="error" density="compact" class="mx-3 my-2" closable
          @click:close="saveError = false">
          Lưu thất bại, thử lại.
        </v-alert>

        <!-- Lead score -->
        <section v-if="props.contact" class="ip-section">
          <div class="ip-section-title">
            <span class="accent" style="background: var(--smax-success)" />
            ⭐ Lead score
          </div>
          <div class="metrics-row">
            <span class="metric-num">{{ props.contact.leadScore ?? 0 }}</span>
            <span class="metric-label">điểm</span>
            <span v-if="props.contact.lastActivity" class="metric-aux">
              · cập nhật {{ relativeTime(props.contact.lastActivity) }}
            </span>
          </div>
        </section>

        <!-- Tag CRM hệ thống (cấp KH) -->
        <section class="ip-section">
          <div class="ip-section-title">
            <span class="accent" style="background: var(--smax-info)" />
            🏷 Tag CRM hệ thống
            <span class="scope-tag global">cấp KH</span>
          </div>
          <div class="tag-list">
            <span v-for="tag in form.tags" :key="tag" class="tag-chip">
              {{ tag }}
              <span class="x" @click="removeTag(tag)">×</span>
            </span>
            <input
              v-if="addingTag"
              v-model="newTag"
              ref="newTagInput"
              class="tag-input"
              placeholder="Tag mới…"
              @keydown.enter="confirmAddTag"
              @blur="confirmAddTag"
            />
            <button v-else class="tag-chip add" @click="startAddTag">+ Thêm</button>
          </div>
          <!-- Quick-add suggestions khi chưa có tag nào -->
          <div v-if="!form.tags.length && !addingTag" class="tag-suggestions">
            <span class="suggestion-label">Gắn nhanh:</span>
            <button
              v-for="s in TAG_SUGGESTIONS"
              :key="s"
              class="tag-chip suggestion"
              @click="addSuggestedTag(s)"
            >+ {{ s }}</button>
          </div>
        </section>
      </div>

      <!-- ══════ TAB 2: QUAN HỆ (per-nick) ══════ -->
      <div v-show="activeTab === 'relations'" class="tab-pane">
        <!-- Nick CRM chăm (= KH Con per nick) — real data từ /contacts/:id -->
        <section v-if="relations.friends.length" class="ip-section">
          <div class="ip-section-title">
            <span class="accent" style="background: var(--smax-info)" />
            💬 Nick CRM đang chăm ({{ relations.friends.length }})
            <span class="scope-tag global">per-nick</span>
          </div>
          <div class="friends-list">
            <div v-for="f in relations.friends" :key="f.id" class="friend-card">
              <div class="friend-card-head">
                <Avatar :src="f.zaloAccount.avatarUrl" :name="f.zaloAccount.displayName || 'Nick'" :size="32" :gradient-seed="f.id" platform="zalo" />
                <div class="friend-card-title">
                  <div class="friend-name">{{ f.zaloAccount.displayName || 'Nick' }}</div>
                  <div class="friend-sub">
                    <span v-if="f.zaloAccount.owner" class="sale-name">Sale: {{ f.zaloAccount.owner.fullName }}</span>
                  </div>
                </div>
                <span :class="['status-pill', friendKindClass(f.relationshipKind)]" :title="'Trạng thái kết bạn Zalo'">
                  {{ friendKindLabel(f.relationshipKind) }}
                </span>
                <span
                  v-if="f.hasConversation"
                  class="conv-badge conv-badge--on"
                  title="Đã từng nhắn 1-1 với KH qua nick này"
                >💬</span>
                <span
                  v-else
                  class="conv-badge conv-badge--off"
                  title="Chỉ kết bạn Zalo, chưa có hội thoại 1-1 nào"
                >ø</span>
              </div>
              <!-- KH theo nick này: avatar + tên Zalo riêng cho identity này (KHÔNG dùng tên KH Cha) -->
              <div class="friend-customer-row">
                <Avatar
                  :src="f.zaloAvatarUrl"
                  :name="f.zaloDisplayName || `KH-${f.zaloUidInNick.slice(-4)}`"
                  :size="28"
                  :gradient-seed="f.zaloUidInNick"
                />
                <div class="friend-customer-info">
                  <div class="friend-customer-name">{{ f.zaloDisplayName || `KH-${f.zaloUidInNick.slice(-4)}` }}</div>
                  <code class="uid">UID: {{ f.zaloUidInNick }}</code>
                </div>
              </div>
              <div class="friend-card-row">
                <span class="lbl">Trạng thái KH:</span>
                <span
                  v-if="f.statusRef"
                  class="chip status-edit"
                  :style="{ background: chipBg(f.statusRef.color), color: chipFg(f.statusRef.color) }"
                >{{ f.statusRef.name }}</span>
                <span v-else class="empty">— đặt —</span>
                <span class="lbl ml-auto">Score:</span>
                <strong>{{ f.leadScore ?? 0 }}</strong>
              </div>
              <div class="friend-card-row meta-line">
                <span>📥 <strong>{{ f.totalInbound }}</strong></span>
                <span>📤 <strong>{{ f.totalOutbound }}</strong></span>
                <span v-if="f.becameFriendAt">KB: {{ relativeTime(f.becameFriendAt) }}</span>
                <span v-if="f.lastInboundAt">Last: {{ relativeTime(f.lastInboundAt) }}</span>
              </div>
              <div class="friend-card-actions">
                <button class="btn-sm-danger" :title="'Tách Con này thành KH Cha mới'" @click="onPromoteFriend(f)">
                  ✂ Tách thành KH Cha riêng
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Empty state -->
        <div v-if="!relations.friends.length" class="tab-empty">
          <p>KH này chưa có nick CRM nào chăm.</p>
        </div>

        <!-- Label Zalo native (per-nick) -->
        <section class="ip-section">
          <div class="ip-section-title">
            <span class="accent" style="background: var(--smax-warning)" />
            🔖 Label Zalo (native)
            <span class="scope-tag pernick">per-nick</span>
          </div>
          <TagChipList
            :model-value="zaloLabels"
            chip-class="chip-zalo"
            add-label="Sync từ Zalo"
            :readonly="true"
          />
          <div v-if="!zaloLabels.length" class="empty-section">
            Chưa có label nào — sync từ Zalo SDK
          </div>
        </section>

        <!-- Tag riêng nick × KH (per-pair) -->
        <section class="ip-section">
          <div class="ip-section-title">
            <span class="accent" style="background: var(--smax-warning)" />
            🏷 Tag riêng nick × KH
            <span class="scope-tag pernick">per-nick</span>
          </div>
          <TagChipList
            v-model="perPairTags"
            chip-class="chip-info"
            add-label="Thêm"
            @update:model-value="onPerPairTagsChange"
          />
        </section>

      </div>

      <!-- ══════ TAB 3: HOẠT ĐỘNG (AI + Automation + Lịch hẹn) ══════ -->
      <div v-show="activeTab === 'activity'" class="tab-pane">
        <!-- AI Summary -->
        <section v-if="aiSummary || aiSummaryLoading" class="ip-section">
          <div class="ip-section-title">
            <span class="accent" style="background: #9c27b0" />
            ✨ AI Tóm tắt
            <button class="refresh-mini" :disabled="aiSummaryLoading" @click="$emit('refresh-ai-summary')">↻</button>
          </div>
          <AiSummaryCard :summary="aiSummary" :loading="aiSummaryLoading" />
        </section>

        <!-- AI Sentiment -->
        <section v-if="aiSentiment || aiSentimentLoading" class="ip-section">
          <div class="ip-section-title">
            <span class="accent" style="background: #ec407a" />
            💗 Cảm xúc khách hàng
            <button class="refresh-mini" :disabled="aiSentimentLoading" @click="$emit('refresh-ai-sentiment')">↻</button>
          </div>
          <AiSentimentBadge :sentiment="aiSentiment" />
          <div v-if="aiSentiment?.reason" class="sentiment-reason">{{ aiSentiment.reason }}</div>
        </section>

        <!-- Automation cards (per-nick — backend chưa có schema, ẩn nếu rỗng) -->
        <AutomationCardList :cards="automationCards" @action="onAutomationAction" @attach="onAttachAutomation" />

        <!-- Lịch hẹn -->
        <ChatAppointments
          v-if="props.contactId"
          :contact-id="props.contactId"
          :appointments="contactAppointments"
          @refresh="reloadAppointments"
        />

        <!-- Empty state khi không có gì trong tab -->
        <div v-if="!hasAnyActivity" class="tab-empty">
          <p>Chưa có hoạt động — sau khi có conv tin nhắn, AI sẽ tự tóm tắt + phân tích cảm xúc.</p>
        </div>
      </div>
    </div>

    <!-- ════════ FOOTER ghi chú nhanh (pinned, collapsible) ════════ -->
    <footer class="ip-note-footer" :class="{ expanded: noteExpanded }">
      <button class="note-toggle" @click="noteExpanded = !noteExpanded">
        <span class="note-toggle-icon">📝</span>
        <span class="note-toggle-label">Ghi chú nhanh</span>
        <span v-if="noteDraft && !noteExpanded" class="note-preview">{{ notePreview }}</span>
        <span class="caret">{{ noteExpanded ? '▾' : '▴' }}</span>
      </button>
      <textarea
        v-if="noteExpanded"
        v-model="noteDraft"
        class="note-input"
        placeholder="Ctrl+Enter để lưu, Escape để hủy…"
        rows="3"
        @keydown.ctrl.enter.prevent="saveNote"
        @keydown.meta.enter.prevent="saveNote"
        @keydown.escape="onCancelNote"
        @blur="saveNote"
      />
    </footer>
  </aside>
</template>

<script setup lang="ts">
import { ref, computed, nextTick, watch } from 'vue';
import type { Contact } from '@/composables/use-contacts';
import type { AiSentiment } from '@/composables/use-chat';
import { useChatContactPanel } from '@/composables/use-chat-contact-panel';
import ChatAppointments from './ChatAppointments.vue';
import AiSummaryCard from '@/components/ai/ai-summary-card.vue';
import AiSentimentBadge from '@/components/ai/ai-sentiment-badge.vue';
import AutomationCardList, { type AutomationCard } from './AutomationCardList.vue';
import TagChipList from '@/components/ui/TagChipList.vue';
import Avatar from '@/components/ui/Avatar.vue';
import { useToast } from '@/composables/use-toast';
import { api } from '@/api';

const props = defineProps<{
  contactId: string | null;
  contact: Contact | null;
  // Nick CRM đang xem KH này — dùng để xác định Friend row "active" cho per-pair tag.
  activeZaloAccountId?: string | null;
  aiSummary: string;
  aiSummaryLoading: boolean;
  aiSentiment: AiSentiment | null;
  aiSentimentLoading: boolean;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
  'refresh-ai-summary': [];
  'refresh-ai-sentiment': [];
}>();

const {
  form, saveSuccess, saveError,
  contactAppointments,
  saveContact, reloadAppointments,
} = useChatContactPanel(
  () => props.contactId,
  () => props.contact,
  () => emit('saved'),
);

// ════════ Tab state (persist sang tab khác KH khác) ════════
const activeTab = ref<'profile' | 'relations' | 'activity'>('profile');

// ════════ Relations data (friends per nick = KH Con) — fetch khi đổi contact ═══
interface FriendItem {
  id: string;
  zaloUidInNick: string;
  relationshipKind: string;
  hasConversation: boolean;
  totalInbound: number;
  totalOutbound: number;
  becameFriendAt: string | null;
  lastInboundAt: string | null;
  leadScore: number;
  zaloDisplayName: string | null;
  zaloAvatarUrl: string | null;
  crmTagsPerNick: string[];
  statusRef: { id: string; name: string; order: number; color: string | null } | null;
  zaloAccount: { id: string; displayName: string | null; avatarUrl?: string | null; owner: { id: string; fullName: string } | null };
}
interface RelationsState {
  friends: FriendItem[];
}
const relations = ref<RelationsState>({ friends: [] });

async function fetchRelations(contactId: string) {
  try {
    const res = await api.get<{ friends?: FriendItem[] }>(`/contacts/${contactId}`);
    // Sort: "đang chat" lên đầu — sale chỉ care nick đã thực sự nhắn 1-1.
    const all = res.data.friends || [];
    all.sort((a, b) => {
      if (a.hasConversation !== b.hasConversation) return a.hasConversation ? -1 : 1;
      const at = a.lastInboundAt || '';
      const bt = b.lastInboundAt || '';
      return bt.localeCompare(at);
    });
    relations.value = { friends: all };
  } catch (err) {
    console.error('[ChatContactPanel] fetchRelations error:', err);
    relations.value = { friends: [] };
  }
}

function chipBg(hex: string | null | undefined): string {
  if (!hex) return 'rgba(90,100,120,0.10)';
  const m = hex.match(/^#([0-9a-f]{6})$/i);
  if (!m) return 'rgba(90,100,120,0.10)';
  const n = parseInt(m[1], 16);
  return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},0.15)`;
}
function chipFg(hex: string | null | undefined): string { return hex || 'var(--smax-grey-700)'; }

async function onPromoteFriend(f: FriendItem) {
  const name = prompt(`Tên cho KH Cha mới (Nick "${f.zaloAccount.displayName}" × UID ${f.zaloUidInNick}):`, '');
  if (name === null) return;  // cancelled
  try {
    const res = await api.post<{ newContact: { id: string; fullName: string }; movedConversations: number }>(
      `/friends/${f.id}/promote-to-parent`,
      { fullName: name.trim() || undefined },
    );
    toast.success(`Đã tạo KH Cha mới: ${res.data.newContact.fullName}. ${res.data.movedConversations} conversation đã chuyển.`);
    if (props.contactId) await fetchRelations(props.contactId);
    emit('saved');
  } catch (err) {
    const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error || 'Tách thất bại';
    toast.error(msg);
  }
}

function friendKindLabel(k: string): string {
  if (k === 'friend') return '✓ Đã KB';
  if (k === 'pending_friend') return '… Pending';
  if (k === 'chatting_stranger') return '👥 Lạ';
  if (k === 'ghost') return '🚫 Ngắt';
  return k;
}
function friendKindClass(k: string): string {
  if (k === 'friend') return 'pill-success';
  if (k === 'pending_friend') return 'pill-warning';
  if (k === 'chatting_stranger') return 'pill-info';
  return 'pill-grey';
}

// ════════ Care status (status field — cycle through preset) ════════
const CARE_STATUSES_LOCAL = [
  { value: 'new',          label: '🆕 Mới' },
  { value: 'interested',   label: '💬 Quan tâm' },
  { value: 'caring',       label: '🤝 Chăm sóc' },
  { value: 'negotiating',  label: '⚡ Đàm phán giá' },
  { value: 'hot',          label: '🔥 Nóng' },
  { value: 'cold',         label: '❄ Lạnh' },
  { value: 'won',          label: '✅ Đã chốt' },
];
const careStatusLabel = computed(() => {
  const found = CARE_STATUSES_LOCAL.find(s => s.value === form.status);
  return found?.label || '🆕 Đặt trạng thái';
});
function onCycleCareStatus() {
  const idx = CARE_STATUSES_LOCAL.findIndex(s => s.value === form.status);
  const next = CARE_STATUSES_LOCAL[(idx + 1) % CARE_STATUSES_LOCAL.length];
  form.status = next.value;
  saveContact();
}

// ════════ Header name (Avatar component handle initials + gender + gradient) ════════
const headerFullName = computed(() =>
  props.contact?.crmName || props.contact?.fullName || 'Khách hàng',
);

// ════════ Phones extras ════════
const showExtraPhones = ref(false);
const filledExtras = computed(() => [form.phone2, form.phone3].filter(Boolean).length);

// ════════ Tag list (CRM hệ thống) ════════
const addingTag = ref(false);
const newTag = ref('');
const newTagInput = ref<HTMLInputElement | null>(null);
function startAddTag() {
  addingTag.value = true;
  nextTick(() => newTagInput.value?.focus());
}
function confirmAddTag() {
  const t = newTag.value.trim();
  if (t && !form.tags.includes(t)) {
    form.tags.push(t);
    saveContact();
  }
  newTag.value = '';
  addingTag.value = false;
}
function removeTag(tag: string) {
  form.tags = form.tags.filter(t => t !== tag);
  saveContact();
}

// Tag quick-add suggestions cho contact mới chưa có tag
const TAG_SUGGESTIONS = ['vip', 'quan_tam', 'cần_báo_giá', 'hot_lead', 'lạnh', 'đầu_tư'] as const;
function addSuggestedTag(tag: string) {
  if (!form.tags.includes(tag)) {
    form.tags.push(tag);
    saveContact();
  }
}

// ════════ Automation cards (placeholder — chờ backend) ════════
const automationCards = computed<AutomationCard[]>(() => {
  // Khi backend bổ sung endpoint /contacts/:id/automations sẽ map vào đây.
  return [];
});
function onAutomationAction(_id: string, _kind: string) { /* TODO wire to API */ }
function onAttachAutomation() { toast.warning('Gắn automation: chờ backend schema delta'); }

// MOCK: zaloLabels (per-pair native labels) chưa expose qua API
const zaloLabels = ref<string[]>([]);

// Per-pair CRM tags: tags RIÊNG cho cặp (nick active × KH). KHÁC contact.tags
// (cấp KH chung). Trigger PATCH /friends/:id để persist.
const activeFriend = computed<FriendItem | null>(() => {
  if (!props.activeZaloAccountId) return null;
  return relations.value.friends.find(f => f.zaloAccount.id === props.activeZaloAccountId) || null;
});
const perPairTags = computed<string[]>({
  get: () => activeFriend.value?.crmTagsPerNick || [],
  set: (v) => {
    if (activeFriend.value) activeFriend.value.crmTagsPerNick = v;
  },
});
async function onPerPairTagsChange(tags: string[]) {
  if (!activeFriend.value) {
    toast.warning('Chưa xác định nick CRM nào đang chăm KH này');
    return;
  }
  try {
    await api.patch(`/friends/${activeFriend.value.id}`, { crmTagsPerNick: tags });
  } catch (err) {
    console.error('[ChatContactPanel] save per-pair tags failed:', err);
    toast.error('Lưu tag thất bại');
  }
}

// MOCK: 3 nick khác cũng chăm — chờ /contacts/:id/friendships
interface OtherNick { id: string; short: string; name: string; pillClass: string; pillLabel: string }
const otherNicks = computed<OtherNick[]>(() => [] as OtherNick[]);

// ════════ Tab badges ════════
const relationBadgeCount = computed(() => otherNicks.value.length || 0);
const activityBadgeCount = computed(() => {
  let n = 0;
  if (automationCards.value.length) n += automationCards.value.length;
  if (contactAppointments.value.length) n += contactAppointments.value.length;
  return n || null;
});

const hasAnyActivity = computed(() =>
  !!(props.aiSummary || props.aiSentiment || automationCards.value.length || contactAppointments.value.length),
);

// ════════ Note footer (pinned, collapsible) ════════
const toast = useToast();
const noteExpanded = ref(false);
const noteDraft = ref('');
const lastSavedNote = ref('');
const notePreview = computed(() => {
  const t = noteDraft.value.trim();
  return t.length > 32 ? t.slice(0, 32) + '…' : t;
});

function saveNote() {
  if (noteDraft.value === lastSavedNote.value) return;
  (form as Record<string, unknown>).notes = noteDraft.value;
  saveContact();
  lastSavedNote.value = noteDraft.value;
  toast.success('Đã lưu ghi chú');
}
function onCancelNote() {
  noteDraft.value = lastSavedNote.value;
  noteExpanded.value = false;
}

watch(() => props.contact?.notes, (n) => {
  if (n != null) {
    noteDraft.value = n;
    lastSavedNote.value = n;
  }
}, { immediate: true });

// Khi đổi sang contact mới, reset về tab Hồ sơ + collapse note + refetch relations
watch(() => props.contactId, (id) => {
  activeTab.value = 'profile';
  noteExpanded.value = false;
  if (id) void fetchRelations(id);
  else relations.value = { friends: [] };
}, { immediate: true });

function relativeTime(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  return `${days} ngày trước`;
}
</script>

<style scoped>
.info-panel {
  background: var(--smax-bg);
  border-left: 1px solid var(--smax-grey-200);
  display: flex; flex-direction: column;
  height: 100%; overflow: hidden;
  flex-shrink: 0;
}

/* ════════ Header (pinned) ════════ */
.ip-header {
  padding: 13px 17px 9px;
  text-align: center;
  border-bottom: 1px solid var(--smax-grey-200);
  position: relative;
  flex-shrink: 0;
}
.ip-close {
  position: absolute; top: 7px; right: 9px;
  width: 26px; height: 26px;
  background: transparent; border: none;
  font-size: 20px; cursor: pointer;
  color: var(--smax-grey-700);
  border-radius: 50%;
}
.ip-close:hover { background: var(--smax-grey-100); }

.ip-avatar-big {
  display: block;
  margin: 0 auto;
}

.ip-name-line {
  margin-top: 7px;
  font-size: 14px; font-weight: 600;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  padding: 0 17px;
}
.ip-id {
  font-size: 10.5px;
  color: var(--smax-grey-700);
  margin-top: 3px;
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  word-break: break-all;
  padding: 0 17px;
}
.ip-care-row { margin-top: 7px; }
.care-status-select {
  background: rgba(255,145,0,0.15);
  color: #ef6c00;
  border: 1px solid rgba(255,145,0,0.3);
  padding: 4px 11px;
  border-radius: 13px;
  font-size: 11.5px; font-weight: 500;
  cursor: pointer;
  font-family: inherit;
}
.care-status-select:hover { background: rgba(255,145,0,0.22); }

/* ════════ Tab bar ════════ */
.ip-tabs {
  display: flex;
  border-bottom: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
  flex-shrink: 0;
}
.ip-tab {
  flex: 1;
  background: transparent; border: none;
  padding: 9px 7px;
  cursor: pointer;
  font-size: 12.5px; font-weight: 500;
  color: var(--smax-grey-700);
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  font-family: inherit;
  position: relative;
  transition: color 0.15s;
}
.ip-tab .ic { font-size: 13px; line-height: 1; }
.ip-tab:hover { color: var(--smax-primary); background: var(--smax-grey-100); }
.ip-tab.active {
  color: var(--smax-primary);
  border-bottom-color: var(--smax-primary);
  background: var(--smax-bg);
  font-weight: 600;
}
.tab-badge {
  position: absolute;
  top: 5px; right: 9px;
  background: var(--smax-primary);
  color: white;
  font-size: 10px; font-weight: 700;
  padding: 0 5px;
  border-radius: 8px;
  min-width: 16px;
  line-height: 14px;
  text-align: center;
}

/* ════════ Tab content (scroll) ════════ */
.ip-tab-content {
  flex: 1; min-height: 0;
  overflow-y: auto;
}
.tab-pane {
  display: flex; flex-direction: column;
}
.tab-empty {
  padding: 26px 17px;
  font-size: 12px;
  color: var(--smax-grey-700);
  text-align: center;
  font-style: italic;
}
.tab-empty ul {
  text-align: left;
  padding: 0 0 0 18px;
  margin: 6px auto 0;
  max-width: 250px;
}
.tab-empty li { margin: 4px 0; }
.parent-card { display: flex; align-items: center; gap: 10px; padding: 10px; border: 1px solid var(--smax-grey-200); border-radius: 8px; background: rgba(0,242,255,0.04); }
.parent-info { flex: 1; min-width: 0; }
.parent-name { font-weight: 600; font-size: 13px; }
.parent-meta { display: flex; gap: 8px; align-items: center; font-size: 11px; flex-wrap: wrap; margin-top: 4px; }
.friends-list { display: flex; flex-direction: column; gap: 10px; }
.friend-card { border: 1px solid var(--smax-grey-200); border-radius: 8px; padding: 10px 12px; background: var(--smax-bg); }
.friend-card-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.friend-card-title { flex: 1; min-width: 0; }
.friend-name { font-weight: 600; font-size: 13px; }
.friend-sub { font-size: 11px; color: var(--smax-grey-600); margin-top: 2px; }
.sale-name { font-weight: 500; }
.friend-card-row { display: flex; align-items: center; gap: 6px; font-size: 11.5px; padding: 3px 0; flex-wrap: wrap; }
.friend-card-row .lbl { color: var(--smax-grey-600); }
.friend-card-row .ml-auto { margin-left: auto; }
.friend-card-row.meta-line { padding-top: 6px; border-top: 1px dashed var(--smax-grey-200); margin-top: 4px; color: var(--smax-grey-700); }
.friend-card-row.meta-line strong { color: var(--smax-text); }
.conv-badge {
  font-size: 11px; font-weight: 700;
  padding: 1px 6px; border-radius: 4px;
  margin-left: 4px;
}
.conv-badge--on  { background: rgba(0,200,83,0.15); color: #00897b; }
.conv-badge--off { background: rgba(0,0,0,0.06);    color: #999;    }
.friend-customer-row {
  display: flex; align-items: center; gap: 8px;
  padding: 6px 8px; margin: 4px 0 6px;
  background: var(--smax-grey-50);
  border-radius: 6px;
  border-left: 3px solid var(--smax-primary);
}
.friend-customer-info { flex: 1; min-width: 0; }
.friend-customer-name {
  font-size: 12.5px; font-weight: 600;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.friend-customer-row .uid {
  display: inline-block;
  margin-top: 2px;
}
.friend-card-actions { display: flex; justify-content: flex-end; gap: 6px; padding-top: 8px; border-top: 1px dashed var(--smax-grey-200); margin-top: 6px; }
.btn-sm-danger { padding: 4px 10px; font-size: 11px; border: 1px solid #ffcdd2; color: #c62828; border-radius: 4px; background: rgba(255,82,82,0.05); cursor: pointer; }
.btn-sm-danger:hover { background: rgba(255,82,82,0.15); }
.status-edit { cursor: pointer; padding: 2px 8px; border-radius: 10px; font-size: 11px; }
.status-edit:hover { filter: brightness(1.1); }
.uid { font-family: monospace; font-size: 10.5px; color: var(--smax-grey-700); background: rgba(0,0,0,0.04); padding: 1px 4px; border-radius: 3px; }
.chip-grey { background: rgba(90,100,120,0.10); color: var(--smax-grey-700); padding: 1px 7px; border-radius: 9px; font-size: 10.5px; }
.tab-empty code {
  background: var(--smax-grey-100);
  padding: 0 4px; border-radius: 3px;
  font-size: 10.5px;
}

/* ════════ Inline form ════════ */
.ip-form { padding: 4px 0; border-bottom: 1px solid var(--smax-grey-200); }
.ip-form-row {
  display: grid;
  grid-template-columns: 22px 80px 1fr;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-bottom: 1px solid var(--smax-grey-100);
}
.ip-form-row.sub {
  grid-template-columns: 22px 80px 1fr;
  padding-left: 32px;
}
.ip-form-row:last-child { border-bottom: none; }
.ip-icon { font-size: 14px; opacity: 0.85; text-align: center; }
.ip-label { font-size: 12px; color: var(--smax-grey-700); }
.ip-form-row input,
.ip-form-row select {
  border: none; outline: none;
  font-size: 13px;
  background: transparent;
  width: 100%; min-width: 0;
  padding: 3px 4px;
  border-radius: 4px;
  font-family: inherit;
  color: var(--smax-text);
}
.ip-form-row input:hover,
.ip-form-row select:hover { background: var(--smax-grey-50); }
.ip-form-row input:focus,
.ip-form-row select:focus { background: var(--smax-primary-soft); }
.phone-cell {
  display: flex; align-items: center; gap: 5px;
  width: 100%;
}
.phone-cell input { flex: 1; }
.show-extra-phones {
  background: var(--smax-grey-100);
  border: 1px solid var(--smax-grey-300);
  border-radius: 9px;
  padding: 1px 7px;
  font-size: 11px;
  color: var(--smax-grey-700);
  cursor: pointer;
  flex-shrink: 0;
}
.show-extra-phones:hover { background: var(--smax-primary-soft); color: var(--smax-primary); }

/* ════════ Section ════════ */
.ip-section {
  padding: 11px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
}
.ip-section:last-child { border-bottom: none; }
.ip-section-title {
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600;
  color: var(--smax-text);
  margin-bottom: 7px;
}
.ip-section-title .accent {
  width: 3px; height: 14px;
  border-radius: 2px;
  background: var(--smax-grey-300);
}
.scope-tag {
  font-size: 10px; padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500; letter-spacing: 0.3px;
}
.scope-tag.global {
  background: rgba(33,150,243,0.12);
  color: #1565c0;
}
.scope-tag.pernick {
  background: rgba(255,145,0,0.18);
  color: #ef6c00;
}
.refresh-mini {
  margin-left: auto;
  width: 22px; height: 22px;
  border-radius: 50%;
  border: 1px solid var(--smax-grey-300);
  background: var(--smax-bg);
  cursor: pointer;
  font-size: 12px; color: var(--smax-grey-700);
}
.refresh-mini:hover:not(:disabled) { background: var(--smax-grey-50); color: var(--smax-primary); }
.refresh-mini:disabled { opacity: 0.5; cursor: not-allowed; }
.sentiment-reason {
  font-size: 12px;
  color: var(--smax-grey-700);
  margin-top: 7px;
  padding: 7px 9px;
  background: var(--smax-grey-50);
  border-radius: 5px;
  font-style: italic;
}

.tag-list {
  display: flex; flex-wrap: wrap; gap: 4px;
}
.tag-chip {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
  padding: 3px 7px;
  border-radius: 7px;
  font-size: 11px;
  display: inline-flex; align-items: center; gap: 4px;
  cursor: default;
}
.tag-chip .x {
  cursor: pointer;
  opacity: 0.55;
  font-weight: 700;
}
.tag-chip .x:hover { opacity: 1; color: var(--smax-error); }
.tag-chip.add {
  background: transparent;
  border: 1px dashed var(--smax-grey-300);
  cursor: pointer;
  color: var(--smax-grey-700);
}
.tag-chip.add:hover { background: var(--smax-grey-50); border-color: var(--smax-primary); color: var(--smax-primary); }
.tag-input {
  border: 1px solid var(--smax-primary);
  outline: none;
  padding: 2px 7px;
  border-radius: 7px;
  font-size: 11px;
  width: 110px;
  font-family: inherit;
}
.tag-suggestions {
  display: flex; flex-wrap: wrap; gap: 4px;
  align-items: center;
  margin-top: 6px;
  padding-top: 6px;
  border-top: 1px dashed var(--smax-grey-200);
}
.suggestion-label {
  font-size: 10.5px;
  color: var(--smax-grey-700);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  font-weight: 600;
}
.tag-chip.suggestion {
  background: transparent;
  border: 1px dashed var(--smax-primary);
  color: var(--smax-primary);
  font-size: 10.5px;
  padding: 2px 7px;
  cursor: pointer;
  border-radius: 7px;
  font-family: inherit;
}
.tag-chip.suggestion:hover {
  background: var(--smax-primary-soft);
}

.metrics-row {
  display: flex; align-items: baseline; gap: 5px;
  font-size: 13px;
}
.metric-num { font-size: 24px; font-weight: 700; color: var(--smax-success); }
.metric-label { color: var(--smax-grey-700); }
.metric-aux  { color: var(--smax-grey-700); font-size: 12px; }

/* ════════ Per-nick state section ════════ */
.kv-list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; line-height: 1.55; }
.kv-row { display: flex; align-items: baseline; gap: 5px; flex-wrap: wrap; }
.kv-row .k { color: var(--smax-grey-700); min-width: 100px; }
.kv-row .v { color: var(--smax-text); font-weight: 500; }
.kv-row .muted { color: var(--smax-grey-300); font-size: 10.5px; font-style: italic; }
.kv-row code {
  font-family: ui-monospace, "Cascadia Code", Menlo, monospace;
  background: var(--smax-grey-100);
  padding: 0 4px; border-radius: 3px;
  font-size: 10px;
}
.status-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px; border-radius: 9px;
  font-size: 10px; font-weight: 500;
}
.pill-success { background: rgba(0,200,83,0.12); color: #00897b; }
.pill-warning { background: rgba(255,145,0,0.12); color: #ef6c00; }
.pill-info    { background: rgba(33,150,243,0.12); color: #1565c0; }

.empty-section {
  font-size: 11px; color: var(--smax-grey-700);
  font-style: italic;
  padding: 4px 0;
}

/* ════════ Other nicks list ════════ */
.nick-rows { display: flex; flex-direction: column; gap: 5px; }
.nick-row {
  display: flex; align-items: center; gap: 7px;
  padding: 5px 0;
}
.ni-name { flex: 1; font-size: 12px; color: var(--smax-text); }

/* ════════ Footer Ghi chú pinned ════════ */
.ip-note-footer {
  flex-shrink: 0;
  border-top: 1px solid var(--smax-grey-200);
  background: var(--smax-grey-50);
}
.note-toggle {
  width: 100%;
  background: transparent; border: none;
  padding: 9px 13px;
  display: flex; align-items: center; gap: 7px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--smax-grey-700);
  text-align: left;
}
.note-toggle:hover { background: var(--smax-grey-100); }
.note-toggle-icon { font-size: 14px; }
.note-toggle-label { font-weight: 600; color: var(--smax-text); flex-shrink: 0; }
.note-preview {
  flex: 1; min-width: 0;
  color: var(--smax-grey-700);
  font-style: italic;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.note-toggle .caret { color: var(--smax-grey-700); font-size: 10px; }

.ip-note-footer.expanded .note-toggle {
  background: var(--smax-bg);
  border-bottom: 1px solid var(--smax-grey-200);
}
.note-input {
  width: 100%;
  min-height: 70px;
  max-height: 200px;
  border: none;
  border-top: 1px solid var(--smax-grey-100);
  padding: 9px 13px;
  font-size: 12.5px;
  font-family: inherit;
  resize: vertical;
  outline: none;
  color: var(--smax-text);
  background: var(--smax-bg);
  display: block;
}
.note-input:focus {
  box-shadow: inset 0 0 0 2px rgba(33,150,243,0.10);
}
</style>
