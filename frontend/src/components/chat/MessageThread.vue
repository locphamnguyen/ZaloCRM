<template>
  <div
    class="message-thread"
    :class="{ 'drag-over': isDraggingFiles }"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDropFiles"
  >
    <!-- Empty state -->
    <div v-if="!conversation" class="empty-state">
      <v-icon icon="mdi-chat-outline" size="96" color="grey-lighten-2" />
      <p class="text-h6 mt-4">Chọn cuộc trò chuyện</p>
    </div>

    <template v-else>
      <div v-if="isDraggingFiles" class="drop-overlay">
        <div class="drop-card">
          <v-icon size="34" color="primary">mdi-cloud-upload-outline</v-icon>
          <div class="drop-title">Thả để gửi file</div>
          <div class="drop-subtitle">Hình ảnh, video và tài liệu sẽ được upload vào cuộc trò chuyện này</div>
        </div>
      </div>


      <!-- ════════ Chat header (Smax-style — 2 rows) ════════ -->
      <header class="chat-header">
        <div
          class="ch-avatar-wrap"
          :class="{ clickable: canClickHeader }"
          :title="canClickHeader ? 'Xem thông tin KH' : ''"
          @click="onHeaderAvatarClick"
        >
          <Avatar
            :src="headerAvatarSrc"
            :name="headerName"
            :size="46"
            :gender="contactGender"
            :is-group="conversation.threadType === 'group'"
            :gradient-seed="conversation.id"
          />
        </div>

        <div class="ch-info">
          <!-- Row 1: TÊN KH ưu tiên + Gender icon (Anh chốt 2026-06-03 layout 3 dòng) -->
          <div class="ch-row-1">
            <div
              class="ch-name"
              :class="{ clickable: canClickHeader }"
              :title="canClickHeader ? `Xem thông tin KH: ${headerName}` : headerName"
              @click="onHeaderAvatarClick"
            >{{ headerName }}</div>
            <span class="ch-gender-chip" :class="genderChipClass" :title="genderTitle">
              <svg v-if="conversation.threadType === 'group'" class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
              <svg v-else-if="contactGender === 'female'" class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M17 9.5C17 6.46 14.54 4 11.5 4S6 6.46 6 9.5c0 2.71 1.96 4.94 4.5 5.41V17H8v2h2.5v2.5h2V19H15v-2h-2.5v-2.09c2.54-.47 4.5-2.7 4.5-5.41zm-9 0C8 7.57 9.57 6 11.5 6S15 7.57 15 9.5S13.43 13 11.5 13S8 11.43 8 9.5z"/>
              </svg>
              <svg v-else-if="contactGender === 'male'" class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M19 4h-6v2h2.59l-4.13 4.13C10.65 9.42 9.36 9 8 9c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6c0-1.36-.42-2.65-1.13-3.74L17 7.41V10h2V4h0zM8 19c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z"/>
              </svg>
              <svg v-else class="gender-svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z"/>
              </svg>
              <span class="gender-label">{{ genderLabel }}</span>
            </span>
            <!-- Gom 2 dòng 2026-06-06 (Anh chốt): deal-stage lên dòng 1 cạnh gender. -->
            <ContactDealStageSelector
              v-if="conversation.contact"
              :contact-id="conversation.contact.id"
              :current-status-id="conversation.contact.statusId ?? null"
              :org-id="_authStore.user?.orgId ?? null"
              @updated="onDealStageUpdated"
            />
            <!-- Tag Zalo Real — dòng 1 PHÍA SAU trạng thái (Anh chốt 2026-06-06). -->
            <v-menu v-if="conversation.externalThreadId && conversation.zaloAccount" :close-on-content-click="false" location="bottom start">
              <template #activator="{ props: actProps }">
                <button v-bind="actProps" class="zlbl-trigger" :title="currentLabel ? `Đang gắn: ${currentLabel.text}` : 'Chưa gắn tag Zalo'">
                  <!-- Logo Zalo thật (brand đa màu) — ĐỒNG BỘ với TagCrmBar + cột 2 (Anh chốt 2026-06-06).
                       KHÔNG ép màu theo label; chỉ tên label mới ăn currentLabel.color. -->
                  <ZaloBrandIcon class="zlbl-icon" :size="14" />
                  <span v-if="currentLabel" class="zlbl-current-name" :style="`color: ${currentLabel.color}`">
                    {{ currentLabel.emoji ? currentLabel.emoji + ' ' : '' }}{{ currentLabel.text }}
                  </span>
                  <span v-else class="zlbl-empty">Phân loại</span>
                  <span class="zlbl-caret"><ChevronDownIcon :size="13" :stroke-width="2" /></span>
                </button>
              </template>
              <div class="zlbl-dropdown zalo-native">
                <div v-if="loadingAllLabels && !allLabels.length" class="zlbl-loading">Đang tải…</div>

                <div v-else-if="!allLabels.length" class="zlbl-empty-state">
                  Tài khoản chưa có thẻ phân loại nào.<br />
                  <button class="zlbl-inline-sync" @click="onSyncLabels"><RefreshCwIcon :size="13" :stroke-width="2" /> Đồng bộ từ Zalo</button>
                </div>

                <div v-else class="zlbl-options">
                  <button
                    v-for="lbl in allLabels"
                    :key="lbl.id"
                    class="zlbl-option"
                    :class="{ active: currentLabel?.id === lbl.id }"
                    @click="onPickLabel(lbl)"
                  >
                    <span class="zlbl-flag" :style="`color: ${lbl.color}`"><FlagIcon :size="13" :stroke-width="2" /></span>
                    <span class="zlbl-name">
                      <span v-if="lbl.emoji">{{ lbl.emoji }} </span>{{ lbl.text }}
                    </span>
                    <span v-if="currentLabel?.id === lbl.id" class="zlbl-check"><CheckIcon :size="13" :stroke-width="2.2" /></span>
                  </button>
                </div>

                <div class="zlbl-divider"></div>
                <button class="zlbl-manage" @click="goToLabelsSettings">
                  <span class="manage-icon"><SettingsIcon :size="14" :stroke-width="2" /></span>
                  Quản lý thẻ phân loại
                </button>
              </div>
            </v-menu>
          </div>

          <!-- Row 2: chip meta gom 1 dòng (cùng-chăm + tag Zalo + nick + số tin + online) -->
          <div class="ch-row-chips">
            <span
              v-if="cungChamCount >= 2"
              class="ch-cung-cham-chip"
              :title="cungChamTooltip"
            >🤝 {{ cungChamCount }} sale</span>
            <!-- Tag Zalo Real ĐÃ CHUYỂN lên dòng 1 (sau trạng thái) — Anh chốt 2026-06-06. -->
            <span class="ch-sep" v-if="cungChamCount >= 2">|</span>
            <!-- Gom 2 dòng 2026-06-06: nick + số tin + online dồn chung dòng 2 (cùng ch-row-chips).
                 nick switcher: click → dropdown TẤT CẢ nick (Cách B) cho sale switch nick chat với KH. -->
            <v-menu
              v-if="conversation.zaloAccount && conversation.contact?.id"
              :close-on-content-click="true"
              location="bottom start"
              @update:model-value="onNickMenuToggle"
            >
              <template #activator="{ props: nickProps }">
                <span class="nick-switcher" v-bind="nickProps" title="Chọn nick để chat với KH này">
                  <NickAvatarLock :privacy-mode="conversation.zaloAccount.privacyMode">
                    <Avatar
                      :src="conversation.zaloAccount.avatarUrl"
                      :name="conversation.zaloAccount.displayName || 'Nick'"
                      :size="22"
                      :gradient-seed="conversation.zaloAccount.id"
                      platform="zalo"
                    />
                  </NickAvatarLock>
                  <span class="nick-name">
                    {{ conversation.zaloAccount?.displayName || '—' }}
                  </span>
                  <span class="nick-caret"><ChevronDownIcon :size="13" :stroke-width="2" /></span>
                </span>
              </template>
              <div class="nick-dd-panel">
                <div class="nick-dd-header">Chọn nick chat với KH</div>
                <div v-if="loadingNickCoverage" class="nick-dd-loading">Đang tải...</div>
                <div v-else-if="nickCoverageList.length === 0" class="nick-dd-empty">
                  KH chưa được nick CRM nào kết bạn
                </div>
                <button
                  v-for="row in nickCoverageList"
                  :key="row.zaloAccountId"
                  class="nick-dd-item"
                  :class="{ active: row.zaloAccountId === conversation.zaloAccount?.id, switching: switchingToNickId === row.zaloAccountId }"
                  :disabled="switchingToNickId === row.zaloAccountId"
                  @click="onPickNick(row)"
                >
                  <Avatar
                    :src="row.avatarUrl"
                    :name="row.displayName || 'Nick'"
                    :size="28"
                    :gradient-seed="row.zaloAccountId"
                    platform="zalo"
                  />
                  <div class="nick-dd-info">
                    <div class="nick-dd-name">{{ row.displayName || '—' }}</div>
                    <div class="nick-dd-meta">
                      <span class="nick-dd-status" :class="`status-${row.friendshipStatus}`">
                        {{ friendshipStatusLabel(row.friendshipStatus) }}
                      </span>
                      <span v-if="row.zaloAccountId === conversation.zaloAccount?.id" class="nick-dd-current">đang dùng</span>
                    </div>
                  </div>
                </button>
              </div>
            </v-menu>
            <!-- Fallback nếu chưa có zaloAccount (legacy data) -->
            <template v-else>
              <NickAvatarLock v-if="conversation.zaloAccount" :privacy-mode="conversation.zaloAccount.privacyMode">
                <Avatar :src="conversation.zaloAccount.avatarUrl" :name="conversation.zaloAccount.displayName || 'Nick'" :size="22" :gradient-seed="conversation.zaloAccount.id" platform="zalo" />
              </NickAvatarLock>
              <span class="nick-name">{{ conversation.zaloAccount?.displayName || '—' }}</span>
            </template>
            <span class="ch-sep">|</span>
            <span
              class="msg-counts"
              :title="`Tin nhắn 1-1 RIÊNG cặp nick × KH này: ${msgInCount} đến / ${msgOutCount} gửi. (Tổng toàn KH ${contactTotalIn}/${contactTotalOut} qua mọi nick chăm)`"
            >
              <span class="cnt-in">{{ msgInCount }}</span><ArrowDownLeftIcon class="cnt-arrow" :size="12" :stroke-width="2" />
              <span class="cnt-out">{{ msgOutCount }}</span><ArrowUpRightIcon class="cnt-arrow" :size="12" :stroke-width="2" />
            </span>
            <!-- M53 2026-05-30: Virtual KH → chấm đỏ nháy + "KH chưa bật tìm kiếm Zalo công khai" -->
            <template v-if="isVirtualConv">
              <span class="ch-sep">|</span>
              <span class="last-online is-virtual" :title="virtualTooltip">
                <span class="online-dot" />
                {{ virtualStatusLabel }}
              </span>
            </template>
            <template v-else-if="showOnlineIndicator && lastOnlineLabel">
              <span class="ch-sep">|</span>
              <span class="last-online" :class="{ 'is-online': isOnline }">
                <span class="online-dot" />
                {{ lastOnlineLabel }}
              </span>
            </template>
          </div>
        </div>
        <!-- ch-actions: nút Kết bạn / menu ⋮ / ⓘ — đẩy phải dòng 1 (gom 2 dòng 2026-06-06) -->
        <div class="ch-actions">
          <!-- Smart friendship button: state-aware -->
          <!-- Đã kết bạn: hover hiện thêm nút Huỷ kết bạn (destructive secondary) -->
          <div v-if="friendshipState === 'friend'" class="friend-hover-group">
            <button class="btn-action btn-friend-already" disabled>
              <span class="ic"><UserCheckIcon :size="14" :stroke-width="2" /></span> Đã KB
              <span v-if="friendDaysLabel" class="sub-meta">{{ friendDaysLabel }}</span>
            </button>
            <button
              class="btn-action btn-remove-friend"
              :disabled="actionLoading"
              @click="onRemoveFriend"
            >
              <span class="ic"><UserXIcon :size="14" :stroke-width="2" /></span> Huỷ KB
            </button>
          </div>
          <!-- Sale đã gửi mời, đợi KH accept: primary "Đã mời" + secondary "Thu hồi" -->
          <template v-else-if="friendshipState === 'pending_sent' || friendshipState === 'pending_friend'">
            <button
              class="btn-action btn-pending"
              :title="pendingSentTooltip"
              disabled
            >
              <span class="ic"><SendIcon :size="14" :stroke-width="2" /></span> Đã mời <span class="sub-meta">{{ pendingDaysLabel }}</span>
            </button>
            <button
              class="btn-action btn-cancel-invite"
              title="Thu hồi lời mời kết bạn"
              :disabled="actionLoading"
              @click="onCancelInvite"
            >
              <span class="ic"><Undo2Icon :size="14" :stroke-width="2" /></span> Thu hồi
            </button>
          </template>
          <!-- KH đã gửi mời, sale chưa accept: primary "Chấp nhận" + secondary "Từ chối" -->
          <template v-else-if="friendshipState === 'pending_received'">
            <button
              class="btn-action btn-accept-friend"
              :title="pendingReceivedTooltip"
              :disabled="actionLoading"
              @click="onAcceptInvite"
            >
              <span class="ic"><HandIcon :size="14" :stroke-width="2" /></span> Chấp nhận <span class="sub-meta">{{ pendingDaysLabel }}</span>
            </button>
            <button
              class="btn-action btn-reject-invite"
              title="Từ chối lời mời kết bạn"
              :disabled="actionLoading"
              @click="onRejectInvite"
            >
              <span class="ic"><UserXIcon :size="14" :stroke-width="2" /></span> Từ chối
            </button>
          </template>
          <!-- 'ghost' = trước từng là friend, đã unfriend -->
          <button
            v-else-if="friendshipState === 'ghost'"
            class="btn-action btn-add-friend"
            title="KH đã huỷ kết bạn. Gửi lời mời lại?"
            :disabled="actionLoading"
            @click="onOpenInviteDialog"
          >
            <span class="ic"><RotateCcwIcon :size="14" :stroke-width="2" /></span> Mời lại
          </button>
          <button
            v-else-if="conversation.threadType === 'user'"
            class="btn-action btn-add-friend"
            title="Gửi lời mời kết bạn"
            :disabled="actionLoading"
            @click="onOpenInviteDialog"
          >
            <span class="ic"><UserPlusIcon :size="14" :stroke-width="2" /></span> Kết bạn
          </button>

          <!-- 2026-06-03 Anh chốt: ẩn Webhook button khỏi header (chưa cần).
               Function fireWebhook() + state webhookLoading vẫn giữ trong file
               để bật lại sau bằng cách un-comment block button trên. -->

          <!-- More dropdown: gộp Lịch sử / Tìm / Note -->
          <v-menu>
            <template #activator="{ props: act }">
              <button class="icon-btn" v-bind="act" title="Thêm"><MoreVerticalIcon :size="16" :stroke-width="2" /></button>
            </template>
            <v-list density="compact" min-width="220">
              <!-- 2026-06-06 (Anh chốt): toggle cột 4 (thông tin KH) đưa vào menu ... -->
              <v-list-item
                :prepend-icon="showContactPanel ? 'mdi-information' : 'mdi-information-outline'"
                :title="showContactPanel ? 'Ẩn thông tin KH (cột phải)' : 'Hiện thông tin KH (cột phải)'"
                @click="$emit('toggle-contact-panel')"
              />
              <v-divider />
              <v-list-item prepend-icon="mdi-history" title="Lịch sử hội thoại" @click="toast.push('Lịch sử: chưa implement')" />
              <v-list-item prepend-icon="mdi-magnify" title="Tìm trong hội thoại" @click="toast.push('Tìm: chưa implement')" />
              <v-list-item prepend-icon="mdi-note-edit-outline" title="Ghi chú nhanh" @click="onOpenNote" />
              <v-divider />
              <!-- Merge KH này vào KH khác (transfer Friends + delete source Contact) -->
              <v-list-item
                v-if="conversation.contact"
                prepend-icon="mdi-merge"
                title="Gắn vào KH Cha (merge)"
                @click="showLinkParentDialog = true"
              />
              <v-divider />
              <v-list-item prepend-icon="mdi-bell-off-outline" title="Tắt thông báo" @click="toast.push('Mute: chưa implement')" />
              <v-list-item prepend-icon="mdi-flag-outline" title="Báo cáo" @click="toast.push('Report: chưa implement')" />
            </v-list>
          </v-menu>
        </div>
      </header>

      <!-- M53 2026-05-30: Banner cam cho virtual conv — sticky top dưới header -->
      <div v-if="isVirtualConv" class="virtual-banner">
        <div class="virtual-banner-icon"><InfoIcon :size="14" :stroke-width="2" /></div>
        <div class="virtual-banner-body">
          <div class="virtual-banner-title">Chat nội bộ — tin nhắn KHÔNG gửi đi Zalo</div>
          <div class="virtual-banner-sub">
            Dùng để ghi nhật ký chăm sóc + đặt lịch hẹn. Trợ lý AI sẽ gợi ý câu hỏi khai thác thông tin KH cho anh/chị.
          </div>
        </div>
      </div>

      <!-- ════════ Messages ════════ -->
      <div ref="messagesContainer" class="messages chat-messages-area" :class="{ 'is-virtual-mode': isVirtualConv }">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />

        <template v-for="item in displayItems" :key="item.key">
          <!-- Date divider -->
          <div v-if="item.kind === 'divider'" class="msg-divider">{{ item.label }}</div>

          <!-- Album — Phase A UI fix (2026-05-21): thêm Avatar top-left khớp với
               message-bubble để align lề trái nhất quán. Sender name vào TRONG bubble. -->
          <div
            v-else-if="item.kind === 'album'"
            class="msg-album-wrap"
            :class="item.senderType === 'self' ? 'self' : ''"
            :data-album-msg-ids="item.messages.map(m => m.id).join(',')"
          >
            <Avatar
              v-if="item.senderType !== 'self'"
              :src="resolveSenderAvatar(item.messages[0])"
              :name="item.senderName || '?'"
              :size="32"
              :gradient-seed="item.messages[0]?.senderUid || item.senderName || ''"
              class="msg-avatar"
            />
            <div class="msg-album-body">
              <div class="bubble album">
                <div v-if="conversation.threadType === 'group' && item.senderType !== 'self'" class="album-sender">
                  {{ item.senderName || 'Unknown' }}
                </div>
                <div class="album-grid" :class="albumGridClass(item.messages.length)">
                  <img
                    v-for="m in item.messages"
                    :key="m.id"
                    :src="getImageUrl(m)!"
                    alt="Hình ảnh"
                    class="album-tile"
                    :data-msg-id="m.id"
                    :data-zalo-msg-id="m.zaloMsgId || ''"
                    @click="openImageLightbox(getImageUrl(m)!, item.messages.map(x => getImageUrl(x)!).filter(Boolean))"
                  />
                </div>
                <div v-if="item.totalExpected && item.totalExpected > item.messages.length" class="album-progress">
                  {{ item.messages.length }}/{{ item.totalExpected }} ảnh đã nhận
                </div>
                <div class="bubble-time">
                  {{ formatMessageTime(item.sentAt) }} · 🖼️ {{ item.messages.length }} ảnh
                </div>
              </div>
            </div>
          </div>

          <!-- Reminder notice — render inline timeline event (centered, no bubble) -->
          <div v-else-if="isReminderNotice(item.msg)" class="msg-system-event reminder-notice">
            <v-icon size="14" color="warning" class="mr-1">mdi-bell-ring</v-icon>
            <span>{{ reminderNoticeText(item.msg) }}</span>
            <span v-if="reminderNoticeTime(item.msg)" class="reminder-notice-time">· {{ reminderNoticeTime(item.msg) }}</span>
          </div>

          <!-- M53 2026-05-30: AI Trợ Lý bubble — render component riêng cho virtual chat -->
          <div
            v-else-if="item.msg.senderType === 'ai_assistant'"
            class="msg-bubble-wrap ai-msg-wrap"
            :data-msg-id="item.msg.id"
          >
            <AiAssistantMessage
              :message="item.msg"
              :contact-id="conversation.contact?.id || ''"
              :existing-contact="(conversation.contact as unknown as Record<string, unknown>) || null"
              @suggestion-applied="onAiSuggestionApplied($event, item.msg.id)"
            />
          </div>

          <!-- PRIVACY 2026-06-11 (audit C10) — FAIL-SAFE: khi tin bị blur, KHÔNG render
               MessageBubble với message thật (tránh content vào DOM, xoá class CSS là
               đọc). Thay bằng placeholder khoá, KHÔNG nhận nội dung. Backend đã redact
               server-side; đây là lớp 2 phòng backend sót. -->
          <div
            v-else-if="privacyVisibility.shouldBlurMessage(item.msg, conversation)"
            class="msg-bubble-wrap msg-privacy-locked"
            :class="{
              'msg-wrap-self': item.msg.senderType === 'self',
              'msg-wrap-other': item.msg.senderType !== 'self',
            }"
            :data-msg-id="item.msg.id"
            @click="onMessageLockClick($event)"
          >
            <div class="msg-locked-placeholder">
              <span class="mdi mdi-lock-outline msg-locked-icon"></span>
              <span class="msg-locked-text">Nội dung riêng tư — mở khoá để xem</span>
            </div>
          </div>

          <!-- Single message — MessageBubble component (chỉ khi KHÔNG blur) -->
          <div
            v-else
            class="msg-bubble-wrap"
            :class="{
              'msg-wrap-self': item.msg.senderType === 'self',
              'msg-wrap-other': item.msg.senderType !== 'self',
            }"
            :data-msg-id="item.msg.id"
            :data-zalo-msg-id="item.msg.zaloMsgId || ''"
          >
            <MessageBubble
              :message="item.msg"
              :reply="item.msg.reply || null"
              :reactions="item.msg.reactions || []"
              :is-self="item.msg.senderType === 'self'"
              :is-last-self="item.msg.id === lastSelfMessageId"
              :is-group="conversation.threadType === 'group'"
              :sender-avatar-url="resolveSenderAvatar(item.msg)"
              :current-user-id="currentUserId"
              @contextmenu="onContextMenu($event, item.msg)"
              @preview-image="openImageLightbox($event, [])"
              @preview-video="previewVideoUrl = $event"
              @toggle-reaction="onToggleReaction(item.msg, $event)"
              @sender-click="onSenderClick(item.msg)"
              @callback="onMessageCallback(item.msg)"
              @open-profile="onOpenProfileFromCard"
              @open-reaction-detail="onOpenReactionDetail"
              @jump-to-reply="jumpToReply"
            />
          </div>
        </template>

        <div v-if="!loading && messages.length === 0" class="text-center pa-8 text-grey">Chưa có tin nhắn</div>
      </div>

      <!-- Typing indicator -->
      <TypingIndicator :typers="currentTypers" />

      <!-- AI suggest bar -->
      <AISuggestBar
        :suggestion="aiSuggestion"
        :loading="aiSuggestionLoading"
        :error="aiSuggestionError"
        @use="applySuggestion"
        @refresh="$emit('ask-ai')"
      />

      <!-- ════════ Input area: toolbar trên textarea (Smax-style) ════════ -->
      <div class="input-area">
        <!-- Tag bar Friend-cấp (per-pair sale-nick × KH) — chỉ KH chat 1-1.
             Refactor 2026-06-01: 3 nhóm [Zalo Real] | [Auto] | [Manual per Nick + button].
             Đọc/ghi qua endpoint /api/v1/friends/:id/tags (Tag v2 junction). -->
        <TagCrmBar
          v-if="conversation.contact && conversation.threadType === 'user' && conversation.friendship?.id"
          :friend-id="conversation.friendship.id"
          :contact-id="conversation.contact.id"
        />

        <ReplyPreviewBar
          :message="(replyingTo || editingMessage) ?? null"
          :mode="editingMessage ? 'edit' : 'reply'"
          @cancel="onCancelReplyEdit"
        />

        <!-- Compact toolbar — Lucide icons (anh chốt 2026-05-22 — bộ icon đồng bộ line 1.5px) -->
        <div class="input-toolbar-top">
          <!-- Group 1: Media -->
          <StickerPicker @select="onSendSticker" />
          <button class="icon-tool" title="Gửi ảnh" @click="onPickImage">
            <ImageIcon :size="18" :stroke-width="1.5" />
          </button>
          <button class="icon-tool" title="Gửi file" @click="onPickFile">
            <PaperclipIcon :size="18" :stroke-width="1.5" />
          </button>
          <button class="icon-tool" title="Chèn ảnh từ Kho" @click="showMediaPicker = !showMediaPicker">
            <ImagesIcon :size="18" :stroke-width="1.5" />
          </button>
          <span class="toolbar-divider"></span>

          <!-- Group 2: Contact / format -->
          <button class="icon-tool" title="Gửi danh thiếp" @click="todoToast('Danh thiếp')">
            <ContactIcon :size="18" :stroke-width="1.5" />
          </button>
          <button
            class="icon-tool"
            :class="{ active: formatBarVisible }"
            :title="formatBarVisible ? 'Ẩn định dạng văn bản' : 'Hiện định dạng văn bản (B I U S ...)'"
            @click="toggleFormat"
          >
            <TypeIcon :size="18" :stroke-width="1.5" />
          </button>
          <span class="toolbar-divider"></span>

          <!-- Group 3: Productivity -->
          <button
            class="icon-tool"
            :class="{ active: showAppointmentDialog }"
            title="Tạo nhắc hẹn cho KH này"
            :disabled="!conversation.contact"
            @click="showAppointmentDialog = true"
          >
            <CalendarClockIcon :size="18" :stroke-width="1.5" />
          </button>
          <button class="icon-tool" title="Template tin nhắn (gõ /)" @click="openTemplatePopup">
            <ZapIcon :size="18" :stroke-width="1.5" />
          </button>
          <!-- M14 (2026-06-02) — Chèn Khối "Gửi tin nhắn" từ Automation Blocks vào composer.
               Ẩn ở group thread (memory feedback_crm_filter_1to1_not_group: Block 1-1 only).
               Disable khi composer bị Privacy lock hoặc đang edit message để tránh ghi đè text edit. -->
          <button
            v-if="conversation.threadType === 'user'"
            class="icon-tool"
            title="Chèn Khối tin nhắn (Automation Blocks)"
            :disabled="!privacyVisibility.canSendInConv(conversation) || !!editingMessage"
            @click="openBlockPicker"
          >
            <PackageIcon :size="18" :stroke-width="1.5" />
          </button>
          <button class="icon-tool ai-btn" title="AI compose" :disabled="aiSuggestionLoading" @click="$emit('ask-ai')">
            <SparklesIcon :size="18" :stroke-width="1.5" />
          </button>
        </div>

        <div class="input-row">
          <!-- Avatar nick đang gửi — OUTSIDE editor (góc trái), halo gradient cam-đỏ-vàng -->
          <NickAvatarLock
            v-if="conversation.zaloAccount"
            :privacy-mode="conversation.zaloAccount.privacyMode"
          >
          <div
            class="nick-avatar-halo"
            :title="`Tin nhắn này được gửi đi từ ${conversation.zaloAccount.displayName || 'nick Zalo'}`"
          >
            <Avatar
              :src="conversation.zaloAccount.avatarUrl"
              :name="conversation.zaloAccount.displayName || 'Nick'"
              :size="36"
              :gradient-seed="conversation.zaloAccount.id"
              platform="zalo"
              class="sender-nick-avatar"
            />
          </div>
          </NickAvatarLock>

          <div ref="editorWrapRef" class="editor-wrap" :class="{ 'editor-locked': !privacyVisibility.canSendInConv(conversation) }">
            <QuickTemplatePopup
              ref="templatePopupRef"
              :visible="showTemplatePopup"
              :query="templateQuery"
              :templates="templates"
              :contact="conversation.contact"
              :sale-full-name="_authStore.user?.fullName ?? null"
              :anchor-el="editorWrapRef"
              @select="onTemplateSelect"
              @close="showTemplatePopup = false"
            />
            <RichTextEditor
              ref="editorRef"
              v-model="inputText"
              :placeholder="inputPlaceholder"
              :show-toolbar="formatBarVisible"
              :intercept-keys="onComposerNavKey"
              class="input-editor"
              @submit="handleSend"
              @typing="onTypingEvent"
              @paste-image="onPasteImage"
            />
            <!-- Privacy lock overlay — chỉ phủ input editor, KHÔNG che toolbar bên ngoài -->
            <div
              v-if="!privacyVisibility.canSendInConv(conversation)"
              class="editor-lock-overlay"
              @click.stop="onComposerLockClick"
            >
              <span class="editor-lock-pill">🔒 Riêng tư — chỉ chính chủ nick gửi được tin</span>
            </div>
          </div>

          <!-- Emoji picker (hover) — sát nút Gửi -->
          <EmojiPicker @pick="onPickEmoji" />

          <!-- M53 2026-05-30: virtual conv → nút "Lưu nội bộ" màu cam thay vì "Gửi" xanh -->
          <button
            class="send-btn"
            :class="{ 'send-btn-virtual': isVirtualConv }"
            :disabled="!inputText.trim() || sending"
            @click="handleSend"
            :title="isVirtualConv ? 'Lưu nội bộ (Enter) — KHÔNG gửi đi Zalo' : 'Gửi (Enter)'"
          >
            <v-icon v-if="sending" size="20">mdi-loading mdi-spin</v-icon>
            <template v-else-if="isVirtualConv">
              <v-icon size="18">mdi-pencil</v-icon>
              <span class="send-btn-virtual-label">Lưu nội bộ</span>
            </template>
            <v-icon v-else size="20">mdi-send</v-icon>
          </button>
        </div>

        <!-- 2026-06-04 — Khối Phase 1 MVP picker với Preview + Send direct -->
        <BlockPickerPopup
          :visible="showBlockPicker"
          :contact="conversation.contact ? {
            fullName: conversation.contact.fullName,
            gender: (conversation.contact as any).gender ?? null,
            phone: conversation.contact.phone ?? null,
          } : null"
          :current-user-name="_authStore.user?.fullName ?? null"
          :owner-nick-id="conversation.zaloAccount?.id ?? null"
          @preview="onBlockPreview"
          @send-direct="onBlockSendDirect"
          @close="showBlockPicker = false"
        />

        <!-- 2026-06-04 — Preview dialog (Mockup 4) -->
        <BlockPreviewDialog
          v-if="previewBlock"
          :visible="!!previewBlock"
          :block="previewBlock"
          :contact-name="conversation.contact?.fullName || 'KH'"
          :nick-name="conversation.zaloAccount?.displayName || 'Nick'"
          @send="onConfirmSendBlock"
          @close="previewBlock = null"
        />

        <!-- Modal "Nhắc hẹn" — unified UI giống trang /appointments -->
        <AppointmentEditor
          v-model="showAppointmentDialog"
          :prefill-contact="conversation.contact ? {
            id: conversation.contact.id,
            fullName: conversation.contact.fullName,
            phone: conversation.contact.phone,
            zaloUid: conversation.contact.zaloUid ?? null,
            zaloUsername: (conversation.contact as any).zaloUsername ?? null,
          } : null"
          :current-user-id="currentUserId"
          @created="onAppointmentCreated"
        />

        <!-- Gợi ý ảnh kho theo ngữ cảnh khách (GĐ3a-4) -->
        <div v-if="mediaSuggestions.length" class="media-suggest-bar">
          <span class="ms-label">✨ Gợi ý ảnh dự án:</span>
          <button
            v-for="a in mediaSuggestions" :key="a.id"
            class="ms-chip" :disabled="sendingSuggestId === a.id"
            :title="'Gửi: ' + a.name"
            @click="sendSuggestion(a)"
          >
            <img v-if="a.thumbnailUrl" :src="a.thumbnailUrl" alt="" />
            <span class="ms-name">{{ a.name }}</span>
          </button>
        </div>

        <!-- Picker chèn ảnh từ Kho phương tiện (GĐ2) -->
        <MediaPickerPopover
          v-if="showMediaPicker && conversation?.id"
          :conversation-id="conversation.id"
          @close="showMediaPicker = false"
          @sent="showMediaPicker = false"
        />

        <!-- Hidden file inputs cho upload ảnh / file -->
        <input
          ref="imageInputRef"
          type="file"
          accept="image/*"
          multiple
          style="display: none"
          @change="onImageFilesPicked"
        />
        <input
          ref="fileInputRef"
          type="file"
          multiple
          style="display: none"
          @change="onFileFilesPicked"
        />
      </div>
    </template>

    <!-- Context menu -->
    <MessageContextMenu
      v-model="showContextMenu"
      :message="contextMsg"
      :is-self="contextMsg?.senderType === 'self'"
      :position="contextPos"
      @reply="onReply"
      @edit="onEdit"
      @delete="onDelete"
      @undo="onUndo"
      @forward="showForwardDialog = true"
      @save-media="onSaveToMedia"
      @favorite-media="onFavoriteFromChat"
      @copy="() => {}"
    />

    <!-- Forward dialog — v-if gate (Phase A perf 2026-05-21): chỉ mount khi user
         bấm forward. Trước fix: dialog mount sẵn → `allConversations` prop từ
         ChatView trigger reactive update mỗi lần tab switch (100 conv objects).
         Sau fix: prop chỉ đọc 1 lần khi dialog mở. -->
    <ForwardDialog
      v-if="showForwardDialog"
      v-model="showForwardDialog"
      :conversations="allConversations ?? []"
      :source-zalo-account-id="conversation?.zaloAccount?.id ?? null"
      :source-nick-label="conversation?.zaloAccount?.displayName ?? null"
      :current-conversation-id="conversation?.id ?? null"
      @forward="onForward"
    />

    <!-- E07 Image lightbox — anh chốt 2026-05-21: nút ‹ › + arrow keys điều hướng,
         KHÔNG loop (đến đầu/cuối thì disable nút). Single-ảnh: ẩn nút điều hướng. -->
    <v-dialog v-model="showImagePreview" max-width="1100" content-class="elevation-0" @keydown="onLightboxKey">
      <div class="lightbox-wrap" @click.self="showImagePreview = false">
        <button
          v-if="lightboxList.length > 1"
          class="lightbox-nav lightbox-prev"
          :disabled="lightboxIndex <= 0"
          title="Ảnh trước (←)"
          @click.stop="lightboxPrev"
        ><ChevronLeftIcon :size="28" :stroke-width="2" /></button>
        <img :src="previewImageUrl" alt="Preview" class="lightbox-img" />
        <button
          v-if="lightboxList.length > 1"
          class="lightbox-nav lightbox-next"
          :disabled="lightboxIndex >= lightboxList.length - 1"
          title="Ảnh sau (→)"
          @click.stop="lightboxNext"
        ><ChevronRightIcon :size="28" :stroke-width="2" /></button>
        <div class="lightbox-meta">
          <span v-if="lightboxList.length > 1">{{ lightboxIndex + 1 }} / {{ lightboxList.length }} ·</span>
          Nhấn vùng tối để đóng
        </div>
      </div>
    </v-dialog>

    <!-- E08 Video preview popup — anh chốt 2026-05-21: play TRONG modal, KHÔNG mở tab mới.
         autoplay + controls, click ngoài video để đóng. -->
    <v-dialog v-model="showVideoPreview" max-width="900" content-class="elevation-0">
      <div class="text-center" @click.self="showVideoPreview = false" style="cursor: pointer; padding: 16px;">
        <video
          v-if="previewVideoUrl"
          :src="previewVideoUrl"
          controls
          autoplay
          playsinline
          style="max-width: 100%; max-height: 85vh; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.5); background: #000;"
        />
        <div class="text-caption mt-2" style="color: #aaa;">Nhấn ngoài video để đóng</div>
      </div>
    </v-dialog>

    <!-- Zalo user info dialog — click avatar/sender trong group → mở -->
    <ZaloUserInfoDialog
      v-model="userInfoDialog"
      :uid="userInfoUid"
      :zalo-account-id="conversation?.zaloAccount?.id || ''"
    />

    <!-- Link parent dialog -->
    <LinkParentDialog
      v-if="conversation?.contact"
      v-model="showLinkParentDialog"
      :child-contact-id="conversation.contact.id"
      @linked="onLinkedParent"
    />

    <!-- Friend invite dialog: nhập lời chào gửi kèm lời mời kết bạn -->
    <FriendInviteDialog
      v-model="showInviteDialog"
      :receiver-name="headerName"
      :loading="actionLoading"
      @submit="onSendInviteSubmit"
    />

    <!-- Reaction detail popup — Zalo native style, anh chốt 2026-05-22 -->
    <ReactionDetailPopup
      v-model="reactionPopupOpen"
      :reactions="reactionPopupReactions"
      :details="reactionPopupDetails"
    />

    <!-- Phase Privacy OTP 2026-05-27 — modal OTP thay PIN dialog cũ -->
    <PrivacyUnlockOtpModal
      :open="privacyUnlockOpen"
      @close="privacyUnlockOpen = false"
      @unlocked="onPrivacyUnlocked"
    />
    <PrivacyViewerDialog
      v-model="privacyViewerOpen"
      :nick="privacyDialogNick"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onBeforeUnmount } from 'vue';
