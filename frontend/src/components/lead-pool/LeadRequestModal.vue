<!--
  LeadRequestModal — Compact v3 2026-05-28.
  Tối ưu HD 1280×720 không scroll. 4 buttons compact + popup chọn nick scale-ready.
-->
<template>
  <div v-if="lead" class="lrm-overlay" @click.self="onClose">
    <div class="lrm-modal" role="dialog" aria-labelledby="lrm-title">
      <!-- Header 44px -->
      <header class="lrm-header" :class="sourceClass">
        <span class="lrm-source-pill">{{ sourceIcon }} {{ sourceLabel }}</span>
        <div class="lrm-title">
          🎯 Lead mới
          <span class="lrm-priority">Score {{ lead.priorityScore }}</span>
        </div>
        <button class="lrm-close" @click="onClose" aria-label="Đóng">✕</button>
      </header>

      <!-- Toast info/error/success -->
      <div v-if="actionInfo" class="lrm-toast lrm-toast-info">ℹ {{ actionInfo }}</div>
      <div v-if="actionError" class="lrm-toast lrm-toast-error">⚠ {{ actionError }}</div>
      <div v-if="enrichSuccess" class="lrm-toast lrm-toast-success">
        ✅ Tìm thấy Zalo! Đã tự động bổ sung avatar + chuyển trạng thái <strong>Có Zalo</strong> qua nick "{{ enrichSuccess.nickUsed }}".
      </div>

      <!-- Body -->
      <div class="lrm-body">
        <!-- Profile + 4 stat chips cùng row -->
        <div class="lrm-profile-row">
          <div class="lrm-avatar" :style="avatarStyle">
            <img
              v-if="lead.contact.avatarUrl && !avatarBroken"
              :src="lead.contact.avatarUrl"
              :alt="displayName"
              referrerpolicy="no-referrer"
              @error="avatarBroken = true"
            />
            <span v-else>{{ initials }}</span>
          </div>
          <div class="lrm-profile-info">
            <div class="lrm-name">{{ displayName }}</div>
            <div class="lrm-meta-inline">
              <span v-if="lead.contact.phone" class="lrm-phone">📱 {{ formatPhone(lead.contact.phone) }}</span>
              <!-- Per-nick semantic 2026-05-28: tag theo góc nhìn sale current -->
              <span v-if="lead.hasZaloFromMyNick" class="lrm-tag lrm-tag-green" :title="'Đã có UID qua nick ' + (lead.autoLookup?.nickUsed || 'của bạn')">🟢 Sẵn sàng chat</span>
              <span v-else-if="lead.contact.hasZalo === true" class="lrm-tag lrm-tag-red lrm-tag-shake" title="KH có Zalo nhưng từ nick sale khác — bấm nút 'Tìm Zalo qua SĐT' để chat được">🔴 Tìm Zalo qua SĐT</span>
              <span v-else-if="lead.contact.hasZalo === false" class="lrm-tag lrm-tag-grey">⚪ Chưa có Zalo</span>
              <span v-else class="lrm-tag lrm-tag-grey">❔ Chưa rõ Zalo</span>
            </div>
            <div v-if="locationLine || lead.contact.email" class="lrm-meta-sub">
              <span v-if="locationLine">📍 {{ locationLine }}</span>
              <span v-if="lead.contact.email">✉ {{ lead.contact.email }}</span>
            </div>
          </div>
          <div class="lrm-stats-chips">
            <div class="lrm-stat-chip">
              <span class="lrm-stat-chip-label">Bỏ rơi</span>
              <span class="lrm-stat-chip-value">{{ lead.insights.daysIdle != null ? lead.insights.daysIdle + 'd' : '—' }}</span>
            </div>
            <div class="lrm-stat-chip">
              <span class="lrm-stat-chip-label">Tin nhắn</span>
              <span class="lrm-stat-chip-value">{{ lead.insights.totalMessages }}</span>
            </div>
            <div class="lrm-stat-chip">
              <span class="lrm-stat-chip-label">Kết bạn</span>
              <span class="lrm-stat-chip-value">{{ lead.insights.acceptedFriendCount }}</span>
            </div>
            <div class="lrm-stat-chip" :class="{ warn: lead.insights.noShowCount > 0 }">
              <span class="lrm-stat-chip-label">Lỡ hẹn</span>
              <span class="lrm-stat-chip-value">{{ lead.insights.noShowCount }}</span>
            </div>
          </div>
        </div>

        <!-- Hành trình inline meta -->
        <div class="lrm-journey">
          <span class="lrm-journey-label">Hành trình:</span>
          <span class="lrm-journey-item">{{ sourceIcon }} {{ sourceLabel }}</span>
          <span v-if="statusName" class="lrm-journey-status" :style="statusChipStyle">{{ statusName }}</span>
          <span v-if="lead.previousAssignee" class="lrm-journey-item">
            👤 Sale cũ: {{ lead.previousAssignee.fullName }}<small v-if="!lead.previousAssignee.isActive" class="lrm-muted">(vô hiệu)</small>
          </span>
          <span class="lrm-journey-item">🕐 {{ formatDate(lead.contact.lastActivity) }}</span>
        </div>

        <!-- Notes gần đây (collapsible) -->
        <details v-if="lead.recentNotes.length > 0" class="lrm-notes-coll">
          <summary class="lrm-notes-coll-summary">💬 {{ lead.recentNotes.length }} note gần đây (click để xem)</summary>
          <ul class="lrm-notes">
            <li v-for="n in lead.recentNotes.slice(0, 3)" :key="n.id" class="lrm-note">
              <div class="lrm-note-body">{{ n.body }}</div>
              <div class="lrm-note-meta">— {{ n.author?.fullName || 'N/A' }} · {{ formatDate(n.createdAt) }}</div>
            </li>
          </ul>
        </details>

        <!-- Zalo profile card (sau khi tìm thấy Zalo) -->
        <div v-if="zaloProfile" class="lrm-zalo-profile">
          <div class="lrm-zp-header">
            <span class="lrm-zp-title">💚 Hồ sơ Zalo của KH</span>
            <span v-if="zaloProfile.accountStatus === 1" class="lrm-zp-badge lrm-zp-badge-ok">✓ Bình thường</span>
            <span v-else-if="zaloProfile.accountStatus != null" class="lrm-zp-badge lrm-zp-badge-warn">⚠ Status {{ zaloProfile.accountStatus }}</span>
            <span v-if="zaloProfile.isFriend" class="lrm-zp-badge lrm-zp-badge-friend">👥 Đã kết bạn</span>
            <span v-if="zaloProfile.bizPkg" class="lrm-zp-badge lrm-zp-badge-biz">🏢 Business</span>
          </div>
          <div class="lrm-zp-grid">
            <div v-if="zaloProfile.zaloName" class="lrm-zp-item">
              <span class="lrm-zp-label">Tên Zalo</span>
              <span class="lrm-zp-value">{{ zaloProfile.zaloName }}</span>
            </div>
            <div v-if="zaloProfile.username" class="lrm-zp-item">
              <span class="lrm-zp-label">Username</span>
              <span class="lrm-zp-value">@{{ zaloProfile.username }}</span>
            </div>
            <div v-if="genderLabel" class="lrm-zp-item">
              <span class="lrm-zp-label">Giới tính</span>
              <span class="lrm-zp-value">{{ genderLabel }}</span>
            </div>
            <div v-if="dobLabel" class="lrm-zp-item">
              <span class="lrm-zp-label">Sinh nhật</span>
              <span class="lrm-zp-value">{{ dobLabel }}</span>
            </div>
            <div v-if="zaloProfile.uid" class="lrm-zp-item">
              <span class="lrm-zp-label">UID</span>
              <span class="lrm-zp-value lrm-zp-mono">{{ zaloProfile.uid }}</span>
            </div>
          </div>
          <div v-if="zaloProfile.bio" class="lrm-zp-bio">
            <span class="lrm-zp-label">Trạng thái</span>
            <span class="lrm-zp-bio-text">"{{ zaloProfile.bio }}"</span>
          </div>
        </div>

        <!-- Suggestion 1 dòng + copy -->
        <div v-if="primarySuggestion" class="lrm-suggestion">
          <span class="lrm-suggestion-icon">💡</span>
          <span class="lrm-suggestion-text">{{ primarySuggestion }}</span>
          <button class="lrm-suggestion-copy" :class="{ 'is-copied': copiedFlag }" @click="copySuggestion">
            <span>{{ copiedFlag ? '✓' : '📋' }}</span>
            <span>{{ copiedFlag ? 'Đã copy' : 'Copy' }}</span>
          </button>
        </div>

        <!-- 4 action buttons compact grid 4 cột -->
        <div class="lrm-actions-wrap">
          <div class="lrm-actions-title">⚡ Bắt đầu liên lạc</div>
          <div class="lrm-actions-grid">
            <!-- Nút 1: Tìm Zalo qua SĐT -->
            <button
              class="lrm-action lrm-action-find"
              :class="{ active: activePopup === 'find', disabled: lead.hasZaloFromMyNick }"
              :disabled="lead.hasZaloFromMyNick || lookupZaloDead"
              @click="togglePopup('find')"
            >
              <span class="lrm-action-icon">🔍</span>
              <span class="lrm-action-text">
                <span class="lrm-action-title">{{ lead.hasZaloFromMyNick ? '✅ Đã có Zalo (nick bạn)' : 'Tìm Zalo qua SĐT' }}</span>
                <span class="lrm-action-sub">{{ lead.hasZaloFromMyNick ? 'Không cần tìm' : (lookupZaloDead ? '❌ Không tìm ra' : 'Chọn nick lookup') }}</span>
              </span>
            </button>

            <!-- Nút 2: Mở chat Zalo -->
            <button
              class="lrm-action lrm-action-zalo"
              :class="{ active: activePopup === 'chat' }"
              :disabled="lookupZaloDead"
              @click="togglePopup('chat')"
            >
              <span class="lrm-action-icon">💬</span>
              <span class="lrm-action-text">
                <span class="lrm-action-title">Mở chat Zalo</span>
                <span class="lrm-action-sub">{{ lookupZaloDead ? '❌ Không tìm ra' : 'Paste sẵn câu chào' }}</span>
              </span>
            </button>

            <a
              v-if="lead.contact.phone"
              :href="`tel:${lead.contact.phone}`"
              class="lrm-action lrm-action-call"
              :class="{ pulse: shouldPulseCall }"
            >
              <span class="lrm-action-icon">📞</span>
              <span class="lrm-action-text">
                <span class="lrm-action-title">{{ shouldPulseCall ? '📞 Gọi ngay!' : 'Gọi điện' }}</span>
                <span class="lrm-action-sub">{{ formatPhone(lead.contact.phone) }}</span>
              </span>
            </a>
            <div v-else class="lrm-action lrm-action-call" style="opacity:.4;cursor:not-allowed;">
              <span class="lrm-action-icon">📞</span>
              <span class="lrm-action-text">
                <span class="lrm-action-title">Không có SĐT</span>
                <span class="lrm-action-sub">Bổ sung trước</span>
              </span>
            </div>

            <button class="lrm-action lrm-action-detail" @click="onOpenContactPage">
              <span class="lrm-action-icon">📄</span>
              <span class="lrm-action-text">
                <span class="lrm-action-title">Mở trang KH</span>
                <span class="lrm-action-sub">Timeline đầy đủ</span>
              </span>
            </button>
          </div>

          <!-- Popup chọn nick — xổ LÊN, scale-ready 50×100 -->
          <div
            v-if="activePopup && nicksData"
            class="lrm-nick-popup"
            :style="{ left: popupLeft + 'px' }"
            @click.stop
          >
            <div class="lrm-nick-popup-header">
              <span class="lrm-nick-popup-title">
                🔍 {{ activePopup === 'chat' ? 'Mở chat bằng nick nào?' : 'Tìm Zalo bằng nick nào?' }}
              </span>
              <input
                v-if="totalNickCount > 5"
                v-model="nickSearch"
                type="text"
                placeholder="Tìm nick…"
                class="lrm-nick-search"
                @click.stop
              />
            </div>

            <div v-if="totalNickCount === 0" class="lrm-nick-empty">
              ⚠ Không có nick Zalo nào online. Vào "Quản lý nick" kết nối nick trước.
            </div>

            <!-- "Gần đây" — chỉ hiện khi không search + có recent -->
            <div v-if="!nickSearch && recentNicks.length > 0" class="lrm-nick-section">
              <span class="lrm-nick-row-label">🕒 Gần đây dùng</span>
              <div class="lrm-nick-row">
                <button
                  v-for="n in recentNicks"
                  :key="'recent-' + n.id"
                  class="lrm-nick-pill priority"
                  :class="{ busy: pendingNickId === n.id }"
                  :disabled="pendingNickId !== null"
                  @click="onPickNick(n.id)"
                  :title="n.ownerName ? 'Nick của ' + n.ownerName : ''"
                >
                  <span class="lrm-nick-pill-avatar" :style="nickAvatarStyle(n.displayName || '?')">
                    <img v-if="n.avatarUrl" :src="n.avatarUrl" :alt="n.displayName || ''" referrerpolicy="no-referrer" />
                    <span v-else>{{ nickInitials(n.displayName) }}</span>
                  </span>
                  <span class="lrm-nick-pill-name">{{ n.displayName || '(không tên)' }}</span>
                </button>
              </div>
            </div>

            <div v-if="filteredOwnNicks.length > 0" class="lrm-nick-section">
              <span class="lrm-nick-row-label">
                {{ nicksData.scope === 'sale' ? '👤 Nick của bạn' : '🛡 Nick của bạn (' + (nicksData.scope === 'admin' ? 'admin' : 'quản lý') + ' — ưu tiên)' }}
                <span v-if="filteredOwnNicks.length > 5" class="lrm-nick-row-count">({{ filteredOwnNicks.length }})</span>
              </span>
              <div class="lrm-nick-row">
                <button
                  v-for="n in expandedOwn ? filteredOwnNicks : filteredOwnNicks.slice(0, 5)"
                  :key="n.id"
                  class="lrm-nick-pill"
                  :class="{ priority: nicksData.scope !== 'sale', busy: pendingNickId === n.id }"
                  :disabled="pendingNickId !== null"
                  @click="onPickNick(n.id)"
                >
                  <span class="lrm-nick-pill-avatar" :style="nickAvatarStyle(n.displayName || '?')">
                    <img v-if="n.avatarUrl" :src="n.avatarUrl" :alt="n.displayName || ''" referrerpolicy="no-referrer" />
                    <span v-else>{{ nickInitials(n.displayName) }}</span>
                  </span>
                  <span class="lrm-nick-pill-name">{{ n.displayName || '(không tên)' }}</span>
                </button>
                <button
                  v-if="!expandedOwn && filteredOwnNicks.length > 5"
                  class="lrm-nick-more"
                  @click="expandedOwn = true"
                >+ Xem thêm {{ filteredOwnNicks.length - 5 }}</button>
              </div>
            </div>

            <div v-if="filteredTeamNicks.length > 0" class="lrm-nick-section">
              <span class="lrm-nick-row-label">
                👤 Nick của sale dưới quyền
                <span class="lrm-nick-row-count">({{ filteredTeamNicks.length }})</span>
              </span>
              <div class="lrm-nick-row">
                <button
                  v-for="n in expandedTeam ? filteredTeamNicks : filteredTeamNicks.slice(0, 5)"
                  :key="n.id"
                  class="lrm-nick-pill"
                  :class="{ busy: pendingNickId === n.id }"
                  :disabled="pendingNickId !== null"
                  @click="onPickNick(n.id)"
                  :title="n.ownerName ? 'Nick của ' + n.ownerName : ''"
                >
                  <span class="lrm-nick-pill-avatar" :style="nickAvatarStyle(n.displayName || '?')">
                    <img v-if="n.avatarUrl" :src="n.avatarUrl" :alt="n.displayName || ''" referrerpolicy="no-referrer" />
                    <span v-else>{{ nickInitials(n.displayName) }}</span>
                  </span>
                  <span class="lrm-nick-pill-name">{{ n.displayName || '(không tên)' }}</span>
                </button>
                <button
                  v-if="!expandedTeam && filteredTeamNicks.length > 5"
                  class="lrm-nick-more"
                  @click="expandedTeam = true"
                >+ Xem thêm {{ filteredTeamNicks.length - 5 }}</button>
              </div>
            </div>

            <div v-if="nickSearch && filteredOwnNicks.length === 0 && filteredTeamNicks.length === 0" class="lrm-nick-empty">
              Không có nick nào khớp "{{ nickSearch }}"
            </div>
          </div>
        </div>
      </div>

      <!-- Note inline footer -->
      <footer class="lrm-note-footer">
        <div class="lrm-note-header">
          <span class="lrm-note-label">📝 Ghi chú lần liên lạc đầu</span>
          <span class="lrm-note-required">* bắt buộc trước khi nhận lead mới</span>
        </div>
        <textarea
          v-model="noteText"
          class="lrm-note-textarea"
          :placeholder="`Note tối thiểu ${noteMinLength} ký tự. Vd: Đã gọi điện, KH bận, hẹn lại 16h; KH đang xem dự án A...`"
        ></textarea>
        <div class="lrm-note-actions">
          <span class="lrm-note-counter" :class="{ ok: noteText.length >= noteMinLength }">
            {{ noteText.length }} / {{ noteMinLength }}
          </span>
          <button class="lrm-btn-ghost" :disabled="returning" @click="onReturn">↩ Trả lại pool</button>
          <button class="lrm-btn-primary" :disabled="submitting || noteText.length < noteMinLength" @click="onSubmitNote">
            <span v-if="submitting">Đang lưu...</span>
            <span v-else>💾 Lưu note + Bắt đầu chăm</span>
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { useLeadPool, type LeadPayload } from '@/composables/use-lead-pool';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ lead: LeadPayload | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'note-submitted'): void;
  (e: 'returned'): void;
}>();

