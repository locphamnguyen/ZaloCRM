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
              <!-- Per-nick semantic 2026-05-28: tag hiển thị nick đang sẵn sàng dùng -->
              <span v-if="lead.hasZaloFromMyNick && (lead.autoLookup?.nickUsed || directChatNickName)" class="lrm-tag lrm-tag-green" :title="'Bấm Mở chat Zalo → vào chat ngay qua nick này. Có thể đổi nick khác trong popup.'">🟢 Sẵn sàng chat qua "{{ lead.autoLookup?.nickUsed || directChatNickName }}"</span>
              <span v-else-if="lead.hasZaloFromMyNick" class="lrm-tag lrm-tag-green">🟢 Sẵn sàng chat</span>
              <span v-else-if="lead.contact.hasZalo === true" class="lrm-tag lrm-tag-red lrm-tag-shake" title="KH có Zalo nhưng từ nick sale khác — bấm 'Mở chat Zalo' để chọn nick của bạn">🔴 Chọn nick để tìm Zalo</span>
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

        <!-- Suggestion 1 dòng + copy + gửi thẳng (2026-06-19: render màu/đậm) -->
        <div v-if="primarySuggestion.text" class="lrm-suggestion">
          <span class="lrm-suggestion-icon">💡</span>
          <span class="lrm-suggestion-text" v-html="primarySuggestionHtml"></span>
          <button
            v-if="(props.lead?.suggestedOpenings?.length ?? 0) > 1"
            class="lrm-suggestion-copy"
            title="Đổi câu chào khác"
            @click="randomSuggestion"
          >
            <span>🔀</span><span>Đổi câu</span>
          </button>
          <button class="lrm-suggestion-copy" :class="{ 'is-copied': copiedFlag }" @click="copySuggestion">
            <span>{{ copiedFlag ? '✓' : '📋' }}</span>
            <span>{{ copiedFlag ? 'Đã copy' : 'Copy' }}</span>
          </button>
          <button
            class="lrm-suggestion-send"
            :disabled="sendingGreeting || !directChatNickId"
            :title="directChatNickId ? 'Gửi câu chào này (có màu/đậm) thẳng tới khách qua Zalo' : 'Chưa có nick sẵn sàng để gửi'"
            @click="sendGreetingDirect"
          >
            <span>{{ sendingGreeting ? '⏳' : '📤' }}</span>
            <span>{{ sendingGreeting ? 'Đang gửi…' : 'Gửi thẳng' }}</span>
          </button>
        </div>

        <!-- 4 action buttons compact grid 4 cột -->
        <div class="lrm-actions-wrap">
          <div class="lrm-actions-title">⚡ Bắt đầu liên lạc</div>
          <div class="lrm-actions-grid lrm-actions-grid-4">
            <!-- Nút 1: Đổi nick (vuông nhỏ — hiện popup chọn nick) -->
            <button
              class="lrm-action lrm-action-nick"
              :class="{ active: activePopup === 'chat' }"
              :title="directChatNickName ? `Đang dùng \&quot;${directChatNickName}\&quot;. Bấm để đổi nick khác` : 'Chọn nick để mở chat'"
              @click="togglePopup('chat')"
            >
              <span class="lrm-action-icon">🔄</span>
              <span class="lrm-action-nick-label">Đổi<br/>nick</span>
            </button>

            <!-- Nút 2: Mở chat Zalo (bấm = vào chat ngay với nick auto-lookup) -->
            <button
              class="lrm-action lrm-action-zalo"
              :disabled="pendingNickId !== null"
              @click="onOpenChatMain"
            >
              <span class="lrm-action-icon">💬</span>
              <span class="lrm-action-text">
                <span class="lrm-action-title">Mở chat Zalo</span>
                <span class="lrm-action-sub">{{ directChatNickName ? `Sẵn sàng qua "${directChatNickName}"` : 'Chọn nick để mở' }}</span>
              </span>
            </button>

            <!-- Nút 3: Gọi điện -->
            <a
              v-if="lead.contact.phone"
              :href="`tel:${lead.contact.phone}`"
              class="lrm-action lrm-action-call"
            >
              <span class="lrm-action-icon">📞</span>
              <span class="lrm-action-text">
                <span class="lrm-action-title">Gọi điện</span>
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

            <!-- Nút 4: Mở trang KH -->
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
                💬 Mở chat bằng nick nào?
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

            <!-- ★ Nick đang dùng (auto-lookup) — xếp đầu, default highlight -->
            <div v-if="!nickSearch && currentNick" class="lrm-nick-section">
              <span class="lrm-nick-row-label">★ Đang dùng (bấm = vào chat ngay)</span>
              <div class="lrm-nick-row">
                <button
                  class="lrm-nick-pill current"
                  :class="{ busy: pendingNickId === currentNick.id }"
                  :disabled="pendingNickId !== null"
                  @click="onPickNick(currentNick.id)"
                  :title="currentNick.ownerName ? 'Nick của ' + currentNick.ownerName : ''"
                >
                  <span class="lrm-nick-pill-avatar" :style="nickAvatarStyle(currentNick.displayName || '?')">
                    <img v-if="currentNick.avatarUrl" :src="currentNick.avatarUrl" :alt="currentNick.displayName || ''" referrerpolicy="no-referrer" />
                    <span v-else>{{ nickInitials(currentNick.displayName) }}</span>
                  </span>
                  <span class="lrm-nick-pill-name">{{ currentNick.displayName || '(không tên)' }}</span>
                  <span class="lrm-nick-pill-star">★</span>
                </button>
                <span class="lrm-nick-hint">Chọn nick khác bên dưới → hệ thống sẽ tự quét UID Zalo của KH bằng nick đó rồi mở chat</span>
              </div>
            </div>

            <!-- "Gần đây" — chỉ hiện khi không search + có recent (loại trừ currentNick) -->
            <div v-if="!nickSearch && recentNicksFiltered.length > 0" class="lrm-nick-section">
              <span class="lrm-nick-row-label">🕒 Gần đây dùng</span>
              <div class="lrm-nick-row">
                <button
                  v-for="n in recentNicksFiltered"
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
          <span class="lrm-note-counter" :class="{ ok: noteText.trim().length >= noteMinLength }">
            {{ noteText.trim().length }} / {{ noteMinLength }}
          </span>
          <!-- Phase FIFO 2026-06-15: bỏ nút "Trả lại pool" (Anh chốt thừa). Nút "Lưu Note"
               full hàng → mở màn khóa chọn trạng thái (KHÔNG lưu thẳng).
               2026-06-16: validate theo trim() cho khớp BE (BE trim trước khi check độ dài). -->
          <button class="lrm-btn-primary lrm-btn-save-full" :disabled="noteText.trim().length < noteMinLength" @click="onSaveNoteThenStatus">
            <span>💾 Lưu Note</span>
          </button>
        </div>
      </footer>
    </div>

    <!-- Phase Lead Pool FIFO 2026-06-15 — bỏ Return Dialog (Anh chốt bỏ nút Trả lại pool). -->

    <!-- Phase Lead Pool FIFO 2026-06-15 — Màn chọn trạng thái sau Lưu Note (style ảnh Anh:
         card to ngang, nền nhạt theo màu trạng thái, số # bên phải, grid 2 cột 4 hàng).
         Bắt buộc chọn 1 — chọn xong tự chuyển sang Lead tiếp theo. -->
    <Teleport to="body">
      <div v-if="statusStepOpen" class="sss-backdrop">
        <div class="sss-card" role="dialog" aria-modal="true">
          <button class="sss-back-x" type="button" :disabled="savingStatus" @click="onBackToNote" title="Quay lại sửa note" aria-label="Quay lại sửa note">←</button>
          <div class="sss-head">Chọn trạng thái cho nick này</div>
          <div v-if="statusLoading" class="sss-loading">Đang tải trạng thái…</div>
          <div v-else-if="statusList.length === 0" class="sss-empty">
            <p class="sss-empty-msg">Chưa tải được trạng thái (có thể chưa cài ở Cài đặt → CRM → Trạng thái, hoặc lỗi mạng).</p>
            <div class="sss-empty-actions">
              <button type="button" class="sss-empty-btn" :disabled="savingStatus" @click="reloadStatuses">↻ Thử lại</button>
              <button type="button" class="sss-empty-btn primary" :disabled="savingStatus" @click="onSkipStatus">Lưu, bỏ qua trạng thái</button>
            </div>
          </div>
          <div v-else class="sss-grid">
            <button
              v-for="(st, i) in statusList"
              :key="st.id"
              class="sss-card-btn"
              :style="cardStyle(st.color)"
              :disabled="savingStatus"
              @click="onPickStatus(st.id)"
            >
              <span class="sss-name" :style="{ color: st.color || '#475066' }">{{ st.name }}</span>
              <span class="sss-num">#{{ i + 1 }}</span>
            </button>
          </div>
          <div class="sss-foot">
            <button type="button" class="sss-back-link" :disabled="savingStatus" @click="onBackToNote">← Quay lại sửa note</button>
            <span v-if="statusList.length" class="sss-foot-hint">Chọn trạng thái để chuyển qua Lead tiếp theo</span>
          </div>
          <div v-if="savingStatus" class="sss-saving">Đang lưu…</div>
          <div v-if="actionError" class="sss-error">⚠ {{ actionError }}</div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '@/api/index';
import { applyRichFormat } from '@/composables/use-rich-format';
import { useLeadPool, type LeadPayload } from '@/composables/use-lead-pool';

const props = defineProps<{ lead: LeadPayload | null }>();
const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'note-submitted'): void;
  (e: 'returned'): void;
}>();