import type { Conversation, Message } from '@/composables/use-chat';
import { formatInOrgTz, weekdayInOrgTz, getOrgParts } from '@/composables/use-org-timezone';
import { api } from '@/api/index';
import { saveFromChat, suggestMedia, sendMediaToConversation, toggleFavorite, type MediaAssetItem } from '@/api/media';
import MediaPickerPopover from '@/components/media/MediaPickerPopover.vue';
import AISuggestBar from '@/components/chat/AISuggestBar.vue';
// Mission Fix 2 (2026-05-30) — header picker GHI `Contact.statusId` (FK Status table)
// để Wave 3 evaluateStatusGate đọc đúng cột. Trước đây CareStatusBadge ghi enum legacy
// `Contact.status` khiến lazy gate KHÔNG kích hoạt. CareStatusBadge giữ ở ChatContactPanel.vue
// nếu sale vẫn cần thao tác care-status legacy 9 giá trị.
import ContactDealStageSelector from '@/components/chat/ContactDealStageSelector.vue';
import ZaloBrandIcon from '@/components/icons/ZaloBrandIcon.vue';
import Avatar from '@/components/ui/Avatar.vue';
import EmojiPicker from '@/components/chat/EmojiPicker.vue';
import QuickTemplatePopup from '@/components/chat/quick-template-popup.vue';
import BlockPreviewDialog from '@/components/chat/BlockPreviewDialog.vue';
// M14 (2026-06-02) — Popup chọn "Khối tin nhắn" từ Automation Blocks
import BlockPickerPopup from '@/components/chat/BlockPickerPopup.vue';
import MessageBubble from '@/components/chat/message-bubble.vue';
// M53 2026-05-30: Trợ lý AI cho virtual chat
import AiAssistantMessage from '@/components/chat/AiAssistantMessage.vue';
import ReactionDetailPopup from '@/components/chat/reaction-detail-popup.vue';
import { usePrivacyVisibility } from '@/composables/use-privacy-visibility';
import NickAvatarLock from '@/components/privacy/NickAvatarLock.vue';
// Phase Privacy OTP 2026-05-27 — swap PIN dialog → OTP modal
import PrivacyUnlockOtpModal from '@/components/privacy/PrivacyUnlockOtpModal.vue';
import PrivacyViewerDialog from '@/components/privacy/PrivacyViewerDialog.vue';
import { useAuthStore as _useAuthStorePriv } from '@/stores/auth';