const router = useRouter();
const authStore = useAuthStore();
const { submitNote, returnLead, eligibility } = useLeadPool();

const noteText = ref('');
const submitting = ref(false);
const returning = ref(false);
const actionError = ref('');
const actionInfo = ref('');
const enrichSuccess = ref<{ nickUsed: string; zaloName: string | null } | null>(null);
const copiedFlag = ref(false);
const lookupZaloDead = ref(false);
const shouldPulseCall = ref(false);
const avatarBroken = ref(false);
const zaloProfile = ref<{
  uid?: string; zaloName?: string | null; username?: string | null;
  avatar?: string | null; cover?: string | null;
  gender?: number | null; dob?: string | number | null;
  bio?: string | null; bizPkg?: any; accountStatus?: number | null;
  isFriend?: boolean | null;
} | null>(null);

type PopupKind = 'chat' | 'find' | null;
const activePopup = ref<PopupKind>(null);
const nicksData = ref<{ scope: 'sale' | 'leader' | 'admin'; ownNicks: any[]; teamNicks: any[] } | null>(null);
const pendingNickId = ref<string | null>(null);
const popupLeft = ref(0);

// Scale-ready 50×100: search + expand + recent picks via localStorage
const nickSearch = ref('');
const expandedOwn = ref(false);
const expandedTeam = ref(false);
const RECENT_NICKS_KEY = 'leadpool.recentNicks';
const RECENT_NICKS_MAX = 5;

function getRecentNickIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_NICKS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, RECENT_NICKS_MAX) : [];
  } catch { return []; }
}
function pushRecentNick(nickId: string) {
  try {
    const prev = getRecentNickIds().filter((id) => id !== nickId);
    const next = [nickId, ...prev].slice(0, RECENT_NICKS_MAX);
    localStorage.setItem(RECENT_NICKS_KEY, JSON.stringify(next));
  } catch { /* localStorage có thể block */ }
}

const totalNickCount = computed(() => {
  const own = nicksData.value?.ownNicks?.length ?? 0;
  const team = nicksData.value?.teamNicks?.length ?? 0;
  return own + team;
});

function nickMatchesSearch(n: { displayName: string | null; ownerName?: string | null }): boolean {
  if (!nickSearch.value.trim()) return true;
  const q = nickSearch.value.toLowerCase().trim();
  return (n.displayName || '').toLowerCase().includes(q) || (n.ownerName || '').toLowerCase().includes(q);
}

const filteredOwnNicks = computed(() => (nicksData.value?.ownNicks ?? []).filter(nickMatchesSearch));
const filteredTeamNicks = computed(() => (nicksData.value?.teamNicks ?? []).filter(nickMatchesSearch));

const recentNicks = computed(() => {
  if (!nicksData.value) return [];
  const recentIds = getRecentNickIds();
  if (recentIds.length === 0) return [];
  const all = [...nicksData.value.ownNicks, ...nicksData.value.teamNicks];
  return recentIds
    .map((id) => all.find((n) => n.id === id))
    .filter((n): n is any => n != null)
    .slice(0, RECENT_NICKS_MAX);
});