const router = useRouter();
const { submitNote, eligibility, fetchStatuses } = useLeadPool();

const noteText = ref('');
const actionError = ref('');
const actionInfo = ref('');
const enrichSuccess = ref<{ nickUsed: string; zaloName: string | null } | null>(null);
const copiedFlag = ref(false);
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

// 2026-05-28: nick "đang dùng" cho popup — xếp đầu với ★.
// Priority: autoLookup.nickId (BE auto-lookup khi nhận lead) >
//           friendsByCurrentSale[0].zaloAccountId (Friend per-nick có sẵn từ session trước)
const currentNick = computed(() => {
  if (!nicksData.value) return null;
  const nickId = (props.lead as any)?.autoLookup?.nickId
    || ((props.lead as any)?.friendsByCurrentSale?.[0]?.zaloAccountId);
  if (!nickId) return null;
  const all = [...nicksData.value.ownNicks, ...nicksData.value.teamNicks];
  return all.find((n) => n.id === nickId) ?? null;
});

// Loại currentNick khỏi list "Gần đây dùng" để tránh trùng
const recentNicksFiltered = computed(() => {
  const curId = currentNick.value?.id;
  if (!curId) return recentNicks.value;
  return recentNicks.value.filter((n) => n.id !== curId);
});

const noteMinLength = computed(() => eligibility.value?.config.noteMinLength ?? 20);