// Privacy dialog state — anh chốt 2026-05-22 v3
const privacyUnlockOpen = ref(false);
const privacyViewerOpen = ref(false);
const privacyDialogNick = ref<{ displayName?: string | null; avatarUrl?: string | null; zaloUid?: string | null } | null>(null);
const _authStorePriv = _useAuthStorePriv();

function openPrivacyDialog(conv: any) {
  if (!conv?.zaloAccount) return;
  const nickInfo = {
    displayName: conv.zaloAccount.displayName,
    avatarUrl: conv.zaloAccount.avatarUrl,
    zaloUid: conv.zaloAccount.zaloUid,
  };
  privacyDialogNick.value = nickInfo;
  // Owner → UnlockDialog (PIN keypad). Non-owner → ViewerDialog (read-only).
  const myId = _authStorePriv.user?.id;
  const isOwner = !!myId && conv.zaloAccount.ownerUserId === myId;
  if (isOwner) privacyUnlockOpen.value = true;
  else privacyViewerOpen.value = true;
}
function onPrivacyUnlocked() {
  // Sau khi unlock — refetch messages để load lại content unlocked
  if (props.conversation?.id) {
    // emit a fetch hint or rely on FE socket; for now just close — refresh sẽ tự load
    privacyUnlockOpen.value = false;
  }
}

// Lucide icons (anh chốt 2026-05-22 — bộ icon đồng bộ thay MDI)
import {
  Images as ImagesIcon,
  Image as ImageIcon,
  Paperclip as PaperclipIcon,
  Contact as ContactIcon,
  Type as TypeIcon,
  CalendarClock as CalendarClockIcon,
  Zap as ZapIcon,
  Sparkles as SparklesIcon,
  Package as PackageIcon,
  // Header action + chrome icons (anh chốt 2026-06-08 — bỏ emoji thô, đồng bộ Lucide)
  UserPlus as UserPlusIcon,
  UserCheck as UserCheckIcon,
  UserX as UserXIcon,
  Undo2 as Undo2Icon,
  Hand as HandIcon,
  RotateCcw as RotateCcwIcon,
  MoreVertical as MoreVerticalIcon,
  ChevronDown as ChevronDownIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  RefreshCw as RefreshCwIcon,
  Settings as SettingsIcon,
  ArrowDownLeft as ArrowDownLeftIcon,
  ArrowUpRight as ArrowUpRightIcon,
  Info as InfoIcon,
  Check as CheckIcon,
  Flag as FlagIcon,
  Send as SendIcon,
} from 'lucide-vue-next';

// Reaction detail popup state — anh chốt 2026-05-22: click reaction box → popup
const reactionPopupOpen = ref(false);
const reactionPopupReactions = ref<Array<{ emoji: string; count: number; reacted: boolean }>>([]);
const reactionPopupDetails = ref<Array<{ userId: string; userName?: string | null; emoji: string; source?: 'crm' | 'zalo' }>>([]);
function onOpenReactionDetail(payload: { reactions: any[]; message: Message }) {
  reactionPopupReactions.value = payload.reactions;
  // Build details từ message.reactions (raw row per-user per-emoji)
  const raw = (payload.message as any).reactions ?? [];
  reactionPopupDetails.value = raw.map((r: any) => ({
    userId: r.reactorId || r.userId || '',
    userName: r.reactorName || r.userName || null,
    emoji: r.emoji,
    source: r.reactorSource || r.source,
  }));
  reactionPopupOpen.value = true;
}

const privacyVisibility = usePrivacyVisibility();
function onMessageLockClick(_e: MouseEvent) {
  // Anh chốt 2026-05-22 v3: click bubble blur → mở dialog (Owner unlock / Viewer read-only)
  openPrivacyDialog(props.conversation);
}
function onComposerLockClick() {
  openPrivacyDialog(props.conversation);
}
import StickerPicker from '@/components/chat/StickerPicker.vue';
import ZaloUserInfoDialog from '@/components/chat/ZaloUserInfoDialog.vue';
import LinkParentDialog from '@/components/chat/LinkParentDialog.vue';
import MessageContextMenu from '@/components/chat/message-context-menu.vue';
import TypingIndicator from '@/components/chat/typing-indicator.vue';
import ReplyPreviewBar from '@/components/chat/reply-preview-bar.vue';
import ForwardDialog from '@/components/chat/forward-dialog.vue';
import RichTextEditor from '@/components/chat/rich-text-editor.vue';
import TagCrmBar from '@/components/chat/TagCrmBar.vue';
import AppointmentEditor from '@/components/appointments/AppointmentEditor.vue';
import { useAuthStore } from '@/stores/auth';

const _authStore = useAuthStore();
const currentUserId = computed<string | null>(() => _authStore.user?.id ?? null);
import FriendInviteDialog from '@/components/chat/FriendInviteDialog.vue';
import { useToast } from '@/composables/use-toast';
import { useZaloPresence } from '@/composables/use-zalo-presence';
import { useZaloFriendStatus } from '@/composables/use-zalo-friend-status';
import { useFriendSocket } from '@/composables/use-friend-socket';
import { groupAvatarStore } from '@/composables/use-group-avatar-cache';
import { registerPendingTags, clearPendingTags } from '@/composables/use-pending-mutations';

interface TemplateItem {
  id: string; name: string; shortcut?: string | null; content: string; category: string | null; isPersonal: boolean;
  contentRich?: { text: string; styles?: Array<{ st: string; start: number; len: number }> } | null;
  tagIds?: string[];
}

const props = defineProps<{
  conversation: Conversation | null;
  messages: Message[];
  loading: boolean;
  sending: boolean;
  showContactPanel?: boolean;
  aiSuggestion: string;
  aiSuggestionLoading: boolean;
  aiSuggestionError: string;
  allConversations?: Conversation[];
  replyingTo?: Message | null;
  editingMessage?: Message | null;
  typingUsers?: { userId: string; userName: string }[];
}>();

const emit = defineEmits<{
  send: [content: string, replyMessageId?: string | null, styles?: Array<{ st: string; start: number; len: number }>];
  'toggle-contact-panel': [];
  'ask-ai': [];
  'add-reaction': [msgId: string, reaction: string];
  'remove-reaction': [msgId: string, reaction: string];
  'delete-message': [msgId: string];
  'undo-message': [msgId: string];
  'edit-message': [msgId: string, content: string];
  'forward-message': [msgId: string, targetIds: string[]];
  'set-reply-to': [msg: Message];
  'set-editing': [msg: Message];
  'cancel-reply-edit': [];
  'typing': [];
  'refresh-thread': [];
  'care-status-changed': [value: string];
  // Sprint v3 Tuần 3 Row 6.9 (2026-06-03): sale chọn nick khác → ChatView navigate.
  'switch-conversation': [convId: string];
}>();

const toast = useToast();
const inputText = ref('');
const messagesContainer = ref<HTMLElement | null>(null);
const previewImageUrl = ref('');
const showImagePreview = computed({ get: () => !!previewImageUrl.value, set: (v) => { if (!v) { previewImageUrl.value = ''; lightboxList.value = []; lightboxIndex.value = 0; } } });
// E07 Lightbox state — list ảnh trong album hiện tại + index ảnh đang xem.
// Empty list = single ảnh (không show nút điều hướng).
const lightboxList = ref<string[]>([]);
const lightboxIndex = ref(0);

function openImageLightbox(url: string, list: string[] = []): void {
  lightboxList.value = list;
  lightboxIndex.value = Math.max(0, list.indexOf(url));
  previewImageUrl.value = url;
}
function lightboxPrev(): void {
  if (lightboxIndex.value > 0) {
    lightboxIndex.value -= 1;
    previewImageUrl.value = lightboxList.value[lightboxIndex.value];
  }
}
function lightboxNext(): void {
  if (lightboxIndex.value < lightboxList.value.length - 1) {
    lightboxIndex.value += 1;
    previewImageUrl.value = lightboxList.value[lightboxIndex.value];
  }
}
function onLightboxKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { lightboxPrev(); e.preventDefault(); }
  else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { lightboxNext(); e.preventDefault(); }
  else if (e.key === 'Escape') { showImagePreview.value = false; }
}

// E08 — Video popup modal (anh chốt 2026-05-21: play inline, không mở tab)
const previewVideoUrl = ref('');
const showVideoPreview = computed({ get: () => !!previewVideoUrl.value, set: (v) => { if (!v) previewVideoUrl.value = ''; } });
const webhookLoading = ref(false);

// E17/E18 — Cuộc gọi nhỡ "Gọi lại". Copy phone của conv contact để sale dial nhanh.
function onMessageCallback(_msg: Message) {
  const phone = props.conversation?.contact?.phone;
  if (phone) {
    navigator.clipboard?.writeText(phone).catch(() => {});
    toast.success(`Đã copy SĐT ${phone} — dán vào app gọi`);
  } else {
    toast.warning('Liên hệ này chưa có SĐT trong CRM');
  }
}

// Context menu state
const showContextMenu = ref(false);
const contextMsg = ref<Message | null>(null);
const contextPos = ref({ x: 0, y: 0 });
const showForwardDialog = ref(false);
const showLinkParentDialog = ref(false);

async function onLinkedParent() {
  toast.success('Đã merge KH này vào KH Cha — conversations + friends đã chuyển');
  emit('refresh-thread');
}
const editorRef = ref<InstanceType<typeof RichTextEditor> | null>(null);
const editorWrapRef = ref<HTMLElement | null>(null); // anchor cho QuickTemplatePopup (Teleport ra body)
const templatePopupRef = ref<InstanceType<typeof QuickTemplatePopup> | null>(null);
const currentTypers = computed(() => props.typingUsers || []);

// 2026-05-22 anh chốt Zalo native UX: chỉ tin OUTGOING CUỐI CÙNG mới hiện
// receipt indicator (delivered/seen). Tin cuối đã seen → ngầm hiểu tin trên cũng seen
// (Zalo semantics). Tránh chèn vào timestamp + duplicate UI.
const lastSelfMessageId = computed<string | null>(() => {
  const list = props.messages;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.senderType === 'self' && !list[i]?.isDeleted) return list[i].id;
  }
  return null;
});

// ── Jump-to-quoted-message — click vào reply card → scroll tới tin gốc + highlight ─
// DOM direct manipulation để work cho cả single bubble lẫn album tile (mỗi tile
// trong album KHÔNG render qua MessageBubble component, chỉ là <img> trong wrap).
let jumpHighlightTimer: ReturnType<typeof setTimeout> | null = null;

function jumpToReply(replyMsgId: string) {
  // replyMsgId là zaloMsgId (Snowflake từ Zalo) — match với message.zaloMsgId
  const target = props.messages.find((m) => m.zaloMsgId === replyMsgId);
  if (!target) {
    toast.push('Tin gốc không có trong khung chat (có thể nằm ngoài 50 tin gần nhất)');
    return;
  }
  // Query DOM — `data-msg-id` có trên `.msg-bubble-wrap` (single) + `.album-tile` (album).
  const el = document.querySelector(`[data-msg-id="${target.id}"]`) as HTMLElement | null;
  if (!el) {
    toast.push('Tin gốc không có trong khung chat hiện tại');
    return;
  }
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });

  // Highlight wrap chứa element — `.msg-bubble-wrap` cho single, `.msg-album-wrap` cho album.
  const wrap = el.closest('.msg-bubble-wrap, .msg-album-wrap') as HTMLElement | null;
  if (!wrap) return;
  wrap.classList.add('msg-jump-highlight');
  if (jumpHighlightTimer) clearTimeout(jumpHighlightTimer);
  jumpHighlightTimer = setTimeout(() => {
    wrap.classList.remove('msg-jump-highlight');
    jumpHighlightTimer = null;
  }, 2000);
}

// ── Header derived data (Avatar handles initials/gradient/gender) ──────────
// B7 fix — Contact stub "Unknown" fallback chain qua zaloDisplayName Friend.
function _isUsableName(s: string | null | undefined): s is string {
  return !!s && s.trim().length > 0 && s.trim().toLowerCase() !== 'unknown';
}
const headerName = computed(() => {
  if (props.conversation?.threadType === 'group') {
    const groupName = (props.conversation as { groupName?: string }).groupName;
    if (_isUsableName(groupName)) return groupName!;
    if (_isUsableName(props.conversation?.contact?.fullName)) return props.conversation!.contact!.fullName!;
    return 'Nhóm Zalo';
  }
  // Ưu tiên Tên gợi nhớ Zalo (Friend.aliasInNick) — sync 2-way với Zalo Real.
  // UI khớp với Zalo Real để sale nhận diện KH bằng cùng 1 tên.
  if (_isUsableName(props.conversation?.friendship?.aliasInNick)) {
    return props.conversation!.friendship!.aliasInNick!;
  }
  if (_isUsableName(props.conversation?.contact?.fullName)) {
    return props.conversation!.contact!.fullName!;
  }
  const friendship = props.conversation?.friendship as { zaloDisplayName?: string | null } | undefined;
  if (_isUsableName(friendship?.zaloDisplayName)) return friendship!.zaloDisplayName!;
  return 'Unknown';
});
const headerAvatarSrc = computed(() => {
  if (props.conversation?.threadType === 'group') {
    return (props.conversation as { groupAvatarUrl?: string }).groupAvatarUrl || null;
  }
  // B7 — fallback avatar Zalo của Friend nếu Contact.avatarUrl chưa có
  const friendship = props.conversation?.friendship as { zaloAvatarUrl?: string | null } | undefined;
  return props.conversation?.contact?.avatarUrl
    || friendship?.zaloAvatarUrl
    || null;
});
const contactGender = computed(() => props.conversation?.contact?.gender || null);

const genderLabel = computed(() => {
  if (props.conversation?.threadType === 'group') return 'Nhóm';
  if (contactGender.value === 'female') return 'Nữ';
  if (contactGender.value === 'male') return 'Nam';
  return 'Chưa rõ';
});
const genderTitle = computed(() => {
  if (props.conversation?.threadType === 'group') return 'Nhóm hội thoại';
  return `Giới tính: ${genderLabel.value}`;
});
const genderChipClass = computed(() => {
  if (props.conversation?.threadType === 'group') return 'gender-group';
  if (contactGender.value === 'female') return 'gender-female';
  if (contactGender.value === 'male') return 'gender-male';
  return 'gender-unknown';
});

// ── Message counts (per-pair, lấy từ contact aggregate cho user thread) ──────
// Per-pair counter (Friend.totalInbound/Outbound) cho cặp nick × KH HIỆN TẠI.
// KHÔNG fallback contact aggregate — conv mới chưa có msg thì hiện 0 mới đúng,
// còn aggregate tổng across nicks chỉ dùng tooltip để sale biết bối cảnh.
const msgInCount = computed(() => props.conversation?.friendship?.totalInbound ?? 0);

/* ── Zalo Real labels — Zalo-native dropdown UX ─────────────────────────
 * - allLabels: master list của account (fetch GET /zalo-accounts/:id/labels)
 * - currentLabel: label đang gán cho friend (lấy từ conversation.friendship.zaloLabels[0])
 * - Single-select: click 1 label → POST /friends/:friendId/zalo-label {labelId}
 *   Nếu label đó đang active → click sẽ unassign (labelId=null).
 * - Sync 2-way: trigger /labels/touch (cooldown 5s) khi conversation đổi.
 * ───────────────────────────────────────────────────────────────────── */
type AccountLabelView = {
  id: number;
  text: string;
  color: string;
  emoji: string | null;
  offset: number;
  assignedCount: number;
  assignedTo?: boolean;  // server flag — true nếu thread hiện tại đang gắn label này
};

const allLabels = ref<AccountLabelView[]>([]);
const loadingAllLabels = ref(false);

// currentLabel: tìm label có assignedTo=true (do BE trả về khi pass threadId).
// Fallback: nếu allLabels chưa load, dùng friendship.zaloLabels[0] (chỉ cho user threads).
const currentLabel = computed<AccountLabelView | null>(() => {
  const fromList = allLabels.value.find(l => l.assignedTo);
  if (fromList) return fromList;
  const fs = props.conversation?.friendship;
  const labels = Array.isArray(fs?.zaloLabels) ? fs!.zaloLabels : [];
  if (!labels.length) return null;
  const first = labels[0] as { id?: number | string; name?: string; color?: string; emoji?: string };
  return {
    id: Number(first.id) || 0,
    text: first.name || '—',
    color: first.color || '#999',
    emoji: first.emoji || null,
    offset: 0,
    assignedCount: 0,
  };
});

async function fetchAllLabels(accountId: string, threadId?: string | null) {
  if (!accountId) return;
  loadingAllLabels.value = true;
  try {
    const { api: apiClient } = await import('@/api/index');
    const query = threadId ? `?threadId=${encodeURIComponent(threadId)}` : '';
    const { data } = await apiClient.get(`/zalo-accounts/${accountId}/labels${query}`);
    allLabels.value = (data.labels || []) as AccountLabelView[];
  } catch (err) {
    console.error('[zalo-labels] fetch all error', err);
  } finally {
    loadingAllLabels.value = false;
  }
}

/* Sync-on-demand: khi đổi conversation → touch endpoint (cooldown 5s server-side).
 * Sau touch xong → re-fetch master list với threadId hiện tại để có assignedTo flag. */
async function touchAccountSync(accountId: string, threadId?: string | null) {
  if (!accountId) return;
  try {
    const { api: apiClient } = await import('@/api/index');
    await apiClient.post(`/zalo-accounts/${accountId}/labels/touch`);
    await fetchAllLabels(accountId, threadId);
    window.dispatchEvent(new CustomEvent('zalo-labels-synced', { detail: { accountId } }));
  } catch (err) {
    // Silent — touch luôn 200 ngay cả khi error
  }
}

/* Fire-and-forget: pull fresh profile (gender, phone, birthday, hasZalo, zaloDisplayName,
 * avatar) từ Zalo SDK khi user click conv. Backend cooldown 5min/conv.
 * Patch chỉ field còn NULL trong DB — không đè giá trị sale đã chỉnh. */
async function touchConversationProfile(convId: string) {
  if (!convId) return;
  try {
    const { api: apiClient } = await import('@/api/index');
    await apiClient.post(`/conversations/${convId}/touch-profile`);
  } catch {
    // Silent — touch profile chỉ là background enrichment
  }
}

// Watch conversation switch → sync labels (cooldown 5s server-side) + fetch master list cho thread hiện tại
watch(() => props.conversation?.id, (newId, oldId) => {
  if (!newId || newId === oldId) return;
  const accId = props.conversation?.zaloAccount?.id;
  const threadId = props.conversation?.externalThreadId;
  if (accId) {
    void fetchAllLabels(accId, threadId);  // BE trả assignedTo flag cho thread hiện tại
    void touchAccountSync(accId, threadId);
    void touchConversationProfile(newId);  // refresh contact profile from SDK
  }
  void loadMediaSuggestions(); // gợi ý ảnh kho theo tag khách (GĐ3a-4)
}, { immediate: true });

/* Optimistic UI FULL: update cả allLabels (dropdown ✓) + friendship.crmTagsPerNick
 * (tag bar cột 3 + ConversationList cột 2) NGAY khi click.
 * Tránh "show tag cũ vài giây rồi mới sang tag mới" — full snap immediately.
 * API call background; rollback nếu fail. */