const noteMinLength = computed(() => eligibility.value?.config.noteMinLength ?? 20);

const displayName = computed(() => {
  const c = props.lead?.contact;
  return c?.crmName || c?.fullName || c?.phone || 'KH chưa đặt tên';
});

const initials = computed(() => {
  const n = displayName.value;
  const parts = n.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
});

function colorFromString(s: string) {
  const palette = ['linear-gradient(135deg,#3b82f6,#1e40af)','linear-gradient(135deg,#10b981,#059669)','linear-gradient(135deg,#f59e0b,#ef4444)','linear-gradient(135deg,#8b5cf6,#6d28d9)','linear-gradient(135deg,#ec4899,#be185d)','linear-gradient(135deg,#06b6d4,#0891b2)'];
  const h = s.split('').reduce((a: number, c: string) => a + c.charCodeAt(0), 0);
  return palette[h % palette.length];
}
const avatarStyle = computed(() => ({ background: colorFromString(displayName.value) }));
function nickAvatarStyle(name: string) { return { background: colorFromString(name) }; }
function nickInitials(name: string | null) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const locationLine = computed(() => {
  const c = props.lead?.contact;
  if (!c) return '';
  return [c.ward, c.district, c.province].filter(Boolean).join(', ');
});

const sourceLabel = computed(() => ({ forgotten: 'Khách bỏ quên', customer_list: 'Tệp khách hàng', external_sync: 'Sync CRM khác' } as Record<string, string>)[props.lead?.source ?? ''] || 'Lead');
const sourceIcon = computed(() => ({ forgotten: '💤', customer_list: '📂', external_sync: '🔄' } as Record<string, string>)[props.lead?.source ?? ''] || '🎯');
const sourceClass = computed(() => `lrm-source-${props.lead?.source}`);

const statusName = computed(() => {
  const s = (props.lead?.contact as any)?.status;
  if (typeof s === 'string') return s;
  return s?.name ?? null;
});

const statusChipStyle = computed(() => {
  const color = (props.lead?.contact?.status as any)?.color;
  if (color) return { background: color + '22', color, border: `1px solid ${color}55` };
  return {};
});

// VN convention: tên riêng = từ cuối, proper case.
function vietnameseFirstName(fullName: string | null | undefined): string {
  if (!fullName) return '';
  const trimmed = fullName.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const parts = trimmed.split(' ');
  const last = parts[parts.length - 1];
  return last.charAt(0).toUpperCase() + last.slice(1).toLowerCase();
}

const saleFirstName = computed(() => vietnameseFirstName(authStore.user?.fullName ?? null));
const contactFirstName = computed(() => {
  const c = props.lead?.contact;
  return vietnameseFirstName(c?.crmName ?? c?.fullName ?? null);
});