// 2026-05-29 anh báo: KH 0979393638 hiện phone thay vì 'Huongntt' (zaloName).
// Fix priority chain: sale tự đặt > Contact > Zalo profile (auto-lookup hoặc Friend) > phone.
const displayName = computed(() => {
  const c = props.lead?.contact;
  const lead = props.lead as any;
  const fromAutoLookup = lead?.autoLookup?.zaloProfile?.zaloName;
  const fromFriend = lead?.friendsByCurrentSale?.[0]?.zaloDisplayName;
  return c?.crmName || c?.fullName || fromAutoLookup || fromFriend || c?.phone || 'KH chưa đặt tên';
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
// Phase Lead Pool FIFO 2026-06-15 — câu chào lấy từ list suggestedOpenings (BE đã render
// 8 biến). Nút Random đổi câu khác trong list. Index xoay vòng.
const suggestionIndex = ref(0);
type Suggestion = { text: string; styles: Array<{ st: string; start: number; len: number }> };
const primarySuggestion = computed<Suggestion>(() => {
  const list = (props.lead?.suggestedOpenings ?? []) as Suggestion[];
  if (list.length > 0) return list[suggestionIndex.value % list.length] ?? { text: '', styles: [] };
  // Fallback nếu BE không trả list (sale chưa có nick) — câu cơ bản (text trơn).
  const contactName = contactFirstName.value;
  const gender = zaloProfile.value?.gender;
  const xnq = gender === 0 ? 'Anh' : gender === 1 ? 'Chị' : 'anh/chị';
  return { text: contactName ? `Chào ${xnq} ${contactName}, em là sale chăm sóc tài khoản của mình ạ.` : '', styles: [] };
});
// HTML có màu/đậm cho preview (đồng bộ cách Khối render styles).
const primarySuggestionHtml = computed(() => applyRichFormat(primarySuggestion.value.text, primarySuggestion.value.styles || []));
function randomSuggestion() {
  const list = props.lead?.suggestedOpenings ?? [];
  if (list.length <= 1) return;
  // Đổi sang câu KHÁC câu hiện tại (random trong list).
  let next = suggestionIndex.value;
  while (next === suggestionIndex.value) next = Math.floor(Math.random() * list.length);
  suggestionIndex.value = next;
}

const genderLabel = computed(() => {
  const g = zaloProfile.value?.gender;
  if (g === 0) return 'Nam';
  if (g === 1) return 'Nữ';
  if (g === 2) return 'Khác';
  return '';
});

// 2026-05-29 fix anh báo: KH Mira Nguyễn có dob = -18082800 (Unix timestamp giây,
// số âm vì sinh trước 1970). Code cũ check d > 0 → fallback raw '-18082800'.
// Zalo SDK dob có thể là:
//   - Unix timestamp giây (kể cả âm cho người sinh trước 1970)
//   - Unix timestamp ms (số rất lớn > 1e12)
//   - ISO string '1985-06-04'
//   - Format YYYYMMDD số (vd 19850604)
const dobLabel = computed(() => {
  const d = zaloProfile.value?.dob;
  if (d === null || d === undefined || d === '') return '';
  // ISO string format
  if (typeof d === 'string') {
    const parsed = new Date(d);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 1900) {
      return formatDob(parsed);
    }
    return d; // raw string fallback
  }
  if (typeof d === 'number') {
    // Format YYYYMMDD (vd 19850604)
    if (d >= 19000101 && d <= 21000101) {
      const yyyy = Math.floor(d / 10000);
      const mm = Math.floor((d % 10000) / 100);
      const dd = d % 100;
      return `${String(dd).padStart(2, '0')}/${String(mm).padStart(2, '0')}/${yyyy}`;
    }
    // Unix timestamp giây hoặc ms (kể cả âm)
    const ms = Math.abs(d) > 1e12 ? d : d * 1000;
    const date = new Date(ms);
    if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2100) {
      return formatDob(date);
    }
  }
  return String(d);
});
function formatDob(date: Date): string {
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear()}`;
}

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
  if (!primarySuggestion.value.text) return;
  try {
    await navigator.clipboard.writeText(primarySuggestion.value.text);
    copiedFlag.value = true;
    setTimeout(() => { copiedFlag.value = false; }, 1800);
  } catch { /* silent */ }
}

// 2026-06-19 (C): GỬI THẲNG câu chào (có màu/đậm) qua Zalo — open-chat lấy conversationId
// rồi POST /conversations/:id/messages kèm styles (Zalo nhận format, khác copy-dán mất màu).
const sendingGreeting = ref(false);
async function sendGreetingDirect() {
  const sug = primarySuggestion.value;
  const nickId = directChatNickId.value;
  if (sendingGreeting.value || !sug.text || !nickId || !props.lead) return;
  sendingGreeting.value = true;
  clearMessages();
  try {
    const { data } = await api.post(`/lead-pool/${props.lead.leadRequestId}/open-chat`, { zaloAccountId: nickId });
    if (!data?.canChat || !data.conversationId) {
      actionError.value = data?.message || 'Chưa mở được hội thoại để gửi. Thử "Mở chat" rồi gửi tay.';
      return;
    }
    await api.post(`/conversations/${data.conversationId}/messages`, {
      content: sug.text,
      styles: sug.styles && sug.styles.length ? sug.styles : undefined,
    });
    actionInfo.value = '✓ Đã gửi câu chào (có màu) tới khách. Mở chat để tiếp tục...';
    setTimeout(() => { router.push({ path: `/chat/${data.conversationId}` }); emit('close'); }, 800);
  } catch (err: any) {
    actionError.value = err?.response?.data?.error || 'Gửi câu chào thất bại. Thử lại hoặc copy gửi tay.';
  } finally {
    sendingGreeting.value = false;
  }
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

function togglePopup(kind: 'chat') {
  // 2026-05-28 anh chốt v2: popup tách ra nút "Đổi nick" riêng. Nút "Mở chat Zalo"
  // chính bấm = vào chat ngay (skip popup). Nút "Đổi nick" này để sale chuyển nick khác.
  if (activePopup.value === kind) { activePopup.value = null; return; }
  popupLeft.value = 0;
  activePopup.value = kind;
  nickSearch.value = '';
  expandedOwn.value = false;
  expandedTeam.value = false;
  void fetchNicksIfNeeded();
}

// Nút chính "Mở chat Zalo": có nick auto-lookup → vào chat thẳng, không có → mở popup
async function onOpenChatMain() {
  const directId = resolveDirectChatNickId();
  if (directId) {
    activePopup.value = 'chat'; // để onPickNick check activePopup
    await onPickNick(directId);
    return;
  }
  togglePopup('chat');
}

/**
 * Resolve nick để mở chat trực tiếp (skip popup):
 *   1. autoLookup.nickId — nick BE auto lookup khi nhận lead
 *   2. friendsByCurrentSale[0].zaloAccountId — Friend per-nick có sẵn của sale current
 *   3. null → cần popup chọn nick
 */
function resolveDirectChatNickId(): string | null {
  const auto = (props.lead as any)?.autoLookup;
  if (auto?.found && auto?.nickId) return auto.nickId;
  const friends = (props.lead as any)?.friendsByCurrentSale;
  if (Array.isArray(friends) && friends.length > 0 && friends[0]?.zaloAccountId) {
    return friends[0].zaloAccountId;
  }
  return null;
}

// 2026-06-19 (C): nick id sẵn sàng để gửi thẳng câu chào (computed cho template).
const directChatNickId = computed<string | null>(() => resolveDirectChatNickId());
// Tên nick để hiển thị trên nút "Mở chat Zalo" — null = cần popup chọn
const directChatNickName = computed<string | null>(() => {
  if (!props.lead?.hasZaloFromMyNick) return null;
  const auto = (props.lead as any)?.autoLookup;
  if (auto?.nickUsed) return auto.nickUsed;
  const friends = (props.lead as any)?.friendsByCurrentSale;
  if (Array.isArray(friends) && friends.length > 0) {
    return friends[0]?.zaloAccount?.displayName ?? null;
  }
  return null;
});

function clearMessages() {
  actionError.value = '';
  actionInfo.value = '';
  enrichSuccess.value = null;
}

async function onPickNick(zaloAccountId: string) {
  if (!activePopup.value || !props.lead) return;
  pendingNickId.value = zaloAccountId;
  clearMessages();
  // Track recent pick — lên top "Gần đây" lần sau
  pushRecentNick(zaloAccountId);
  try {
    // BE openChatForLead Path A: nếu chưa có Friend với nick này → tự lookup UID qua
    // nick mới → upsert Friend + Conversation stub. Sale chỉ cần chọn nick là xong.
    const { data } = await api.post(`/lead-pool/${props.lead.leadRequestId}/open-chat`, { zaloAccountId });
    if (data?.canChat && data.conversationId) {
      const draft = primarySuggestion.value.text;
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
      actionError.value = data.message || 'Nick này không tìm thấy Zalo của KH. Thử nick khác hoặc gọi điện.';
      activePopup.value = null;
    } else {
      actionError.value = data?.message || 'Không mở được chat';
    }
  } catch (err: any) {
    actionError.value = err?.response?.data?.error || 'Thao tác thất bại';
  } finally {
    pendingNickId.value = null;
  }
}

function onClose() { emit('close'); }

// Phase Lead Pool FIFO 2026-06-15 — flow 2 bước: Lưu Note → màn KHÓA chọn trạng thái.
// Bước 1: bấm "Lưu Note" → mở màn khóa + load 8 trạng thái động từ /crm/statuses.
const statusStepOpen = ref(false);
const statusList = ref<Array<{ id: string; name: string; color: string | null; order: number; isTerminal: boolean }>>([]);
const statusLoading = ref(false);
const savingStatus = ref(false);

async function onSaveNoteThenStatus() {
  if (!props.lead) return;
  // 2026-06-16: validate theo trim() cho khớp BE (BE trim trước khi check độ dài).
  if (noteText.value.trim().length < noteMinLength.value) return;
  statusStepOpen.value = true;
  await reloadStatuses();
}

// Tải (hoặc tải lại) danh sách trạng thái. Dùng cho cả lần mở màn + nút "Thử lại".
async function reloadStatuses() {
  statusLoading.value = true;
  actionError.value = '';
  statusList.value = await fetchStatuses();
  statusList.value.sort((a, b) => a.order - b.order);
  statusLoading.value = false;
}

// Bước 2: bấm 1 trong các trạng thái = LƯU LUÔN (note + status) rồi đóng.
// 2026-06-16: KHÔNG còn lock cứng — có nút "← Quay lại sửa note" + Esc thoát (note CHƯA submit
// lúc này nên back an toàn). Nền nhạt từ màu trạng thái (card pastel theo status).
function cardStyle(color: string | null) {
  const c = color || '#9CA3AF';
  return { background: c + '22', border: `1px solid ${c}33` };
}

// already_noted / race_lost = note thực ra ĐÃ lưu (response lần đầu rớt / double-fire) →
// coi như thành công, đóng + qua lead tiếp. Tránh kẹt vĩnh viễn ở màn chọn trạng thái.
function isSubmitSuccess(res: { ok: boolean; code?: string }): boolean {
  return res.ok || res.code === 'already_noted' || res.code === 'race_lost';
}

async function onPickStatus(statusId: string) {
  if (!props.lead || savingStatus.value) return;
  savingStatus.value = true;
  actionError.value = '';
  // nickId = nick sale đang chat KH → BE ghi status vào Friend(nick×KH). null = fallback Contact.
  const res = await submitNote(props.lead.leadRequestId, noteText.value, statusId, resolveDirectChatNickId());
  savingStatus.value = false;
  if (isSubmitSuccess(res)) {
    statusStepOpen.value = false;
    emit('note-submitted');
  } else {
    actionError.value = res.message || 'Lưu note + trạng thái thất bại';
  }
}

// Lưu note KHÔNG kèm trạng thái (khi chưa cài status / lỗi tải) — không để sale kẹt.
async function onSkipStatus() {
  if (!props.lead || savingStatus.value) return;
  savingStatus.value = true;
  actionError.value = '';
  const res = await submitNote(props.lead.leadRequestId, noteText.value, null, null);
  savingStatus.value = false;
  if (isSubmitSuccess(res)) {
    statusStepOpen.value = false;
    emit('note-submitted');
  } else {
    actionError.value = res.message || 'Lưu note thất bại';
  }
}

// Quay lại màn note (note chưa submit → an toàn, không mất gì).
function onBackToNote() {
  if (savingStatus.value) return;
  statusStepOpen.value = false;
  actionError.value = '';
}

// Phase Lead Pool FIFO 2026-06-15 — gỡ toàn bộ Return Dialog (Anh chốt bỏ nút Trả lại pool).

function onDocumentClick(e: MouseEvent) {
  if (!activePopup.value) return;
  const target = e.target as HTMLElement;
  if (target.closest('.lrm-nick-popup') || target.closest('.lrm-action-nick')) return;
  activePopup.value = null;
}

// Esc trên màn chọn trạng thái = quay lại sửa note (không kẹt). Không xử lý khi đang lưu.
function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && statusStepOpen.value && !savingStatus.value) {
    onBackToNote();
  }
}

// Pre-populate zaloProfile từ auto-lookup BE (2026-05-28) — câu chào personalize ngay
// khi modal mở, không cần sale bấm "Tìm Zalo qua SĐT".
onMounted(() => {
  document.addEventListener('click', onDocumentClick);
  document.addEventListener('keydown', onDocumentKeydown);
  if (props.lead?.autoLookup?.zaloProfile) {
    zaloProfile.value = props.lead.autoLookup.zaloProfile;
  }
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick);
  document.removeEventListener('keydown', onDocumentKeydown);
});
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
/* 2026-06-19 (C) — nút Gửi thẳng câu chào (có màu) */
.lrm-suggestion-send { background: #1786be; color: white; border: none; border-radius: 7px; padding: 7px 12px; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 5px; flex-shrink: 0; transition: background 0.15s; }
.lrm-suggestion-send:hover:not(:disabled) { background: #126699; }
.lrm-suggestion-send:disabled { opacity: 0.5; cursor: not-allowed; }
/* preview câu chào có format — đảm bảo bold/màu render trong span */
.lrm-suggestion-text :deep(strong) { font-weight: 700; }
.lrm-suggestion-text :deep(em) { font-style: italic; }

/* 4 actions compact */
.lrm-actions-wrap { position: relative; }
.lrm-actions-title { font-size: 11px; color: #64748B; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 6px; }
.lrm-actions-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
/* 4 nút: nút 1 (Đổi nick) hẹp vuông, 3 nút còn lại chia đều */
.lrm-actions-grid-4 { grid-template-columns: 64px 1fr 1fr 1fr; }
.lrm-action { background: white; border: 1px solid #E5E7EB; border-radius: 9px; padding: 8px 10px; display: flex; align-items: center; gap: 8px; cursor: pointer; text-decoration: none; color: #0F172A; font-family: inherit; transition: border-color 0.15s, transform 0.1s, box-shadow 0.15s; text-align: left; }
.lrm-action:hover:not(:disabled):not(.disabled) { transform: translateY(-1px); box-shadow: 0 3px 10px rgba(0,0,0,0.08); }
.lrm-action:disabled, .lrm-action.disabled { opacity: 0.5; cursor: not-allowed; }
.lrm-action.active { border-width: 2px; }
.lrm-action-zalo { border-color: #86EFAC; background: #F0FDF4; }
.lrm-action-zalo:hover:not(:disabled) { border-color: #10B981; }
.lrm-action-zalo.active { border-color: #10B981; background: #D1FAE5; }
/* Nút vuông "Đổi nick" — compact, dọc, icon + label 2 dòng */
.lrm-action-nick { border-color: #C7D2FE; background: #EEF2FF; padding: 6px 4px; flex-direction: column; gap: 2px; justify-content: center; align-items: center; }
.lrm-action-nick:hover { border-color: #6366F1; }
.lrm-action-nick.active { border-color: #4F46E5; background: #E0E7FF; border-width: 2px; }
.lrm-action-nick .lrm-action-icon { font-size: 18px; }
.lrm-action-nick-label { font-size: 10px; font-weight: 700; color: #4338CA; line-height: 1.1; text-align: center; }
.lrm-actions-grid-3 { grid-template-columns: repeat(3, 1fr); }
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
.lrm-nick-pill.current {
  border-color: #10B981; background: #ECFDF5;
  border-width: 2px; font-weight: 700;
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
}
.lrm-nick-pill.current:hover:not(:disabled) { background: #D1FAE5; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.35); }
.lrm-nick-pill-star { color: #F59E0B; font-size: 13px; margin-left: 2px; }
.lrm-nick-pill.busy { background: #FEF3C7; border-color: #F59E0B; }
.lrm-nick-hint {
  display: block; margin-top: 6px;
  font-size: 10.5px; color: #64748B;
  font-style: italic; line-height: 1.4;
  flex-basis: 100%;
}
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

/* ─── Return Reason Dialog (2026-05-29) ─── */
.rrd-backdrop {
  position: fixed; inset: 0; background: rgba(15, 23, 42, 0.55);
  display: flex; align-items: center; justify-content: center;
  z-index: 10000; backdrop-filter: blur(2px);
  animation: rrdFadeIn 0.15s ease-out;
}
.rrd-card {
  background: white; border-radius: 14px; width: 100%; max-width: 480px;
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.04);
  animation: rrdSlideUp 0.18s ease-out;
  display: flex; flex-direction: column;
  margin: 16px;
}
@keyframes rrdFadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes rrdSlideUp {
  from { opacity: 0; transform: translateY(12px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
}
.rrd-head {
  display: flex; align-items: flex-start; gap: 12px;
  padding: 16px 18px 12px; border-bottom: 1px solid #F1F5F9;
  position: relative;
}
.rrd-icon {
  width: 36px; height: 36px; border-radius: 10px;
  background: linear-gradient(135deg, #FEF3C7, #FED7AA);
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; color: #B45309; flex-shrink: 0;
}
.rrd-head h3 { margin: 0 0 2px; font-size: 14.5px; font-weight: 700; color: #0F172A; }
.rrd-head p { margin: 0; font-size: 12px; color: #64748B; line-height: 1.4; }
.rrd-close {
  position: absolute; top: 12px; right: 12px;
  width: 28px; height: 28px; border-radius: 6px;
  border: none; background: transparent; color: #94A3B8;
  cursor: pointer; font-size: 14px; line-height: 1;
  transition: all 0.12s;
}
.rrd-close:hover { background: #F1F5F9; color: #475569; }
.rrd-body { padding: 14px 18px 4px; display: flex; flex-direction: column; gap: 8px; }
.rrd-field-label { font-size: 11.5px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.04em; }
.rrd-field-label .req { color: #DC2626; }
.rrd-textarea {
  width: 100%; padding: 10px 12px;
  border: 1px solid #CBD5E1; border-radius: 8px;
  font-family: inherit; font-size: 13px; color: #0F172A;
  resize: vertical; min-height: 76px;
  transition: border-color 0.12s, box-shadow 0.12s;
  box-sizing: border-box;
}
.rrd-textarea:focus {
  outline: none; border-color: #4F46E5;
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}
.rrd-counter { font-size: 11px; color: #94A3B8; }
.rrd-counter.ok { color: #16A34A; font-weight: 600; }
.rrd-counter .hint { color: #B91C1C; margin-left: 4px; }
.rrd-presets { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding-top: 4px; }
.rrd-presets-label { font-size: 11px; color: #64748B; font-weight: 600; margin-right: 2px; }
.rrd-preset-chip {
  padding: 4px 10px; background: #F1F5F9; border: 1px solid #E2E8F0;
  border-radius: 14px; font-size: 11px; color: #475569;
  cursor: pointer; transition: all 0.12s; font-family: inherit;
}
.rrd-preset-chip:hover { background: #EEF2FF; border-color: #C7D2FE; color: #4338CA; }
.rrd-error {
  margin-top: 4px; padding: 8px 10px;
  background: #FEF2F2; border: 1px solid #FCA5A5; border-radius: 6px;
  color: #B91C1C; font-size: 12px;
}
.rrd-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px 16px; border-top: 1px solid #F1F5F9; margin-top: 8px;
}
.rrd-btn-ghost {
  padding: 8px 14px; background: white; border: 1px solid #CBD5E1;
  border-radius: 7px; font-size: 12.5px; font-weight: 600; color: #475569;
  cursor: pointer; font-family: inherit; transition: all 0.12s;
}
.rrd-btn-ghost:hover:not(:disabled) { background: #F8FAFC; border-color: #94A3B8; }
.rrd-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
.rrd-btn-danger {
  padding: 8px 16px; background: #DC2626; color: white; border: 1px solid #DC2626;
  border-radius: 7px; font-size: 12.5px; font-weight: 700;
  cursor: pointer; font-family: inherit; transition: all 0.12s;
}
.rrd-btn-danger:hover:not(:disabled) { background: #B91C1C; }
.rrd-btn-danger:disabled { opacity: 0.5; cursor: not-allowed; background: #94A3B8; border-color: #94A3B8; }

/* Phase Lead Pool FIFO 2026-06-15 — nút Lưu Note full hàng */
.lrm-btn-save-full { flex: 1; justify-content: center; }

/* Màn chọn trạng thái — style theo ảnh Anh: card to ngang, nền pastel theo màu status,
   số # bên phải, grid 2 cột × 4 hàng (4 trên 4 dưới). Font Plus Jakarta Sans. */
.sss-backdrop {
  position: fixed; inset: 0; z-index: 10050;
  background: rgba(8, 22, 30, 0.55); backdrop-filter: blur(2px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
  font-family: "Plus Jakarta Sans", -apple-system, "Segoe UI", Roboto, sans-serif;
}
.sss-card {
  position: relative;
  width: 460px; max-width: 100%; border-radius: 16px; overflow: hidden;
  box-shadow: 0 16px 48px rgba(20,26,36,.28); background: #fff; padding: 22px;
}
.sss-back-x {
  position: absolute; top: 14px; left: 14px;
  width: 30px; height: 30px; border-radius: 8px; border: none; cursor: pointer;
  background: #f1f3f8; color: #475066; font-size: 17px; line-height: 1;
  font-family: inherit; display: flex; align-items: center; justify-content: center;
  transition: background .12s;
}
.sss-back-x:hover:not(:disabled) { background: #e4e8f0; color: #141a24; }
.sss-back-x:disabled { opacity: .5; cursor: not-allowed; }
.sss-head { font-size: 17px; font-weight: 800; color: #141a24; margin-bottom: 16px; padding-left: 38px; }
.sss-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.sss-card-btn {
  display: flex; align-items: center; justify-content: space-between;
  padding: 13px 16px; border-radius: 11px; cursor: pointer;
  font-family: inherit; transition: all .12s; text-align: left;
}
.sss-card-btn:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(20,26,36,.10); }
.sss-card-btn:disabled { opacity: .55; cursor: not-allowed; }
.sss-name { font-size: 14.5px; font-weight: 700; }
.sss-num { font-size: 12px; font-weight: 600; color: #97a0b3; }
.sss-foot {
  margin-top: 16px; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  font-size: 12.5px; font-weight: 600;
  color: #6b7488; background: #f7f9fc; border: 1px solid #eef1f6; border-radius: 10px; padding: 9px 12px;
}
.sss-foot-hint { flex: 1; text-align: right; }
.sss-back-link {
  background: none; border: none; cursor: pointer; font-family: inherit;
  font-size: 12.5px; font-weight: 700; color: #5E6AD2; padding: 2px 4px; flex-shrink: 0;
}
.sss-back-link:hover:not(:disabled) { text-decoration: underline; }
.sss-back-link:disabled { opacity: .5; cursor: not-allowed; }
.sss-loading, .sss-empty, .sss-saving { font-size: 13px; color: #6b7488; padding: 16px; text-align: center; }
.sss-empty-msg { margin: 0 0 12px; }
.sss-empty-actions { display: flex; gap: 8px; justify-content: center; }
.sss-empty-btn {
  padding: 8px 14px; border-radius: 9px; border: 1px solid #d8deea; cursor: pointer;
  font-family: inherit; font-size: 12.5px; font-weight: 700; color: #475066; background: #fff;
  transition: all .12s;
}
.sss-empty-btn:hover:not(:disabled) { background: #f1f3f8; }
.sss-empty-btn.primary { background: #5E6AD2; border-color: #5E6AD2; color: #fff; }
.sss-empty-btn.primary:hover:not(:disabled) { background: #4F46E5; }
.sss-empty-btn:disabled { opacity: .5; cursor: not-allowed; }
.sss-error { font-size: 12.5px; color: #c0291f; margin-top: 12px; text-align: center; }
</style>