async function onPickLabel(label: AccountLabelView) {
  const accId = props.conversation?.zaloAccount?.id;
  const threadId = props.conversation?.externalThreadId;
  if (!accId || !threadId) return;

  // Toggle: nếu đang active → unassign (null), ngược lại assign labelId
  const labelId = currentLabel.value?.id === label.id ? null : label.id;

  // ── Snapshots cho rollback nếu fail ─────────────────────────────────
  const snapshotAllLabels = allLabels.value.map(l => ({ ...l }));
  const friendship = props.conversation?.friendship as {
    crmTagsPerNick?: string[];
    zaloLabels?: Array<{ id?: number; name?: string; color?: string }>;
  } | null | undefined;
  const oldCrmTags = Array.isArray(friendship?.crmTagsPerNick)
    ? [...(friendship!.crmTagsPerNick as string[])]
    : [];
  const oldZaloLabels = Array.isArray(friendship?.zaloLabels)
    ? [...(friendship!.zaloLabels as Array<{ id?: number; name?: string; color?: string }>)]
    : [];

  // ── Optimistic 1: allLabels assignedTo flag (dropdown ✓ animation) ──
  allLabels.value = allLabels.value.map(l => ({
    ...l,
    assignedTo: labelId !== null && l.id === labelId,
  }));

  // ── Optimistic 2: friendship.zaloLabels — NGUỒN CHÍNH cột 2 đọc (object {id,name,color}
  // màu chuẩn = zalo_labels.color, đồng bộ TagCrmBar + header). Single-select Zalo: 1 label/
  // friend → assign = replace toàn bộ; unassign = []. Cập nhật NGAY, không chờ socket. ──
  if (friendship) {
    friendship.zaloLabels = labelId !== null
      ? [{ id: label.id, name: label.text, color: label.color }]
      : [];
  }

  // ── Optimistic 3: friendship.crmTagsPerNick mirror "🔵 X" — giữ cho legacy reader
  // (filter chat-routes, timeline). Cột 2 KHÔNG còn đọc field này cho tag Zalo. ──
  const stripped = oldCrmTags.filter(t => !t.startsWith('🔵 '));
  const newTags = labelId !== null ? [...stripped, `🔵 ${label.text}`] : stripped;
  if (friendship) {
    friendship.crmTagsPerNick = newTags;
  }

  // Đăng ký pending mutation — fetchConversations giữa lúc BE đang sync sẽ apply lại
  // newTags lên response thay vì để response (chưa có tag) ghi đè optimistic state.
  const convId = props.conversation?.id;
  if (convId) registerPendingTags(convId, newTags);

  toast.success(labelId ? `✓ Đã gắn "${label.text}"` : `✓ Đã bỏ tag`);

  // API call background — UI đã update sẵn
  try {
    const { api: apiClient } = await import('@/api/index');
    await apiClient.post(`/zalo-accounts/${accId}/labels/assign-thread`, { threadId, labelId });
    // BE đã confirm — clear pending để các fetch sau dùng BE-authoritative value
    if (convId) clearPendingTags(convId);
    // Reconcile với BE — fetch fresh + dispatch event để các surface khác re-fetch
    void fetchAllLabels(accId, threadId);
    window.dispatchEvent(new CustomEvent('zalo-labels-synced', { detail: { accountId: accId } }));
    // Trigger timeline refresh + highlight entry "tag_change_zalo" mới
    const contactId = props.conversation?.contact?.id;
    if (contactId) window.dispatchEvent(new CustomEvent('timeline-updated', { detail: { contactId } }));
  } catch (err: any) {
    // Rollback ALL optimistic mutations + clear pending
    allLabels.value = snapshotAllLabels;
    if (friendship) {
      friendship.crmTagsPerNick = oldCrmTags;
      friendship.zaloLabels = oldZaloLabels;
    }
    if (convId) clearPendingTags(convId);
    toast.error(err.response?.data?.error || 'Không gán được tag — đã hoàn tác');
  }
}

async function onSyncLabels() {
  const accId = props.conversation?.zaloAccount?.id;
  const threadId = props.conversation?.externalThreadId;
  if (!accId) return;
  try {
    const { api: apiClient } = await import('@/api/index');
    const { data } = await apiClient.post(`/zalo-accounts/${accId}/labels/sync`);
    toast.success(`✓ Sync ${data.labels.length} tag · ${data.friendsUpdated} KH`);
    await fetchAllLabels(accId, threadId);
    window.dispatchEvent(new CustomEvent('zalo-labels-synced', { detail: { accountId: accId } }));
  } catch (err: any) {
    toast.error(err.response?.data?.error || 'Sync thất bại');
  }
}

function goToLabelsSettings() {
  window.location.assign('/settings?tab=zalo-labels');
}

// CRM tags = merge Contact.tags + Friend.crmTagsPerNick (Zalo-mirrored "🔵 X").
// Source of truth: 2 fields khác nhau. Dedup, Zalo tags lên trước.
const contactTags = ref<string[]>([]);

// Phase 6 polish — auto-tags từ Friend (đính kèm conversation.friendship khi BE trả).
// Refactor 2026-06-01: TagCrmBar đã tự load qua /friends/:id/tags Tag v2, không cần
// pass prop nữa. Giữ computed làm reference cho activity log + future use cases.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const conversationAutoTags = computed<string[]>(() => {
  const conv = props.conversation as any;
  const fromFriendship = conv?.friendship?.autoTags;
  const fromContact = conv?.contact?.autoTags;
  const list = (fromFriendship ?? fromContact ?? []) as unknown;
  return Array.isArray(list) ? (list as string[]) : [];
});
void conversationAutoTags;
function recomputeTags() {
  const ct = Array.isArray(props.conversation?.contact?.tags)
    ? (props.conversation!.contact!.tags as string[])
    : [];
  const ftRaw = (props.conversation?.friendship as { crmTagsPerNick?: string[] } | null | undefined)?.crmTagsPerNick;
  const ft = Array.isArray(ftRaw) ? ftRaw : [];
  const seen = new Set<string>();
  const merged: string[] = [];
  // Zalo-mirror tags (🔵 X) là PER-NICK — CHỈ lấy từ Friend.crmTagsPerNick của nick này.
  // Contact.tags có chứa 🔵 X = data drift legacy → bỏ qua để tránh "kẹt 2 Zalo tag"
  // cross-nick (vd: nick A view thấy 🔵 tag của nick B do legacy aggregate sai).
  for (const t of ft) if (t.startsWith('🔵 ') && !seen.has(t)) { seen.add(t); merged.push(t); }
  for (const t of ft) if (!t.startsWith('🔵 ') && !seen.has(t)) { seen.add(t); merged.push(t); }
  // Contact.tags chỉ contribute user-CRM tags (skip 🔵 X — không phải nguồn hợp lệ).
  for (const t of ct) if (!t.startsWith('🔵 ') && !seen.has(t)) { seen.add(t); merged.push(t); }
  contactTags.value = merged;
}
watch(() => [
  props.conversation?.contact?.tags,
  (props.conversation?.friendship as { crmTagsPerNick?: string[] } | null | undefined)?.crmTagsPerNick,
], recomputeTags, { immediate: true, deep: true });

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function onUpdateTags(next: string[]) {
  // Legacy handler — TagCrmBar refactor 2026-06-01 tự manage state qua API mới,
  // không emit update:modelValue nữa. Giữ function để các caller cũ không break.
  contactTags.value = next;
}
void onUpdateTags;
const msgOutCount = computed(() => props.conversation?.friendship?.totalOutbound ?? 0);
const contactTotalIn = computed(() => props.conversation?.contact?.totalInbound ?? 0);
const contactTotalOut = computed(() => props.conversation?.contact?.totalOutbound ?? 0);

// ── Real-time Zalo online presence (Phase A) ────────────────────────────────
// Wire useZaloPresence composable → fetch via /profile/last-online/:uid
// + subscribe socket 'friend:presence' để real-time update từ cron 60s.
// Privacy gate: nếu KH tắt show_online_status → indicator ẩn hoàn toàn.
const presence = useZaloPresence(
  () => props.conversation?.zaloAccount?.id || null,
  () => {
    if (props.conversation?.threadType === 'group') return null;
    // Per-account UID: dùng externalThreadId (UID KH từ POV nick này),
    // KHÔNG dùng contact.zaloUid (UID từ nick khác, Zalo reject "Tham số không hợp lệ").
    return props.conversation?.externalThreadId || props.conversation?.contact?.zaloUid || null;
  },
);

const isOnline = computed(() => presence.isOnline.value);
const lastOnlineLabel = computed(() => {
  // Group thread → hiển thị member count
  if (props.conversation?.threadType === 'group') {
    const count = (props.conversation as { groupMembersCount?: number | null }).groupMembersCount;
    return count ? `${count} thành viên` : 'Nhóm';
  }
  // KH user thread: dùng real Zalo presence label, fallback null nếu privacy off
  return presence.label.value;
});
const showOnlineIndicator = computed(() => {
  if (props.conversation?.threadType === 'group') return true;
  return presence.hasIndicator.value;
});

// ── M53 2026-05-30: Virtual conversation cho KH no-Zalo ─────────────────────
// Anh chốt Approach A: virtual conv hiện trong /chat, KHÔNG gửi tin qua Zalo SDK,
// dùng làm nhật ký chăm sóc + AI Trợ Lý reply gợi ý. Memory M53.
const isVirtualConv = computed(() => {
  return Boolean((props.conversation as { isVirtual?: boolean } | undefined)?.isVirtual);
});

// M55 2026-05-30 — Cùng chăm chip + tooltip cho header chat
const contactAccessList = computed(() => {
  const list = (props.conversation?.contact as { contactAccess?: Array<{
    role: string;
    source?: string;
    createdAt?: string;
    user: { id?: string; fullName: string | null; email: string | null } | null;
  }> } | null | undefined)?.contactAccess;
  return Array.isArray(list) ? list : [];
});
const cungChamCount = computed(() => contactAccessList.value.length);
const cungChamTooltip = computed(() => {
  const list = contactAccessList.value;
  if (!list.length) return '';
  const lines = list.map((a) => {
    const n = a.user?.fullName || a.user?.email || 'Sale';
    return a.role === 'primary' ? `⭐ ${n} (chính)` : `🤝 ${n}`;
  });
  return `${list.length} sale đang/đã chăm KH này:\n${lines.join('\n')}`;
});
const virtualStatusLabel = 'KH chưa bật tìm kiếm Zalo công khai';
const virtualTooltip =
  'KH chưa bật tìm kiếm Zalo công khai. Tin nhắn lưu nội bộ làm nhật ký chăm sóc — KHÔNG gửi đi Zalo.';

function onAiSuggestionApplied(
  acceptedFields: Array<{ field: string; value: unknown }>,
  _aiMessageId: string,
) {
  // Refresh contact panel data (parent listens via care-status-changed for now)
  // TODO: emit dedicated event 'contact-updated' để ChatView reload contact detail
  if (props.conversation?.contact) {
    const c = props.conversation.contact as unknown as Record<string, unknown>;
    for (const f of acceptedFields) {
      c[f.field] = f.value;
    }
  }
}

// ── Resolve sender avatar cho MessageBubble ─────────────────────────────────
// User thread: incoming msgs → conversation.contact.avatarUrl
// Group: prefetch batch khi messages thay đổi → tránh 20 HTTP request lazy.
// Cache đặt ở module-level (groupAvatarStore) nên persist qua re-mount + qua các conv.
watch(
  [() => props.conversation?.id, () => props.messages],
  () => {
    if (props.conversation?.threadType !== 'group') return;
    const uids = new Set<string>();
    for (const m of props.messages) {
      if (m.senderUid && m.senderType !== 'self' && !groupAvatarStore.has(m.senderUid)) {
        uids.add(m.senderUid);
      }
    }
    // 2026-06-11 — truyền nick của hội thoại để BE chỉ gọi đúng nick (tránh lag 30-50 nick).
    if (uids.size > 0) void groupAvatarStore.fetchBatch([...uids], props.conversation?.zaloAccount?.id);
  },
  { immediate: true },
);

function resolveSenderAvatar(msg: Message): string | null {
  if (msg.senderType === 'self') return null;
  if (props.conversation?.threadType === 'user') {
    return props.conversation?.contact?.avatarUrl || null;
  }
  if (msg.senderUid) return groupAvatarStore.get(msg.senderUid) || null;
  return null;
}

// ── Click avatar / sender → open Zalo profile dialog ────────────────────────
const userInfoDialog = ref(false);
const userInfoUid = ref('');
// E21/E22 — click "Mở chat" trong danh thiếp/gợi ý bạn bè → mở dialog Zalo user info.
function onOpenProfileFromCard(uid: string) {
  if (!uid) return;
  userInfoUid.value = uid;
  userInfoDialog.value = true;
}

function onSenderClick(msg: Message) {
  if (!msg.senderUid || msg.senderType === 'self') return;
  userInfoUid.value = msg.senderUid;
  userInfoDialog.value = true;
}