/**
 * Personalize suggestion with gender title:
 *   gender 0 (Nam) → "Anh Thành"
 *   gender 1 (Nữ) → "Chị Thắm"
 *   unknown → "anh/chị Thành"
 * Sale prefix: "em Thành"
 */
const primarySuggestion = computed(() => {
  const contactName = contactFirstName.value;
  const sale = saleFirstName.value;
  const gender = zaloProfile.value?.gender;
  const saleIntro = sale ? `em ${sale}` : 'em';
  let greeting: string;
  if (!contactName) greeting = 'Chào anh/chị';
  else if (gender === 0) greeting = `Chào Anh ${contactName}`;
  else if (gender === 1) greeting = `Chào Chị ${contactName}`;
  else greeting = `Chào anh/chị ${contactName}`;
  if (!contactName && !sale) return props.lead?.suggestedOpenings?.[0] ?? '';
  const pronoun = gender === 0 ? 'anh' : gender === 1 ? 'chị' : 'anh/chị';
  return `${greeting}, ${saleIntro} là sale chăm sóc tiếp tài khoản của ${pronoun}. Em đọc lại lịch sử thấy mình đã quan tâm dự án trước đây, không biết hiện tại ${pronoun} còn nhu cầu không ạ?`;
});

const genderLabel = computed(() => {
  const g = zaloProfile.value?.gender;
  if (g === 0) return 'Nam';
  if (g === 1) return 'Nữ';
  if (g === 2) return 'Khác';
  return '';
});

const dobLabel = computed(() => {
  const d = zaloProfile.value?.dob;
  if (!d) return '';
  if (typeof d === 'number' && d > 0) {
    const date = new Date(d > 1e12 ? d : d * 1000);
    return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
  }
  return String(d);
});

function formatPhone(p: string | null | undefined) {
  if (!p) return '';
  const digits = String(p).replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) {
    return '0' + digits.slice(2, 5) + ' ' + digits.slice(5, 8) + ' ' + digits.slice(8);
  }
  if (digits.length === 10) return digits.slice(0, 4) + ' ' + digits.slice(4, 7) + ' ' + digits.slice(7);
  return p;
}

function formatDate(iso: string | Date | null | undefined) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

async function copySuggestion() {
  if (!primarySuggestion.value) return;
  try {
    await navigator.clipboard.writeText(primarySuggestion.value);
    copiedFlag.value = true;
    setTimeout(() => { copiedFlag.value = false; }, 1800);
  } catch { /* silent */ }
}

function onOpenContactPage() {
  if (props.lead?.contact.id) router.push(`/contacts/${props.lead.contact.id}/activity`);
}

async function fetchNicksIfNeeded() {
  if (nicksData.value) return;
  try {
    const { data } = await api.get('/lead-pool/available-nicks');
    nicksData.value = data;
  } catch (err: any) {
    actionError.value = err?.response?.data?.error || 'Không tải được danh sách nick';
  }
}

function togglePopup(kind: 'chat' | 'find') {
  if (activePopup.value === kind) { activePopup.value = null; return; }
  // Sau reorder 2026-05-27: find = button 1 (left=0), chat = button 2 (left=220)
  popupLeft.value = kind === 'find' ? 0 : 220;
  activePopup.value = kind;
  nickSearch.value = '';
  expandedOwn.value = false;
  expandedTeam.value = false;
  void fetchNicksIfNeeded();
}

function clearMessages() {
  actionError.value = '';
  actionInfo.value = '';
  enrichSuccess.value = null;
}

async function onPickNick(zaloAccountId: string) {
  const kind = activePopup.value;
  if (!kind || !props.lead) return;
  pendingNickId.value = zaloAccountId;
  clearMessages();
  // Track recent pick — lên top "Gần đây" lần sau
  pushRecentNick(zaloAccountId);
  try {
    if (kind === 'chat') {
      const { data } = await api.post(`/lead-pool/${props.lead.leadRequestId}/open-chat`, { zaloAccountId });
      if (data?.canChat && data.conversationId) {
        // Auto-paste câu gợi ý vào input chat
        const draft = primarySuggestion.value;
        router.push({
          path: `/chat/${data.conversationId}`,
          query: draft ? { draft: draft.slice(0, 600) } : undefined,
        });
        emit('close');
      } else if (data?.canChat) {
        actionInfo.value = `Tìm thấy KH qua nick "${data.nickDisplayName}". Mở trang KH...`;
        setTimeout(() => {
          if (props.lead?.contact.id) router.push(`/contacts/${props.lead.contact.id}/activity`);
          emit('close');
        }, 700);
      } else if (data?.reason === 'no_zalo') {
        lookupZaloDead.value = true;
        shouldPulseCall.value = true;
        actionError.value = data.message || 'KH không bật tìm kiếm/kết bạn Zalo qua SĐT. Hãy thử bằng Sale Phone nhé!';
        activePopup.value = null;
      } else {
        actionError.value = data?.message || 'Không mở được chat';
      }
    } else {
      const { data } = await api.post(`/lead-pool/${props.lead.leadRequestId}/find-zalo`, { zaloAccountId });
      if (data?.found) {
        enrichSuccess.value = { nickUsed: data.nickUsed, zaloName: data.zaloName };
        if (props.lead.contact) {
          (props.lead.contact as any).hasZalo = true;
          if (data.avatar) {
            (props.lead.contact as any).avatarUrl = data.avatar;
            avatarBroken.value = false;
          }
        }
        // 2026-05-28: BE đã upsert Friend per-nick → tag chuyển sang "Sẵn sàng chat"
        (props.lead as any).hasZaloFromMyNick = true;
        (props.lead as any).autoLookup = {
          found: true, uid: data.uid, nickUsed: data.nickUsed,
          zaloProfile: data.zaloProfile ?? null,
        };
        if (data.zaloProfile) zaloProfile.value = data.zaloProfile;
        activePopup.value = null;
      } else {
        lookupZaloDead.value = true;
        shouldPulseCall.value = true;
        actionError.value = 'KH không bật tìm kiếm/kết bạn Zalo qua SĐT. Hãy thử bằng Sale Phone nhé!';
        activePopup.value = null;
      }
      if (data?.duplicateWarning) actionInfo.value = data.duplicateWarning;
    }
  } catch (err: any) {
    actionError.value = err?.response?.data?.error || 'Thao tác thất bại';
  } finally {
    pendingNickId.value = null;
  }
}

function onClose() { emit('close'); }

async function onSubmitNote() {
  if (!props.lead) return;
  if (noteText.value.length < noteMinLength.value) return;
  submitting.value = true;
  actionError.value = '';
  const ok = await submitNote(props.lead.leadRequestId, noteText.value);
  submitting.value = false;
  if (ok) emit('note-submitted');
  else actionError.value = 'Lưu note thất bại';
}

async function onReturn() {
  if (!props.lead) return;
  if (!confirm('Trả lại lead này về pool?')) return;
  returning.value = true;
  const ok = await returnLead(props.lead.leadRequestId);
  returning.value = false;
  if (ok) emit('returned');
  else actionError.value = 'Trả lead thất bại';
}

function onDocumentClick(e: MouseEvent) {
  if (!activePopup.value) return;
  const target = e.target as HTMLElement;
  if (target.closest('.lrm-nick-popup') || target.closest('.lrm-action-zalo') || target.closest('.lrm-action-find')) return;
  activePopup.value = null;
}

// Pre-populate zaloProfile từ auto-lookup BE (2026-05-28) — câu chào personalize ngay
// khi modal mở, không cần sale bấm "Tìm Zalo qua SĐT".
onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  if (props.lead?.autoLookup?.zaloProfile) {
    zaloProfile.value = props.lead.autoLookup.zaloProfile;
  }
});
onBeforeUnmount(() => { document.removeEventListener('click', onDocumentClick); });
</script>

<style scoped>
.lrm-overlay { position: fixed; inset: 0; z-index: 1000; background: rgba(15, 23, 42, 0.55); display: flex; align-items: center; justify-content: center; padding: 16px; backdrop-filter: blur(2px); }
.lrm-modal { background: white; border-radius: 12px; width: 880px; max-width: 100%; max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 20px 60px rgba(15, 23, 42, 0.3); overflow: hidden; }