// 2026-06-03: Click avatar/tên trong header cột 3 → mở dialog user info KH
// (chỉ áp 1-1 user thread, group bỏ qua vì không có 1 contact duy nhất).
const canClickHeader = computed(() => {
  const conv = props.conversation;
  return !!(conv && conv.threadType !== 'group' && conv.contact?.zaloUid);
});
function onHeaderAvatarClick() {
  const conv = props.conversation;
  if (!conv || conv.threadType === 'group') return;
  const uid = conv.contact?.zaloUid;
  if (!uid) return;
  userInfoUid.value = uid;
  userInfoDialog.value = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sprint v3 Tuần 3 Row 6.9 (2026-06-03): Nick switcher dropdown trong chat header.
// Sale click avatar/tên nick → dropdown tất cả nick (Cách B): KB / đã mời / chưa.
// Click nick KB → ensure-conversation + navigate (Cách 1 auto tạo mượt).
// Click nick chưa KB → defer (chưa wire — TODO sprint sau khi Anh chốt flow mời).
interface NickCoverageRow {
  friendId: string;
  zaloAccountId: string;
  displayName: string | null;
  avatarUrl: string | null;
  zaloUidInNick: string;
  friendshipStatus: string; // 'accepted' | 'pending' | 'declined' | 'none'
}
const nickCoverageList = ref<NickCoverageRow[]>([]);
const loadingNickCoverage = ref(false);
const switchingToNickId = ref<string | null>(null);

async function onNickMenuToggle(open: boolean) {
  if (!open) return;
  const contactId = props.conversation?.contact?.id;
  if (!contactId) return;
  if (loadingNickCoverage.value) return;
  loadingNickCoverage.value = true;
  try {
    const { data } = await api.get(`/contacts/${contactId}/friendships`);
    const rows: any[] = Array.isArray(data?.friendships) ? data.friendships : [];
    nickCoverageList.value = rows.map(r => ({
      friendId: r.id,
      zaloAccountId: r.zaloAccountId,
      displayName: r.zaloAccount?.displayName ?? null,
      avatarUrl: r.zaloAccount?.avatarUrl ?? null,
      zaloUidInNick: r.zaloUidInNick,
      friendshipStatus: r.friendshipStatus || 'none',
    }));
  } catch (err) {
    console.error('[nick-switcher] load friendships failed:', err);
    toast.error('Không tải được danh sách nick');
    nickCoverageList.value = [];
  } finally {
    loadingNickCoverage.value = false;
  }
}

function friendshipStatusLabel(s: string): string {
  if (s === 'accepted') return '✓ Đã kết bạn';
  if (s === 'pending') return '⏳ Đã gửi mời';
  if (s === 'declined') return '✗ Đã từ chối';
  return 'Chưa kết bạn';
}

async function onPickNick(row: NickCoverageRow) {
  // Nick hiện tại → không làm gì
  if (row.zaloAccountId === props.conversation?.zaloAccount?.id) return;
  // Chỉ navigate khi đã KB. Chưa KB → toast hướng dẫn (defer mời nhanh).
  if (row.friendshipStatus !== 'accepted') {
    toast.push('Nick này chưa kết bạn với KH. Hãy dùng nút "Kết bạn" để gửi lời mời.');
    return;
  }
  switchingToNickId.value = row.zaloAccountId;
  try {
    // Cách 1 (Anh chốt): ensure-conversation mượt → BE find-or-create → trả convId
    const { data } = await api.post(`/friends/${row.friendId}/ensure-conversation`);
    const newConvId = data?.conversationId;
    if (!newConvId) throw new Error('Không nhận được conversationId');
    // Navigate sang conv mới — emit lên parent ChatView để chuyển route
    emit('switch-conversation', newConvId);
  } catch (err) {
    console.error('[nick-switcher] ensure-conversation failed:', err);
    toast.error('Không chuyển được nick. Vui lòng thử lại.');
  } finally {
    switchingToNickId.value = null;
  }
}

// ── Reminder notice (inline timeline event) ─────────────────────────────────
// Zalo gửi 2 row khi tạo reminder: notice "X tạo nhắc hẹn mới Y - HH:mm" (action=msginfo.actionlist)
// và card (action=show.profile). Notice không nên là bubble — render centered inline event.
function isReminderNotice(msg: Message): boolean {
  if (msg.contentType !== 'reminder') return false;
  try {
    const p = JSON.parse(msg.content || '{}');
    return p.action === 'msginfo.actionlist';
  } catch { return false; }
}
function reminderNoticeText(msg: Message): string {
  try {
    const p = JSON.parse(msg.content || '{}');
    return String(p.title || '').trim() || 'Nhắc hẹn mới';
  } catch { return 'Nhắc hẹn mới'; }
}
function reminderNoticeTime(msg: Message): string {
  try {
    const p = JSON.parse(msg.content || '{}');
    const params = typeof p.params === 'string' ? JSON.parse(p.params) : p.params;
    const hl = Array.isArray(params?.highLightsV2) ? params.highLightsV2 : [];
    for (const h of hl) {
      if (Number(h.ts) > 1e12) {
        const ts = Number(h.ts);
        const p = getOrgParts(ts);
        if (!p) return '';
        const dow = weekdayInOrgTz(ts, undefined, 'short');
        return `${dow}, ${String(p.day).padStart(2, '0')}/${String(p.month).padStart(2, '0')} ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
      }
    }
  } catch {}
  return '';
}
// ── Smart friendship state ─────────────────────────────────────────────────
// Source: conv.friendship (backend join Friend by zaloAccountId × contactId).
// Fallback heuristic: nếu không có Friend record nhưng contact.zaloUid set → assume 'chatting_stranger'.
type FriendshipState = 'friend' | 'pending_sent' | 'pending_received' | 'pending_friend' | 'chatting_stranger' | 'ghost' | null;

// Phase C — Cross-check friend status real-time qua Zalo SDK
// Override DB state nếu Zalo trả KHÁC (KH unfriend mà DB chưa kịp sync).
// Quan trọng: phân biệt direction của pending request:
//   is_requested = 1 → SALE đã gửi mời, đợi KH accept    → 'pending_sent'
//   is_requesting = 1 → KH đã gửi mời, sale chưa accept  → 'pending_received'
const zaloFriend = useZaloFriendStatus(
  () => props.conversation?.zaloAccount?.id || null,
  () => {
    if (props.conversation?.threadType !== 'user') return null;
    // Per-account UID: externalThreadId là UID KH FROM POV nick này.
    // contact.zaloUid có thể là UID từ nick khác → getFriendRequestStatus trả sai/empty.
    return props.conversation?.externalThreadId || props.conversation?.contact?.zaloUid || null;
  },
);

// ── Real-time friendship sync ─────────────────────────────────────────────
// Backend emit 'friend:updated' khi friend_event listener nhận từ Zalo SDK:
//  - ADD (accept lời mời) → 'accepted'
//  - REMOVE (huỷ kết bạn) → 'removed' / ghost
//  - REQUEST (KH gửi mời) → 'pending_received'
//  - UNDO_REQUEST (huỷ mời) → 'none'
//  - REJECT_REQUEST → 'rejected'
//  - BLOCK / UNBLOCK
//
// Per-account UID trap: 1 KH có thể có NHIỀU Friend rows cùng nick (UID cũ +
// UID mới qua re-invite). Backend payload include zaloUidInNick → frontend
// chỉ apply patch nếu UID khớp conv binding HOẶC nếu patch chuyển state về
// pending_received/accepted (ưu tiên invite mới hơn friendship cũ).
const recentlyUnfriended = ref(false);
useFriendSocket((payload) => {
  const acc = props.conversation?.zaloAccount?.id;
  const contactId = props.conversation?.contact?.id;
  const convUid = props.conversation?.externalThreadId;
  if (!acc || !contactId) return;
  if (payload.zaloAccountId !== acc || payload.contactId !== contactId) return;

  const status = payload.patch?.friendshipStatus as string | undefined;
  if (!status) return;

  // UID filter logic — tránh override "Đã KB" của Friend cũ bằng event của
  // Friend mới (vd: KH thu hồi pending invite trên UID mới, nhưng UID cũ vẫn friend).
  const payloadUid = payload.zaloUidInNick;
  const isSameUid = !payloadUid || !convUid || payloadUid === convUid;

  // Map server-side status → Zalo SDK status shape cho zaloFriend.setStatus()
  if (status === 'accepted') {
    // Ưu tiên áp dụng — friendship dương luôn relevant
    zaloFriend.setStatus({ isFriend: true, isRequested: false, isRequesting: false });
    recentlyUnfriended.value = false;
  } else if (status === 'pending_sent') {
    // pending_sent với UID khác = sale gửi mời mới với UID khác → áp dụng
    zaloFriend.setStatus({ isFriend: false, isRequested: true, isRequesting: false });
    recentlyUnfriended.value = false;
  } else if (status === 'pending_received') {
    // pending_received với UID khác = KH gửi mời mới với UID khác (sau khi old UID
    // đã unfriend hoặc state khác) → vẫn ưu tiên hiện "Chấp nhận?" để sale xử lý
    zaloFriend.setStatus({ isFriend: false, isRequested: false, isRequesting: true });
    recentlyUnfriended.value = false;
  } else if (status === 'removed' || status === 'blocked') {
    // CHỈ apply REMOVE/BLOCK nếu UID khớp conv (tránh huỷ state friend của UID cũ
    // khi event là cho UID khác trong cùng nick).
    if (isSameUid) {
      zaloFriend.setStatus({ isFriend: false, isRequested: false, isRequesting: false });
      recentlyUnfriended.value = true;
    }
  } else if (status === 'rejected' || status === 'none') {
    // UNDO_REQUEST hoặc REJECT — chỉ apply nếu UID khớp HOẶC current state không phải friend
    // (tránh xoá "Đã KB" của UID cũ khi UID mới bị huỷ mời).
    const currentIsFriend = zaloFriend.status.value?.isFriend === true;
    if (isSameUid || !currentIsFriend) {
      zaloFriend.setStatus({ isFriend: false, isRequested: false, isRequesting: false });
      if (status === 'rejected' && isSameUid) recentlyUnfriended.value = true;
    }
  }
});

// Reset local override khi user switch conv
watch(() => props.conversation?.id, () => {
  recentlyUnfriended.value = false;
});

const friendshipState = computed<FriendshipState>(() => {
  if (props.conversation?.threadType !== 'user') return null;

  const fs = props.conversation?.friendship;
  // "Was once friend" = có becameFriendAt hoặc friendshipStatus đã từng 'accepted'/'removed'.
  // recentlyUnfriended = socket vừa báo REMOVE event (DB chưa kịp emit qua list refresh).
  const wasOnceFriend = recentlyUnfriended.value || !!(
    fs && (fs.becameFriendAt
      || fs.friendshipStatus === 'removed'
      || fs.friendshipStatus === 'blocked'
      || fs.relationshipKind === 'ghost')
  );

  // 1. Zalo SDK realtime status WINS nếu đã fetch xong
  const z = zaloFriend.status.value;
  if (z) {
    if (z.isFriend) return 'friend';
    if (z.isRequested) return 'pending_sent';
    if (z.isRequesting) return 'pending_received';
    // Zalo nói NOT friend → state phụ thuộc lịch sử:
    //   - Từng là friend (becameFriendAt set, hoặc DB nói 'removed'/'ghost') → 'ghost'
    //   - Chưa từng kết bạn nhưng có chat → 'chatting_stranger' (Mời kết bạn lần đầu)
    if (wasOnceFriend) return 'ghost';
    if (props.conversation?.contact?.zaloUid) return 'chatting_stranger';
    return null;
  }

  // 2. Fallback DB state (loading hoặc API error)
  if (fs) {
    if (fs.friendshipStatus === 'pending_sent') return 'pending_sent';
    if (fs.friendshipStatus === 'pending_received') return 'pending_received';
    const k = fs.relationshipKind;
    if (k === 'friend' || k === 'pending_friend' || k === 'chatting_stranger' || k === 'ghost') {
      return k;
    }
  }
  if (props.conversation?.contact?.zaloUid) return 'chatting_stranger';
  return null;
});

/**
 * Calendar day diff — "hôm nay" = cùng DATE (không phải <24h rolling).
 * VD: nếu friend được add 2026-05-19 23:55 và now là 2026-05-20 00:10, rolling 24h
 * trả về "hôm nay" (chỉ 15p) — sai vì sang ngày khác. Calendar diff trả "hôm qua".
 */
function calendarDaysDiff(at: string | Date): number {
  const d1 = new Date(at);
  const d2 = new Date();
  const day1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const day2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.floor((day2.getTime() - day1.getTime()) / 86400000);
}

const friendDaysLabel = computed(() => {
  const at = props.conversation?.friendship?.becameFriendAt;
  if (!at) return null;
  const d = calendarDaysDiff(at);
  if (d <= 0) return 'hôm nay';
  if (d === 1) return 'hôm qua';
  if (d < 30) return `${d} ngày`;
  if (d < 365) return `${Math.floor(d / 30)} tháng`;
  return `${Math.floor(d / 365)} năm`;
});

const pendingDaysLabel = computed(() => {
  // Ưu tiên friendship.updatedAt — phản ánh "thời điểm pending status set gần nhất"
  // (Prisma auto-set khi REQUEST event đến). Fallback firstMessageAt nếu thiếu.
  // Cuối cùng Contact.lastOutboundAt nếu Friend row chưa có data.
  const fs = props.conversation?.friendship;
  const at = fs?.updatedAt
    || fs?.firstMessageAt
    || props.conversation?.contact?.lastOutboundAt
    || null;
  if (!at) return 'vừa gửi';
  const d = calendarDaysDiff(at);
  if (d <= 0) return 'hôm nay';
  if (d === 1) return 'hôm qua';
  if (d === 2) return 'hôm kia';
  if (d < 7) return `${d} ngày trước`;
  if (d < 30) return `${d} ngày`;
  if (d < 60) return '1 tháng';
  if (d < 365) return `${Math.floor(d / 30)} tháng`;
  return `${Math.floor(d / 365)} năm`;
});

/**
 * Tooltip natural language — "Anh Bảo đã gửi lời mời kết bạn từ HÔM NAY. Chấp nhận kết bạn?"
 * Grammar fix: "hôm nay/hôm qua/hôm kia/N ngày trước/N tháng" — không nối thêm "trước".
 */
function naturalTimeLabel(daysLabel: string): string {
  // pendingDaysLabel có thể trả "hôm nay" / "hôm qua" / "hôm kia" / "X ngày trước" / "X ngày" / "X tháng" / ...
  // Chuẩn hoá cho ngữ pháp "từ {X}":
  //   từ hôm nay, từ hôm qua, từ hôm kia, từ 3 ngày trước, từ 1 tuần trước, từ 2 tháng trước
  if (daysLabel === 'hôm nay' || daysLabel === 'hôm qua' || daysLabel === 'hôm kia') return daysLabel;
  if (daysLabel.endsWith('trước')) return daysLabel;
  // "5 ngày" → "5 ngày trước", "2 tháng" → "2 tháng trước"
  return `${daysLabel} trước`;
}

const pendingReceivedTooltip = computed(() => {
  const name = headerName.value && headerName.value !== 'Unknown' ? headerName.value : 'Khách hàng';
  const time = naturalTimeLabel(pendingDaysLabel.value);
  return `${name} đã gửi lời mời kết bạn từ ${time}. Chấp nhận kết bạn?`;
});

const pendingSentTooltip = computed(() => {
  const time = naturalTimeLabel(pendingDaysLabel.value);
  return `Sale đã gửi mời kết bạn từ ${time}. Click để huỷ.`;
});

// 2026-06-03: bỏ tooltip Đã KB vì button đã có sub-meta "{{ friendDaysLabel }}"
// inline; tooltip native + v-tooltip đều gây visual đè row 1.

// ── Friendship action handlers ──────────────────────────────────────────────
// Tất cả dùng externalThreadId (per-nick UID) — KHÔNG dùng contact.zaloUid (cross-nick bug).
// Sau action thành công, gọi zaloFriend.setStatus() để ép UI update ngay
// (Zalo SDK getFriendRequestStatus có thể trả stale data khi multiple Friend rows
// cùng nick — accept-resolved nhắm UID khác, cache cũ vẫn lưu pending).
const actionLoading = ref(false);
const showInviteDialog = ref(false);

function getActionContext() {
  const accountId = props.conversation?.zaloAccount?.id;
  const uid = props.conversation?.externalThreadId || props.conversation?.contact?.zaloUid;
  return { accountId, uid };
}

function onOpenInviteDialog() {
  const { accountId, uid } = getActionContext();
  if (!accountId || !uid) {
    toast.error('Thiếu thông tin nick hoặc KH');
    return;
  }
  showInviteDialog.value = true;
}

async function onSendInviteSubmit(message: string) {
  const { accountId, uid } = getActionContext();
  if (!accountId || !uid) {
    toast.error('Thiếu thông tin nick hoặc KH');
    return;
  }
  actionLoading.value = true;
  try {
    await api.post(`/zalo-accounts/${accountId}/friends/requests`, { userId: uid, message });
    toast.success('Đã gửi lời mời kết bạn');
    // Optimistic: set pending_sent ngay (Zalo SDK sẽ confirm ở refresh tiếp theo)
    zaloFriend.setStatus({ isFriend: false, isRequested: true, isRequesting: false });
    showInviteDialog.value = false;
  } catch (err: any) {
    toast.error(formatFriendOpError(err, 'Không thể gửi lời mời'));
    console.error('[send-invite] failed', { accountId, uid, err: err?.response?.data || err });
  } finally {
    actionLoading.value = false;
  }
}

async function onCancelInvite() {
  const { accountId, uid } = getActionContext();
  if (!accountId || !uid) {
    toast.error('Thiếu thông tin nick hoặc KH');
    return;
  }
  actionLoading.value = true;
  try {
    await api.delete(`/zalo-accounts/${accountId}/friends/requests/${uid}`);
    toast.success('Đã thu hồi lời mời kết bạn');
    // Reset về chatting_stranger (no pending) — UI sẽ hiện nút "Kết bạn" lại
    zaloFriend.setStatus({ isFriend: false, isRequested: false, isRequesting: false });
  } catch (err: any) {
    toast.error(formatFriendOpError(err, 'Không thể thu hồi'));
    console.error('[cancel-invite] failed', { accountId, uid, err: err?.response?.data || err });
  } finally {
    actionLoading.value = false;
  }
}

async function onRejectInvite() {
  const { accountId, uid } = getActionContext();
  if (!accountId || !uid) {
    toast.error('Thiếu thông tin nick hoặc KH');
    return;
  }
  actionLoading.value = true;
  try {
    await api.post(`/zalo-accounts/${accountId}/friends/requests/${uid}/reject`);
    toast.success('Đã từ chối lời mời kết bạn');
    zaloFriend.setStatus({ isFriend: false, isRequested: false, isRequesting: false });
  } catch (err: any) {
    toast.error(formatFriendOpError(err, 'Không thể từ chối lời mời'));
    console.error('[reject-invite] failed', { accountId, uid, err: err?.response?.data || err });
  } finally {
    actionLoading.value = false;
  }
}

/** Format axios error → user-friendly Vietnamese message. */
function formatFriendOpError(err: any, fallback: string): string {
  const serverMsg = err?.response?.data?.error;
  if (serverMsg) return serverMsg;
  const code = err?.code || err?.response?.data?.code;
  if (code === 'ERR_NETWORK' || err?.message === 'Network Error') {
    return 'Lỗi mạng — server đang khởi động lại hoặc mất kết nối. Thử lại sau 5s.';
  }
  if (code === 'ECONNABORTED' || err?.message?.includes('timeout')) {
    return 'Hết thời gian chờ Zalo phản hồi. Thử lại sau.';
  }
  return err?.message || fallback;
}

async function onRemoveFriend() {
  const { accountId, uid } = getActionContext();
  if (!accountId || !uid) {
    toast.error('Thiếu thông tin nick hoặc KH');
    return;
  }
  if (!confirm('Huỷ kết bạn với KH này? Sau đó muốn nhắn lại sẽ phải gửi lời mời kết bạn lại.')) return;
  actionLoading.value = true;
  try {
    await api.delete(`/zalo-accounts/${accountId}/friends/${uid}`);
    toast.success('Đã huỷ kết bạn với KH');
    // Reset local state — Zalo unfriend = KH thành chatting_stranger / ghost
    zaloFriend.setStatus({ isFriend: false, isRequested: false, isRequesting: false });
    recentlyUnfriended.value = true; // force ghost UI
  } catch (err: any) {
    toast.error(formatFriendOpError(err, 'Không thể huỷ kết bạn'));
    console.error('[remove-friend] failed', { accountId, uid, err: err?.response?.data || err });
  } finally {
    actionLoading.value = false;
  }
}

async function onAcceptInvite() {
  const { accountId, uid } = getActionContext();
  if (!accountId || !uid) {
    toast.error('Thiếu thông tin nick hoặc KH');
    return;
  }
  actionLoading.value = true;
  try {
    const res = await api.post(`/zalo-accounts/${accountId}/friends/requests/${uid}/accept`);
    const method = res?.data?.method;
    toast.success(method === 'send-as-accept'
      ? 'Đã chấp nhận lời mời kết bạn (qua sendFriendRequest)'
      : 'Đã chấp nhận lời mời kết bạn');
    // ÉP local state về friend ngay — Zalo SDK cache có thể stale, đặc biệt khi
    // accept-resolved nhắm UID khác conv binding (multiple Friend rows cùng nick).
    zaloFriend.setStatus({ isFriend: true, isRequested: false, isRequesting: false });
  } catch (err: any) {
    toast.error(formatFriendOpError(err, 'Không thể chấp nhận lời mời'));
    console.error('[accept-friend] failed', { accountId, uid, err: err?.response?.data || err });
  } finally {
    actionLoading.value = false;
  }
}
function onOpenNote() {
  // Open right info panel + scroll to note footer
  if (!props.showContactPanel) emit('toggle-contact-panel');
  toast.push('Mở ghi chú nhanh ở panel bên phải');
}
const inputPlaceholder = computed(() => {
  // M53 2026-05-30: virtual conv → placeholder rõ ràng là nhật ký nội bộ
  if (isVirtualConv.value) {
    return 'Ghi nội dung trao đổi — Trợ lý AI sẽ gợi ý câu hỏi tiếp theo...';
  }
  // Bỏ "Đang nhắn từ nick" vì đã có avatar nick bên trái input — gọn hơn.
  // Hint phím tắt giữ ngắn gọn.
  return 'Gõ tin nhắn… ("/" template, "@" mention, "#" tag)';
});

/* Mission Fix 2 (2026-05-30) — header picker giai đoạn KH (ContactDealStageSelector)
 * đã ghi statusId trực tiếp qua PUT /contacts/:id. Handler này chỉ patch local state
 * + trigger timeline refresh để các surface đang quan sát đồng bộ ngay. */
function onDealStageUpdated(newStatusId: string | null) {
  if (props.conversation?.contact) {
    (props.conversation.contact as { statusId?: string | null }).statusId = newStatusId;
  }
  // Emit để parent (ChatView) có thể refresh KPI / lazy gate hint nếu cần.
  emit('care-status-changed', newStatusId || '');
}

/* Legacy CareStatusBadge handler đã được gỡ khỏi MessageThread (Mission Fix 2,
 * 2026-05-30). CareStatusBadge + persist enum legacy vẫn sống trong
 * ChatContactPanel.vue nếu sale cần thao tác status enum cũ. */

// @ts-expect-error TS6133 — Webhook button bị ẩn 2026-06-03 (Anh chốt), giữ
// function để bật lại nhanh khi cần. Xem template trong header section.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function fireWebhook() {
  if (!props.conversation?.contact?.id) return;
  webhookLoading.value = true;
  try {
    // MOCK: chờ POST /webhooks/fire endpoint
    await new Promise(r => setTimeout(r, 700));
    toast.success('Webhook đã bắn về CRM');
  } catch {
    toast.error('Webhook fail');
  } finally {
    webhookLoading.value = false;
  }
}

function todoToast(label: string) {
  toast.push(`${label}: chưa implement`, 'warning');
}

function onPickEmoji(emoji: string) {
  editorRef.value?.insertText(emoji);
}

// Send sticker từ picker — POST /sticker với {id, catId, type}
async function onSendSticker(sticker: { id: number; catId: number; type: number }) {
  if (!props.conversation?.id) return;
  try {
    await api.post(`/conversations/${props.conversation.id}/sticker`, {
      stickerId: sticker.id,
      cateId: sticker.catId,
      type: sticker.type,
    });
    emit('refresh-thread');
    // Scroll xuống ngay (retry x3 trong scrollToBottom xử lý img async load)
    await nextTick();
    scrollToBottom();
  } catch (err) {
    console.error('[sticker] send error:', err);
    toast.push('Không gửi được sticker', 'error');
  }
}

// ── File / image upload ─────────────────────────────────────────────────────
const imageInputRef = ref<HTMLInputElement | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);
const showMediaPicker = ref(false); // picker chèn ảnh từ Kho (GĐ2)
// Gợi ý ảnh theo ngữ cảnh (GĐ3a-4): match tag khách với tag ảnh kho.
const mediaSuggestions = ref<MediaAssetItem[]>([]);
const sendingSuggestId = ref<string | null>(null);
async function loadMediaSuggestions() {
  mediaSuggestions.value = [];
  const cid = props.conversation?.id;
  if (!cid) return;
  try {
    const res = await suggestMedia(cid);
    mediaSuggestions.value = res.items;
  } catch { /* im lặng — gợi ý là phụ */ }
}
async function sendSuggestion(a: MediaAssetItem) {
  if (sendingSuggestId.value) return;
  sendingSuggestId.value = a.id;
  try {
    await sendMediaToConversation(a.id, props.conversation!.id);
    toast.success(`Đã gửi "${a.name}"`);
    mediaSuggestions.value = mediaSuggestions.value.filter((x) => x.id !== a.id);
  } catch (e: any) {
    toast.warning(e?.response?.data?.error || 'Gửi thất bại');
  } finally {
    sendingSuggestId.value = null;
  }
}
const dragDepth = ref(0);
const isDraggingFiles = ref(false);

function onPickImage() { imageInputRef.value?.click(); }
function onPickFile() { fileInputRef.value?.click(); }

function onImageFilesPicked(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  if (files.length) handleImageFiles(files);
  if (imageInputRef.value) imageInputRef.value.value = '';
}
function onFileFilesPicked(e: Event) {
  const files = Array.from((e.target as HTMLInputElement).files || []);
  if (files.length) handleFiles(files);
  if (fileInputRef.value) fileInputRef.value.value = '';
}
function onPasteImage(files: File[]) {
  // Bắt được khi user Ctrl+V image vào editor
  handleImageFiles(files);
}

function hasDraggedFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

function resetDragState() {
  dragDepth.value = 0;
  isDraggingFiles.value = false;
}

function onDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  dragDepth.value += 1;
  isDraggingFiles.value = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onDragOver(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  isDraggingFiles.value = true;
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

function onDragLeave(event: DragEvent) {
  if (!isDraggingFiles.value) return;
  if (
    event.currentTarget instanceof Node &&
    event.relatedTarget instanceof Node &&
    event.currentTarget.contains(event.relatedTarget)
  ) {
    return;
  }
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) isDraggingFiles.value = false;
}

async function onDropFiles(event: DragEvent) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  const files = Array.from(event.dataTransfer?.files || []);
  resetDragState();
  if (!files.length) return;
  if (!props.conversation?.id) {
    toast.error('Chọn cuộc trò chuyện trước khi gửi file');
    return;
  }
  const imageFiles = files.filter((file) => file.type.startsWith('image/'));
  const otherFiles = files.filter((file) => !file.type.startsWith('image/'));
  if (imageFiles.length) await handleImageFiles(imageFiles);
  if (otherFiles.length) await handleFiles(otherFiles);
}

async function handleImageFiles(files: File[]) {
  if (!props.conversation?.id) return;
  if (!files.length) return;
  toast.push(`📷 Đang gửi ${files.length} ảnh…`);
  try {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    await api.post(`/conversations/${props.conversation.id}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    toast.success(`Đã gửi ${files.length} ảnh`);
    emit('refresh-thread');
  } catch (err) {
    const detail = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload thất bại';
    toast.error(`Lỗi gửi ảnh: ${detail}`);
    console.error('[upload-image]', err);
  }
}
async function handleFiles(files: File[]) {
  if (!props.conversation?.id) return;
  if (!files.length) return;
  toast.push(`📎 Đang gửi ${files.length} file…`);
  try {
    const fd = new FormData();
    for (const f of files) fd.append('files', f, f.name);
    await api.post(`/conversations/${props.conversation.id}/attachments`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    toast.success(`Đã gửi ${files.length} file`);
    emit('refresh-thread');
  } catch (err) {
    const detail = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload thất bại';
    toast.error(`Lỗi gửi file: ${detail}`);
  }
}

// ── Format toggle: T icon bật/tắt format toolbar (B I U S list code) trong editor.
//   Mặc định ẨN — chỉ user nào cần định dạng mới bật. Tiết kiệm 30px chiều cao.
const formatBarVisible = ref(false);
function toggleFormat() {
  formatBarVisible.value = !formatBarVisible.value;
  if (formatBarVisible.value) editorRef.value?.focus();
}

// ── Appointment quick-create từ icon 📅 trong toolbar — đồng bộ flow với cột 4.
const showAppointmentDialog = ref(false);
function onAppointmentCreated() {
  // Notify parent reload thread + dispatch global event để cột 4 (ChatContactPanel)
  // refresh Activity tab + bump badge count (cùng pattern với zalo-labels-synced).
  emit('refresh-thread');
  window.dispatchEvent(new CustomEvent('appointment-created'));
}

// ── Display item types (album grouping + date dividers) ─────────────────────
type DisplayItem =
  | { kind: 'single'; key: string; msg: Message }
  | { kind: 'divider'; key: string; label: string }
  | { kind: 'album'; key: string; senderType: string; senderName: string | null; sentAt: string; totalExpected: number | null; messages: Message[] };

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86_400_000);
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dd = d.getDate().toString().padStart(2, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = d.getHours().toString().padStart(2, '0');
  const mi = d.getMinutes().toString().padStart(2, '0');
  if (day.getTime() === today.getTime()) return `Hôm nay ${hh}:${mi}`;
  if (day.getTime() === yesterday.getTime()) return `Hôm qua ${hh}:${mi}`;
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

const displayItems = computed<DisplayItem[]>(() => {
  const out: DisplayItem[] = [];
  let curAlbum: Extract<DisplayItem, { kind: 'album' }> | null = null;
  let lastDayKey = '';

  for (const msg of props.messages) {
    const d = new Date(msg.sentAt);
    const dayKey = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${Math.floor(d.getHours() / 4)}`;
    if (dayKey !== lastDayKey) {
      out.push({ kind: 'divider', key: 'div:' + dayKey, label: dayLabel(msg.sentAt) });
      lastDayKey = dayKey;
      curAlbum = null;
    }

    const canGroup = msg.contentType === 'image' && msg.albumKey && !msg.isDeleted && !!getImageUrl(msg);
    if (canGroup && curAlbum && curAlbum.key === `album:${msg.albumKey}:${msg.senderType}`) {
      curAlbum.messages.push(msg);
      continue;
    }
    curAlbum = null;
    if (canGroup) {
      curAlbum = {
        kind: 'album',
        key: `album:${msg.albumKey}:${msg.senderType}`,
        senderType: msg.senderType,
        senderName: msg.senderName,
        sentAt: msg.sentAt,
        totalExpected: msg.albumTotal ?? null,
        messages: [msg],
      };
      out.push(curAlbum);
    } else {
      out.push({ kind: 'single', key: msg.id, msg });
    }
  }
  for (const item of out) {
    if (item.kind === 'album') {
      item.messages.sort((a, b) => (a.albumIndex ?? 0) - (b.albumIndex ?? 0));
    }
  }
  return out;
});

function albumGridClass(count: number): string {
  if (count <= 1) return 'album-grid-1';
  if (count <= 4) return 'album-grid-2';
  return 'album-grid-3';
}

// ── Context menu / actions ──────────────────────────────────────────────────
function onContextMenu(event: MouseEvent, msg: Message) {
  contextMsg.value = msg;
  contextPos.value = { x: event.clientX, y: event.clientY };
  showContextMenu.value = true;
}
function onToggleReaction(msg: Message, emoji: string) {
  // Phase A fix (2026-05-21): click chip mà user ĐÃ reacted với emoji này → toggle OFF.
  // Trước fix: luôn emit 'add-reaction' → POST /reactions lần 2 với cùng emoji →
  // SDK addReaction → Zalo server xử lý như "react again" → CLEAR các emoji khác
  // của user trên Zalo Real (bug anh phát hiện 2026-05-21).
  const existing = (msg.reactions || []).find((r) => r.emoji === emoji);
  if (existing?.reacted) {
    emit('remove-reaction', msg.id, emoji);
  } else {
    emit('add-reaction', msg.id, emoji);
  }
}
function onReply() { if (contextMsg.value) emit('set-reply-to', contextMsg.value); }
function onEdit() {
  if (contextMsg.value) {
    emit('set-editing', contextMsg.value);
    inputText.value = contextMsg.value.content || '';
  }
}
function onDelete() { if (contextMsg.value) emit('delete-message', contextMsg.value.id); }
function onUndo() { if (contextMsg.value) emit('undo-message', contextMsg.value.id); }

// Lưu ảnh/file từ chat vào Kho phương tiện — Phase Media Library 2026-06-11.
// visibility: 'private' = Kho cá nhân (mặc định) / 'public' = Kho chung (G3 submenu).
async function onSaveToMedia(visibility: 'private' | 'public' = 'private') {
  const msg = contextMsg.value;
  if (!msg) return;
  try {
    const res = await saveFromChat(msg.id, visibility);
    const where = visibility === 'public' ? 'Kho chung' : 'Kho cá nhân';
    toast.success(res.deduped
      ? `Đã có sẵn trong kho — không tốn thêm dung lượng (${where})`
      : `Đã lưu "${res.asset.name}" vào ${where}`);
  } catch (e: any) {
    const code = e?.response?.data?.code;
    if (code === 'PRIVACY_LOCKED') {
      toast.warning('Tin từ nick Riêng tư — chỉ chính chủ nick mới lưu được');
    } else {
      toast.warning(e?.response?.data?.error || 'Không lưu được vào kho');
    }
  }
}

// "Thêm vào Yêu thích" từ bong bóng chat (G3): lưu private trước rồi gắn ⭐.
async function onFavoriteFromChat() {
  const msg = contextMsg.value;
  if (!msg) return;
  try {
    const res = await saveFromChat(msg.id, 'private');
    await toggleFavorite(res.asset.id);
    toast.success(`Đã lưu "${res.asset.name}" và thêm vào ⭐ Yêu thích`);
  } catch (e: any) {
    const code = e?.response?.data?.code;
    if (code === 'PRIVACY_LOCKED') {
      toast.warning('Tin từ nick Riêng tư — chỉ chính chủ nick mới lưu được');
    } else {
      toast.warning(e?.response?.data?.error || 'Không thêm được vào Yêu thích');
    }
  }
}


function onForward(targetIds: string[]) {
  if (contextMsg.value) emit('forward-message', contextMsg.value.id, targetIds);
  showForwardDialog.value = false;
}

function onCancelReplyEdit() {
  emit('cancel-reply-edit');
  if (props.editingMessage) inputText.value = '';
}

// ── Template quick-insert ───────────────────────────────────────────────────
const showTemplatePopup = ref(false);
const templateQuery = ref('');
const templates = ref<TemplateItem[]>([]);

async function loadTemplates() {
  try {
    const res = await api.get<{ templates: TemplateItem[] }>('/automation/templates');
    templates.value = res.data.templates;
  } catch { /* non-critical */ }
}
onMounted(() => { loadTemplates(); });

// Listener cho tab CRM (cột 4) — widget "AI Next Action" → emit insert-suggestion
// qua window event để giảm prop drilling. Cùng pattern với 'zalo-labels-synced'.
function onInsertSuggestionEvent(e: Event) {
  const text = (e as CustomEvent<{ text: string }>).detail?.text;
  if (text) void applySuggestion(text);
}
onMounted(() => window.addEventListener('chat:insert-suggestion', onInsertSuggestionEvent));
onBeforeUnmount(() => window.removeEventListener('chat:insert-suggestion', onInsertSuggestionEvent));

// 2026-05-27: Phase Lead Pool — modal "Mở chat Zalo" navigate kèm ?draft=...
// → tự apply vào input editor + clear query để refresh F5 không paste lại.
import { useRoute as _useRouteDraft, useRouter as _useRouterDraft } from 'vue-router';
const _draftRoute = _useRouteDraft();
const _draftRouter = _useRouterDraft();
async function consumeDraftFromQuery() {
  const draft = _draftRoute.query.draft;
  if (typeof draft !== 'string' || !draft.trim()) return;
  await nextTick();
  // delay nhẹ để editor mount xong rồi mới setContent
  setTimeout(() => {
    void applySuggestion(draft);
    // Clear query để refresh không apply lại
    const q = { ..._draftRoute.query };
    delete q.draft;
    _draftRouter.replace({ path: _draftRoute.path, query: q }).catch(() => {});
  }, 250);
}
onMounted(() => { void consumeDraftFromQuery(); });
watch(() => _draftRoute.query.draft, () => { void consumeDraftFromQuery(); });

// Vị trí "/" mở popup — lưu để khi chọn mẫu chỉ cắt từ ĐÚNG dấu "/" này (không lastIndexOf
// toàn chuỗi, tránh cắt nhầm URL/giá kiểu "50tr/m2"). Reset khi đóng popup.
const slashTriggerPos = ref(-1);

function onTypingEvent() {
  emit('typing');
  const value = inputText.value;
  // Trigger "/" chỉ ở ĐẦU dòng hoặc sau khoảng trắng (KHÔNG anywhere) — tránh phá "50tr/m2", URL.
  if (value === '/' || /(^|\s)\/$/.test(value)) {
    showTemplatePopup.value = true;
    slashTriggerPos.value = value.length - 1; // vị trí "/" vừa gõ
    templateQuery.value = '';
  } else if (showTemplatePopup.value) {
    const pos = slashTriggerPos.value;
    // Popup đóng nếu "/" trigger bị xóa hoặc con trỏ lùi trước nó.
    if (pos < 0 || pos >= value.length || value[pos] !== '/') {
      showTemplatePopup.value = false;
      slashTriggerPos.value = -1;
    } else {
      templateQuery.value = value.slice(pos + 1);
    }
  }
}

function openTemplatePopup() {
  showTemplatePopup.value = true;
  slashTriggerPos.value = -1; // mở bằng nút → không có "/" cần cắt
  templateQuery.value = '';
}

// Popup mẫu Teleport ra body nên KHÔNG hứng được phím từ ô nhập. RichTextEditor gọi hàm này
// (qua prop intercept-keys) khi nhấn ↑↓/Enter/Esc — nếu popup đang mở thì chuyển cho popup
// điều hướng (chọn/chèn/đóng) và trả true để editor KHÔNG dời con trỏ / gửi tin.
function onComposerNavKey(event: KeyboardEvent): boolean {
  if (!showTemplatePopup.value) return false;
  templatePopupRef.value?.onKey(event);
  return true;
}

// Chèn mẫu: giữ định dạng đậm/màu qua applyRichPayload (biến đã render + re-anchor offset ở popup).
// Thay nội dung ô bằng (text trước "/") + mẫu. KHÔNG auto-send — sale tự Enter.
function onTemplateSelect(payload: { text: string; styles?: Array<{ st: string; start: number; len: number }> }, templateId: string) {
  const pos = slashTriggerPos.value;
  const before = pos >= 0 ? inputText.value.slice(0, pos) : '';
  const merged = before + payload.text;
  // Dịch styles theo độ dài phần "before" (mẫu được nối sau before).
  const shift = before.length;
  const mergedStyles = (payload.styles ?? []).map((s) => ({ ...s, start: s.start + shift }));
  // Nạp vào editor giữ định dạng. applyRichPayload setContent toàn bộ ô.
  (editorRef.value as any)?.applyRichPayload?.({ text: merged, styles: mergedStyles }, { focus: true });
  inputText.value = merged;
  showTemplatePopup.value = false;
  slashTriggerPos.value = -1;
  templateQuery.value = '';
  // Track use (non-blocking)
  api.post(`/automation/templates/${templateId}/track-use`).catch(() => {});
}

// ── M14 (2026-06-02): Chèn Khối tin nhắn (Automation Blocks) vào composer ──
// Flow: sale bấm nút 🧩 → popup mở → pick Block → FE render {gender}/{name}/{sale}
// → fill vào inputText (append nếu đã có text, KHÔNG auto-send).
// Tránh ghi đè khi đang edit message (nút đã disable ở toolbar, double-check ở handler).
const showBlockPicker = ref(false);
// FIX 2026-06-09: guard chống double-send khi gửi cả Khối (preview/send-direct).
const blockSending = ref(false);
function openBlockPicker() {
  if (props.editingMessage) return;
  if (!privacyVisibility.canSendInConv(props.conversation)) return;
  showBlockPicker.value = true;
}
// 2026-06-04 — Khối Phase 1 MVP: 2 đường workflow
// 👁 Xem trước → mở Preview dialog → bấm Gửi → dispatch
// 📤 Gửi luôn → bỏ qua preview, dispatch ngay
const previewBlock = ref<import('@/api/automation/types').Block | null>(null);

function onBlockPreview(block: import('@/api/automation/types').Block) {
  previewBlock.value = block;
  showBlockPicker.value = false;
}

async function onBlockSendDirect(block: import('@/api/automation/types').Block) {
  showBlockPicker.value = false;
  await dispatchBlockComponents(block.id);
}

async function onConfirmSendBlock(blockId: string) {
  previewBlock.value = null;
  await dispatchBlockComponents(blockId);
}

// FIX 2026-06-09 (Anh báo): trước đây hàm này chỉ CHÈN text các thành phần vào ô gõ
// (inputText) → khối nhiều thành phần / có format bị dồn thành text thường, gửi sai.
// Giờ gửi CẢ KHỐI qua backend GIỐNG nút "Gửi cả Khối" ở cột 4 Automation
// (sendBlockToConversation): BE dispatch đủ thành phần đúng thứ tự, giữ rich-text,
// render {gender}/{name}/{sale}, delay an toàn; tin hiện live ở cột 3 qua socket.
async function dispatchBlockComponents(blockId: string) {
  const conversationId = props.conversation?.id;
  if (!conversationId) {
    toast.error('Chưa chọn hội thoại để gửi Khối');
    return;
  }
  if (blockSending.value) return; // chống double-send
  blockSending.value = true;
  try {
    const { sendBlockToConversation } = await import('@/api/automation/blocks');
    const res = await sendBlockToConversation(conversationId, blockId);
    if (res.partial) {
      toast.warning(`Đã gửi ${res.sentCount}/${res.totalMessages} tin — ${res.errors.length} thành phần lỗi`);
    } else {
      toast.success(`Đã gửi Khối (${res.sentCount} tin) cho KH`);
    }
  } catch (err: any) {
    const msg = err?.response?.data?.error
      || err?.response?.data?.detail
      || err?.message
      || 'Không gửi được Khối';
    toast.error(msg);
  } finally {
    blockSending.value = false;
  }
}

// ── Send ────────────────────────────────────────────────────────────────────
function handleSend() {
  if (showTemplatePopup.value) { showTemplatePopup.value = false; return; }
  if (!inputText.value.trim()) return;

  // 2026-05-21 fix: lấy rich payload {text, styles} từ editor để gửi format đi Zalo.
  // Nếu không có styles → behaves như plain text (backward compat).
  const rich = (editorRef.value as any)?.getRichPayload?.() || { text: inputText.value, styles: [] };
  const textToSend = rich.text || inputText.value;
  const styles = Array.isArray(rich.styles) && rich.styles.length > 0 ? rich.styles : undefined;

  if (props.editingMessage) {
    emit('edit-message', props.editingMessage.id, textToSend);
  } else {
    emit('send', textToSend, props.replyingTo?.id ?? null, styles);
  }
  inputText.value = '';
  editorRef.value?.clear();
  emit('cancel-reply-edit');
}

// Áp dụng suggestion: chèn text vào editor + focus caret cuối → user Enter gửi luôn.
async function applySuggestion(text?: string) {
  const t = text || props.aiSuggestion;
  if (!t) return;
  inputText.value = t;
  // setContent ở RichTextEditor là async qua watch — đợi nextTick để editor update
  // xong rồi mới focus 'end' (caret tại cuối text). Tránh focus trước khi content mount.
  await nextTick();
  setTimeout(() => editorRef.value?.focus('end'), 30);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function formatMessageTime(d: string) {
  return formatInOrgTz(d, undefined, { timeOnly: true });
}

function getImageUrl(msg: Message): string | null {
  if (msg.contentType === 'image' && msg.content) {
    if (msg.content.startsWith('http')) return msg.content;
    try { const p = JSON.parse(msg.content); return p.href || p.thumb || p.hdUrl || null; } catch {}
  }
  if (msg.content?.startsWith('{')) {
    try {
      const p = JSON.parse(msg.content);
      const href = p.href || p.thumb || '';
      if (href && /\.(jpg|jpeg|png|webp|gif)/i.test(href)) return href;
      if (href && href.includes('zdn.vn') && !p.params?.includes('fileExt')) return href;
    } catch {}
  }
  return null;
}

/** Scroll xuống đáy (tin nhắn mới nhất). Retry sau khi images load. */
function scrollToBottom(immediate = false) {
  if (!messagesContainer.value) return;
  const el = messagesContainer.value;
  el.scrollTop = el.scrollHeight;
  if (!immediate) {
    // Retry vài lần vì image load async — đảm bảo cuộn xuống tận cùng sau khi hình rendered
    setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 100);
    setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 400);
    setTimeout(() => { if (el) el.scrollTop = el.scrollHeight; }, 1000);
  }
}

// Khi messages thêm (tin mới đến) → scroll mượt
watch(() => props.messages.length, async () => {
  await nextTick();
  scrollToBottom();
});

// Khi đổi sang conv khác → reset scroll xuống đáy ngay + retry sau khi messages
// load xong (messages.length thay đổi async sau khi parent fetch).
// + Auto-focus input editor → gõ tin được ngay không cần click thêm
//   (matching Zalo/Messenger native behavior). Skip mobile để tránh bật bàn phím ảo.
watch(() => props.conversation?.id, async (newId) => {
  if (!newId) return;
  await nextTick();
  scrollToBottom();
  // Auto-focus editor — skip mobile (window.innerWidth < 768) tránh bật keyboard
  if (typeof window !== 'undefined' && window.innerWidth >= 768) {
    setTimeout(() => editorRef.value?.focus(), 80);
  }
});

// Auto-apply AI suggestion ngay khi generate xong (transition empty → non-empty).
// User chỉ cần bấm ✨ → text vào input + caret cuối → Enter gửi luôn.
watch(() => props.aiSuggestion, (next, prev) => {
  if (next && next !== prev) {
    applySuggestion(next);
  }
});

// Auto-focus editor khi vào Reply / Edit mode — con trỏ chuột nằm trong ô input
// để user gõ luôn, không cần click thêm. Watch cả 2 prop: trigger bằng external
// (click reply trong context menu, hoặc từ swipe action sau này).
watch(() => props.replyingTo?.id, async (id) => {
  if (id) {
    await nextTick();
    editorRef.value?.focus();
  }
});
watch(() => props.editingMessage?.id, async (id) => {
  if (id) {
    await nextTick();
    editorRef.value?.focus();
  }
});
</script>

<style scoped>
.message-thread {
  display: flex; flex-direction: column;
  height: 100%;
  background: var(--smax-grey-100);
  overflow: hidden;
  position: relative;
}
.drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(248, 250, 252, 0.72);
  border: 2px dashed var(--smax-primary, #1786be);
  pointer-events: none;
}
.drop-card {
  width: min(360px, calc(100% - 40px));
  padding: 18px 20px;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 16px 38px rgba(15, 23, 42, 0.18);
  text-align: center;
}
.drop-title {
  margin-top: 8px;
  font-size: 15px;
  font-weight: 700;
  color: var(--smax-text, #111827);
}
.drop-subtitle {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
  color: var(--smax-grey-700, #6b7280);
}

/* Jump-to-quoted-message highlight — pulse border 2s khi user click reply card.
   Cover cả single bubble (.message-bubble) và album bubble (.bubble.album). */
.msg-bubble-wrap.msg-jump-highlight :deep(.message-bubble),
.msg-album-wrap.msg-jump-highlight :deep(.bubble.album) {
  animation: msg-jump-pulse 2s ease-out;
}
@keyframes msg-jump-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(41, 98, 255, 0.55); }
  30%  { box-shadow: 0 0 0 4px rgba(41, 98, 255, 0.45); }
  100% { box-shadow: 0 0 0 0 rgba(41, 98, 255, 0); }
}

/* ════════ Privacy blur — message bubble (cột 3) ════════ */
/* Anh chốt 2026-05-22 v3: GIỮ NGUYÊN BOX BUBBLE (background xanh self / trắng
   received) — chỉ blur TEXT bên trong, không blur container. Tag "🔒 Riêng tư"
   dùng ::before cho self (đầu tin) và ::after cho received (cuối tin) qua
   pseudo element trên bubble container. */
.msg-bubble-wrap { position: relative; }
.msg-bubble-wrap.msg-privacy-blurred { cursor: pointer; }

/* PRIVACY 2026-06-11 — placeholder khoá (fail-safe, KHÔNG chứa content thật) */
.msg-bubble-wrap.msg-privacy-locked { cursor: pointer; padding: 2px 0; display: flex; }
.msg-bubble-wrap.msg-privacy-locked.msg-wrap-self { justify-content: flex-end; }
.msg-locked-placeholder {
  display: inline-flex; align-items: center; gap: 7px;
  background: #F3F4F6; border: 1px dashed #D1D5DB; border-radius: 14px;
  padding: 8px 14px; color: #9CA3AF; font-size: 13px; max-width: 70%;
}
.msg-locked-icon { font-size: 16px; color: #B45309; }
.msg-locked-text { font-style: italic; }
.msg-bubble-wrap.msg-privacy-locked:hover .msg-locked-placeholder { border-color: #B45309; color: #6B7280; }

/* Blur CHỈ text/content/media bên trong bubble — KHÔNG blur .message-bubble (box) */
.msg-privacy-blurred :deep(.text-content),
.msg-privacy-blurred :deep(.media-caption),
.msg-privacy-blurred :deep(.recall-body),
.msg-privacy-blurred :deep(.reply-text),
.msg-privacy-blurred :deep(.chat-image),
.msg-privacy-blurred :deep(.chat-video),
.msg-privacy-blurred :deep(.file-card),
.msg-privacy-blurred :deep(.sticker-img),
.msg-privacy-blurred :deep(.sticker-anim),
.msg-privacy-blurred :deep(.reminder-card) {
  filter: blur(8px) saturate(0.4);
  opacity: 0.75;
  user-select: none;
  transition: filter 0.2s ease;
}
/* Blur avatar tròn KH (msg-avatar bên trái received message) */
.msg-privacy-blurred :deep(.msg-avatar) {
  filter: blur(6px);
  opacity: 0.8;
}
.msg-privacy-blurred:hover :deep(.text-content),
.msg-privacy-blurred:hover :deep(.media-caption),
.msg-privacy-blurred:hover :deep(.recall-body),
.msg-privacy-blurred:hover :deep(.chat-image),
.msg-privacy-blurred:hover :deep(.chat-video) {
  filter: blur(10px) saturate(0.3);
}

/* Tag "🔒 Riêng tư" qua pseudo element trên .msg-row (flex container của bubble).
   .msg-row.self dùng flex-direction:row-reverse → DOM order đảo ngược trên visual:
   ::after pseudo nằm CUỐI DOM order → khi reversed = ĐẦU visual = BÊN TRÁI bubble.
   .msg-row non-self direction row normal → ::after nằm sau bubble = BÊN PHẢI bubble.
   Anh chốt 2026-05-22 v5: self tag TRÁI, other tag PHẢI. */
.msg-privacy-blurred :deep(.msg-row)::after {
  content: '🔒 Riêng tư';
  display: inline-flex;
  align-items: center;
  align-self: center;
  background: #fbe6dc;
  color: #7a2000;
  font-size: 10px;
  font-weight: 700;
  padding: 3px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(170, 45, 0, 0.25);
  white-space: nowrap;
  letter-spacing: 0.2px;
  flex-shrink: 0;
  pointer-events: none;
  box-shadow: 0 1px 2px rgba(170, 45, 0, 0.08);
}
.msg-privacy-blurred :deep(.msg-row.self)::after { margin-right: 8px; }
.msg-privacy-blurred :deep(.msg-row):not(.self)::after { margin-left: 8px; }

/* ════════ Privacy composer lock — chỉ phủ input editor ════════ */
/* Anh chốt 2026-05-22: KHÔNG che cả thanh dưới (toolbar gửi ảnh/file/emoji
   vẫn visible để future bot/automation buttons), chỉ disable text input. */
.editor-wrap { position: relative; }
.editor-wrap.editor-locked .input-editor {
  filter: blur(3px) saturate(0.4);
  opacity: 0.4;
  pointer-events: none;
  user-select: none;
}
.editor-lock-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(2px);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 5;
}
.editor-lock-pill {
  background: white;
  color: #7a2000;
  font-size: 12px;
  font-weight: 600;
  padding: 8px 18px;
  border-radius: 9999px;
  border: 1px solid rgba(170, 45, 0, 0.3);
  box-shadow: 0 2px 8px rgba(170, 45, 0, 0.15);
  white-space: nowrap;
}
.editor-lock-overlay:hover .editor-lock-pill {
  background: #aa2d00;
  color: white;
  border-color: #aa2d00;
}

.empty-state {
  display: flex; flex: 1;
  align-items: center; justify-content: center;
  flex-direction: column;
  color: var(--smax-grey-700);
}

/* ════════ Chat header (3-row layout — Anh chốt 2026-06-03) ════════
   Row 1: Tên KH + Gender (ưu tiên, tên đọc rõ)
   Row 2: Chips meta (Cùng-chăm + Giai đoạn + Phân loại)
   Row 3: Nick + counts + Online — FULL-WIDTH lấn sang phải vùng actions
   Actions absolute top-right để row 3 không bị nén. */
.chat-header {
  position: relative;
  background: var(--smax-bg);
  padding: 10px 17px;
  border-bottom: 1px solid var(--smax-grey-200);
  display: flex; align-items: flex-start; gap: 13px;
  flex-shrink: 0;
}
.chat-header > .ch-avatar-wrap { align-self: center; }
.chat-header > .ch-actions {
  position: absolute;
  top: 8px;
  right: 17px;
}
/* Gom 2 dòng 2026-06-06 (Anh chốt):
   Dòng 1 (.ch-row-1) = tên + gender + deal-stage, chừa chỗ phải cho actions cluster.
   Dòng 2 (.ch-row-chips) = cùng-chăm + tag Zalo + nick + số tin + online — 1 hàng, wrap có kiểm soát. */
.ch-row-1 {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding-right: 200px; /* chừa chỗ cho .ch-actions (friendship + ⋮ + ⓘ) */
  min-width: 0;
}

/* Row 2 — gom tất cả meta còn lại, cho phép wrap nếu hẹp (1366/1280). */
.ch-row-chips {
  display: flex; align-items: center; flex-wrap: wrap;
  gap: 8px;
  min-width: 0;
  padding: 2px 0;
  row-gap: 5px;
}

/* Click avatar + tên header → mở dialog user info */
.ch-avatar-wrap { display: inline-flex; border-radius: 50%; transition: transform 0.12s ease, box-shadow 0.12s ease; }
.ch-avatar-wrap.clickable { cursor: pointer; }
.ch-avatar-wrap.clickable:hover { transform: scale(1.05); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.18); }
.ch-name.clickable { cursor: pointer; transition: color 0.12s ease; }
.ch-name.clickable:hover { color: var(--smax-primary, #1786be); }

.ch-info {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column; gap: 3px;
}

/* ── Responsive 1366×768 HD-first (Anh báo 2026-06-03) ──
   Anh báo: ở 1366 header vỡ 4 dòng. Mục tiêu: max 3 dòng compact, không vỡ
   ngoài bubble. Strategy:
     1. Compact padding/gap → tiết kiệm pixel
     2. Cho phép wrap có kiểm soát: ch-row-1 sang 2 dòng nếu cần (max 2),
        ch-row-2 1 dòng
     3. Rút label phụ (cnt-scope, sub-meta btn) → giữ icon
     4. Buttons action compact: icon-only ở 1366, full text ở 1920+ */
/* 2026-06-03 — layout 3 dòng. Mỗi row tự thở rộng, không cần ẩn label.
   Chỉ giảm padding + font-size 1 tier ở 1440 / 1300. */
@media (max-width: 1440px) {
  .chat-header { padding: 8px 12px; gap: 10px; }
  .ch-name { font-size: 15px; }
  .ch-row-chips { gap: 6px; padding: 2px 0; }
  .ch-cung-cham-chip { font-size: 10.5px; padding: 1px 6px; }
  .ch-gender-chip { font-size: 11px; padding: 2px 7px 2px 4px; }
  .ch-gender-chip .gender-svg { width: 14px; height: 14px; }
  .ch-row-2 { font-size: 11px; gap: 5px; }
  .nick-name { max-width: 140px; font-size: 11.5px; }
  .msg-counts .cnt-scope { display: none; }
  .msg-counts { gap: 5px; font-size: 11px; }
  .ch-actions { gap: 4px; }
  .btn-action { padding: 5px 8px; font-size: 11px; gap: 3px; }
  .btn-action .sub-meta { display: none; }
  .zlbl-trigger { padding: 3px 7px !important; font-size: 11px !important; }
  .zlbl-current-name, .zlbl-empty { max-width: 110px; }
}
@media (max-width: 1300px) {
  .chat-header { padding: 7px 10px; gap: 8px; }
  .ch-name { font-size: 14px; }
  .chat-header > .ch-avatar-wrap { transform: scale(0.92); transform-origin: left center; }
  .ch-row-2 :deep(.nick-avatar-lock) { display: none; }
  .nick-name { max-width: 100px; }
  .btn-action { padding: 5px 7px; }
}

/* Row 1: Tên KH + Gender icon — luôn 1 dòng */
.ch-row-1 {
  display: flex; align-items: center; gap: 8px;
  min-width: 0;
  flex-wrap: nowrap; overflow: hidden;
}
.ch-row-1 .ch-gender-chip { flex-shrink: 0; }
.ch-name {
  font-weight: 600; font-size: 16px;
  color: var(--smax-text);
  /* min-width: 0 + flex-shrink để ellipsis hoạt động khi thread narrow.
     max-width: 100% theo flex parent, không cố định 320px (HD thread ~360px
     trừ avatar+actions, max-width 320 sẽ đè actions). */
  min-width: 0; flex-shrink: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ch-sep {
  color: var(--smax-grey-300);
  font-weight: 300;
  user-select: none;
}

/* M55 2026-05-30 — Cùng chăm chip trong chat header */
.ch-cung-cham-chip {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  background: linear-gradient(135deg, #fef3c7, #fed7aa);
  color: #92400e;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  border: 1px solid #fcd34d;
  cursor: help;
  white-space: nowrap;
  flex-shrink: 0;
}

/* Gender/Group chip — icon to + label */
.ch-gender-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px 3px 5px;
  border-radius: 13px;
  font-size: 12px; font-weight: 500;
}
.ch-gender-chip .gender-svg {
  width: 16px; height: 16px;
  flex-shrink: 0;
}
.gender-female {
  background: rgba(233, 30, 99, 0.10);
  color: var(--smax-female, #e91e63);
}
.gender-male {
  background: rgba(30, 136, 229, 0.10);
  color: var(--smax-male, #1e88e5);
}
.gender-unknown {
  background: var(--smax-grey-100);
  color: var(--smax-grey-700);
}
.gender-unknown .gender-q { background: var(--smax-grey-700); }
.gender-group {
  background: rgba(13, 71, 161, 0.10);
  color: #0D47A1;
}

/* Row 3 (giữ class .ch-row-2): nick + counts + online — KHÔNG wrap */
.ch-row-2 {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--smax-grey-700);
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
}
.nick-name {
  font-weight: 500; color: var(--smax-text);
  max-width: 160px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

/* Sprint v3 Tuần 3 Row 6.9 — Nick switcher dropdown */
.nick-switcher {
  display: inline-flex; align-items: center; gap: 6px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  transition: background 0.12s ease;
}
.nick-switcher:hover { background: var(--smax-grey-100, #f5f6fa); }
.nick-caret { font-size: 9px; color: var(--smax-grey-500); opacity: 0.7; }
.nick-switcher:hover .nick-caret { opacity: 1; }

.nick-dd-panel {
  background: #fff;
  border-radius: 10px;
  min-width: 280px;
  max-width: 340px;
  max-height: 380px;
  overflow-y: auto;
  padding: 6px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12);
}
.nick-dd-header {
  font-size: 11px; font-weight: 600;
  color: var(--smax-grey-600);
  text-transform: uppercase;
  letter-spacing: 0.4px;
  padding: 6px 10px 4px;
}
.nick-dd-loading, .nick-dd-empty {
  padding: 12px; text-align: center;
  font-size: 12px; color: var(--smax-grey-500);
  font-style: italic;
}
.nick-dd-item {
  display: flex; align-items: center; gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 7px;
  cursor: pointer;
  text-align: left;
  transition: background 0.1s ease;
}
.nick-dd-item:hover:not(:disabled) { background: var(--smax-grey-100, #f5f6fa); }
.nick-dd-item.active { background: rgba(59, 130, 246, 0.08); }
.nick-dd-item.switching { opacity: 0.6; cursor: wait; }
.nick-dd-item:disabled { cursor: not-allowed; }
.nick-dd-info { flex: 1; min-width: 0; }
.nick-dd-name {
  font-weight: 600; font-size: 13px;
  color: var(--smax-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nick-dd-meta {
  display: flex; align-items: center; gap: 6px;
  font-size: 11px;
  margin-top: 2px;
}
.nick-dd-status { font-weight: 500; }
.status-accepted { color: #00897b; }
.status-pending { color: #ef6c00; }
.status-declined, .status-none { color: var(--smax-grey-500); }
.nick-dd-current {
  background: rgba(59, 130, 246, 0.15);
  color: #1d4ed8;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  font-weight: 600;
}
.msg-counts {
  display: inline-flex; align-items: center; gap: 7px;
}
.msg-counts .cnt-in {
  color: #00897b; font-weight: 600;
}
.msg-counts .cnt-out {
  color: var(--smax-primary); font-weight: 600;
}
.msg-counts .cnt-scope {
  font-size: 9.5px;
  color: var(--smax-grey-700);
  background: var(--smax-grey-100);
  padding: 1px 5px;
  border-radius: 4px;
  margin-left: 4px;
  text-transform: uppercase;
  letter-spacing: 0.2px;
}
.last-online {
  display: inline-flex; align-items: center; gap: 4px;
  /* Giảm font 2026-06-06 (Anh chốt): chữ Online/last-seen nhỏ lại cho gọn header. */
  font-size: 11px;
  color: var(--smax-grey-700);
}
.last-online .online-dot {
  width: 7px; height: 7px;
  border-radius: 50%;
  /* Offline = xám (Anh chốt 2026-06-06). */
  background: var(--smax-grey-300);
  flex-shrink: 0;
}
.last-online.is-online {
  /* Online = chữ + chấm xanh. */
  color: var(--smax-success);
  font-weight: 600;
}
.last-online.is-online .online-dot {
  background: var(--smax-success);
  box-shadow: 0 0 0 2px rgba(0, 200, 83, 0.15);
  animation: online-pulse 2s ease-in-out infinite;
}
@keyframes online-pulse {
  0%, 100% { box-shadow: 0 0 0 2px rgba(0, 200, 83, 0.15); }
  50%      { box-shadow: 0 0 0 4px rgba(0, 200, 83, 0.30); }
}

/* M53 2026-05-30: Virtual KH — chấm ĐỎ nháy */
.last-online.is-virtual {
  color: #b91c1c;
  font-weight: 500;
}
.last-online.is-virtual .online-dot {
  background: #ef4444;
  box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.20);
  animation: virtual-pulse-red 2s ease-in-out infinite;
}
@keyframes virtual-pulse-red {
  0%, 100% { box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.20); }
  50%      { box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.05); }
}

/* M53 2026-05-30: Banner cam virtual conv */
.virtual-banner {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 16px;
  background: linear-gradient(90deg, #fff7ed, #ffedd5);
  border-bottom: 1px solid #fed7aa;
  font-size: 12px;
  color: #9a3412;
  position: sticky;
  top: 0;
  z-index: 5;
}
.virtual-banner-icon {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: #f97316;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}
.virtual-banner-body { flex: 1; }
.virtual-banner-title { font-weight: 600; line-height: 1.4; }
.virtual-banner-sub { font-size: 11px; color: #c2410c; margin-top: 2px; line-height: 1.4; }

/* M53 2026-05-30: virtual mode — bubble self border đứt nét */
.chat-messages-area.is-virtual-mode :deep(.bubble.self) {
  border: 1px dashed #94a3b8 !important;
  background: #f3f4f6 !important;
  color: #1f2937 !important;
}
.chat-messages-area.is-virtual-mode :deep(.bubble.self::after) {
  content: '📝 nội bộ';
  display: block;
  margin-top: 4px;
  font-size: 9px;
  color: #94a3b8;
  font-style: italic;
  text-align: right;
}

/* M53 2026-05-30: nút "Lưu nội bộ" thay "Gửi" */
.send-btn.send-btn-virtual {
  background: linear-gradient(135deg, #f97316, #ea580c) !important;
  color: #fff !important;
  width: auto !important;
  padding: 0 12px !important;
  gap: 4px;
  font-weight: 600;
  font-size: 12px;
}
.send-btn-virtual-label { white-space: nowrap; }
.send-btn.send-btn-virtual:hover:not(:disabled) {
  background: linear-gradient(135deg, #ea580c, #c2410c) !important;
}

/* Legacy keeps */
.status-pill {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 2px 7px; border-radius: 9px;
  font-size: 10px; font-weight: 500;
}
.pill-success { background: rgba(0,200,83,0.12); color: #00897b; }

.ch-actions { display: flex; gap: 5px; align-items: center; }
.btn-action {
  padding: 6px 11px;
  border-radius: 7px;
  border: 1px solid;
  cursor: pointer;
  font-size: 12px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--smax-bg);
  font-family: inherit;
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s, transform 0.08s;
}
.btn-action:hover:not(:disabled) {
  box-shadow: 0 2px 6px rgba(0,0,0,0.08);
  transform: translateY(-0.5px);
}
.btn-friend-already {
  background: rgba(0,200,83,0.08);
  color: #00897b;
  border-color: rgba(0,200,83,0.25);
  cursor: default;
}
.btn-friend-already:hover {
  background: rgba(0,200,83,0.16);
  border-color: rgba(0,200,83,0.45);
}
.btn-friend-already:disabled { opacity: 1; }
.btn-pending {
  background: rgba(255,145,0,0.10);
  color: #ef6c00;
  border-color: rgba(255,145,0,0.35);
}
.btn-pending:hover {
  background: rgba(255,145,0,0.22);
  border-color: rgba(255,145,0,0.6);
}
/* Phase C — KH gửi mời, sale cần accept. Màu vàng cảnh báo + emphasize action */
.btn-accept-friend {
  background: rgba(251, 191, 36, 0.18);
  color: #B45309;
  border-color: rgba(251, 191, 36, 0.5);
  font-weight: 600;
}
.btn-accept-friend:hover {
  background: rgba(251, 191, 36, 0.34);
  border-color: #F59E0B;
  color: #92400E;
}
.btn-add-friend {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
  border-color: var(--smax-primary);
}
.btn-add-friend:hover {
  background: var(--smax-primary);
  color: white;
  border-color: var(--smax-primary);
}
/* Secondary "Thu hồi" — neutral grey, không cảnh báo (rút lại action của chính mình) */
.btn-cancel-invite {
  background: rgba(100, 116, 139, 0.10);
  color: #475569;
  border-color: rgba(100, 116, 139, 0.30);
  font-weight: 500;
}
.btn-cancel-invite:hover:not(:disabled) {
  background: rgba(100, 116, 139, 0.20);
  border-color: rgba(100, 116, 139, 0.55);
  color: #1e293b;
}
/* Secondary "Từ chối" — đỏ nhạt, action destructive đối với KH */
.btn-reject-invite {
  background: rgba(239, 68, 68, 0.10);
  color: #b91c1c;
  border-color: rgba(239, 68, 68, 0.35);
  font-weight: 500;
}
.btn-reject-invite:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.6);
  color: #991b1b;
}
/* 2026-06-03 Anh chốt: hover-reveal VERTICAL (xổ xuống dưới), KHÔNG đẩy ngang.
   .friend-hover-group là anchor; .btn-remove-friend absolute top:100% slide-down. */
.friend-hover-group {
  display: inline-flex;
  align-items: center;
  position: relative; /* anchor cho btn-remove-friend absolute */
}
.btn-remove-friend {
  position: absolute;
  top: calc(100% + 6px); /* dưới Đã KB 6px — tách hẳn khỏi row 1 */
  left: 0;
  background: #fff5f5;
  color: #b91c1c;
  border-color: rgba(239, 68, 68, 0.4);
  font-weight: 500;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px);
  transition: opacity 0.16s ease, transform 0.18s ease;
  z-index: 5;
  /* Shadow chỉ tỏa XUỐNG DƯỚI (offset-y dương + spread âm) → KHÔNG lan lên đè row 1 */
  box-shadow: 0 6px 12px -4px rgba(185, 28, 28, 0.18);
}
.friend-hover-group:hover .btn-remove-friend,
.btn-remove-friend:focus-visible {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0);
}
.btn-remove-friend:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.22);
  border-color: rgba(239, 68, 68, 0.6);
  color: #991b1b;
}
.btn-action:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.btn-action .ic {
  font-size: 13px;
  line-height: 1;
  display: inline-flex; align-items: center;
}
/* Icon Lucide (svg) trong header chat — căn giữa, không lệch baseline (2026-06-08). */
.btn-action .ic > svg,
.nick-caret > svg,
.zlbl-caret > svg,
.zlbl-flag > svg,
.zlbl-check > svg,
.zlbl-inline-sync > svg,
.zlbl-manage .manage-icon > svg,
.virtual-banner-icon > svg { display: block; }
.msg-counts .cnt-arrow { vertical-align: middle; opacity: 0.55; margin: 0 1px 0 -1px; }
.nick-caret, .zlbl-caret { display: inline-flex; align-items: center; }
.btn-action .sub-meta {
  font-size: 10px;
  opacity: 0.7;
  font-weight: 400;
  margin-left: 2px;
}
.btn-webhook {
  background: var(--smax-primary);
  color: white;
  border-color: var(--smax-primary);
}
.btn-webhook:hover:not(:disabled) { background: var(--smax-primary-hover); }
.btn-webhook:disabled { opacity: 0.5; cursor: not-allowed; }

.icon-btn {
  width: 33px; height: 33px;
  border-radius: 7px;
  background: transparent; border: none;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  color: var(--smax-grey-700);
  font-size: 15px;
}
.icon-btn:hover { background: var(--smax-grey-100); }
.icon-btn.on {
  background: var(--smax-primary-soft);
  color: var(--smax-primary);
}

/* ════════ Messages ════════ */
/* min-height: 0 cho phép flex item co lại khi input-area mở rộng (toolbar slide-in,
   ReplyPreviewBar, AISuggestBar) — nếu thiếu, flexbox default min-height: auto
   khiến container vượt parent → input đè lên đoạn chat. */
.messages {
  flex: 1; min-height: 0;
  overflow-y: auto; overflow-anchor: auto;
  /* Phase A UI fix v3 (2026-05-21): overflow-x hidden để reaction overlap chip
     (absolute position) KHÔNG bao giờ gây scroll ngang. Đề phòng future overflow
     từ msg content (URL dài, code block) cũng KHÔNG được scroll ngang.
     Chat UI must NEVER scroll horizontally (anh chốt). */
  overflow-x: hidden;
  padding: 14px 26px;
  display: flex; flex-direction: column; gap: 5px;
}
.msg-divider {
  text-align: center; margin: 13px 0 9px;
  color: var(--smax-grey-700); font-size: 11px;
}
/* E07 Image lightbox — anh chốt 2026-05-21: nút ‹ › + arrow keys, KHÔNG loop. */
.lightbox-wrap {
  position: relative;
  display: flex; align-items: center; justify-content: center;
  min-height: 60vh;
  cursor: pointer;
}
.lightbox-img {
  max-width: 100%; max-height: 85vh;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  cursor: default;
}
.lightbox-nav {
  position: absolute;
  top: 50%; transform: translateY(-50%);
  width: 48px; height: 48px;
  border-radius: 50%;
  background: rgba(0,0,0,0.55);
  color: white;
  border: 0;
  font-size: 32px; font-weight: 300;
  line-height: 1;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease;
  user-select: none;
}
.lightbox-nav:hover:not(:disabled) { background: rgba(0,0,0,0.78); }
.lightbox-nav:disabled { opacity: 0.25; cursor: not-allowed; }
.lightbox-prev { left: 16px; padding-right: 4px; }
.lightbox-next { right: 16px; padding-left: 4px; }
.lightbox-meta {
  position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%);
  font-size: 12px; color: #aaa;
  background: rgba(0,0,0,0.45);
  padding: 4px 10px; border-radius: 12px;
  white-space: nowrap;
}
.msg-divider::before,
.msg-divider::after {
  content: ''; display: inline-block;
  width: 60px; height: 1px;
  background: var(--smax-grey-300);
  vertical-align: middle; margin: 0 9px;
}

/* Inline system event (reminder notice, etc.) — centered, no bubble */
.msg-system-event {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 10px auto;
  padding: 6px 14px;
  background: rgba(255, 152, 0, 0.08);
  border: 1px solid rgba(255, 152, 0, 0.18);
  border-radius: 20px;
  font-size: 12px;
  color: #ef6c00;
  max-width: 80%;
  width: fit-content;
}
.msg-system-event.reminder-notice .reminder-notice-time {
  color: var(--smax-grey-700);
  font-weight: 500;
}

/* Phase A UI fix (2026-05-21):
   - Thêm Avatar top-left cho album group msg (gap=7 match message-bubble)
   - album-sender chuyển vào TRONG bubble.album (như sender-name của message-bubble)
   - align-items: flex-start để avatar top-left */
.msg-album-wrap { display: flex; align-items: flex-start; gap: 7px; margin-bottom: 5px; }
.msg-album-wrap.self { flex-direction: row-reverse; }
.msg-album-wrap .msg-avatar { flex-shrink: 0; }
.msg-album-body { max-width: 60%; }
.bubble.album {
  background: var(--smax-bg);
  border-radius: 13px;
  overflow: hidden;
  box-shadow: 0 1px 1px rgba(0,0,0,0.06);
}
.album-sender {
  font-size: 11.5px; color: var(--smax-primary);
  font-weight: 600;
  padding: 6px 10px 0;
  line-height: 1.2;
}
.album-grid { display: grid; gap: 3px; max-width: 420px; }
.album-grid-1 { grid-template-columns: 1fr; }
.album-grid-2 { grid-template-columns: 1fr 1fr; }
.album-grid-3 { grid-template-columns: 1fr 1fr 1fr; }
.album-tile {
  width: 100%; aspect-ratio: 1/1;
  object-fit: cover; cursor: pointer;
  transition: transform 0.2s;
}
.album-tile:hover { transform: scale(1.02); }
.album-progress { font-size: 10px; padding: 5px 9px; opacity: 0.7; }
.bubble-time {
  font-size: 11px; color: var(--smax-grey-700);
  padding: 5px 9px;
  text-align: right;
}

/* ════════ Input area ════════
 * Auto-grow theo content: editor expand khi user nhập nhiều dòng.
 * BỊ CHẶN ở 45% chiều cao của .message-thread (column 3) → message list luôn
 * còn tối thiểu 55%. Editor max-height computed: container 45% - chrome (~110px)
 * cho tag bar + outer toolbar + send row + padding. Đảm bảo không che message list. */
.input-area {
  background: var(--smax-bg);
  border-top: 1px solid var(--smax-grey-200);
  padding: 7px 13px 9px;
  flex-shrink: 0;
  flex-grow: 0;
  max-height: 45%;          /* Cap 45% chiều cao của .message-thread */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Truyền max-height cho editor: 45% .message-thread - 110px chrome = available */
  --editor-max-h: calc(45dvh - 130px);
}
/* Editor content area chiếm phần còn lại trong .input-area */
.input-area .input-row {
  flex: 1 1 auto;
  min-height: 0;
}
.input-toolbar-top {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-bottom: 6px;
  padding: 2px 0 6px;
  border-bottom: 1px solid var(--smax-grey-100);
  flex-wrap: wrap;
}
.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--smax-grey-200, #ebedf0);
  margin: 0 4px;
  flex-shrink: 0;
}
.icon-tool {
  width: 32px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  font-size: 16px;
  color: var(--smax-grey-700);
  background: transparent; border: none;
  font-family: inherit;
  outline: none;
  /* Reset focus visual để sticker không bị "lệch" outline */
  -webkit-tap-highlight-color: transparent;
}
.icon-tool:hover { background: var(--smax-grey-100); color: var(--smax-primary); }
.icon-tool:focus { outline: none; }
.icon-tool:focus-visible {
  outline: 2px solid var(--smax-primary-soft, #bbdefb);
  outline-offset: -1px;
}
.icon-tool.active {
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #1786be);
}
.icon-tool.spacer-after {
  border-right: 1px solid var(--smax-grey-200);
  margin-right: 4px; padding-right: 4px;
}
.icon-tool.ai-btn { color: #9c27b0; }

.input-row {
  /* Anh chốt 2026-05-22 (issue 3): sticker avatar căn giữa trục dọc với editor.
     align-items:center thay vì flex-end → halo nick + input baseline cân đối. */
  display: flex; align-items: center; gap: 8px;
  position: relative;
}
.editor-wrap {
  flex: 1; min-width: 0;
  position: relative;
}
.input-editor { width: 100%; }

/* ── Avatar nick halo: gradient cam-đỏ-vàng đậm xoay quanh avatar ───────
 * Inspired Instagram Stories halo. Conic-gradient rotate 3s linear infinite.
 * Avatar bên trong 36px, halo ring 42px (padding 3px tạo viền).
 * Hover: tăng speed + brightness để feedback. */
.nick-avatar-halo {
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  padding: 3px;
  background: conic-gradient(
    from var(--halo-angle, 0deg),
    #ef6c00 0%,        /* cam đậm */
    #c62828 25%,       /* đỏ đậm */
    #f9a825 50%,       /* vàng đậm */
    #ef6c00 75%,
    #c62828 100%
  );
  animation: haloSpin 3s linear infinite;
  /* Bỏ margin-bottom vì .input-row giờ dùng align-items:center → tự cân đối */
  cursor: help;
  transition: filter 0.18s;
}
.nick-avatar-halo:hover {
  filter: brightness(1.12) saturate(1.2);
  animation-duration: 1.8s;
}
.nick-avatar-halo .sender-nick-avatar {
  display: block;
  border: 2px solid var(--smax-bg, #fff);
  border-radius: 50%;
}
@property --halo-angle {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
@keyframes haloSpin {
  to { --halo-angle: 360deg; }
}
/* Fallback nếu trình duyệt không hỗ trợ @property — dùng rotate transform */
@supports not (background: conic-gradient(from 0deg, red, blue)) {
  .nick-avatar-halo {
    animation: haloRotate 3s linear infinite;
  }
  @keyframes haloRotate {
    to { transform: rotate(360deg); }
  }
}

.send-btn {
  background: var(--smax-primary);
  color: white;
  width: 40px; height: 40px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  margin-bottom: 1px;
}
.send-btn:hover:not(:disabled) { background: var(--smax-primary-hover); }
.send-btn:disabled { opacity: 0.4; cursor: not-allowed; background: var(--smax-grey-300); }

/* EmojiPicker trigger — emoji icon next to send button */
.input-row :deep(.emoji-trigger) {
  width: 36px; height: 36px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
  font-size: 22px;
  cursor: pointer;
  border-radius: 50%;
  margin-bottom: 3px;
  flex-shrink: 0;
}
.input-row :deep(.emoji-trigger:hover) {
  background: var(--smax-grey-100);
}

/* ── Zalo Real labels dropdown — Zalo-native style ────────────────────── */
.zlbl-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--smax-grey-100, #f5f6fa);
  border: 1px solid var(--smax-grey-200, #ebedf0);
  border-radius: 11px;
  font-size: 12px;
  font-weight: 500;
  padding: 2px 8px;
  cursor: pointer;
  color: var(--smax-grey-700);
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
  max-width: 180px;
  white-space: nowrap; /* 2026-06-03: chống "Phân loại" wrap khi row 1 chật */
  flex-shrink: 0;
}
.zlbl-trigger:hover {
  background: var(--smax-primary-soft, #e3f2fd);
  border-color: var(--smax-primary, #1786be);
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.zlbl-icon { flex-shrink: 0; display: block; }
.zlbl-current-name {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zlbl-empty { font-style: italic; color: var(--smax-grey-500); }
.zlbl-caret { font-size: 9px; opacity: 0.6; flex-shrink: 0; }

/* Dropdown chính — match Zalo native: rộng, padding 0, list items full-width */
.zlbl-dropdown.zalo-native {
  min-width: 280px;
  max-width: 320px;
  max-height: 480px;
  overflow-y: auto;
  background: #fff;
  padding: 6px 0;
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.15);
}
.zlbl-loading,
.zlbl-empty-state {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--smax-grey-500);
}
.zlbl-empty-state { font-style: italic; }
.zlbl-inline-sync {
  margin-top: 8px;
  background: var(--smax-primary-soft, #e3f2fd);
  color: var(--smax-primary, #1786be);
  border: none;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  border-radius: 7px;
  cursor: pointer;
}
.zlbl-inline-sync:hover { filter: brightness(0.95); }

.zlbl-options {
  display: flex;
  flex-direction: column;
}
.zlbl-option {
  display: flex;
  align-items: center;
  gap: 12px;
  background: transparent;
  border: none;
  padding: 9px 14px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13px;
  width: 100%;
  text-align: left;
  transition: background 0.1s;
}
.zlbl-option:hover { background: var(--smax-grey-50, #f5f6fa); }
.zlbl-option.active { background: rgba(33, 150, 243, 0.06); }
.zlbl-option.busy { opacity: 0.5; cursor: progress; }
.zlbl-option:disabled { cursor: not-allowed; }
.zlbl-flag {
  font-size: 16px;
  width: 18px;
  flex-shrink: 0;
  line-height: 1;
}
.zlbl-name {
  flex: 1;
  color: var(--smax-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.zlbl-option.active .zlbl-name { font-weight: 600; }
.zlbl-check {
  color: var(--smax-primary, #1786be);
  font-size: 14px;
  font-weight: 700;
  flex-shrink: 0;
}

.zlbl-divider {
  height: 1px;
  background: var(--smax-grey-100);
  margin: 4px 0;
}
.zlbl-manage {
  width: 100%;
  background: transparent;
  border: none;
  padding: 10px 14px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: var(--smax-grey-700);
  font-family: inherit;
  text-align: left;
  transition: background 0.1s;
}
.zlbl-manage:hover { background: var(--smax-grey-50); color: var(--smax-primary); }
.manage-icon { font-size: 14px; }

/* Dải gợi ý ảnh kho theo ngữ cảnh (GĐ3a-4) */
.media-suggest-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 7px 12px; margin: 0 0 6px; background: #a8d8c4; border: 1px solid #8fc7af;
  border-radius: 10px; font-size: 12.5px;
}
.media-suggest-bar .ms-label { color: #0a2e0e; font-weight: 500; flex-shrink: 0; }
.ms-chip {
  display: inline-flex; align-items: center; gap: 6px; background: #fff;
  border: 1px solid #8fc7af; border-radius: 9999px; padding: 3px 10px 3px 3px;
  cursor: pointer; font-size: 12px; color: #181d26; max-width: 180px;
}
.ms-chip:disabled { opacity: .6; cursor: default; }
.ms-chip img { width: 24px; height: 24px; border-radius: 50%; object-fit: cover; }
.ms-chip .ms-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