.lrm-header { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: linear-gradient(135deg, #EEF0FF 0%, #DBEAFE 100%); border-bottom: 1px solid #C7D2FE; height: 44px; flex-shrink: 0; }
.lrm-source-forgotten { background: linear-gradient(135deg, #FEF3C7, #FDE68A); border-color: #FCD34D; }
.lrm-source-customer_list { background: linear-gradient(135deg, #DCFCE7, #BBF7D0); border-color: #86EFAC; }
.lrm-source-pill { display: inline-flex; align-items: center; gap: 4px; background: rgba(255, 255, 255, 0.85); padding: 3px 9px; border-radius: 9999px; font-size: 11px; font-weight: 700; color: #166534; flex-shrink: 0; }
.lrm-title { flex: 1; font-size: 14px; font-weight: 700; color: #0F172A; display: flex; align-items: center; gap: 8px; }
.lrm-priority { background: #5E6AD2; color: white; padding: 2px 9px; border-radius: 9999px; font-size: 11px; font-weight: 700; }
.lrm-close { background: transparent; border: none; cursor: pointer; font-size: 16px; color: #475569; padding: 4px 8px; border-radius: 6px; line-height: 1; font-family: inherit; }
.lrm-close:hover { background: rgba(0,0,0,0.08); color: #DC2626; }

.lrm-toast { margin: 10px 16px 0; padding: 8px 12px; border-radius: 8px; font-size: 12px; display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.lrm-toast-info { background: #EFF6FF; color: #1E40AF; border: 1px solid #93C5FD; }
.lrm-toast-error { background: #FEF2F2; color: #B91C1C; border: 1px solid #FCA5A5; }
.lrm-toast-success { background: #DCFCE7; color: #166534; border: 1px solid #86EFAC; }

.lrm-body { padding: 12px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; flex: 1; }

.lrm-profile-row { display: grid; grid-template-columns: auto 1fr auto; gap: 12px; align-items: center; }
.lrm-avatar { width: 56px; height: 56px; border-radius: 14px; display: flex; align-items: center; justify-content: center; color: white; font-weight: 800; font-size: 18px; flex-shrink: 0; overflow: hidden; }
.lrm-avatar img { width: 100%; height: 100%; object-fit: cover; }
.lrm-profile-info { min-width: 0; }
.lrm-name { font-size: 16px; font-weight: 800; color: #0F172A; text-transform: uppercase; letter-spacing: -0.01em; line-height: 1.2; margin-bottom: 3px; }
.lrm-meta-inline { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.lrm-phone { font-size: 13px; color: #1E40AF; font-weight: 700; font-variant-numeric: tabular-nums; }
.lrm-tag { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 9999px; }
.lrm-tag-grey { background: #F1F5F9; color: #64748B; }
.lrm-tag-green { background: #DCFCE7; color: #166534; }
.lrm-tag-amber { background: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; }
.lrm-tag-red {
  background: #FEE2E2;
  color: #B91C1C;
  border: 1px solid #FCA5A5;
  font-weight: 800;
}
.lrm-tag-shake {
  animation: lrm-tag-shake 1.2s ease-in-out infinite;
  transform-origin: center;
}
@keyframes lrm-tag-shake {
  0%, 100% { transform: translateX(0) scale(1); }
  10%      { transform: translateX(-1.5px) scale(1.02); }
  20%      { transform: translateX(1.5px) scale(1.02); }
  30%      { transform: translateX(-1px) scale(1.02); }
  40%      { transform: translateX(1px) scale(1.02); }
  50%      { transform: translateX(0) scale(1.05); }
  60%, 100% { transform: translateX(0) scale(1); }
}
.lrm-meta-sub { font-size: 11.5px; color: #64748B; margin-top: 2px; display: flex; gap: 10px; flex-wrap: wrap; }

.lrm-stats-chips { display: flex; gap: 6px; }
.lrm-stat-chip { background: #F8FAFC; border: 1px solid #E5E7EB; padding: 6px 10px; border-radius: 8px; display: flex; flex-direction: column; align-items: center; min-width: 58px; }
.lrm-stat-chip.warn { background: #FEF3C7; border-color: #FCD34D; }
.lrm-stat-chip-label { font-size: 9.5px; color: #64748B; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.lrm-stat-chip-value { font-size: 14px; font-weight: 800; color: #0F172A; font-variant-numeric: tabular-nums; margin-top: 1px; }

.lrm-journey { background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 8px; padding: 8px 12px; display: flex; flex-wrap: wrap; gap: 14px; align-items: center; }
.lrm-journey-label { font-size: 10px; color: #64748B; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.lrm-journey-item { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; color: #0F172A; }
.lrm-journey-status { background: #EEF0FF; color: #3730A3; padding: 1px 8px; border-radius: 9999px; font-size: 11px; font-weight: 700; }
.lrm-muted { color: #94A3B8; font-style: italic; margin-left: 4px; font-size: 10.5px; }

.lrm-notes-coll { background: #F8FAFC; border: 1px solid #E5E7EB; border-radius: 8px; }
.lrm-notes-coll-summary { cursor: pointer; padding: 8px 12px; font-size: 12px; color: #475569; font-weight: 600; user-select: none; }
.lrm-notes-coll-summary:hover { background: #F1F5F9; }
.lrm-notes { list-style: none; padding: 0 12px 10px; margin: 0; display: flex; flex-direction: column; gap: 6px; }
.lrm-note { background: white; padding: 8px 12px; border-radius: 6px; border-left: 3px solid #5E6AD2; }
.lrm-note-body { font-size: 12.5px; color: #0F172A; line-height: 1.45; }
.lrm-note-meta { font-size: 11px; color: #94A3B8; margin-top: 3px; font-style: italic; }

/* Zalo profile card */
.lrm-zalo-profile { background: linear-gradient(135deg, #ECFDF5 0%, #D1FAE5 100%); border: 1px solid #86EFAC; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.lrm-zp-header { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.lrm-zp-title { font-size: 11px; font-weight: 800; color: #047857; text-transform: uppercase; letter-spacing: 0.04em; margin-right: auto; }
.lrm-zp-badge { font-size: 10.5px; font-weight: 700; padding: 2px 8px; border-radius: 9999px; }
.lrm-zp-badge-ok { background: #DCFCE7; color: #166534; border: 1px solid #86EFAC; }
.lrm-zp-badge-warn { background: #FEF3C7; color: #92400E; border: 1px solid #FCD34D; }
.lrm-zp-badge-friend { background: #DBEAFE; color: #1E40AF; border: 1px solid #93C5FD; }
.lrm-zp-badge-biz { background: #FAE8FF; color: #86198F; border: 1px solid #E9D5FF; }
.lrm-zp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; }
.lrm-zp-item { display: flex; flex-direction: column; gap: 1px; background: rgba(255, 255, 255, 0.6); padding: 5px 9px; border-radius: 6px; }
.lrm-zp-label { font-size: 9.5px; color: #065F46; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.lrm-zp-value { font-size: 12px; color: #0F172A; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lrm-zp-mono { font-family: ui-monospace, monospace; font-size: 10.5px; }
.lrm-zp-bio { background: rgba(255, 255, 255, 0.7); padding: 6px 10px; border-radius: 7px; display: flex; align-items: baseline; gap: 8px; }
.lrm-zp-bio-text { font-size: 12px; color: #047857; font-style: italic; line-height: 1.4; }

/* Suggestion */
.lrm-suggestion { background: linear-gradient(135deg, #FEFCE8, #FEF3C7); border: 1px solid #FCD34D; border-radius: 10px; padding: 10px 12px; display: flex; align-items: center; gap: 10px; }
.lrm-suggestion-icon { font-size: 16px; flex-shrink: 0; }
.lrm-suggestion-text { flex: 1; font-size: 12.5px; font-style: italic; color: #78350F; line-height: 1.5; }
.lrm-suggestion-copy { background: #F59E0B; color: white; border: none; border-radius: 7px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; transition: background 0.15s; }
.lrm-suggestion-copy:hover { background: #D97706; }
.lrm-suggestion-copy.is-copied { background: #10B981; }

/* 4 actions compact */
.lrm-actions-wrap { position: relative; }
.lrm-actions-title { font-size: 11px; color: #64748B; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.lrm-actions-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.lrm-action { background: white; border: 1px solid #E5E7EB; border-radius: 9px; padding: 8px 10px; display: flex; align-items: center; gap: 8px; cursor: pointer; text-decoration: none; color: #0F172A; font-family: inherit; transition: border-color 0.15s, transform 0.1s, box-shadow 0.15s; text-align: left; }
.lrm-action:hover:not(:disabled):not(.disabled) { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0,0,0,0.08); }
.lrm-action:disabled, .lrm-action.disabled { opacity: 0.5; cursor: not-allowed; }
.lrm-action.active { border-width: 2px; }
.lrm-action-zalo { border-color: #86EFAC; background: #F0FDF4; }
.lrm-action-zalo:hover:not(:disabled) { border-color: #10B981; }
.lrm-action-zalo.active { border-color: #10B981; background: #D1FAE5; }
.lrm-action-find { border-color: #FCD34D; background: #FFFBEB; }
.lrm-action-find:hover:not(:disabled):not(.disabled) { border-color: #F59E0B; }
.lrm-action-find.active { border-color: #F59E0B; background: #FEF3C7; }
.lrm-action-call { border-color: #93C5FD; background: #EFF6FF; }
.lrm-action-call:hover { border-color: #3B82F6; }
.lrm-action-detail { border-color: #DDD6FE; background: #FAF5FF; }
.lrm-action-detail:hover { border-color: #8B5CF6; }
.lrm-action-icon { font-size: 18px; flex-shrink: 0; }
.lrm-action-text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.lrm-action-title { font-size: 12px; font-weight: 700; color: #0F172A; line-height: 1.25; }
.lrm-action-sub { font-size: 10.5px; color: #64748B; line-height: 1.3; margin-top: 1px; }
.lrm-action.pulse { animation: actionPulse 1s ease-in-out infinite; border-width: 2px; }
@keyframes actionPulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.5); }
  50% { box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
}

/* Popup chọn nick */
.lrm-nick-popup { position: absolute; bottom: 64px; background: white; border: 1px solid #C7D2FE; border-radius: 12px; box-shadow: 0 -8px 28px rgba(15, 23, 42, 0.18); padding: 10px 12px; z-index: 100; animation: popUp 0.18s ease-out; min-width: 320px; max-width: 720px; }
@keyframes popUp {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
.lrm-nick-popup::after { content: ''; position: absolute; bottom: -8px; left: 28px; width: 14px; height: 14px; background: white; border-right: 1px solid #C7D2FE; border-bottom: 1px solid #C7D2FE; transform: rotate(45deg); }
.lrm-nick-popup-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.lrm-nick-popup-title { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; flex: 1; min-width: 0; }
.lrm-nick-search { width: 140px; padding: 4px 10px; border: 1px solid #C7D2FE; border-radius: 9999px; font-size: 11.5px; font-family: inherit; outline: none; background: #F8FAFC; transition: border-color 0.12s, background 0.12s; }
.lrm-nick-search:focus { border-color: #5E6AD2; background: white; box-shadow: 0 0 0 3px rgba(94, 106, 210, 0.12); }
.lrm-nick-empty { padding: 12px; text-align: center; font-size: 12px; color: #B91C1C; background: #FEF2F2; border-radius: 8px; }
.lrm-nick-section + .lrm-nick-section { margin-top: 8px; }
.lrm-nick-row-label { font-size: 10px; color: #94A3B8; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; display: block; }
.lrm-nick-row-count { font-size: 9.5px; color: #94A3B8; font-weight: 600; margin-left: 4px; }
.lrm-nick-row { display: flex; gap: 6px; flex-wrap: wrap; }
.lrm-nick-pill { display: inline-flex; align-items: center; gap: 7px; padding: 6px 12px 6px 6px; background: #F8FAFC; border: 1.5px solid #E5E7EB; border-radius: 9999px; cursor: pointer; font-family: inherit; transition: all 0.12s; max-width: 200px; }
.lrm-nick-pill:hover:not(:disabled) { background: #EEF0FF; border-color: #5E6AD2; transform: translateY(-1px); box-shadow: 0 3px 8px rgba(94, 106, 210, 0.18); }
.lrm-nick-pill:disabled { opacity: 0.6; cursor: wait; }
.lrm-nick-pill.priority { border-color: #5E6AD2; background: #EEF0FF; }
.lrm-nick-pill.busy { background: #FEF3C7; border-color: #F59E0B; }
.lrm-nick-pill-avatar { width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 10.5px; flex-shrink: 0; position: relative; overflow: hidden; }
.lrm-nick-pill-avatar img { width: 100%; height: 100%; object-fit: cover; }
.lrm-nick-pill-avatar::after { content: ''; position: absolute; bottom: -1px; right: -1px; width: 8px; height: 8px; background: #10B981; border: 2px solid white; border-radius: 50%; }
.lrm-nick-pill-name { font-size: 12px; font-weight: 600; color: #0F172A; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lrm-nick-more { display: inline-flex; align-items: center; padding: 6px 12px; background: white; border: 1.5px dashed #C7D2FE; border-radius: 9999px; cursor: pointer; font-family: inherit; font-size: 11.5px; font-weight: 600; color: #5E6AD2; transition: all 0.12s; }
.lrm-nick-more:hover { background: #EEF0FF; border-style: solid; }

/* Note footer */
.lrm-note-footer { background: linear-gradient(180deg, #FFFBEB 0%, #FEF3C7 100%); border-top: 1.5px solid #FCD34D; padding: 10px 16px; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.lrm-note-header { display: flex; justify-content: space-between; align-items: center; }
.lrm-note-label { font-size: 11px; color: #78350F; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
.lrm-note-required { font-size: 10.5px; color: #B91C1C; font-weight: 600; }
.lrm-note-textarea { width: 100%; padding: 8px 11px; border: 1.5px solid #FCD34D; border-radius: 8px; font-size: 13px; font-family: inherit; resize: none; outline: none; background: white; height: 56px; }
.lrm-note-textarea:focus { border-color: #F59E0B; box-shadow: 0 0 0 3px rgba(245, 158, 11, 0.15); }
.lrm-note-actions { display: flex; gap: 8px; align-items: center; }
.lrm-note-counter { font-size: 11.5px; color: #94A3B8; font-variant-numeric: tabular-nums; margin-right: auto; font-weight: 600; }
.lrm-note-counter.ok { color: #047857; }

.lrm-btn-ghost { padding: 7px 12px; border-radius: 7px; font-size: 12px; font-weight: 600; background: transparent; color: #B91C1C; border: none; cursor: pointer; font-family: inherit; }
.lrm-btn-ghost:hover:not(:disabled) { background: rgba(220, 38, 38, 0.08); }
.lrm-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.lrm-btn-primary { padding: 8px 14px; border-radius: 7px; font-size: 12.5px; font-weight: 700; background: #5E6AD2; color: white; border: none; cursor: pointer; font-family: inherit; transition: background 0.15s; }
.lrm-btn-primary:hover:not(:disabled) { background: #4F46E5; }
.lrm-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 880px) {
  .lrm-overlay { padding: 0; }
  .lrm-modal { max-height: 100vh; border-radius: 0; width: 100%; }
  .lrm-profile-row { grid-template-columns: 1fr; gap: 8px; }
  .lrm-stats-chips { justify-content: space-between; }
  .lrm-actions-grid { grid-template-columns: repeat(2, 1fr); }
  .lrm-note-actions { flex-wrap: wrap; }
}
</style>
